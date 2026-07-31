"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { SafetyViolationError } = require("../src/errors");
const { enforceSafety } = require("../src/safety-kernel");

const safeEnvironment = Object.freeze({
  target: "production",
  mode: "read-only",
  productionAcknowledged: true,
});

test("safety kernel returns deeply immutable configuration", () => {
  const configuration = enforceSafety(safeEnvironment);
  assert.equal(Object.isFrozen(configuration), true);
  assert.equal(Object.isFrozen(configuration.capabilities), true);
  assert.throws(() => {
    configuration.capabilities.writesAllowed = true;
  }, TypeError);
});

test("safety kernel fails closed without explicit production acknowledgement", () => {
  assert.throws(
    () => enforceSafety({ ...safeEnvironment, productionAcknowledged: false }),
    SafetyViolationError
  );
});

test("safety kernel rejects any mode other than read-only", () => {
  assert.throws(
    () => enforceSafety({ ...safeEnvironment, mode: "write" }),
    SafetyViolationError
  );
});

test("safety kernel rejects unknown top-level fields", () => {
  for (const field of [
    "writeEnabled",
    "allowWrites",
    "writesAllowed",
    "writeMode",
    "dangerousMode",
    "unexpected",
  ]) {
    assert.throws(
      () => enforceSafety({ ...safeEnvironment, [field]: true }),
      SafetyViolationError,
      field
    );
  }
});

test("safety kernel rejects unknown nested capability fields", () => {
  assert.throws(
    () =>
      enforceSafety({
        ...safeEnvironment,
        capabilities: { writesAllowed: true },
      }),
    SafetyViolationError
  );
});
