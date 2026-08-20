const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");

const TEST_DATABASE_URL = process.env.CC_SPRINT_113_TEST_DATABASE_URL || "";
const OPTED_IN = process.env.CC_SPRINT_113_ALLOW_DISPOSABLE_DB === "1";
const SKIP_REASON = !TEST_DATABASE_URL
  ? "CC_SPRINT_113_TEST_DATABASE_URL is not configured"
  : !OPTED_IN ? "CC_SPRINT_113_ALLOW_DISPOSABLE_DB=1 is required" : false;
const PRODUCTION_MODULE_PATHS = [
  "../netlify/functions/_auth", "../netlify/functions/login",
  "../netlify/functions/admin-users", "../netlify/functions/complete-password-reset",
  "../netlify/functions/maintenance",
];
const REQUIRED_USER_SNAPSHOT_FIELDS = Object.freeze([
  "user_id", "username", "display_name", "email", "role", "status", "account_type",
  "employee_id", "restaurant_id", "is_system_account", "linked_at", "linked_by",
  "password_hash", "must_reset_password", "session_version", "row_version",
  "access_version", "disabled_at", "updated_at", "updated_by",
]);
const REQUIRED_ACCESS_SNAPSHOT_FIELDS = Object.freeze([
  "access_id", "username", "module_key", "can_view", "can_create", "can_edit",
  "can_delete", "updated_at", "updated_by",
]);
const REQUIRED_AUDIT_SNAPSHOT_FIELDS = Object.freeze([
  "audit_id", "actor_username", "action", "target_type", "target_id", "before_data",
  "after_data", "created_at",
]);
const USER_SNAPSHOT_SQL = `SELECT user_id::text AS user_id, username, display_name, email, role, status, account_type,
       employee_id::text AS employee_id, restaurant_id::text AS restaurant_id,
       is_system_account, linked_at::text AS linked_at, linked_by, password_hash,
       must_reset_password, session_version::text AS session_version,
       row_version::text AS row_version, access_version::text AS access_version,
       disabled_at::text AS disabled_at, updated_at::text AS updated_at, updated_by
  FROM admin_users WHERE ($1::uuid IS NULL OR user_id = $1::uuid)
 ORDER BY lower(username), username, user_id`;
const ACCESS_SNAPSHOT_SQL = `SELECT access_id::text AS access_id, username, module_key, can_view, can_create,
       can_edit, can_delete, updated_at::text AS updated_at, updated_by
  FROM admin_module_access WHERE ($1::text IS NULL OR lower(username) = lower($1))
 ORDER BY lower(username), username, lower(btrim(module_key)), module_key, access_id`;
const AUDIT_SNAPSHOT_SQL = `SELECT audit_id::text AS audit_id, actor_username, action, target_type, target_id,
       before_data, after_data, created_at::text AS created_at
  FROM admin_audit_logs WHERE ($1::text[] IS NULL OR target_id = ANY($1::text[]))
 ORDER BY created_at, audit_id`;

function assertSafeConfiguration() {
  assert.ok(TEST_DATABASE_URL, "purpose-specific disposable database URL is required");
  assert.equal(OPTED_IN, true, "explicit disposable-database opt-in is required");
  const parsed = new URL(TEST_DATABASE_URL);
  assert.match(parsed.protocol, /^postgres(?:ql)?:$/, "test URL must use PostgreSQL");
  assert.ok(parsed.pathname.length > 1, "test URL must name a database");
  for (const name of ["DATABASE_URL", "NETLIFY_DATABASE_URL", "NETLIFY_DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL"]) {
    if (process.env[name]) assert.notEqual(TEST_DATABASE_URL, process.env[name], `test URL must differ from ${name}`);
  }
}

function assertOwnedSchema(value) {
  assert.match(value, /^cc_sprint_113_[0-9]+_[a-f0-9]+(?:_[a-z0-9]+)?$/);
  return value;
}

function generatedSchema(suffix = "") {
  return assertOwnedSchema(`cc_sprint_113_${Date.now()}_${crypto.randomBytes(6).toString("hex")}${suffix}`);
}

function quoteIdentifier(value) {
  return `"${assertOwnedSchema(value)}"`;
}

const LIFECYCLE_ORDER_ERROR = "SPRINT_113_LIFECYCLE_ORDER";

function lifecycleOrderError() {
  const error = new Error("Disposable PostgreSQL lifecycle is not active");
  error.code = LIFECYCLE_ORDER_ERROR;
  return error;
}

function createCleanupRegistry(options = {}) {
  const steps = [];
  const phaseOrder = options.phaseOrder || ["default"];
  const phaseSet = new Set(phaseOrder);
  let cleaned = false;
  let cleanupErrors = [];
  return {
    register(step, operation, phase = "default") {
      if (cleaned) throw new Error("Cleanup registry is already settled");
      if (typeof step !== "string" || !step || typeof operation !== "function" || !phaseSet.has(phase)) {
        throw new Error("Cleanup registration is invalid");
      }
      steps.push({ step, operation, phase });
    },
    async cleanup() {
      if (cleaned) return cleanupErrors.slice();
      cleaned = true;
      cleanupErrors = [];
      for (const phase of phaseOrder) {
        for (const record of steps.filter((entry) => entry.phase === phase).reverse()) {
          try { await record.operation(); } catch (error) {
            cleanupErrors.push({ step: record.step, error });
          }
        }
      }
      return cleanupErrors.slice();
    },
  };
}

async function runWithCleanup(operation, cleanup, options = {}) {
  let result;
  let primaryFailure = null;
  try { result = await operation(); } catch (error) { primaryFailure = error; }
  const cleanupErrors = await cleanup();
  if (primaryFailure) {
    if (cleanupErrors.length && options.reportCleanupFailure) {
      options.reportCleanupFailure(cleanupErrors.length);
    }
    throw primaryFailure;
  }
  if (cleanupErrors.length) {
    const error = new Error(options.cleanupMessage ||
      `Disposable PostgreSQL cleanup failed (${cleanupErrors.length} operation(s))`);
    error.code = options.cleanupCode || "SPRINT_113_CLEANUP_FAILURE";
    throw error;
  }
  return result;
}

function createDisposableLifecycle(options = {}) {
  const environment = options.environment || process.env;
  const moduleCache = options.moduleCache || require.cache;
  const dropSchema = options.dropSchema || (async () => {});
  const reportCleanupFailure = options.reportCleanupFailure || ((count) => {
    console.error(`Disposable PostgreSQL cleanup reported ${count} failure(s).`);
  });
  const ownedSchemas = [];
  const ownedSchemaSet = new Set();
  const pools = [];
  const clients = [];
  const environmentNames = new Set();
  const cachePaths = new Set();
  const cleanupRegistry = createCleanupRegistry({
    phaseOrder: ["restorer", "pool", "schema", "client", "control-pool", "module-cache", "environment"],
  });
  let cleaned = false;
  let cleanupErrors = [];
  let state = "idle";

  function assertActive() {
    if (state !== "active") throw lifecycleOrderError();
  }

  const lifecycle = {
    requireActive() {
      assertActive();
      return true;
    },
    activate() {
      if (state !== "idle") throw lifecycleOrderError();
      state = "active";
    },
    deactivate() {
      if (state !== "active") throw lifecycleOrderError();
      state = "settling";
    },
    createPool(factory, options = {}) {
      assertActive();
      if (typeof factory !== "function") throw new Error("Pool factory must be a function");
      return lifecycle.trackPool(factory(), options);
    },
    async acquireClient(pool) {
      assertActive();
      if (!pool || typeof pool.connect !== "function") throw new Error("Client pool must be connectable");
      return lifecycle.trackClient(await pool.connect());
    },
    async createSchema(schema, create) {
      assertActive();
      if (typeof create !== "function") throw new Error("Schema creator must be a function");
      await create(schema);
      lifecycle.ownSchema(schema);
      return schema;
    },
    ownSchema(schema) {
      assertActive();
      assertOwnedSchema(schema);
      if (ownedSchemaSet.has(schema)) throw new Error("Disposable schema ownership must be unique");
      ownedSchemaSet.add(schema);
      ownedSchemas.push(schema);
      cleanupRegistry.register(`schema:${schema}`, async () => {
        assert.equal(ownedSchemaSet.has(schema), true, "cleanup may target only an owned schema");
        await dropSchema(schema);
      }, "schema");
      return schema;
    },
    trackPool(pool, options = {}) {
      assertActive();
      if (!pool || typeof pool.end !== "function") throw new Error("Tracked pool must be closeable");
      const record = { pool, control: options.control === true, closed: false };
      pools.push(record);
      cleanupRegistry.register(record.control ? "control-pool:end" : "pool:end", async () => {
        if (record.closed) return;
        await record.pool.end();
        record.closed = true;
      }, record.control ? "control-pool" : "pool");
      return pool;
    },
    async closePool(pool) {
      assertActive();
      const record = pools.find((entry) => entry.pool === pool);
      if (!record) throw new Error("Cannot close an untracked pool");
      if (record.closed) return;
      await record.pool.end();
      record.closed = true;
    },
    trackClient(client) {
      assertActive();
      if (!client || typeof client.release !== "function") throw new Error("Tracked client must be releasable");
      const record = { client, released: false };
      clients.push(record);
      cleanupRegistry.register("client:release", async () => {
        if (record.released) return;
        record.client.release();
        record.released = true;
      }, "client");
      return client;
    },
    setEnvironment(name, value) {
      assertActive();
      if (!environmentNames.has(name)) {
        const existed = Object.prototype.hasOwnProperty.call(environment, name);
        const previousValue = environment[name];
        environmentNames.add(name);
        cleanupRegistry.register(`environment:${name}`, async () => {
          if (existed) environment[name] = previousValue;
          else delete environment[name];
        }, "environment");
      }
      environment[name] = value;
    },
    replaceModuleCache(modulePath) {
      assertActive();
      if (cachePaths.has(modulePath)) return;
      const existed = Object.prototype.hasOwnProperty.call(moduleCache, modulePath);
      const previousValue = moduleCache[modulePath];
      cachePaths.add(modulePath);
      cleanupRegistry.register(`module-cache:${modulePath}`, async () => {
        if (existed) moduleCache[modulePath] = previousValue;
        else delete moduleCache[modulePath];
      }, "module-cache");
      delete moduleCache[modulePath];
    },
    addRestorer(restorer) {
      assertActive();
      if (typeof restorer !== "function") throw new Error("Lifecycle restorer must be a function");
      cleanupRegistry.register("restore", restorer, "restorer");
    },
    async cleanup() {
      if (state === "active") throw lifecycleOrderError();
      if (cleaned) return cleanupErrors.slice();
      cleaned = true;
      state = "cleaned";
      cleanupErrors = await cleanupRegistry.cleanup();
      return cleanupErrors.slice();
    },
    get cleanupErrors() { return cleanupErrors.slice(); },
    reportCleanupFailure,
  };
  return lifecycle;
}

function createTrackedProductionPoolClass(OriginalPool, lifecycle) {
  return class TrackedProductionPool extends OriginalPool {
    constructor(options) {
      lifecycle.requireActive();
      super(options);
      lifecycle.trackPool(this);
    }
  };
}

function extractSourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function assertForcedAuditCleanupSource(section) {
  const ordered = [
    ["const scenarioCleanup = createCleanupRegistry();", "audit cleanup registry must be created first"],
    ["return runWithCleanup(async () => {", "audit function creation must occur inside active cleanup protection"],
    ["CREATE FUNCTION", "audit function creation must occur inside active cleanup protection"],
    ["scenarioCleanup.register(\"audit-function\"", "audit function cleanup must register immediately after creation"],
    ["CREATE TRIGGER", "audit trigger creation must follow protected function registration"],
    ["scenarioCleanup.register(\"audit-trigger\"", "audit trigger cleanup must register immediately after creation"],
  ];
  let previous = -1;
  for (const [token, message] of ordered) {
    const current = section.indexOf(token);
    assert.ok(current > previous, message);
    previous = current;
  }
  assert.match(section, /\}, \(\) => scenarioCleanup\.cleanup\(\), \{/,
    "scenario cleanup must use shared cleanup registry executor");
  assert.doesNotMatch(section, /finally\s*\{[\s\S]*DROP TRIGGER[\s\S]*DROP FUNCTION/,
    "audit cleanup must not use sequential unprotected finally actions");
}

function assertSharedCleanupPrimitiveSource(source) {
  const lifecycleSection = extractSourceSection(
    source, "function createDisposableLifecycle", "function createTrackedProductionPoolClass"
  );
  assert.match(lifecycleSection, /const cleanupRegistry = createCleanupRegistry\(\{/,
    "outer lifecycle must create the shared cleanup registry");
  assert.match(lifecycleSection, /cleanupErrors = await cleanupRegistry\.cleanup\(\)/,
    "outer lifecycle must execute the shared cleanup registry");
  assert.doesNotMatch(lifecycleSection, /(?:async\s+)?function\s+attempt\s*\(|await\s+attempt\s*\(/,
    "outer lifecycle must not define a separate attempt executor");
}

function removeMethodGuard(source, methodName) {
  const methodStart = source.indexOf(`${methodName}(`);
  assert.notEqual(methodStart, -1, `missing lifecycle method ${methodName}`);
  const guardStart = source.indexOf("assertActive();", methodStart);
  assert.notEqual(guardStart, -1, `missing active guard for ${methodName}`);
  return source.slice(0, guardStart) + source.slice(guardStart + "assertActive();".length);
}

function compileLifecycleFactory(source) {
  return vm.runInNewContext(`(${source})`, {
    assert, assertOwnedSchema, createCleanupRegistry, lifecycleOrderError, console, process,
  });
}

async function runDisposableLifecycle(lifecycle, operation) {
  lifecycle.activate();
  return runWithCleanup(operation, async () => {
    lifecycle.deactivate();
    return lifecycle.cleanup();
  }, {
    reportCleanupFailure: lifecycle.reportCleanupFailure,
    cleanupCode: "SPRINT_113_CLEANUP_FAILURE",
  });
}

test("disposable PostgreSQL lifecycle enforces order and preserves failures through all cleanup", async () => {
  const events = [];
  const schemas = new Set(["unrelated_schema"]);
  const environment = { DATABASE_URL: "original-database-setting" };
  const originalCacheEntry = { exports: "original" };
  const moduleCache = { "virtual-production-module": originalCacheEntry };
  const earlyFailureSchema = generatedSchema("_early");
  const injectedSchema = generatedSchema("_injected");
  const laterSchema = generatedSchema("_later");
  let hookState = "original";
  let normalPoolEnds = 0;
  let controlPoolEnds = 0;
  let clientReleases = 0;
  const lifecycle = createDisposableLifecycle({
    environment,
    moduleCache,
    reportCleanupFailure(count) { events.push(`reported:${count}`); },
    async dropSchema(schema) {
      events.push(`drop:${schema}`);
      if (schema === earlyFailureSchema) throw new Error("injected cleanup action failure");
      schemas.delete(schema);
    },
  });
  let prematurePoolFactories = 0;
  let prematureConnections = 0;
  let prematureSchemaCreates = 0;
  let prematurePoolEnds = 0;
  let prematureClientReleases = 0;
  let prematureRestorers = 0;
  let prematureBasePoolConstructions = 0;
  const prematureOwnedSchema = generatedSchema("_unowned");
  const orderMatcher = (error) => error?.code === LIFECYCLE_ORDER_ERROR &&
    error.message === "Disposable PostgreSQL lifecycle is not active";
  assert.throws(() => lifecycle.requireActive(), orderMatcher,
    "production pool wrappers must reject before construction outside an active lifecycle");
  assert.throws(() => lifecycle.createPool(() => {
    prematurePoolFactories += 1;
    return { async end() {} };
  }, { control: true }), orderMatcher, "control-pool creation must require an active lifecycle");
  await assert.rejects(() => lifecycle.acquireClient({ async connect() {
    prematureConnections += 1;
    return { release() {} };
  } }), orderMatcher, "client acquisition must require an active lifecycle");
  await assert.rejects(() => lifecycle.createSchema(generatedSchema("_premature"), async () => {
    prematureSchemaCreates += 1;
  }), orderMatcher, "schema creation must require an active lifecycle");
  assert.throws(() => lifecycle.trackPool({ async end() { prematurePoolEnds += 1; } }), orderMatcher,
    "pool registration must require an active lifecycle");
  assert.throws(() => lifecycle.trackClient({ release() { prematureClientReleases += 1; } }), orderMatcher,
    "client registration must require an active lifecycle");
  assert.throws(() => lifecycle.ownSchema(prematureOwnedSchema), orderMatcher,
    "schema registration must require an active lifecycle");
  assert.throws(() => lifecycle.setEnvironment("DATABASE_URL", "must-not-change"), orderMatcher,
    "environment mutation must require an active lifecycle");
  assert.throws(() => lifecycle.replaceModuleCache("virtual-production-module"), orderMatcher,
    "module-cache mutation must require an active lifecycle");
  assert.throws(() => lifecycle.addRestorer(() => { prematureRestorers += 1; }), orderMatcher,
    "hook registration must require an active lifecycle");
  class PrematureBasePool {
    constructor() { prematureBasePoolConstructions += 1; }
    async end() { prematurePoolEnds += 1; }
  }
  const GuardedProductionPool = createTrackedProductionPoolClass(PrematureBasePool, lifecycle);
  assert.throws(() => new GuardedProductionPool({}), orderMatcher,
    "production pg.Pool construction must reject before super outside an active lifecycle");
  assert.deepEqual([
    prematurePoolFactories, prematureConnections, prematureSchemaCreates,
    prematureBasePoolConstructions, prematurePoolEnds, prematureClientReleases, prematureRestorers,
  ], [0, 0, 0, 0, 0, 0, 0],
    "inactive acquisition helpers must reject before invoking external factories");
  assert.equal(environment.DATABASE_URL, "original-database-setting",
    "inactive environment mutation must not change its target");
  assert.equal(moduleCache["virtual-production-module"], originalCacheEntry,
    "inactive module-cache mutation must not change its target");

  const injectedFailure = new Error("injected failure immediately after owned schema creation");
  const triggerCleanupFailure = new Error("DROP TRIGGER secret-host.example password=secret SQL details");
  await assert.rejects(
    runDisposableLifecycle(lifecycle, async () => {
      const controlPool = lifecycle.createPool(() => ({
        async connect() { return { release() { clientReleases += 1; events.push("client:release"); } }; },
        async end() { controlPoolEnds += 1; events.push("control-pool:end"); },
      }), { control: true });
      await lifecycle.acquireClient(controlPool);
      lifecycle.createPool(() => ({ async end() { normalPoolEnds += 1; events.push("normal-pool:end"); } }));
      lifecycle.setEnvironment("DATABASE_URL", "temporary-disposable-setting");
      lifecycle.setEnvironment("SESSION_SECRET", "temporary-session-setting");
      lifecycle.replaceModuleCache("virtual-production-module");
      moduleCache["virtual-production-module"] = { exports: "temporary" };
      lifecycle.addRestorer(() => { hookState = "original"; events.push("hook:restore"); });
      hookState = "temporary";
      for (const schema of [earlyFailureSchema, injectedSchema, laterSchema]) {
        await lifecycle.createSchema(schema, async (owned) => { schemas.add(owned); });
      }
      const scenarioCleanup = createCleanupRegistry();
      scenarioCleanup.register("audit-function", async () => { events.push("function:drop"); });
      scenarioCleanup.register("audit-trigger", async () => {
        events.push("trigger:drop");
        throw triggerCleanupFailure;
      });
      await runWithCleanup(async () => { throw injectedFailure; }, () => scenarioCleanup.cleanup(), {
        reportCleanupFailure: lifecycle.reportCleanupFailure,
        cleanupCode: "SPRINT_113_SCENARIO_CLEANUP_FAILURE",
        cleanupMessage: "Disposable PostgreSQL scenario cleanup failed",
      });
    }),
    (error) => error === injectedFailure,
    "the exact primary failure must survive scenario and outer cleanup failures"
  );
  assert.deepEqual(events.filter((entry) => /^(trigger|function):drop$/.test(entry)),
    ["trigger:drop", "function:drop"], "function cleanup must continue after trigger cleanup fails");
  assert.equal(schemas.has(injectedSchema), false, "the injected-failure schema must be removed");
  assert.equal(schemas.has(laterSchema), false, "cleanup must continue after an earlier schema drop fails");
  assert.equal(schemas.has("unrelated_schema"), true, "an unrelated schema must not be touched");
  assert.deepEqual(events.filter((entry) => entry.startsWith("drop:")), [
    `drop:${laterSchema}`, `drop:${injectedSchema}`, `drop:${earlyFailureSchema}`,
  ]);
  assert.equal(normalPoolEnds, 1, "every initialized test pool must close");
  assert.equal(controlPoolEnds, 1, "the control pool must close");
  assert.equal(clientReleases, 1, "every acquired client must release");
  assert.equal(environment.DATABASE_URL, "original-database-setting");
  assert.equal(Object.prototype.hasOwnProperty.call(environment, "SESSION_SECRET"), false);
  assert.equal(moduleCache["virtual-production-module"], originalCacheEntry);
  assert.equal(hookState, "original");
  assert.equal(lifecycle.cleanupErrors.length, 1);
  assert.match(lifecycle.cleanupErrors[0].step, /^schema:cc_sprint_113_/);
  assert.deepEqual(events.filter((entry) => entry.startsWith("reported:")), ["reported:1", "reported:1"],
    "scenario and outer cleanup failures must be reported only as sanitized counts");
  assert.deepEqual([prematurePoolEnds, prematureClientReleases, prematureRestorers], [0, 0, 0],
    "rejected inactive operations must not register cleanup actions");
  assert.equal(events.includes(`drop:${prematureOwnedSchema}`), false,
    "rejected inactive schema registration must not create a cleanup action");

  const cleanupOnlyEvents = [];
  const cleanupOnlySchemas = new Set(["unrelated_schema"]);
  const cleanupOnlyEnvironment = { DATABASE_URL: "original" };
  const cleanupOnlyCacheEntry = { exports: "original" };
  const cleanupOnlyCache = { module: cleanupOnlyCacheEntry };
  let cleanupOnlyHook = "original";
  const cleanupOnlyLifecycle = createDisposableLifecycle({
    environment: cleanupOnlyEnvironment,
    moduleCache: cleanupOnlyCache,
    reportCleanupFailure(count) { cleanupOnlyEvents.push(`reported:${count}`); },
    async dropSchema(schema) { cleanupOnlyEvents.push("outer-schema:drop"); cleanupOnlySchemas.delete(schema); },
  });
  const cleanupOnlySchema = generatedSchema("_cleanuponly");
  const rawCleanupDetail = "postgres://user:password@secret-host.example/db DROP TRIGGER internal_name";
  await assert.rejects(runDisposableLifecycle(cleanupOnlyLifecycle, async () => {
    cleanupOnlyLifecycle.createPool(() => ({ async end() { cleanupOnlyEvents.push("pool:end"); } }));
    const controlPool = cleanupOnlyLifecycle.createPool(() => ({
      async connect() { return { release() { cleanupOnlyEvents.push("client:release"); } }; },
      async end() { cleanupOnlyEvents.push("control-pool:end"); },
    }), { control: true });
    await cleanupOnlyLifecycle.acquireClient(controlPool);
    await cleanupOnlyLifecycle.createSchema(cleanupOnlySchema, async (owned) => cleanupOnlySchemas.add(owned));
    cleanupOnlyLifecycle.setEnvironment("DATABASE_URL", "temporary");
    cleanupOnlyLifecycle.replaceModuleCache("module");
    cleanupOnlyCache.module = { exports: "temporary" };
    cleanupOnlyLifecycle.addRestorer(() => { cleanupOnlyHook = "original"; cleanupOnlyEvents.push("hook:restore"); });
    cleanupOnlyHook = "temporary";
    const scenarioCleanup = createCleanupRegistry();
    scenarioCleanup.register("audit-function", async () => { cleanupOnlyEvents.push("function:drop"); });
    scenarioCleanup.register("audit-trigger", async () => {
      cleanupOnlyEvents.push("trigger:drop");
      throw new Error(rawCleanupDetail);
    });
    await runWithCleanup(async () => "operation-success", () => scenarioCleanup.cleanup(), {
      cleanupCode: "SPRINT_113_SCENARIO_CLEANUP_FAILURE",
      cleanupMessage: "Disposable PostgreSQL scenario cleanup failed",
    });
  }), (error) => {
    assert.equal(error.code, "SPRINT_113_SCENARIO_CLEANUP_FAILURE");
    assert.equal(error.message, "Disposable PostgreSQL scenario cleanup failed");
    assert.doesNotMatch(error.message, /postgres:\/\/user|secret-host|password|DROP TRIGGER|internal_name/i);
    return true;
  }, "cleanup-only failure must remain visible through a sanitized classification");
  assert.deepEqual(cleanupOnlyEvents.slice(0, 2), ["trigger:drop", "function:drop"]);
  for (const event of ["outer-schema:drop", "pool:end", "client:release", "control-pool:end", "hook:restore"]) {
    assert.equal(cleanupOnlyEvents.includes(event), true, `${event} must run after scenario cleanup failure`);
  }
  assert.equal(cleanupOnlySchemas.has(cleanupOnlySchema), false);
  assert.equal(cleanupOnlySchemas.has("unrelated_schema"), true);
  assert.equal(cleanupOnlyEnvironment.DATABASE_URL, "original");
  assert.equal(cleanupOnlyCache.module, cleanupOnlyCacheEntry);
  assert.equal(cleanupOnlyHook, "original");
});

test("PostgreSQL rollback acceptance source resists false-positive evidence mutations", () => {
  const source = fs.readFileSync(__filename, "utf8");
  const parentMarker = 'test("Sprint 1.13 production SQL and transactions on disposable PostgreSQL"';
  const parentSource = source.slice(source.lastIndexOf(parentMarker));
  const guardedMarker = "await runDisposableLifecycle(lifecycle, async () => {";
  const guardedIndex = parentSource.indexOf(guardedMarker);
  assert.notEqual(guardedIndex, -1, "real PostgreSQL parent must enter the guarded lifecycle callback");
  const beforeGuard = parentSource.slice(0, guardedIndex);
  assert.doesNotMatch(beforeGuard,
    /lifecycle\.(?:createPool|acquireClient|createSchema|trackPool|trackClient|ownSchema|setEnvironment|replaceModuleCache|addRestorer)\s*\(|new\s+OriginalPool\s*\(|\.connect\s*\(/,
    "real PostgreSQL resource acquisition must not occur before lifecycle activation");
  const guardedBody = parentSource.slice(guardedIndex);
  assert.match(guardedBody, /lifecycle\.createPool\(\(\) => new OriginalPool/,
    "real PostgreSQL pools must use the active lifecycle helper");
  assert.match(guardedBody, /createTrackedProductionPoolClass\(OriginalPool, lifecycle\)/,
    "real PostgreSQL parent must use the behaviorally guarded production pool wrapper");
  const trackedPoolSource = createTrackedProductionPoolClass.toString();
  const guardedPoolOrder = /constructor\(options\)\s*{\s*lifecycle\.requireActive\(\);\s*super\(options\);\s*lifecycle\.trackPool\(this\)/;
  assert.match(trackedPoolSource, guardedPoolOrder,
    "production-module pool construction must reject before super outside an active lifecycle");
  const superBeforeGuardMutation = trackedPoolSource.replace(
    "lifecycle.requireActive();\n      super(options);", "super(options);\n      lifecycle.requireActive();"
  );
  assert.doesNotThrow(() => new vm.Script(`(${superBeforeGuardMutation})`),
    "production pool order mutation must remain syntactically valid");
  assert.throws(() => assert.match(superBeforeGuardMutation, guardedPoolOrder,
    "production pool activity guard must precede super"), (error) =>
    error instanceof assert.AssertionError &&
      error.message.includes("production pool activity guard must precede super"));
  assert.match(guardedBody, /await lifecycle\.acquireClient\(control\)/,
    "real PostgreSQL client acquisition must use the active lifecycle helper");
  assert.match(guardedBody, /await lifecycle\.createSchema\(generatedSchema\(/,
    "real PostgreSQL schema creation must use the active lifecycle helper");
  const forcedCleanupSection = extractSourceSection(
    parentSource, "async function withForcedAuditFailure", 'await t.test("1. empty-schema'
  );
  assertForcedAuditCleanupSource(forcedCleanupSection);
  assertSharedCleanupPrimitiveSource(source);

  function expectValidSourceMutationFailure(mutant, validator, expectedReason) {
    assert.doesNotThrow(() => new vm.Script(mutant), "cleanup mutation must remain syntactically valid");
    assert.throws(() => validator(mutant), (error) =>
      error instanceof assert.AssertionError && error.message.includes(expectedReason),
    `cleanup mutation must fail specifically: ${expectedReason}`);
  }

  const functionCreateStart = forcedCleanupSection.lastIndexOf("        await pool.query(",
    forcedCleanupSection.indexOf("CREATE FUNCTION"));
  const functionRegisterStart = forcedCleanupSection.indexOf('        scenarioCleanup.register("audit-function"');
  const functionCreateBlock = forcedCleanupSection.slice(functionCreateStart, functionRegisterStart);
  const withoutFunctionCreate = forcedCleanupSection.slice(0, functionCreateStart) +
    forcedCleanupSection.slice(functionRegisterStart);
  const registryStart = withoutFunctionCreate.indexOf("      const scenarioCleanup = createCleanupRegistry();");
  const functionBeforeProtection = withoutFunctionCreate.slice(0, registryStart) + functionCreateBlock +
    withoutFunctionCreate.slice(registryStart);
  expectValidSourceMutationFailure(functionBeforeProtection, assertForcedAuditCleanupSource,
    "audit function creation must occur inside active cleanup protection");

  const functionRegistrationEnd = forcedCleanupSection.lastIndexOf("        await pool.query(",
    forcedCleanupSection.indexOf("CREATE TRIGGER"));
  expectValidSourceMutationFailure(
    forcedCleanupSection.slice(0, functionRegisterStart) + forcedCleanupSection.slice(functionRegistrationEnd),
    assertForcedAuditCleanupSource, "audit function cleanup must register immediately after creation"
  );
  const triggerRegisterStart = forcedCleanupSection.indexOf('        scenarioCleanup.register("audit-trigger"');
  const triggerRegistrationEnd = forcedCleanupSection.indexOf("        const originalConsoleError", triggerRegisterStart);
  expectValidSourceMutationFailure(
    forcedCleanupSection.slice(0, triggerRegisterStart) + forcedCleanupSection.slice(triggerRegistrationEnd),
    assertForcedAuditCleanupSource, "audit trigger cleanup must register immediately after creation"
  );
  const finalFunctionBrace = forcedCleanupSection.lastIndexOf("    }");
  const sequentialFinallyMutation = forcedCleanupSection.slice(0, finalFunctionBrace) +
    "      try {} finally { await pool.query(`DROP TRIGGER`); await pool.query(`DROP FUNCTION`); }\n" +
    forcedCleanupSection.slice(finalFunctionBrace);
  expectValidSourceMutationFailure(sequentialFinallyMutation, assertForcedAuditCleanupSource,
    "audit cleanup must not use sequential unprotected finally actions");
  expectValidSourceMutationFailure(
    forcedCleanupSection.replace("() => scenarioCleanup.cleanup()", "() => legacyScenarioCleanup()"),
    assertForcedAuditCleanupSource, "scenario cleanup must use shared cleanup registry executor"
  );
  const separateAttemptMutation = source.replace(
    "function createDisposableLifecycle(options = {}) {",
    "function createDisposableLifecycle(options = {}) {\n  async function attempt(step, operation) { await operation(); }"
  );
  expectValidSourceMutationFailure(separateAttemptMutation, assertSharedCleanupPrimitiveSource,
    "outer lifecycle must not define a separate attempt executor");

  const lifecycleFactorySource = createDisposableLifecycle.toString();
  function assertInactiveEnvironmentGuard(factory) {
    const target = { DATABASE_URL: "original" };
    const candidate = factory({ environment: target, moduleCache: {}, reportCleanupFailure() {} });
    assert.throws(() => candidate.setEnvironment("DATABASE_URL", "mutated"),
      (error) => error?.code === LIFECYCLE_ORDER_ERROR,
      "environment mutation must require an active lifecycle");
    assert.equal(target.DATABASE_URL, "original");
  }
  function assertInactiveCacheGuard(factory) {
    const original = { exports: "original" };
    const target = { module: original };
    const candidate = factory({ environment: {}, moduleCache: target, reportCleanupFailure() {} });
    assert.throws(() => candidate.replaceModuleCache("module"),
      (error) => error?.code === LIFECYCLE_ORDER_ERROR,
      "module-cache mutation must require an active lifecycle");
    assert.equal(target.module, original);
  }
  function assertInactiveRestorerGuard(factory) {
    const candidate = factory({ environment: {}, moduleCache: {}, reportCleanupFailure() {} });
    assert.throws(() => candidate.addRestorer(() => {}),
      (error) => error?.code === LIFECYCLE_ORDER_ERROR,
      "hook registration must require an active lifecycle");
  }
  for (const [method, verify, reason] of [
    ["setEnvironment", assertInactiveEnvironmentGuard, "environment mutation must require an active lifecycle"],
    ["replaceModuleCache", assertInactiveCacheGuard, "module-cache mutation must require an active lifecycle"],
    ["addRestorer", assertInactiveRestorerGuard, "hook registration must require an active lifecycle"],
  ]) {
    const mutantFactory = compileLifecycleFactory(removeMethodGuard(lifecycleFactorySource, method));
    assert.throws(() => verify(mutantFactory), (error) =>
      error instanceof assert.AssertionError && error.message.includes(reason),
    `${method} guard mutation must fail for its intended behavioral reason`);
  }
  assert.doesNotMatch(source, /expectedAccessVersion:\s*Number\([^\n]*access_version[^\n]*\)\s*\+\s*1/,
    "access rollback must never submit access_version + 1");
  assert.doesNotMatch(source, /statusCode\s*>=\s*409/,
    "forced audit failures must not accept broad statuses");
  const rollbackSection = source.slice(
    source.indexOf("ROLLBACK_" + "EVIDENCE_BEGIN"),
    source.indexOf("ROLLBACK_" + "EVIDENCE_END")
  );
  assert.doesNotMatch(rollbackSection, /Promise\.all\s*\(/,
    "rollback mutations must not run concurrently against a shared row/version");
  for (const name of ["user creation", "profile update", "disable", "temporary-password replacement", "complete module-access replacement"]) {
    assert.match(rollbackSection, new RegExp(`audit failure rolls back ${name}`), `missing independent ${name} rollback scenario`);
  }
  for (const field of REQUIRED_USER_SNAPSHOT_FIELDS) {
    assert.match(USER_SNAPSHOT_SQL, new RegExp(`\\b${field}\\b`), `actual user snapshot SQL must include ${field}`);
  }
  for (const field of REQUIRED_ACCESS_SNAPSHOT_FIELDS) {
    assert.match(ACCESS_SNAPSHOT_SQL, new RegExp(`\\b${field}\\b`), `actual access snapshot SQL must include ${field}`);
  }
  for (const field of REQUIRED_AUDIT_SNAPSHOT_FIELDS) {
    assert.match(AUDIT_SNAPSHOT_SQL, new RegExp(`\\b${field}\\b`), `actual audit snapshot SQL must include ${field}`);
  }
  const rollbackBlocks = rollbackSection.split(/await t\.test\("10[a-e]\./).slice(1);
  assert.equal(rollbackBlocks.length, 5, "all five independent rollback blocks must remain present");
  for (const block of rollbackBlocks) {
    assert.match(block, /assertInternalAuditFailure\(response/,
      "each rollback block must assert the exact sanitized audit-failure response");
    assert.match(block, /assert\.deepEqual\(afterAccess, beforeAccess/,
      "each rollback block must compare complete ordered access snapshots");
    assert.match(block, /assert\.deepEqual\(afterAudit, beforeAudit/,
      "each rollback block must compare exact audit snapshots");
    assert.match(block, /assertPoolSettled\(/,
      "each rollback block must prove client return after forced failure");
  }
  assert.match(rollbackBlocks[0], /assert\.deepEqual\(afterUsers, beforeUsers/,
    "creation rollback must compare the complete user inventory");
  for (const block of rollbackBlocks.slice(1)) {
    assert.match(block, /assert\.deepEqual\(afterUser, beforeUser/,
      "each existing-user rollback must compare the complete user snapshot");
  }
  assert.match(source, /assert\.deepEqual\(response, INTERNAL_AUDIT_FAILURE_RESPONSE/,
    "forced audit failures must match the exact sanitized envelope");
});

test("Sprint 1.13 production SQL and transactions on disposable PostgreSQL", {
  skip: SKIP_REASON,
  timeout: 180_000,
}, async (t) => {
  assertSafeConfiguration();
  const pg = require("pg");
  const OriginalPool = pg.Pool;
  let control = null;
  let controlClient = null;
  let pool = null;
  const lifecycle = createDisposableLifecycle({
    async dropSchema(schema) {
      if (!controlClient) throw new Error("Control client unavailable during owned-schema cleanup");
      await controlClient.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    },
  });

  await runDisposableLifecycle(lifecycle, async () => {
    lifecycle.setEnvironment("DATABASE_URL", TEST_DATABASE_URL);
    if (!process.env.SESSION_SECRET) lifecycle.setEnvironment("SESSION_SECRET", crypto.randomBytes(32).toString("hex"));

    const TrackedProductionPool = createTrackedProductionPoolClass(OriginalPool, lifecycle);
    let pgPoolRestored = false;
    const restorePgPool = () => {
      if (pgPoolRestored) return;
      pg.Pool = OriginalPool;
      pgPoolRestored = true;
    };
    pg.Pool = TrackedProductionPool;
    lifecycle.addRestorer(restorePgPool);
    const resolvedModulePaths = PRODUCTION_MODULE_PATHS.map((modulePath) => require.resolve(modulePath));
    for (const modulePath of resolvedModulePaths) lifecycle.replaceModuleCache(modulePath);

    control = lifecycle.createPool(() => new OriginalPool({ connectionString: TEST_DATABASE_URL }), { control: true });
    controlClient = await lifecycle.acquireClient(control);
    const schema = await lifecycle.createSchema(generatedSchema(), async (owned) => {
      await controlClient.query(`CREATE SCHEMA ${quoteIdentifier(owned)}`);
    });
    pool = lifecycle.createPool(() => new OriginalPool({
      connectionString: TEST_DATABASE_URL,
      options: `-c search_path=${schema}`,
    }));

    const auth = require("../netlify/functions/_auth");
    const login = require("../netlify/functions/login");
    const admin = require("../netlify/functions/admin-users");
    const reset = require("../netlify/functions/complete-password-reset");
    const maintenance = require("../netlify/functions/maintenance");
    restorePgPool();
    for (const hooks of [auth._test, login._test, admin._test, reset._test, maintenance._test]) {
      hooks.setPool(pool);
      lifecycle.addRestorer(() => hooks.setPool(null));
    }

    const anatiId = crypto.randomUUID();
    const password = "Temporary pass 1";
    let anatiToken = "";
    function adminEvent(httpMethod, queryStringParameters = {}, body) {
      return {
        httpMethod, queryStringParameters,
        headers: { authorization: `Bearer ${anatiToken}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      };
    }
    async function seedAnati(targetPool = pool) {
      await targetPool.query(
        `INSERT INTO admin_users (user_id, username, display_name, role, status, account_type,
           is_system_account, linked_at, password_hash, must_reset_password)
         VALUES ($1, 'Anati', 'Anati', 'admin', 'active', 'system', true, now(), $2, false)
         ON CONFLICT (username) DO NOTHING`, [anatiId, login.hashPassword(password)]
      );
      anatiToken = auth.createSignedToken({
        userId: anatiId, username: "Anati", role: "admin", sessionVersion: 1,
        purpose: auth.SESSION_PURPOSE, exp: Math.floor(Date.now() / 1000) + 3600,
      });
    }
    async function createExternal(username, temporaryPassword = "") {
      return admin.handler(adminEvent("POST", {}, {
        username, displayName: username, role: "agent", status: "active",
        accountType: "external", temporaryPassword,
      }));
    }
    async function userRow(username) {
      return (await pool.query("SELECT * FROM admin_users WHERE lower(username)=lower($1)", [username])).rows[0];
    }
    function completeAccess(username, expectedAccessVersion, value = true) {
      return {
        username, expectedAccessVersion,
        access: admin._test.administrableModules.map(({ moduleKey }) => ({
          moduleKey, canView: value, canCreate: false, canEdit: false, canDelete: false,
        })),
      };
    }
    async function withFreshSchema(label, fn) {
      const child = await lifecycle.createSchema(generatedSchema(`_${label}`), async (owned) => {
        await controlClient.query(`CREATE SCHEMA ${quoteIdentifier(owned)}`);
      });
      const childPool = lifecycle.createPool(() => new OriginalPool({ connectionString: TEST_DATABASE_URL, options: `-c search_path=${child}` }));
      try { await fn(childPool); } finally {
        admin._test.setPool(pool);
        await lifecycle.closePool(childPool);
      }
    }
    async function snapshotUsers(userId = null) {
      return (await pool.query(USER_SNAPSHOT_SQL, [userId])).rows;
    }
    async function snapshotAccess(username = null) {
      return (await pool.query(ACCESS_SNAPSHOT_SQL, [username])).rows;
    }
    async function snapshotAudit(targetIds = null) {
      return (await pool.query(AUDIT_SNAPSHOT_SQL, [targetIds])).rows;
    }
    async function seedPreservedAccess(username) {
      for (const moduleKey of ["call_queue", "call-queue"]) {
        await pool.query(
          `INSERT INTO admin_module_access
             (access_id, username, module_key, can_view, can_create, can_edit, can_delete, updated_by)
           VALUES ($1, $2, $3, true, false, false, false, 'fixture')`,
          [crypto.randomUUID(), username, moduleKey]
        );
      }
    }
    const INTERNAL_AUDIT_FAILURE_RESPONSE = Object.freeze({
      statusCode: 500,
      headers: Object.freeze({
        "Content-Type": "application/json", "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      }),
      body: JSON.stringify({ ok: false, error: "Internal Server Error" }),
    });
    function assertInternalAuditFailure(response, label) {
      assert.deepEqual(response, INTERNAL_AUDIT_FAILURE_RESPONSE,
        `${label} must return the exact trusted sanitized audit-failure envelope`);
    }
    async function assertPoolSettled(label) {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(pool.waitingCount, 0, `${label} must leave no waiting pool clients`);
      assert.equal(pool.idleCount, pool.totalCount, `${label} must return every acquired pool client`);
    }
    async function withForcedAuditFailure(label, operation) {
      assert.match(label, /^[a-z]+$/);
      const functionName = `cc_s113_fail_${label}_fn`;
      const triggerName = `cc_s113_fail_${label}_trg`;
      const marker = `CC_SPRINT_113_FORCED_AUDIT_${label.toUpperCase()}`;
      assert.match(functionName, /^cc_s113_fail_[a-z]+_fn$/);
      assert.match(triggerName, /^cc_s113_fail_[a-z]+_trg$/);
      assert.match(marker, /^CC_SPRINT_113_FORCED_AUDIT_[A-Z]+$/);
      const scenarioCleanup = createCleanupRegistry();
      return runWithCleanup(async () => {
        await pool.query(
          `CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
             BEGIN RAISE EXCEPTION USING MESSAGE = '${marker}', ERRCODE = 'P0001'; END
           $$`
        );
        scenarioCleanup.register("audit-function", async () => {
          await pool.query(`DROP FUNCTION IF EXISTS "${functionName}"()`);
        });
        await pool.query(
          `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON admin_audit_logs
           FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`
        );
        scenarioCleanup.register("audit-trigger", async () => {
          await pool.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON admin_audit_logs`);
        });
        const originalConsoleError = console.error;
        let forcedFailureObserved = false;
        console.error = (...args) => {
          const error = args.find((value) => value && typeof value === "object" && value.code === "P0001");
          if (error?.message === marker) forcedFailureObserved = true;
        };
        scenarioCleanup.register("console-error", async () => { console.error = originalConsoleError; });
        const response = await operation();
        assert.equal(forcedFailureObserved, true, `${label} must reach the forced audit trigger`);
        return response;
      }, () => scenarioCleanup.cleanup(), {
        reportCleanupFailure: lifecycle.reportCleanupFailure,
        cleanupCode: "SPRINT_113_SCENARIO_CLEANUP_FAILURE",
        cleanupMessage: "Disposable PostgreSQL scenario cleanup failed",
      });
    }

    await t.test("1. empty-schema cold start with Login schema owner first", async () => {
      await withFreshSchema("login", async (child) => {
        await login._test.ensureAdminUsersTable(child);
        admin._test.setPool(child);
        await admin._test.ensureTables();
        const result = await child.query("SELECT to_regclass('admin_users') u, to_regclass('admin_module_access') a");
        assert.ok(result.rows[0].u && result.rows[0].a);
      });
    });
    await t.test("2. empty-schema cold start with Admin schema owner first", async () => {
      await withFreshSchema("admin", async (child) => {
        admin._test.setPool(child);
        await admin._test.ensureTables();
        await login._test.ensureAdminUsersTable(child);
        assert.equal((await child.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='admin_users'")).rows[0].n > 0, true);
      });
    });
    await admin._test.ensureTables();
    await seedAnati();
    await t.test("3. _auth and Maintenance remain compatible after initialization", async () => {
      assert.equal((await auth.requireValidSession(adminEvent("GET"))).username, "Anati");
      const response = await maintenance.handler(adminEvent("GET"));
      assert.equal(response.statusCode, 200);
      assert.deepEqual(JSON.parse(response.body), { maintenance: false, admin: true });
    });
    await t.test("4. concurrent case-equivalent username creation permits at most one", async () => {
      const results = await Promise.all([createExternal("CaseRace"), createExternal("caserace")]);
      assert.equal(results.filter((response) => response.statusCode === 201).length, 1);
      assert.equal((await pool.query("SELECT count(*)::int n FROM admin_users WHERE lower(username)='caserace'")).rows[0].n, 1);
    });
    await t.test("5. existing case collisions fail closed", async () => {
      await pool.query("DROP INDEX IF EXISTS idx_admin_users_username_lower");
      await pool.query("INSERT INTO admin_users(user_id,username,role,status,account_type) VALUES($1,'Collision','agent','active','external'),($2,'collision','agent','active','external')", [crypto.randomUUID(), crypto.randomUUID()]);
      assert.equal((await admin.handler(adminEvent("GET"))).statusCode, 409);
      await pool.query("DELETE FROM admin_users WHERE lower(username)='collision'");
    });
    await t.test("6-7. versioned user mutation succeeds; stale mutation changes nothing", async () => {
      assert.equal((await createExternal("VersionedUser")).statusCode, 201);
      const before = await userRow("VersionedUser");
      const body = { displayName: "Changed", role: "manager", status: "active", accountType: "external", expectedVersion: Number(before.row_version) };
      assert.equal((await admin.handler(adminEvent("PUT", { id: before.user_id }, body))).statusCode, 200);
      assert.equal((await admin.handler(adminEvent("PUT", { id: before.user_id }, { ...body, displayName: "Stale" }))).statusCode, 409);
      assert.equal((await userRow("VersionedUser")).display_name, "Changed");
    });
    await t.test("8-9. versioned access replacement succeeds; stale replacement changes nothing", async () => {
      const before = await userRow("VersionedUser");
      assert.equal((await admin.handler(adminEvent("PUT", { action: "module-access" }, completeAccess(before.username, Number(before.access_version))))).statusCode, 200);
      const count = (await pool.query("SELECT count(*)::int n FROM admin_module_access WHERE username=$1", [before.username])).rows[0].n;
      assert.equal((await admin.handler(adminEvent("PUT", { action: "module-access" }, completeAccess(before.username, Number(before.access_version), false)))).statusCode, 409);
      assert.equal((await pool.query("SELECT count(*)::int n FROM admin_module_access WHERE username=$1", [before.username])).rows[0].n, count);
    });

    // ROLLBACK_EVIDENCE_BEGIN
    await t.test("10a. audit failure rolls back user creation", async () => {
      const username = "AuditCreateRollback";
      assert.equal((await createExternal("AuditCreateSuccessControl")).statusCode, 201);
      await assertPoolSettled("creation success control");
      const beforeUsers = await snapshotUsers();
      const beforeAccess = await snapshotAccess();
      const beforeAudit = await snapshotAudit();
      const response = await withForcedAuditFailure("create", () => createExternal(username));
      assertInternalAuditFailure(response, "creation rollback");
      assert.equal(await userRow(username), undefined, "the attempted user and linkage fields must not exist");
      assert.equal((await snapshotAccess(username)).length, 0, "the attempted identity must own no access row");
      const afterUsers = await snapshotUsers();
      const afterAccess = await snapshotAccess();
      const afterAudit = await snapshotAudit();
      assert.deepEqual(afterUsers, beforeUsers, "creation rollback must preserve every unrelated user and version");
      assert.deepEqual(afterAccess, beforeAccess, "creation rollback must preserve all access rows");
      assert.deepEqual(afterAudit, beforeAudit, "creation rollback must insert no audit row");
      await assertPoolSettled("creation rollback");
    });
    await t.test("10b. audit failure rolls back profile update", async () => {
      assert.equal((await createExternal("AuditUpdateRollback")).statusCode, 201);
      const target = await userRow("AuditUpdateRollback");
      await assertPoolSettled("profile update setup success");
      await seedPreservedAccess(target.username);
      const beforeUser = await snapshotUsers(target.user_id);
      const beforeAccess = await snapshotAccess(target.username);
      const beforeAudit = await snapshotAudit([String(target.user_id), target.username]);
      const response = await withForcedAuditFailure("update", async () => {
        const current = await userRow(target.username);
        return admin.handler(adminEvent("PUT", { id: target.user_id }, {
          displayName: "Must Not Commit", role: "manager", status: "active",
          accountType: "external", expectedVersion: Number(current.row_version),
        }));
      });
      assertInternalAuditFailure(response, "profile update rollback");
      const afterUser = await snapshotUsers(target.user_id);
      const afterAccess = await snapshotAccess(target.username);
      const afterAudit = await snapshotAudit([String(target.user_id), target.username]);
      assert.deepEqual(afterUser, beforeUser, "profile rollback must preserve every user, linkage, password, and version field");
      assert.deepEqual(afterAccess, beforeAccess, "profile rollback must preserve exact access rows");
      assert.deepEqual(afterAudit, beforeAudit, "profile rollback must preserve audit count and latest identity");
      await assertPoolSettled("profile update rollback");
    });
    await t.test("10c. audit failure rolls back disable", async () => {
      assert.equal((await createExternal("AuditDisableRollback")).statusCode, 201);
      const target = await userRow("AuditDisableRollback");
      await assertPoolSettled("disable setup success");
      await seedPreservedAccess(target.username);
      const beforeUser = await snapshotUsers(target.user_id);
      const beforeAccess = await snapshotAccess(target.username);
      const beforeAudit = await snapshotAudit([String(target.user_id), target.username]);
      const response = await withForcedAuditFailure("disable", async () => {
        const current = await userRow(target.username);
        return admin.handler(adminEvent("DELETE", { id: target.user_id, version: Number(current.row_version) }));
      });
      assertInternalAuditFailure(response, "disable rollback");
      const afterUser = await snapshotUsers(target.user_id);
      const afterAccess = await snapshotAccess(target.username);
      const afterAudit = await snapshotAudit([String(target.user_id), target.username]);
      assert.deepEqual(afterUser, beforeUser, "disable rollback must preserve status, password/reset state, and every version");
      assert.deepEqual(afterAccess, beforeAccess, "disable rollback must preserve exact access rows");
      assert.deepEqual(afterAudit, beforeAudit, "disable rollback must preserve audit count and latest identity");
      await assertPoolSettled("disable rollback");
    });
    await t.test("10d. audit failure rolls back temporary-password replacement", async () => {
      assert.equal((await createExternal("AuditPasswordRollback")).statusCode, 201);
      const target = await userRow("AuditPasswordRollback");
      await assertPoolSettled("temporary-password setup success");
      await seedPreservedAccess(target.username);
      const beforeUser = await snapshotUsers(target.user_id);
      const beforeAccess = await snapshotAccess(target.username);
      const beforeAudit = await snapshotAudit([String(target.user_id), target.username]);
      const response = await withForcedAuditFailure("password", async () => {
        const current = await userRow(target.username);
        return admin.handler(adminEvent("PUT", { id: target.user_id }, {
          displayName: current.display_name, role: current.role, status: current.status,
          accountType: current.account_type, temporaryPassword: "Replacement credential 4",
          expectedVersion: Number(current.row_version),
        }));
      });
      assertInternalAuditFailure(response, "temporary-password replacement rollback");
      const afterUser = await snapshotUsers(target.user_id);
      const afterAccess = await snapshotAccess(target.username);
      const afterAudit = await snapshotAudit([String(target.user_id), target.username]);
      assert.deepEqual(afterUser, beforeUser, "password rollback must preserve hash, reset state, status, and every version");
      assert.deepEqual(afterAccess, beforeAccess, "password rollback must preserve exact access rows");
      assert.deepEqual(afterAudit, beforeAudit, "password rollback must preserve audit count and latest identity");
      await assertPoolSettled("temporary-password replacement rollback");
    });
    await t.test("10e. audit failure rolls back complete module-access replacement", async () => {
      assert.equal((await createExternal("AuditAccessRollback")).statusCode, 201);
      let target = await userRow("AuditAccessRollback");
      assert.equal((await admin.handler(adminEvent("PUT", { action: "module-access" },
        completeAccess(target.username, Number(target.access_version), true)))).statusCode, 200);
      await assertPoolSettled("module-access setup success");
      await seedPreservedAccess(target.username);
      for (const moduleKey of ["anati_admin", "anati-admin-center"]) {
        await pool.query(
          `INSERT INTO admin_module_access
             (access_id, username, module_key, can_view, can_create, can_edit, can_delete, updated_by)
           VALUES ($1, $2, $3, true, true, true, true, 'fixture')`,
          [crypto.randomUUID(), target.username, moduleKey]
        );
      }
      target = await userRow(target.username);
      const currentAccessVersion = Number(target.access_version);
      assert.equal(Number.isSafeInteger(currentAccessVersion), true);
      const beforeUser = await snapshotUsers(target.user_id);
      const beforeAccess = await snapshotAccess(target.username);
      const beforeAudit = await snapshotAudit([String(target.user_id), target.username]);
      const response = await withForcedAuditFailure("access", async () => {
        const current = await userRow(target.username);
        assert.equal(Number(current.access_version), currentAccessVersion,
          "access rollback must submit the authoritative current access version");
        return admin.handler(adminEvent("PUT", { action: "module-access" },
          completeAccess(target.username, Number(current.access_version), false)));
      });
      assertInternalAuditFailure(response, "complete module-access replacement rollback");
      const afterUser = await snapshotUsers(target.user_id);
      const afterAccess = await snapshotAccess(target.username);
      const afterAudit = await snapshotAudit([String(target.user_id), target.username]);
      assert.deepEqual(afterUser, beforeUser, "access rollback must preserve row, session, and current access versions");
      assert.deepEqual(afterAccess, beforeAccess, "access rollback must preserve the complete ordered access set and reserved aliases");
      assert.deepEqual(afterAudit, beforeAudit, "access rollback must preserve audit count and latest identity");
      await assertPoolSettled("complete module-access replacement rollback");
    });

    // ROLLBACK_EVIDENCE_END
    await t.test("11-14. reset succeeds, rejects same password/races/reuse", async () => {
      assert.equal((await createExternal("ResetUser", "Temporary reset 1")).statusCode, 201);
      const loginResponse = await login.handler({ httpMethod: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "ResetUser", password: "Temporary reset 1" }) });
      const token = JSON.parse(loginResponse.body).resetToken;
      const resetEvent = (newPassword) => ({ httpMethod: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ newPassword, confirmPassword: newPassword }) });
      assert.equal((await reset.handler(resetEvent("Temporary reset 1"))).statusCode, 400);
      const race = await Promise.all([reset.handler(resetEvent("Permanent password A")), reset.handler(resetEvent("Permanent password B"))]);
      assert.equal(race.filter((response) => response.statusCode === 200).length, 1);
      assert.equal((await reset.handler(resetEvent("Permanent password C"))).statusCode, 401);
    });
    await t.test("15. disable/version change during reset invalidates authorization", async () => {
      assert.equal((await createExternal("ResetDisable", "Temporary reset 3")).statusCode, 201);
      const loginResponse = await login.handler({ httpMethod: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "ResetDisable", password: "Temporary reset 3" }) });
      const token = JSON.parse(loginResponse.body).resetToken;
      await pool.query("UPDATE admin_users SET status='disabled', session_version=session_version+1 WHERE username='ResetDisable'");
      assert.equal((await reset.handler({ httpMethod: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ newPassword: "Permanent password D", confirmPassword: "Permanent password D" }) })).statusCode, 401);
    });
    await t.test("16. protected System and Client types reject conversion", async () => {
      for (const type of ["system", "client"]) {
        const id = crypto.randomUUID();
        await pool.query("INSERT INTO admin_users(user_id,username,role,status,account_type,is_system_account) VALUES($1,$2,'agent','active',$3,$4)", [id, `Protected${type}`, type, type === "system"]);
        const response = await admin.handler(adminEvent("PUT", { id }, { displayName: type, role: "agent", status: "active", accountType: "external", expectedVersion: 1 }));
        assert.equal(response.statusCode, 400);
        assert.equal((await pool.query("SELECT account_type FROM admin_users WHERE user_id=$1", [id])).rows[0].account_type, type);
      }
    });
    await t.test("17. employee link is locked and revalidated inside the transaction", async () => {
      await pool.query("CREATE TABLE IF NOT EXISTS employees(employee_id uuid primary key, full_name text, status text)");
      const employeeId = crypto.randomUUID();
      await pool.query("INSERT INTO employees VALUES($1,'Race Employee','active')", [employeeId]);
      const locker = await pool.connect();
      try {
        await locker.query("BEGIN");
        await locker.query("SELECT * FROM employees WHERE employee_id=$1 FOR UPDATE", [employeeId]);
        const pending = admin.handler(adminEvent("POST", {}, { username: "LinkRace", role: "agent", status: "active", accountType: "employee", employeeId }));
        await locker.query("UPDATE employees SET status='disabled' WHERE employee_id=$1", [employeeId]);
        await locker.query("COMMIT");
        assert.equal((await pending).statusCode, 400);
      } finally { locker.release(); }
      assert.equal(await userRow("LinkRace"), undefined);
    });
    await t.test("18-19. Call Queue aliases and historical Admin rows are preserved without authority", async () => {
      const target = await userRow("VersionedUser");
      const reserved = ["call_queue", "call-queue", "anati_admin", "anati-admin-center"];
      for (const key of reserved) await pool.query("INSERT INTO admin_module_access(access_id,username,module_key,can_view) VALUES($1,$2,$3,true)", [crypto.randomUUID(), target.username, key]);
      const before = await pool.query("SELECT module_key,can_view FROM admin_module_access WHERE username=$1 AND module_key=ANY($2::text[]) ORDER BY module_key", [target.username, reserved]);
      assert.equal((await admin.handler(adminEvent("PUT", { action: "module-access" }, completeAccess(target.username, Number((await userRow(target.username)).access_version), false)))).statusCode, 200);
      const after = await pool.query("SELECT module_key,can_view FROM admin_module_access WHERE username=$1 AND module_key=ANY($2::text[]) ORDER BY module_key", [target.username, reserved]);
      assert.deepEqual(after.rows, before.rows);
      const userToken = auth.createSignedToken({ userId: target.user_id, username: target.username, role: target.role, sessionVersion: Number(target.session_version), purpose: auth.SESSION_PURPOSE, exp: Math.floor(Date.now() / 1000) + 600 });
      const mine = await admin.handler({ httpMethod: "GET", queryStringParameters: { "my-access": "1" }, headers: { authorization: `Bearer ${userToken}` } });
      assert.equal(JSON.parse(mine.body).access.some((row) => row.moduleKey === "anati_admin"), false);
    });
    await t.test("20. duplicate historical access rows fail closed", async () => {
      const target = await userRow("VersionedUser");
      await pool.query("DROP INDEX IF EXISTS idx_admin_module_access_username_module");
      await pool.query("INSERT INTO admin_module_access(access_id,username,module_key,can_view) VALUES($1,$2,'dashboard',true)", [crypto.randomUUID(), target.username]);
      const userToken = auth.createSignedToken({ userId: target.user_id, username: target.username, role: target.role, sessionVersion: Number(target.session_version), purpose: auth.SESSION_PURPOSE, exp: Math.floor(Date.now() / 1000) + 600 });
      await assert.rejects(() => auth.requireModuleAccess({ headers: { authorization: `Bearer ${userToken}` } }, "dashboard"), (error) => error.statusCode === 409);
    });
    await t.test("21. transaction clients return to the pool after success and failure", async () => {
      await assertPoolSettled("final transaction ownership check");
    });
  });
});

module.exports = { createDisposableLifecycle, runDisposableLifecycle };
