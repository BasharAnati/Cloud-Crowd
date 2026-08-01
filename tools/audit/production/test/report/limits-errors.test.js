"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ReportInternalConsistencyError, ReportInvalidFindingError, ReportInvalidSummaryError, ReportLimitError,
  ReportUnsupportedInputError, ReportUntrustedInputError, classifyError,
} = require("../../src/errors");
const { compareCanonicalParityBundle } = require("../../src/parity");
const { buildAuditReport } = require("../../src/report");
const { estimateModelBytes } = require("../../src/report/model");
const { typePolicy, FINDING_TYPES } = require("../../src/report/policy");
const { LIMITS } = require("../../src/report/validation");
const normalize = require("../../src/normalize");
const { trustedAllSheetsSnapshot, trustedCompleteTicketPages } = require("../normalize/helpers");
const { postgresTicket, sheetRow } = require("../parity/helpers");

test("the public builder classifies the fixed output-size boundary without partial output", async () => {
  const parityResult = compareCanonicalParityBundle(normalize.assembleCanonicalParityBundle(
    Object.freeze((await trustedCompleteTicketPages([], 1)).map(normalize.normalizePostgresSnapshot)),
    normalize.normalizeSheetsSnapshot(await trustedAllSheetsSnapshot()),
  ));
  const validationPath = require.resolve("../../src/report/validation");
  const adapterPath = require.resolve("../../src/report/adapter");
  const indexPath = require.resolve("../../src/report/index");
  const validationEntry = require.cache[validationPath];
  const adapterEntry = require.cache[adapterPath];
  const indexEntry = require.cache[indexPath];
  const originalValidation = validationEntry.exports;
  validationEntry.exports = Object.freeze({
    ...originalValidation,
    LIMITS: Object.freeze({ ...originalValidation.LIMITS, outputBytes: 1 }),
  });
  delete require.cache[adapterPath];
  delete require.cache[indexPath];
  let result;
  try {
    const isolatedReport = require("../../src/report");
    assert.throws(() => { result = isolatedReport.buildAuditReport(parityResult); }, (error) => {
      const classification = classifyError(error);
      assert.equal(classification.publicCode, "REPORT_LIMIT_EXCEEDED");
      assert.equal(classification.exitCode, 9);
      return true;
    });
    assert.equal(result, undefined);
  } finally {
    validationEntry.exports = originalValidation;
    if (adapterEntry) require.cache[adapterPath] = adapterEntry;
    else delete require.cache[adapterPath];
    if (indexEntry) require.cache[indexPath] = indexEntry;
    else delete require.cache[indexPath];
  }
});

test("report limits are fixed, immutable, and compatible with PR5", () => {
  assert.deepEqual({ ...LIMITS }, {
    findings: 100000, entries: 100000, groups: 80, categorySections: 32,
    referencesPerSource: 10000, referencesPerEntry: 20000, descriptionBytes: 256,
    outputBytes: 48 * 1024 * 1024,
  });
  assert.equal(Object.isFrozen(LIMITS), true);
  for (const type of FINDING_TYPES) assert(Buffer.byteLength(typePolicy(type).description, "utf8") <= LIMITS.descriptionBytes);
  assert(estimateModelBytes(Object.freeze(["x".repeat(1024)])) > 1024);
});

test("all reporting errors retain fixed WeakMap-backed exit-code-9 classifications", () => {
  const cases = [
    [ReportUntrustedInputError, "REPORT_UNTRUSTED_INPUT"],
    [ReportUnsupportedInputError, "REPORT_UNSUPPORTED_INPUT"],
    [ReportInvalidFindingError, "REPORT_INVALID_FINDING"],
    [ReportInvalidSummaryError, "REPORT_INVALID_SUMMARY"],
    [ReportLimitError, "REPORT_LIMIT_EXCEEDED"],
    [ReportInternalConsistencyError, "REPORT_INTERNAL_CONSISTENCY_FAILURE"],
  ];
  for (const [ErrorClass, code] of cases) {
    const error = new ErrorClass("PRIVATE ERROR CANARY");
    const classification = classifyError(error);
    assert.equal(classification.publicCode, code);
    assert.equal(classification.exitCode, 9);
    assert.equal(classification.publicMessage.includes("PRIVATE ERROR CANARY"), false);
    error.code = "INTERNAL_ERROR";
    error.exitCode = 0;
    assert.equal(classifyError(error).publicCode, code);
    assert.equal(classifyError(error).exitCode, 9);
  }
});

test("10,000 references per source are reported without truncation", { timeout: 30_000 }, async () => {
  const count = 10_000;
  const postgres = Array.from({ length: count }, (_, index) => postgresTicket(index + 1, "complaints", "REPORT-DUPLICATE-LIMIT"));
  const sheets = Array.from({ length: count }, () => sheetRow("complaints", "REPORT-DUPLICATE-LIMIT"));
  const pages = Object.freeze((await trustedCompleteTicketPages(postgres, 100)).map(normalize.normalizePostgresSnapshot));
  const sheetResult = normalize.normalizeSheetsSnapshot(await trustedAllSheetsSnapshot({ complaints: sheets }));
  const input = normalize.assembleCanonicalParityBundle(pages, sheetResult);
  const report = buildAuditReport(compareCanonicalParityBundle(input));
  const duplicate = report.moduleSections.find((module) => module.module === "complaints").categorySections
    .find((category) => category.category === "DUPLICATE").findingGroups
    .find((group) => group.findingType === "DUPLICATE_BOTH_SOURCES").entries[0];
  assert.equal(duplicate.references.postgres.length, count);
  assert.equal(duplicate.references.sheets.length, count);
  assert.equal(duplicate.counts.postgres, count);
  assert.equal(duplicate.counts.sheets, count);
});
