const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const vm = require("node:vm");

process.env.SESSION_SECRET = "sprint-1-13-test-secret-with-sufficient-entropy";
process.env.DATABASE_URL = "postgres://sprint-1-13.invalid/disposable-test-placeholder";

const originalLoad = Module._load;
Module._load = function mockPg(request, parent, isMain) {
  if (request === "pg") return { Pool: class Pool {} };
  return originalLoad.call(this, request, parent, isMain);
};

const ROOT = path.resolve(__dirname, "..");
const auth = require("../netlify/functions/_auth");
const login = require("../netlify/functions/login");
const reset = require("../netlify/functions/complete-password-reset");
const admin = require("../netlify/functions/admin-users");
const maintenance = require("../netlify/functions/maintenance");
const http = require("../netlify/functions/_http");
Module._load = originalLoad;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const now = () => Math.floor(Date.now() / 1000);

function token(overrides = {}) {
  return auth.createSignedToken({
    userId: USER_ID,
    username: "Worker",
    role: "agent",
    sessionVersion: 3,
    purpose: auth.SESSION_PURPOSE,
    exp: now() + 300,
    ...overrides,
  });
}

function eventWith(tokenValue, extra = {}) {
  const headers = {
    ...(tokenValue ? { authorization: `Bearer ${tokenValue}` } : {}),
    ...(extra.httpMethod === "POST" ? { "content-type": "application/json" } : {}),
    ...(extra.headers || {}),
  };
  return { ...extra, headers };
}

function accountPool(row, accessRows = []) {
  return {
    async query(sql) {
      if (sql.includes("FROM admin_users")) return { rows: row ? [row] : [] };
      if (sql.includes("FROM admin_module_access")) return { rows: accessRows };
      throw new Error("Unexpected query");
    },
  };
}

test("normal sessions revalidate current account identity, role, status, and version", async () => {
  const row = {
    user_id: USER_ID, username: "Worker", role: "agent", status: "active",
    session_version: 3, must_reset_password: false,
  };
  auth._test.setPool(accountPool(row));
  assert.equal((await auth.requireValidSession(eventWith(token()))).username, "Worker");

  for (const [name, changed] of [
    ["disabled", { status: "disabled" }],
    ["role changed", { role: "manager" }],
    ["version stale", { session_version: 4 }],
    ["identity changed", { username: "Other" }],
  ]) {
    auth._test.setPool(accountPool({ ...row, ...changed }));
    await assert.rejects(auth.requireValidSession(eventWith(token())), (error) => {
      assert.equal(error.statusCode, 401, name);
      return true;
    });
  }
  auth._test.setPool(accountPool({ ...row, must_reset_password: true }));
  await assert.rejects(auth.requireValidSession(eventWith(token())), { statusCode: 401 });
});

test("missing, invalid, expired, unversioned, reset-purpose, and database-failure tokens fail closed", async () => {
  const row = { user_id: USER_ID, username: "Worker", role: "agent", status: "active", session_version: 3 };
  auth._test.setPool(accountPool(row));
  const cases = [
    eventWith(""),
    eventWith("invalid"),
    eventWith(token({ exp: now() - 1 })),
    eventWith(auth.createSignedToken({ userId: USER_ID, username: "Worker", role: "agent", purpose: auth.SESSION_PURPOSE, exp: now() + 30 })),
    eventWith(token({ purpose: auth.RESET_PURPOSE })),
  ];
  for (const request of cases) await assert.rejects(auth.requireValidSession(request), { statusCode: 401 });

  auth._test.setPool({ async query() { throw new Error("offline"); } });
  await assert.rejects(auth.requireValidSession(eventWith(token())), { statusCode: 503 });
});

test("Anati ownership and module actions are decided from authoritative rows", async () => {
  const anati = { user_id: USER_ID, username: "Anati", role: "admin", status: "active", session_version: 3 };
  auth._test.setPool(accountPool(anati));
  await auth.requireAnatiSession(eventWith(token({ username: "Anati", role: "admin" })));

  const otherAdmin = { ...anati, username: "Other Admin" };
  auth._test.setPool(accountPool(otherAdmin));
  await assert.rejects(
    auth.requireAnatiSession(eventWith(token({ username: "Other Admin", role: "admin" }))),
    { statusCode: 403 }
  );

  const worker = { ...anati, username: "Worker", role: "agent" };
  auth._test.setPool(accountPool(worker, [{ module_key: "attendance", can_view: true, can_edit: false }]));
  await auth.requireModuleAccess(eventWith(token()), "attendance", "view");
  await assert.rejects(auth.requireModuleAccess(eventWith(token()), "attendance", "edit"), { statusCode: 403 });
  await assert.rejects(auth.requireModuleAccess(eventWith(token()), "training", "view"), { statusCode: 403 });
  auth._test.setPool(accountPool(worker, [{ module_key: "anati_admin", can_view: true, can_create: true, can_edit: true, can_delete: true }]));
  await assert.rejects(auth.requireModuleAccess(eventWith(token()), "anati_admin", "view"), { statusCode: 403 });
});

test("Admin input contracts reject unsupported identities, weak passwords, and malformed access replacement", () => {
  assert.throws(() => admin._test.normalizeUserBody({ username: "x", accountType: "client" }), /Invalid accountType/);
  assert.throws(() => admin._test.normalizeTemporaryPassword("short"), /at least 12/);
  assert.throws(() => admin._test.normalizeTemporaryPassword("            "), /cannot be blank/);
  assert.equal(admin._test.normalizeTemporaryPassword("long password"), "long password");
  assert.equal(admin._test.administrableModules.some((entry) => entry.moduleKey === "call_queue"), false);
  assert.equal(admin._test.administrableModules.some((entry) => entry.moduleKey === "anati_admin"), false);
  assert.equal(admin._test.isReservedModuleKey("call-queue"), true);
  assert.equal(admin._test.isReservedModuleKey("anati-admin-center"), true);
  assert.equal(admin._test.isReservedModuleKey("  CALL_QUEUE  "), true);
  assert.equal(admin._test.isReservedModuleKey("ANATI_ADMIN"), true);

  const full = admin._test.administrableModules.map((entry) => ({
    moduleKey: entry.moduleKey, canView: false, canCreate: false, canEdit: false, canDelete: false,
  }));
  assert.equal(admin._test.normalizeAccessBody({ username: "Worker", expectedAccessVersion: 2, access: full }).access.length, full.length);
  assert.throws(() => admin._test.normalizeAccessBody({
    username: "Worker", expectedAccessVersion: 2, access: [...full, full[0]],
  }), /Duplicate moduleKey/);
  assert.throws(() => admin._test.normalizeAccessBody({
    username: "Worker", expectedAccessVersion: 2,
    access: full.map((entry, index) => index ? entry : { ...entry, canView: "true" }),
  }), /must be a boolean/);
  assert.throws(() => admin._test.normalizeAccessBody({
    username: "Worker", expectedAccessVersion: 2,
    access: [...full.slice(1), { ...full[0], moduleKey: "call_queue" }],
  }), /Invalid moduleKey/);
  assert.throws(() => admin._test.assertPreservedAccountType({ accountType: "system" }, "external"), /cannot be changed/);
  assert.throws(() => admin._test.assertPreservedAccountType({ accountType: "client" }, "employee"), /cannot be changed/);
});

test("production Admin handler excludes historical reserved Admin authority for non-Anati", async () => {
  const worker = { user_id: USER_ID, username: "Worker", role: "agent", status: "active", session_version: 3, must_reset_password: false };
  auth._test.setPool(accountPool(worker));
  let reservedPredicate = false;
  admin._test.setPool({
    async query(sql, params = []) {
      if (sql.includes("CREATE TABLE IF NOT EXISTS admin_users")) return { rows: [] };
      if (sql.includes("GROUP BY lower(username)")) return { rows: [] };
      if (sql.includes("FROM admin_module_access")) {
        reservedPredicate = sql.includes("<> ALL") && params[1].includes("anati_admin") && params[1].includes("anati-admin-center");
        return { rows: [] };
      }
      throw new Error(`Unexpected Admin query: ${sql.slice(0, 40)}`);
    },
  });
  const response = await admin.handler(eventWith(token(), { httpMethod: "GET", queryStringParameters: { "my-access": "1" } }));
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).access.some((entry) => entry.moduleKey === "anati_admin"), false);
  assert.equal(reservedPredicate, true);
});

test("production Admin handler rejects crafted System conversion before update or audit", async () => {
  const anati = { user_id: USER_ID, username: "Anati", role: "admin", status: "active", session_version: 3, must_reset_password: false };
  auth._test.setPool(accountPool(anati));
  const state = { updates: 0, audits: 0, rollbacks: 0, releases: 0 };
  const targetId = "22222222-2222-4222-8222-222222222222";
  const client = {
    async query(sql) {
      if (sql === "BEGIN") return { rows: [] };
      if (sql === "ROLLBACK") { state.rollbacks += 1; return { rows: [] }; }
      if (sql.includes("to_regclass")) return { rows: [{ table_name: null }] };
      if (sql.includes("FROM admin_users u")) return { rows: [{
        user_id: targetId, username: "System Agent", role: "agent", status: "active",
        account_type: "system", is_system_account: true, row_version: 2, access_version: 1,
      }] };
      if (sql.includes("UPDATE admin_users")) { state.updates += 1; return { rows: [] }; }
      if (sql.includes("INSERT INTO admin_audit_logs")) { state.audits += 1; return { rows: [] }; }
      throw new Error(`Unexpected transaction query: ${sql.slice(0, 40)}`);
    },
    release() { state.releases += 1; },
  };
  admin._test.setPool({
    async query(sql) {
      if (sql.includes("CREATE TABLE IF NOT EXISTS admin_users")) return { rows: [] };
      if (sql.includes("GROUP BY lower(username)")) return { rows: [] };
      throw new Error(`Unexpected pool query: ${sql.slice(0, 40)}`);
    },
    async connect() { return client; },
  });
  const response = await admin.handler(eventWith(token({ username: "Anati", role: "admin" }), {
    httpMethod: "PUT", queryStringParameters: { id: targetId },
    body: JSON.stringify({ username: "System Agent", role: "agent", status: "active", accountType: "external", expectedVersion: 2 }),
  }));
  assert.equal(response.statusCode, 400);
  assert.deepEqual({ updates: state.updates, audits: state.audits, rollbacks: state.rollbacks, releases: state.releases },
    { updates: 0, audits: 0, rollbacks: 1, releases: 1 });
});

test("identity-link validation uses and locks through the supplied transaction client", async () => {
  const calls = [];
  const client = { async query(sql) {
    calls.push(sql);
    if (sql.includes("to_regclass")) return { rows: [{ table_name: "employees" }] };
    if (sql.includes("FROM employees")) return { rows: [{ employee_id: USER_ID, full_name: "Worker" }] };
    throw new Error("Unexpected link query");
  } };
  const result = await admin._test.prepareUserLink({ accountType: "employee", employeeId: USER_ID }, {}, client);
  assert.equal(result.employeeId, USER_ID);
  assert.equal(calls.some((sql) => sql.includes("FOR UPDATE")), true);
});

test("temporary credentials issue reset-only authorization and never a normal session", async () => {
  const password = "temporary password";
  const user = {
    user_id: USER_ID, username: "Worker", role: "agent", status: "active",
    session_version: 6, must_reset_password: true, password_hash: login.hashPassword(password),
  };
  login._test.setPool({
    async query(sql) {
      if (sql.includes("SELECT user_id")) return { rows: [user] };
      return { rows: [] };
    },
  });
  const response = await login.handler({ httpMethod: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "worker", password }) });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.resetRequired, true);
  assert.equal(Object.hasOwn(body, "sessionToken"), false);
  assert.equal(auth.verifySignedToken(body.resetToken, auth.RESET_PURPOSE).sessionVersion, 6);
  assert.equal(auth.verifySignedToken(body.resetToken, auth.SESSION_PURPOSE), null);
  assert.equal(response.body.includes(password), false);
  assert.equal(response.body.includes(user.password_hash), false);
});

test("password completion is atomic, validates policy, and makes reset authorization single use", async () => {
  const resetToken = token({ purpose: auth.RESET_PURPOSE, sessionVersion: 6 });
  const temporaryPassword = "temporary password";
  const state = { mustReset: true, version: 6, commits: 0, audits: [], passwordHash: login.hashPassword(temporaryPassword) };
  const client = {
    async query(sql, params = []) {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql === "COMMIT") { state.commits += 1; return { rows: [] }; }
      if (sql.includes("ALTER TABLE") || sql.includes("CREATE TABLE")) return { rows: [] };
      if (sql.includes("SELECT user_id")) return { rows: [{
        user_id: USER_ID, username: "Worker", role: "agent", status: "active",
        must_reset_password: state.mustReset, session_version: state.version, password_hash: state.passwordHash,
      }] };
      if (sql.includes("UPDATE admin_users")) {
        state.mustReset = false;
        state.version += 1;
        return { rows: [{ session_version: state.version }] };
      }
      if (sql.includes("INSERT INTO admin_audit_logs")) { state.audits.push(params); return { rows: [] }; }
      throw new Error("Unexpected query");
    },
    release() {},
  };
  reset._test.setPool({ async connect() { return client; } });

  const mismatch = await reset.handler(eventWith("", { httpMethod: "POST", body: JSON.stringify({ newPassword: "long password", confirmPassword: "different one" }) }));
  assert.equal(mismatch.statusCode, 401, "authorization is checked before password details");

  const request = eventWith(resetToken, {
    httpMethod: "POST",
    body: JSON.stringify({ newPassword: "new secure password", confirmPassword: "new secure password" }),
  });
  const success = await reset.handler(request);
  assert.equal(success.statusCode, 200);
  assert.equal(state.commits, 1);
  assert.equal(state.audits.length, 1);
  assert.equal(JSON.stringify(state.audits).includes("new secure password"), false);
  assert.equal((await reset.handler(request)).statusCode, 401);
  assert.deepEqual(reset._test.validatePassword("short", "short"), { field: "newPassword", message: "Use at least 12 characters." });
  assert.equal(reset._test.validatePassword("valid password", "different value").field, "confirmPassword");
});

test("same temporary password is rejected without mutation, version change, audit, or token consumption", async () => {
  const resetToken = token({ purpose: auth.RESET_PURPOSE, sessionVersion: 6 });
  const temporaryPassword = "temporary password";
  const state = { updates: 0, audits: 0, rollbacks: 0, releases: 0 };
  const client = {
    async query(sql) {
      if (sql === "BEGIN") return { rows: [] };
      if (sql === "ROLLBACK") { state.rollbacks += 1; return { rows: [] }; }
      if (sql.includes("ALTER TABLE") || sql.includes("CREATE TABLE")) return { rows: [] };
      if (sql.includes("SELECT user_id")) return { rows: [{
        user_id: USER_ID, username: "Worker", role: "agent", status: "active",
        must_reset_password: true, session_version: 6, password_hash: login.hashPassword(temporaryPassword),
      }] };
      if (sql.includes("UPDATE admin_users")) { state.updates += 1; return { rows: [] }; }
      if (sql.includes("INSERT INTO admin_audit_logs")) { state.audits += 1; return { rows: [] }; }
      throw new Error("Unexpected query");
    },
    release() { state.releases += 1; },
  };
  reset._test.setPool({ async connect() { return client; } });
  const request = eventWith(resetToken, { httpMethod: "POST", body: JSON.stringify({ newPassword: temporaryPassword, confirmPassword: temporaryPassword }) });
  const first = await reset.handler(request);
  const second = await reset.handler(request);
  assert.equal(first.statusCode, 400);
  assert.equal(second.statusCode, 400, "reset token remains usable after same-password rejection");
  assert.equal(JSON.parse(first.body).fieldErrors.newPassword.includes("different"), true);
  assert.deepEqual({ updates: state.updates, audits: state.audits }, { updates: 0, audits: 0 });
  assert.equal(state.rollbacks, 2);
  assert.equal(state.releases, 2);
});

test("reset connection rejection is a sanitized 503 and acquires no transaction", async () => {
  const resetToken = token({ purpose: auth.RESET_PURPOSE, sessionVersion: 6 });
  reset._test.setPool({ async connect() { throw new Error("postgres://secret-host/internal"); } });
  const response = await reset.handler(eventWith(resetToken, {
    httpMethod: "POST",
    body: JSON.stringify({ newPassword: "new secure password", confirmPassword: "new secure password" }),
  }));
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.includes("secret-host"), false);
});

test("Maintenance GET exemption and POST mutation are Anati-only", async () => {
  let maintenanceValue = "1";
  maintenance._test.setPool({
    async query(sql, params = []) {
      if (sql.includes("SELECT value")) return { rows: [{ value: maintenanceValue }] };
      if (sql.includes("INSERT INTO app_settings")) { maintenanceValue = params[1]; return { rows: [] }; }
      return { rows: [] };
    },
  });
  const anati = { user_id: USER_ID, username: "Anati", role: "admin", status: "active", session_version: 3 };
  auth._test.setPool(accountPool(anati));
  const anatiToken = token({ username: "Anati", role: "admin" });
  const get = await maintenance.handler(eventWith(anatiToken, { httpMethod: "GET" }));
  assert.deepEqual(JSON.parse(get.body), { maintenance: true, admin: true });
  assert.equal((await maintenance.handler(eventWith(anatiToken, { httpMethod: "POST", body: '{"maintenance":false}' }))).statusCode, 200);

  auth._test.setPool(accountPool({ ...anati, username: "Other Admin" }));
  const other = token({ username: "Other Admin", role: "admin" });
  assert.equal(JSON.parse((await maintenance.handler(eventWith(other, { httpMethod: "GET" }))).body).admin, false);
  assert.equal((await maintenance.handler(eventWith(other, { httpMethod: "POST", body: '{"maintenance":true}' }))).statusCode, 403);
});

test("credential request envelopes reject method, media type, missing, malformed, scalar, and oversized bodies", async () => {
  login._test.setPool({ async query() { throw new Error("database must not be reached"); } });
  const cases = [
    [{ httpMethod: "GET", headers: {} }, 405],
    [{ httpMethod: "POST", headers: {}, body: "{}" }, 415],
    [{ httpMethod: "POST", headers: { "content-type": "application/json" } }, 400],
    [{ httpMethod: "POST", headers: { "content-type": "application/json" }, body: "{" }, 400],
    [{ httpMethod: "POST", headers: { "content-type": "application/json" }, body: "[]" }, 400],
    [{ httpMethod: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "u", password: "x".repeat(http.MAX_CREDENTIAL_BODY_BYTES) }) }, 413],
  ];
  for (const [request, status] of cases) assert.equal((await login.handler(request)).statusCode, status);
  assert.equal((await login.handler({ httpMethod: "OPTIONS", headers: {} })).statusCode, 204);
});

test("Maintenance state failure is unavailable and POST envelope failures do not mutate", async () => {
  maintenance._test.setPool({ async query() { throw new Error("private database hostname"); } });
  const get = await maintenance.handler({ httpMethod: "GET", headers: {} });
  assert.equal(get.statusCode, 500);
  assert.equal(get.body.includes("hostname"), false);

  const anati = { user_id: USER_ID, username: "Anati", role: "admin", status: "active", session_version: 3, must_reset_password: false };
  auth._test.setPool(accountPool(anati));
  maintenance._test.setPool({ async query(sql) {
    if (sql.includes("CREATE TABLE")) return { rows: [] };
    if (sql.includes("SELECT value")) return { rows: [{ value: "0" }] };
    throw new Error("mutation must not execute");
  } });
  const response = await maintenance.handler(eventWith(token({ username: "Anati", role: "admin" }), {
    httpMethod: "POST", headers: { "content-type": "text/plain" }, body: "{}",
  }));
  assert.equal(response.statusCode, 415);
});

test("permission cache expires, revalidates on singleton lifecycle events, and rejects stale overlap", async () => {
  const source = fs.readFileSync(path.join(ROOT, "js/permissions.js"), "utf8");
  let clock = 1_000;
  const requests = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  const protectedControl = { hidden: false, disabled: false };
  const document = {
    visibilityState: "visible",
    documentElement: {},
    body: { dataset: {}, insertBefore() {} },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    querySelectorAll() { return [protectedControl]; },
    querySelector() { return this.body; },
    getElementById() { return null; },
    createElement() { return { setAttribute() {}, textContent: "" }; },
  };
  const context = {
    console: { warn() {} },
    document,
    sessionStorage: { getItem(key) { return key === "cc_token" ? "token" : ""; } },
    MutationObserver: class { observe() {} },
    Date: class extends Date { static now() { return clock; } },
    fetch() {
      return new Promise((resolve, reject) => requests.push({ resolve, reject }));
    },
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    location: { href: "" },
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: "permissions-runtime.js" });
  const valid = (canView = true) => ({
    ok: true, status: 200,
    async json() { return { ok: true, unavailable: false, legacyFallback: false, hasConfiguredAccess: true,
      access: [{ moduleKey: "attendance", canView, canCreate: true, canEdit: true, canDelete: false }] }; },
  });

  const first = context.CCPermissions.getMyAccessModel();
  requests.shift().resolve(valid(true));
  const firstModel = await first;
  assert.equal(firstModel.available, true);
  assert.equal(await context.CCPermissions.getMyAccessModel(), firstModel);
  assert.equal(requests.length, 0, "fresh model is cached");

  clock += context.CCPermissions.cacheTtlMs + 1;
  const expired = context.CCPermissions.getMyAccessModel();
  assert.equal(requests.length, 1, "expiry starts authoritative revalidation");
  requests.shift().resolve(valid(true));
  await expired;

  context.CC_PAGE_MODULE_KEY = "attendance";
  context.CC_PAGE_ACCESS = { moduleKey: "attendance", canView: true, canCreate: true, canEdit: true, canDelete: false };
  windowListeners.get("focus")();
  documentListeners.get("visibilitychange")();
  await Promise.resolve();
  assert.equal(requests.length, 1, "focus and visibility coalesce into one request");
  assert.equal(protectedControl.hidden, true, "stale allow is disabled during refresh");
  requests.shift().resolve(valid(true));
  await new Promise((resolve) => setImmediate(resolve));

  const older = context.CCPermissions.getMyAccessModel({ force: true });
  const olderRequest = requests.shift();
  const newer = context.CCPermissions.getMyAccessModel({ force: true });
  const newerRequest = requests.shift();
  newerRequest.resolve(valid(false));
  assert.equal((await newer).access[0].canView, false);
  olderRequest.resolve(valid(true));
  assert.equal((await older).reason, "superseded-permission-response");
  assert.equal((await context.CCPermissions.getMyAccessModel()).access[0].canView, false,
    "older completion cannot overwrite the newer model");

  const failed = context.CCPermissions.getMyAccessModel({ force: true });
  requests.shift().resolve({ ok: false, status: 503, async json() { return {}; } });
  assert.equal((await failed).available, false);
  const retried = context.CCPermissions.getMyAccessModel();
  assert.equal(requests.length, 1, "unavailable models are not cached");
  requests.shift().resolve(valid(true));
  assert.equal((await retried).available, true);
});

test("real login frontend clears an existing normal session before and during reset-only mode", async () => {
  const html = fs.readFileSync(path.join(ROOT, "login.html"), "utf8");
  const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1]).sort((a, b) => b.length - a.length)[0];
  class Storage {
    constructor() { this.values = new Map([['cc_auth', '1'], ['cc_user', 'Old'], ['cc_role', 'admin'], ['cc_token', 'old-token']]); }
    getItem(key) { return this.values.get(key) || null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
  }
  class Element {
    constructor(id) {
      this.id = id; this.value = ""; this.hidden = false; this.disabled = false; this.required = false;
      this.textContent = ""; this.style = {}; this.dataset = {}; this.listeners = new Map();
      this.classList = { add() {}, remove() {} };
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    focus() {}
    reset() { for (const element of elements.values()) if ('value' in element) element.value = ""; }
  }
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  const title = new Element("title");
  const subtitle = new Element("subtitle");
  const windowListeners = new Map();
  const localStorage = new Storage();
  const sessionStorage = new Storage();
  const responses = [
    { ok: true, status: 200, async json() { return { resetRequired: true, resetToken: "reset-only-secret" }; } },
    { ok: false, status: 401, async json() { return { error: "Password reset authorization is invalid or expired" }; } },
  ];
  const fetchCalls = [];
  const context = {
    document: {
      getElementById: get,
      querySelector(selector) { return selector === ".title" ? title : subtitle; },
      querySelectorAll() { return []; },
    },
    localStorage, sessionStorage, URLSearchParams,
    fetch: async (url, options) => { fetchCalls.push({ url, options }); return responses.shift(); },
    setTimeout(callback) { callback(); },
    location: { search: "", href: "" },
    addEventListener(type, listener) { windowListeners.set(type, listener); },
  };
  context.window = context;
  vm.runInNewContext(script, context, { filename: "login-frontend.js" });
  get("username").value = "Reset User";
  get("password").value = "temporary";
  await get("form").listeners.get("submit")({ preventDefault() {} });
  for (const storage of [localStorage, sessionStorage]) {
    for (const key of ["cc_auth", "cc_user", "cc_role", "cc_token"]) assert.equal(storage.getItem(key), null);
    assert.equal([...storage.values.values()].includes("reset-only-secret"), false);
  }
  assert.equal(get("reset-fields").hidden, false);
  get("new-password").value = "Permanent pass 123";
  get("confirm-password").value = "Permanent pass 123";
  await get("form").listeners.get("submit")({ preventDefault() {} });
  assert.equal(fetchCalls[1].options.headers.Authorization, "Bearer reset-only-secret");
  assert.equal(get("reset-fields").hidden, true, "401 exits reset mode and clears in-memory reset authority");
  windowListeners.get("pagehide")();
});

test("Admin and login UI encode fail-closed initialization, concurrency, accessibility, and deferred scope", () => {
  const adminHtml = fs.readFileSync(path.join(ROOT, "anati-admin.html"), "utf8");
  const loginHtml = fs.readFileSync(path.join(ROOT, "login.html"), "utf8");
  const permissions = fs.readFileSync(path.join(ROOT, "js/permissions.js"), "utf8");
  assert.match(adminHtml, /await window\.CCPermissions\?\.requirePageAccess\("anati_admin", \{ force: true \}\)/);
  assert.ok(adminHtml.indexOf("requirePageAccess") < adminHtml.lastIndexOf("await loadAdminCenter"));
  assert.match(adminHtml, /expectedAccessVersion/);
  assert.match(adminHtml, /expectedVersion/);
  assert.match(adminHtml, /data-reactivate-user/);
  assert.match(adminHtml, /aria-live="polite"/);
  assert.match(adminHtml, /min-height:44px/);
  assert.match(adminHtml, /Maintenance remains controlled only by Anati from the existing application topbar/);
  assert.doesNotMatch(adminHtml, /moduleKey[^\n]*call_queue/);
  assert.match(loginHtml, /Create a new password/);
  assert.match(loginHtml, /aria-busy/);
  assert.match(loginHtml, /minlength="12"/);
  assert.match(loginHtml, /clearNormalSession\(\);[\s\S]*resetToken = data\.resetToken/);
  assert.match(loginHtml, /pagehide[\s\S]*resetToken = ''/);
  assert.match(permissions, /available: false/);
  assert.match(permissions, /ACCESS_CACHE_TTL_MS = 30 \* 1000/);
  assert.doesNotMatch(permissions, /legacyFallback:\s*true|fullAccess/);
});

test("acceptance documents distinguish original PostgreSQL evidence from the corrected successful rerun", () => {
  const architecture = fs.readFileSync(
    path.join(ROOT, "docs/architecture/CLOUD_CROWD_UI_ARCHITECTURE_V1.md"), "utf8"
  );
  const ledger = fs.readFileSync(
    path.join(ROOT, "docs/decisions/CLOUD_CROWD_DECISION_LEDGER.md"), "utf8"
  );
  const staleUrlBlockedClaim = /\b(?:PostgreSQL\s+acceptance|acceptance|the\s+suite)\s+(?:is\s+|remains\s+|was\s+)?(?:blocked|open|pending|unexecuted|not\s+executed)\b[^.\n]*(?:because|due\s+to)[^.\n]*(?:CC_SPRINT_113_TEST_DATABASE_URL|(?:disposable\s+)?URL|(?:disposable\s+database\s+)?(?:environment\s+variable|credential))[^.\n]*(?:unavailable|absent|not\s+configured)\b/i;
  function assertOneDocument(document, label) {
    assert.match(document, /19 child PostgreSQL test results cover the 21 numbered production scenarios/,
      `${label} must reconcile 19 child results with 21 numbered scenarios`);
    assert.match(document, /one parent PostgreSQL test result records completion of the PostgreSQL parent/,
      `${label} must explain the parent PostgreSQL test result`);
    assert.match(document, /two top-level deterministic lifecycle\/mutation-resistance test results complete the total/,
      `${label} must explain the two top-level deterministic results`);
    assert.match(document, /(?:corrected user-run|user-run corrected) disposable-PostgreSQL summary was 22 tests, 22 passed, 0 failed, and 0 skipped/i,
      `${label} must record the corrected dedicated summary exactly`);
    assert.match(document, /PostgreSQL-enabled canonical run completed with 816 tests, 815 passed, 0 failed, and one unrelated existing opt-in adapter skip/i,
      `${label} must record the corrected canonical evidence exactly`);
  }
  function assertDocumentation(nextArchitecture, nextLedger) {
    assertOneDocument(nextArchitecture, "architecture");
    assertOneDocument(nextLedger, "decision ledger");
    const documents = `${nextArchitecture}\n${nextLedger}`;
    assert.doesNotMatch(documents, /PostgreSQL acceptance has not run|suite is present but unexecuted|has not been executed in this workspace/i,
      "documents must not erase the original disposable PostgreSQL execution");
    assert.doesNotMatch(documents, staleUrlBlockedClaim,
      "documents must reject stale URL-blocked acceptance language");
    assert.match(documents, /16 passed, 0 failed, 0 skipped/,
      "documents must retain the original dedicated-suite result");
    assert.match(documents, /all 21 named PostgreSQL scenarios/i,
      "documents must retain the original scenario coverage claim and its later qualification");
    assert.match(documents, /809 tests, 808 passed, 0 failed, and one unrelated existing opt-in skip/i,
      "documents must retain the original PostgreSQL-enabled canonical result");
    assert.match(documents, /could accept (?:an optimistic-conflict|the wrong failure) path/i,
      "documents must disclose the independently reviewed rollback-evidence defect");
    assert.match(documents, /early[- ]cleanup|setup begun before the outer cleanup guard/i,
      "documents must disclose the independently reviewed lifecycle defect");
    assert.match(documents, /independent (?:final )?approval[^.]*pending|before independent final approval/i);
    assert.match(documents, /real-browser acceptance[^.]*deferred/i);
    assert.match(documents, /deployment[^.]*deferred/i);
    assert.match(documents, /production migration[^.]*deferred/i);
    assert.match(documents, /no production or staging database was used|not production or staging/i);
    assert.match(documents, /Sprint 1\.12 Call Queue remains disabled and deferred/i);
    assert.doesNotMatch(documents, /independent (?:final )?approval (?:is )?(?:complete|granted)|independently approved/i,
      "documents must not turn corrected execution evidence into independent approval");
  }
  function expectMutationFailure(nextArchitecture, nextLedger, expectedReason) {
    assert.throws(() => assertDocumentation(nextArchitecture, nextLedger), (error) =>
      error instanceof assert.AssertionError && error.message.includes(expectedReason),
    `documentation mutation must fail specifically: ${expectedReason}`);
  }

  assertDocumentation(architecture, ledger);
  expectMutationFailure(
    architecture.replace("19 child PostgreSQL test results cover the 21 numbered production scenarios", "reconciliation removed"),
    ledger,
    "architecture must reconcile 19 child results with 21 numbered scenarios"
  );
  expectMutationFailure(architecture, ledger.replaceAll(
    "19 child PostgreSQL test results cover the 21 numbered production scenarios", "reconciliation removed"
  ), "decision ledger must reconcile 19 child results with 21 numbered scenarios");
  for (const corrupted of [18, 20]) {
    expectMutationFailure(architecture.replace("19 child PostgreSQL test results", `${corrupted} child PostgreSQL test results`), ledger,
      "architecture must reconcile 19 child results with 21 numbered scenarios");
  }
  expectMutationFailure(architecture.replace("the 21 numbered production scenarios", "the 20 numbered production scenarios"), ledger,
    "architecture must reconcile 19 child results with 21 numbered scenarios");
  expectMutationFailure(architecture.replace(
    "one parent PostgreSQL test result records completion of the PostgreSQL parent", "parent explanation removed"
  ), ledger, "architecture must explain the parent PostgreSQL test result");
  expectMutationFailure(architecture.replace(
    "two top-level deterministic lifecycle/mutation-resistance test results complete the total", "deterministic explanation removed"
  ), ledger, "architecture must explain the two top-level deterministic results");
  for (const staleClaim of [
    "Acceptance remains blocked because the URL is unavailable.",
    "PostgreSQL acceptance is pending because: the disposable URL is not configured.",
    "The suite was not executed because CC_SPRINT_113_TEST_DATABASE_URL is absent.",
    "PostgreSQL acceptance remains blocked because the environment variable is unavailable.",
    "PostgreSQL acceptance is open because the environment variable is unavailable.",
    "PostgreSQL acceptance is pending because the environment variable is absent.",
    "PostgreSQL acceptance was not executed because the environment variable was unavailable.",
    "PostgreSQL acceptance remains blocked because CC_SPRINT_113_TEST_DATABASE_URL is unavailable.",
    "PostgreSQL acceptance remains blocked because the disposable database environment variable is not configured.",
    "POSTGRESQL ACCEPTANCE remains open—due to the URL being unavailable.",
  ]) {
    expectMutationFailure(`${architecture}\n${staleClaim}`, ledger,
      "documents must reject stale URL-blocked acceptance language");
  }

  function reconciliationOccurrences(document) {
    return document.split(/\r?\n/).filter((line) =>
      /corrected dedicated TAP accounts for its total exactly/i.test(line));
  }
  function assertReconciliationOccurrence(occurrence, label) {
    assert.match(occurrence, /19 child PostgreSQL test results cover the 21 numbered production scenarios/,
      `${label} must reconcile 19 child results with 21 numbered scenarios`);
    assert.match(occurrence, /grouped children combine scenarios 6–7, 8–9, 11–14, and 18–19/,
      `${label} must retain every grouped scenario reconciliation`);
    assert.match(occurrence, /scenario 10 expands into five mutation-specific children 10a–10e/,
      `${label} must retain the five scenario-10 child results`);
    assert.match(occurrence, /one parent PostgreSQL test result records completion of the PostgreSQL parent/,
      `${label} must explain the parent PostgreSQL test result`);
    assert.match(occurrence, /two top-level deterministic lifecycle\/mutation-resistance test results complete the total/,
      `${label} must explain the two top-level deterministic results`);
    assert.match(occurrence, /(?:corrected user-run|user-run corrected) disposable-PostgreSQL summary was 22 tests, 22 passed, 0 failed, and 0 skipped/i,
      `${label} must record the corrected dedicated summary exactly`);
    assert.match(occurrence, /PostgreSQL-enabled canonical run completed with 816 tests, 815 passed, 0 failed, and one unrelated existing opt-in adapter skip/i,
      `${label} must record the corrected canonical evidence exactly`);
    assert.doesNotMatch(occurrence, staleUrlBlockedClaim,
      `${label} must reject stale acceptance-status language`);
  }
  function assertEveryReconciliation(document, label, expectedCount) {
    const occurrences = reconciliationOccurrences(document);
    assert.equal(occurrences.length, expectedCount, `${label} must retain every reconciliation occurrence`);
    occurrences.forEach((occurrence, index) =>
      assertReconciliationOccurrence(occurrence, `${label} reconciliation ${index + 1}`));
  }
  function mutateReconciliation(document, occurrenceIndex, mutate) {
    let seen = 0;
    return document.split(/(\r?\n)/).map((part) => {
      if (!/corrected dedicated TAP accounts for its total exactly/i.test(part)) return part;
      const current = seen;
      seen += 1;
      return current === occurrenceIndex ? mutate(part) : part;
    }).join("");
  }
  function expectScopedMutationFailure(document, label, expectedCount, occurrenceIndex, mutate, reason) {
    const mutated = mutateReconciliation(document, occurrenceIndex, mutate);
    assert.throws(() => assertEveryReconciliation(mutated, label, expectedCount), (error) =>
      error instanceof assert.AssertionError &&
        error.message.includes(`${label} reconciliation ${occurrenceIndex + 1} ${reason}`),
    `${label} occurrence ${occurrenceIndex + 1} mutation must fail specifically: ${reason}`);
  }

  assertEveryReconciliation(architecture, "architecture", 1);
  assertEveryReconciliation(ledger, "decision ledger", 4);
  for (const [document, label, count] of [
    [architecture, "architecture", 1],
    [ledger, "decision ledger", 4],
  ]) {
    for (let index = 0; index < count; index += 1) {
      for (const [mutate, reason] of [
        [line => line.replace("19 child PostgreSQL test results", "18 child PostgreSQL test results"),
          "must reconcile 19 child results with 21 numbered scenarios"],
        [line => line.replace("19 child PostgreSQL test results", "20 child PostgreSQL test results"),
          "must reconcile 19 child results with 21 numbered scenarios"],
        [line => line.replace("the 21 numbered production scenarios", "the 20 numbered production scenarios"),
          "must reconcile 19 child results with 21 numbered scenarios"],
        [line => line.replace("one parent PostgreSQL test result records completion of the PostgreSQL parent", "parent explanation removed"),
          "must explain the parent PostgreSQL test result"],
        [line => line.replace("two top-level deterministic lifecycle/mutation-resistance test results complete the total", "deterministic explanation removed"),
          "must explain the two top-level deterministic results"],
        [line => line.replace("summary was 22 tests", "summary was 23 tests"),
          "must record the corrected dedicated summary exactly"],
        [line => `${line} PostgreSQL acceptance remains blocked because the environment variable is unavailable.`,
          "must reject stale acceptance-status language"],
      ]) {
        expectScopedMutationFailure(document, label, count, index, mutate, reason);
      }
    }
  }
  for (const legitimateClaim of [
    "The read-only reviewer did not possess the disposable database credential.",
    "The credential-free reviewer run safely skipped the PostgreSQL parent.",
    "The first readiness attempt lacked an environment variable before the later successful run.",
    "Credentials must never be printed or committed.",
    "Historical execution was initially unavailable before the later successful run.",
  ]) {
    assert.doesNotMatch(legitimateClaim, staleUrlBlockedClaim,
      "stale matcher must preserve legitimate credential and historical statements");
  }
});
