"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyError } = require("../../src/errors");
const { addFinding } = require("../../src/parity/finding");
const { LIMITS } = require("../../src/parity/validation");

test("all parity limits are fixed and immutable", () => {
  assert.deepEqual({ ...LIMITS }, {
    totalRecords: 80000, recordsPerModuleSource: 10000, duplicateGroupSize: 10000,
    findingsPerMatchedRecord: 64, totalFindings: 100000, referencesPerFinding: 10000,
    outputBytes: 64 * 1024 * 1024,
  });
  assert.equal(Object.isFrozen(LIMITS), true);
});

test("finding accumulation fails closed at the exact fixed boundary without truncation", () => {
  const findings = Array(LIMITS.totalFindings).fill(null);
  assert.throws(() => addFinding(findings, { findingType: "MODULE_EMPTY", class: "INFO", module: "cctv" }), (error) => {
    const classification = classifyError(error);
    assert.equal(classification.publicCode, "PARITY_LIMIT_EXCEEDED");
    assert.equal(classification.exitCode, 8);
    error.code = "INTERNAL_ERROR";
    error.exitCode = 0;
    assert.equal(classifyError(error).publicCode, "PARITY_LIMIT_EXCEEDED");
    return true;
  });
  assert.equal(findings.length, LIMITS.totalFindings);
});
