"use strict";

const { ConfigurationError, SafetyViolationError } = require("./errors");

const ENVIRONMENT_KEYS = Object.freeze({
  target: "AUDIT_TARGET",
  mode: "AUDIT_MODE",
  productionAcknowledged: "AUDIT_PRODUCTION_ACKNOWLEDGED",
  allowWrites: "AUDIT_ALLOW_WRITES",
});

function requiredValue(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigurationError(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function booleanValue(env, name, { required, defaultValue = false }) {
  const value = env[name];
  if (value === undefined || value === "") {
    if (required) {
      throw new ConfigurationError(`Missing required environment variable: ${name}`);
    }
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new ConfigurationError(`${name} must be either true or false`);
}

function loadEnvironment(env = process.env) {
  if (!env || typeof env !== "object") {
    throw new ConfigurationError("Environment must be an object");
  }

  const configuration = {
    target: requiredValue(env, ENVIRONMENT_KEYS.target).toLowerCase(),
    mode: requiredValue(env, ENVIRONMENT_KEYS.mode).toLowerCase(),
    productionAcknowledged: booleanValue(
      env,
      ENVIRONMENT_KEYS.productionAcknowledged,
      { required: true }
    ),
  };
  const allowWrites = booleanValue(env, ENVIRONMENT_KEYS.allowWrites, {
    required: false,
    defaultValue: false,
  });

  if (allowWrites) {
    throw new SafetyViolationError("Write-capable configuration is prohibited");
  }

  return Object.freeze(configuration);
}

module.exports = {
  ENVIRONMENT_KEYS,
  loadEnvironment,
};
