"use strict";

const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  INTERNAL_ERROR: 1,
  USAGE_ERROR: 2,
  CONFIGURATION_ERROR: 3,
  SAFETY_VIOLATION: 4,
  DATABASE_ERROR: 5,
});

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  INTERNAL_ERROR: "Unexpected internal failure",
  USAGE_ERROR: "Invalid command or arguments",
  CONFIGURATION_ERROR: "Invalid production audit configuration",
  SAFETY_VIOLATION: "Production audit safety requirements were not satisfied",
  DATABASE_CONFIGURATION_FAILURE: "Invalid audit database configuration",
  DATABASE_CONNECTION_FAILURE: "Audit database connection failed",
  DATABASE_SAFETY_FAILURE: "Audit database safety requirements were not satisfied",
  DATABASE_QUERY_FAILURE: "Audit database read failed",
  UNEXPECTED_SCHEMA: "Audit database schema was not as expected",
  MALFORMED_DATABASE_RESULT: "Audit database returned an invalid result",
  DATABASE_INPUT_FAILURE: "Invalid audit database operation input",
});

const TRUSTED_ERROR_CLASSIFICATIONS = Object.freeze({
  INTERNAL_ERROR: Object.freeze({
    publicCode: "INTERNAL_ERROR",
    publicMessage: PUBLIC_ERROR_MESSAGES.INTERNAL_ERROR,
    exitCode: EXIT_CODES.INTERNAL_ERROR,
  }),
  USAGE_ERROR: Object.freeze({
    publicCode: "USAGE_ERROR",
    publicMessage: PUBLIC_ERROR_MESSAGES.USAGE_ERROR,
    exitCode: EXIT_CODES.USAGE_ERROR,
  }),
  CONFIGURATION_ERROR: Object.freeze({
    publicCode: "CONFIGURATION_ERROR",
    publicMessage: PUBLIC_ERROR_MESSAGES.CONFIGURATION_ERROR,
    exitCode: EXIT_CODES.CONFIGURATION_ERROR,
  }),
  SAFETY_VIOLATION: Object.freeze({
    publicCode: "SAFETY_VIOLATION",
    publicMessage: PUBLIC_ERROR_MESSAGES.SAFETY_VIOLATION,
    exitCode: EXIT_CODES.SAFETY_VIOLATION,
  }),
  DATABASE_CONFIGURATION_FAILURE: Object.freeze({
    publicCode: "DATABASE_CONFIGURATION_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.DATABASE_CONFIGURATION_FAILURE,
    exitCode: EXIT_CODES.CONFIGURATION_ERROR,
  }),
  DATABASE_CONNECTION_FAILURE: Object.freeze({
    publicCode: "DATABASE_CONNECTION_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.DATABASE_CONNECTION_FAILURE,
    exitCode: EXIT_CODES.DATABASE_ERROR,
  }),
  DATABASE_SAFETY_FAILURE: Object.freeze({
    publicCode: "DATABASE_SAFETY_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.DATABASE_SAFETY_FAILURE,
    exitCode: EXIT_CODES.DATABASE_ERROR,
  }),
  DATABASE_QUERY_FAILURE: Object.freeze({
    publicCode: "DATABASE_QUERY_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.DATABASE_QUERY_FAILURE,
    exitCode: EXIT_CODES.DATABASE_ERROR,
  }),
  UNEXPECTED_SCHEMA: Object.freeze({
    publicCode: "UNEXPECTED_SCHEMA",
    publicMessage: PUBLIC_ERROR_MESSAGES.UNEXPECTED_SCHEMA,
    exitCode: EXIT_CODES.DATABASE_ERROR,
  }),
  MALFORMED_DATABASE_RESULT: Object.freeze({
    publicCode: "MALFORMED_DATABASE_RESULT",
    publicMessage: PUBLIC_ERROR_MESSAGES.MALFORMED_DATABASE_RESULT,
    exitCode: EXIT_CODES.DATABASE_ERROR,
  }),
  DATABASE_INPUT_FAILURE: Object.freeze({
    publicCode: "DATABASE_INPUT_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.DATABASE_INPUT_FAILURE,
    exitCode: EXIT_CODES.USAGE_ERROR,
  }),
});
const ERROR_CLASSIFICATION_TOKEN = Symbol("error-classification-token");
const ERROR_CLASSIFICATIONS = new WeakMap();

function publicErrorMessage(code) {
  return PUBLIC_ERROR_MESSAGES[code] || PUBLIC_ERROR_MESSAGES.INTERNAL_ERROR;
}

function classifyError(error) {
  return (
    ERROR_CLASSIFICATIONS.get(error) ||
    TRUSTED_ERROR_CLASSIFICATIONS.INTERNAL_ERROR
  );
}

class AuditToolError extends Error {
  constructor(message, { code, exitCode }, token, classificationName) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.exitCode = exitCode;
    if (
      token === ERROR_CLASSIFICATION_TOKEN &&
      Object.hasOwn(TRUSTED_ERROR_CLASSIFICATIONS, classificationName)
    ) {
      ERROR_CLASSIFICATIONS.set(
        this,
        TRUSTED_ERROR_CLASSIFICATIONS[classificationName]
      );
    }
  }
}

class ConfigurationError extends AuditToolError {
  constructor(message) {
    super(message, {
      code: "CONFIGURATION_ERROR",
      exitCode: EXIT_CODES.CONFIGURATION_ERROR,
    }, ERROR_CLASSIFICATION_TOKEN, "CONFIGURATION_ERROR");
  }
}

class SafetyViolationError extends AuditToolError {
  constructor(message) {
    super(message, {
      code: "SAFETY_VIOLATION",
      exitCode: EXIT_CODES.SAFETY_VIOLATION,
    }, ERROR_CLASSIFICATION_TOKEN, "SAFETY_VIOLATION");
  }
}

class UsageError extends AuditToolError {
  constructor(message) {
    super(message, {
      code: "USAGE_ERROR",
      exitCode: EXIT_CODES.USAGE_ERROR,
    }, ERROR_CLASSIFICATION_TOKEN, "USAGE_ERROR");
  }
}

function createClass(name, classificationName, exitCode) {
  return class extends AuditToolError {
    constructor(message) {
      super(message, { code: classificationName, exitCode }, ERROR_CLASSIFICATION_TOKEN, classificationName);
      this.name = name;
    }
  };
}

const DatabaseConfigurationError = createClass("DatabaseConfigurationError", "DATABASE_CONFIGURATION_FAILURE", EXIT_CODES.CONFIGURATION_ERROR);
const DatabaseConnectionError = createClass("DatabaseConnectionError", "DATABASE_CONNECTION_FAILURE", EXIT_CODES.DATABASE_ERROR);
const DatabaseSafetyError = createClass("DatabaseSafetyError", "DATABASE_SAFETY_FAILURE", EXIT_CODES.DATABASE_ERROR);
const DatabaseQueryError = createClass("DatabaseQueryError", "DATABASE_QUERY_FAILURE", EXIT_CODES.DATABASE_ERROR);
const UnexpectedSchemaError = createClass("UnexpectedSchemaError", "UNEXPECTED_SCHEMA", EXIT_CODES.DATABASE_ERROR);
const MalformedDatabaseResultError = createClass("MalformedDatabaseResultError", "MALFORMED_DATABASE_RESULT", EXIT_CODES.DATABASE_ERROR);
const DatabaseInputError = createClass("DatabaseInputError", "DATABASE_INPUT_FAILURE", EXIT_CODES.USAGE_ERROR);

module.exports = {
  AuditToolError,
  ConfigurationError,
  DatabaseConfigurationError,
  DatabaseConnectionError,
  DatabaseInputError,
  DatabaseQueryError,
  DatabaseSafetyError,
  EXIT_CODES,
  PUBLIC_ERROR_MESSAGES,
  SafetyViolationError,
  MalformedDatabaseResultError,
  UnexpectedSchemaError,
  UsageError,
  classifyError,
  publicErrorMessage,
};
