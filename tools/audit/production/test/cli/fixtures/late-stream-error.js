"use strict";

const { EventEmitter } = require("node:events");
const { classifyError } = require("../../../src/errors");
const {
  writeArtifactToStdout,
  writeHelpToStdout,
  writePublicErrorToStderr,
} = require("../../../src/cli/stdout");
const { genuineArtifact } = require("../helpers");

const scenario = process.argv[2];
const epipe = scenario === "epipe" || scenario === "cli-epipe";
const cliScenario = scenario === "cli-epipe" || scenario === "cli-write";
const cleanScenario = scenario === "clean";
const delay = Number(process.argv[3] || 0);

class LateErrorStream extends EventEmitter {
  constructor() {
    super();
    this.chunks = [];
    this.errorEmitted = false;
    this.settledBeforeError = null;
    this.settlementProbe = () => false;
    this.writes = 0;
  }

  write(chunk, callback) {
    this.writes += 1;
    this.chunks.push(Buffer.from(chunk));
    const currentWrite = this.writes;
    queueMicrotask(() => callback && callback());
    if (currentWrite === 1 && !cleanScenario) {
      const emitFailure = () => {
        this.errorEmitted = true;
        this.settledBeforeError = this.settlementProbe();
        const first = new Error("FIRST_STREAM_CANARY");
        if (epipe) first.code = "EPIPE";
        this.emit("error", first);
        if (!cliScenario) {
          const duplicate = new Error("LATE_STREAM_CANARY");
          if (epipe) duplicate.code = "EPIPE";
          this.emit("error", duplicate);
        }
      };
      if (cliScenario) setTimeout(emitFailure, delay);
      else queueMicrotask(emitFailure);
    }
    return true;
  }

  content() { return Buffer.concat(this.chunks); }
}

class CaptureStream extends EventEmitter {
  constructor() {
    super();
    this.chunks = [];
    this.writes = 0;
  }

  write(chunk, callback) {
    this.writes += 1;
    this.chunks.push(Buffer.from(chunk));
    queueMicrotask(() => callback && callback());
    return true;
  }

  text() { return Buffer.concat(this.chunks).toString("utf8"); }
}

async function runDirectScenario() {
  const stream = new LateErrorStream();
  try {
    await writeHelpToStdout(stream, "global");
    throw new Error("late error unexpectedly succeeded");
  } catch (error) {
    return { classification: classifyError(error), errorListeners: stream.listenerCount("error") };
  }
}

async function runArtifactScenario() {
  const artifact = await genuineArtifact("json");
  const stdout = new LateErrorStream();
  const stderr = new CaptureStream();
  let settled = false;
  stdout.settlementProbe = () => settled;
  const started = process.hrtime.bigint();
  let failure = null;
  let classification = null;
  try {
    await writeArtifactToStdout(stdout, artifact);
  } catch (error) {
    failure = error;
    classification = classifyError(error);
  } finally {
    settled = true;
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  if (failure) await writePublicErrorToStderr(stderr, failure);
  return {
    exitCode: classification ? classification.exitCode : 0,
    stderr: stderr.text(),
    stderrWrites: stderr.writes,
    stdoutWrites: stdout.writes,
    errorEmitted: stdout.errorEmitted,
    settledBeforeError: stdout.settledBeforeError,
    elapsedMs,
    exactBytes: stdout.content().equals(Buffer.from(artifact.content, "utf8")),
    errorListeners: stdout.listenerCount("error"),
    closeListeners: stdout.listenerCount("close"),
    drainListeners: stdout.listenerCount("drain"),
  };
}

(cliScenario || cleanScenario ? runArtifactScenario() : runDirectScenario()).then(
  (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
  () => {
  process.exitCode = 1;
  }
);
