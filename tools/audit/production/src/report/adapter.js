"use strict";

const { Buffer } = require("node:buffer");
const {
  ReportInternalConsistencyError, ReportLimitError, ReportUnsupportedInputError, classifyError,
} = require("../errors");
const { groupFindings } = require("./grouping");
const { estimateModelBytes, nullObject } = require("./model");
const { CATEGORIES, FINDING_TYPES, MODULES, typePolicy } = require("./policy");
const { LIMITS, SUMMARY_SCALARS, validateParityResult } = require("./validation");

const AUDIT_REPORTS = new WeakMap();

function isReportError(error) { return classifyError(error).publicCode.startsWith("REPORT_"); }

function buildOverview(summary, findingCount) {
  return nullObject([
    ...SUMMARY_SCALARS.map((key) => [key, summary[key]]),
    ["totalFindings", findingCount],
    ["emptyMessage", findingCount === 0 ? "No parity findings were produced." : null],
  ]);
}

function execute(parityResult) {
  const trusted = validateParityResult(parityResult);
  const grouped = groupFindings(trusted.findings);
  if (trusted.findings.length > LIMITS.entries || grouped.groupCount > LIMITS.groups ||
      MODULES.length * CATEGORIES.length > LIMITS.categorySections) throw new ReportLimitError("Audit report grouping limit exceeded");
  for (const type of FINDING_TYPES) {
    if (Buffer.byteLength(typePolicy(type).description, "utf8") > LIMITS.descriptionBytes) {
      throw new ReportLimitError("Audit report description limit exceeded");
    }
  }
  const findingsByModule = nullObject(MODULES.map((module) => [module, trusted.summary.findingsByModule[module]]));
  const report = nullObject([
    ["reportType", "canonical-parity-audit"],
    ["schemaVersion", "1"],
    ["sourceType", "postgresql-google-sheets"],
    ["modules", Object.freeze([...MODULES])],
    ["overview", buildOverview(trusted.summary, trusted.findings.length)],
    ["moduleSections", grouped.moduleSections],
    ["statistics", nullObject([
      ["findingsByModule", findingsByModule], ["findingsByCategory", grouped.findingsByCategory],
      ["findingsByType", grouped.findingsByType], ["findingsByClass", grouped.findingsByClass],
    ])],
    ["metadata", nullObject([
      ["producer", "buildAuditReport"], ["inputType", "trusted-parity-result"], ["findingCount", trusted.findings.length],
      ["generatedFromRecordCounts", nullObject([
        ["postgresTickets", trusted.summary.postgresTickets], ["sheetsTickets", trusted.summary.sheetsTickets],
      ])],
    ])],
  ]);
  let bytes;
  try { bytes = estimateModelBytes(report); } catch (_) { throw new ReportInternalConsistencyError("Audit report size estimation failed"); }
  if (bytes > LIMITS.outputBytes) throw new ReportLimitError("Audit report output limit exceeded");
  AUDIT_REPORTS.set(report, Object.freeze({ producer: "buildAuditReport", findingCount: trusted.findings.length, completenessState: "complete" }));
  return report;
}

function buildAuditReport(parityResult) {
  if (arguments.length !== 1) throw new ReportUnsupportedInputError("Audit report requires exactly one argument");
  try { return execute(parityResult); } catch (error) {
    if (isReportError(error)) throw error;
    throw new ReportInternalConsistencyError("Audit report construction failed");
  }
}

function verifyTrustedAuditReport(report) {
  const metadata = AUDIT_REPORTS.get(report);
  if (!metadata || metadata.producer !== "buildAuditReport" || metadata.completenessState !== "complete") {
    throw new TypeError("Audit report is not trusted");
  }
  return report;
}

Object.freeze(verifyTrustedAuditReport);

module.exports = Object.freeze({ buildAuditReport, verifyTrustedAuditReport });
