"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { MalformedSheetsResponseError } = require("../../src/errors");
const { buildSheetsConfiguration, readSheetsEnvironment } = require("../../src/sheets/configuration");
const { validateBatchGetResponse } = require("../../src/sheets/row-validation");
const { annotateSnapshot } = require("../../src/sheets/structure");
const { responseFor, sheetsEnvironment } = require("./helpers");

function configuration() { return buildSheetsConfiguration(readSheetsEnvironment(sheetsEnvironment()).modules).modules[0]; }
function params(config = configuration()) { return { spreadsheetId: config.spreadsheetId, ranges: [config.parsedRange.headerRange, config.parsedRange.dataRange] }; }

test("validation preserves blank, duplicate, interior blank, and dangerous-looking string cells", () => {
  const rows = [[], ["duplicate", "", "__proto__"], ["duplicate", "", "__proto__"]];
  const validated = validateBatchGetResponse(responseFor(params(), { rows }), configuration());
  assert.deepEqual(validated.dataRows, rows);
  assert.notEqual(validated.dataRows, rows);
  assert.equal(Object.isFrozen(validated.dataRows), true);
  assert.equal(Object.isFrozen(validated.dataRows[1]), true);
});

test("missing values is accepted only as the documented empty range shape", () => {
  const config = configuration();
  const response = responseFor(params(config), { missingHeaderValues: true });
  delete response.data.valueRanges[1].values;
  const validated = validateBatchGetResponse(response, config);
  assert.deepEqual(validated.headerCells, []);
  assert.deepEqual(validated.dataRows, []);
});

test("present undefined or null values are rejected rather than treated as absent", () => {
  const config = configuration();
  for (const value of [undefined, null]) {
    const response = responseFor(params(config));
    response.data.valueRanges[1].values = value;
    assert.throws(() => validateBatchGetResponse(response, config), MalformedSheetsResponseError);
  }
  const missing = responseFor(params(config));
  delete missing.data.valueRanges[1].values;
  assert.deepEqual(validateBatchGetResponse(missing, config).dataRows, []);
});

test("returned ranges are safe, bounded, and consistent with returned row counts", () => {
  const config = configuration();
  const invalidRanges = [
    { range: "'CCTV'!A2:M2", rows: [["one"], ["two"]] },
    { range: "'CCTV'!A2:M999999999999999999999999", rows: [["one"]] },
    { range: "'Other'!A2:M", rows: [] },
    { range: "'CCTV'!B2:M", rows: [] },
    { range: "'CCTV'!A4:M2", rows: [] },
  ];
  for (const { range, rows } of invalidRanges) {
    const response = responseFor(params(config), { rows });
    response.data.valueRanges[1].range = range;
    assert.throws(() => validateBatchGetResponse(response, config), MalformedSheetsResponseError, range);
  }

  const boundedEnvironment = sheetsEnvironment({ GOOGLE_SHEET_RANGE_CCTV: "'CCTV'!A2:M10" });
  const bounded = buildSheetsConfiguration(readSheetsEnvironment(boundedEnvironment).modules).modules[0];
  const outside = responseFor(params(bounded), { rows: [] });
  outside.data.valueRanges[1].range = "'CCTV'!A2:M11";
  assert.throws(() => validateBatchGetResponse(outside, bounded), MalformedSheetsResponseError);

  const normalized = responseFor(params(config), { rows: [["one"], ["two"]] });
  normalized.data.valueRanges[0].range = "CCTV!A1:M1";
  normalized.data.valueRanges[1].range = "CCTV!A2:M3";
  assert.deepEqual(validateBatchGetResponse(normalized, config).dataRows, [["one"], ["two"]]);
});

test("calculated physical row boundaries are enforced for open and bounded ranges", () => {
  function configFor(range) {
    return buildSheetsConfiguration(readSheetsEnvironment(sheetsEnvironment({ GOOGLE_SHEET_RANGE_CCTV: range })).modules).modules[0];
  }
  function validate(config, rows, returnedRange = config.parsedRange.dataRange) {
    const response = responseFor(params(config), { rows });
    response.data.valueRanges[1].range = returnedRange;
    return validateBatchGetResponse(response, config);
  }

  const maximumStart = configFor("'CCTV'!A1000000:M");
  assert.deepEqual(validate(maximumStart, []).dataRows, []);
  assert.deepEqual(validate(maximumStart, [["one"]]).dataRows, [["one"]]);
  assert.throws(() => validate(maximumStart, [["one"], ["two"]]), MalformedSheetsResponseError);

  const nearMaximum = configFor("'CCTV'!A999999:M");
  const twoRows = validate(nearMaximum, [["one"], ["two"]]);
  assert.deepEqual(twoRows.dataRows, [["one"], ["two"]]);
  assert.throws(() => validate(nearMaximum, [["one"], ["two"], ["three"]]), MalformedSheetsResponseError);
  assert.throws(
    () => validate(nearMaximum, [["one"], ["two"]], "'CCTV'!A999999:M999999"),
    MalformedSheetsResponseError
  );

  const bounded = configFor("'CCTV'!A2:M3");
  assert.deepEqual(validate(bounded, [["one"], ["two"]]).dataRows, [["one"], ["two"]]);
  assert.throws(() => validate(bounded, [["one"], ["two"], ["three"]]), MalformedSheetsResponseError);

  const unsafeExtent = responseFor(params(nearMaximum), { rows: [["one"]] });
  unsafeExtent.data.valueRanges[1].range = "'CCTV'!A999999:M9007199254740992";
  assert.throws(() => validateBatchGetResponse(unsafeExtent, nearMaximum), MalformedSheetsResponseError);

  const snapshot = annotateSnapshot(nearMaximum, twoRows);
  assert.deepEqual(snapshot.rows.map((row) => row.physicalRowNumber), [999999, 1000000]);
});

test("malformed response metadata, order, cells, sparse arrays, accessors, and cycles fail closed", () => {
  const config = configuration();
  const invalid = [];
  invalid.push({ data: { spreadsheetId: config.spreadsheetId, valueRanges: [] } });
  invalid.push(responseFor({ spreadsheetId: "wrong_sheet_identifier_123", ranges: [config.parsedRange.headerRange, config.parsedRange.dataRange] }));
  const wrongOrder = responseFor(params(config)); wrongOrder.data.valueRanges.reverse(); invalid.push(wrongOrder);
  const numeric = responseFor(params(config), { rows: [[1]] }); invalid.push(numeric);
  const nullCell = responseFor(params(config), { rows: [[null]] }); invalid.push(nullCell);
  const sparse = responseFor(params(config)); sparse.data.valueRanges[1].values = new Array(1); invalid.push(sparse);
  const rowSparse = responseFor(params(config)); rowSparse.data.valueRanges[1].values = [new Array(1)]; invalid.push(rowSparse);
  const accessor = responseFor(params(config)); Object.defineProperty(accessor.data.valueRanges[0], "values", { enumerable: true, get() { throw new Error("secret getter"); } }); invalid.push(accessor);
  const cyclic = responseFor(params(config)); cyclic.data.valueRanges[1].values = [[cyclic]]; invalid.push(cyclic);
  const extra = responseFor(params(config)); extra.data.valueRanges[0].unexpected = true; invalid.push(extra);
  for (const response of invalid) assert.throws(() => validateBatchGetResponse(response, config), MalformedSheetsResponseError);
});

test("row, column, cell-length, cell-count, and text limits fail without truncation", () => {
  const config = configuration();
  const cases = [
    Array.from({ length: 10_001 }, () => []),
    [Array.from({ length: 33 }, () => "x")],
    [["x".repeat(50_001)]],
    Array.from({ length: 10_000 }, () => Array.from({ length: 32 }, () => "")),
    Array.from({ length: 11 }, () => Array.from({ length: 32 }, () => "x".repeat(50_000))),
  ];
  for (const rows of cases) assert.throws(() => validateBatchGetResponse(responseFor(params(config), { rows }), config), MalformedSheetsResponseError);
});
