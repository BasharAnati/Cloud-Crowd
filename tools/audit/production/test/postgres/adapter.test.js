"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createPostgresAdapter } = require("../../src/postgres");
const { classifyError, DatabaseConfigurationError, DatabaseConnectionError, SafetyViolationError } = require("../../src/errors");
const { adapterEnvironment, fakeClientClass, safeCapability } = require("./helpers");
const { TIMEOUT_SQL } = require("../../src/postgres/read-only-transaction");

test("importing the adapter performs no client construction or connection", () => {
  let constructions = 0;
  class Client { constructor() { constructions += 1; } }
  createPostgresAdapter({ safety: safeCapability(), env: adapterEnvironment, expectedDatabase: "cloud_crowd", Client });
  assert.equal(constructions, 0);
});

test("missing and forged safety approval prevent client construction", () => {
  let constructions = 0;
  class Client { constructor() { constructions += 1; } }
  assert.throws(() => createPostgresAdapter({ env: adapterEnvironment, expectedDatabase: "cloud_crowd", Client }), SafetyViolationError);
  assert.throws(() => createPostgresAdapter({ safety: Object.freeze({ target: "production", mode: "read-only", productionAcknowledged: true, capabilities: Object.freeze({ readOnly: true, writesAllowed: false }) }), env: adapterEnvironment, expectedDatabase: "cloud_crowd", Client }), SafetyViolationError);
  assert.equal(constructions, 0);
});

test("missing dedicated URL prevents construction and application URLs are not fallbacks", async () => {
  let constructions = 0;
  class Client { constructor() { constructions += 1; } }
  const adapter = createPostgresAdapter({ safety: safeCapability(), env: {
    AUDIT_DATABASE_ROLE: "audit_reader",
    NETLIFY_DATABASE_URL: "postgres://application-secret",
    NETLIFY_DATABASE_URL_UNPOOLED: "postgres://application-unpooled-secret",
  }, expectedDatabase: "cloud_crowd", Client });
  await assert.rejects(adapter.inspectConnectionSafety(), DatabaseConfigurationError);
  assert.equal(constructions, 0);
});

test("public paging operations reject invalid input before environment or client access", async () => {
  const counters = {
    environmentReads: 0,
    constructions: 0,
    connects: 0,
    queries: 0,
    rollbacks: 0,
    ends: 0,
  };
  const env = new Proxy(adapterEnvironment, {
    get(target, property, receiver) {
      counters.environmentReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  class Client {
    constructor() { counters.constructions += 1; }
    async connect() { counters.connects += 1; }
    async query(query) {
      counters.queries += 1;
      if (query.text === "ROLLBACK") counters.rollbacks += 1;
      return { rows: [] };
    }
    async end() { counters.ends += 1; }
  }
  const adapter = createPostgresAdapter({
    safety: safeCapability(),
    env,
    expectedDatabase: "cloud_crowd",
    Client,
  });
  const cases = [
    () => adapter.listTicketsPage({ limit: 0 }),
    () => adapter.listTicketsPage({ limit: -1 }),
    () => adapter.listTicketsPage({ limit: 1.5 }),
    () => adapter.listTicketsPage({ limit: "1" }),
    () => adapter.listTicketsPage({ limit: 101 }),
    () => adapter.listTicketsPage({ limit: 1, section: 7 }),
    () => adapter.listTicketsPage({ limit: 1, lastSeenId: "not-a-bigint" }),
    () => adapter.listHistoryPage({ limit: 1, ticketId: 7 }),
    () => adapter.listHistoryPage({ limit: 1, cursor: { changedAt: "2025-01-01T00:00:00Z" } }),
    () => adapter.listTicketsPage({ limit: 1, unexpected: true }),
    () => adapter.listHistoryPage(new Date()),
  ];

  for (const invoke of cases) {
    await assert.rejects(invoke(), (error) => {
      assert.equal(classifyError(error).publicCode, "DATABASE_INPUT_FAILURE");
      return true;
    });
    assert.deepEqual(counters, {
      environmentReads: 0,
      constructions: 0,
      connects: 0,
      queries: 0,
      rollbacks: 0,
      ends: 0,
    });
  }
});

test("successful lifecycle connects, verifies, commits, and closes exactly once", async () => {
  const Client = fakeClientClass();
  const adapter = createPostgresAdapter({ safety: safeCapability(), env: adapterEnvironment, expectedDatabase: "cloud_crowd", Client });
  assert.deepEqual(await adapter.inspectConnectionSafety(), { roleVerified: true, transactionReadOnly: true });
  const instance = Client.instances[0];
  assert.equal(instance.calls[0].method, "connect");
  assert.equal(instance.calls.some((call) => call.text === "COMMIT"), true);
  assert.equal(instance.calls.some((call) => call.text === "ROLLBACK"), false);
  assert.equal(instance.endCalls, 1);
});

test("connect and close failures are trusted, sanitized classifications", async () => {
  const secret = "postgres://user:password@private.invalid/production";
  for (const options of [{ connectError: new Error(secret) }, { endError: new Error(secret) }]) {
    const adapter = createPostgresAdapter({ safety: safeCapability(), env: adapterEnvironment, expectedDatabase: "cloud_crowd", Client: fakeClientClass(options) });
    await assert.rejects(adapter.inspectConnectionSafety(), (error) => {
      assert.equal(error instanceof DatabaseConnectionError, true);
      assert.equal(error.message.includes(secret), false);
      const publicResult = classifyError(error);
      assert.equal(JSON.stringify(publicResult).includes(secret), false);
      return true;
    });
  }
});

test("primary failure survives rollback and close failures", async () => {
  const Client = fakeClientClass({
    endError: new Error("close secret"),
    onQuery(query) {
      if (query.text === "SHOW transaction_read_only") throw new Error("query secret");
      if (query.text === "ROLLBACK") throw new Error("rollback secret");
    },
  });
  const adapter = createPostgresAdapter({ safety: safeCapability(), env: adapterEnvironment, expectedDatabase: "cloud_crowd", Client });
  await assert.rejects(adapter.inspectConnectionSafety(), (error) => {
    assert.equal(classifyError(error).publicCode, "DATABASE_QUERY_FAILURE");
    assert.equal(error.message.includes("secret"), false);
    return true;
  });
  assert.equal(Client.instances[0].endCalls, 1);
});

test("verification, query, row-validation, and commit failures clean up deterministically", async () => {
  const scenarios = [
    { options: { roleOverrides: { is_superuser: true } }, invoke: (adapter) => adapter.inspectConnectionSafety(), rollback: false },
    { options: { onQuery: (query) => query.text === "SHOW transaction_read_only" ? { rows: [{ transaction_read_only: "off" }] } : undefined }, invoke: (adapter) => adapter.inspectConnectionSafety(), rollback: true },
    { options: { onQuery: (query) => { if (query.text.includes("FROM public.tickets")) throw new Error("driver secret"); } }, invoke: (adapter) => adapter.listTicketsPage({ limit: 1 }), rollback: true },
    { options: { onQuery: (query) => query.text.includes("FROM public.tickets") ? { rows: [{ id: "malformed" }] } : undefined }, invoke: (adapter) => adapter.listTicketsPage({ limit: 1 }), rollback: true },
    { options: { onQuery: (query) => { if (query.text === "COMMIT") throw new Error("commit secret"); } }, invoke: (adapter) => adapter.inspectConnectionSafety(), rollback: true },
  ];
  for (const scenario of scenarios) {
    const Client = fakeClientClass(scenario.options);
    const adapter = createPostgresAdapter({ safety: safeCapability(), env: adapterEnvironment, expectedDatabase: "cloud_crowd", Client });
    await assert.rejects(scenario.invoke(adapter));
    const instance = Client.instances[0];
    assert.equal(instance.endCalls, 1);
    assert.equal(instance.calls.some((call) => call.text === "ROLLBACK"), scenario.rollback);
  }
});

async function withImmediateDeadlines(action) {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.setTimeout = (callback) => originalSetTimeout(callback, 0);
  global.clearTimeout = (timer) => originalClearTimeout(timer);
  try { return await action(); }
  finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
}

test("every asynchronous lifecycle stage has a client-side deadline", async () => {
  const never = () => new Promise(() => {});
  const scenarios = [
    { name: "connect", options: { connectPending: true }, invoke: (adapter) => adapter.inspectConnectionSafety() },
    { name: "role verification", options: { onQuery: (query) => query.text.includes("FROM pg_catalog.pg_roles") ? never() : undefined }, invoke: (adapter) => adapter.inspectConnectionSafety() },
    { name: "RLS verification", options: { onQuery: (query) => query.text.includes("JOIN pg_catalog.pg_policy") ? never() : undefined }, invoke: (adapter) => adapter.inspectConnectionSafety() },
    { name: "BEGIN", options: { onQuery: (query) => query.text.startsWith("BEGIN TRANSACTION") ? never() : undefined }, invoke: (adapter) => adapter.inspectConnectionSafety() },
    ...TIMEOUT_SQL.map((statement) => ({ name: statement, options: { onQuery: (query) => query.text === statement ? never() : undefined }, invoke: (adapter) => adapter.inspectConnectionSafety() })),
    { name: "read-only verification", options: { onQuery: (query) => query.text === "SHOW transaction_read_only" ? never() : undefined }, invoke: (adapter) => adapter.inspectConnectionSafety() },
    { name: "approved query", options: { onQuery: (query) => query.text.includes("FROM public.tickets") ? never() : undefined }, invoke: (adapter) => adapter.listTicketsPage({ limit: 1 }) },
    { name: "COMMIT", options: { onQuery: (query) => query.text === "COMMIT" ? never() : undefined }, invoke: (adapter) => adapter.inspectConnectionSafety() },
    { name: "ROLLBACK", options: { onQuery: (query) => query.text === "SHOW transaction_read_only" ? { rows: [{ transaction_read_only: "off" }] } : query.text === "ROLLBACK" ? never() : undefined }, invoke: (adapter) => adapter.inspectConnectionSafety(), primary: "DATABASE_SAFETY_FAILURE" },
    { name: "end", options: { endPending: true }, invoke: (adapter) => adapter.inspectConnectionSafety() },
  ];
  await withImmediateDeadlines(async () => {
    for (const scenario of scenarios) {
      const Client = fakeClientClass(scenario.options);
      const adapter = createPostgresAdapter({ safety: safeCapability(), env: adapterEnvironment, expectedDatabase: "cloud_crowd", Client });
      await assert.rejects(scenario.invoke(adapter), (error) => {
        assert.notEqual(classifyError(error).publicCode, "INTERNAL_ERROR", scenario.name);
        if (scenario.primary) assert.equal(classifyError(error).publicCode, scenario.primary);
        return true;
      });
      assert.equal(Client.instances[0].endCalls, 1, scenario.name);
    }
  });
});

test("constructed pg client receives fixed connection and query timeout configuration", async () => {
  const Client = fakeClientClass();
  const adapter = createPostgresAdapter({ safety: safeCapability(), env: adapterEnvironment, expectedDatabase: "cloud_crowd", Client });
  await adapter.inspectConnectionSafety();
  assert.equal(Client.instances[0].configuration.connectionTimeoutMillis, 5000);
  assert.equal(Client.instances[0].configuration.query_timeout, 15000);
  assert.deepEqual(Object.keys(Client.instances[0].configuration).sort(), ["connectionString", "connectionTimeoutMillis", "query_timeout"]);
});
