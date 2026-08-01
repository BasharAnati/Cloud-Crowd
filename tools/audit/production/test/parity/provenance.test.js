"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyError } = require("../../src/errors");
const parity = require("../../src/parity");
const { bundle } = require("./helpers");

function assertParityError(operation, code) {
  let error;
  try { operation(); } catch (caught) { error = caught; }
  assert.ok(error);
  const classification = classifyError(error);
  assert.equal(classification.exitCode, 8);
  if (code) assert.equal(classification.publicCode, code);
  assert.equal(classification.publicMessage.includes("Unexpected"), false);
}

test("public API is exact and frozen", () => {
  assert.deepEqual(Object.keys(parity), ["compareCanonicalParityBundle"]);
  assert.equal(Object.isFrozen(parity), true);
});

test("a genuine bundle is accepted and forged, cloned, copied, and proxied inputs fail closed", async () => {
  const genuine = await bundle();
  assert.doesNotThrow(() => parity.compareCanonicalParityBundle(genuine));
  for (const input of [
    Object.freeze(Object.assign(Object.create(null), genuine)),
    JSON.parse(JSON.stringify(genuine)),
    new Proxy(genuine, {}),
    Object.freeze({}),
  ]) assertParityError(() => parity.compareCanonicalParityBundle(input), "PARITY_UNTRUSTED_INPUT");
  const { proxy, revoke } = Proxy.revocable(genuine, {});
  revoke();
  assertParityError(() => parity.compareCanonicalParityBundle(proxy), "PARITY_UNTRUSTED_INPUT");
});

test("exactly one argument is required", async () => {
  const genuine = await bundle();
  assertParityError(() => parity.compareCanonicalParityBundle(), "PARITY_UNSUPPORTED_INPUT");
  assertParityError(() => parity.compareCanonicalParityBundle(genuine, null), "PARITY_UNSUPPORTED_INPUT");
});

module.exports = { assertParityError };
