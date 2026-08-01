"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyError } = require("../../src/errors");
const { EXPECTED_HEADERS } = require("../../src/sheets/structure");
const { bundle, bundleWithSheetOptions, postgresTicket, sheetRow } = require("../parity/helpers");

const PARITY_PATHS = ["adapter", "comparator", "finding", "identity", "index", "matcher", "partition", "summary"]
  .map((name) => require.resolve(`../../src/parity/${name}`));
const REPORT_PATHS = ["adapter", "index", "validation"].map((name) => require.resolve(`../../src/report/${name}`));
const FINDING_PATH = require.resolve("../../src/parity/finding");
const SUMMARY_PATH = require.resolve("../../src/parity/summary");

function snapshot(paths) { return new Map(paths.map((path) => [path, require.cache[path]])); }
function restore(previous) {
  for (const [path, entry] of previous) {
    if (entry) require.cache[path] = entry;
    else delete require.cache[path];
  }
}

function cloneWith(record, key, value) {
  const output = Object.create(null);
  for (const name of Reflect.ownKeys(record)) Object.defineProperty(output, name, {
    value: name === key ? value : record[name], enumerable: true, writable: false, configurable: false,
  });
  return Object.freeze(output);
}

function cloneWithValues(record, values) {
  const output = Object.create(null);
  for (const name of Reflect.ownKeys(record)) Object.defineProperty(output, name, {
    value: Object.hasOwn(values, name) ? values[name] : record[name], enumerable: true, writable: false, configurable: false,
  });
  return Object.freeze(output);
}

async function withCorruption(kind, operation) {
  const paths = [...PARITY_PATHS, ...REPORT_PATHS];
  const previous = snapshot(paths);
  const findingEntry = require.cache[FINDING_PATH] || (require(FINDING_PATH), require.cache[FINDING_PATH]);
  const summaryEntry = require.cache[SUMMARY_PATH] || (require(SUMMARY_PATH), require.cache[SUMMARY_PATH]);
  const originalFinding = findingEntry.exports;
  const originalSummary = summaryEntry.exports;
  if (kind === "finding" || typeof kind === "function") findingEntry.exports = Object.freeze({
    ...originalFinding,
    addFinding(findings, values) {
      originalFinding.addFinding(findings, values);
      const current = findings[findings.length - 1];
      findings[findings.length - 1] = typeof kind === "function" ? kind(current) :
        cloneWith(current, "findingType", "UNKNOWN_FINDING_TYPE");
    },
  });
  if (kind === "summary") summaryEntry.exports = Object.freeze({
    buildSummary(...args) {
      const genuine = originalSummary.buildSummary(...args);
      return cloneWith(genuine, "postgresOnly", genuine.postgresOnly + 1);
    },
  });
  for (const path of [...PARITY_PATHS, ...REPORT_PATHS]) {
    if (path !== FINDING_PATH && path !== SUMMARY_PATH) delete require.cache[path];
  }
  try {
    const parity = require("../../src/parity");
    const report = require("../../src/report");
    await operation({ parity, report });
  } finally {
    findingEntry.exports = originalFinding;
    summaryEntry.exports = originalSummary;
    restore(previous);
  }
}

async function assertFindingCorruption(input, mutate) {
  await withCorruption(mutate, async ({ parity, report }) => {
    const result = parity.compareCanonicalParityBundle(input);
    let output;
    assertClassification(() => { output = report.buildAuditReport(result); }, "REPORT_INVALID_FINDING");
    assert.equal(output, undefined);
  });
}

function assertClassification(operation, code) {
  assert.throws(operation, (error) => {
    const classification = classifyError(error);
    assert.equal(classification.publicCode, code);
    assert.equal(classification.exitCode, 9);
    assert.equal(classification.publicMessage.includes("UNKNOWN_FINDING_TYPE"), false);
    return true;
  });
}

test("a genuine registered result containing a producer-corrupted finding fails closed", async () => {
  const input = await bundle();
  await withCorruption("finding", async ({ parity, report }) => {
    const result = parity.compareCanonicalParityBundle(input);
    assertClassification(() => report.buildAuditReport(result), "REPORT_INVALID_FINDING");
  });
});

test("a genuine registered result containing a producer-corrupted summary fails closed", async () => {
  const input = await bundle();
  await withCorruption("summary", async ({ parity, report }) => {
    const result = parity.compareCanonicalParityBundle(input);
    assertClassification(() => report.buildAuditReport(result), "REPORT_INVALID_SUMMARY");
  });
});

test("parity results from a separately loaded registry are rejected by the original report registry", async () => {
  const originalReport = require("../../src/report");
  const input = await bundle();
  await withCorruption(null, async ({ parity, report }) => {
    const separate = parity.compareCanonicalParityBundle(input);
    assertClassification(() => originalReport.buildAuditReport(separate), "REPORT_UNTRUSTED_INPUT");
    assert.doesNotThrow(() => report.buildAuditReport(separate));
  });
});

test("trusted producer corruption cannot violate fingerprint, module, field, evidence, comparability, state, reference, or count contracts", async () => {
  const headerOnly = await bundle();
  const sourceOnly = await bundle([postgresTicket(1, "ce", "SOURCE-ONLY")]);
  const stateMismatch = await bundle([postgresTicket(2, "ce", "STATE-MISMATCH")], {
    "customer-experience": [sheetRow("customer-experience", "STATE-MISMATCH")],
  });
  const valueMismatch = await bundle([postgresTicket(3, "ce", "VALUE-MISMATCH", { branch: "Left" })], {
    "customer-experience": [sheetRow("customer-experience", "VALUE-MISMATCH", { 7: "Right" })],
  });
  const duplicate = await bundle([
    postgresTicket(4, "complaints", "DUPLICATE"), postgresTicket(5, "complaints", "DUPLICATE"),
  ], { complaints: [sheetRow("complaints", "DUPLICATE")] });
  const cctvConflict = await bundleWithSheetOptions([postgresTicket(6, "cctv", "CCTV-CONFLICT")], {
    cctv: { rows: [sheetRow("cctv", "CCTV-CONFLICT", { 11: "owner", 12: "https://private.invalid/file" })] },
  });

  const cases = [
    ["forbidden fingerprint", headerOnly, (finding) => finding.findingType === "MODULE_HEADER_ONLY" ?
      cloneWith(finding, "identityFingerprint", `${finding.module === "cctv" ? "CCTV" : finding.module === "customer-experience" ? "CE" : finding.module === "complaints" ? "COMPLAINTS" : "COMPLIMENTARY"}-000000000000000000000000`) : finding],
    ["missing fingerprint", sourceOnly, (finding) => finding.findingType === "POSTGRES_ONLY_RECORD" ? cloneWith(finding, "identityFingerprint", null) : finding],
    ["wrong module", cctvConflict, (finding) => finding.findingType === "CCTV_METADATA_CONFLICT" ? cloneWithValues(finding, {
      module: "complaints", identityFingerprint: "COMPLAINTS-000000000000000000000000",
    }) : finding],
    ["wrong field", valueMismatch, (finding) => finding.findingType === "FIELD_VALUE_MISMATCH" && finding.field === "branch" ?
      cloneWith(finding, "field", "discountAmount") : finding],
    ["wrong evidence", sourceOnly, (finding) => finding.findingType === "POSTGRES_ONLY_RECORD" ? cloneWith(finding, "evidenceCode", "MISSING_FROM_POSTGRES") : finding],
    ["wrong comparability", cctvConflict, (finding) => finding.findingType === "CCTV_METADATA_CONFLICT" ? cloneWith(finding, "comparability", "AWARE_LOCAL") : finding],
    ["wrong state", stateMismatch, (finding) => finding.findingType === "FIELD_STATE_MISMATCH" ? cloneWith(finding, "sheetsState", finding.postgresState) : finding],
    ["wrong references", sourceOnly, (finding) => finding.findingType === "POSTGRES_ONLY_RECORD" ? cloneWith(finding, "sheetsReference", "2") : finding],
    ["wrong duplicate count", duplicate, (finding) => finding.findingType === "DUPLICATE_POSTGRES_KEY" ?
      cloneWith(finding, "counts", cloneWith(finding.counts, "postgres", 1)) : finding],
  ];
  for (const [name, input, mutate] of cases) {
    try { await assertFindingCorruption(input, mutate); } catch (error) { assert.fail(`${name}: ${error.message}`); }
  }
});

test("structural evidence codes cannot contradict their finding types", async () => {
  const headerOnly = await bundle();
  const empty = await bundleWithSheetOptions([], { cctv: { header: [], rows: [] } });
  await assertFindingCorruption(headerOnly, (finding) => finding.findingType === "MODULE_HEADER_ONLY" ?
    cloneWith(finding, "evidenceCode", "EMPTY_SHEET") : finding);
  await assertFindingCorruption(empty, (finding) => finding.findingType === "MODULE_EMPTY" ?
    cloneWith(finding, "evidenceCode", "HEADER_ONLY") : finding);
});

test("CCTV structural evidence is rejected on every non-CCTV module", async () => {
  const complaints = await bundleWithSheetOptions([], {
    complaints: { header: ["WRONG HEADER"], rows: [sheetRow("complaints", "CASE")] },
  });
  const customerExperience = await bundleWithSheetOptions([], {
    "customer-experience": { rows: [["Open"]] },
  });
  const complimentary = await bundleWithSheetOptions([], {
    "complimentary-orders": { header: ["WRONG HEADER"], rows: [sheetRow("complimentary-orders", "ORDER")] },
  });
  await assertFindingCorruption(complaints, (finding) =>
    finding.findingType === "MODULE_STRUCTURE_WARNING" && finding.module === "complaints" && finding.evidenceCode === "UNKNOWN_HEADER" ?
      cloneWith(finding, "evidenceCode", "CCTV_AMBIGUOUS_METADATA") : finding);
  await assertFindingCorruption(customerExperience, (finding) =>
    finding.findingType === "MODULE_STRUCTURE_WARNING" && finding.module === "customer-experience" && finding.evidenceCode === "SHORT_ROW" ?
      cloneWith(finding, "evidenceCode", "CCTV_CONFLICTING_EVIDENCE") : finding);
  await assertFindingCorruption(complimentary, (finding) =>
    finding.findingType === "MODULE_STRUCTURE_WARNING" && finding.module === "complimentary-orders" && finding.evidenceCode === "UNKNOWN_HEADER" ?
      cloneWith(finding, "evidenceCode", "CCTV_AMBIGUOUS_METADATA") : finding);
});

test("CCTV raw identity evidence is rejected on non-CCTV identity findings", async () => {
  const missing = await bundle([postgresTicket(20, "ce", undefined)]);
  const conflicting = await bundle([postgresTicket(21, "complaints", "ORDER", { caseNumber: "CASE" })]);
  await assertFindingCorruption(missing, (finding) =>
    finding.findingType === "MISSING_IDENTITY_KEY" && finding.module === "customer-experience" ?
      cloneWith(finding, "evidenceCode", "MISSING") : finding);
  await assertFindingCorruption(conflicting, (finding) =>
    finding.findingType === "AMBIGUOUS_IDENTITY_SOURCE" && finding.module === "complaints" ?
      cloneWith(finding, "evidenceCode", "AMBIGUOUS") : finding);
});

test("genuine module-specific and general evidence combinations remain accepted", async () => {
  const { compareCanonicalParityBundle } = require("../../src/parity");
  const { buildAuditReport } = require("../../src/report");
  const cctvStructural = await bundleWithSheetOptions([postgresTicket(22, "cctv", "CCTV-STRUCTURE")], {
    cctv: { rows: [sheetRow("cctv", "CCTV-STRUCTURE", { 11: "owner", 12: "https://private.invalid/file" })] },
  });
  const cctvIdentity = await bundle([postgresTicket(23, "cctv", null)]);
  const nonCctvMissing = await bundle([postgresTicket(24, "ce", undefined)]);
  const nonCctvConflict = await bundle([postgresTicket(25, "complaints", "ORDER", { caseNumber: "CASE" })]);
  const generalStructure = await bundleWithSheetOptions([], {
    cctv: { rows: [["Open"]] },
    "customer-experience": { rows: [["Open"]] },
    complaints: { rows: [["Open"]] },
    "complimentary-orders": { rows: [["Open"]] },
  });
  const results = [cctvStructural, cctvIdentity, nonCctvMissing, nonCctvConflict, generalStructure]
    .map((input) => buildAuditReport(compareCanonicalParityBundle(input)));
  const serialized = results.map((report) => JSON.stringify(report)).join("\n");
  for (const evidence of [
    "CCTV_CONFLICTING_EVIDENCE", "EXPLICIT_NULL", "NO_USABLE_IDENTITY", "CONFLICTING_IDENTITY_FIELDS", "SHORT_ROW",
  ]) assert.equal(serialized.includes(`\"code\":\"${evidence}\"`), true);
  for (const module of ["cctv", "customer-experience", "complaints", "complimentary-orders"]) {
    const section = results[4].moduleSections.find((value) => value.module === module);
    const structural = section.categorySections.find((value) => value.category === "STRUCTURAL");
    assert(structural.findingCount > 0);
  }
});

test("genuine findings remain accepted across every report category", async () => {
  const { compareCanonicalParityBundle } = require("../../src/parity");
  const { buildAuditReport } = require("../../src/report");
  const inputs = [
    await bundle(),
    await bundle([postgresTicket(10, "ce", undefined), postgresTicket(11, "ce", "PRESENCE")]),
    await bundle([postgresTicket(12, "complaints", "DUP"), postgresTicket(13, "complaints", "DUP")], {
      complaints: [sheetRow("complaints", "DUP")],
    }),
    await bundle([postgresTicket(14, "ce", "FIELD", { branch: "Left" })], {
      "customer-experience": [sheetRow("customer-experience", "FIELD", { 7: "Right" })],
    }),
    await bundle([postgresTicket(15, "cctv", "COLLECTION", { cameras: ["Camera A"] })], {
      cctv: [sheetRow("cctv", "COLLECTION")],
    }),
    await bundleWithSheetOptions([postgresTicket(16, "cctv", "CCTV")], {
      cctv: { rows: [sheetRow("cctv", "CCTV", { 11: "owner", 12: "https://private.invalid/file" })] },
    }),
    await bundleWithSheetOptions([postgresTicket(17, "cctv", "ATTACHMENT", {
      cctvPdf: { name: "private.pdf", type: "pdf", dataUrl: "private-reference" },
    })], {
      cctv: { header: [...EXPECTED_HEADERS.cctv.slice(0, 11), "PDF Name", "PDF URL"],
        rows: [sheetRow("cctv", "ATTACHMENT")] },
    }),
  ];
  const categories = new Set();
  for (const input of inputs) {
    const report = buildAuditReport(compareCanonicalParityBundle(input));
    for (const module of report.moduleSections) for (const category of module.categorySections)
      if (category.findingCount > 0) categories.add(category.category);
  }
  assert.deepEqual([...categories].sort(), [
    "ATTACHMENT", "CCTV_METADATA", "DUPLICATE", "FIELD", "IDENTITY", "NOT_COMPARABLE", "PRESENCE", "STRUCTURAL",
  ]);
});
