"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createPostgresAdapter } = require("../../src/postgres");
const { enforceSafety } = require("../../src/safety-kernel");

const DISPOSABLE_URL_KEY = "AUDIT_DATABASE_DISPOSABLE_TEST_URL";
const DISPOSABLE_ROLE_KEY = "AUDIT_DATABASE_DISPOSABLE_TEST_ROLE";
const DISPOSABLE_DATABASE_KEY = "AUDIT_DATABASE_DISPOSABLE_TEST_DATABASE";

function disposableConfiguration() {
  const value = process.env[DISPOSABLE_URL_KEY];
  if (!value) return null;
  let parsed;
  try { parsed = new URL(value); } catch (_) { throw new Error("Disposable integration URL is invalid"); }
  const identity = `${parsed.hostname}/${parsed.pathname}`.toLowerCase();
  if (!/(test|disposable|isolated)/.test(identity) || /prod/i.test(identity)) {
    throw new Error("Integration test refused a URL not clearly identified as disposable");
  }
  const expectedRole = process.env[DISPOSABLE_ROLE_KEY];
  if (!expectedRole) throw new Error("Disposable integration role is required");
  const expectedDatabase = process.env[DISPOSABLE_DATABASE_KEY];
  if (!expectedDatabase) throw new Error("Disposable integration database identity is required");
  return { value, expectedRole, expectedDatabase };
}

test("opt-in adapter integration uses only a dedicated disposable URL", { skip: !process.env[DISPOSABLE_URL_KEY] }, async () => {
  const disposable = disposableConfiguration();
  assert.ok(disposable);
  const adapter = createPostgresAdapter({
    safety: enforceSafety({ target: "production", mode: "read-only", productionAcknowledged: true }),
    env: { AUDIT_DATABASE_URL_UNPOOLED: disposable.value, AUDIT_DATABASE_ROLE: disposable.expectedRole },
    expectedDatabase: disposable.expectedDatabase,
  });
  const result = await adapter.inspectConnectionSafety();
  assert.deepEqual(result, { roleVerified: true, transactionReadOnly: true });
});

module.exports = { disposableConfiguration };
