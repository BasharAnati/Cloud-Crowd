"use strict";

const { NormalizationDateError, NormalizationInvalidFieldError } = require("../errors");
const { assertAllowedKeys, assertDenseArray, dataValue, fail } = require("./validation");

const FIELD_STATES = Object.freeze({
  VALUE: "VALUE",
  MISSING: "MISSING",
  EXPLICIT_NULL: "EXPLICIT_NULL",
  EMPTY_STRING: "EMPTY_STRING",
  EMPTY_ARRAY: "EMPTY_ARRAY",
  OMITTED_TRAILING_CELL: "OMITTED_TRAILING_CELL",
  AMBIGUOUS: "AMBIGUOUS",
  UNSUPPORTED: "UNSUPPORTED",
});

function normalizeString(value, token = false) {
  if (value === null) return null;
  if (typeof value !== "string") fail(NormalizationInvalidFieldError);
  const normalized = value.replace(/\r\n?/g, "\n").replace(/[ \t]+(?=\n|$)/g, "").replace(/\n+$/g, "");
  return token ? normalized.trim() : normalized;
}

function stringState(value) {
  if (value === null) return FIELD_STATES.EXPLICIT_NULL;
  return value === "" ? FIELD_STATES.EMPTY_STRING : FIELD_STATES.VALUE;
}

function normalizeIdentifier(value) {
  const normalized = normalizeString(value, true);
  if (normalized === null || normalized === "") fail(NormalizationInvalidFieldError);
  return normalized;
}

function daysInMonth(year, month) {
  if (month === 2) return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validateDateParts(year, month, day, hour = 0, minute = 0, second = 0) {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) ||
      hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) fail(NormalizationDateError);
}

function precisionFor(second, fraction) {
  if (second === undefined) return "minute";
  if (fraction === undefined) return "second";
  return `fraction-${fraction.length}`;
}

function dateValue(raw, instant, local, precision, timezoneKnown) {
  return Object.freeze({ raw, instant, local, precision, timezoneKnown });
}

function utcBase(year, month, day, hour, minute, second) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function formatUtc(epoch, fraction) {
  const date = new Date(epoch);
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999) fail(NormalizationDateError);
  const whole = date.toISOString().slice(0, 19);
  return `${whole}${fraction === undefined ? "" : `.${fraction}`}Z`;
}

function normalizeDate(value) {
  if (value === null) return null;
  const raw = normalizeString(value, true);
  if (raw === "") return null;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) {
    validateDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
    return dateValue(raw, null, raw, "date", false);
  }
  match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/.exec(raw);
  if (match) {
    validateDateParts(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0));
    const local = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}${match[6] === undefined ? "" : `:${match[6]}${match[7] === undefined ? "" : `.${match[7]}`}`}`;
    return dateValue(raw, null, local, precisionFor(match[6], match[7]), false);
  }
  match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2})(?::?(\d{2}))?)$/.exec(raw);
  if (!match) fail(NormalizationDateError);
  const values = match.slice(1, 7).map(Number);
  validateDateParts(...values);
  let offsetMinutes = 0;
  if (match[8] !== "Z") {
    const offsetHour = Number(match[10]);
    const offsetMinute = Number(match[11] || 0);
    if (offsetHour > 23 || offsetMinute > 59) fail(NormalizationDateError);
    offsetMinutes = (offsetHour * 60 + offsetMinute) * (match[9] === "+" ? 1 : -1);
  }
  const epoch = utcBase(...values) - offsetMinutes * 60_000;
  if (!Number.isFinite(epoch)) fail(NormalizationDateError);
  return dateValue(raw, formatUtc(epoch, match[7]), null, precisionFor(match[6], match[7]), true);
}

function normalizeStringArray(value) {
  assertDenseArray(value);
  return value.map((item) => normalizeString(item));
}

function normalizeRowReference(value) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(NormalizationInvalidFieldError);
  return String(value);
}

function normalizeAttachment(value) {
  assertAllowedKeys(value, ["dataUrl", "name", "type"]);
  return {
    name: normalizeString(dataValue(value, "name")),
    type: normalizeString(dataValue(value, "type"), true),
    reference: normalizeString(dataValue(value, "dataUrl"), true),
  };
}

module.exports = {
  FIELD_STATES,
  normalizeAttachment,
  normalizeDate,
  normalizeIdentifier,
  normalizeRowReference,
  normalizeString,
  normalizeStringArray,
  stringState,
};
