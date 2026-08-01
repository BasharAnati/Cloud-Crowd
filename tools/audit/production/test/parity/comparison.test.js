"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { compareCanonicalParityBundle } = require("../../src/parity");
const { bundle, postgresTicket, sheetRow } = require("./helpers");

test("strict values, field states, and canonical dates produce factual minimized findings", async () => {
  const result = compareCanonicalParityBundle(await bundle([
    postgresTicket(1, "ce", "ORDER-1", {
      customerName: "Sensitive Canary", phone: "079-secret", branch: "Amman",
      creationDate: "2026-01-01T00:00:00Z", customerNotes: "private note",
    }),
  ], {
    "customer-experience": [sheetRow("customer-experience", "ORDER-1", {
      2: "Different Name", 3: "079-other", 4: "2026-01-01T02:00:00+02:00", 7: "amman", 12: "sheet secret",
    })],
  }));
  assert.ok(result.summary.fieldValueMismatches >= 3);
  const createdAt = result.findings.filter((finding) => finding.field === "createdAt");
  assert.equal(createdAt.some((finding) => finding.findingType === "FIELD_VALUE_MISMATCH"), false);
  const serialized = JSON.stringify(result);
  for (const canary of ["Sensitive Canary", "079-secret", "private note", "Different Name", "sheet secret"])
    assert.equal(serialized.includes(canary), false);
});

test("aware-local and precision differences use the fixed date taxonomy", async () => {
  const awareLocal = compareCanonicalParityBundle(await bundle([
    postgresTicket(1, "ce", "A", { creationDate: "2026-01-01T00:00:00Z" }),
    postgresTicket(2, "ce", "B", { creationDate: "2026-01-01" }),
  ], {
    "customer-experience": [
      sheetRow("customer-experience", "A", { 4: "2026-01-01T00:00" }),
      sheetRow("customer-experience", "B", { 4: "2026-01-01T00:00" }),
    ],
  }));
  assert.ok(awareLocal.summary.findingsByType.DATE_NOT_COMPARABLE >= 1);
  assert.ok(awareLocal.findings.some((finding) => finding.field === "createdAt" && finding.evidenceCode === "DATE_PRECISION_DIFFERENCE"));
});

test("equal local and date-only canonical dates do not mismatch", async () => {
  const result = compareCanonicalParityBundle(await bundle([
    postgresTicket(1, "ce", "DATE", { creationDate: "2026-03-04" }),
  ], { "customer-experience": [sheetRow("customer-experience", "DATE", { 4: "2026-03-04" })] }));
  assert.equal(result.findings.some((finding) => finding.field === "createdAt"), false);
});

test("CCTV collections and metadata remain explicitly non-comparable without parsing or fetching", async () => {
  const result = compareCanonicalParityBundle(await bundle([
    postgresTicket(1, "cctv", "C-1", { cameras: ["A", "B"], cctvPdf: {
      name: "private.pdf", type: "application/pdf", dataUrl: "https://secret.invalid",
    } }),
  ], { cctv: [sheetRow("cctv", "C-1", { 3: "A, B", 11: "owner" })] }));
  assert.ok(result.findings.some((finding) => finding.field === "cameras" && finding.findingType === "FIELD_NOT_COMPARABLE"));
  assert.equal(JSON.stringify(result).includes("secret.invalid"), false);
});

test("result, findings, nested counts, and summary are deeply immutable null-prototype data", async () => {
  const result = compareCanonicalParityBundle(await bundle());
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.findings), true);
  assert.equal(Object.isFrozen(result.summary), true);
  assert.equal(Object.isFrozen(result.summary.findingsByModule), true);
  assert.throws(() => result.findings.push(null));
});
