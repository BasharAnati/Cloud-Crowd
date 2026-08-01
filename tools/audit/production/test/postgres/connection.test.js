"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ROLE_SAFETY_SQL, loadConnectionConfiguration, verifyRlsCompleteness, verifyRoleSafety } = require("../../src/postgres/connection");
const { DatabaseSafetyError, MalformedDatabaseResultError } = require("../../src/errors");
const { fakeClientClass, safeRlsRows, safeRoleRow } = require("./helpers");

test("connection configuration uses only dedicated variables", () => {
  const configuration = loadConnectionConfiguration({ env: { AUDIT_DATABASE_URL_UNPOOLED: "dedicated", AUDIT_DATABASE_ROLE: "reader", NETLIFY_DATABASE_URL: "ignored" }, expectedDatabase: "cloud_crowd" });
  assert.deepEqual(configuration, { connectionString: "dedicated", expectedRole: "reader", expectedDatabase: "cloud_crowd" });
});

test("role verification requires exact identity and rejects every prohibited capability", async () => {
  const unsafeProfiles = [
    { database_name: "other_database" }, { role_name: "other" }, { is_superuser: true }, { can_create_database: true }, { can_create_role: true },
    { can_replicate: true }, { can_bypass_rls: true }, { owns_database: true },
    { owns_non_system_schema: true }, { owns_non_system_relation: true }, { owns_non_system_function: true },
    { has_role_membership: true }, { has_database_create: true }, { has_database_temporary: true },
    { has_unexpected_database_privilege: true }, { has_unexpected_schema_privilege: true },
    { has_unexpected_relation_privilege: true }, { has_sequence_privilege: true }, { has_unexpected_function_execute: true },
    { has_database_connect: false }, { has_schema_usage: false }, { has_tickets_select: false }, { has_history_select: false },
  ];
  for (const overrides of unsafeProfiles) {
    const client = new (fakeClientClass({ roleOverrides: overrides }))();
    await assert.rejects(verifyRoleSafety(client, "audit_reader", "cloud_crowd"), DatabaseSafetyError);
  }
});

test("safe role profile is accepted and role SQL never invokes application functions", async () => {
  let sql;
  const client = { async query(query) { sql = query.text; return { rows: [safeRoleRow()] }; } };
  assert.deepEqual(await verifyRoleSafety(client, "audit_reader", "cloud_crowd"), { verified: true });
  assert.doesNotMatch(sql, /log_ticket_update\s*\(/i);
});

test("database and role privilege metadata requires an exact typed row", async () => {
  const missing = safeRoleRow(); delete missing.has_database_connect;
  for (const row of [
    { ...safeRoleRow(), unexpected: false },
    missing,
    { ...safeRoleRow(), has_schema_usage: null },
    { bogus: "accepted" },
  ]) {
    await assert.rejects(verifyRoleSafety({ query: async () => ({ rows: [row] }) }, "audit_reader", "cloud_crowd"), MalformedDatabaseResultError);
  }
});

test("least-privilege SQL scans all non-system objects and excludes system schemas explicitly", () => {
  assert.match(ROLE_SAFETY_SQL, /owns_non_system_relation/);
  assert.match(ROLE_SAFETY_SQL, /has_unexpected_relation_privilege/);
  assert.match(ROLE_SAFETY_SQL, /has_unexpected_database_privilege/);
  assert.match(ROLE_SAFETY_SQL, /nspname NOT IN \('pg_catalog', 'information_schema'\)/);
  assert.match(ROLE_SAFETY_SQL, /has_sequence_privilege[\s\S]*'SELECT'/);
  assert.match(ROLE_SAFETY_SQL, /has_function_privilege[\s\S]*'EXECUTE'/);
});

test("least-privilege SQL checks every table privilege with a valid individual call", () => {
  const calls = [...ROLE_SAFETY_SQL.matchAll(
    /pg_catalog\.has_table_privilege\(\s*current_user\s*,\s*(?:'[^']+'|candidate_relation\.oid)\s*,\s*'([^']+)'\s*\)/g
  )].map((match) => match[1]);
  const counts = new Map(calls.map((privilege) => [
    privilege,
    calls.filter((candidate) => candidate === privilege).length,
  ]));

  assert.equal(calls.length, 15);
  assert.equal(calls.every((privilege) => !privilege.includes(",")), true);
  assert.deepEqual([...counts.keys()].sort(), [
    "DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE",
  ]);
  assert.equal(counts.get("SELECT"), 3);
  for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
    assert.equal(counts.get(privilege), 2, privilege);
  }
  assert.match(ROLE_SAFETY_SQL, /has_table_privilege\(current_user, 'public\.tickets', 'SELECT'\)/);
  assert.match(ROLE_SAFETY_SQL, /has_table_privilege\(current_user, 'public\.ticket_history', 'SELECT'\)/);
  assert.doesNotMatch(ROLE_SAFETY_SQL, /has_table_privilege\([^\n]*'[^']*,[^']*'\)/);
  assert.doesNotMatch(ROLE_SAFETY_SQL, /\$\{/);
});

function rlsRow(tableName, overrides = {}) {
  return {
    table_name: tableName,
    rls_enabled: false,
    rls_forced: false,
    policy_name: null,
    is_permissive: null,
    command: null,
    using_expression: null,
    role_names: [],
    ...overrides,
  };
}
function rlsClient(rows) { return { query: async () => ({ rows }) }; }

test("RLS disabled is accepted", async () => {
  assert.deepEqual(await verifyRlsCompleteness(rlsClient(safeRlsRows()), "audit_reader"), { verified: true });
});

test("RLS enabled without a policy, with a partial policy, or with a restrictive partial policy is rejected", async () => {
  const disabledHistory = rlsRow("ticket_history");
  const cases = [
    [disabledHistory, rlsRow("tickets", { rls_enabled: true })],
    [disabledHistory, rlsRow("tickets", { rls_enabled: true, policy_name: "partial", is_permissive: true, command: "r", using_expression: "section = 'x'", role_names: ["audit_reader"] })],
    [disabledHistory,
      rlsRow("tickets", { rls_enabled: true, policy_name: "full", is_permissive: true, command: "r", using_expression: "true", role_names: ["audit_reader"] }),
      rlsRow("tickets", { rls_enabled: true, policy_name: "restrictive", is_permissive: false, command: "r", using_expression: "section = 'x'", role_names: ["PUBLIC"] })],
  ];
  for (const rows of cases) await assert.rejects(verifyRlsCompleteness(rlsClient(rows), "audit_reader"), DatabaseSafetyError);
});

test("an explicit exact-role full-read RLS policy is accepted", async () => {
  const rows = [
    rlsRow("ticket_history"),
    rlsRow("tickets", { rls_enabled: true, rls_forced: true, policy_name: "audit_full_read", is_permissive: true, command: "r", using_expression: "true", role_names: ["audit_reader"] }),
  ];
  assert.deepEqual(await verifyRlsCompleteness(rlsClient(rows), "audit_reader"), { verified: true });
});

test("malformed RLS metadata fails closed", async () => {
  for (const rows of [[{ bogus: "accepted" }], [rlsRow("tickets")], [rlsRow("ticket_history"), rlsRow("tickets", { rls_enabled: "false" })], [rlsRow("ticket_history"), rlsRow("tickets", { role_names: "audit_reader" })]]) {
    await assert.rejects(verifyRlsCompleteness(rlsClient(rows), "audit_reader"), MalformedDatabaseResultError);
  }
});
