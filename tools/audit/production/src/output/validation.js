"use strict";

const { types } = require("node:util");
const {
  OutputInternalConsistencyError,
  OutputUnsupportedFormatError,
  OutputUntrustedInputError,
  classifyError,
} = require("../errors");
const { verifyTrustedAuditResult } = require("../orchestrator/result");
const { formatPolicy } = require("./policy");
const { validateText } = require("./escaping");

function ownData(object, key, ErrorClass = OutputInternalConsistencyError) {
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(object, key); } catch (_) {
    throw new ErrorClass("Output data is invalid");
  }
  if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true ||
      descriptor.writable !== false || descriptor.configurable !== false) {
    throw new ErrorClass("Output data is invalid");
  }
  return descriptor.value;
}

function exactFrozenNullObject(value, keys, ErrorClass = OutputInternalConsistencyError) {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== null ||
      !Object.isFrozen(value)) throw new ErrorClass("Output data is invalid");
  let actual;
  try { actual = Reflect.ownKeys(value); } catch (_) { throw new ErrorClass("Output data is invalid"); }
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new ErrorClass("Output data is invalid");
  }
  for (const key of keys) ownData(value, key, ErrorClass);
  return value;
}

function validateFormat(format) {
  const policy = formatPolicy(format);
  if (!policy) throw new OutputUnsupportedFormatError("Unsupported output format");
  return policy;
}

function validateAuditResult(result) {
  try { verifyTrustedAuditResult(result); } catch (error) {
    if (classifyError(error).publicCode !== "INTERNAL_ERROR") throw error;
    throw new OutputUntrustedInputError("Untrusted audit result");
  }
  exactFrozenNullObject(result, ["report", "summary", "statistics", "metadata"], OutputUntrustedInputError);
  const metadata = ownData(result, "metadata", OutputUntrustedInputError);
  exactFrozenNullObject(metadata, ["schemaVersion", "executionVersion", "completed"], OutputUntrustedInputError);
  if (ownData(metadata, "schemaVersion", OutputUntrustedInputError) !== "1" ||
      ownData(metadata, "executionVersion", OutputUntrustedInputError) !== "1" ||
      ownData(metadata, "completed", OutputUntrustedInputError) !== true) {
    throw new OutputUntrustedInputError("Incomplete audit result");
  }
  return result;
}

function validateJsonGraph(value, active = new WeakSet()) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return validateText(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new OutputInternalConsistencyError("JSON number is invalid");
    return value;
  }
  if (!value || typeof value !== "object" || types.isProxy(value) || active.has(value) || !Object.isFrozen(value)) {
    throw new OutputInternalConsistencyError("JSON graph is invalid");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && !(Array.isArray(value) && prototype === Array.prototype)) {
    throw new OutputInternalConsistencyError("JSON graph prototype is invalid");
  }
  let keys;
  try { keys = Reflect.ownKeys(value); } catch (_) { throw new OutputInternalConsistencyError("JSON graph is invalid"); }
  if (keys.some((key) => typeof key !== "string")) throw new OutputInternalConsistencyError("JSON graph key is invalid");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (keys.length !== value.length + 1 || keys.at(-1) !== "length") throw new OutputInternalConsistencyError("JSON array is invalid");
      for (let index = 0; index < value.length; index += 1) {
        if (keys[index] !== String(index)) throw new OutputInternalConsistencyError("JSON array is invalid");
        validateJsonGraph(ownData(value, String(index)), active);
      }
    } else {
      for (const key of keys) {
        validateText(key);
        validateJsonGraph(ownData(value, key), active);
      }
    }
  } finally {
    active.delete(value);
  }
  return value;
}

for (const operation of [ownData, exactFrozenNullObject, validateAuditResult, validateFormat, validateJsonGraph]) {
  Object.freeze(operation);
}

module.exports = Object.freeze({
  exactFrozenNullObject,
  ownData,
  validateAuditResult,
  validateFormat,
  validateJsonGraph,
});
