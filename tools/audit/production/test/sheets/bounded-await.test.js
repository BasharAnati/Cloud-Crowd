"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { SheetsTimeoutError } = require("../../src/errors");
const { DEADLINES_MS, boundedAwait } = require("../../src/sheets/bounded-await");

test("Sheets deadlines are fixed trusted values", () => {
  assert.deepEqual(DEADLINES_MS, { authorization: 10000, request: 15000, readAll: 75000, retryDelay: 250 });
  assert.equal(Object.isFrozen(DEADLINES_MS), true);
});

test("bounded awaits settle never-resolving stages and abort request controllers", async () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.setTimeout = (callback) => originalSetTimeout(callback, 0);
  global.clearTimeout = (timer) => originalClearTimeout(timer);
  try {
    for (const name of ["authorization", "request", "readAll"]) {
      const controller = new AbortController();
      await assert.rejects(boundedAwait(new Promise(() => {}), name, controller), SheetsTimeoutError);
      if (name !== "authorization") assert.equal(controller.signal.aborted, true);
    }
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});
