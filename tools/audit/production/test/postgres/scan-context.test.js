"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createPostgresAdapter } = require("../../src/postgres");
const { verifySameTrustedPostgresTicketScan } = require("../../src/postgres/adapter");
const {
  assembleCanonicalParityBundle,
  normalizePostgresSnapshot,
  normalizeSheetsSnapshot,
} = require("../../src/normalize");
const { trustedAllSheetsSnapshot } = require("../normalize/helpers");
const { adapterEnvironment, fakeClientClass, safeCapability } = require("./helpers");

function ticket(id) {
  return {
    id: String(id), section: "ce", status: "Open", payload: { orderNumber: `O-${id}` },
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
}

function scriptedAdapter(steps, maximumPageSize = 2) {
  let ticketQuery = 0;
  const BaseClient = fakeClientClass({
    onQuery(query, client) {
      if (query.text.includes("FROM public.tickets")) {
        const step = steps[ticketQuery];
        ticketQuery += 1;
        if (!step) throw new Error("Unexpected synthetic ticket query");
        client.scanStep = step;
        if (step.queryError) throw new Error("Synthetic query failure");
        return { rows: step.rows };
      }
      if (query.text === "COMMIT" && client.scanStep && client.scanStep.commitError) {
        throw new Error("Synthetic commit failure");
      }
      return undefined;
    },
  });
  class Client extends BaseClient {
    async end() {
      if (this.scanStep && this.scanStep.cleanupError) throw new Error("Synthetic cleanup failure");
      return super.end();
    }
  }
  return createPostgresAdapter({
    safety: safeCapability(), env: adapterEnvironment, expectedDatabase: "cloud_crowd", Client, maximumPageSize,
  });
}

function sameScan(left, right) {
  try {
    verifySameTrustedPostgresTicketScan(left, right);
    return true;
  } catch (_) {
    return false;
  }
}

test("two and three overlapping scans progress independently with interleaved continuations", async () => {
  const adapter = scriptedAdapter([
    { rows: [ticket(1), ticket(2)] },
    { rows: [ticket(101), ticket(102)] },
    { rows: [ticket(201), ticket(202)] },
    { rows: [ticket(103)] },
    { rows: [ticket(3), ticket(4)] },
    { rows: [ticket(203)] },
    { rows: [] },
  ]);
  const [a1, b1, c1] = await Promise.all([
    adapter.listTicketsPage({ limit: 2 }),
    adapter.listTicketsPage({ limit: 2 }),
    adapter.listTicketsPage({ limit: 2 }),
  ]);
  const b2 = await adapter.listTicketsPage({ limit: 2, lastSeenId: "102" }, b1);
  const a2 = await adapter.listTicketsPage({ limit: 2, lastSeenId: "2" }, a1);
  const c2 = await adapter.listTicketsPage({ limit: 2, lastSeenId: "202" }, c1);
  const a3 = await adapter.listTicketsPage({ limit: 2, lastSeenId: "4" }, a2);

  assert.equal(sameScan(a1, a2), true);
  assert.equal(sameScan(a1, a3), true);
  assert.equal(sameScan(b1, b2), true);
  assert.equal(sameScan(c1, c2), true);
  assert.equal(sameScan(a1, b1), false);
  assert.equal(sameScan(b1, c1), false);

  const sheets = normalizeSheetsSnapshot(await trustedAllSheetsSnapshot());
  const bundleA = assembleCanonicalParityBundle(Object.freeze([a1, a2, a3].map(normalizePostgresSnapshot)), sheets);
  const bundleB = assembleCanonicalParityBundle(Object.freeze([b1, b2].map(normalizePostgresSnapshot)), sheets);
  const bundleC = assembleCanonicalParityBundle(Object.freeze([c1, c2].map(normalizePostgresSnapshot)), sheets);
  assert.deepEqual(bundleA.postgresRecords.map((record) => record.ticketId), ["1", "2", "3", "4"]);
  assert.deepEqual(bundleB.postgresRecords.map((record) => record.ticketId), ["101", "102", "103"]);
  assert.deepEqual(bundleC.postgresRecords.map((record) => record.ticketId), ["201", "202", "203"]);
});

test("continuations require exact ownership, expected cursor, page policy, and latest snapshot", async () => {
  const adapter = scriptedAdapter([
    { rows: [ticket(1), ticket(2)] },
    { rows: [ticket(3), ticket(4)] },
    { rows: [] },
  ]);
  const first = await adapter.listTicketsPage({ limit: 2 });
  await assert.rejects(adapter.listTicketsPage({ limit: 2, lastSeenId: "1" }, first), { name: "DatabaseInputError" });
  await assert.rejects(adapter.listTicketsPage({ limit: 1, lastSeenId: "2" }, first), { name: "DatabaseInputError" });
  await assert.rejects(adapter.listTicketsPage({ limit: 2, lastSeenId: "2" }), { name: "DatabaseInputError" });
  await assert.rejects(adapter.listTicketsPage({ limit: 2, lastSeenId: "2" }, Object.freeze({})), { name: "DatabaseInputError" });

  const secondPending = adapter.listTicketsPage({ limit: 2, lastSeenId: "2" }, first);
  await assert.rejects(adapter.listTicketsPage({ limit: 2, lastSeenId: "2" }, first), { name: "DatabaseInputError" });
  const second = await secondPending;
  await assert.rejects(adapter.listTicketsPage({ limit: 2, lastSeenId: "2" }, first), { name: "DatabaseInputError" });
  const terminal = await adapter.listTicketsPage({ limit: 2, lastSeenId: "4" }, second);
  await assert.rejects(adapter.listTicketsPage({ limit: 2, lastSeenId: "4" }, terminal), { name: "DatabaseInputError" });
});

test("scan ownership is adapter-scoped and concurrent adapter instances remain isolated", async () => {
  const adapterA = scriptedAdapter([{ rows: [ticket(1), ticket(2)] }, { rows: [ticket(3)] }]);
  const adapterB = scriptedAdapter([{ rows: [ticket(1), ticket(2)] }, { rows: [ticket(3)] }]);
  const [a1, b1] = await Promise.all([
    adapterA.listTicketsPage({ limit: 2 }),
    adapterB.listTicketsPage({ limit: 2 }),
  ]);
  await assert.rejects(adapterB.listTicketsPage({ limit: 2, lastSeenId: "2" }, a1), { name: "DatabaseInputError" });
  const [a2, b2] = await Promise.all([
    adapterA.listTicketsPage({ limit: 2, lastSeenId: "2" }, a1),
    adapterB.listTicketsPage({ limit: 2, lastSeenId: "2" }, b1),
  ]);
  assert.equal(sameScan(a1, a2), true);
  assert.equal(sameScan(b1, b2), true);
  assert.equal(sameScan(a1, b1), false);
});

test("query failure invalidates only its scan and a new scan can restart", async () => {
  const adapter = scriptedAdapter([
    { rows: [ticket(1), ticket(2)] },
    { rows: [ticket(101), ticket(102)] },
    { queryError: true },
    { rows: [ticket(103)] },
    { rows: [] },
  ]);
  const a1 = await adapter.listTicketsPage({ limit: 2 });
  const b1 = await adapter.listTicketsPage({ limit: 2 });
  await assert.rejects(adapter.listTicketsPage({ limit: 2, lastSeenId: "2" }, a1));
  await assert.rejects(adapter.listTicketsPage({ limit: 2, lastSeenId: "2" }, a1), { name: "DatabaseInputError" });
  const b2 = await adapter.listTicketsPage({ limit: 2, lastSeenId: "102" }, b1);
  assert.equal(sameScan(b1, b2), true);
  const restarted = await adapter.listTicketsPage({ limit: 2 });
  assert.equal(restarted.pagination.exhausted, true);
  assert.equal(sameScan(a1, restarted), false);
});

for (const failure of ["validation", "commit", "cleanup"]) {
  test(`${failure} failure does not advance or invalidate an unrelated scan`, async () => {
    const failedStep = failure === "validation"
      ? { rows: [{ id: "malformed" }] }
      : failure === "commit"
        ? { rows: [ticket(3)], commitError: true }
        : { rows: [ticket(3)], cleanupError: true };
    const adapter = scriptedAdapter([
      { rows: [ticket(1), ticket(2)] },
      { rows: [ticket(101), ticket(102)] },
      failedStep,
      { rows: [ticket(103)] },
      { rows: [] },
    ]);
    const failedScan = await adapter.listTicketsPage({ limit: 2 });
    const independentScan = await adapter.listTicketsPage({ limit: 2 });
    await assert.rejects(adapter.listTicketsPage({ limit: 2, lastSeenId: "2" }, failedScan));
    await assert.rejects(
      adapter.listTicketsPage({ limit: 2, lastSeenId: "2" }, failedScan),
      { name: "DatabaseInputError" }
    );
    const independentTerminal = await adapter.listTicketsPage(
      { limit: 2, lastSeenId: "102" }, independentScan
    );
    assert.equal(sameScan(independentScan, independentTerminal), true);
    const restarted = await adapter.listTicketsPage({ limit: 2 });
    assert.equal(restarted.pagination.exhausted, true);
  });
}

test("terminal completion is scan-local and restarting creates a distinct context", async () => {
  const adapter = scriptedAdapter([
    { rows: [ticket(1)] },
    { rows: [ticket(101), ticket(102)] },
    { rows: [ticket(103)] },
    { rows: [] },
  ]);
  const completeA = await adapter.listTicketsPage({ limit: 2 });
  const b1 = await adapter.listTicketsPage({ limit: 2 });
  await assert.rejects(adapter.listTicketsPage({ limit: 2, lastSeenId: "1" }, completeA), { name: "DatabaseInputError" });
  const b2 = await adapter.listTicketsPage({ limit: 2, lastSeenId: "102" }, b1);
  assert.equal(sameScan(b1, b2), true);
  const restarted = await adapter.listTicketsPage({ limit: 2 });
  assert.equal(sameScan(completeA, restarted), false);
});
