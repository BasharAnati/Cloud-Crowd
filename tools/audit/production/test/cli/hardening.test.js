"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { classifyError, CliBrokenPipeError } = require("../../src/errors");
const { verifyTrustedOutputArtifact } = require("../../src/output/artifact");
const stdoutOperations = require("../../src/cli/stdout");
const { CaptureStream, genuineArtifact } = require("./helpers");

class ControlledStream extends EventEmitter {
  constructor({ accepted = true, throwError = null } = {}) {
    super();
    this.accepted = accepted;
    this.throwError = throwError;
    this.callback = null;
    this.writes = 0;
  }

  write(_chunk, callback) {
    this.writes += 1;
    if (this.throwError) throw this.throwError;
    this.callback = callback;
    return this.accepted;
  }
}

function fixedCode(expected) {
  return (error) => {
    assert.equal(classifyError(error).publicCode, expected);
    assert.equal(classifyError(error).exitCode, 12);
    return true;
  };
}

test("CLI exports expose no general-purpose text or Buffer mutation operation", async () => {
  assert.deepEqual(Object.keys(stdoutOperations), [
    "writeArtifactToStdout",
    "writeHelpToStdout",
    "writePreflightToStdout",
    "writePublicErrorToStderr",
    "writeVersionToStdout",
  ]);
  for (const forbidden of ["writeText", "writeRaw", "writeBuffer", "writeString", "createWriter"]) {
    assert.equal(typeof stdoutOperations[forbidden], "undefined");
  }
  const modules = ["adapter", "atomic-write", "audit-command", "help", "parser", "path-policy", "stdout"]
    .map((name) => require(`../../src/cli/${name}`));
  for (const exported of modules) {
    assert.equal(Object.isFrozen(exported), true);
    for (const [name, value] of Object.entries(exported)) {
      if (typeof value === "function") assert.equal(Object.isFrozen(value), true, name);
      assert.doesNotMatch(name, /(?:raw|register|registrar|mint|factory|token|writeText|writeBuffer)/iu);
    }
  }

  const canary = "ARBITRARY_SECRET_CANARY";
  for (const value of [canary, Buffer.from(canary), Object.freeze({ content: canary })]) {
    const stream = new CaptureStream();
    await assert.rejects(stdoutOperations.writeArtifactToStdout(stream, value), fixedCode("CLI_INTERNAL_FAILURE"));
    assert.equal(stream.writes, 0);
  }
  await assert.rejects(stdoutOperations.writeVersionToStdout(new CaptureStream(), canary),
    fixedCode("CLI_INTERNAL_FAILURE"));
});

test("artifact-only stdout accepts genuine JSON, Markdown, and HTML artifacts", async () => {
  for (const format of ["json", "markdown", "html"]) {
    const artifact = await genuineArtifact(format);
    const stream = new CaptureStream();
    await stdoutOperations.writeArtifactToStdout(stream, artifact);
    assert.equal(stream.writes, 1);
    assert.deepEqual(stream.content(), Buffer.from(artifact.content, "utf8"));
    assert.equal(verifyTrustedOutputArtifact(artifact), artifact);
  }
});

test("requiring the binary is inert for help and audit arguments", () => {
  const fixture = path.join(__dirname, "fixtures", "binary-import.js");
  for (const scenario of ["help", "audit"]) {
    const result = JSON.parse(execFileSync(process.execPath, [fixture, scenario], {
      cwd: path.join(__dirname, "../.."), encoding: "utf8", timeout: 10_000, windowsHide: true,
    }));
    assert.deepEqual(result, {
      environmentReads: 0,
      filesystemCalls: 0,
      randomCalls: 0,
      sourceLoads: 0,
      timers: 0,
      stdoutBytes: 0,
      stderrBytes: 0,
      exitCodeUnchanged: true,
    });
  }
});

test("direct binary execution preserves help, version, preflight, and genuine audit behavior", () => {
  const root = path.join(__dirname, "../../../../..");
  const binary = path.join(root, "tools/audit/production/bin/cloud-crowd-audit.js");
  const packageVersion = require(path.join(root, "package.json")).version;
  const help = spawnSync(process.execPath, [binary, "--help"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.deepEqual({ status: help.status, stderr: help.stderr }, { status: 0, stderr: "" });
  assert.match(help.stdout, /^Cloud Crowd Production Audit Tool\n/u);
  const version = spawnSync(process.execPath, [binary, "--version"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.deepEqual({ status: version.status, stdout: version.stdout, stderr: version.stderr },
    { status: 0, stdout: `${packageVersion}\n`, stderr: "" });
  const env = { ...process.env, AUDIT_TARGET: "production", AUDIT_MODE: "read-only",
    AUDIT_PRODUCTION_ACKNOWLEDGED: "true", AUDIT_ALLOW_WRITES: "false" };
  const preflight = spawnSync(process.execPath, [binary, "preflight"], { cwd: root, env, encoding: "utf8", windowsHide: true });
  assert.deepEqual({ status: preflight.status, stderr: preflight.stderr }, { status: 0, stderr: "" });
  assert.equal(preflight.stdout,
    "Production audit preflight passed\nTarget: production\nMode: read-only\nWrites allowed: false\n");

  const preload = path.join(__dirname, "fixtures", "fake-drivers-preload.js");
  const audit = spawnSync(process.execPath, ["-r", preload, binary, "audit", "--format", "json", "--stdout"],
    { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.deepEqual({ status: audit.status, stderr: audit.stderr }, { status: 0, stderr: "" });
  assert.equal(JSON.parse(audit.stdout).outputType, "cloud-crowd-audit");
});

test("stream settlement handles callback and drain in either order and removes bounded guards", async () => {
  const artifact = await genuineArtifact("json");
  for (const order of ["callback-first", "drain-first"]) {
    const stream = new ControlledStream({ accepted: false });
    const writing = stdoutOperations.writeArtifactToStdout(stream, artifact);
    if (order === "callback-first") {
      stream.callback();
      stream.emit("drain");
    } else {
      stream.emit("drain");
      stream.callback();
    }
    await writing;
    assert.equal(stream.writes, 1);
    assert.equal(stream.listenerCount("error"), 0);
    assert.equal(stream.listenerCount("close"), 0);
    stream.emit("drain");
    stream.emit("close");
    stream.callback();
  }
});

test("first, duplicate, and late EPIPE remain one contained trusted failure", async () => {
  const artifact = await genuineArtifact("json");
  for (const late of [false, true]) {
    const stream = new ControlledStream();
    const writing = stdoutOperations.writeArtifactToStdout(stream, artifact);
    const first = Object.assign(new Error("FIRST_PIPE_CANARY"), { code: "EPIPE" });
    if (late) {
      stream.callback();
      queueMicrotask(() => {
        stream.emit("error", first);
        stream.emit("error", Object.assign(new Error("LATE_PIPE_CANARY"), { code: "EPIPE" }));
      });
    } else {
      stream.emit("error", first);
      stream.emit("error", Object.assign(new Error("DUPLICATE_PIPE_CANARY"), { code: "EPIPE" }));
    }
    await assert.rejects(writing, fixedCode("CLI_BROKEN_PIPE"));
    assert.equal(stream.writes, 1);
    assert.equal(stream.listenerCount("error"), 0);
  }
});

test("late duplicate stream errors are contained in isolated child processes without raw stderr", () => {
  const fixture = path.join(__dirname, "fixtures", "late-stream-error.js");
  for (const [scenario, publicCode] of [["epipe", "CLI_BROKEN_PIPE"], ["write", "CLI_WRITE_FAILURE"]]) {
    const child = spawnSync(process.execPath, [fixture, scenario], {
      cwd: path.join(__dirname, "../.."), encoding: "utf8", timeout: 10_000, windowsHide: true,
    });
    assert.deepEqual({ status: child.status, stderr: child.stderr }, { status: 0, stderr: "" });
    assert.deepEqual(JSON.parse(child.stdout), {
      classification: {
        publicCode,
        publicMessage: publicCode === "CLI_BROKEN_PIPE"
          ? "Audit output stream was closed" : "Audit output could not be written",
        exitCode: 12,
      },
      errorListeners: 0,
    });
    assert.equal(child.stdout.includes("STREAM_CANARY"), false);
  }
});

test("delayed artifact stream errors remain classified with one diagnostic and no listeners", () => {
  const fixture = path.join(__dirname, "fixtures", "late-stream-error.js");
  for (const delay of [5, 25, 100, 150, 500, 900, 950, 990]) {
    for (const [scenario, publicCode, publicMessage] of [
      ["cli-epipe", "CLI_BROKEN_PIPE", "Audit output stream was closed"],
      ["cli-write", "CLI_WRITE_FAILURE", "Audit output could not be written"],
    ]) {
      const child = spawnSync(process.execPath, [fixture, scenario, String(delay)], {
        cwd: path.join(__dirname, "../.."), encoding: "utf8", timeout: 10_000, windowsHide: true,
      });
      assert.deepEqual({ status: child.status, stderr: child.stderr }, { status: 0, stderr: "" }, `${scenario}:${delay}`);
      const result = JSON.parse(child.stdout);
      assert.deepEqual({ ...result, elapsedMs: 0 }, {
        exitCode: 12,
        stderr: `ERROR [${publicCode}]: ${publicMessage}\n`,
        stderrWrites: 1,
        stdoutWrites: 1,
        errorEmitted: true,
        settledBeforeError: false,
        elapsedMs: 0,
        exactBytes: true,
        errorListeners: 0,
        closeListeners: 0,
        drainListeners: 0,
      });
      assert.equal(result.elapsedMs >= 900, true, `${scenario}:${delay}:${result.elapsedMs}`);
      assert.equal(child.stdout.includes("STREAM_CANARY"), false);
    }
  }
});

test("clean success waits for the complete observation boundary and removes all listeners", () => {
  const fixture = path.join(__dirname, "fixtures", "late-stream-error.js");
  const child = spawnSync(process.execPath, [fixture, "clean"], {
    cwd: path.join(__dirname, "../.."), encoding: "utf8", timeout: 10_000, windowsHide: true,
  });
  assert.deepEqual({ status: child.status, stderr: child.stderr }, { status: 0, stderr: "" });
  const result = JSON.parse(child.stdout);
  assert.deepEqual({ ...result, elapsedMs: 0 }, {
    exitCode: 0,
    stderr: "",
    stderrWrites: 0,
    stdoutWrites: 1,
    errorEmitted: false,
    settledBeforeError: null,
    elapsedMs: 0,
    exactBytes: true,
    errorListeners: 0,
    closeListeners: 0,
    drainListeners: 0,
  });
  assert.equal(result.elapsedMs >= 900, true, result.elapsedMs);
});

test("the same stream starts independent lifecycle state after success or failure", async () => {
  const artifact = await genuineArtifact("json");
  async function run(firstFails) {
    const stream = new ControlledStream();
    const first = stdoutOperations.writeArtifactToStdout(stream, artifact);
    stream.callback();
    if (firstFails) stream.emit("error", new Error("FIRST_OPERATION_CANARY"));
    if (firstFails) await assert.rejects(first, fixedCode("CLI_WRITE_FAILURE"));
    else await first;
    assert.equal(stream.listenerCount("error"), 0);
    assert.equal(stream.listenerCount("close"), 0);

    const second = stdoutOperations.writeArtifactToStdout(stream, artifact);
    stream.callback();
    await second;
    assert.equal(stream.writes, 2);
    assert.equal(stream.listenerCount("error"), 0);
    assert.equal(stream.listenerCount("close"), 0);
    assert.equal(stream.listenerCount("drain"), 0);
  }
  await Promise.all([run(false), run(true)]);
});

test("repeated terminal activity cannot keep a stream write pending indefinitely", async () => {
  const artifact = await genuineArtifact("json");
  const stream = new ControlledStream();
  const writing = stdoutOperations.writeArtifactToStdout(stream, artifact);
  stream.callback();
  const interval = setInterval(() => stream.emit("close"), 50);
  const stop = setTimeout(() => clearInterval(interval), 950);
  try {
    await assert.rejects(writing, fixedCode("CLI_WRITE_FAILURE"));
  } finally {
    clearTimeout(stop);
    clearInterval(interval);
  }
  assert.equal(stream.writes, 1);
  assert.equal(stream.listenerCount("error"), 0);
  assert.equal(stream.listenerCount("close"), 0);
});

test("callback, drain, close, and error races retain exactly one terminal result", async () => {
  const artifact = await genuineArtifact("json");
  async function execute({ accepted = true, act, expected = null }) {
    const stream = new ControlledStream({ accepted });
    const writing = stdoutOperations.writeArtifactToStdout(stream, artifact);
    act(stream);
    if (expected) await assert.rejects(writing, fixedCode(expected));
    else await writing;
    stream.callback();
    stream.emit("drain");
    assert.equal(stream.writes, 1);
    assert.equal(stream.listenerCount("error"), 0);
    assert.equal(stream.listenerCount("close"), 0);
    assert.equal(stream.listenerCount("drain"), 0);
  }
  await Promise.all([
    execute({ act(stream) { stream.callback(); stream.callback(); } }),
    execute({ accepted: false, act(stream) { stream.emit("drain"); stream.emit("drain"); stream.callback(); } }),
    execute({ expected: "CLI_WRITE_FAILURE", act(stream) {
      stream.callback(); stream.emit("close"); stream.emit("error", new Error("CLOSE_THEN_ERROR_CANARY"));
    } }),
    execute({ expected: "CLI_WRITE_FAILURE", act(stream) {
      stream.emit("error", new Error("ERROR_THEN_CLOSE_CANARY")); stream.emit("close"); stream.callback();
    } }),
    execute({ expected: "CLI_BROKEN_PIPE", act(stream) {
      const error = Object.assign(new Error("DUPLICATE_EPIPE_CANARY"), { code: "EPIPE" });
      stream.callback(); stream.emit("error", error); stream.emit("error", error);
    } }),
    execute({ expected: "CLI_WRITE_FAILURE", act(stream) {
      const error = new Error("DUPLICATE_WRITE_CANARY");
      stream.emit("error", error); stream.emit("error", error); stream.callback();
    } }),
  ]);
});

test("non-EPIPE errors, close, callback errors, hostile callbacks, and synchronous throws are contained", async () => {
  const artifact = await genuineArtifact("json");
  const scenarios = [
    (stream) => { stream.emit("error", new Error("FIRST_CANARY")); stream.emit("error", new Error("SECOND_CANARY")); },
    (stream) => { stream.emit("close"); stream.emit("close"); },
    (stream) => { stream.callback(new Error("CALLBACK_CANARY")); stream.callback(new Error("LATE_CALLBACK_CANARY")); },
  ];
  for (const act of scenarios) {
    const stream = new ControlledStream();
    const writing = stdoutOperations.writeArtifactToStdout(stream, artifact);
    act(stream);
    await assert.rejects(writing, fixedCode("CLI_WRITE_FAILURE"));
    assert.equal(stream.writes, 1);
    assert.equal(stream.listenerCount("error"), 0);
  }
  const thrown = new ControlledStream({ throwError: new Error("THROW_CANARY") });
  await assert.rejects(stdoutOperations.writeArtifactToStdout(thrown, artifact), fixedCode("CLI_WRITE_FAILURE"));
});

test("an error after callback but before drain wins and later drain cannot change it", async () => {
  const artifact = await genuineArtifact("json");
  const stream = new ControlledStream({ accepted: false });
  const writing = stdoutOperations.writeArtifactToStdout(stream, artifact);
  stream.callback();
  stream.emit("error", new Error("BETWEEN_CANARY"));
  stream.emit("drain");
  await assert.rejects(writing, fixedCode("CLI_WRITE_FAILURE"));
  assert.equal(stream.writes, 1);
});

test("stderr failure after a primary stdout EPIPE preserves exit 12 without recursion or crash", async () => {
  const cliPath = require.resolve("../../src/cli");
  const commandPath = require.resolve("../../src/cli/audit-command");
  const priorCli = require.cache[cliPath];
  const priorCommand = require.cache[commandPath];
  const primary = new CliBrokenPipeError("FIRST_STDOUT_CANARY");
  try {
    delete require.cache[cliPath];
    require.cache[commandPath] = {
      id: commandPath, filename: commandPath, loaded: true,
      exports: Object.freeze({ executeAuditCommand: async () => { throw primary; } }),
    };
    const { run } = require("../../src/cli");
    const stderr = new ControlledStream();
    stderr.write = function write(_chunk, callback) {
      this.writes += 1;
      this.callback = callback;
      queueMicrotask(() => {
        this.emit("error", new Error("STDERR_CANARY"));
        this.emit("error", new Error("LATE_STDERR_CANARY"));
      });
      return true;
    };
    const exitCode = await run({ args: ["audit", "--format", "json", "--stdout"], env: {}, version: "1.0.0",
      stdout: new CaptureStream(), stderr });
    assert.equal(exitCode, 12);
    assert.equal(stderr.writes, 1);
    assert.equal(stderr.listenerCount("error"), 0);
  } finally {
    if (priorCli) require.cache[cliPath] = priorCli;
    else delete require.cache[cliPath];
    if (priorCommand) require.cache[commandPath] = priorCommand;
    else delete require.cache[commandPath];
  }
});
