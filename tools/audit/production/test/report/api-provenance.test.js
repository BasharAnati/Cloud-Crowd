"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyError } = require("../../src/errors");
const report = require("../../src/report");
const reportAdapter = require("../../src/report/adapter");
const { parityResult } = require("./helpers");

function assertReportError(operation, code) {
  let error;
  try { operation(); } catch (caught) { error = caught; }
  assert.ok(error);
  const classification = classifyError(error);
  assert.equal(classification.publicCode, code);
  assert.equal(classification.exitCode, 9);
  assert.equal(Object.hasOwn(classification, "stack"), false);
  assert.equal(Object.hasOwn(classification, "cause"), false);
  return error;
}

test("report public API is exact and frozen", () => {
  assert.deepEqual(Object.keys(report), ["buildAuditReport"]);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.buildAuditReport), true);
  assert.equal(Object.hasOwn(report, "verifyTrustedAuditReport"), false);
  assert.equal(Object.isFrozen(require("../../src/parity/adapter").verifyTrustedParityResult), true);
  assert.equal(Object.isFrozen(reportAdapter.verifyTrustedAuditReport), true);
});

test("only a genuine complete parity result is accepted", async () => {
  const genuine = await parityResult();
  const built = report.buildAuditReport(genuine);
  assert.doesNotThrow(() => reportAdapter.verifyTrustedAuditReport(built));
  for (const input of [
    Object.freeze(Object.assign(Object.create(null), genuine)),
    Object.freeze({ findings: genuine.findings, summary: genuine.summary }),
    JSON.parse(JSON.stringify(genuine)),
    new Proxy(genuine, {}),
    Object.freeze({}),
  ]) assertReportError(() => report.buildAuditReport(input), "REPORT_UNTRUSTED_INPUT");
  const { proxy, revoke } = Proxy.revocable(genuine, {});
  revoke();
  assertReportError(() => report.buildAuditReport(proxy), "REPORT_UNTRUSTED_INPUT");
});

test("report clones, copies, and proxies lose report provenance", async () => {
  const built = report.buildAuditReport(await parityResult());
  for (const value of [
    Object.freeze(Object.assign(Object.create(null), built)), JSON.parse(JSON.stringify(built)), new Proxy(built, {}),
  ]) assert.throws(() => reportAdapter.verifyTrustedAuditReport(value), TypeError);
});

test("exactly one argument is required and trusted classification ignores mutable error properties", async () => {
  const genuine = await parityResult();
  for (const operation of [
    () => report.buildAuditReport(), () => report.buildAuditReport(genuine, null),
  ]) {
    const error = assertReportError(operation, "REPORT_UNSUPPORTED_INPUT");
    error.code = "INTERNAL_ERROR";
    error.exitCode = 0;
    assert.equal(classifyError(error).publicCode, "REPORT_UNSUPPORTED_INPUT");
    assert.equal(classifyError(error).exitCode, 9);
  }
});

module.exports = { assertReportError };
