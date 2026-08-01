"use strict";

const { NormalizationMalformedRecordError } = require("../errors");

function fail(ErrorClass = NormalizationMalformedRecordError) {
  throw new ErrorClass("Normalization failed");
}

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  let prototype;
  try { prototype = Object.getPrototypeOf(value); } catch (_) { return false; }
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value) {
  if (!isPlainObject(value)) fail();
  let keys;
  try { keys = Reflect.ownKeys(value); } catch (_) { fail(); }
  for (const key of keys) {
    if (typeof key !== "string") fail();
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (_) { fail(); }
    if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
  }
  return value;
}

function assertExactKeys(value, expected) {
  assertPlainObject(value);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== expected.length || expected.some((key) => !actual.includes(key))) fail();
  return value;
}

function assertAllowedKeys(value, required, optional = []) {
  assertPlainObject(value);
  const allowed = new Set([...required, ...optional]);
  const actual = Reflect.ownKeys(value);
  if (required.some((key) => !actual.includes(key)) || actual.some((key) => !allowed.has(key))) fail();
  return value;
}

function assertDenseArray(value) {
  if (!Array.isArray(value)) fail();
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) fail();
  if (Reflect.ownKeys(value).some((key) => key !== "length" && !/^(0|[1-9][0-9]*)$/.test(String(key)))) fail();
  return value;
}

function dataValue(object, key) {
  assertPlainObject(object);
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
  return descriptor.value;
}

function optionalDataValue(object, key) {
  assertPlainObject(object);
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, "value") || descriptor.value === undefined) fail();
  return descriptor.value;
}

module.exports = { assertAllowedKeys, assertDenseArray, assertExactKeys, assertPlainObject, dataValue, fail, optionalDataValue };
