"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
const test = require("node:test");

test("output imports perform no environment, source, I/O, rendering, timer, time, random, or hash operation", () => {
  const cacheEntries = ["index", "adapter", "validation", "artifact", "policy", "json", "markdown", "html", "escaping", "writer", "size"]
    .map((name) => {
      const path = require.resolve(`../../src/output/${name}`);
      const prior = require.cache[path];
      delete require.cache[path];
      return { path, prior };
    });
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
  let outputWrites = 0;
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
    for (const method of ["log", "info", "warn", "error", "debug"]) console[method] = () => { outputWrites += 1; };
    imported = require("../../src/output");
  } finally {
    Module._load = originalLoad;
    crypto.createHash = originalCreateHash;
    Date.now = originalDateNow;
    Math.random = originalRandom;
    global.setTimeout = originalSetTimeout;
    global.setInterval = originalSetInterval;
    process.env = originalEnv;
    Object.assign(console, originalConsole);
    for (const { path, prior } of cacheEntries) {
      if (prior) require.cache[path] = prior;
      else delete require.cache[path];
    }
  }
  assert.deepEqual({ environmentReads, hashes, outputWrites, timers, timeReads, randomReads }, {
    environmentReads: 0, hashes: 0, outputWrites: 0, timers: 0, timeReads: 0, randomReads: 0,
  });
  assert.deepEqual({ exitCode: process.exitCode, title: process.title, cwd: process.cwd() }, beforeProcess);
  assert.deepEqual(Object.keys(imported), ["renderAuditOutput"]);
});
