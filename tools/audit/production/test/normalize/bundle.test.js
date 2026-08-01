"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { types } = require("node:util");
const {
  assembleCanonicalParityBundle,
  normalizePostgresSnapshot,
  normalizeSheetsSnapshot,
} = require("../../src/normalize");
const { classifyError } = require("../../src/errors");
const { createPostgresAdapter } = require("../../src/postgres");
const { adapterEnvironment, fakeClientClass, safeCapability } = require("../postgres/helpers");
const {
  DEFAULT_TICKET,
  trustedAllSheetsSnapshot,
  trustedCompleteTicketPages,
  trustedHistorySnapshot,
  trustedSheetSnapshot,
} = require("./helpers");

function ticket(id, section = "ce", identity = `O-${id}`) {
  return {
    id: String(id), section, status: "Open", payload: section === "cctv" ? { caseNumber: identity } : { orderNumber: identity },
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
}

async function normalizedPages(rows = [], limit = 100, section) {
  const snapshots = await trustedCompleteTicketPages(rows, limit, section);
  return Object.freeze(snapshots.map(normalizePostgresSnapshot));
}

async function normalizedSheets(rows = {}) {
  return normalizeSheetsSnapshot(await trustedAllSheetsSnapshot(rows));
}

async function scriptedPages(steps, maximumPageSize = 100) {
  let ticketQuery = 0;
  const Client = fakeClientClass({
    onQuery(query) {
      if (!query.text.includes("FROM public.tickets")) return undefined;
      const rows = steps[ticketQuery].rows;
      ticketQuery += 1;
      return { rows };
    },
  });
  const adapter = createPostgresAdapter({
    safety: safeCapability(), env: adapterEnvironment, expectedDatabase: "cloud_crowd", Client, maximumPageSize,
  });
  const results = [];
  let previousSnapshot;
  for (const step of steps) {
    const snapshot = step.options.lastSeenId === undefined
      ? await adapter.listTicketsPage(step.options)
      : await adapter.listTicketsPage(step.options, previousSnapshot);
    results.push(normalizePostgresSnapshot(snapshot));
    previousSnapshot = snapshot;
  }
  return Object.freeze(results);
}

function assertTrustedNormalizationFailure(operation) {
  let error;
  try { operation(); } catch (caught) { error = caught; }
  assert.ok(error);
  const classification = classifyError(error);
  assert.equal(classification.exitCode, 7);
  assert.match(classification.publicCode, /^NORMALIZATION_/);
  assert.notEqual(classification.publicCode, "INTERNAL_ERROR");
}

test("one terminal page and an empty complete PostgreSQL result assemble", async () => {
  for (const rows of [[], [ticket(1)]]) {
    const bundle = assembleCanonicalParityBundle(await normalizedPages(rows, 2), await normalizedSheets());
    assert.equal(bundle.counts.postgresTickets, rows.length);
    assert.equal(bundle.completeness.postgresComplete, true);
  }
});

test("multiple linked PostgreSQL pages preserve page and row order, including the empty terminal page", async () => {
  const rows = [ticket(1), ticket(3), ticket(7), ticket(9)];
  const pages = await normalizedPages(rows, 2);
  assert.equal(pages.length, 3);
  const bundle = assembleCanonicalParityBundle(pages, await normalizedSheets());
  assert.deepEqual(bundle.postgresRecords.map((record) => record.ticketId), ["1", "3", "7", "9"]);
  assert.equal(bundle.counts.postgresPages, 3);
});

test("only pages from the same trusted PostgreSQL scan are accepted", async () => {
  const sameScan = await normalizedPages([ticket(1), ticket(2), ticket(3)], 2);
  const sheets = await normalizedSheets();
  assert.equal(assembleCanonicalParityBundle(sameScan, sheets).counts.postgresPages, 2);

  const firstScanPage = (await scriptedPages([
    { options: { limit: 2 }, rows: [ticket(1), ticket(2)] },
  ], 2))[0];
  const differentAdapterPages = await scriptedPages([
    { options: { limit: 2 }, rows: [ticket(1), ticket(2)] },
    { options: { limit: 2, lastSeenId: "2" }, rows: [ticket(3)] },
  ], 2);
  assert.throws(
    () => assembleCanonicalParityBundle(Object.freeze([firstScanPage, differentAdapterPages[1]]), sheets),
    { name: "NormalizationInvalidPageSetError" }
  );
});

test("restarting pagination on one adapter creates a distinct logical scan", async () => {
  const pages = await scriptedPages([
    { options: { limit: 2 }, rows: [ticket(1), ticket(2)] },
    { options: { limit: 2 }, rows: [ticket(1), ticket(2)] },
    { options: { limit: 2, lastSeenId: "2" }, rows: [ticket(3)] },
  ], 2);
  const sheets = await normalizedSheets();
  assert.throws(
    () => assembleCanonicalParityBundle(Object.freeze([pages[0], pages[2]]), sheets),
    { name: "NormalizationInvalidPageSetError" }
  );
});

test("missing terminal page, out-of-order pages, repeats, and pages after exhaustion are rejected", async () => {
  const pages = await normalizedPages([ticket(1), ticket(2), ticket(3)], 2);
  const sheets = await normalizedSheets();
  assert.throws(() => assembleCanonicalParityBundle(Object.freeze([pages[0]]), sheets), { name: "NormalizationIncompletePostgresError" });
  assert.throws(() => assembleCanonicalParityBundle(Object.freeze([pages[1], pages[0]]), sheets));
  assert.throws(() => assembleCanonicalParityBundle(Object.freeze([pages[0], pages[0]]), sheets), { name: "NormalizationInvalidPageSetError" });
  assert.throws(() => assembleCanonicalParityBundle(Object.freeze([...pages, pages.at(-1)]), sheets));
});

test("overlaps, duplicate IDs, and descending rows fail closed", async () => {
  const sheets = await normalizedSheets();
  const cases = [
    await scriptedPages([
      { options: { limit: 2 }, rows: [ticket(1), ticket(2)] },
      { options: { limit: 2, lastSeenId: "2" }, rows: [ticket(2)] },
    ]),
    await scriptedPages([{ options: { limit: 3 }, rows: [ticket(1), ticket(1)] }]),
    await scriptedPages([{ options: { limit: 3 }, rows: [ticket(2), ticket(1)] }]),
  ];
  for (const pages of cases) assert.throws(() => assembleCanonicalParityBundle(pages, sheets));
});

test("zero pages, mutable wrappers, forged pages, cloned pages, and history results are rejected", async () => {
  const sheets = await normalizedSheets();
  assert.throws(() => assembleCanonicalParityBundle(Object.freeze([]), sheets), { name: "NormalizationIncompletePostgresError" });
  const pages = await normalizedPages([], 2);
  assert.throws(() => assembleCanonicalParityBundle([pages[0]], sheets), { name: "NormalizationInvalidPageSetError" });
  assert.throws(() => assembleCanonicalParityBundle(Object.freeze([Object.freeze([...pages[0]])]), sheets), { name: "NormalizationProvenanceError" });
  const history = normalizePostgresSnapshot(await trustedHistorySnapshot());
  assert.throws(() => assembleCanonicalParityBundle(Object.freeze([history]), sheets), { name: "NormalizationInvalidPageSetError" });
});

test("consistent section-filtered pages are not a complete all-ticket PostgreSQL source", async () => {
  const pages = await normalizedPages([ticket(1, "ce")], 2, "ce");
  const sheets = await normalizedSheets();
  assert.throws(() => assembleCanonicalParityBundle(pages, sheets), { name: "NormalizationInvalidPageSetError" });
});

test("page-count limit fails closed before inspecting repeated contents", async () => {
  const page = (await normalizedPages([], 2))[0];
  const excessive = Object.freeze(Array(10_001).fill(page));
  const sheets = await normalizedSheets();
  assert.throws(() => assembleCanonicalParityBundle(excessive, sheets), { name: "NormalizationBundleLimitError" });
});

test("one over the per-module PostgreSQL ticket limit fails without truncation", { timeout: 30_000 }, async () => {
  const rows = Array.from({ length: 10_001 }, (_, index) => ticket(index + 1, "ce"));
  const pages = await normalizedPages(rows, 10_002);
  const sheets = await normalizedSheets();
  assert.throws(() => assembleCanonicalParityBundle(pages, sheets), { name: "NormalizationBundleLimitError" });
});

test("genuine all-four Sheets results support all empty, all non-empty, and mixed representations", async () => {
  const variants = [
    {},
    {
      cctv: [["Open", "B", "2026-01-01", "", "", "", "", "", "", "", "C-1"]],
      "customer-experience": [["Open", "", "N", "P", "2026-01-01", "", "", "B", "", "", "", "", "", "", "", "O-1"]],
      complaints: [["Open", "", "N", "P", "2026-01-01", "", "", "B", "", "", "", "", "", "O-2"]],
      "complimentary-orders": [["Open", "N", "P", "2026-01-01", "", "", "", "", "", "", "", "", "O-3"]],
    },
    { complaints: [["Open", "", "N", "P", "2026-01-01", "", "", "B", "", "", "", "", "", "O-2"]] },
  ];
  for (const rows of variants) {
    const bundle = assembleCanonicalParityBundle(await normalizedPages([], 2), await normalizedSheets(rows));
    assert.deepEqual([...bundle.modules], ["cctv", "customer-experience", "complaints", "complimentary-orders"]);
    assert.equal(bundle.completeness.sheetsComplete, true);
    assert.equal(bundle.completeness.allModulesRepresented, true);
  }
});

test("individual, concatenated, cloned, JSON-copied, and proxied Sheets results are rejected", async () => {
  const pages = await normalizedPages([], 2);
  const individual = normalizeSheetsSnapshot(await trustedSheetSnapshot("readCctvSheet", []));
  const all = await normalizedSheets();
  for (const candidate of [
    individual,
    Object.freeze([...individual]),
    Object.freeze([...all]),
    JSON.parse(JSON.stringify(all)),
    new Proxy(all, {}),
  ]) assert.throws(() => assembleCanonicalParityBundle(pages, candidate));
});

test("missing, duplicate, and wrong-order module compositions cannot replace a trusted read-all result", async () => {
  const pages = await normalizedPages([], 2);
  const methods = [
    "readCctvSheet", "readCustomerExperienceSheet", "readComplaintsSheet", "readComplimentaryOrdersSheet",
  ];
  const modules = [];
  for (const method of methods) modules.push(normalizeSheetsSnapshot(await trustedSheetSnapshot(method, [])));
  const candidates = [
    Object.freeze(modules.slice(1).flat()),
    Object.freeze([...modules[0], ...modules[0], ...modules[1], ...modules[2], ...modules[3]]),
    Object.freeze([...modules[1], ...modules[0], ...modules[2], ...modules[3]]),
  ];
  for (const candidate of candidates) assert.throws(() => assembleCanonicalParityBundle(pages, candidate), {
    name: "NormalizationProvenanceError",
  });
});

test("bundle keeps sources separate and exposes fixed counts and completeness only", async () => {
  const rows = [ticket(1, "cctv", "C-1"), ticket(2, "ce"), ticket(3, "complaints"), ticket(4, "free-orders")];
  const bundle = assembleCanonicalParityBundle(await normalizedPages(rows, 5), await normalizedSheets());
  assert.deepEqual(Object.keys(bundle), ["postgresRecords", "sheetsRecords", "modules", "counts", "completeness"]);
  assert.equal(bundle.counts.postgresTickets, 4);
  assert.equal(bundle.counts.sheetsTickets, 0);
  assert.equal(bundle.counts.sheetModuleRecords, 4);
  assert.equal(bundle.counts.postgresPages, 1);
  assert.equal(Object.hasOwn(bundle, "findings"), false);
  assert.equal(Object.hasOwn(bundle, "summary"), false);
  assert.equal(bundle.postgresRecords.every((record) => record.source === "postgresql"), true);
  assert.equal(bundle.sheetsRecords.every((record) => record.source === "google-sheets"), true);
});

test("bundle is deeply frozen, null-prototype, detached from wrappers, and reuses only frozen canonical records", async () => {
  const pages = await normalizedPages([ticket(1)], 2);
  const pageWrapper = Object.freeze([...pages]);
  const sheets = await normalizedSheets();
  const bundle = assembleCanonicalParityBundle(pageWrapper, sheets);
  assert.equal(Object.getPrototypeOf(bundle), null);
  assert.equal(Object.isFrozen(bundle), true);
  assert.equal(Object.isFrozen(bundle.postgresRecords), true);
  assert.equal(Object.isFrozen(bundle.sheetsRecords), true);
  assert.equal(Object.isFrozen(bundle.modules), true);
  assert.equal(Object.isFrozen(bundle.counts), true);
  assert.equal(Object.isFrozen(bundle.counts.recordsByModule), true);
  assert.equal(Object.isFrozen(bundle.completeness), true);
  assert.notStrictEqual(bundle.postgresRecords, pages[0]);
  assert.notStrictEqual(bundle.sheetsRecords, sheets);
  assert.strictEqual(bundle.postgresRecords[0], pages[0][0]);
  assert.equal(Object.isFrozen(bundle.postgresRecords[0]), true);
  assert.equal(types.isProxy(bundle), false);
});

test("no sorting, deduplication, matching, or business-identifier collapse occurs", async () => {
  const rows = [ticket(2, "ce", "SAME"), ticket(10, "complaints", "SAME")];
  const bundle = assembleCanonicalParityBundle(await normalizedPages(rows, 3), await normalizedSheets());
  assert.deepEqual(bundle.postgresRecords.map((record) => record.ticketId), ["2", "10"]);
  assert.deepEqual(bundle.postgresRecords.map((record) => record.orderNumber), ["SAME", "SAME"]);
  assert.equal(bundle.postgresRecords.length, 2);
});

test("exactly two arguments are required", async () => {
  const pages = await normalizedPages([], 2);
  const sheets = await normalizedSheets();
  assert.throws(() => assembleCanonicalParityBundle());
  assert.throws(() => assembleCanonicalParityBundle(pages));
  assert.throws(() => assembleCanonicalParityBundle(pages, sheets, null));
});

test("trusted bundle errors use fixed normalization classifications without secret leakage", async () => {
  const secret = "customer-secret-phone-and-url";
  let error;
  try { assembleCanonicalParityBundle(Object.freeze([{ secret }]), await normalizedSheets()); } catch (caught) { error = caught; }
  assert.equal(classifyError(error).publicCode, "NORMALIZATION_PROVENANCE_FAILURE");
  assert.equal(classifyError(error).exitCode, 7);
  assert.equal(JSON.stringify(classifyError(error)).includes(secret), false);
  error.code = secret;
  error.exitCode = 0;
  assert.equal(classifyError(error).publicCode, "NORMALIZATION_PROVENANCE_FAILURE");
});

test("revoked and throwing proxy inputs always use trusted normalization errors", async () => {
  const pages = await normalizedPages([], 2);
  const sheets = await normalizedSheets();
  const revokedWrapper = Proxy.revocable(pages, {});
  const revokedPage = Proxy.revocable(pages[0], {});
  const revokedSheets = Proxy.revocable(sheets, {});
  revokedWrapper.revoke();
  revokedPage.revoke();
  revokedSheets.revoke();

  assertTrustedNormalizationFailure(() => assembleCanonicalParityBundle(revokedWrapper.proxy, sheets));
  assertTrustedNormalizationFailure(() => assembleCanonicalParityBundle(Object.freeze([revokedPage.proxy]), sheets));
  assertTrustedNormalizationFailure(() => assembleCanonicalParityBundle(pages, revokedSheets.proxy));
  const throwingProxy = new Proxy(pages, {
    getOwnPropertyDescriptor() { throw new TypeError("hostile trap"); },
    ownKeys() { throw new TypeError("hostile trap"); },
  });
  assertTrustedNormalizationFailure(() => assembleCanonicalParityBundle(throwingProxy, sheets));
});

test("throwing Array and Reflect intrinsics are contained by the bundle boundary", async () => {
  const pages = await normalizedPages([], 2);
  const sheets = await normalizedSheets();
  const originalIsArray = Array.isArray;
  try {
    Array.isArray = () => { throw new TypeError("hostile Array.isArray"); };
    assertTrustedNormalizationFailure(() => assembleCanonicalParityBundle(pages, sheets));
  } finally {
    Array.isArray = originalIsArray;
  }

  const originalOwnKeys = Reflect.ownKeys;
  try {
    Reflect.ownKeys = () => { throw new TypeError("hostile Reflect.ownKeys"); };
    assertTrustedNormalizationFailure(() => assembleCanonicalParityBundle(pages, sheets));
  } finally {
    Reflect.ownKeys = originalOwnKeys;
  }
});

test("existing default ticket can be assembled without adding comparison output", async () => {
  const bundle = assembleCanonicalParityBundle(await normalizedPages([DEFAULT_TICKET], 2), await normalizedSheets());
  assert.equal(bundle.postgresRecords[0].ticketId, DEFAULT_TICKET.id);
  assert.deepEqual(Reflect.ownKeys(bundle).filter((key) => /match|duplicate|finding|summary/i.test(String(key))), []);
});
