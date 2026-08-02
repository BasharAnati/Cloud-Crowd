"use strict";

const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const Module = require("node:module");
const path = require("node:path");
const { OutputInternalConsistencyError } = require("../../../src/errors");
const { fakeGoogle } = require("../../sheets/helpers");
const {
  FakeClient,
  google: successfulGoogle,
  safeEnvironment,
} = require("../../output/fixtures/genuine-output");

const scenario = process.argv[2];
const directory = process.argv[3];
if (!scenario || !directory) throw new Error("scenario and disposable directory are required");

class CaptureStream extends EventEmitter {
  constructor() { super(); this.chunks = []; this.writes = 0; }
  write(chunk, callback) {
    this.writes += 1;
    this.chunks.push(Buffer.from(chunk));
    queueMicrotask(() => callback && callback());
    return true;
  }
  text() { return Buffer.concat(this.chunks).toString("utf8"); }
}

let ticketReads = 0;
class ScenarioClient extends FakeClient {
  async query(query) {
    if (query.text.includes("FROM public.tickets")) {
      ticketReads += 1;
      if (scenario === "database") throw new Error("DATABASE_FAILURE_STACK_CAUSE_CANARY");
    }
    return super.query(query);
  }
}

const permissionError = new Error("SHEETS_PERMISSION_STACK_CAUSE_CANARY");
permissionError.response = { status: 403 };
const failingGoogle = fakeGoogle({ onBatchGet: async () => { throw permissionError; } });
const selectedGoogle = scenario === "sheets" ? failingGoogle : successfulGoogle;

async function run() {
  const originalLoad = Module._load;
  const originalLink = fs.link;
  const originalUnlink = fs.unlink;
  const cachePaths = ["../../../src/cli", "../../../src/cli/adapter", "../../../src/cli/audit-command",
    "../../../src/output", "../../../src/output/adapter", "../../../src/output/markdown"]
    .map((value) => require.resolve(value));
  const priorCache = new Map(cachePaths.map((modulePath) => [modulePath, require.cache[modulePath]]));
  const environmentValues = { ...safeEnvironment(), FAILURE_ENVIRONMENT_CANARY: "ENVIRONMENT_SECRET_CANARY" };
  const priorEnvironment = new Map(Object.keys(environmentValues).map((key) => [key, {
    present: Object.hasOwn(process.env, key),
    value: process.env[key],
  }]));
  let outputPath = path.join(directory, "audit.md");
  let logicalExit = null;
  let result;
  try {
    Object.assign(process.env, environmentValues);
    if (scenario === "configuration") delete process.env.AUDIT_TARGET;
    if (scenario === "missing-parent") outputPath = path.join(directory, "MISSING_PATH_CANARY", "audit.md");
    if (scenario === "extension") outputPath = path.join(directory, "PATH_EXTENSION_CANARY.html");
    if (scenario === "directory") await fs.mkdir(outputPath);
    if (scenario === "existing") await fs.writeFile(outputPath, "EXISTING_DESTINATION_CANARY", { flag: "wx" });
    if (scenario === "symlink-parent") {
      const realParent = path.join(directory, "real-parent");
      const linkedParent = path.join(directory, "linked-parent");
      await fs.mkdir(realParent);
      try { await fs.symlink(realParent, linkedParent, process.platform === "win32" ? "junction" : "dir"); }
      catch (error) {
        if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return { skipped: true, skipReason: "symlink unavailable" };
        throw error;
      }
      outputPath = path.join(linkedParent, "audit.md");
    }

    Module._load = function fakeExternalDrivers(request, parent, isMain) {
      if (request === "pg") return { Client: ScenarioClient };
      if (request === "googleapis") return { google: selectedGoogle.factory() };
      return originalLoad.call(this, request, parent, isMain);
    };
    if (scenario === "render") {
      for (const modulePath of cachePaths) delete require.cache[modulePath];
      const markdownPath = require.resolve("../../../src/output/markdown");
      require.cache[markdownPath] = {
        id: markdownPath,
        filename: markdownPath,
        loaded: true,
        exports: Object.freeze({ renderMarkdown: Object.freeze(function renderMarkdown() {
          throw new OutputInternalConsistencyError("MALFORMED_RENDER_VALUE_CANARY");
        }) }),
      };
    }
    if (scenario === "write") {
      fs.link = async () => {
        const error = new Error("FILESYSTEM_LINK_PATH_ERRNO_CANARY");
        error.code = "ENOTSUP";
        throw error;
      };
    }
    if (scenario === "cleanup") {
      fs.unlink = async (target) => {
        if (path.basename(target).startsWith(".cloud-crowd-audit-")) {
          throw new Error("FILESYSTEM_CLEANUP_TEMP_PATH_CANARY");
        }
        return originalUnlink(target);
      };
    }

    const { run: runCli } = require("../../../src/cli");
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    const args = scenario === "usage" ? ["audit"] :
      ["audit", "--format", "markdown", "--output", outputPath];
    logicalExit = await runCli({ args, env: process.env, version: "1.0.0", stdout, stderr });
    const entries = await fs.readdir(directory);
    const temporary = entries.filter((name) => name.startsWith(".cloud-crowd-audit-") && name.endsWith(".tmp"));
    let destinationState = "absent";
    try {
      const stat = await fs.lstat(outputPath);
      destinationState = stat.isDirectory() ? "directory" : await fs.readFile(outputPath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    result = {
      scenario,
      logicalExit,
      stdout: stdout.text(),
      stdoutWrites: stdout.writes,
      stderr: stderr.text(),
      stderrWrites: stderr.writes,
      ticketReads,
      sheetsRequests: selectedGoogle.state.requests.length,
      temporary,
      destinationState,
    };
  } finally {
    Module._load = originalLoad;
    fs.link = originalLink;
    fs.unlink = originalUnlink;
    for (const [modulePath, cached] of priorCache) {
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
    for (const [key, prior] of priorEnvironment) {
      if (prior.present) process.env[key] = prior.value;
      else delete process.env[key];
    }
    if (scenario === "cleanup") {
      for (const name of await fs.readdir(directory)) {
        if (name.startsWith(".cloud-crowd-audit-") && name.endsWith(".tmp")) {
          await originalUnlink(path.join(directory, name)).catch(() => {});
        }
      }
    }
  }
  return result;
}

run().then((value) => {
  if (value && value.skipped) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exitCode = value.logicalExit;
}, (error) => {
  process.stderr.write("FIXTURE_INTERNAL_FAILURE\n");
  process.exitCode = 99;
});
