"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizePostgresSnapshot, normalizeSheetsSnapshot } = require("../../src/normalize");
const { trustedSheetSnapshot, trustedTicketSnapshot } = require("./helpers");

test("PostgreSQL attachments preserve order and duplicates in independent frozen objects", async () => {
  const attachment = Object.freeze({ dataUrl: "data:application/pdf;base64,AA==", name: " report.pdf ", type: " application/pdf " });
  const row = {
    id: "1", section: "free-orders", status: "Open",
    payload: { orderNumber: "O-1", orderDate: "2026-01-01", attached: attachment, orderOnCirca: attachment },
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  };
  const input = await trustedTicketSnapshot([row]);
  const records = normalizePostgresSnapshot(input);
  assert.equal(records[0].attachments.length, 2);
  assert.deepEqual(records[0].attachments[0], records[0].attachments[1]);
  assert.notStrictEqual(records[0].attachments[0], attachment);
  assert(Object.isFrozen(records));
  assert(Object.isFrozen(records[0]));
  assert(Object.isFrozen(records[0].attachments));
  assert(Object.isFrozen(records[0].attachments[0]));
  assert.throws(() => { records[0].attachments[0].name = "changed"; }, TypeError);
});

test("CCTV PDF metadata becomes an attachment without fetching or renaming", async () => {
  const header = ["Status", "Branch", "Date & Time", "Cameras", "Sections", "Staff", "Review Type", "Violations", "Notes", "Action Taken", "Case Number", "PDF Name", "PDF URL"];
  const row = ["Open", "Branch", "2026-01-01", "", "", "", "", "", "Note", "Action", "C-1", " original.pdf ", " https://example.test/original.pdf "];
  const input = await trustedSheetSnapshot("readCctvSheet", [row], header);
  const records = normalizeSheetsSnapshot(input);
  assert.deepEqual({ ...records[0].attachments[0] }, {
    name: " original.pdf", type: null, reference: "https://example.test/original.pdf",
  });
  assert.equal(records[0].owner, null);
});

test("CCTV creation metadata maps owner and does not guess an attachment", async () => {
  const header = ["Status", "Branch", "Date & Time", "Cameras", "Sections", "Staff", "Review Type", "Violations", "Notes", "Action Taken", "Case Number", "Created By", "Created At"];
  const row = ["Open", "Branch", "2026-01-01", "", "", "", "", "", "", "", "C-1", " Alice ", "2026-01-01"];
  const records = normalizeSheetsSnapshot(await trustedSheetSnapshot("readCctvSheet", [row], header));
  assert.equal(records[0].owner, "Alice");
  assert.equal(records[0].attachments, null);
});

test("empty strings remain distinct from null fields", async () => {
  const row = ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""];
  const records = normalizeSheetsSnapshot(await trustedSheetSnapshot("readCustomerExperienceSheet", [row]));
  assert.equal(records[0].status, "");
  assert.equal(records[0].orderNumber, "");
  assert.equal(records[0].createdAt, null);
  assert.equal(records[0].attachments, null);
  assert.equal(records[0].sourceMetadata.fieldStates.status, "EMPTY_STRING");
});
