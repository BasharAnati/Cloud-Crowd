"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { compareCanonicalParityBundle } = require("../../src/parity");
const { bundle, postgresTicket, sheetRow } = require("./helpers");

test("empty and populated modules emit structure and presence facts without fabricated tickets", async () => {
  const result = compareCanonicalParityBundle(await bundle([
    postgresTicket(1, "ce", "PG-ONLY"),
  ], { complaints: [sheetRow("complaints", "SH-ONLY")] }));
  assert.equal(result.summary.findingsByType.MODULE_HEADER_ONLY, 3);
  assert.equal(result.summary.postgresOnly, 1);
  assert.equal(result.summary.sheetsOnly, 1);
  assert.equal(result.summary.postgresTickets, 1);
  assert.equal(result.summary.sheetsTickets, 1);
});

test("finding ordering is fixed by module, taxonomy, fingerprint, field, and reference", async () => {
  const input = await bundle([
    postgresTicket(1, "complaints", "B"), postgresTicket(2, "complaints", "A"),
  ], { complaints: [sheetRow("complaints", "C")] });
  const first = compareCanonicalParityBundle(input);
  const second = compareCanonicalParityBundle(input);
  assert.deepEqual(first, second);
  const types = first.findings.filter((finding) => finding.module === "complaints").map((finding) => finding.findingType);
  assert.deepEqual(types, [...types].sort((a, b) => ({ POSTGRES_ONLY_RECORD: 0, SHEET_ONLY_RECORD: 1 }[a] ?? -1) -
    ({ POSTGRES_ONLY_RECORD: 0, SHEET_ONLY_RECORD: 1 }[b] ?? -1)));
});

test("summary count maps include the complete closed taxonomy and neutral classes", async () => {
  const result = compareCanonicalParityBundle(await bundle());
  assert.equal(Object.hasOwn(result.summary.findingsByType, "FIELD_VALUE_MISMATCH"), true);
  assert.deepEqual(Object.keys(result.summary.findingsByClass), ["ERROR", "WARNING", "INFO", "NOT_COMPARABLE"]);
  assert.equal(Object.hasOwn(result.summary, "pass"), false);
  assert.equal(Object.hasOwn(result.summary, "fail"), false);
});

function total(values) { return Object.values(values).reduce((sum, value) => sum + value, 0); }

test("summary categories independently reconcile with records and findings", async () => {
  const input = await bundle([
    postgresTicket(1, "ce", "MATCH", { branch: "left" }),
    postgresTicket(2, "ce", "PG-ONLY"),
    postgresTicket(3, "complaints", "DUP"),
    postgresTicket(4, "complaints", "DUP"),
    postgresTicket(5, "free-orders", undefined, { newOrderNumber: "NOT-IDENTITY" }),
  ], {
    "customer-experience": [sheetRow("customer-experience", "MATCH", { 7: "right" }), sheetRow("customer-experience", "SH-ONLY")],
    complaints: [sheetRow("complaints", "DUP")],
    "complimentary-orders": [sheetRow("complimentary-orders", "")],
  });
  const result = compareCanonicalParityBundle(input);
  const typeCount = (type) => result.findings.filter((finding) => finding.findingType === type).length;
  const structuralTypes = new Set(["MODULE_EMPTY", "MODULE_HEADER_ONLY", "MODULE_STRUCTURE_WARNING", "MODULE_NOT_COMPARABLE"]);
  assert.equal(result.summary.postgresTickets, input.postgresRecords.length);
  assert.equal(result.summary.sheetsTickets, input.sheetsRecords.filter((record) => record.recordType === "ticket").length);
  assert.equal(result.summary.matchedUniquePairs, 1);
  assert.equal(result.summary.postgresOnly, typeCount("POSTGRES_ONLY_RECORD"));
  assert.equal(result.summary.sheetsOnly, typeCount("SHEET_ONLY_RECORD"));
  assert.equal(result.summary.duplicatePostgresGroups, typeCount("DUPLICATE_POSTGRES_KEY"));
  assert.equal(result.summary.duplicateSheetsGroups, typeCount("DUPLICATE_SHEET_KEY"));
  assert.equal(result.summary.duplicateBothGroups, typeCount("DUPLICATE_BOTH_SOURCES"));
  assert.equal(result.summary.ambiguousMatchGroups,
    result.summary.duplicatePostgresGroups + result.summary.duplicateSheetsGroups + result.summary.duplicateBothGroups);
  assert.equal(result.summary.fieldValueMismatches, typeCount("FIELD_VALUE_MISMATCH"));
  assert.equal(result.summary.fieldStateMismatches, typeCount("FIELD_STATE_MISMATCH"));
  assert.equal(result.summary.notComparableFields,
    typeCount("FIELD_NOT_COMPARABLE") + typeCount("DATE_NOT_COMPARABLE") + typeCount("ATTACHMENT_NOT_COMPARABLE"));
  assert.equal(result.summary.structuralFindings, result.findings.filter((finding) => structuralTypes.has(finding.findingType)).length);
  assert.equal(total(result.summary.findingsByModule), result.findings.length);
  assert.equal(total(result.summary.findingsByType), result.findings.length);
  assert.equal(total(result.summary.findingsByClass), result.findings.length);
  assert.equal(result.summary.unmatchablePostgres, 3);
  assert.equal(result.summary.unmatchableSheets, 2);
  assert.equal(result.summary.postgresOnly + result.summary.sheetsOnly, 2);
});

test("source-order-preserving duplicate references remain deterministic for equivalent trusted rows", async () => {
  const first = await bundle([postgresTicket(1, "ce", "DUP")], {
    "customer-experience": [sheetRow("customer-experience", "DUP", { 2: "left" }), sheetRow("customer-experience", "DUP", { 2: "right" })],
  });
  const reversed = await bundle([postgresTicket(1, "ce", "DUP")], {
    "customer-experience": [sheetRow("customer-experience", "DUP", { 2: "right" }), sheetRow("customer-experience", "DUP", { 2: "left" })],
  });
  const left = compareCanonicalParityBundle(first);
  const right = compareCanonicalParityBundle(reversed);
  assert.deepEqual(left, right);
  const duplicate = left.findings.find((finding) => finding.findingType === "DUPLICATE_SHEET_KEY");
  assert.deepEqual([...duplicate.sheetsReferences], ["2", "3"]);
});
