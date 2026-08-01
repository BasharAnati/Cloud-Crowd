"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildAuditReport } = require("../../src/report");
const { compareCanonicalParityBundle } = require("../../src/parity");
const { EXPECTED_HEADERS } = require("../../src/sheets/structure");
const { bundleWithSheetOptions } = require("../parity/helpers");
const { parityResult, postgresTicket, sheetRow } = require("./helpers");

function typedEntries(report) {
  const output = [];
  for (const module of report.moduleSections) for (const category of module.categorySections)
    for (const group of category.findingGroups) for (const entry of group.entries) output.push({ type: group.findingType, group, entry });
  return output;
}

test("safe PostgreSQL and Sheet references are cloned into non-link reference objects", async () => {
  const parity = await parityResult([
    postgresTicket(101, "ce", "PG-ONLY"),
  ], { complaints: [sheetRow("complaints", "SH-ONLY")] });
  const report = buildAuditReport(parity);
  const typed = typedEntries(report);
  const postgres = typed.find((item) => item.type === "POSTGRES_ONLY_RECORD").entry.references.postgres[0];
  const sheets = typed.find((item) => item.type === "SHEET_ONLY_RECORD").entry.references.sheets[0];
  assert.deepEqual({ ...postgres }, { source: "postgresql", kind: "ticket", value: "101", label: "DB ticket: 101" });
  assert.deepEqual({ ...sheets }, { source: "google-sheets", kind: "row", value: "2", label: "Sheet row: 2" });
  for (const reference of [postgres, sheets]) {
    assert.equal(Object.getPrototypeOf(reference), null);
    assert.equal(Object.isFrozen(reference), true);
    assert.equal(Object.hasOwn(reference, "url"), false);
    assert.equal(Object.hasOwn(reference, "tab"), false);
    assert.equal(Object.hasOwn(reference, "range"), false);
  }
});

test("duplicate counts and references remain source-specific without choosing a correct record", async () => {
  const parity = await parityResult([
    postgresTicket(1, "complaints", "DUP"), postgresTicket(2, "complaints", "DUP"),
  ], { complaints: [sheetRow("complaints", "DUP"), sheetRow("complaints", "DUP")] });
  const duplicate = typedEntries(buildAuditReport(parity)).find((item) => item.type === "DUPLICATE_BOTH_SOURCES");
  assert.deepEqual({ ...duplicate.entry.counts }, { postgres: 2, sheets: 2 });
  assert.deepEqual(duplicate.entry.references.postgres.map((value) => value.value), ["1", "2"]);
  assert.deepEqual(duplicate.entry.references.sheets.map((value) => value.value), ["2", "3"]);
  assert.equal(/correct|repair|delete/i.test(duplicate.group.description), false);
});

test("field reports contain only labels, states, evidence, fingerprints, and safe references", async () => {
  const parity = await parityResult([
    postgresTicket(1, "ce", "FIELD-CANARY", { branch: "DATABASE SECRET" }),
  ], { "customer-experience": [sheetRow("customer-experience", "FIELD-CANARY", { 7: "SHEET SECRET" })] });
  const mismatch = typedEntries(buildAuditReport(parity)).find((item) => item.type === "FIELD_VALUE_MISMATCH" && item.entry.field.code === "branch");
  assert.equal(mismatch.entry.field.label, "Branch");
  assert.equal(mismatch.group.description, "Canonical field values differ between sources.");
  const serialized = JSON.stringify(mismatch);
  assert.equal(serialized.includes("DATABASE SECRET"), false);
  assert.equal(serialized.includes("SHEET SECRET"), false);
  assert.equal(serialized.includes("FIELD-CANARY"), false);
});

test("CCTV metadata and attachment findings remain in their fixed minimized categories", async () => {
  const conflicting = compareCanonicalParityBundle(await bundleWithSheetOptions([
    postgresTicket(1, "cctv", "CCTV-CONFLICT"),
  ], {
    cctv: { rows: [sheetRow("cctv", "CCTV-CONFLICT", { 11: "private owner", 12: "https://private.invalid/file" })] },
  }));
  const conflict = typedEntries(buildAuditReport(conflicting)).find((item) => item.type === "CCTV_METADATA_CONFLICT");
  assert.ok(conflict);
  assert.equal(conflict.group.description, "CCTV metadata contains conflicting structural evidence.");
  assert.equal(JSON.stringify(conflict).includes("private.invalid"), false);
  assert.equal(JSON.stringify(conflict).includes("private owner"), false);

  const attachments = compareCanonicalParityBundle(await bundleWithSheetOptions([
    postgresTicket(2, "cctv", "CCTV-PDF", { cctvPdf: { name: "private.pdf", type: "pdf", dataUrl: "PRIVATE-URL" } }),
  ], {
    cctv: {
      header: [...EXPECTED_HEADERS.cctv.slice(0, 11), "PDF Name", "PDF URL"],
      rows: [sheetRow("cctv", "CCTV-PDF")],
    },
  }));
  const mismatch = typedEntries(buildAuditReport(attachments)).find((item) => item.type === "ATTACHMENT_COUNT_MISMATCH");
  assert.ok(mismatch);
  assert.equal(mismatch.entry.counts, null);
  assert.equal(JSON.stringify(mismatch).includes("PRIVATE-URL"), false);
  assert.equal(JSON.stringify(mismatch).includes("private.pdf"), false);
});
