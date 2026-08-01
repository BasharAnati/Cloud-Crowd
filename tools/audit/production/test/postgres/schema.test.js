"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { MalformedDatabaseResultError, UnexpectedSchemaError } = require("../../src/errors");
const { SCHEMA_QUERIES, inspectSchema } = require("../../src/postgres/schema");

const validRows = Object.freeze({
  schema: [{ schema_name: "public" }],
  relations: [
    { schema_name: "public", table_name: "ticket_history", relkind: "r" },
    { schema_name: "public", table_name: "tickets", relkind: "r" },
  ],
  columns: [
    { table_name: "ticket_history", column_name: "id", ordinal_position: 1, data_type: "bigint", udt_name: "int8", is_nullable: "NO", column_default: null, is_generated: "NEVER", generation_expression: null },
    { table_name: "tickets", column_name: "id", ordinal_position: 1, data_type: "bigint", udt_name: "int8", is_nullable: "NO", column_default: null, is_generated: "NEVER", generation_expression: null },
  ],
  constraints: [{ table_name: "tickets", constraint_name: "tickets_pkey", constraint_type: "p", definition: "PRIMARY KEY (id)" }],
  indexes: [{ table_name: "tickets", index_name: "tickets_pkey", definition: "CREATE UNIQUE INDEX tickets_pkey ON public.tickets USING btree (id)" }],
  triggers: [{ table_name: "tickets", trigger_name: "ticket_update", enabled_state: "O", definition: "CREATE TRIGGER ticket_update" }],
  sequences: [{ sequence_name: "tickets_id_seq", owned_by_table: "tickets", owned_by_column: "id" }],
});

function schemaClient({ includeBoth = true, override = {} } = {}) {
  const calls = [];
  return {
    calls,
    async query(query) {
      calls.push(query);
      const definition = SCHEMA_QUERIES.find((candidate) => candidate.text === query.text);
      let rows = override[definition.name] || validRows[definition.name];
      if (definition.name === "relations" && !includeBoth) rows = [validRows.relations[1]];
      return { rows };
    },
  };
}

test("schema inspection issues only the fixed catalog queries", async () => {
  const client = schemaClient();
  const snapshot = await inspectSchema(client);
  assert.deepEqual(client.calls.map((query) => query.text), SCHEMA_QUERIES.map((query) => query.text));
  assert.equal(client.calls.every((query) => Array.isArray(query.values) && query.values.length === 0), true);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.relations[0]), true);
});

test("schema inspection covers columns, constraints, indexes, triggers, and sequence ownership without advancing sequences", () => {
  const sql = SCHEMA_QUERIES.map((query) => query.text).join("\n");
  for (const term of ["information_schema.columns", "pg_catalog.pg_constraint", "pg_catalog.pg_indexes", "pg_catalog.pg_trigger", "owned_by_column"]) assert.match(sql, new RegExp(term.replaceAll(".", "\\.")));
  assert.doesNotMatch(sql, /\b(nextval|setval|currval)\s*\(/i);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|VACUUM|ANALYZE|COPY|LOCK)\b/i);
});

test("missing expected schema relations fail closed", async () => {
  await assert.rejects(inspectSchema(schemaClient({ includeBoth: false })), UnexpectedSchemaError);
});

test("every schema metadata category rejects missing and wrongly typed fields", async () => {
  for (const query of SCHEMA_QUERIES) {
    await assert.rejects(inspectSchema(schemaClient({ override: { [query.name]: [{ bogus: "accepted" }] } })), MalformedDatabaseResultError, query.name);
    const wrongType = { ...validRows[query.name][0] };
    const firstField = Object.keys(wrongType)[0];
    wrongType[firstField] = 42;
    await assert.rejects(inspectSchema(schemaClient({ override: { [query.name]: [wrongType] } })), MalformedDatabaseResultError, `${query.name} wrong type`);
  }
});
