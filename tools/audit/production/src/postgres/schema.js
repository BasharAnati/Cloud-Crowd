"use strict";

const { DatabaseQueryError, MalformedDatabaseResultError, UnexpectedSchemaError } = require("../errors");
const { deepFreeze, immutableRows, isPlainObject, requireRows } = require("./row-validation");

const SCHEMA_QUERIES = Object.freeze([
  Object.freeze({ name: "schema", text: `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'public'` }),
  Object.freeze({ name: "relations", text: `SELECT n.nspname AS schema_name, c.relname AS table_name, c.relkind
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('tickets', 'ticket_history') AND c.relkind IN ('r', 'p')
ORDER BY c.relname` }),
  Object.freeze({ name: "columns", text: `SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default, is_generated, generation_expression
FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('tickets', 'ticket_history')
ORDER BY table_name, ordinal_position` }),
  Object.freeze({ name: "constraints", text: `SELECT c.relname AS table_name, con.conname AS constraint_name, con.contype AS constraint_type,
pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('tickets', 'ticket_history')
ORDER BY c.relname, con.conname` }),
  Object.freeze({ name: "indexes", text: `SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
FROM pg_catalog.pg_indexes WHERE schemaname = 'public' AND tablename IN ('tickets', 'ticket_history')
ORDER BY tablename, indexname` }),
  Object.freeze({ name: "triggers", text: `SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled AS enabled_state,
pg_catalog.pg_get_triggerdef(t.oid, true) AS definition
FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('tickets', 'ticket_history') AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname` }),
  Object.freeze({ name: "sequences", text: `SELECT s.relname AS sequence_name, t.relname AS owned_by_table, a.attname AS owned_by_column
FROM pg_catalog.pg_class s JOIN pg_catalog.pg_namespace n ON n.oid = s.relnamespace
LEFT JOIN pg_catalog.pg_depend d ON d.objid = s.oid AND d.deptype IN ('a', 'i')
LEFT JOIN pg_catalog.pg_class t ON t.oid = d.refobjid
LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
WHERE n.nspname = 'public' AND s.relkind = 'S'
ORDER BY s.relname` }),
]);

const TARGET_TABLES = Object.freeze(["ticket_history", "tickets"]);

function exactRow(row, fields) {
  if (!isPlainObject(row) || Reflect.ownKeys(row).length !== fields.length ||
      fields.some((field) => !Object.hasOwn(row, field))) {
    throw new MalformedDatabaseResultError("Schema metadata row is malformed");
  }
}
function nonEmptyString(value) { return typeof value === "string" && value.length > 0; }
function nullableString(value) { return value === null || typeof value === "string"; }
function nullableNonEmptyString(value) { return value === null || nonEmptyString(value); }
function targetTable(value) { return TARGET_TABLES.includes(value); }

const ROW_VALIDATORS = Object.freeze({
  schema(row) {
    exactRow(row, ["schema_name"]);
    if (row.schema_name !== "public") throw new MalformedDatabaseResultError("Schema metadata row is malformed");
  },
  relations(row) {
    exactRow(row, ["schema_name", "table_name", "relkind"]);
    if (row.schema_name !== "public" || !targetTable(row.table_name) || !["r", "p"].includes(row.relkind)) throw new MalformedDatabaseResultError("Relation metadata row is malformed");
  },
  columns(row) {
    exactRow(row, ["table_name", "column_name", "ordinal_position", "data_type", "udt_name", "is_nullable", "column_default", "is_generated", "generation_expression"]);
    if (!targetTable(row.table_name) || !nonEmptyString(row.column_name) || !Number.isSafeInteger(row.ordinal_position) || row.ordinal_position <= 0 ||
        !nonEmptyString(row.data_type) || !nonEmptyString(row.udt_name) || !["YES", "NO"].includes(row.is_nullable) ||
        !nullableString(row.column_default) || !["NEVER", "ALWAYS"].includes(row.is_generated) || !nullableString(row.generation_expression) ||
        (row.is_generated === "NEVER" && row.generation_expression !== null) ||
        (row.is_generated === "ALWAYS" && !nonEmptyString(row.generation_expression))) throw new MalformedDatabaseResultError("Column metadata row is malformed");
  },
  constraints(row) {
    exactRow(row, ["table_name", "constraint_name", "constraint_type", "definition"]);
    if (!targetTable(row.table_name) || !nonEmptyString(row.constraint_name) || !["p", "u", "f", "c", "x", "n"].includes(row.constraint_type) || !nonEmptyString(row.definition)) throw new MalformedDatabaseResultError("Constraint metadata row is malformed");
  },
  indexes(row) {
    exactRow(row, ["table_name", "index_name", "definition"]);
    if (!targetTable(row.table_name) || !nonEmptyString(row.index_name) || !nonEmptyString(row.definition)) throw new MalformedDatabaseResultError("Index metadata row is malformed");
  },
  triggers(row) {
    exactRow(row, ["table_name", "trigger_name", "enabled_state", "definition"]);
    if (!targetTable(row.table_name) || !nonEmptyString(row.trigger_name) || !["O", "D", "R", "A"].includes(row.enabled_state) || !nonEmptyString(row.definition)) throw new MalformedDatabaseResultError("Trigger metadata row is malformed");
  },
  sequences(row) {
    exactRow(row, ["sequence_name", "owned_by_table", "owned_by_column"]);
    if (!nonEmptyString(row.sequence_name) || !nullableNonEmptyString(row.owned_by_table) || !nullableNonEmptyString(row.owned_by_column) ||
        ((row.owned_by_table === null) !== (row.owned_by_column === null))) throw new MalformedDatabaseResultError("Sequence metadata row is malformed");
  },
});

async function inspectSchema(client) {
  const snapshot = {};
  for (const query of SCHEMA_QUERIES) {
    let result;
    try { result = await client.query({ text: query.text, values: [] }); }
    catch (_) { throw new DatabaseQueryError("Schema inspection query failed"); }
    const rows = requireRows(result);
    for (const row of rows) ROW_VALIDATORS[query.name](row);
    snapshot[query.name] = immutableRows(result);
  }
  if (snapshot.schema.length !== 1) throw new UnexpectedSchemaError("Expected schema is absent");
  const relationNames = new Set(snapshot.relations.map((row) => row.table_name));
  if (snapshot.relations.length !== TARGET_TABLES.length ||
      !relationNames.has("tickets") || !relationNames.has("ticket_history")) {
    throw new UnexpectedSchemaError("Expected audit tables are absent");
  }
  for (const tableName of TARGET_TABLES) {
    if (!snapshot.columns.some((row) => row.table_name === tableName)) {
      throw new UnexpectedSchemaError("Expected table columns are absent");
    }
  }
  return deepFreeze(snapshot);
}

module.exports = { SCHEMA_QUERIES, inspectSchema };
