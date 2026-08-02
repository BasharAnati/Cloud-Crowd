"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const test = require("node:test");

test("PR9 imports perform no environment, filesystem, source, output, time, random, or process operation", () => {
  const names = ["help", "parser", "stdout", "adapter", "path-policy", "atomic-write", "audit-command"];
  const paths = [require.resolve("../../src/cli"), ...names.map((name) => require.resolve(`../../src/cli/${name}`))];
  const prior = paths.map((modulePath) => [modulePath, require.cache[modulePath]]);
  for (const modulePath of paths) delete require.cache[modulePath];
  const originalEnv = process.env;
  const originalRandomBytes = crypto.randomBytes;
  const originalDateNow = Date.now;
  const originalFs = Object.fromEntries(["open", "lstat", "realpath", "link", "unlink"].map((name) => [name, fs[name]]));
  const before = { exitCode: process.exitCode, cwd: process.cwd(), title: process.title };
  let environmentReads = 0;
  let filesystemCalls = 0;
  let randomCalls = 0;
  let timeCalls = 0;
  let imported;
  try {
    process.env = new Proxy(originalEnv, { get(target, property, receiver) {
      environmentReads += 1;
      return Reflect.get(target, property, receiver);
    } });
    crypto.randomBytes = function forbiddenRandom() { randomCalls += 1; throw new Error("random at import"); };
    Date.now = function forbiddenTime() { timeCalls += 1; throw new Error("time at import"); };
    for (const name of Object.keys(originalFs)) fs[name] = async function forbiddenFs() {
      filesystemCalls += 1;
      throw new Error("filesystem at import");
    };
    imported = require("../../src/cli");
    for (const name of names) require(`../../src/cli/${name}`);
  } finally {
    process.env = originalEnv;
    crypto.randomBytes = originalRandomBytes;
    Date.now = originalDateNow;
    Object.assign(fs, originalFs);
    for (const [modulePath, cached] of prior) {
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  }
  assert.deepEqual({ environmentReads, filesystemCalls, randomCalls, timeCalls }, {
    environmentReads: 0, filesystemCalls: 0, randomCalls: 0, timeCalls: 0,
  });
  assert.deepEqual({ exitCode: process.exitCode, cwd: process.cwd(), title: process.title }, before);
  assert.deepEqual(Object.keys(imported), ["HELP", "run"]);
});
