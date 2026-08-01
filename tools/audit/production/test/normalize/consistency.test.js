"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeAll, normalizePostgresSnapshot, normalizeSheetsSnapshot } = require("../../src/normalize");
const {
  DEFAULT_TICKET,
  trustedAllSheetsSnapshot,
  trustedSheetSnapshot,
  trustedTicketSnapshot,
} = require("./helpers");

function cctvTicket(payload) {
  return {
    id: "1",
    section: "cctv",
    status: "Open",
    payload,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

test("CCTV collections use one source-independent descriptor without delimiter parsing", async () => {
  const postgres = normalizePostgresSnapshot(await trustedTicketSnapshot([cctvTicket({
    cameras: ["Camera 1", "Camera 2"], sections: ["A"], staff: [], violations: ["Policy 1"],
  })]))[0];
  const sheet = normalizeSheetsSnapshot(await trustedSheetSnapshot("readCctvSheet", [[
    "Open", "Branch", "2026-01-01", "Camera 1, Camera 2", "A", "", "Review", "Policy 1", "", "", "C-1",
  ]]))[0];

  for (const field of ["cameras", "sections", "staff", "violatedPolicy"]) {
    assert.deepEqual(Object.keys(postgres[field]), ["raw", "items"]);
    assert.deepEqual(Object.keys(sheet[field]), ["raw", "items"]);
    assert(Object.isFrozen(postgres[field]));
    assert(Object.isFrozen(sheet[field]));
  }
  assert.deepEqual({ ...postgres.cameras }, { raw: null, items: ["Camera 1", "Camera 2"] });
  assert.deepEqual({ ...sheet.cameras }, { raw: "Camera 1, Camera 2", items: null });
  assert.equal(sheet.sourceMetadata.fieldStates.cameras, "VALUE");
  assert.equal(postgres.sourceMetadata.fieldStates.cameras, "VALUE");
});

test("empty and header-only Sheets produce immutable module records with structural metadata", async () => {
  const empty = normalizeSheetsSnapshot(await trustedSheetSnapshot(
    "readCustomerExperienceSheet", [], undefined, { missingHeaderValues: true }
  ));
  assert.equal(empty.length, 1);
  assert.equal(empty[0].source, "google-sheets");
  assert.equal(empty[0].recordType, "module");
  assert.equal(empty[0].module, "customer-experience");
  assert.deepEqual(empty[0].structuralFlags, ["EMPTY_SHEET", "HEADER_WIDTH_MISMATCH", "UNKNOWN_HEADER"]);
  assert.equal(empty[0].sourceMetadata.configuredWidth, 16);
  assert.equal(empty[0].sourceMetadata.returnedWidth, 0);
  assert.equal(empty[0].sourceMetadata.maximumDetectedWidth, 0);
  assert.equal(empty[0].sourceMetadata.trailingOmissionCount, null);
  assert.deepEqual(empty[0].sourceMetadata.headerStructuralFlags, ["HEADER_WIDTH_MISMATCH", "UNKNOWN_HEADER"]);
  assert(Object.isFrozen(empty));
  assert(Object.isFrozen(empty[0]));
  assert(Object.isFrozen(empty[0].sourceMetadata));

  const headerOnly = normalizeSheetsSnapshot(await trustedSheetSnapshot("readComplaintsSheet", []));
  assert.equal(headerOnly.length, 1);
  assert.equal(headerOnly[0].recordType, "module");
  assert.equal(headerOnly[0].module, "complaints");
  assert.deepEqual(headerOnly[0].structuralFlags, ["HEADER_ONLY"]);
  assert.deepEqual(headerOnly[0].sourceMetadata.headerStructuralFlags, []);
  assert.equal(headerOnly[0].sourceMetadata.returnedWidth, 14);
  assert.equal(headerOnly[0].sourceMetadata.maximumDetectedWidth, 14);
});

test("normalizeAll retains empty Sheet modules without fabricating tickets", async () => {
  const postgres = await trustedTicketSnapshot([]);
  const sheets = await trustedAllSheetsSnapshot();
  const records = normalizeAll(postgres, sheets);
  assert.equal(records.length, 4);
  assert.deepEqual(records.map((record) => record.recordType), ["module", "module", "module", "module"]);
  assert.deepEqual(records.map((record) => record.module), [
    "cctv", "customer-experience", "complaints", "complimentary-orders",
  ]);
  assert(records.every((record) => record.ticketId === null));
  assert(Object.isFrozen(records));
});

test("blank CCTV PDF metadata preserves L and M but creates no attachment", async () => {
  const header = [
    "Status", "Branch", "Date & Time", "Cameras", "Sections", "Staff", "Review Type", "Violations",
    "Notes", "Action Taken", "Case Number", "PDF Name", "PDF URL",
  ];
  const row = ["Open", "Branch", "2026-01-01", "", "", "", "", "", "", "", "C-1", "", ""];
  const record = normalizeSheetsSnapshot(await trustedSheetSnapshot("readCctvSheet", [row], header))[0];
  assert.equal(record.cctvColumnL, "");
  assert.equal(record.cctvColumnM, "");
  assert.equal(record.sourceMetadata.fieldStates.cctvColumnL, "EMPTY_STRING");
  assert.equal(record.sourceMetadata.fieldStates.cctvColumnM, "EMPTY_STRING");
  assert.equal(record.cctvMetadataClassification, "PDF_METADATA");
  assert.deepEqual(record.cctvMetadataEvidence, []);
  assert.deepEqual(record.attachments, []);
  assert.equal(record.sourceMetadata.fieldStates.attachments, "EMPTY_ARRAY");
  assert(Object.isFrozen(record.attachments));
});

test("offset timestamps that normalize outside four-digit ISO years fail deterministically", async () => {
  for (const creationDate of ["9999-12-31T23:59:59-23:59", "0001-01-01T00:00:00+23:59"]) {
    const row = {
      ...DEFAULT_TICKET,
      payload: { ...DEFAULT_TICKET.payload, creationDate },
    };
    const snapshot = await trustedTicketSnapshot([row]);
    assert.throws(() => normalizePostgresSnapshot(snapshot), { name: "NormalizationDateError" });
  }
});
