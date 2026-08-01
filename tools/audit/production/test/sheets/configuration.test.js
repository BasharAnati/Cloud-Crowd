"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { SheetsConfigurationError } = require("../../src/errors");
const { buildSheetsConfiguration, parseA1Range, readSheetsEnvironment } = require("../../src/sheets/configuration");
const { sheetsEnvironment } = require("./helpers");

test("configuration maps exactly four explicit modules and ignores generic and Thyme variables", () => {
  const raw = readSheetsEnvironment(sheetsEnvironment({
    GOOGLE_SHEET_RANGE: "'Wrong'!A1:Z",
    GOOGLE_SHEET_ID_THYME_TABLE_PLATES: "thyme_should_be_ignored_123",
  }));
  const configuration = buildSheetsConfiguration(raw.modules);
  assert.deepEqual(configuration.modules.map((module) => module.key), ["cctv", "customer-experience", "complaints", "complimentary-orders"]);
  assert.deepEqual(configuration.modules.map((module) => module.width), [13, 16, 14, 13]);
  assert.equal(JSON.stringify(configuration).includes("Wrong"), false);
  assert.equal(JSON.stringify(configuration).includes("thyme"), false);
  assert.equal(Object.isFrozen(configuration), true);
  assert.equal(Object.isFrozen(configuration.modules), true);
});

test("missing IDs or ranges fail with no fallback or cross-module substitution", () => {
  for (const key of [
    "GOOGLE_SHEET_ID_CCTV", "GOOGLE_SHEET_RANGE_CCTV",
    "GOOGLE_SHEET_ID_CUSTOMER_EXPERIENCE", "GOOGLE_SHEET_RANGE_CUSTOMER_EXPERIENCE",
    "GOOGLE_SHEET_ID_DAILY_COMPLAINTS", "GOOGLE_SHEET_RANGE_DAILY_COMPLAINTS",
    "GOOGLE_SHEET_ID_COMPLIMENTARY", "GOOGLE_SHEET_RANGE_COMPLIMENTARY",
  ]) {
    const env = sheetsEnvironment({ GOOGLE_SHEET_RANGE: "'Fallback'!A2:M" });
    delete env[key];
    assert.throws(() => buildSheetsConfiguration(readSheetsEnvironment(env).modules), SheetsConfigurationError, key);
  }
});

test("spreadsheet IDs and A1 ranges are strictly bounded", () => {
  for (const id of ["short", "bad id value 1234567890123", "bad/id/value/1234567890123", "a".repeat(257)]) {
    const raw = readSheetsEnvironment(sheetsEnvironment({ GOOGLE_SHEET_ID_CCTV: id }));
    assert.throws(() => buildSheetsConfiguration(raw.modules), SheetsConfigurationError);
  }
  for (const range of ["A2:M", "'CCTV'!B2:M", "'CCTV'!A2:L", "'CCTV'!A0:M", "'CCTV'!A4:M2", "'CCTV'!A2:ZZ", "'Bad\nTab'!A2:M"]) {
    const raw = readSheetsEnvironment(sheetsEnvironment({ GOOGLE_SHEET_RANGE_CCTV: range }));
    assert.throws(() => buildSheetsConfiguration(raw.modules), SheetsConfigurationError, range);
  }
  const parsed = parseA1Range("'CCTV Ops'!A2:M100", 13);
  assert.equal(parsed.headerRange, "'CCTV Ops'!A1:M1");
  assert.equal(parsed.dataRange, "'CCTV Ops'!A2:M100");
});
