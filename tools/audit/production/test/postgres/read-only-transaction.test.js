"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const transaction = require("../../src/postgres/read-only-transaction");
const { createPostgresAdapter } = require("../../src/postgres");
const boundedAwaitModule = require("../../src/postgres/bounded-await");
const { adapterEnvironment, fakeClientClass, safeCapability } = require("./helpers");

test("transaction module exports fixed constants and no arbitrary callback runner", () => {
  assert.deepEqual(Object.keys(transaction).sort(), [
    "BEGIN_SQL", "COMMIT_SQL", "ROLLBACK_SQL", "TIMEOUT_SQL", "VERIFY_SQL",
  ]);
  assert.equal(transaction.runReadOnlyTransaction, undefined);
  assert.equal(Object.values(transaction).some((value) => typeof value === "function"), false);
  assert.equal(boundedAwaitModule.createBoundedQueryClient, undefined);
});

test("adapter exposes only the closed named operation surface", () => {
  const adapter = createPostgresAdapter({
    safety: safeCapability(),
    env: adapterEnvironment,
    expectedDatabase: "cloud_crowd",
    Client: fakeClientClass(),
  });
  assert.deepEqual(Object.keys(adapter).sort(), [
    "inspectConnectionSafety", "inspectMetadata", "inspectSchema",
    "listHistoryPage", "listTicketsPage",
  ]);
  assert.equal(Object.isFrozen(adapter), true);
});

test("fixed transaction statements retain required read-only sequence", () => {
  assert.equal(transaction.BEGIN_SQL, "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.deepEqual(transaction.TIMEOUT_SQL, [
    "SET LOCAL statement_timeout = '15s'",
    "SET LOCAL lock_timeout = '2s'",
    "SET LOCAL idle_in_transaction_session_timeout = '30s'",
  ]);
  assert.equal(transaction.VERIFY_SQL, "SHOW transaction_read_only");
  assert.equal(transaction.COMMIT_SQL, "COMMIT");
  assert.equal(transaction.ROLLBACK_SQL, "ROLLBACK");
});
