"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DatabaseInputError, MalformedDatabaseResultError, classifyError } = require("../../src/errors");
const { TICKET_SQL, listTicketsPage } = require("../../src/postgres/tickets");

function ticket(overrides = {}) { return { id: "900719925474099312345", section: "cctv", status: "Open", payload: { nested: ["raw"] }, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z", ...overrides }; }
function clientReturning(rows) { return { query: async (query) => { clientReturning.last = query; return { rows }; } }; }

test("ticket reads use explicit fixed columns, schema qualification, stable keyset ordering, and BIGINT strings", async () => {
  const page = await listTicketsPage(clientReturning([ticket()]), { limit: 10, lastSeenId: "12" });
  assert.equal(clientReturning.last.text, TICKET_SQL.after);
  assert.deepEqual(clientReturning.last.values, ["12", 10]);
  assert.doesNotMatch(clientReturning.last.text, /SELECT\s+\*/i);
  assert.match(clientReturning.last.text, /public\.tickets/);
  assert.match(clientReturning.last.text, /ORDER BY id ASC/);
  assert.equal(page.rows[0].id, "900719925474099312345");
});

test("section filter is parameterized", async () => {
  const injection = "cctv' OR true --";
  await listTicketsPage(clientReturning([]), { limit: 5, section: injection });
  assert.equal(clientReturning.last.text, TICKET_SQL.section);
  assert.deepEqual(clientReturning.last.values, [injection, 5]);
  assert.equal(clientReturning.last.text.includes(injection), false);
});

test("ticket limit and cursors are strictly bounded", async () => {
  for (const options of [{ limit: -1 }, { limit: 0 }, { limit: 1.5 }, { limit: "1" }, { limit: 101 }, { limit: 1, lastSeenId: "0" }, { limit: 1, lastSeenId: 12 }, { limit: 1, section: null }]) {
    await assert.rejects(listTicketsPage(clientReturning([]), options), (error) => {
      assert.equal(error instanceof DatabaseInputError, true);
      assert.equal(classifyError(error).publicCode, "DATABASE_INPUT_FAILURE");
      return true;
    });
  }
});

test("caller input errors never expose supplied values", async () => {
  const secret = "postgres://user:password@private.invalid/customer-token";
  await assert.rejects(listTicketsPage(clientReturning([]), { limit: 1, section: secret.repeat(8) }), (error) => {
    assert.equal(error instanceof DatabaseInputError, true);
    assert.equal(error.message.includes(secret), false);
    assert.equal(JSON.stringify(classifyError(error)).includes(secret), false);
    return true;
  });
});

test("malformed ticket rows and payloads are rejected without repair", async () => {
  await assert.rejects(listTicketsPage(clientReturning([ticket({ id: 9007199254740992 })]), { limit: 1 }), MalformedDatabaseResultError);
  await assert.rejects(listTicketsPage(clientReturning([ticket({ payload: [] })]), { limit: 1 }), MalformedDatabaseResultError);
  await assert.rejects(listTicketsPage(clientReturning([{ id: "1" }]), { limit: 1 }), MalformedDatabaseResultError);
});

test("ticket snapshots deeply clone and freeze driver rows and nested JSON", async () => {
  const driverRow = ticket();
  const page = await listTicketsPage(clientReturning([driverRow]), { limit: 1 });
  driverRow.payload.nested[0] = "mutated";
  assert.equal(page.rows[0].payload.nested[0], "raw");
  assert.equal(Object.isFrozen(page), true);
  assert.equal(Object.isFrozen(page.rows), true);
  assert.equal(Object.isFrozen(page.rows[0].payload.nested), true);
  assert.throws(() => { page.rows[0].payload.nested.push("x"); }, TypeError);
});
