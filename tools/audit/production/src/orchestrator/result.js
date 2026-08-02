"use strict";

const { verifyCompletedAuditReport, verifyCompletedParityResult } = require("./validation");

const EXECUTION_VERSION = "1";

function nullObject(entries) {
  const value = Object.create(null);
  for (const [key, entry] of entries) Object.defineProperty(value, key, {
    value: entry,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  return Object.freeze(value);
}

function createAuditResult(parityResult, report) {
  const trustedParityResult = verifyCompletedParityResult(parityResult);
  const trustedReport = verifyCompletedAuditReport(report);
  const metadata = nullObject([
    ["schemaVersion", trustedReport.schemaVersion],
    ["executionVersion", EXECUTION_VERSION],
    ["completed", true],
  ]);
  return nullObject([
    ["report", trustedReport],
    ["summary", trustedParityResult.summary],
    ["statistics", trustedReport.statistics],
    ["metadata", metadata],
  ]);
}

module.exports = Object.freeze({ createAuditResult });
