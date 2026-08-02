"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const Module = require("node:module");
const path = require("node:path");

const scenario = process.argv[2] === "audit" ? "audit" : "help";
const binary = path.resolve(__dirname, "../../../bin/cloud-crowd-audit.js");
const original = {
  argv: process.argv,
  env: process.env,
  exitCode: process.exitCode,
  load: Module._load,
  randomBytes: crypto.randomBytes,
  setImmediate: global.setImmediate,
  stdoutWrite: process.stdout.write,
  stderrWrite: process.stderr.write,
  fs: Object.fromEntries(["open", "lstat", "realpath", "link", "unlink"].map((name) => [name, fs[name]])),
};
const state = { environmentReads: 0, filesystemCalls: 0, randomCalls: 0, sourceLoads: 0, timers: 0,
  stdoutBytes: 0, stderrBytes: 0 };
let observedExitCode;

try {
  process.argv = [process.execPath, binary, ...(scenario === "audit"
    ? ["audit", "--format", "json", "--stdout"] : ["--help"])];
  process.env = new Proxy(original.env, { get(target, property, receiver) {
    state.environmentReads += 1;
    return Reflect.get(target, property, receiver);
  } });
  Module._load = function guardedLoad(request, parent, isMain) {
    if (request === "pg" || request === "googleapis") {
      state.sourceLoads += 1;
      throw new Error("source driver loaded during binary import");
    }
    return original.load.call(this, request, parent, isMain);
  };
  crypto.randomBytes = function forbiddenRandom() { state.randomCalls += 1; throw new Error("random during import"); };
  global.setImmediate = function forbiddenImmediate() { state.timers += 1; throw new Error("timer during import"); };
  for (const name of Object.keys(original.fs)) fs[name] = async function forbiddenFilesystem() {
    state.filesystemCalls += 1;
    throw new Error("filesystem during import");
  };
  process.stdout.write = function captureStdout(chunk) { state.stdoutBytes += Buffer.byteLength(String(chunk)); return true; };
  process.stderr.write = function captureStderr(chunk) { state.stderrBytes += Buffer.byteLength(String(chunk)); return true; };
  require(binary);
  observedExitCode = process.exitCode;
} finally {
  process.argv = original.argv;
  process.env = original.env;
  process.exitCode = original.exitCode;
  Module._load = original.load;
  crypto.randomBytes = original.randomBytes;
  global.setImmediate = original.setImmediate;
  process.stdout.write = original.stdoutWrite;
  process.stderr.write = original.stderrWrite;
  Object.assign(fs, original.fs);
}

process.stdout.write(`${JSON.stringify({ ...state, exitCodeUnchanged: observedExitCode === original.exitCode })}\n`);
