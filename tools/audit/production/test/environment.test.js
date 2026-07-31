"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadEnvironment } = require("../src/environment");
const { ConfigurationError } = require("../src/errors");

test("environment loading normalizes allowlisted values", () => {
  const configuration = loadEnvironment({
    AUDIT_TARGET: " Production ",
    AUDIT_MODE: " READ-ONLY ",
    AUDIT_PRODUCTION_ACKNOWLEDGED: "TRUE",
  });

  assert.deepEqual(configuration, {
    target: "production",
    mode: "read-only",
    productionAcknowledged: true,
  });
  assert.equal(Object.isFrozen(configuration), true);
});

test("environment loading rejects missing required values", () => {
  assert.throws(() => loadEnvironment({}), ConfigurationError);
});

test("environment loading rejects invalid booleans without echoing values", () => {
  const secret = "private-key-material";
  assert.throws(
    () =>
      loadEnvironment({
        AUDIT_TARGET: "production",
        AUDIT_MODE: "read-only",
        AUDIT_PRODUCTION_ACKNOWLEDGED: secret,
      }),
    (error) => {
      assert.equal(error instanceof ConfigurationError, true);
      assert.equal(error.message.includes(secret), false);
      return true;
    }
  );
});
