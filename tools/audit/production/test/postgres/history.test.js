"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DatabaseInputError, MalformedDatabaseResultError, classifyError } = require("../../src/errors");
const { HISTORY_SQL, listHistoryPage } = require("../../src/postgres/history");

function history(overrides = {}) { return { id: "22", ticket_id: "999999999999999999", section: "ce", changed_by: null, prev_status: null, new_status: "Closed", prev_action: null, new_action: "done", changed_at: "2026-02-03T04:05:06.000Z", ...overrides }; }
function recorder(rows) { return { async query(query) { recorder.last = query; return { rows }; } }; }

test("history reads are independent, fixed, explicit, and preserve deleted-ticket records", async () => {
  const page = await listHistoryPage(recorder([history()]), { limit: 20, ticketId: "999999999999999999" });
  assert.equal(recorder.last.text, HISTORY_SQL.ticket);
  assert.deepEqual(recorder.last.values, ["999999999999999999", 20]);
  assert.doesNotMatch(recorder.last.text, /\bJOIN\b/i);
  assert.doesNotMatch(recorder.last.text, /SELECT\s+\*/i);
  assert.equal(page.rows[0].ticket_id, "999999999999999999");
});

test("history keyset cursor orders by timestamp and id with parameters", async () => {
  const cursor = { changedAt: "2026-01-01T00:00:00Z", id: "12" };
  await listHistoryPage(recorder([]), { limit: 5, cursor });
  assert.equal(recorder.last.text, HISTORY_SQL.cursor);
  assert.deepEqual(recorder.last.values, [cursor.changedAt, cursor.id, 5]);
  assert.match(recorder.last.text, /ORDER BY changed_at ASC, id ASC/);
});

test("history snapshots are deeply immutable", async () => {
  const page = await listHistoryPage(recorder([history()]), { limit: 1 });
  assert.equal(Object.isFrozen(page), true);
  assert.equal(Object.isFrozen(page.rows[0]), true);
  assert.equal(Object.isFrozen(page.nextCursor), true);
});

test("invalid history pagination input receives the trusted caller-input classification", async () => {
  for (const options of [
    { limit: 0 }, { limit: 1.5 }, { limit: "1" }, { limit: 101 },
    { limit: 1, ticketId: 1 }, { limit: 1, ticketId: "0" },
    { limit: 1, cursor: { id: "1" } },
    { limit: 1, cursor: { id: "1", changedAt: "invalid" } },
    { limit: 1, cursor: { id: "x", changedAt: "2026-01-01T00:00:00Z" } },
  ]) {
    await assert.rejects(listHistoryPage(recorder([]), options), (error) => {
      assert.equal(error instanceof DatabaseInputError, true);
      assert.equal(classifyError(error).publicCode, "DATABASE_INPUT_FAILURE");
      return true;
    });
  }
});

test("malformed history rows are rejected without normalization", async () => {
  await assert.rejects(listHistoryPage(recorder([{ bogus: "accepted" }]), { limit: 1 }), MalformedDatabaseResultError);
  await assert.rejects(listHistoryPage(recorder([history({ changed_at: "invalid" })]), { limit: 1 }), MalformedDatabaseResultError);
});
