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
  PARITY_ERROR: 8,
  REPORT_ERROR: 9,
  ORCHESTRATION_ERROR: 10,
  OUTPUT_ERROR: 11,
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
  NORMALIZATION_PROVENANCE_FAILURE: "Canonical normalization provenance could not be verified",
  NORMALIZATION_INCOMPLETE_POSTGRES: "PostgreSQL canonical pagination is incomplete",
  NORMALIZATION_INVALID_PAGE_SET: "The PostgreSQL canonical page set is invalid",
  NORMALIZATION_INCOMPLETE_SHEETS: "The Google Sheets canonical result is incomplete",
  NORMALIZATION_BUNDLE_LIMIT_EXCEEDED: "Canonical bundle assembly exceeded a fixed safety limit",
  NORMALIZATION_BUNDLE_CONSISTENCY_FAILURE: "Canonical bundle consistency verification failed",
  PARITY_UNTRUSTED_INPUT: "Parity comparison requires a trusted canonical bundle",
  PARITY_UNSUPPORTED_INPUT: "The canonical bundle is not supported for parity comparison",
  PARITY_INVALID_RECORD: "The canonical bundle contains an invalid parity record",
  PARITY_IDENTITY_FAILURE: "A parity identity could not be processed safely",
  PARITY_LIMIT_EXCEEDED: "Parity comparison exceeded a fixed safety limit",
  PARITY_INTERNAL_CONSISTENCY_FAILURE: "Parity consistency verification failed",
  REPORT_UNTRUSTED_INPUT: "Audit reporting requires a trusted parity result",
  REPORT_UNSUPPORTED_INPUT: "The parity result is not supported for audit reporting",
  REPORT_INVALID_FINDING: "The parity result contains an invalid finding",
  REPORT_INVALID_SUMMARY: "The parity result contains an invalid summary",
  REPORT_LIMIT_EXCEEDED: "Audit report construction exceeded a fixed safety limit",
  REPORT_INTERNAL_CONSISTENCY_FAILURE: "Audit report consistency verification failed",
  ORCHESTRATION_FAILURE: "Audit orchestration failed",
  ORCHESTRATION_PAGINATION_FAILURE: "PostgreSQL audit pagination failed",
  OUTPUT_UNTRUSTED_INPUT: "Output rendering requires a trusted completed audit result",
  OUTPUT_UNSUPPORTED_FORMAT: "The requested audit output format is not supported",
  OUTPUT_RENDER_FAILURE: "Audit output rendering failed",
  OUTPUT_LIMIT_EXCEEDED: "Audit output exceeded a fixed safety limit",
  OUTPUT_INTERNAL_CONSISTENCY_FAILURE: "Audit output consistency verification failed",
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
  NORMALIZATION_PROVENANCE_FAILURE: Object.freeze({
    publicCode: "NORMALIZATION_PROVENANCE_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.NORMALIZATION_PROVENANCE_FAILURE,
    exitCode: EXIT_CODES.NORMALIZATION_ERROR,
  }),
  NORMALIZATION_INCOMPLETE_POSTGRES: Object.freeze({
    publicCode: "NORMALIZATION_INCOMPLETE_POSTGRES",
    publicMessage: PUBLIC_ERROR_MESSAGES.NORMALIZATION_INCOMPLETE_POSTGRES,
    exitCode: EXIT_CODES.NORMALIZATION_ERROR,
  }),
  NORMALIZATION_INVALID_PAGE_SET: Object.freeze({
    publicCode: "NORMALIZATION_INVALID_PAGE_SET",
    publicMessage: PUBLIC_ERROR_MESSAGES.NORMALIZATION_INVALID_PAGE_SET,
    exitCode: EXIT_CODES.NORMALIZATION_ERROR,
  }),
  NORMALIZATION_INCOMPLETE_SHEETS: Object.freeze({
    publicCode: "NORMALIZATION_INCOMPLETE_SHEETS",
    publicMessage: PUBLIC_ERROR_MESSAGES.NORMALIZATION_INCOMPLETE_SHEETS,
    exitCode: EXIT_CODES.NORMALIZATION_ERROR,
  }),
  NORMALIZATION_BUNDLE_LIMIT_EXCEEDED: Object.freeze({
    publicCode: "NORMALIZATION_BUNDLE_LIMIT_EXCEEDED",
    publicMessage: PUBLIC_ERROR_MESSAGES.NORMALIZATION_BUNDLE_LIMIT_EXCEEDED,
    exitCode: EXIT_CODES.NORMALIZATION_ERROR,
  }),
  NORMALIZATION_BUNDLE_CONSISTENCY_FAILURE: Object.freeze({
    publicCode: "NORMALIZATION_BUNDLE_CONSISTENCY_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.NORMALIZATION_BUNDLE_CONSISTENCY_FAILURE,
    exitCode: EXIT_CODES.NORMALIZATION_ERROR,
  }),
  PARITY_UNTRUSTED_INPUT: Object.freeze({
    publicCode: "PARITY_UNTRUSTED_INPUT",
    publicMessage: PUBLIC_ERROR_MESSAGES.PARITY_UNTRUSTED_INPUT,
    exitCode: EXIT_CODES.PARITY_ERROR,
  }),
  PARITY_UNSUPPORTED_INPUT: Object.freeze({
    publicCode: "PARITY_UNSUPPORTED_INPUT",
    publicMessage: PUBLIC_ERROR_MESSAGES.PARITY_UNSUPPORTED_INPUT,
    exitCode: EXIT_CODES.PARITY_ERROR,
  }),
  PARITY_INVALID_RECORD: Object.freeze({
    publicCode: "PARITY_INVALID_RECORD",
    publicMessage: PUBLIC_ERROR_MESSAGES.PARITY_INVALID_RECORD,
    exitCode: EXIT_CODES.PARITY_ERROR,
  }),
  PARITY_IDENTITY_FAILURE: Object.freeze({
    publicCode: "PARITY_IDENTITY_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.PARITY_IDENTITY_FAILURE,
    exitCode: EXIT_CODES.PARITY_ERROR,
  }),
  PARITY_LIMIT_EXCEEDED: Object.freeze({
    publicCode: "PARITY_LIMIT_EXCEEDED",
    publicMessage: PUBLIC_ERROR_MESSAGES.PARITY_LIMIT_EXCEEDED,
    exitCode: EXIT_CODES.PARITY_ERROR,
  }),
  PARITY_INTERNAL_CONSISTENCY_FAILURE: Object.freeze({
    publicCode: "PARITY_INTERNAL_CONSISTENCY_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.PARITY_INTERNAL_CONSISTENCY_FAILURE,
    exitCode: EXIT_CODES.PARITY_ERROR,
  }),
  REPORT_UNTRUSTED_INPUT: Object.freeze({
    publicCode: "REPORT_UNTRUSTED_INPUT",
    publicMessage: PUBLIC_ERROR_MESSAGES.REPORT_UNTRUSTED_INPUT,
    exitCode: EXIT_CODES.REPORT_ERROR,
  }),
  REPORT_UNSUPPORTED_INPUT: Object.freeze({
    publicCode: "REPORT_UNSUPPORTED_INPUT",
    publicMessage: PUBLIC_ERROR_MESSAGES.REPORT_UNSUPPORTED_INPUT,
    exitCode: EXIT_CODES.REPORT_ERROR,
  }),
  REPORT_INVALID_FINDING: Object.freeze({
    publicCode: "REPORT_INVALID_FINDING",
    publicMessage: PUBLIC_ERROR_MESSAGES.REPORT_INVALID_FINDING,
    exitCode: EXIT_CODES.REPORT_ERROR,
  }),
  REPORT_INVALID_SUMMARY: Object.freeze({
    publicCode: "REPORT_INVALID_SUMMARY",
    publicMessage: PUBLIC_ERROR_MESSAGES.REPORT_INVALID_SUMMARY,
    exitCode: EXIT_CODES.REPORT_ERROR,
  }),
  REPORT_LIMIT_EXCEEDED: Object.freeze({
    publicCode: "REPORT_LIMIT_EXCEEDED",
    publicMessage: PUBLIC_ERROR_MESSAGES.REPORT_LIMIT_EXCEEDED,
    exitCode: EXIT_CODES.REPORT_ERROR,
  }),
  REPORT_INTERNAL_CONSISTENCY_FAILURE: Object.freeze({
    publicCode: "REPORT_INTERNAL_CONSISTENCY_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.REPORT_INTERNAL_CONSISTENCY_FAILURE,
    exitCode: EXIT_CODES.REPORT_ERROR,
  }),
  ORCHESTRATION_FAILURE: Object.freeze({
    publicCode: "ORCHESTRATION_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.ORCHESTRATION_FAILURE,
    exitCode: EXIT_CODES.ORCHESTRATION_ERROR,
  }),
  ORCHESTRATION_PAGINATION_FAILURE: Object.freeze({
    publicCode: "ORCHESTRATION_PAGINATION_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.ORCHESTRATION_PAGINATION_FAILURE,
    exitCode: EXIT_CODES.ORCHESTRATION_ERROR,
  }),
  OUTPUT_UNTRUSTED_INPUT: Object.freeze({
    publicCode: "OUTPUT_UNTRUSTED_INPUT",
    publicMessage: PUBLIC_ERROR_MESSAGES.OUTPUT_UNTRUSTED_INPUT,
    exitCode: EXIT_CODES.OUTPUT_ERROR,
  }),
  OUTPUT_UNSUPPORTED_FORMAT: Object.freeze({
    publicCode: "OUTPUT_UNSUPPORTED_FORMAT",
    publicMessage: PUBLIC_ERROR_MESSAGES.OUTPUT_UNSUPPORTED_FORMAT,
    exitCode: EXIT_CODES.OUTPUT_ERROR,
  }),
  OUTPUT_RENDER_FAILURE: Object.freeze({
    publicCode: "OUTPUT_RENDER_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.OUTPUT_RENDER_FAILURE,
    exitCode: EXIT_CODES.OUTPUT_ERROR,
  }),
  OUTPUT_LIMIT_EXCEEDED: Object.freeze({
    publicCode: "OUTPUT_LIMIT_EXCEEDED",
    publicMessage: PUBLIC_ERROR_MESSAGES.OUTPUT_LIMIT_EXCEEDED,
    exitCode: EXIT_CODES.OUTPUT_ERROR,
  }),
  OUTPUT_INTERNAL_CONSISTENCY_FAILURE: Object.freeze({
    publicCode: "OUTPUT_INTERNAL_CONSISTENCY_FAILURE",
    publicMessage: PUBLIC_ERROR_MESSAGES.OUTPUT_INTERNAL_CONSISTENCY_FAILURE,
    exitCode: EXIT_CODES.OUTPUT_ERROR,
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
const NormalizationProvenanceError = createClass("NormalizationProvenanceError", "NORMALIZATION_PROVENANCE_FAILURE", EXIT_CODES.NORMALIZATION_ERROR);
const NormalizationIncompletePostgresError = createClass("NormalizationIncompletePostgresError", "NORMALIZATION_INCOMPLETE_POSTGRES", EXIT_CODES.NORMALIZATION_ERROR);
const NormalizationInvalidPageSetError = createClass("NormalizationInvalidPageSetError", "NORMALIZATION_INVALID_PAGE_SET", EXIT_CODES.NORMALIZATION_ERROR);
const NormalizationIncompleteSheetsError = createClass("NormalizationIncompleteSheetsError", "NORMALIZATION_INCOMPLETE_SHEETS", EXIT_CODES.NORMALIZATION_ERROR);
const NormalizationBundleLimitError = createClass("NormalizationBundleLimitError", "NORMALIZATION_BUNDLE_LIMIT_EXCEEDED", EXIT_CODES.NORMALIZATION_ERROR);
const NormalizationBundleConsistencyError = createClass("NormalizationBundleConsistencyError", "NORMALIZATION_BUNDLE_CONSISTENCY_FAILURE", EXIT_CODES.NORMALIZATION_ERROR);
const ParityUntrustedInputError = createClass("ParityUntrustedInputError", "PARITY_UNTRUSTED_INPUT", EXIT_CODES.PARITY_ERROR);
const ParityUnsupportedInputError = createClass("ParityUnsupportedInputError", "PARITY_UNSUPPORTED_INPUT", EXIT_CODES.PARITY_ERROR);
const ParityInvalidRecordError = createClass("ParityInvalidRecordError", "PARITY_INVALID_RECORD", EXIT_CODES.PARITY_ERROR);
const ParityIdentityError = createClass("ParityIdentityError", "PARITY_IDENTITY_FAILURE", EXIT_CODES.PARITY_ERROR);
const ParityLimitError = createClass("ParityLimitError", "PARITY_LIMIT_EXCEEDED", EXIT_CODES.PARITY_ERROR);
const ParityInternalConsistencyError = createClass("ParityInternalConsistencyError", "PARITY_INTERNAL_CONSISTENCY_FAILURE", EXIT_CODES.PARITY_ERROR);
const ReportUntrustedInputError = createClass("ReportUntrustedInputError", "REPORT_UNTRUSTED_INPUT", EXIT_CODES.REPORT_ERROR);
const ReportUnsupportedInputError = createClass("ReportUnsupportedInputError", "REPORT_UNSUPPORTED_INPUT", EXIT_CODES.REPORT_ERROR);
const ReportInvalidFindingError = createClass("ReportInvalidFindingError", "REPORT_INVALID_FINDING", EXIT_CODES.REPORT_ERROR);
const ReportInvalidSummaryError = createClass("ReportInvalidSummaryError", "REPORT_INVALID_SUMMARY", EXIT_CODES.REPORT_ERROR);
const ReportLimitError = createClass("ReportLimitError", "REPORT_LIMIT_EXCEEDED", EXIT_CODES.REPORT_ERROR);
const ReportInternalConsistencyError = createClass("ReportInternalConsistencyError", "REPORT_INTERNAL_CONSISTENCY_FAILURE", EXIT_CODES.REPORT_ERROR);
const OrchestrationError = createClass("OrchestrationError", "ORCHESTRATION_FAILURE", EXIT_CODES.ORCHESTRATION_ERROR);
const OrchestrationPaginationError = createClass("OrchestrationPaginationError", "ORCHESTRATION_PAGINATION_FAILURE", EXIT_CODES.ORCHESTRATION_ERROR);
const OutputUntrustedInputError = createClass("OutputUntrustedInputError", "OUTPUT_UNTRUSTED_INPUT", EXIT_CODES.OUTPUT_ERROR);
const OutputUnsupportedFormatError = createClass("OutputUnsupportedFormatError", "OUTPUT_UNSUPPORTED_FORMAT", EXIT_CODES.OUTPUT_ERROR);
const OutputRenderError = createClass("OutputRenderError", "OUTPUT_RENDER_FAILURE", EXIT_CODES.OUTPUT_ERROR);
const OutputLimitError = createClass("OutputLimitError", "OUTPUT_LIMIT_EXCEEDED", EXIT_CODES.OUTPUT_ERROR);
const OutputInternalConsistencyError = createClass("OutputInternalConsistencyError", "OUTPUT_INTERNAL_CONSISTENCY_FAILURE", EXIT_CODES.OUTPUT_ERROR);

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
  NormalizationProvenanceError,
  NormalizationIncompletePostgresError,
  NormalizationInvalidPageSetError,
  NormalizationIncompleteSheetsError,
  NormalizationBundleLimitError,
  NormalizationBundleConsistencyError,
  NormalizationInvalidFieldError,
  NormalizationLimitError,
  NormalizationMalformedRecordError,
  NormalizationUnsupportedSnapshotError,
  NormalizationUntrustedSnapshotError,
  ParityUntrustedInputError,
  ParityUnsupportedInputError,
  ParityInvalidRecordError,
  ParityIdentityError,
  ParityLimitError,
  ParityInternalConsistencyError,
  ReportUntrustedInputError,
  ReportUnsupportedInputError,
  ReportInvalidFindingError,
  ReportInvalidSummaryError,
  ReportLimitError,
  ReportInternalConsistencyError,
  OrchestrationError,
  OrchestrationPaginationError,
  OutputUntrustedInputError,
  OutputUnsupportedFormatError,
  OutputRenderError,
  OutputLimitError,
  OutputInternalConsistencyError,
  UnexpectedSchemaError,
  UsageError,
  classifyError,
  publicErrorMessage,
};
