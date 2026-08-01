"use strict";

const {
  DatabaseConfigurationError,
  DatabaseConnectionError,
  DatabaseInputError,
  DatabaseQueryError,
  DatabaseSafetyError,
  MalformedDatabaseResultError,
  classifyError,
} = require("../errors");
const { verifyReadOnlyCapability } = require("../safety-kernel");
const { connectClient, constructClient, loadConnectionConfiguration, verifyRlsCompleteness, verifyRoleSafety } = require("./connection");
const { boundedAwait } = require("./bounded-await");
const { listHistoryPage, validateHistoryPageOptions } = require("./history");
const { inspectMetadata } = require("./metadata");
const { BEGIN_SQL, COMMIT_SQL, ROLLBACK_SQL, TIMEOUT_SQL, VERIFY_SQL } = require("./read-only-transaction");
const { inspectSchema } = require("./schema");
const { listTicketsPage, validateTicketPageOptions } = require("./tickets");

const OPERATIONS = Object.freeze({
  CONNECTION_SAFETY: "connection-safety",
  SCHEMA: "schema",
  TICKETS: "tickets",
  HISTORY: "history",
  METADATA: "metadata",
});

const TRUSTED_POSTGRES_SNAPSHOTS = new WeakSet();

function verifyTrustedPostgresSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !TRUSTED_POSTGRES_SNAPSHOTS.has(snapshot)) {
    throw new TypeError("PostgreSQL snapshot is not trusted");
  }
}

function isTrustedDatabaseInputError(error) {
  return classifyError(error).publicCode === "DATABASE_INPUT_FAILURE";
}

function fixedQuery(client, text) {
  return client.query({ text, values: [] });
}

function createBoundedQueryClient(client) {
  return Object.freeze({
    query(configuration) {
      let pending;
      try { pending = client.query(configuration); }
      catch (error) { return Promise.reject(error); }
      return boundedAwait(
        pending,
        "query",
        () => new DatabaseQueryError("Database query timed out")
      );
    },
  });
}

function executeFixedOperation(name, client, input, maximumPageSize) {
  switch (name) {
    case OPERATIONS.CONNECTION_SAFETY:
      return Object.freeze({ roleVerified: true, transactionReadOnly: true });
    case OPERATIONS.SCHEMA:
      return inspectSchema(client);
    case OPERATIONS.TICKETS:
      return listTicketsPage(client, input, maximumPageSize);
    case OPERATIONS.HISTORY:
      return listHistoryPage(client, input, maximumPageSize);
    case OPERATIONS.METADATA:
      return inspectMetadata(client);
    default:
      throw new DatabaseQueryError("Unapproved database operation");
  }
}

async function rollbackWithinDeadline(client) {
  let pending;
  try {
    pending = client.query({ text: ROLLBACK_SQL, values: [] });
  } catch (_) {
    return;
  }
  try {
    await boundedAwait(
      pending,
      "rollback",
      () => new DatabaseQueryError("Database rollback timed out")
    );
  } catch (_) {
    // The primary failure remains authoritative; client cleanup still follows.
  }
}

async function runClosedReadOnlyTransaction(rawClient, client, operationName, input, maximumPageSize) {
  let started = false;
  try {
    await fixedQuery(client, BEGIN_SQL);
    started = true;
    for (const text of TIMEOUT_SQL) await fixedQuery(client, text);
    const verification = await fixedQuery(client, VERIFY_SQL);
    if (!verification || !Array.isArray(verification.rows) || verification.rows.length !== 1 ||
        !verification.rows[0] || typeof verification.rows[0] !== "object" ||
        Reflect.ownKeys(verification.rows[0]).length !== 1 ||
        typeof verification.rows[0].transaction_read_only !== "string") {
      throw new MalformedDatabaseResultError("Read-only verification result is malformed");
    }
    if (verification.rows[0].transaction_read_only.toLowerCase() !== "on") {
      throw new DatabaseSafetyError("Transaction is not read only");
    }
    const snapshot = await executeFixedOperation(operationName, client, input, maximumPageSize);
    await fixedQuery(client, COMMIT_SQL);
    started = false;
    return snapshot;
  } catch (error) {
    if (started) await rollbackWithinDeadline(rawClient);
    if (isTrustedDatabaseInputError(error) || error instanceof DatabaseSafetyError || error instanceof MalformedDatabaseResultError ||
        error instanceof DatabaseQueryError) throw error;
    throw new DatabaseQueryError("Read-only transaction failed");
  }
}

function createPostgresAdapter({ safety, env = process.env, expectedRole, expectedDatabase, Client, maximumPageSize = 100 } = {}) {
  verifyReadOnlyCapability(safety);
  if (!Number.isSafeInteger(maximumPageSize) || maximumPageSize <= 0) {
    throw new DatabaseConfigurationError("Maximum page size is invalid");
  }

  async function session(operationName, input) {
    const configuration = loadConnectionConfiguration({ env, expectedRole, expectedDatabase });
    const client = constructClient(configuration, Client);
    const boundedClient = createBoundedQueryClient(client);
    let primaryFailure;
    try {
      await connectClient(client);
      await verifyRoleSafety(boundedClient, configuration.expectedRole, configuration.expectedDatabase);
      await verifyRlsCompleteness(boundedClient, configuration.expectedRole);
      const snapshot = await runClosedReadOnlyTransaction(
        client,
        boundedClient,
        operationName,
        input,
        maximumPageSize
      );
      TRUSTED_POSTGRES_SNAPSHOTS.add(snapshot);
      return snapshot;
    } catch (error) {
      primaryFailure = error;
      throw error;
    } finally {
      try {
        await boundedAwait(
          client.end(),
          "close",
          () => new DatabaseConnectionError("Database client cleanup timed out")
        );
      } catch (_) {
        if (!primaryFailure) throw new DatabaseConnectionError("Database client cleanup failed");
      }
    }
  }

  return Object.freeze({
    inspectConnectionSafety() {
      return session(OPERATIONS.CONNECTION_SAFETY);
    },
    inspectSchema() { return session(OPERATIONS.SCHEMA); },
    listTicketsPage(options) {
      let validated;
      try { validated = validateTicketPageOptions(options, maximumPageSize); }
      catch (error) {
        if (isTrustedDatabaseInputError(error)) return Promise.reject(error);
        return Promise.reject(new DatabaseInputError("Ticket page options are invalid"));
      }
      return session(OPERATIONS.TICKETS, validated);
    },
    listHistoryPage(options) {
      let validated;
      try { validated = validateHistoryPageOptions(options, maximumPageSize); }
      catch (error) {
        if (isTrustedDatabaseInputError(error)) return Promise.reject(error);
        return Promise.reject(new DatabaseInputError("History page options are invalid"));
      }
      return session(OPERATIONS.HISTORY, validated);
    },
    inspectMetadata() { return session(OPERATIONS.METADATA); },
  });
}

module.exports = { createPostgresAdapter, verifyTrustedPostgresSnapshot };
