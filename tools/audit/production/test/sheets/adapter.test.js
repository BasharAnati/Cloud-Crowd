"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createSheetsAdapter } = require("../../src/sheets");
const { classifyError, SafetyViolationError } = require("../../src/errors");
const { fakeGoogle, responseFor, safeCapability, sheetsEnvironment } = require("./helpers");

test("adapter import and construction perform no environment, Google load, auth, or request activity", () => {
  let environmentReads = 0;
  let googleLoads = 0;
  const adapter = createSheetsAdapter({
    safety: safeCapability(),
    envProvider() { environmentReads += 1; return sheetsEnvironment(); },
    googleFactory() { googleLoads += 1; return {}; },
  });
  assert.equal(environmentReads, 0);
  assert.equal(googleLoads, 0);
  assert.equal(Object.isFrozen(adapter), true);
});

test("missing, forged, cloned, and proxied capabilities fail before environment access", () => {
  let environmentReads = 0;
  const options = { envProvider() { environmentReads += 1; return sheetsEnvironment(); } };
  const genuine = safeCapability();
  for (const safety of [undefined, { ...genuine }, Object.freeze({ target: "production", mode: "read-only", productionAcknowledged: true, capabilities: Object.freeze({ readOnly: true, writesAllowed: false }) }), new Proxy(genuine, {})]) {
    assert.throws(() => createSheetsAdapter({ ...options, safety }), SafetyViolationError);
  }
  assert.equal(environmentReads, 0);
});

test("public surface is fixed and every argument is rejected before environment or Google access", async () => {
  let environmentReads = 0;
  let googleLoads = 0;
  const adapter = createSheetsAdapter({
    safety: safeCapability(),
    envProvider() { environmentReads += 1; return sheetsEnvironment(); },
    googleFactory() { googleLoads += 1; return {}; },
  });
  assert.deepEqual(Object.keys(adapter).sort(), [
    "readAllConfiguredSheets", "readCctvSheet", "readComplaintsSheet",
    "readComplimentaryOrdersSheet", "readCustomerExperienceSheet",
  ]);
  for (const method of Object.values(adapter)) {
    await assert.rejects(method("caller-secret"), (error) => {
      assert.equal(classifyError(error).publicCode, "SHEETS_INPUT_FAILURE");
      assert.equal(error.message.includes("caller-secret"), false);
      return true;
    });
  }
  assert.equal(environmentReads, 0);
  assert.equal(googleLoads, 0);
});

test("invalid configuration or credentials fail before lazy googleapis construction", async () => {
  let googleLoads = 0;
  for (const env of [sheetsEnvironment({ GOOGLE_APPLICATION_CREDENTIALS_JSON: undefined }), sheetsEnvironment({ GOOGLE_SHEET_ID_CCTV: undefined })]) {
    const adapter = createSheetsAdapter({ safety: safeCapability(), env, googleFactory() { googleLoads += 1; return {}; } });
    await assert.rejects(adapter.readCctvSheet());
  }
  assert.equal(googleLoads, 0);
});

test("fixed module read authorizes once and returns an immutable secret-free snapshot", async () => {
  const fake = fakeGoogle({ responseOptions: { rows: [["Open", "", "raw"]] } });
  const env = sheetsEnvironment();
  const adapter = createSheetsAdapter({ safety: safeCapability(), env, googleFactory: fake.factory });
  const snapshot = await adapter.readCctvSheet();
  assert.equal(fake.state.authorizations, 1);
  assert.equal(fake.state.requests.length, 1);
  assert.equal(snapshot.module, "CCTV");
  assert.deepEqual(snapshot.rows[0].cells, ["Open", "", "raw"]);
  assert.equal(JSON.stringify(snapshot).includes(env.GOOGLE_SHEET_ID_CCTV), false);
  assert.equal(JSON.stringify(snapshot).includes("CCTV'!"), false);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.rows), true);
});

test("readAll authorizes once and reads the four configured modules sequentially in fixed order", async () => {
  const fake = fakeGoogle({
    async onBatchGet(params) {
      await Promise.resolve();
      return responseFor(params, { rows: [[params.spreadsheetId]] });
    },
  });
  const env = sheetsEnvironment();
  const adapter = createSheetsAdapter({ safety: safeCapability(), env, googleFactory: fake.factory });
  const result = await adapter.readAllConfiguredSheets();
  assert.equal(fake.state.authorizations, 1);
  assert.deepEqual(fake.state.requests.map((call) => call.params.spreadsheetId), [
    env.GOOGLE_SHEET_ID_CCTV,
    env.GOOGLE_SHEET_ID_CUSTOMER_EXPERIENCE,
    env.GOOGLE_SHEET_ID_DAILY_COMPLAINTS,
    env.GOOGLE_SHEET_ID_COMPLIMENTARY,
  ]);
  assert.equal(fake.state.maximumActive, 1);
  assert.deepEqual(result.snapshots.map((snapshot) => snapshot.module), ["CCTV", "Customer Experience", "Complaints", "Complimentary Orders"]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.snapshots), true);
});

test("snapshots are detached from mutable Google response references", async () => {
  let response;
  const fake = fakeGoogle({ onBatchGet(params) { response = responseFor(params, { rows: [["original"]] }); return response; } });
  const snapshot = await createSheetsAdapter({ safety: safeCapability(), env: sheetsEnvironment(), googleFactory: fake.factory }).readCctvSheet();
  response.data.valueRanges[1].values[0][0] = "mutated";
  assert.equal(snapshot.rows[0].cells[0], "original");
});

test("authorization and overall readAll stages are bounded", async () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  try {
    global.setTimeout = (callback, delay) => originalSetTimeout(callback, delay === 10_000 ? 0 : delay);
    global.clearTimeout = (timer) => originalClearTimeout(timer);
    const authPending = fakeGoogle({ authorizePending: true });
    const authAdapter = createSheetsAdapter({ safety: safeCapability(), env: sheetsEnvironment(), googleFactory: authPending.factory });
    await assert.rejects(authAdapter.readCctvSheet(), (error) => classifyError(error).publicCode === "SHEETS_TIMEOUT");

    global.setTimeout = (callback, delay) => originalSetTimeout(callback, delay === 75_000 ? 0 : delay);
    const requestPending = fakeGoogle({ onBatchGet() { return new Promise(() => {}); } });
    const allAdapter = createSheetsAdapter({ safety: safeCapability(), env: sheetsEnvironment(), googleFactory: requestPending.factory });
    await assert.rejects(allAdapter.readAllConfiguredSheets(), (error) => classifyError(error).publicCode === "SHEETS_TIMEOUT");
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("readAll total-cell limit fails closed without partial output", async () => {
  const rows = Array.from({ length: 4_000 }, () => Array.from({ length: 32 }, () => ""));
  const fake = fakeGoogle({ onBatchGet(params) { return responseFor(params, { rows }); } });
  const adapter = createSheetsAdapter({ safety: safeCapability(), env: sheetsEnvironment(), googleFactory: fake.factory });
  await assert.rejects(adapter.readAllConfiguredSheets(), (error) => classifyError(error).publicCode === "UNEXPECTED_SHEET_STRUCTURE");
  assert.equal(fake.state.requests.length, 4);
});

test("readAll total-text limit fails closed without truncation", async () => {
  const cell = "x".repeat(1_600);
  const rows = Array.from({ length: 165 }, () => Array.from({ length: 32 }, () => cell));
  const fake = fakeGoogle({ onBatchGet(params) { return responseFor(params, { rows }); } });
  const adapter = createSheetsAdapter({ safety: safeCapability(), env: sheetsEnvironment(), googleFactory: fake.factory });
  await assert.rejects(adapter.readAllConfiguredSheets(), (error) => classifyError(error).publicCode === "UNEXPECTED_SHEET_STRUCTURE");
  assert.equal(fake.state.requests.length, 4);
});
