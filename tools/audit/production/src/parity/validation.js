"use strict";

const { types } = require("node:util");
const {
  ParityInternalConsistencyError,
  ParityInvalidRecordError,
  ParityLimitError,
  ParityUnsupportedInputError,
  ParityUntrustedInputError,
} = require("../errors");
const {
  verifyTrustedCanonicalBundle,
  verifyTrustedCanonicalRecord,
} = require("../normalize/adapter");

const MODULES = Object.freeze(["cctv", "customer-experience", "complaints", "complimentary-orders"]);
const MODULE_SET = new Set(MODULES);
const APPROVED_STATE_LOOKUP = Object.freeze(Object.assign(Object.create(null), {
  MISSING: true,
  EXPLICIT_NULL: true,
  EMPTY_STRING: true,
  EMPTY_ARRAY: true,
  OMITTED_TRAILING_CELL: true,
  AMBIGUOUS: true,
  UNSUPPORTED: true,
  VALUE: true,
}));
const COLLECTION_FIELD_LOOKUP = Object.freeze(Object.assign(Object.create(null), {
  cameras: true,
  sections: true,
  staff: true,
  violatedPolicy: true,
}));
const ARRAY_VALUE_FIELD_LOOKUP = Object.freeze(Object.assign(Object.create(null), { attachments: true }));
const DATE_VALUE_FIELD_LOOKUP = Object.freeze(Object.assign(Object.create(null), {
  createdAt: true,
  feedbackDate: true,
  discountDate: true,
}));
const LIMITS = Object.freeze({
  totalRecords: 80_000,
  recordsPerModuleSource: 10_000,
  duplicateGroupSize: 10_000,
  findingsPerMatchedRecord: 64,
  totalFindings: 100_000,
  referencesPerFinding: 10_000,
  outputBytes: 64 * 1024 * 1024,
});

function fail(ErrorClass) {
  throw new ErrorClass("Parity operation failed");
}

function ownData(object, key, ErrorClass = ParityInternalConsistencyError) {
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(object, key); } catch (_) { fail(ErrorClass); }
  if (!descriptor || !Object.hasOwn(descriptor, "value")) fail(ErrorClass);
  return descriptor.value;
}

function exactFrozenData(object, key, enumerable) {
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(object, key); } catch (_) { return null; }
  return descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable === enumerable &&
    descriptor.writable === false && descriptor.configurable === false ? descriptor : null;
}

function verifyBundle(bundle) {
  try { verifyTrustedCanonicalBundle(bundle); } catch (_) { fail(ParityUntrustedInputError); }
  if (types.isProxy(bundle) || Object.getPrototypeOf(bundle) !== null || !Object.isFrozen(bundle)) fail(ParityUnsupportedInputError);
  const keys = Reflect.ownKeys(bundle);
  if (keys.length !== 5 || ["postgresRecords", "sheetsRecords", "modules", "counts", "completeness"].some((key) => !keys.includes(key))) {
    fail(ParityUnsupportedInputError);
  }
  const postgres = ownData(bundle, "postgresRecords", ParityUnsupportedInputError);
  const sheets = ownData(bundle, "sheetsRecords", ParityUnsupportedInputError);
  if (!Array.isArray(postgres) || !Array.isArray(sheets) || !Object.isFrozen(postgres) || !Object.isFrozen(sheets)) {
    fail(ParityUnsupportedInputError);
  }
  if (postgres.length + sheets.length > LIMITS.totalRecords) fail(ParityLimitError);
  return { postgres, sheets };
}

function verifyRecord(record, source, allowedTypes) {
  if (!record || typeof record !== "object" || types.isProxy(record) || !Object.isFrozen(record) ||
      !verifyTrustedCanonicalRecord(record) || record.source !== source || !allowedTypes.has(record.recordType) ||
      !MODULE_SET.has(record.module)) fail(ParityInvalidRecordError);
  if (source === "postgresql" && record.recordType !== "ticket") fail(ParityInvalidRecordError);
}

function stateFor(record, field) {
  const metadata = ownData(record, "sourceMetadata");
  if (!metadata || typeof metadata !== "object" || types.isProxy(metadata)) fail(ParityInternalConsistencyError);
  const states = ownData(metadata, "fieldStates");
  if (!states || typeof states !== "object" || types.isProxy(states)) fail(ParityInternalConsistencyError);
  const state = ownData(states, field);
  if (typeof state !== "string" || APPROVED_STATE_LOOKUP[state] !== true) fail(ParityInternalConsistencyError);
  const value = ownData(record, field);
  if (!stateValueConsistent(field, state, value)) fail(ParityInternalConsistencyError);
  return state;
}

function collectionDescriptor(value) {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== null || !Object.isFrozen(value)) return null;
  let keys;
  try { keys = Reflect.ownKeys(value); } catch (_) { return null; }
  if (keys.length !== 2 || !keys.includes("raw") || !keys.includes("items")) return null;
  const rawDescriptor = exactFrozenData(value, "raw", true);
  const itemsDescriptor = exactFrozenData(value, "items", true);
  if (!rawDescriptor || !itemsDescriptor) return null;
  const raw = rawDescriptor.value;
  const items = itemsDescriptor.value;
  if (!(raw === null || typeof raw === "string") || !(items === null || Array.isArray(items))) return null;
  if (Array.isArray(items) && !canonicalItems(items)) return null;
  return { raw, items };
}

function canonicalItems(items) {
  if (types.isProxy(items) || Object.getPrototypeOf(items) !== Array.prototype || !Object.isFrozen(items)) return false;
  let keys;
  try { keys = Reflect.ownKeys(items); } catch (_) { return false; }
  if (keys.length !== items.length + 1 || !keys.includes("length")) return false;
  const keySet = new Set(keys);
  const lengthDescriptor = exactFrozenData(items, "length", false);
  if (!lengthDescriptor || lengthDescriptor.value !== items.length) return false;
  for (let index = 0; index < items.length; index += 1) {
    const key = String(index);
    const descriptor = exactFrozenData(items, key, true);
    if (!keySet.has(key) || !descriptor || typeof descriptor.value !== "string") return false;
  }
  return keys.every((key) => key === "length" || (typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < items.length));
}

function leapYear(year) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }

function monthDays(year, month) {
  if (month === 2) return leapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validCalendar(year, month, day) {
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= monthDays(year, month);
}

function validTime(hour, minute, second) {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

function daysBeforeYear(year) {
  const preceding = year - 1;
  return preceding * 365 + Math.floor(preceding / 4) - Math.floor(preceding / 100) + Math.floor(preceding / 400);
}

function dayOrdinal(year, month, day) {
  let ordinal = daysBeforeYear(year);
  for (let current = 1; current < month; current += 1) ordinal += monthDays(year, current);
  return ordinal + day - 1;
}

function canonicalSecond(year, month, day, hour, minute, second) {
  return dayOrdinal(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second;
}

function precisionFor(second, fraction) {
  if (second === undefined) return "minute";
  return fraction === undefined ? "second" : `fraction-${fraction.length}`;
}

function parsedDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return validCalendar(year, month, day) ? { canonical: value, year, month, day } : null;
}

function parsedLocal(value, rawForm) {
  const expression = rawForm
    ? /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/
    : /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;
  const match = expression.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (!validCalendar(year, month, day) || !validTime(hour, minute, second)) return null;
  const suffix = match[6] === undefined ? "" : `:${match[6]}${match[7] === undefined ? "" : `.${match[7]}`}`;
  return {
    canonical: `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}${suffix}`,
    fraction: match[7] || null,
    precision: precisionFor(match[6], match[7]),
  };
}

function parsedAwareRaw(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2})(?::?(\d{2}))?)$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (!validCalendar(year, month, day) || !validTime(hour, minute, second)) return null;
  let offsetMinutes = 0;
  if (match[8] !== "Z") {
    const offsetHour = Number(match[10]);
    const offsetMinute = Number(match[11] || 0);
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMinutes = (offsetHour * 60 + offsetMinute) * (match[9] === "+" ? 1 : -1);
  }
  const utcSecond = canonicalSecond(year, month, day, hour, minute, second) - offsetMinutes * 60;
  const maximumSecond = daysBeforeYear(10_000) * 86_400 - 1;
  if (utcSecond < 0 || utcSecond > maximumSecond) return null;
  return { fraction: match[7] || null, precision: precisionFor(match[6], match[7]), utcSecond };
}

function parsedInstant(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (!validCalendar(year, month, day) || !validTime(hour, minute, second)) return null;
  return {
    fraction: match[7] || null,
    precision: precisionFor(match[6], match[7]),
    utcSecond: canonicalSecond(year, month, day, hour, minute, second),
  };
}

function canonicalDate(value) {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== null || !Object.isFrozen(value)) return false;
  let keys;
  try { keys = Reflect.ownKeys(value); } catch (_) { return false; }
  const approved = ["raw", "instant", "local", "precision", "timezoneKnown"];
  if (keys.length !== approved.length || approved.some((key) => !keys.includes(key))) return false;
  const descriptors = Object.fromEntries(approved.map((key) => [key, exactFrozenData(value, key, true)]));
  if (approved.some((key) => !descriptors[key])) return false;
  const raw = descriptors.raw.value;
  const instant = descriptors.instant.value;
  const local = descriptors.local.value;
  const precision = descriptors.precision.value;
  const timezoneKnown = descriptors.timezoneKnown.value;
  if (typeof raw !== "string" || raw.length === 0 || !(instant === null || typeof instant === "string") ||
      !(local === null || typeof local === "string") || typeof precision !== "string" || typeof timezoneKnown !== "boolean") return false;
  const fraction = /^fraction-([1-9])$/.exec(precision);
  if (precision !== "date" && precision !== "minute" && precision !== "second" && !fraction) return false;
  if (timezoneKnown) {
    if (local !== null || typeof instant !== "string" || precision === "date" || precision === "minute") return false;
    const source = parsedAwareRaw(raw);
    const canonical = parsedInstant(instant);
    return source !== null && canonical !== null && source.precision === precision && canonical.precision === precision &&
      source.utcSecond === canonical.utcSecond && source.fraction === canonical.fraction;
  }
  if (instant !== null || typeof local !== "string") return false;
  if (precision === "date") {
    const rawDate = parsedDateOnly(raw);
    const localDate = parsedDateOnly(local);
    return rawDate !== null && localDate !== null && rawDate.canonical === localDate.canonical;
  }
  const rawLocal = parsedLocal(raw, true);
  const canonicalLocal = parsedLocal(local, false);
  return rawLocal !== null && canonicalLocal !== null && rawLocal.precision === precision &&
    canonicalLocal.precision === precision && rawLocal.canonical === canonicalLocal.canonical;
}

function collectionStateConsistent(state, descriptor) {
  if (!descriptor) return false;
  const { raw, items } = descriptor;
  if (state === "VALUE") {
    return (typeof raw === "string" && raw.length > 0 && items === null) ||
      (raw === null && Array.isArray(items) && items.length > 0);
  }
  if (state === "EMPTY_STRING") return raw === "" && items === null;
  if (state === "EMPTY_ARRAY") return raw === null && Array.isArray(items) && items.length === 0;
  return raw === null && items === null;
}

function scalarStateConsistent(field, state, value) {
  if (state === "VALUE") {
    if (value === null || value === undefined || value === "") return false;
    if (Array.isArray(value)) return ARRAY_VALUE_FIELD_LOOKUP[field] === true && value.length > 0;
    if (typeof value === "object") return DATE_VALUE_FIELD_LOOKUP[field] === true && canonicalDate(value);
    return true;
  }
  if (state === "EMPTY_STRING") return value === "" || (DATE_VALUE_FIELD_LOOKUP[field] === true && value === null);
  if (state === "EMPTY_ARRAY") return ARRAY_VALUE_FIELD_LOOKUP[field] === true && Array.isArray(value) &&
    !types.isProxy(value) && Object.isFrozen(value) && value.length === 0;
  return value === null;
}

function stateValueConsistent(field, state, value) {
  if (COLLECTION_FIELD_LOOKUP[field] === true) return collectionStateConsistent(state, collectionDescriptor(value));
  return scalarStateConsistent(field, state, value);
}

function safeReference(record) {
  const value = record.source === "postgresql" ? record.ticketId : record.rowReference;
  if (value === null) return null;
  if (typeof value !== "string") fail(ParityInvalidRecordError);
  return value;
}

function nullObject(entries) {
  const output = Object.create(null);
  for (const [key, value] of entries) Object.defineProperty(output, key, {
    value, enumerable: true, writable: false, configurable: false,
  });
  return Object.freeze(output);
}

module.exports = Object.freeze({ LIMITS, MODULES, fail, nullObject, ownData, safeReference, stateFor, verifyBundle, verifyRecord });
