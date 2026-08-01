"use strict";

const { DatabaseQueryError, MalformedDatabaseResultError } = require("../errors");
const { deepFreeze, immutableJson, isPlainObject } = require("./row-validation");

const METADATA_SQL = `SELECT
current_database()::text AS database_name,
current_user::text AS role_name,
pg_catalog.current_setting('server_version_num')::text AS server_version_number,
d.encoding::integer AS encoding_id,
d.datcollate::text AS collation,
d.datctype::text AS character_classification
FROM pg_catalog.pg_database d WHERE d.datname = current_database()`;

async function inspectMetadata(client) {
  let result;
  try { result = await client.query({ text: METADATA_SQL, values: [] }); }
  catch (_) { throw new DatabaseQueryError("Metadata query failed"); }
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1 || !isPlainObject(result.rows[0])) throw new MalformedDatabaseResultError("Metadata result is malformed");
  const row = result.rows[0];
  const stringFields = ["database_name", "role_name", "server_version_number", "collation", "character_classification"];
  const expectedFields = [...stringFields, "encoding_id"];
  if (Reflect.ownKeys(row).length !== expectedFields.length || expectedFields.some((field) => !Object.hasOwn(row, field)) ||
      stringFields.some((field) => typeof row[field] !== "string" || row[field].length === 0) ||
      !/^[0-9]+$/.test(row.server_version_number) || !Number.isSafeInteger(row.encoding_id) || row.encoding_id < 0) throw new MalformedDatabaseResultError("Metadata row is malformed");
  return deepFreeze(immutableJson(row));
}

module.exports = { METADATA_SQL, inspectMetadata };
