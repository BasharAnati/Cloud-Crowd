"use strict";

const { MalformedDatabaseResultError } = require("../errors");

const BIGINT_PATTERN = /^[1-9][0-9]*$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 100_000;

function malformed() { throw new MalformedDatabaseResultError("Database result shape is invalid"); }
function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function cloneJson(value, state = { active: new WeakSet(), nodes: 0 }, depth = 0) {
  state.nodes += 1;
  if (depth > MAX_JSON_DEPTH || state.nodes > MAX_JSON_NODES) malformed();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value) && Number.isInteger(value)) malformed();
    return value;
  }
  if (Array.isArray(value)) {
    if (state.active.has(value)) malformed();
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => key !== "length" &&
        (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)))) malformed();
    state.active.add(value);
    const copy = [];
    try {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) malformed();
        copy.push(cloneJson(value[index], state, depth + 1));
      }
    } finally {
      state.active.delete(value);
    }
    return copy;
  }
  if (!isPlainObject(value)) malformed();
  if (state.active.has(value)) malformed();
  state.active.add(value);
  const copy = Object.getPrototypeOf(value) === null ? Object.create(null) : {};
  try {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") malformed();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) malformed();
      Object.defineProperty(copy, key, {
        value: cloneJson(descriptor.value, state, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  } finally {
    state.active.delete(value);
  }
  return copy;
}
function deepFreeze(value, seen = new WeakSet()) {
  if (Array.isArray(value) || isPlainObject(value)) {
    if (seen.has(value)) malformed();
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (key !== "length") deepFreeze(value[key], seen);
    }
    Object.freeze(value);
    seen.delete(value);
  }
  return value;
}
function immutableJson(value) {
  try { return deepFreeze(cloneJson(value)); }
  catch (error) {
    if (error instanceof MalformedDatabaseResultError) throw error;
    malformed();
  }
}
function requireBigIntString(value) { if (typeof value !== "string" || !BIGINT_PATTERN.test(value)) malformed(); return value; }
function requireString(value, nullable = false) {
  if (nullable && value === null) return value;
  if (typeof value !== "string") malformed();
  return value;
}
function requireTimestamp(value) {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) malformed();
  return value;
}
function isBigIntString(value) { return typeof value === "string" && BIGINT_PATTERN.test(value); }
function isTimestampString(value) {
  return typeof value === "string" && TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}
function requireRows(result) {
  if (!result || !Array.isArray(result.rows)) malformed();
  return result.rows;
}
function immutableRows(result) {
  try {
    return deepFreeze(requireRows(result).map((row) => {
      if (!isPlainObject(row)) malformed();
      return cloneJson(row);
    }));
  } catch (error) {
    if (error instanceof MalformedDatabaseResultError) throw error;
    malformed();
  }
}

module.exports = {
  BIGINT_PATTERN,
  MAX_JSON_DEPTH,
  MAX_JSON_NODES,
  deepFreeze,
  immutableJson,
  immutableRows,
  isBigIntString,
  isPlainObject,
  isTimestampString,
  requireBigIntString,
  requireRows,
  requireString,
  requireTimestamp,
};
