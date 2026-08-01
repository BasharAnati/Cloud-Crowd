"use strict";

const { MalformedSheetsResponseError } = require("../errors");

const LIMITS = Object.freeze({
  rowsPerModule: 10_000,
  columnsPerRow: 32,
  cellsPerModule: 320_000,
  cellLength: 50_000,
  textPerModule: 16 * 1024 * 1024,
  cellsReadAll: 500_000,
  textReadAll: 32 * 1024 * 1024,
  nodes: 400_000,
});
const RESPONSE_RANGE_PATTERN = /^(?:'((?:[^']|'')+)'|([^!]+))!([A-Z]{1,2})([1-9][0-9]*)?:([A-Z]{1,2})([1-9][0-9]*)?$/;

function fail() {
  throw new MalformedSheetsResponseError("Sheets response shape is invalid");
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function dataProperty(object, property, optional = false) {
  if (!isPlainObject(object)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(object, property);
  if (!descriptor) {
    if (optional) return undefined;
    fail();
  }
  if (!("value" in descriptor) || descriptor.enumerable !== true) fail();
  return descriptor.value;
}

function exactKeys(object, required, optional = []) {
  if (!isPlainObject(object)) fail();
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(object);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key)) || required.some((key) => !Object.hasOwn(object, key))) fail();
}

function denseArray(value) {
  if (!Array.isArray(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)))) fail();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) fail();
  }
  return value;
}

function parseResponseRange(value) {
  if (typeof value !== "string" || value.length > 256) fail();
  const match = RESPONSE_RANGE_PATTERN.exec(value);
  if (!match) fail();
  const parsed = {
    tab: (match[1] || match[2]).replace(/''/g, "'"),
    startColumn: match[3],
    startRow: match[4] === undefined ? null : Number(match[4]),
    endColumn: match[5],
    endRow: match[6] === undefined ? null : Number(match[6]),
  };
  for (const row of [parsed.startRow, parsed.endRow]) {
    if (row !== null && (!Number.isSafeInteger(row) || row < 1 || row > 1_000_000)) fail();
  }
  if (parsed.startRow !== null && parsed.endRow !== null && parsed.endRow < parsed.startRow) fail();
  return parsed;
}

function validateReturnedRange(value, configuration, kind, returnedRowCount) {
  const returned = parseResponseRange(value);
  const expected = configuration.parsedRange;
  const expectedStart = kind === "header" ? 1 : expected.dataStartRow;
  const expectedEnd = kind === "header" ? 1 : expected.configuredEndRow;
  if (returned.tab !== expected.tab || returned.startColumn !== expected.startColumn || returned.endColumn !== expected.endColumn || returned.startRow !== expectedStart) fail();
  if (expectedEnd === null) {
    if (returned.endRow !== null && returned.endRow < expectedStart) fail();
  } else if (returned.endRow !== expectedEnd) fail();
  if (returnedRowCount > 0) {
    const lastPhysicalRow = expectedStart + returnedRowCount - 1;
    if (!Number.isSafeInteger(lastPhysicalRow) || lastPhysicalRow < 1 || lastPhysicalRow > 1_000_000 ||
        (returned.endRow !== null && lastPhysicalRow > returned.endRow) ||
        (expectedEnd !== null && lastPhysicalRow > expectedEnd)) fail();
  }
}

function extractData(response) {
  if (!response || typeof response !== "object") fail();
  const descriptor = Object.getOwnPropertyDescriptor(response, "data");
  if (!descriptor || !("value" in descriptor)) fail();
  return descriptor.value;
}

function validateValueRange(valueRange, configuration, kind, state) {
  exactKeys(valueRange, ["range", "majorDimension"], ["values"]);
  const range = dataProperty(valueRange, "range");
  if (dataProperty(valueRange, "majorDimension") !== "ROWS") fail();
  const hasValues = Object.hasOwn(valueRange, "values");
  const rawValues = hasValues ? dataProperty(valueRange, "values") : undefined;
  if (!hasValues) {
    validateReturnedRange(range, configuration, kind, 0);
    return Object.freeze([]);
  }
  denseArray(rawValues);
  validateReturnedRange(range, configuration, kind, rawValues.length);
  if (kind === "header" && rawValues.length > 1) fail();
  if (kind === "data" && rawValues.length > LIMITS.rowsPerModule) fail();
  const rows = rawValues.map((rawRow) => {
    denseArray(rawRow);
    if (rawRow.length > LIMITS.columnsPerRow) fail();
    const cells = rawRow.map((cell) => {
      state.nodes += 1;
      if (state.nodes > LIMITS.nodes || typeof cell !== "string" || cell.length > LIMITS.cellLength) fail();
      state.cells += 1;
      state.text += cell.length;
      if (state.cells > LIMITS.cellsPerModule || state.text > LIMITS.textPerModule) fail();
      return cell;
    });
    return Object.freeze(cells);
  });
  return Object.freeze(rows);
}

function validateBatchGetResponse(response, configuration) {
  try {
    const data = extractData(response);
    exactKeys(data, ["spreadsheetId", "valueRanges"]);
    if (dataProperty(data, "spreadsheetId") !== configuration.spreadsheetId) fail();
    const ranges = denseArray(dataProperty(data, "valueRanges"));
    if (ranges.length !== 2) fail();
    const state = { cells: 0, text: 0, nodes: 0 };
    const headerRows = validateValueRange(ranges[0], configuration, "header", state);
    const dataRows = validateValueRange(ranges[1], configuration, "data", state);
    return Object.freeze({
      headerCells: headerRows.length === 0 ? Object.freeze([]) : headerRows[0],
      dataRows,
      cellCount: state.cells,
      textLength: state.text,
    });
  } catch (error) {
    if (error instanceof MalformedSheetsResponseError) throw error;
    fail();
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === "object") {
    if (seen.has(value)) fail();
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
    Object.freeze(value);
    seen.delete(value);
  }
  return value;
}

module.exports = { LIMITS, deepFreeze, validateBatchGetResponse };
