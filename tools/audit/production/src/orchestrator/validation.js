"use strict";

const { classifyError } = require("../errors");
const { verifyTrustedParityResult } = require("../parity/adapter");
const { verifyTrustedAuditReport } = require("../report/adapter");

function isTrustedComponentError(error) {
  return classifyError(error).publicCode !== "INTERNAL_ERROR";
}

function verifyCompletedParityResult(parityResult) {
  return verifyTrustedParityResult(parityResult);
}

function verifyCompletedAuditReport(report) {
  return verifyTrustedAuditReport(report);
}

module.exports = Object.freeze({
  isTrustedComponentError,
  verifyCompletedAuditReport,
  verifyCompletedParityResult,
});
