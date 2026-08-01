"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
const test = require("node:test");

test("report import performs no environment, source, output, timer, time, random, or hash operation", () => {
  for (const name of ["index", "adapter", "validation", "model", "grouping", "policy"])
    delete require.cache[require.resolve(`../../src/report/${name}`)];
  const originalLoad = Module._load;
  const originalCreateHash = crypto.createHash;
  const originalDateNow = Date.now;
  const originalRandom = Math.random;
  const originalSetTimeout = global.setTimeout;
  const originalSetInterval = global.setInterval;
  const originalEnv = process.env;
  const originalConsole = { ...console };
  const beforeProcess = { exitCode: process.exitCode, title: process.title, cwd: process.cwd() };
  let environmentReads = 0;
  let hashes = 0;
  let output = 0;
  let timers = 0;
  let timeReads = 0;
  let randomReads = 0;
  const forbiddenLoads = new Set(["pg", "googleapis", "node:fs", "fs", "node:net", "net", "node:http", "http", "node:https", "https"]);
  let imported;
  try {
    Module._load = function instrumentedLoad(request, parent, isMain) {
      if (forbiddenLoads.has(request)) throw new Error(`forbidden import: ${request}`);
      return originalLoad.call(this, request, parent, isMain);
    };
    crypto.createHash = function instrumentedHash(...args) { hashes += 1; return originalCreateHash.apply(this, args); };
    Date.now = function instrumentedNow() { timeReads += 1; return originalDateNow(); };
    Math.random = function instrumentedRandom() { randomReads += 1; return originalRandom(); };
    global.setTimeout = function instrumentedTimeout() { timers += 1; throw new Error("timer created"); };
    global.setInterval = function instrumentedInterval() { timers += 1; throw new Error("timer created"); };
    process.env = new Proxy(originalEnv, { get(target, property, receiver) {
      environmentReads += 1;
      return Reflect.get(target, property, receiver);
    } });
    for (const method of ["log", "info", "warn", "error", "debug"]) console[method] = () => { output += 1; };
    imported = require("../../src/report");
  } finally {
    Module._load = originalLoad;
    crypto.createHash = originalCreateHash;
    Date.now = originalDateNow;
    Math.random = originalRandom;
    global.setTimeout = originalSetTimeout;
    global.setInterval = originalSetInterval;
    process.env = originalEnv;
    Object.assign(console, originalConsole);
  }
  assert.deepEqual({ environmentReads, hashes, output, timers, timeReads, randomReads }, {
    environmentReads: 0, hashes: 0, output: 0, timers: 0, timeReads: 0, randomReads: 0,
  });
  assert.deepEqual({ exitCode: process.exitCode, title: process.title, cwd: process.cwd() }, beforeProcess);
  assert.deepEqual(Object.keys(imported), ["buildAuditReport"]);
});
