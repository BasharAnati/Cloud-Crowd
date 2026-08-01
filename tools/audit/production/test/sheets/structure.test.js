"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildSheetsConfiguration, readSheetsEnvironment } = require("../../src/sheets/configuration");
const { annotateSnapshot } = require("../../src/sheets/structure");
const { sheetsEnvironment } = require("./helpers");

function configs() { return buildSheetsConfiguration(readSheetsEnvironment(sheetsEnvironment()).modules).modules; }
function validated(headerCells, dataRows) {
  return { headerCells: Object.freeze(headerCells), dataRows: Object.freeze(dataRows.map(Object.freeze)), cellCount: headerCells.length + dataRows.reduce((sum, row) => sum + row.length, 0), textLength: 0 };
}

test("snapshots preserve rows and annotate empty, header-only, short, wide, and trailing omission shapes", () => {
  const config = configs()[1];
  const empty = annotateSnapshot(config, validated([], []));
  assert.equal(empty.structuralFlags.includes("EMPTY_SHEET"), true);
  const headerOnly = annotateSnapshot(config, validated(Array(16).fill("unknown"), []));
  assert.equal(headerOnly.structuralFlags.includes("HEADER_ONLY"), true);
  const rows = [[], ["a", "", "b"], Array(17).fill("wide"), ["a", "", "b"]];
  const snapshot = annotateSnapshot(config, validated(Array(16).fill("unknown"), rows));
  assert.deepEqual(snapshot.rows.map((row) => row.cells), rows);
  assert.equal(snapshot.rows[0].structuralFlags.includes("SHORT_ROW"), true);
  assert.equal(snapshot.rows[0].trailingOmissionCount, 16);
  assert.equal(snapshot.rows[2].structuralFlags.includes("WIDE_ROW"), true);
  assert.equal(snapshot.rows[1].physicalRowNumber, 3);
  assert.equal(Object.isFrozen(snapshot.rows[1].cells), true);
  assert.equal(Object.isFrozen(snapshot.structuralFlags), true);
  assert.throws(() => { snapshot.rows[1].cells[0] = "changed"; }, TypeError);
});

test("CCTV metadata classifications preserve raw L and M values", () => {
  const config = configs()[0];
  const prefix = ["Status", "Branch", "Date & Time", "Cameras", "Sections", "Staff", "Review Type", "Violations", "Notes", "Action Taken", "Case Number"];
  const creation = annotateSnapshot(config, validated([...prefix, "Created By", "Created At"], [[...Array(11).fill(""), "creator", "2025-01-01T10:00:00Z"]]));
  assert.equal(creation.cctvClassification, "CREATION_METADATA");
  assert.equal(creation.rows[0].cctvMetadata.classification, "CREATION_METADATA");
  const pdf = annotateSnapshot(config, validated([...prefix, "PDF Name", "PDF URL"], [[...Array(11).fill(""), "file.pdf", "https://example.invalid/file.pdf"]]));
  assert.equal(pdf.cctvClassification, "PDF_METADATA");
  assert.equal(pdf.rows[0].cells[11], "file.pdf");
  const ambiguous = annotateSnapshot(config, validated([...prefix, "Unknown L", "Unknown M"], [[...Array(11).fill(""), "raw-l", "https://example.invalid/file"]]));
  assert.equal(ambiguous.rows[0].cctvMetadata.classification, "AMBIGUOUS");
  assert.deepEqual(ambiguous.rows[0].cctvMetadata.evidence, ["PDF_URL_PATTERN"]);
  const conflict = annotateSnapshot(config, validated([...prefix, "Created By", "Created At"], [[...Array(11).fill(""), "file.pdf", "https://example.invalid/file"]]));
  assert.equal(conflict.rows[0].cctvMetadata.classification, "CONFLICTING_EVIDENCE");
  assert.equal(conflict.rows[0].structuralFlags.includes("CCTV_CONFLICTING_EVIDENCE"), true);
});

test("complimentary attachment-like values remain unmodified raw strings", () => {
  const config = configs()[3];
  const value = "data:image/png;base64,raw-not-fetched";
  const snapshot = annotateSnapshot(config, validated(Array(13).fill("unknown"), [[value]]));
  assert.equal(snapshot.rows[0].cells[0], value);
  assert.equal(Object.hasOwn(snapshot.rows[0], "attachment"), false);
});
