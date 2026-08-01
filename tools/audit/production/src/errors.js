"use strict";

const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  INTERNAL_ERROR: 1,
  USAGE_ERROR: 2,
  CONFIGURATION_ERROR: 3,
  SAFETY_VIOLATION: 4,
  DATABASE_ERROR: 5,
  SHEETS_ERROR: 6,
  NORMALIZATION_ERROR: 7,
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
  SHEETS_CONFIGURATION_FAILURE: "Invalid audit Sheets configuration",
  SHEETS_CREDENTIAL_FAILURE: "Invalid audit Sheets credentials",
  SHEETS_AUTHENTICATION_FAILURE: "Audit Sheets authentication failed",
  SHEETS_PERMISSION_DENIED: "Audit Sheets access was denied",
  SHEETS_NOT_FOUND: "Configured audit Sheet was not found",
  SHEETS_INVALID_RANGE: "Configured audit Sheet range was invalid",
  SHEETS_RATE_LIMITED: "Audit Sheets request was rate limited",
  SHEETS_TIMEOUT: "Audit Sheets request timed out",
  MALFORMED_SHEETS_RESPONSE: "Google Sheets returned an invalid response",
  UNEXPECTED_SHEET_STRUCTURE: "Google Sheet structure was not as expected",
  SHEETS_INPUT_FAILURE: "Invalid audit Sheets operation input",
  NORMALIZATION_UNTRUSTED_SNAPSHOT: "Normalization requires a trusted source snapshot",
  NORMALIZATION_UNSUPPORTED_SNAPSHOT: "The trusted source snapshot is not supported for normalization",
  NORMALIZATION_MALFORMED_RECORD: "A trusted source record is malformed",
  NORMALIZATION_INVALID_FIELD: "A source field cannot be normalized safely",
  NORMALIZATION_LIMIT_EXCEEDED: "Normalization exceeded a fixed safety limit",
  NORMALIZATION_DATE_FAILURE: "A source date cannot be normalized safely",
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
  SHEETS_CONFIGURATION_FAILURE: Object.freeze({
    publicCode: "SHEETS_CONFIGURATION_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.SHEETS_CONFIGURATION_FAILURE,
    exitCode: EXIT_CODES.CONFIGURATION_ERROR,
  }),
  SHEETS_CREDENTIAL_FAILURE: Object.freeze({
    publicCode: "SHEETS_CREDENTIAL_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.SHEETS_CREDENTIAL_FAILURE,
    exitCode: EXIT_CODES.CONFIGURATION_ERROR,
  }),
  SHEETS_AUTHENTICATION_FAILURE: Object.freeze({
    publicCode: "SHEETS_AUTHENTICATION_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.SHEETS_AUTHENTICATION_FAILURE,
    exitCode: EXIT_CODES.SHEETS_ERROR,
  }),
  SHEETS_PERMISSION_DENIED: Object.freeze({
    publicCode: "SHEETS_PERMISSION_DENIED",
    publicMessage: PUBLIC_ERROR_MESSAGES.SHEETS_PERMISSION_DENIED,
    exitCode: EXIT_CODES.SHEETS_ERROR,
  }),
  SHEETS_NOT_FOUND: Object.freeze({
    publicCode: "SHEETS_NOT_FOUND",
    publicMessage: PUBLIC_ERROR_MESSAGES.SHEETS_NOT_FOUND,
    exitCode: EXIT_CODES.SHEETS_ERROR,
  }),
  SHEETS_INVALID_RANGE: Object.freeze({
    publicCode: "SHEETS_INVALID_RANGE",
    publicMessage: PUBLIC_ERROR_MESSAGES.SHEETS_INVALID_RANGE,
    exitCode: EXIT_CODES.SHEETS_ERROR,
  }),
  SHEETS_RATE_LIMITED: Object.freeze({
    publicCode: "SHEETS_RATE_LIMITED",
    publicMessage: PUBLIC_ERROR_MESSAGES.SHEETS_RATE_LIMITED,
    exitCode: EXIT_CODES.SHEETS_ERROR,
  }),
  SHEETS_TIMEOUT: Object.freeze({
    publicCode: "SHEETS_TIMEOUT",
    publicMessage: PUBLIC_ERROR_MESSAGES.SHEETS_TIMEOUT,
    exitCode: EXIT_CODES.SHEETS_ERROR,
  }),
  MALFORMED_SHEETS_RESPONSE: Object.freeze({
    publicCode: "MALFORMED_SHEETS_RESPONSE",
    publicMessage: PUBLIC_ERROR_MESSAGES.MALFORMED_SHEETS_RESPONSE,
    exitCode: EXIT_CODES.SHEETS_ERROR,
  }),
  UNEXPECTED_SHEET_STRUCTURE: Object.freeze({
    publicCode: "UNEXPECTED_SHEET_STRUCTURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.UNEXPECTED_SHEET_STRUCTURE,
    exitCode: EXIT_CODES.SHEETS_ERROR,
  }),
  SHEETS_INPUT_FAILURE: Object.freeze({
    publicCode: "SHEETS_INPUT_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.SHEETS_INPUT_FAILURE,
    exitCode: EXIT_CODES.USAGE_ERROR,
  }),
  NORMALIZATION_UNTRUSTED_SNAPSHOT: Object.freeze({
    publicCode: "NORMALIZATION_UNTRUSTED_SNAPSHOT",
    publicMessage: PUBLIC_ERROR_MESSAGES.NORMALIZATION_UNTRUSTED_SNAPSHOT,
    exitCode: EXIT_CODES.NORMALIZATION_ERROR,
  }),
  NORMALIZATION_UNSUPPORTED_SNAPSHOT: Object.freeze({
    publicCode: "NORMALIZATION_UNSUPPORTED_SNAPSHOT",
    publicMessage: PUBLIC_ERROR_MESSAGES.NORMALIZATION_UNSUPPORTED_SNAPSHOT,
    exitCode: EXIT_CODES.NORMALIZATION_ERROR,
  }),
  NORMALIZATION_MALFORMED_RECORD: Object.freeze({
    publicCode: "NORMALIZATION_MALFORMED_RECORD",
    publicMessage: PUBLIC_ERROR_MESSAGES.NORMALIZATION_MALFORMED_RECORD,
    exitCode: EXIT_CODES.NORMALIZATION_ERROR,
  }),
  NORMALIZATION_INVALID_FIELD: Object.freeze({
    publicCode: "NORMALIZATION_INVALID_FIELD",
    publicMessage: PUBLIC_ERROR_MESSAGES.NORMALIZATION_INVALID_FIELD,
    exitCode: EXIT_CODES.NORMALIZATION_ERROR,
  }),
  NORMALIZATION_LIMIT_EXCEEDED: Object.freeze({
    publicCode: "NORMALIZATION_LIMIT_EXCEEDED",
    publicMessage: PUBLIC_ERROR_MESSAGES.NORMALIZATION_LIMIT_EXCEEDED,
    exitCode: EXIT_CODES.NORMALIZATION_ERROR,
  }),
  NORMALIZATION_DATE_FAILURE: Object.freeze({
    publicCode: "NORMALIZATION_DATE_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.NORMALIZATION_DATE_FAILURE,
    exitCode: EXIT_CODES.NORMALIZATION_ERROR,
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
const SheetsConfigurationError = createClass("SheetsConfigurationError", "SHEETS_CONFIGURATION_FAILURE", EXIT_CODES.CONFIGURATION_ERROR);
const SheetsCredentialError = createClass("SheetsCredentialError", "SHEETS_CREDENTIAL_FAILURE", EXIT_CODES.CONFIGURATION_ERROR);
const SheetsAuthenticationError = createClass("SheetsAuthenticationError", "SHEETS_AUTHENTICATION_FAILURE", EXIT_CODES.SHEETS_ERROR);
const SheetsPermissionError = createClass("SheetsPermissionError", "SHEETS_PERMISSION_DENIED", EXIT_CODES.SHEETS_ERROR);
const SheetsNotFoundError = createClass("SheetsNotFoundError", "SHEETS_NOT_FOUND", EXIT_CODES.SHEETS_ERROR);
const SheetsInvalidRangeError = createClass("SheetsInvalidRangeError", "SHEETS_INVALID_RANGE", EXIT_CODES.SHEETS_ERROR);
const SheetsRateLimitError = createClass("SheetsRateLimitError", "SHEETS_RATE_LIMITED", EXIT_CODES.SHEETS_ERROR);
const SheetsTimeoutError = createClass("SheetsTimeoutError", "SHEETS_TIMEOUT", EXIT_CODES.SHEETS_ERROR);
const MalformedSheetsResponseError = createClass("MalformedSheetsResponseError", "MALFORMED_SHEETS_RESPONSE", EXIT_CODES.SHEETS_ERROR);
const UnexpectedSheetStructureError = createClass("UnexpectedSheetStructureError", "UNEXPECTED_SHEET_STRUCTURE", EXIT_CODES.SHEETS_ERROR);
const SheetsInputError = createClass("SheetsInputError", "SHEETS_INPUT_FAILURE", EXIT_CODES.USAGE_ERROR);
const NormalizationUntrustedSnapshotError = createClass("NormalizationUntrustedSnapshotError", "NORMALIZATION_UNTRUSTED_SNAPSHOT", EXIT_CODES.NORMALIZATION_ERROR);
const NormalizationUnsupportedSnapshotError = createClass("NormalizationUnsupportedSnapshotError", "NORMALIZATION_UNSUPPORTED_SNAPSHOT", EXIT_CODES.NORMALIZATION_ERROR);
const NormalizationMalformedRecordError = createClass("NormalizationMalformedRecordError", "NORMALIZATION_MALFORMED_RECORD", EXIT_CODES.NORMALIZATION_ERROR);
const NormalizationInvalidFieldError = createClass("NormalizationInvalidFieldError", "NORMALIZATION_INVALID_FIELD", EXIT_CODES.NORMALIZATION_ERROR);
const NormalizationLimitError = createClass("NormalizationLimitError", "NORMALIZATION_LIMIT_EXCEEDED", EXIT_CODES.NORMALIZATION_ERROR);
const NormalizationDateError = createClass("NormalizationDateError", "NORMALIZATION_DATE_FAILURE", EXIT_CODES.NORMALIZATION_ERROR);

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
  SheetsAuthenticationError,
  SheetsConfigurationError,
  SheetsCredentialError,
  SheetsInputError,
  SheetsInvalidRangeError,
  SheetsNotFoundError,
  SheetsPermissionError,
  SheetsRateLimitError,
  SheetsTimeoutError,
  MalformedSheetsResponseError,
  UnexpectedSheetStructureError,
  MalformedDatabaseResultError,
  NormalizationDateError,
  NormalizationInvalidFieldError,
  NormalizationLimitError,
  NormalizationMalformedRecordError,
  NormalizationUnsupportedSnapshotError,
  NormalizationUntrustedSnapshotError,
  UnexpectedSchemaError,
  UsageError,
  classifyError,
  publicErrorMessage,
};
