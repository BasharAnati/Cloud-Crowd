"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("importing normalization performs no environment read, timer, network, or output", () => {
  const originalEnv = process.env;
  const originalTimeout = global.setTimeout;
  const originalLog = console.log;
  let environmentReads = 0;
  let timerCalls = 0;
  let logCalls = 0;
  try {
    process.env = new Proxy(originalEnv, { get(target, property, receiver) { environmentReads += 1; return Reflect.get(target, property, receiver); } });
    global.setTimeout = (...args) => { timerCalls += 1; return originalTimeout(...args); };
    console.log = () => { logCalls += 1; };
    for (const path of ["../../src/normalize", "../../src/normalize/adapter", "../../src/normalize/canonical-record", "../../src/normalize/field-normalizers", "../../src/normalize/freeze", "../../src/normalize/validation"]) {
      delete require.cache[require.resolve(path)];
      require(path);
    }
  } finally {
    process.env = originalEnv;
    global.setTimeout = originalTimeout;
    console.log = originalLog;
  }
  assert.equal(environmentReads, 0);
  assert.equal(timerCalls, 0);
  assert.equal(logCalls, 0);
});
