"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { MalformedDatabaseResultError } = require("../../src/errors");
const { METADATA_SQL, inspectMetadata } = require("../../src/postgres/metadata");

const row = Object.freeze({ database_name: "disposable_audit", role_name: "audit_reader", server_version_number: "160004", encoding_id: 6, collation: "C", character_classification: "C" });

test("metadata inspection uses one fixed safe PostgreSQL catalog query", async () => {
  let issued;
  const snapshot = await inspectMetadata({ async query(query) { issued = query; return { rows: [{ ...row }] }; } });
  assert.equal(issued.text, METADATA_SQL);
  assert.deepEqual(issued.values, []);
  assert.doesNotMatch(issued.text, /pg_(read|write)_file|dblink|lo_export|COPY/i);
  assert.equal(Object.isFrozen(snapshot), true);
});

test("malformed metadata is rejected", async () => {
  const missing = { ...row }; delete missing.role_name;
  for (const malformed of [
    { ...row, encoding_id: "6" },
    { ...row, unexpected: "field" },
    { ...row, server_version_number: "sixteen" },
    missing,
    { bogus: "accepted" },
  ]) {
    await assert.rejects(inspectMetadata({ query: async () => ({ rows: [malformed] }) }), MalformedDatabaseResultError);
  }
});
