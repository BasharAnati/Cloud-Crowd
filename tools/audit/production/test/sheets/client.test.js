"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyError } = require("../../src/errors");
const { createSheetsAdapter } = require("../../src/sheets");
const { fakeGoogle, safeCapability, sheetsEnvironment } = require("./helpers");

const READ_ONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

test("client construction uses exactly the read-only scope without exporting authenticated clients", async () => {
  const fake = fakeGoogle();
  await createSheetsAdapter({ safety: safeCapability(), env: sheetsEnvironment(), googleFactory: fake.factory }).readCctvSheet();
  assert.deepEqual(fake.state.jwtConfigurations[0].scopes, [READ_ONLY_SCOPE]);
  const exposed = require("../../src/sheets/client");
  assert.deepEqual(Object.keys(exposed), []);
  assert.equal(Object.isFrozen(exposed), true);
});

test("authorization applies a fixed transport timeout and raw failures receive a trusted classification", async () => {
  const good = fakeGoogle();
  await createSheetsAdapter({ safety: safeCapability(), env: sheetsEnvironment(), googleFactory: good.factory }).readCctvSheet();
  assert.equal(good.state.authorizations, 1);
  assert.equal(good.state.authorizationRequests[0].timeout, 10_000);
  assert.equal(good.state.authorizationRequests[0].retry, false);
  assert.equal(good.state.authorizationRequests[0].signal instanceof AbortSignal, true);
  assert.equal(good.state.authClients[0].transporter, good.state.authorizationTransporters[0]);

  const bad = fakeGoogle({ authorizeError: new Error("private credential detail") });
  await assert.rejects(
    createSheetsAdapter({ safety: safeCapability(), env: sheetsEnvironment(), googleFactory: bad.factory }).readCctvSheet(),
    (error) => classifyError(error).publicCode === "SHEETS_AUTHENTICATION_FAILURE" && !error.message.includes("credential detail")
  );
});

test("authorization timeout cancels the underlying transport request", async () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.setTimeout = (callback, delay) => originalSetTimeout(callback, delay === 10_000 ? 0 : delay);
  global.clearTimeout = (timer) => originalClearTimeout(timer);
  try {
    const fake = fakeGoogle({ authorizePending: true });
    await assert.rejects(
      createSheetsAdapter({ safety: safeCapability(), env: sheetsEnvironment(), googleFactory: fake.factory }).readCctvSheet(),
      (error) => classifyError(error).publicCode === "SHEETS_TIMEOUT"
    );
    assert.equal(fake.state.authorizationCancellations, 1);
    assert.equal(fake.state.authorizationRequests[0].signal.aborted, true);
    assert.equal(fake.state.authClients[0].transporter, fake.state.authorizationTransporters[0]);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("invalid injected Google factories fail safely", async () => {
  await assert.rejects(
    createSheetsAdapter({ safety: safeCapability(), env: sheetsEnvironment(), googleFactory: () => ({}) }).readCctvSheet(),
    (error) => classifyError(error).publicCode === "SHEETS_AUTHENTICATION_FAILURE"
  );
});
