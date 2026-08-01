"use strict";

const BEGIN_SQL = "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY";
const TIMEOUT_SQL = Object.freeze([
  "SET LOCAL statement_timeout = '15s'",
  "SET LOCAL lock_timeout = '2s'",
  "SET LOCAL idle_in_transaction_session_timeout = '30s'",
]);
const VERIFY_SQL = "SHOW transaction_read_only";
const COMMIT_SQL = "COMMIT";
const ROLLBACK_SQL = "ROLLBACK";

module.exports = Object.freeze({ BEGIN_SQL, COMMIT_SQL, ROLLBACK_SQL, TIMEOUT_SQL, VERIFY_SQL });
