"use strict";

const { SafetyViolationError } = require("./errors");

const APPROVED_CONFIGURATION_KEYS = Object.freeze([
  "target",
  "mode",
  "productionAcknowledged",
]);
const APPROVED_CONFIGURATION_KEY_SET = new Set(APPROVED_CONFIGURATION_KEYS);

function deepFreeze(value) {
  Object.freeze(value);
  for (const nestedValue of Object.values(value)) {
    if (
      nestedValue !== null &&
      typeof nestedValue === "object" &&
      !Object.isFrozen(nestedValue)
    ) {
      deepFreeze(nestedValue);
    }
  }
  return value;
}

function enforceSafety(environment) {
  if (!environment || typeof environment !== "object") {
    throw new SafetyViolationError("Safety configuration is required");
  }
  const prototype = Object.getPrototypeOf(environment);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new SafetyViolationError("Safety configuration schema is not approved");
  }

  const keys = Reflect.ownKeys(environment);
  if (
    keys.length !== APPROVED_CONFIGURATION_KEYS.length ||
    keys.some(
      (key) =>
        typeof key !== "string" || !APPROVED_CONFIGURATION_KEY_SET.has(key)
    )
  ) {
    throw new SafetyViolationError("Safety configuration schema is not approved");
  }

  const hasInvalidDescriptor = APPROVED_CONFIGURATION_KEYS.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(environment, key);
    return !descriptor || !("value" in descriptor) || descriptor.enumerable !== true;
  });
  if (hasInvalidDescriptor) {
    throw new SafetyViolationError("Safety configuration schema is not approved");
  }

  if (environment.target !== "production") {
    throw new SafetyViolationError("AUDIT_TARGET must be production");
  }
  if (environment.mode !== "read-only") {
    throw new SafetyViolationError("AUDIT_MODE must be read-only");
  }
  if (environment.productionAcknowledged !== true) {
    throw new SafetyViolationError(
      "Production use must be explicitly acknowledged"
    );
  }
  return deepFreeze({
    target: "production",
    mode: "read-only",
    productionAcknowledged: true,
    capabilities: {
      readOnly: true,
      writesAllowed: false,
    },
  });
}

module.exports = {
  enforceSafety,
};
