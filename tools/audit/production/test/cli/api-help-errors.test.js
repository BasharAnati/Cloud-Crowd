"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { HELP, run } = require("../../src/cli");
const { AUDIT_HELP } = require("../../src/cli/help");
const { EXIT_CODES, classifyError } = require("../../src/errors");
const { CaptureStream } = require("./helpers");

async function invoke(args) {
  const stdout = new CaptureStream();
  const stderr = new CaptureStream();
  const exitCode = await run({ args, env: Object.create(null), version: "9.0.0", stdout, stderr });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text(), stdoutWrites: stdout.writes, stderrWrites: stderr.writes };
}

test("CLI module retains its frozen legacy API and exposes no PR9 trust boundary", () => {
  const cli = require("../../src/cli");
  assert.deepEqual(Object.keys(cli), ["HELP", "run"]);
  assert.equal(Object.isFrozen(cli), true);
  assert.equal(Object.isFrozen(run), true);
  assert.equal(typeof cli.verifyTrustedOutputArtifact, "undefined");
  assert.equal(typeof cli.writeArtifactAtomically, "undefined");
  assert.equal(typeof cli.prepareOutputPath, "undefined");
});

test("legacy help is extended only with the fixed audit command and audit help is deterministic", async () => {
  const help = await invoke(["--help"]);
  assert.deepEqual(help, { exitCode: 0, stdout: HELP, stderr: "", stdoutWrites: 1, stderrWrites: 0 });
  assert.match(HELP, /audit --format json --stdout/u);
  assert.match(HELP, /audit --format markdown --output <file>/u);
  assert.match(HELP, /audit --format html --output <file>/u);
  const auditHelp = await invoke(["audit", "--help"]);
  assert.deepEqual(auditHelp, { exitCode: 0, stdout: AUDIT_HELP, stderr: "", stdoutWrites: 1, stderrWrites: 0 });
  assert.doesNotMatch(AUDIT_HELP, /--force|overwrite mode|generated filename/iu);
  assert.match(AUDIT_HELP,
    /The destination directory and its ancestors must be controlled by a trusted operator and must not be replaced during execution\./u);
});

test("usage and PR9 failures have exact fixed stderr and exit codes", async () => {
  const usage = await invoke(["audit", "--format", "json"]);
  assert.equal(usage.exitCode, EXIT_CODES.USAGE_ERROR);
  assert.equal(usage.stdout, "");
  assert.equal(usage.stderr, "ERROR [USAGE_ERROR]: Invalid command or arguments\n");

  const pathFailure = await invoke(["audit", "--format", "html", "--output", "audit.json"]);
  assert.equal(pathFailure.exitCode, 12);
  assert.equal(pathFailure.stdout, "");
  assert.equal(pathFailure.stderr, "ERROR [CLI_PATH_FAILURE]: Audit output path is invalid\n");
  assert.equal(pathFailure.stderr.includes("audit.json"), false);
});

test("all six PR9 classifications are WeakMap trusted, fixed, sanitized, and exit 12", () => {
  const errors = require("../../src/errors");
  const expected = [
    ["CliPathError", "CLI_PATH_FAILURE", "Audit output path is invalid"],
    ["CliDestinationExistsError", "CLI_DESTINATION_EXISTS", "Audit output destination already exists"],
    ["CliWriteError", "CLI_WRITE_FAILURE", "Audit output could not be written"],
    ["CliCleanupError", "CLI_CLEANUP_FAILURE", "Audit output cleanup failed"],
    ["CliBrokenPipeError", "CLI_BROKEN_PIPE", "Audit output stream was closed"],
    ["CliInternalError", "CLI_INTERNAL_FAILURE", "Audit command failed"],
  ];
  for (const [name, publicCode, publicMessage] of expected) {
    const error = new errors[name]("RAW_PATH_SECRET_ERRNO_CANARY");
    Object.defineProperty(error, "code", { get() { throw new Error("getter canary"); } });
    Object.defineProperty(error, "exitCode", { get() { throw new Error("getter canary"); } });
    Object.defineProperty(error, "message", { value: "MUTATED_CANARY" });
    assert.deepEqual(classifyError(error), { publicCode, publicMessage, exitCode: 12 });
    assert.equal(publicMessage.includes("CANARY"), false);
  }
});

test("fixed help and internal comments state the supported trusted-parent contract without race-free claims", () => {
  assert.match(AUDIT_HELP,
    /destination directory and its ancestors must be controlled by a trusted operator/u);
  assert.doesNotMatch(AUDIT_HELP, /race-free|complete junction|hostile administrator|remount/iu);
  const atomicSource = fs.readFileSync(path.join(__dirname, "../../src/cli/atomic-write.js"), "utf8");
  const pathSource = fs.readFileSync(path.join(__dirname, "../../src/cli/path-policy.js"), "utf8");
  assert.match(atomicSource, /cannot close the interval between this check and link/u);
  assert.match(atomicSource, /Unsupported[\s\S]*fail closed/u);
  assert.match(atomicSource, /Windows ACL behavior[\s\S]*not claimed to be equivalent/u);
  assert.match(pathSource, /cannot provide native handle-relative or race-free guarantees/u);
});
