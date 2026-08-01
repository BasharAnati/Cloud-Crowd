"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyError } = require("../../src/errors");
const { trustedAllSheetsSnapshot, trustedCompleteTicketPages } = require("../normalize/helpers");

const CANONICAL_PATH = require.resolve("../../src/normalize/canonical-record");
const NORMALIZE_ADAPTER_PATH = require.resolve("../../src/normalize/adapter");
const NORMALIZE_INDEX_PATH = require.resolve("../../src/normalize");
const PARITY_PATHS = [
  "adapter", "comparator", "field-policy", "finding", "identity", "index", "matcher", "partition", "summary", "validation",
].map((name) => require.resolve(`../../src/parity/${name}`));

function nullObject(values) { return Object.freeze(Object.assign(Object.create(null), values)); }

function sheetRow(module, identity, overrides = {}) {
  const widths = { cctv: 13, "customer-experience": 16, complaints: 14, "complimentary-orders": 13 };
  const identityIndex = module === "cctv" ? 10 : module === "customer-experience" ? 15 : module === "complaints" ? 13 : 12;
  const cells = Array(widths[module]).fill("");
  cells[0] = "Open";
  cells[identityIndex] = identity;
  for (const [index, value] of Object.entries(overrides)) cells[Number(index)] = value;
  return cells;
}

function postgresTicket(id, section, identity, payload = {}) {
  const identityField = section === "cctv" ? "caseNumber" : "orderNumber";
  return {
    id: String(id), section, status: "Open", payload: { [identityField]: identity, ...payload },
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
}

function replaceField(record, field, value) {
  const output = Object.create(null);
  for (const key of Reflect.ownKeys(record)) Object.defineProperty(output, key, {
    value: key === field ? value : record[key], enumerable: true, writable: false, configurable: false,
  });
  return Object.freeze(output);
}

function canonicalDate(overrides = {}, configure) {
  const value = Object.assign(Object.create(null), {
    raw: "2026-01-01", instant: null, local: "2026-01-01", precision: "date", timezoneKnown: false,
    ...overrides,
  });
  if (configure) configure(value);
  return Object.freeze(value);
}

function collectionValue(items) { return nullObject({ raw: null, items }); }

function cacheSnapshot(paths) { return new Map(paths.map((path) => [path, require.cache[path]])); }

function restoreCache(snapshot) {
  for (const [path, entry] of snapshot) {
    if (entry) require.cache[path] = entry;
    else delete require.cache[path];
  }
}

async function withCorruptedRegistry(operation) {
  const touched = [CANONICAL_PATH, NORMALIZE_ADAPTER_PATH, NORMALIZE_INDEX_PATH, ...PARITY_PATHS];
  const previous = cacheSnapshot(touched);
  const canonicalModule = require(CANONICAL_PATH);
  const canonicalEntry = require.cache[CANONICAL_PATH];
  const originalCanonicalExports = canonicalEntry.exports;
  let mutation = null;
  canonicalEntry.exports = {
    ...canonicalModule,
    canonicalRecord(values) {
      const genuine = canonicalModule.canonicalRecord(values);
      if (!mutation || genuine.source !== "postgresql" || genuine.recordType !== "ticket" || genuine.module !== "cctv") return genuine;
      return replaceField(genuine, mutation.field, mutation.value);
    },
  };
  delete require.cache[NORMALIZE_ADAPTER_PATH];
  delete require.cache[NORMALIZE_INDEX_PATH];
  for (const path of PARITY_PATHS) delete require.cache[path];
  try {
    const normalize = require(NORMALIZE_INDEX_PATH);
    const normalizeAdapter = require(NORMALIZE_ADAPTER_PATH);
    const parity = require(PARITY_PATHS[5]);
    await operation({ normalize, normalizeAdapter, parity, setMutation(value) { mutation = value; } });
  } finally {
    canonicalEntry.exports = originalCanonicalExports;
    restoreCache(previous);
  }
}

function assertContainedFailure(parity, normalizeAdapter, bundle, canary) {
  let result;
  assert.doesNotThrow(() => normalizeAdapter.verifyTrustedCanonicalBundle(bundle));
  assert.throws(() => { result = parity.compareCanonicalParityBundle(bundle); }, (error) => {
    const classification = classifyError(error);
    assert.equal(classification.publicCode, "PARITY_INTERNAL_CONSISTENCY_FAILURE");
    assert.equal(classification.publicMessage, "Parity consistency verification failed");
    assert.equal(classification.exitCode, 8);
    assert.equal(Object.hasOwn(classification, "stack"), false);
    assert.equal(Object.hasOwn(classification, "cause"), false);
    assert.equal(JSON.stringify(classification).includes(canary), false);
    return true;
  });
  assert.equal(result, undefined);
}

function assertAccepted(parity, normalizeAdapter, bundle) {
  assert.doesNotThrow(() => normalizeAdapter.verifyTrustedCanonicalBundle(bundle));
  const result = parity.compareCanonicalParityBundle(bundle);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.findings), true);
  assert.equal(Object.isFrozen(result.summary), true);
}

test("trusted malformed canonical shapes fail through the public parity pipeline", async (context) => {
  await withCorruptedRegistry(async ({ normalize, normalizeAdapter, parity, setMutation }) => {
    const pages = await trustedCompleteTicketPages([
      postgresTicket(1, "cctv", "PUBLIC-SHAPE", { dateTime: "2026-01-01", cameras: ["A"] }),
    ], 100);
    const sheetsSnapshot = await trustedAllSheetsSnapshot({
      cctv: [sheetRow("cctv", "PUBLIC-SHAPE", { 2: "2026-01-01", 3: "A" })],
    });

    async function bundleFor(field, value) {
      setMutation({ field, value });
      const postgres = Object.freeze(pages.map(normalize.normalizePostgresSnapshot));
      const sheets = normalize.normalizeSheetsSnapshot(sheetsSnapshot);
      setMutation(null);
      return normalize.assembleCanonicalParityBundle(postgres, sheets);
    }

    const symbolDate = canonicalDate({}, (value) => Object.defineProperty(value, Symbol("SECRET_SYMBOL"), { value: true }));
    const accessorDate = Object.create(null);
    for (const [key, value] of Object.entries({ instant: null, local: "2026-01-01", precision: "date", timezoneKnown: false })) {
      Object.defineProperty(accessorDate, key, { value, enumerable: true });
    }
    Object.defineProperty(accessorDate, "raw", { enumerable: true, get() { return "SECRET_ACCESSOR"; } });
    Object.freeze(accessorDate);
    const customDate = Object.freeze(Object.assign(Object.create({ inherited: "SECRET_INHERITED" }), {
      raw: "2026-01-01", instant: null, local: "2026-01-01", precision: "date", timezoneKnown: false,
    }));
    const missingDate = nullObject({ raw: "2026-01-01", instant: null, local: "2026-01-01", precision: "date" });
    const dateCases = [
      ["date-items", canonicalDate({ items: null })],
      ["date-hybrid", canonicalDate({ raw: null, items: null })],
      ["date-extra", canonicalDate({ extra: "SECRET_EXTRA" })],
      ["date-symbol", symbolDate],
      ["date-accessor", accessorDate],
      ["date-custom-prototype", customDate],
      ["date-missing", missingDate],
      ["date-timezone-conflict", canonicalDate({ timezoneKnown: true, instant: null })],
    ];

    for (const [name, value] of dateCases) await context.test(name, async () => {
      assertContainedFailure(parity, normalizeAdapter, await bundleFor("createdAt", value), "SECRET");
    });

    const extraItems = ["A"];
    extraItems.extra = "SECRET_EXTRA";
    Object.freeze(extraItems);
    const symbolItems = ["A"];
    Object.defineProperty(symbolItems, Symbol("SECRET_SYMBOL"), { value: true });
    Object.freeze(symbolItems);
    const accessorPropertyItems = ["A"];
    Object.defineProperty(accessorPropertyItems, "extra", { get() { return "SECRET_ACCESSOR"; } });
    Object.freeze(accessorPropertyItems);
    const accessorIndexItems = [];
    Object.defineProperty(accessorIndexItems, "0", { enumerable: true, get() { return "SECRET_INDEX"; } });
    Object.freeze(accessorIndexItems);
    const customPrototypeItems = ["A"];
    Object.setPrototypeOf(customPrototypeItems, Object.create(Array.prototype));
    Object.freeze(customPrototypeItems);
    const sparseItems = Array(1);
    Object.freeze(sparseItems);
    const nonStringItems = [7];
    Object.freeze(nonStringItems);
    const inheritedIndexPrototype = Object.create(Array.prototype);
    Object.defineProperty(inheritedIndexPrototype, "0", { value: "SECRET_INHERITED" });
    const inheritedIndexItems = Array(1);
    Object.setPrototypeOf(inheritedIndexItems, inheritedIndexPrototype);
    Object.freeze(inheritedIndexItems);
    const itemCases = [
      ["items-extra-property", extraItems],
      ["items-symbol-property", symbolItems],
      ["items-accessor-property", accessorPropertyItems],
      ["items-accessor-index", accessorIndexItems],
      ["items-custom-prototype", customPrototypeItems],
      ["items-sparse", sparseItems],
      ["items-non-string", nonStringItems],
      ["items-inherited-index", inheritedIndexItems],
    ];
    for (const [name, items] of itemCases) await context.test(name, async () => {
      assertContainedFailure(parity, normalizeAdapter, await bundleFor("cameras", collectionValue(items)), "SECRET");
    });
  });
});

test("genuine dates, both collection representations, and all modules remain accepted", async () => {
  await withCorruptedRegistry(async ({ normalize, parity, setMutation }) => {
    setMutation(null);
    const pages = await trustedCompleteTicketPages([
      postgresTicket(1, "cctv", "CCTV-1", { dateTime: "2026-01-01", cameras: ["A"] }),
      postgresTicket(2, "ce", "CE-1", { creationDate: "2026-01-01" }),
      postgresTicket(3, "complaints", "COMPLAINT-1", { creationDate: "2026-01-01" }),
      postgresTicket(4, "free-orders", "FREE-1", { orderDate: "2026-01-01" }),
    ], 100);
    const sheetsSnapshot = await trustedAllSheetsSnapshot({
      cctv: [sheetRow("cctv", "CCTV-1", { 2: "2026-01-01", 3: "A" })],
      "customer-experience": [sheetRow("customer-experience", "CE-1", { 4: "2026-01-01" })],
      complaints: [sheetRow("complaints", "COMPLAINT-1", { 4: "2026-01-01" })],
      "complimentary-orders": [sheetRow("complimentary-orders", "FREE-1", { 3: "2026-01-01" })],
    });
    const postgres = Object.freeze(pages.map(normalize.normalizePostgresSnapshot));
    const sheets = normalize.normalizeSheetsSnapshot(sheetsSnapshot);
    const bundle = normalize.assembleCanonicalParityBundle(postgres, sheets);
    const result = parity.compareCanonicalParityBundle(bundle);
    assert.equal(result.summary.matchedUniquePairs, 4);
    assert.ok(bundle.postgresRecords.find((record) => record.module === "cctv").cameras.items.length > 0);
    assert.equal(typeof bundle.sheetsRecords.find((record) => record.module === "cctv").cameras.raw, "string");
  });
});

test("canonical date semantics fail closed through the public parity pipeline", async (context) => {
  await withCorruptedRegistry(async ({ normalize, normalizeAdapter, parity, setMutation }) => {
    const pages = await trustedCompleteTicketPages([
      postgresTicket(1, "cctv", "DATE-SEMANTICS", { dateTime: "2026-01-01" }),
    ], 100);
    const sheetsSnapshot = await trustedAllSheetsSnapshot({
      cctv: [sheetRow("cctv", "DATE-SEMANTICS", { 2: "2026-01-01" })],
    });

    async function bundleFor(value) {
      setMutation({ field: "createdAt", value });
      const postgres = Object.freeze(pages.map(normalize.normalizePostgresSnapshot));
      const sheets = normalize.normalizeSheetsSnapshot(sheetsSnapshot);
      setMutation(null);
      return normalize.assembleCanonicalParityBundle(postgres, sheets);
    }

    function local(raw, canonical, precision) {
      return canonicalDate({ raw, instant: null, local: canonical, precision, timezoneKnown: false });
    }

    function aware(raw, instant, precision = "second") {
      return canonicalDate({ raw, instant, local: null, precision, timezoneKnown: true });
    }

    const malformed = [
      ["calendar-month-00", canonicalDate({ raw: "2026-00-01", local: "2026-00-01" })],
      ["calendar-month-13", canonicalDate({ raw: "2026-13-01", local: "2026-13-01" })],
      ["calendar-day-00", canonicalDate({ raw: "2026-01-00", local: "2026-01-00" })],
      ["calendar-april-31", canonicalDate({ raw: "2026-04-31", local: "2026-04-31" })],
      ["calendar-non-leap-february-29", canonicalDate({ raw: "2025-02-29", local: "2025-02-29" })],
      ["calendar-year-0000", canonicalDate({ raw: "0000-01-01", local: "0000-01-01" })],
      ["calendar-year-10000", canonicalDate({ raw: "10000-01-01", local: "10000-01-01" })],
      ["time-hour-24", local("2026-01-01T24:00", "2026-01-01T24:00", "minute")],
      ["time-minute-60", local("2026-01-01T12:60", "2026-01-01T12:60", "minute")],
      ["time-second-60", local("2026-01-01T12:30:60", "2026-01-01T12:30:60", "second")],
      ["time-fraction-precision-mismatch", local("2026-01-01T12:30:00.12", "2026-01-01T12:30:00.12", "fraction-3")],
      ["time-unsupported-fraction-length", local("2026-01-01T12:30:00.1234567890", "2026-01-01T12:30:00.1234567890", "fraction-9")],
      ["date-unrelated-raw", canonicalDate({ raw: "NOT-A-DATE" })],
      ["date-raw-local-mismatch", canonicalDate({ raw: "2026-01-01", local: "2026-01-02" })],
      ["date-raw-timezone", canonicalDate({ raw: "2026-01-01Z" })],
      ["local-impossible-date", local("2026-02-30T12:30", "2026-02-30T12:30", "minute")],
      ["local-invalid-time", local("2026-01-01T25:30", "2026-01-01T25:30", "minute")],
      ["local-raw-canonical-mismatch", local("2026-01-01T12:30", "2026-01-01T12:31", "minute")],
      ["local-raw-z", local("2026-01-01T12:30Z", "2026-01-01T12:30", "minute")],
      ["local-raw-offset", local("2026-01-01T12:30+02:00", "2026-01-01T12:30", "minute")],
      ["aware-invalid-calendar", aware("2026-02-30T12:30:00Z", "2026-02-28T12:30:00Z")],
      ["aware-invalid-time", aware("2026-01-01T24:30:00Z", "2026-01-01T00:30:00Z")],
      ["aware-invalid-offset-syntax", aware("2026-01-01T12:30:00+2:00", "2026-01-01T10:30:00Z")],
      ["aware-invalid-offset-minute", aware("2026-01-01T12:30:00+02:60", "2026-01-01T10:30:00Z")],
      ["aware-missing-offset", aware("2026-01-01T12:30:00", "2026-01-01T12:30:00Z")],
      ["aware-raw-instant-mismatch", aware("2026-01-01T02:00:00+02:00", "2026-01-01T00:00:01Z")],
      ["aware-below-year-boundary", aware("0001-01-01T00:00:00+00:01", "0001-01-01T00:00:00Z")],
      ["aware-above-year-boundary", aware("9999-12-31T23:59:59-00:01", "9999-12-31T23:59:59Z")],
      ["aware-fraction-value-mismatch", aware("2026-01-01T00:00:00.123+00:00", "2026-01-01T00:00:00.124Z", "fraction-3")],
      ["aware-fraction-precision-mismatch", aware("2026-01-01T00:00:00.123+00:00", "2026-01-01T00:00:00.123Z", "fraction-2")],
    ];

    for (const [name, value] of malformed) await context.test(name, async () => {
      assertContainedFailure(parity, normalizeAdapter, await bundleFor(value), value.raw);
    });

    const valid = [
      ["calendar-leap-february-29", canonicalDate({ raw: "2024-02-29", local: "2024-02-29" })],
      ["date-valid", canonicalDate({ raw: "2026-01-01", local: "2026-01-01" })],
      ["local-valid-t", local("2026-01-01T12:30", "2026-01-01T12:30", "minute")],
      ["local-valid-space", local("2026-01-01 12:30", "2026-01-01T12:30", "minute")],
      ["local-valid-second", local("2026-01-01T12:30:45", "2026-01-01T12:30:45", "second")],
      ["local-valid-fraction-9", local("2026-01-01T12:30:45.123456789", "2026-01-01T12:30:45.123456789", "fraction-9")],
      ["aware-valid-z", aware("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")],
      ["aware-valid-positive-offset", aware("2026-01-01T02:00:00+02:00", "2026-01-01T00:00:00Z")],
      ["aware-valid-negative-offset", aware("2025-12-31T23:30:00-01:00", "2026-01-01T00:30:00Z")],
      ["aware-positive-offset-day-rollover", aware("2026-01-02T01:00:00+02:00", "2026-01-01T23:00:00Z")],
      ["aware-negative-offset-day-rollover", aware("2026-01-01T23:30:00-02:00", "2026-01-02T01:30:00Z")],
      ["aware-month-rollover", aware("2026-03-01T00:30:00+01:00", "2026-02-28T23:30:00Z")],
      ["aware-year-rollover", aware("2026-01-01T00:30:00+01:00", "2025-12-31T23:30:00Z")],
      ["aware-leap-year-rollover", aware("2024-03-01T00:30:00+01:00", "2024-02-29T23:30:00Z")],
      ["aware-valid-fraction-preserved", aware("2026-01-01T02:00:00.123456789+02:00", "2026-01-01T00:00:00.123456789Z", "fraction-9")],
      ["boundary-year-0001", canonicalDate({ raw: "0001-01-01", local: "0001-01-01" })],
      ["boundary-year-9999", canonicalDate({ raw: "9999-12-31", local: "9999-12-31" })],
    ];
    for (let digits = 1; digits <= 9; digits += 1) {
      const fraction = "1".repeat(digits);
      valid.push([
        `local-valid-fraction-${digits}`,
        local(`2026-01-01T12:30:45.${fraction}`, `2026-01-01T12:30:45.${fraction}`, `fraction-${digits}`),
      ]);
    }

    for (const [name, value] of valid) await context.test(name, async () => {
      assertAccepted(parity, normalizeAdapter, await bundleFor(value));
    });
  });
});

test("genuine PR4 date forms remain accepted through the public parity pipeline", async (context) => {
  await withCorruptedRegistry(async ({ normalize, normalizeAdapter, parity, setMutation }) => {
    setMutation(null);
    const genuineValues = [
      ["date-only", "2026-01-01"],
      ["leap-day", "2024-02-29"],
      ["year-0001", "0001-01-01"],
      ["year-9999", "9999-12-31"],
      ["local-minute", "2026-01-01T12:30"],
      ["local-minute-space", "2026-01-01 12:30"],
      ["local-second", "2026-01-01T12:30:45"],
      ["aware-z", "2026-01-01T12:30:45Z"],
      ["aware-positive-offset", "2026-01-01T12:30:45+02:00"],
      ["aware-negative-offset", "2026-01-01T12:30:45-02:00"],
    ];
    for (let digits = 1; digits <= 9; digits += 1) {
      genuineValues.push([`local-fraction-${digits}`, `2026-01-01T12:30:45.${"1".repeat(digits)}`]);
      genuineValues.push([`aware-fraction-${digits}`, `2026-01-01T12:30:45.${"1".repeat(digits)}Z`]);
    }

    for (const [name, sourceValue] of genuineValues) await context.test(name, async () => {
      const pages = await trustedCompleteTicketPages([
        postgresTicket(1, "cctv", `GENUINE-${name}`, { dateTime: sourceValue }),
      ], 100);
      const sheetsSnapshot = await trustedAllSheetsSnapshot({
        cctv: [sheetRow("cctv", `GENUINE-${name}`, { 2: sourceValue })],
      });
      const postgres = Object.freeze(pages.map(normalize.normalizePostgresSnapshot));
      const sheets = normalize.normalizeSheetsSnapshot(sheetsSnapshot);
      const bundle = normalize.assembleCanonicalParityBundle(postgres, sheets);
      assertAccepted(parity, normalizeAdapter, bundle);
    });
  });
});
