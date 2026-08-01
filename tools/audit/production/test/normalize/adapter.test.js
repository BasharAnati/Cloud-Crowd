"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const normalize = require("../../src/normalize");
const {
  DEFAULT_HISTORY,
  DEFAULT_TICKET,
  trustedAllSheetsSnapshot,
  trustedHistorySnapshot,
  trustedSheetSnapshot,
  trustedTicketSnapshot,
} = require("./helpers");

test("normalization public API contains only the three fixed operations", () => {
  assert.deepEqual(Object.keys(normalize).sort(), ["normalizeAll", "normalizePostgresSnapshot", "normalizeSheetsSnapshot"]);
  assert(Object.isFrozen(normalize));
});

test("normalizes a trusted PostgreSQL ticket page to the canonical model", async () => {
  const snapshot = await trustedTicketSnapshot();
  const records = normalize.normalizePostgresSnapshot(snapshot);
  assert.equal(records[0].source, "postgresql");
  assert.equal(records[0].recordType, "ticket");
  assert.equal(records[0].module, "customer-experience");
  assert.equal(records[0].ticketId, "9007199254740993");
  assert.equal(records[0].orderNumber, "ORD-1");
  assert.equal(records[0].status, "Open");
  assert.equal(records[0].customerName, " Alice\nSmith");
  assert.equal(records[0].createdAt.local, "2026-07-31T12:30");
  assert.equal(records[0].createdAt.instant, null);
  assert.equal(records[0].databaseCreatedAt.instant, "2026-07-31T10:00:00Z");
  assert.equal(records[0].updatedAt.instant, "2026-08-01T10:00:00.000Z");
});

test("normalizes PostgreSQL history independently", async () => {
  const records = normalize.normalizePostgresSnapshot(await trustedHistorySnapshot());
  assert.equal(records[0].ticketId, DEFAULT_HISTORY.ticket_id);
  assert.equal(records[0].historyReference, DEFAULT_HISTORY.id);
  assert.equal(records[0].recordType, "history");
  assert.equal(records[0].status, null);
  assert.equal(records[0].previousStatus, "Open");
  assert.equal(records[0].newStatus, "Closed");
  assert.equal(records[0].newAction, " Completed");
  assert.equal(records[0].orderNumber, null);
});

test("normalizes empty trusted PostgreSQL pages without inventing records", async () => {
  assert.deepEqual(normalize.normalizePostgresSnapshot(await trustedTicketSnapshot([])), []);
});

test("normalizes positional Customer Experience Sheet values", async () => {
  const row = ["Open", "Ops", " Alice ", " 079 ", "2026-07-31", "PM", "Delivery", " Amman ", "R", "App", "2026-08-01", "Issue", " Note ", "Action", "Happy", " ORD-2 "];
  const records = normalize.normalizeSheetsSnapshot(await trustedSheetSnapshot("readCustomerExperienceSheet", [row]));
  assert.equal(records[0].module, "customer-experience");
  assert.equal(records[0].orderNumber, "ORD-2");
  assert.equal(records[0].customerName, " Alice");
  assert.equal(records[0].createdAt.local, "2026-07-31");
  assert.equal(records[0].createdAt.precision, "date");
  assert.equal(records[0].rowReference, "2");
});

test("normalizes all four trusted Sheet snapshots in fixed order", async () => {
  const rows = {
    cctv: [["Open", "A", "2026-01-01", "", "", "", "", "", "N", "A", "C-1"]],
    "customer-experience": [["Open", "", "A", "1", "2026-01-02", "", "", "B", "", "", "", "", "N", "", "", "O-2"]],
    complaints: [["Open", "", "A", "1", "2026-01-03", "", "", "B", "", "", "", "N", "", "O-3"]],
    "complimentary-orders": [["Open", "A", "1", "2026-01-04", "", "", "", "", "", "", "N", "", "O-4"]],
  };
  const records = normalize.normalizeSheetsSnapshot(await trustedAllSheetsSnapshot(rows));
  assert.deepEqual(records.map((record) => record.module), ["cctv", "customer-experience", "complaints", "complimentary-orders"]);
  assert.deepEqual(records.map((record) => record.orderNumber), [null, "O-2", "O-3", "O-4"]);
  assert.equal(records[0].caseNumber, "C-1");
});

test("normalizeAll concatenates normalized records without comparing them", async () => {
  const postgres = await trustedTicketSnapshot();
  const sheets = await trustedAllSheetsSnapshot({
    "customer-experience": [["Open", "", "A", "1", "2026-01-02", "", "", "B", "", "", "", "", "N", "", "", "O-2"]],
  });
  const records = normalize.normalizeAll(postgres, sheets);
  assert.deepEqual(records.map((record) => record.source), ["postgresql", "google-sheets", "google-sheets", "google-sheets", "google-sheets"]);
  assert.deepEqual(records.map((record) => record.recordType), ["ticket", "module", "ticket", "module", "module"]);
  assert.throws(() => normalize.normalizeAll(postgres), { name: "NormalizationUnsupportedSnapshotError" });
});

test("duplicate PostgreSQL and Sheet records remain duplicates and ordered", async () => {
  const tickets = normalize.normalizePostgresSnapshot(await trustedTicketSnapshot([DEFAULT_TICKET, DEFAULT_TICKET]));
  assert.equal(tickets.length, 2);
  assert.deepEqual(tickets[0], tickets[1]);
  const row = ["Open", "", "Alice", "1", "2026-01-02", "", "", "B", "", "", "", "", "N", "", "", "O"];
  const sheets = normalize.normalizeSheetsSnapshot(await trustedSheetSnapshot("readCustomerExperienceSheet", [row, row]));
  assert.equal(sheets.length, 2);
  assert.deepEqual({ ...sheets[0], rowReference: null }, { ...sheets[1], rowReference: null });
  assert.equal(sheets[0].rowReference, "2");
  assert.equal(sheets[1].rowReference, "3");
});

test("rejects malformed dates instead of repairing them", async () => {
  const bad = { ...DEFAULT_TICKET, payload: { ...DEFAULT_TICKET.payload, creationDate: "2026-02-30" } };
  const snapshot = await trustedTicketSnapshot([bad]);
  assert.throws(() => normalize.normalizePostgresSnapshot(snapshot), { name: "NormalizationDateError" });
});

test("rejects forged, cloned, and hostile input structures", async () => {
  const snapshot = await trustedTicketSnapshot();
  const hostile = [
    { rows: [], nextCursor: null },
    { ...snapshot },
    Object.freeze({ rows: [], nextCursor: null }),
    new Proxy({}, { getPrototypeOf() { throw new Error("secret"); } }),
    { rows: [() => {}], nextCursor: null },
    { rows: [Symbol("bad")], nextCursor: null },
    Object.create({ rows: [] }),
  ];
  const cyclic = {};
  cyclic.self = cyclic;
  hostile.push(cyclic);
  const accessor = {};
  Object.defineProperty(accessor, "rows", { get() { throw new Error("secret"); } });
  hostile.push(accessor);
  for (const value of hostile) {
    assert.throws(() => normalize.normalizePostgresSnapshot(value), {
      name: "NormalizationUntrustedSnapshotError",
    });
  }
});
