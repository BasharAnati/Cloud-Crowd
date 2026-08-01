"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { MalformedDatabaseResultError } = require("../../src/errors");
const { MAX_JSON_DEPTH, immutableJson } = require("../../src/postgres/row-validation");

test("safe cloning preserves dangerous-looking JSON keys as frozen own data properties", () => {
  const input = JSON.parse('{"__proto__":{"safe":true},"constructor":{"name":"raw"},"prototype":{"value":1}}');
  const snapshot = immutableJson(input);
  for (const key of ["__proto__", "constructor", "prototype"]) {
    assert.equal(Object.hasOwn(snapshot, key), true);
    assert.equal(Object.isFrozen(snapshot[key]), true);
  }
  assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
  assert.throws(() => { snapshot.__proto__.safe = false; }, TypeError);
});

test("cyclic objects and arrays are rejected with the trusted malformed-result error", () => {
  const object = {}; object.self = object;
  const array = []; array.push(array);
  assert.throws(() => immutableJson(object), MalformedDatabaseResultError);
  assert.throws(() => immutableJson(array), MalformedDatabaseResultError);
});

test("excessive JSON nesting is rejected deterministically", () => {
  const root = {};
  let cursor = root;
  for (let depth = 0; depth <= MAX_JSON_DEPTH; depth += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.throws(() => immutableJson(root), MalformedDatabaseResultError);
});

test("nested arrays, objects, and null-prototype objects are cloned and deeply frozen", () => {
  const nullPrototype = Object.create(null);
  nullPrototype.value = [1, { nested: true }];
  const input = { branch: nullPrototype };
  const snapshot = immutableJson(input);
  input.branch.value[1].nested = false;
  assert.equal(snapshot.branch.value[1].nested, true);
  assert.equal(Object.getPrototypeOf(snapshot.branch), null);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.branch), true);
  assert.equal(Object.isFrozen(snapshot.branch.value), true);
  assert.equal(Object.isFrozen(snapshot.branch.value[1]), true);
});

test("Date, Buffer, BigInt, undefined, and functions are rejected", () => {
  for (const value of [new Date(), Buffer.from("x"), 1n, undefined, () => {}]) {
    assert.throws(() => immutableJson({ value }), MalformedDatabaseResultError);
  }
});
