"use strict";

const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  INTERNAL_ERROR: 1,
  USAGE_ERROR: 2,
  CONFIGURATION_ERROR: 3,
  SAFETY_VIOLATION: 4,
});

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  INTERNAL_ERROR: "Unexpected internal failure",
  USAGE_ERROR: "Invalid command or arguments",
  CONFIGURATION_ERROR: "Invalid production audit configuration",
  SAFETY_VIOLATION: "Production audit safety requirements were not satisfied",
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

module.exports = {
  AuditToolError,
  ConfigurationError,
  EXIT_CODES,
  PUBLIC_ERROR_MESSAGES,
  SafetyViolationError,
  UsageError,
  classifyError,
  publicErrorMessage,
};
