"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const normalize = require("../../src/normalize");
const {
  verifyTrustedCanonicalBundle,
  verifyTrustedCanonicalRecord,
  verifyTrustedNormalizedResult,
} = require("../../src/normalize/adapter");
const {
  trustedAllSheetsSnapshot,
  trustedCompleteTicketPages,
} = require("./helpers");

async function genuineInputs() {
  const snapshots = await trustedCompleteTicketPages([], 2);
  const pages = Object.freeze(snapshots.map(normalize.normalizePostgresSnapshot));
  const sheets = normalize.normalizeSheetsSnapshot(await trustedAllSheetsSnapshot());
  return { pages, sheets };
}

test("genuine canonical records, normalized arrays, and bundles have identity provenance", async () => {
  const snapshots = await trustedCompleteTicketPages([{
    id: "1", section: "ce", status: "Open", payload: { orderNumber: "O-1" },
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  }], 2);
  const result = normalize.normalizePostgresSnapshot(snapshots[0]);
  assert.equal(verifyTrustedCanonicalRecord(result[0]), true);
  assert.strictEqual(verifyTrustedNormalizedResult(result), result);
  const sheets = normalize.normalizeSheetsSnapshot(await trustedAllSheetsSnapshot());
  const bundle = normalize.assembleCanonicalParityBundle(Object.freeze([result]), sheets);
  assert.strictEqual(verifyTrustedCanonicalBundle(bundle), bundle);
});

test("lookalikes and every common clone form lose canonical and result provenance", async () => {
  const snapshots = await trustedCompleteTicketPages([{
    id: "1", section: "ce", status: "Open", payload: { orderNumber: "O-1" },
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  }], 2);
  const result = normalize.normalizePostgresSnapshot(snapshots[0]);
  const record = result[0];
  const recordCopies = [
    {}, Object.freeze({}), { ...record }, Object.freeze({ ...record }), JSON.parse(JSON.stringify(record)),
  ];
  for (const copy of recordCopies) assert.equal(verifyTrustedCanonicalRecord(copy), false);
  for (const copy of [[...result], Array.from(result), Object.freeze([...result]), JSON.parse(JSON.stringify(result))]) {
    assert.throws(() => verifyTrustedNormalizedResult(copy), TypeError);
  }
});

test("proxies, forged arrays, mutable record wrappers, and forged inserted records are rejected", async () => {
  const { pages, sheets } = await genuineInputs();
  assert.throws(() => normalize.assembleCanonicalParityBundle(new Proxy(pages, {}), sheets));
  assert.throws(() => normalize.assembleCanonicalParityBundle([pages[0]], sheets));
  assert.throws(() => normalize.assembleCanonicalParityBundle(Object.freeze([Object.freeze([...pages[0]])]), sheets));
  assert.throws(() => normalize.assembleCanonicalParityBundle(Object.freeze([new Proxy(pages[0], {})]), sheets));
  const forged = Object.freeze([Object.freeze(Object.create(null))]);
  assert.throws(() => normalize.assembleCanonicalParityBundle(Object.freeze([forged]), sheets));
});

test("bundle and normalized clones are rejected without visible provenance properties or symbols", async () => {
  const { pages, sheets } = await genuineInputs();
  const bundle = normalize.assembleCanonicalParityBundle(pages, sheets);
  assert.throws(() => verifyTrustedCanonicalBundle({ ...bundle }), TypeError);
  assert.throws(() => verifyTrustedCanonicalBundle(Object.freeze({ ...bundle })), TypeError);
  assert.throws(() => verifyTrustedCanonicalBundle(JSON.parse(JSON.stringify(bundle))), TypeError);
  assert.throws(() => verifyTrustedCanonicalBundle(new Proxy(bundle, {})), TypeError);
  for (const value of [pages[0], sheets, bundle, ...bundle.postgresRecords, ...bundle.sheetsRecords]) {
    assert.deepEqual(Object.getOwnPropertySymbols(value), []);
    assert.equal(Object.keys(value).some((key) => /provenance|trusted/i.test(key)), false);
  }
});

test("registration and verification are absent from the public normalization API", () => {
  assert.deepEqual(Object.keys(normalize).sort(), [
    "assembleCanonicalParityBundle", "normalizeAll", "normalizePostgresSnapshot", "normalizeSheetsSnapshot",
  ]);
});

test("registrars and bundle factories do not cross an exported CommonJS seam", () => {
  const adapter = require("../../src/normalize/adapter");
  const postgresAdapter = require("../../src/postgres/adapter");
  assert.equal(Object.isFrozen(adapter), true);
  assert.equal(Object.isFrozen(postgresAdapter), true);
  assert.deepEqual(Object.keys(adapter).filter((key) => /register|registrar|registry|createBundle/i.test(key)), []);
  assert.deepEqual(Object.keys(postgresAdapter).filter((key) => /register|registrar|registry|scanIdentity/i.test(key)), []);
  assert.throws(() => require.resolve("../../src/normalize/provenance"), { code: "MODULE_NOT_FOUND" });
  assert.throws(() => require.resolve("../../src/normalize/bundle"), { code: "MODULE_NOT_FOUND" });
  assert.throws(() => { adapter.registerCanonicalBundle = () => {}; }, TypeError);
});

test("preloading the former registry seams cannot intercept a registrar", () => {
  const adapterPath = require.resolve("../../src/normalize/adapter");
  const bundlePath = path.resolve(__dirname, "../../src/normalize/bundle.js");
  const provenancePath = path.resolve(__dirname, "../../src/normalize/provenance.js");
  const savedAdapter = require.cache[adapterPath];
  let intercepted = false;
  require.cache[bundlePath] = {
    id: bundlePath, filename: bundlePath, loaded: true,
    exports: { createBundleAssembler() { intercepted = true; } },
  };
  require.cache[provenancePath] = {
    id: provenancePath, filename: provenancePath, loaded: true,
    exports: { createProvenanceRegistry() { intercepted = true; } },
  };
  try {
    delete require.cache[adapterPath];
    const reloaded = require("../../src/normalize/adapter");
    assert.equal(Object.isFrozen(reloaded), true);
    assert.equal(intercepted, false);
  } finally {
    delete require.cache[adapterPath];
    delete require.cache[bundlePath];
    delete require.cache[provenancePath];
    if (savedAdapter) require.cache[adapterPath] = savedAdapter;
  }
});

test("scan identity is absent from genuine snapshots and normalized outputs", async () => {
  const snapshots = await trustedCompleteTicketPages([], 2);
  const result = normalize.normalizePostgresSnapshot(snapshots[0]);
  for (const value of [snapshots[0], snapshots[0].pagination, result]) {
    assert.deepEqual(Object.getOwnPropertySymbols(value), []);
    assert.deepEqual(Reflect.ownKeys(value).filter((key) => /scan|identity|trusted/i.test(String(key))), []);
  }
});

test("normalized results from a separately loaded normalization registry are rejected", async () => {
  const snapshots = await trustedCompleteTicketPages([], 2);
  const sheets = normalize.normalizeSheetsSnapshot(await trustedAllSheetsSnapshot());
  const modulePaths = [
    require.resolve("../../src/normalize"),
    require.resolve("../../src/normalize/adapter"),
  ];
  const saved = new Map(modulePaths.map((modulePath) => [modulePath, require.cache[modulePath]]));
  try {
    for (const modulePath of modulePaths) delete require.cache[modulePath];
    const separatelyLoaded = require("../../src/normalize");
    const foreignResult = separatelyLoaded.normalizePostgresSnapshot(snapshots[0]);
    assert.throws(
      () => normalize.assembleCanonicalParityBundle(Object.freeze([foreignResult]), sheets),
      { name: "NormalizationProvenanceError" }
    );
  } finally {
    for (const modulePath of modulePaths) {
      delete require.cache[modulePath];
      if (saved.get(modulePath)) require.cache[modulePath] = saved.get(modulePath);
    }
  }
});
