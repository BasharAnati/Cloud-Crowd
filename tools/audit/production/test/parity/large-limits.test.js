"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyError } = require("../../src/errors");
const normalize = require("../../src/normalize");
const { compareCanonicalParityBundle } = require("../../src/parity");
const { trustedAllSheetsSnapshot, trustedCompleteTicketPages } = require("../normalize/helpers");
const { bundleWithSheetOptions, postgresTicket, sheetRow } = require("./helpers");

async function largeBundle(postgresRows, sheetRows) {
  const pages = Object.freeze((await trustedCompleteTicketPages(postgresRows, 100)).map(normalize.normalizePostgresSnapshot));
  const sheets = normalize.normalizeSheetsSnapshot(await trustedAllSheetsSnapshot(sheetRows));
  return normalize.assembleCanonicalParityBundle(pages, sheets);
}

test("10,000 records at one module/source and a 10,000-reference duplicate group are accepted", { timeout: 30_000 }, async () => {
  const count = 10_000;
  const postgres = Array.from({ length: count }, (_, index) => postgresTicket(index + 1, "complaints", "DUPLICATE-LIMIT"));
  const sheets = Array.from({ length: count }, () => sheetRow("complaints", "DUPLICATE-LIMIT"));
  const input = await largeBundle(postgres, { complaints: sheets });
  const result = compareCanonicalParityBundle(input);
  const duplicate = result.findings.find((finding) => finding.findingType === "DUPLICATE_BOTH_SOURCES");
  assert.equal(input.counts.recordsByModule.complaints.postgresTickets, count);
  assert.equal(input.counts.recordsByModule.complaints.sheetsTickets, count);
  assert.equal(duplicate.postgresReferences.length, count);
  assert.equal(duplicate.sheetsReferences.length, count);
  assert.equal(result.summary.duplicateBothGroups, 1);
  assert.equal(Object.isFrozen(duplicate.postgresReferences), true);
  assert.equal(Object.isFrozen(duplicate.sheetsReferences), true);
});

test("10,000 tickets under one unknown header emit one module warning", { timeout: 30_000 }, async () => {
  const rows = Array.from({ length: 10_000 }, (_, index) => sheetRow("customer-experience", `S-${index}`));
  const input = await bundleWithSheetOptions([], {
    "customer-experience": { header: Array(16).fill("Unknown"), rows },
  });
  const result = compareCanonicalParityBundle(input);
  assert.equal(result.findings.filter((finding) => finding.module === "customer-experience" &&
    finding.findingType === "MODULE_STRUCTURE_WARNING" && finding.evidenceCode === "UNKNOWN_HEADER").length, 1);
  assert.equal(result.summary.unmatchableSheets, 10_000);
  assert.ok(result.findings.length < 20);
});

test("public comparison fails closed at the total-finding boundary without partial output", { timeout: 30_000 }, async () => {
  const count = 9_000;
  const postgres = Array.from({ length: count }, (_, index) => postgresTicket(index + 1, "complaints", `M-${index}`));
  const sheets = Array.from({ length: count }, (_, index) => sheetRow("complaints", `M-${index}`));
  const input = await largeBundle(postgres, { complaints: sheets });
  assert.throws(() => compareCanonicalParityBundle(input), (error) => {
    const classification = classifyError(error);
    assert.equal(classification.publicCode, "PARITY_LIMIT_EXCEEDED");
    assert.equal(classification.exitCode, 8);
    assert.equal(classification.publicMessage.includes("M-"), false);
    return true;
  });
});
