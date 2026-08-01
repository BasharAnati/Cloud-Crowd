"use strict";

const { NormalizationInvalidFieldError, NormalizationLimitError } = require("../errors");
const { fail } = require("./validation");

const MAXIMUM_DEPTH = 64;
const MAXIMUM_NODES = 100_000;

function cloneAndFreeze(value) {
  const ancestors = new Set();
  const state = { nodes: 0 };

  function visit(current, depth) {
    state.nodes += 1;
    if (state.nodes > MAXIMUM_NODES || depth > MAXIMUM_DEPTH) fail(NormalizationLimitError);
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current) || (Number.isInteger(current) && !Number.isSafeInteger(current))) fail(NormalizationInvalidFieldError);
      return current;
    }
    if (typeof current !== "object" || ancestors.has(current)) fail(NormalizationInvalidFieldError);
    let prototype;
    try { prototype = Object.getPrototypeOf(current); } catch (_) { fail(NormalizationInvalidFieldError); }
    if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) fail(NormalizationInvalidFieldError);
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        const output = [];
        for (let index = 0; index < current.length; index += 1) {
          if (!Object.hasOwn(current, index)) fail(NormalizationInvalidFieldError);
          Object.defineProperty(output, index, {
            value: visit(current[index], depth + 1), enumerable: true, writable: false, configurable: false,
          });
        }
        if (Reflect.ownKeys(current).some((key) => key !== "length" && !/^(0|[1-9][0-9]*)$/.test(String(key)))) fail(NormalizationInvalidFieldError);
        return Object.freeze(output);
      }
      const output = Object.create(null);
      for (const key of Reflect.ownKeys(current)) {
        if (typeof key !== "string") fail(NormalizationInvalidFieldError);
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) fail(NormalizationInvalidFieldError);
        Object.defineProperty(output, key, {
          value: visit(descriptor.value, depth + 1), enumerable: true, writable: false, configurable: false,
        });
      }
      return Object.freeze(output);
    } finally {
      ancestors.delete(current);
    }
  }

  return visit(value, 0);
}

module.exports = { cloneAndFreeze };
