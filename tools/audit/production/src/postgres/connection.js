"use strict";

const {
  DatabaseConfigurationError,
  DatabaseConnectionError,
  DatabaseSafetyError,
  MalformedDatabaseResultError,
} = require("../errors");
const { DEADLINES_MS, boundedAwait } = require("./bounded-await");

const CONNECTION_ENVIRONMENT_KEY = "AUDIT_DATABASE_URL_UNPOOLED";
const ROLE_ENVIRONMENT_KEY = "AUDIT_DATABASE_ROLE";

const ROLE_SAFETY_SQL = `
SELECT
  current_database()::text AS database_name,
  current_user::text AS role_name,
  r.rolsuper AS is_superuser,
  r.rolcreatedb AS can_create_database,
  r.rolcreaterole AS can_create_role,
  r.rolreplication AS can_replicate,
  r.rolbypassrls AS can_bypass_rls,
  EXISTS (SELECT 1 FROM pg_catalog.pg_database owned_database WHERE owned_database.datdba = r.oid) AS owns_database,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace owned_schema
    WHERE owned_schema.nspowner = r.oid
      AND owned_schema.nspname NOT IN ('pg_catalog', 'information_schema')
      AND owned_schema.nspname NOT LIKE 'pg_toast%'
      AND owned_schema.nspname NOT LIKE 'pg_temp_%'
  ) AS owns_non_system_schema,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class owned_relation
    JOIN pg_catalog.pg_namespace owned_namespace ON owned_namespace.oid = owned_relation.relnamespace
    WHERE owned_relation.relowner = r.oid AND owned_relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      AND owned_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
      AND owned_namespace.nspname NOT LIKE 'pg_toast%'
      AND owned_namespace.nspname NOT LIKE 'pg_temp_%'
  ) AS owns_non_system_relation,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc owned_function
    JOIN pg_catalog.pg_namespace owned_function_namespace ON owned_function_namespace.oid = owned_function.pronamespace
    WHERE owned_function.proowner = r.oid
      AND owned_function_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
      AND owned_function_namespace.nspname NOT LIKE 'pg_toast%'
      AND owned_function_namespace.nspname NOT LIKE 'pg_temp_%'
  ) AS owns_non_system_function,
  pg_catalog.has_database_privilege(current_user, current_database(), 'CONNECT') AS has_database_connect,
  pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE') AS has_database_create,
  pg_catalog.has_database_privilege(current_user, current_database(), 'TEMPORARY') AS has_database_temporary,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_database other_database
    WHERE other_database.datname <> current_database()
      AND (pg_catalog.has_database_privilege(current_user, other_database.oid, 'CONNECT')
        OR pg_catalog.has_database_privilege(current_user, other_database.oid, 'CREATE')
        OR pg_catalog.has_database_privilege(current_user, other_database.oid, 'TEMPORARY'))
  ) AS has_unexpected_database_privilege,
  pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE') AS has_schema_usage,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace candidate_schema
    WHERE candidate_schema.nspname NOT IN ('pg_catalog', 'information_schema')
      AND candidate_schema.nspname NOT LIKE 'pg_toast%'
      AND candidate_schema.nspname NOT LIKE 'pg_temp_%'
      AND ((candidate_schema.nspname <> 'public' AND pg_catalog.has_schema_privilege(current_user, candidate_schema.oid, 'USAGE'))
        OR pg_catalog.has_schema_privilege(current_user, candidate_schema.oid, 'CREATE'))
  ) AS has_unexpected_schema_privilege,
  pg_catalog.has_table_privilege(current_user, 'public.tickets', 'SELECT') AS has_tickets_select,
  pg_catalog.has_table_privilege(current_user, 'public.ticket_history', 'SELECT') AS has_history_select,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class candidate_relation
    JOIN pg_catalog.pg_namespace candidate_namespace ON candidate_namespace.oid = candidate_relation.relnamespace
    WHERE candidate_relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND candidate_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
      AND candidate_namespace.nspname NOT LIKE 'pg_toast%'
      AND candidate_namespace.nspname NOT LIKE 'pg_temp_%'
      AND (((candidate_namespace.nspname = 'public' AND candidate_relation.relname IN ('tickets', 'ticket_history'))
          AND (pg_catalog.has_table_privilege(current_user, candidate_relation.oid, 'INSERT')
            OR pg_catalog.has_table_privilege(current_user, candidate_relation.oid, 'UPDATE')
            OR pg_catalog.has_table_privilege(current_user, candidate_relation.oid, 'DELETE')
            OR pg_catalog.has_table_privilege(current_user, candidate_relation.oid, 'TRUNCATE')
            OR pg_catalog.has_table_privilege(current_user, candidate_relation.oid, 'REFERENCES')
            OR pg_catalog.has_table_privilege(current_user, candidate_relation.oid, 'TRIGGER')))
        OR ((candidate_namespace.nspname <> 'public' OR candidate_relation.relname NOT IN ('tickets', 'ticket_history'))
          AND (pg_catalog.has_table_privilege(current_user, candidate_relation.oid, 'SELECT')
            OR pg_catalog.has_table_privilege(current_user, candidate_relation.oid, 'INSERT')
            OR pg_catalog.has_table_privilege(current_user, candidate_relation.oid, 'UPDATE')
            OR pg_catalog.has_table_privilege(current_user, candidate_relation.oid, 'DELETE')
            OR pg_catalog.has_table_privilege(current_user, candidate_relation.oid, 'TRUNCATE')
            OR pg_catalog.has_table_privilege(current_user, candidate_relation.oid, 'REFERENCES')
            OR pg_catalog.has_table_privilege(current_user, candidate_relation.oid, 'TRIGGER'))))
  ) AS has_unexpected_relation_privilege,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid
  ) AS has_role_membership,
  EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg_toast%'
       AND n.nspname NOT LIKE 'pg_temp_%'
       AND c.relkind = 'S'
       AND (pg_catalog.has_sequence_privilege(current_user, c.oid, 'SELECT')
         OR pg_catalog.has_sequence_privilege(current_user, c.oid, 'USAGE')
         OR pg_catalog.has_sequence_privilege(current_user, c.oid, 'UPDATE'))
  ) AS has_sequence_privilege,
  EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg_toast%'
       AND n.nspname NOT LIKE 'pg_temp_%'
       AND pg_catalog.has_function_privilege(current_user, p.oid, 'EXECUTE')
  ) AS has_unexpected_function_execute
FROM pg_catalog.pg_roles r
WHERE r.rolname = current_user`;

const BOOLEAN_FIELDS = Object.freeze([
  "is_superuser", "can_create_database", "can_create_role", "can_replicate",
  "can_bypass_rls", "owns_database", "owns_non_system_schema",
  "owns_non_system_relation", "owns_non_system_function", "has_database_connect",
  "has_database_create", "has_database_temporary", "has_unexpected_database_privilege",
  "has_schema_usage", "has_unexpected_schema_privilege",
  "has_tickets_select", "has_history_select", "has_unexpected_relation_privilege",
  "has_role_membership", "has_sequence_privilege",
  "has_unexpected_function_execute",
]);

const RLS_SAFETY_SQL = `
SELECT
  c.relname::text AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  p.polname::text AS policy_name,
  p.polpermissive AS is_permissive,
  p.polcmd::text AS command,
  pg_catalog.pg_get_expr(p.polqual, p.polrelid, true)::text AS using_expression,
  CASE WHEN p.oid IS NULL THEN ARRAY[]::text[] ELSE ARRAY(
    SELECT CASE WHEN role_oid.oid = 0 THEN 'PUBLIC' ELSE policy_role.rolname::text END
    FROM unnest(p.polroles) role_oid(oid)
    LEFT JOIN pg_catalog.pg_roles policy_role ON policy_role.oid = role_oid.oid
    ORDER BY role_oid.oid
  ) END AS role_names
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_roles expected_role ON expected_role.rolname::text = $1::text
LEFT JOIN pg_catalog.pg_policy p ON p.polrelid = c.oid
  AND p.polcmd IN ('*', 'r')
  AND (0::oid = ANY(p.polroles) OR expected_role.oid = ANY(p.polroles))
WHERE n.nspname = 'public'
  AND c.relname IN ('tickets', 'ticket_history')
  AND c.relkind IN ('r', 'p')
ORDER BY c.relname, p.polname`;

const RLS_FIELDS = Object.freeze([
  "table_name", "rls_enabled", "rls_forced", "policy_name",
  "is_permissive", "command", "using_expression", "role_names",
]);

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DatabaseConfigurationError(`Missing ${label}`);
  }
  return value.trim();
}

function loadConnectionConfiguration({ env, expectedRole, expectedDatabase }) {
  if (!env || typeof env !== "object") {
    throw new DatabaseConfigurationError("Database environment is required");
  }
  const connectionString = requiredString(env[CONNECTION_ENVIRONMENT_KEY], CONNECTION_ENVIRONMENT_KEY);
  const roleName = requiredString(expectedRole === undefined ? env[ROLE_ENVIRONMENT_KEY] : expectedRole, ROLE_ENVIRONMENT_KEY);
  const databaseName = requiredString(expectedDatabase, "expectedDatabase adapter configuration");
  return Object.freeze({ connectionString, expectedRole: roleName, expectedDatabase: databaseName });
}

function defaultClientConstructor() {
  return require("pg").Client;
}

function constructClient(configuration, Client) {
  try {
    const ClientConstructor = Client || defaultClientConstructor();
    return new ClientConstructor({
      connectionString: configuration.connectionString,
      connectionTimeoutMillis: DEADLINES_MS.connect,
      query_timeout: DEADLINES_MS.query,
    });
  } catch (_) {
    throw new DatabaseConnectionError("Client construction failed");
  }
}

async function connectClient(client) {
  try {
    await boundedAwait(
      client.connect(),
      "connect",
      () => new DatabaseConnectionError("Database connection timed out")
    );
  } catch (_) {
    throw new DatabaseConnectionError("Database connection failed");
  }
}

async function verifyRoleSafety(client, expectedRole, expectedDatabase) {
  let result;
  try {
    result = await client.query({ text: ROLE_SAFETY_SQL, values: [] });
  } catch (_) {
    throw new DatabaseSafetyError("Role verification query failed");
  }
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new MalformedDatabaseResultError("Role verification result is malformed");
  }
  const row = result.rows[0];
  const expectedKeys = new Set(["database_name", "role_name", ...BOOLEAN_FIELDS]);
  if (!row || typeof row !== "object" || Reflect.ownKeys(row).length !== expectedKeys.size ||
      Reflect.ownKeys(row).some((key) => typeof key !== "string" || !expectedKeys.has(key)) ||
      typeof row.database_name !== "string" || typeof row.role_name !== "string" ||
      BOOLEAN_FIELDS.some((field) => typeof row[field] !== "boolean")) {
    throw new MalformedDatabaseResultError("Role verification row is malformed");
  }
  const unsafe = row.database_name !== expectedDatabase || row.role_name !== expectedRole || row.is_superuser || row.can_create_database ||
    row.can_create_role || row.can_replicate || row.can_bypass_rls || row.owns_database ||
    row.owns_non_system_schema || row.owns_non_system_relation || row.owns_non_system_function ||
    !row.has_database_connect || row.has_database_create || row.has_database_temporary ||
    row.has_unexpected_database_privilege || !row.has_schema_usage || row.has_unexpected_schema_privilege ||
    !row.has_tickets_select || !row.has_history_select || row.has_unexpected_relation_privilege ||
    row.has_role_membership || row.has_sequence_privilege ||
    row.has_unexpected_function_execute;
  if (unsafe) throw new DatabaseSafetyError("Connected role is not an approved audit role");
  return Object.freeze({ verified: true });
}

function validateRlsRow(row) {
  if (!row || typeof row !== "object" || Reflect.ownKeys(row).length !== RLS_FIELDS.length ||
      RLS_FIELDS.some((field) => !Object.hasOwn(row, field)) ||
      typeof row.table_name !== "string" || typeof row.rls_enabled !== "boolean" ||
      typeof row.rls_forced !== "boolean" || !Array.isArray(row.role_names) ||
      row.role_names.some((role) => typeof role !== "string")) {
    throw new MalformedDatabaseResultError("RLS verification row is malformed");
  }
  const hasPolicy = row.policy_name !== null;
  if (hasPolicy) {
    if (typeof row.policy_name !== "string" || typeof row.is_permissive !== "boolean" ||
        !["*", "r"].includes(row.command) ||
        (row.using_expression !== null && typeof row.using_expression !== "string") ||
        row.role_names.length === 0) {
      throw new MalformedDatabaseResultError("RLS policy metadata is malformed");
    }
  } else if (row.is_permissive !== null || row.command !== null ||
      row.using_expression !== null || row.role_names.length !== 0) {
    throw new MalformedDatabaseResultError("RLS policy metadata is malformed");
  }
  return row;
}

async function verifyRlsCompleteness(client, expectedRole) {
  let result;
  try {
    result = await client.query({ text: RLS_SAFETY_SQL, values: [expectedRole] });
  } catch (_) {
    throw new DatabaseSafetyError("RLS verification query failed");
  }
  if (!result || !Array.isArray(result.rows)) {
    throw new MalformedDatabaseResultError("RLS verification result is malformed");
  }
  const rows = result.rows.map(validateRlsRow);
  const expectedTables = ["ticket_history", "tickets"];
  for (const tableName of expectedTables) {
    const tableRows = rows.filter((row) => row.table_name === tableName);
    if (tableRows.length === 0 || tableRows.some((row) =>
      row.rls_enabled !== tableRows[0].rls_enabled || row.rls_forced !== tableRows[0].rls_forced) ||
      (!tableRows[0].rls_enabled && tableRows[0].rls_forced) ||
      new Set(tableRows.filter((row) => row.policy_name !== null).map((row) => row.policy_name)).size !==
        tableRows.filter((row) => row.policy_name !== null).length) {
      throw new MalformedDatabaseResultError("RLS table metadata is malformed");
    }
    if (!tableRows[0].rls_enabled) continue;
    const applicablePolicies = tableRows.filter((row) => row.policy_name !== null);
    const hasExactFullReadPolicy = applicablePolicies.some((row) =>
      row.is_permissive && row.using_expression === "true" && row.role_names.includes(expectedRole));
    const hasRestrictivePartialPolicy = applicablePolicies.some((row) =>
      !row.is_permissive && row.using_expression !== "true");
    if (!hasExactFullReadPolicy || hasRestrictivePartialPolicy) {
      throw new DatabaseSafetyError("Complete row visibility cannot be proven");
    }
  }
  if (rows.some((row) => !expectedTables.includes(row.table_name))) {
    throw new MalformedDatabaseResultError("RLS table metadata is malformed");
  }
  return Object.freeze({ verified: true });
}

module.exports = {
  CONNECTION_ENVIRONMENT_KEY,
  ROLE_ENVIRONMENT_KEY,
  ROLE_SAFETY_SQL,
  RLS_SAFETY_SQL,
  connectClient,
  constructClient,
  loadConnectionConfiguration,
  verifyRoleSafety,
  verifyRlsCompleteness,
};
