"use strict";

const { verifyCompletedAuditReport, verifyCompletedParityResult } = require("./validation");

const EXECUTION_VERSION = "1";
const TRUSTED_AUDIT_RESULTS = new WeakMap();

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
  const result = nullObject([
    ["report", trustedReport],
    ["summary", trustedParityResult.summary],
    ["statistics", trustedReport.statistics],
    ["metadata", metadata],
  ]);
  TRUSTED_AUDIT_RESULTS.set(result, Object.freeze({
    producer: "createAuditResult",
    completenessState: "complete",
  }));
  return result;
}

function verifyTrustedAuditResult(result) {
  const metadata = result && typeof result === "object" ? TRUSTED_AUDIT_RESULTS.get(result) : null;
  if (!metadata || metadata.producer !== "createAuditResult" || metadata.completenessState !== "complete") {
    throw new TypeError("Audit result is not trusted");
  }
  return result;
}

Object.freeze(verifyTrustedAuditResult);

module.exports = Object.freeze({ createAuditResult, verifyTrustedAuditResult });
