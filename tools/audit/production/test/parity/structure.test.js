"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { compareCanonicalParityBundle } = require("../../src/parity");
const { EXPECTED_HEADERS } = require("../../src/sheets/structure");
const { bundleWithSheetOptions, postgresTicket, sheetRow } = require("./helpers");

test("missing headers produce empty, warning, and module-not-comparable findings", async () => {
  const input = await bundleWithSheetOptions([postgresTicket(1, "ce", "ORDER-1")], {
    cctv: { missingHeaderValues: true },
    "customer-experience": { missingHeaderValues: true },
    complaints: { missingHeaderValues: true },
    "complimentary-orders": { missingHeaderValues: true },
  });
  const result = compareCanonicalParityBundle(input);
  assert.equal(result.summary.findingsByType.MODULE_EMPTY, 4);
  assert.equal(result.summary.findingsByType.MODULE_NOT_COMPARABLE, 4);
  assert.ok(result.summary.findingsByType.MODULE_STRUCTURE_WARNING >= 8);
  assert.equal(result.summary.unmatchablePostgres, 1);
});

test("an unknown ticket header blocks matching when identity position is untrustworthy", async () => {
  const input = await bundleWithSheetOptions([postgresTicket(1, "ce", "ORDER-1")], {
    "customer-experience": {
      header: Array(16).fill("Unknown"),
      rows: [sheetRow("customer-experience", "ORDER-1")],
    },
  });
  const result = compareCanonicalParityBundle(input);
  assert.equal(result.summary.matchedUniquePairs, 0);
  assert.equal(result.summary.unmatchablePostgres, 1);
  assert.equal(result.summary.unmatchableSheets, 1);
  assert.ok(result.summary.findingsByType.MODULE_NOT_COMPARABLE >= 1);
  assert.equal(result.findings.filter((finding) =>
    finding.module === "customer-experience" && finding.evidenceCode === "UNKNOWN_HEADER" &&
    finding.findingType === "MODULE_STRUCTURE_WARNING").length, 1);
});

test("one unknown header warning is aggregated across three tickets", async () => {
  const input = await bundleWithSheetOptions([], {
    "customer-experience": {
      header: Array(16).fill("Unknown"),
      rows: ["A", "B", "C"].map((identity) => sheetRow("customer-experience", identity)),
    },
  });
  const result = compareCanonicalParityBundle(input);
  const warnings = result.findings.filter((finding) => finding.module === "customer-experience" &&
    finding.findingType === "MODULE_STRUCTURE_WARNING" && finding.evidenceCode === "UNKNOWN_HEADER");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].sheetsReference, null);
  assert.equal(result.summary.unmatchableSheets, 3);
});

test("row-level width and trailing-omission flags remain factual warnings without blocking other modules", async () => {
  const input = await bundleWithSheetOptions([postgresTicket(1, "complaints", "C-1")], {
    complaints: { rows: [["Open", "", "Name", "Phone", "2026-01-01", "", "", "", "", "", "", "", "", "C-1", "wide"]] },
  });
  const result = compareCanonicalParityBundle(input);
  assert.equal(result.summary.matchedUniquePairs, 1);
  assert.ok(result.summary.findingsByType.MODULE_STRUCTURE_WARNING >= 1);
});

test("module flags are deduplicated while identical row flags remain reference-specific", async () => {
  const wide = (identity) => [...sheetRow("complaints", identity), "wide"];
  const input = await bundleWithSheetOptions([], {
    complaints: { header: Array(14).fill("Unknown"), rows: [wide("A"), wide("B")] },
  });
  const result = compareCanonicalParityBundle(input);
  const unknownHeader = result.findings.filter((finding) => finding.module === "complaints" && finding.evidenceCode === "UNKNOWN_HEADER");
  const wideRows = result.findings.filter((finding) => finding.module === "complaints" && finding.evidenceCode === "WIDE_ROW");
  assert.equal(unknownHeader.length, 1);
  assert.deepEqual(wideRows.map((finding) => finding.sheetsReference), ["2", "3"]);
  assert.equal(result.summary.structuralFindings, result.findings.filter((finding) =>
    ["MODULE_EMPTY", "MODULE_HEADER_ONLY", "MODULE_STRUCTURE_WARNING", "MODULE_NOT_COMPARABLE"].includes(finding.findingType)).length);
});

test("CCTV conflicting metadata classification is preserved without resolution", async () => {
  const conflicting = await bundleWithSheetOptions([postgresTicket(1, "cctv", "C-1")], {
    cctv: {
      rows: [sheetRow("cctv", "C-1", { 11: "owner", 12: "https://synthetic.invalid/file" })],
    },
  });
  const result = compareCanonicalParityBundle(conflicting);
  assert.equal(result.summary.findingsByType.CCTV_METADATA_CONFLICT, 1);
  assert.equal(JSON.stringify(result).includes("synthetic.invalid"), false);
});

test("CCTV ambiguous metadata and PDF attachment-count comparison remain bounded and factual", async () => {
  const ambiguousInput = await bundleWithSheetOptions([postgresTicket(1, "cctv", "A-1")], {
    cctv: {
      header: [...EXPECTED_HEADERS.cctv.slice(0, 11), "Owner", "PDF"],
      rows: [sheetRow("cctv", "A-1", { 11: "unknown", 12: "unknown" })],
    },
  });
  const ambiguous = compareCanonicalParityBundle(ambiguousInput);
  assert.equal(ambiguous.summary.findingsByType.CCTV_METADATA_AMBIGUOUS, 1);

  const pdfInput = await bundleWithSheetOptions([
    postgresTicket(1, "cctv", "P-1", { cctvPdf: { name: "private", type: "pdf", dataUrl: "secret-url" } }),
  ], {
    cctv: {
      header: [...EXPECTED_HEADERS.cctv.slice(0, 11), "PDF Name", "PDF URL"],
      rows: [sheetRow("cctv", "P-1")],
    },
  });
  const pdf = compareCanonicalParityBundle(pdfInput);
  assert.equal(pdf.summary.findingsByType.ATTACHMENT_COUNT_MISMATCH, 1);
  assert.equal(JSON.stringify(pdf).includes("secret-url"), false);
});
