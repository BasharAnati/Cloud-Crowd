"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const { classifyError } = require("../../src/errors");
const { createSheetsAdapter } = require("../../src/sheets");
const { fakeGoogle, responseFor, safeCapability, sheetsEnvironment } = require("./helpers");

function statusError(status) {
  const error = new Error("raw Google secret");
  Object.defineProperty(error, "response", { value: { status } });
  return error;
}

function adapterFor(fake) {
  return createSheetsAdapter({ safety: safeCapability(), env: sheetsEnvironment(), googleFactory: fake.factory });
}

test("reader issues one fixed batchGet with bounded options and no caller request surface", async () => {
  const fake = fakeGoogle();
  await adapterFor(fake).readCctvSheet();
  assert.equal(fake.state.requests.length, 1);
  assert.deepEqual(fake.state.requests[0].params.ranges, ["'CCTV'!A1:M1", "'CCTV'!A2:M"]);
  assert.equal(fake.state.requests[0].params.majorDimension, "ROWS");
  assert.equal(fake.state.requests[0].params.valueRenderOption, "FORMATTED_VALUE");
  assert.equal(fake.state.requests[0].params.dateTimeRenderOption, "FORMATTED_STRING");
  assert.equal(fake.state.requests[0].requestOptions.timeout, 15_000);
  assert.equal(fake.state.requests[0].requestOptions.retry, false);
  assert.equal(fake.state.requests[0].requestOptions.signal instanceof AbortSignal, true);
});

test("reader retries once only for the fixed retryable statuses", async () => {
  for (const status of [429, 500, 502, 503, 504]) {
    let calls = 0;
    const fake = fakeGoogle({
      async onBatchGet(params) {
        calls += 1;
        if (calls === 1) throw statusError(status);
        return responseFor(params);
      },
    });
    await adapterFor(fake).readCctvSheet();
    assert.equal(calls, 2, status);
  }
});

test("reader does not retry fixed non-retryable failures and sanitizes classifications", async () => {
  const expected = new Map([[400, "SHEETS_INVALID_RANGE"], [401, "SHEETS_AUTHENTICATION_FAILURE"], [403, "SHEETS_PERMISSION_DENIED"], [404, "SHEETS_NOT_FOUND"]]);
  for (const [status, publicCode] of expected) {
    let calls = 0;
    const fake = fakeGoogle({ async onBatchGet() { calls += 1; throw statusError(status); } });
    await assert.rejects(adapterFor(fake).readCctvSheet(), (error) => {
      assert.equal(classifyError(error).publicCode, publicCode);
      assert.equal(error.message.includes("Google secret"), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("request timeout aborts a never-settling request", async () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.setTimeout = (callback) => originalSetTimeout(callback, 0);
  global.clearTimeout = (timer) => originalClearTimeout(timer);
  let signal;
  try {
    const fake = fakeGoogle({ onBatchGet(_params, options) { signal = options.signal; return new Promise(() => {}); } });
    await assert.rejects(adapterFor(fake).readCctvSheet(), (error) => classifyError(error).publicCode === "SHEETS_TIMEOUT");
    assert.equal(signal.aborted, true);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("direct client and reader imports expose no client, configuration, or request function", () => {
  for (const moduleName of ["client", "reader"]) {
    const exposed = require(`../../src/sheets/${moduleName}`);
    assert.deepEqual(Object.keys(exposed), []);
    assert.equal(Object.isFrozen(exposed), true);
  }
});

test("throwing error proxy traps cannot escape trusted classification", async () => {
  const trapNames = ["getOwnPropertyDescriptor", "ownKeys", "getPrototypeOf", "get"];
  for (const trapName of trapNames) {
    const response = new Proxy({}, {
      [trapName]() { throw new Error(`raw ${trapName} secret`); },
    });
    const error = {};
    Object.defineProperty(error, "response", { value: response });
    const fake = fakeGoogle({ async onBatchGet() { throw error; } });
    await assert.rejects(adapterFor(fake).readCctvSheet(), (caught) => {
      assert.equal(classifyError(caught).publicCode, "MALFORMED_SHEETS_RESPONSE");
      assert.equal(caught.message.includes("secret"), false);
      assert.equal(String(caught.stack).includes("secret"), false);
      return true;
    });
  }
});

test("PR3 source contains only batchGet and no write-capable Google surface", () => {
  const source = ["adapter.js", "bounded-await.js", "client.js", "configuration.js", "credentials.js", "index.js", "reader.js", "row-validation.js", "structure.js"]
    .map((file) => readFileSync(require.resolve(`../../src/sheets/${file}`), "utf8")).join("\n");
  assert.doesNotMatch(source, /values\.(?:append|update|batchUpdate|clear)|spreadsheets\.batchUpdate|google\.drive|Apps Script/i);
  assert.match(source, /values\.batchGet/);
});
