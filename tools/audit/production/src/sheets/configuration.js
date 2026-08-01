"use strict";

const { SheetsConfigurationError } = require("../errors");

const CREDENTIALS_ENVIRONMENT_KEY = "GOOGLE_APPLICATION_CREDENTIALS_JSON";
const ID_PATTERN = /^[A-Za-z0-9_-]{20,256}$/;
const A1_PATTERN = /^(?:'((?:[^']|'')+)'|([A-Za-z0-9 _.-]+))!([A-Z]{1,2})([1-9][0-9]*)?:([A-Z]{1,2})([1-9][0-9]*)?$/;

const MODULE_DEFINITIONS = Object.freeze([
  Object.freeze({ key: "cctv", module: "CCTV", reference: "configured:cctv", idKey: "GOOGLE_SHEET_ID_CCTV", rangeKey: "GOOGLE_SHEET_RANGE_CCTV", width: 13, statusIndex: 0, actionIndex: 9, keyIndex: 10 }),
  Object.freeze({ key: "customer-experience", module: "Customer Experience", reference: "configured:customer-experience", idKey: "GOOGLE_SHEET_ID_CUSTOMER_EXPERIENCE", rangeKey: "GOOGLE_SHEET_RANGE_CUSTOMER_EXPERIENCE", width: 16, statusIndex: 0, actionIndex: 13, keyIndex: 15 }),
  Object.freeze({ key: "complaints", module: "Complaints", reference: "configured:complaints", idKey: "GOOGLE_SHEET_ID_DAILY_COMPLAINTS", rangeKey: "GOOGLE_SHEET_RANGE_DAILY_COMPLAINTS", width: 14, statusIndex: 0, actionIndex: 12, keyIndex: 13 }),
  Object.freeze({ key: "complimentary-orders", module: "Complimentary Orders", reference: "configured:complimentary-orders", idKey: "GOOGLE_SHEET_ID_COMPLIMENTARY", rangeKey: "GOOGLE_SHEET_RANGE_COMPLIMENTARY", width: 13, statusIndex: 0, actionIndex: 11, keyIndex: 12 }),
]);

function fail() {
  throw new SheetsConfigurationError("Sheets configuration is invalid");
}

function requiredString(value) {
  if (typeof value !== "string" || value.trim() === "") fail();
  return value.trim();
}

function columnNumber(column) {
  let value = 0;
  for (const character of column) value = value * 26 + character.charCodeAt(0) - 64;
  return value;
}

function quoteTab(tab) {
  return `'${tab.replace(/'/g, "''")}'`;
}

function parseA1Range(value, expectedWidth) {
  const raw = requiredString(value);
  if (raw.length > 256) fail();
  const match = A1_PATTERN.exec(raw);
  if (!match) fail();
  const tab = (match[1] || match[2] || "").replace(/''/g, "'");
  if (!tab || tab.length > 100 || /[\r\n\0]/.test(tab)) fail();
  const startColumn = match[3];
  const endColumn = match[5];
  const startColumnNumber = columnNumber(startColumn);
  const endColumnNumber = columnNumber(endColumn);
  const width = endColumnNumber - startColumnNumber + 1;
  const configuredStartRow = match[4] === undefined ? 1 : Number(match[4]);
  const configuredEndRow = match[6] === undefined ? null : Number(match[6]);
  if (startColumnNumber !== 1 || width !== expectedWidth ||
      !Number.isSafeInteger(configuredStartRow) || configuredStartRow < 1 || configuredStartRow > 1_000_000 ||
      (configuredEndRow !== null && (!Number.isSafeInteger(configuredEndRow) || configuredEndRow < configuredStartRow || configuredEndRow > 1_000_000))) fail();
  const dataStartRow = Math.max(2, configuredStartRow);
  if (configuredEndRow !== null && configuredEndRow < dataStartRow) fail();
  const tabReference = quoteTab(tab);
  const headerRange = `${tabReference}!${startColumn}1:${endColumn}1`;
  const dataRange = `${tabReference}!${startColumn}${dataStartRow}:${endColumn}${configuredEndRow === null ? "" : configuredEndRow}`;
  return Object.freeze({
    tab,
    startColumn,
    endColumn,
    configuredStartRow,
    configuredEndRow,
    dataStartRow,
    width,
    headerRange,
    dataRange,
  });
}

function readSheetsEnvironment(env) {
  if (!env || typeof env !== "object") fail();
  const credentialsJson = env[CREDENTIALS_ENVIRONMENT_KEY];
  const modules = MODULE_DEFINITIONS.map((definition) => Object.freeze({
    definition,
    spreadsheetId: env[definition.idKey],
    range: env[definition.rangeKey],
  }));
  return { credentialsJson, modules };
}

function buildSheetsConfiguration(rawModules) {
  if (!Array.isArray(rawModules) || rawModules.length !== MODULE_DEFINITIONS.length) fail();
  const modules = rawModules.map((raw, index) => {
    const definition = MODULE_DEFINITIONS[index];
    if (!raw || raw.definition !== definition) fail();
    const spreadsheetId = requiredString(raw.spreadsheetId);
    if (!ID_PATTERN.test(spreadsheetId)) fail();
    const parsedRange = parseA1Range(raw.range, definition.width);
    return Object.freeze({ ...definition, spreadsheetId, parsedRange });
  });
  return Object.freeze({ modules: Object.freeze(modules) });
}

module.exports = {
  CREDENTIALS_ENVIRONMENT_KEY,
  MODULE_DEFINITIONS,
  buildSheetsConfiguration,
  parseA1Range,
  readSheetsEnvironment,
};
