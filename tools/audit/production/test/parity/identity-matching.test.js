"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { compareCanonicalParityBundle } = require("../../src/parity");
const { bundle, postgresTicket, sheetRow } = require("./helpers");

test("fixed module identities produce unique matches and never cross module boundaries", async () => {
  const result = compareCanonicalParityBundle(await bundle([
    postgresTicket(1, "cctv", "SAME"), postgresTicket(2, "ce", "SAME"),
    postgresTicket(3, "complaints", "COM-1"), postgresTicket(4, "free-orders", "FREE-1"),
  ], {
    cctv: [sheetRow("cctv", "SAME")],
    "customer-experience": [sheetRow("customer-experience", "SAME")],
    complaints: [sheetRow("complaints", "COM-1")],
    "complimentary-orders": [sheetRow("complimentary-orders", "FREE-1")],
  }));
  assert.equal(result.summary.matchedUniquePairs, 4);
  assert.equal(result.summary.postgresOnly, 0);
  assert.equal(result.summary.sheetsOnly, 0);
});

test("case-only, order-only, equal dual, conflict, and missing identities follow the fixed policy", async () => {
  const rows = [
    postgresTicket(1, "ce", undefined, { caseNumber: "CASE-1" }),
    postgresTicket(2, "ce", "ORDER-2"),
    postgresTicket(3, "complaints", "EQUAL", { caseNumber: "EQUAL" }),
    postgresTicket(4, "free-orders", "CONFLICT", { caseNumber: "OTHER" }),
    postgresTicket(5, "free-orders", undefined, { newOrderNumber: "NEVER-IDENTITY" }),
  ];
  const result = compareCanonicalParityBundle(await bundle(rows, {
    "customer-experience": [sheetRow("customer-experience", "CASE-1"), sheetRow("customer-experience", "ORDER-2")],
    complaints: [sheetRow("complaints", "EQUAL")],
  }));
  assert.equal(result.summary.matchedUniquePairs, 3);
  assert.equal(result.summary.findingsByType.AMBIGUOUS_IDENTITY_SOURCE, 1);
  assert.equal(result.summary.findingsByType.MISSING_IDENTITY_KEY, 1);
  assert.equal(JSON.stringify(result).includes("NEVER-IDENTITY"), false);
});

test("duplicates are inventoried without first-record pairing or source-only double counting", async () => {
  const result = compareCanonicalParityBundle(await bundle([
    postgresTicket(1, "ce", "DUP"), postgresTicket(2, "ce", "DUP"),
    postgresTicket(3, "complaints", "PG-ONLY"),
  ], {
    "customer-experience": [sheetRow("customer-experience", "DUP"), sheetRow("customer-experience", "DUP")],
    complaints: [sheetRow("complaints", "SH-ONLY")],
  }));
  const duplicate = result.findings.find((finding) => finding.findingType === "DUPLICATE_BOTH_SOURCES");
  assert.deepEqual({ ...duplicate.counts }, { postgres: 2, sheets: 2 });
  assert.deepEqual([...duplicate.postgresReferences], ["1", "2"]);
  assert.equal(result.summary.ambiguousMatchGroups, 1);
  assert.equal(result.summary.duplicateBothGroups, 1);
  assert.equal(result.summary.duplicatePostgresGroups, 0);
  assert.equal(result.summary.duplicateSheetsGroups, 0);
  assert.equal(result.summary.postgresOnly, 1);
  assert.equal(result.summary.sheetsOnly, 1);
  assert.equal(result.summary.matchedUniquePairs, 0);
});

test("one-sided duplicate groups receive their source-specific closed finding types", async () => {
  const postgresDuplicate = compareCanonicalParityBundle(await bundle([
    postgresTicket(1, "ce", "PG-DUP"), postgresTicket(2, "ce", "PG-DUP"),
  ], { "customer-experience": [sheetRow("customer-experience", "PG-DUP")] }));
  assert.equal(postgresDuplicate.summary.duplicatePostgresGroups, 1);
  assert.equal(postgresDuplicate.summary.findingsByType.DUPLICATE_POSTGRES_KEY, 1);

  const sheetDuplicate = compareCanonicalParityBundle(await bundle([
    postgresTicket(1, "ce", "SH-DUP"),
  ], { "customer-experience": [sheetRow("customer-experience", "SH-DUP"), sheetRow("customer-experience", "SH-DUP")] }));
  assert.equal(sheetDuplicate.summary.duplicateSheetsGroups, 1);
  assert.equal(sheetDuplicate.summary.findingsByType.DUPLICATE_SHEET_KEY, 1);
});

test("identity equality is exact and fingerprints are deterministic and minimized", async () => {
  const input = await bundle([postgresTicket(1, "complaints", "Secret-1")], {
    complaints: [sheetRow("complaints", "secret-1")],
  });
  const first = compareCanonicalParityBundle(input);
  const second = compareCanonicalParityBundle(input);
  assert.deepEqual(first, second);
  assert.equal(first.summary.postgresOnly, 1);
  assert.equal(first.summary.sheetsOnly, 1);
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes("Secret-1"), false);
  const fingerprinted = first.findings.find((finding) => finding.identityFingerprint !== null);
  assert.match(fingerprinted.identityFingerprint, /^COMPLAINTS-[0-9a-f]{24}$/);
});
