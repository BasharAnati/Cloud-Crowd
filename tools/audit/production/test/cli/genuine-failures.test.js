"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { withTemporaryDirectory } = require("./helpers");

const EXPECTED = Object.freeze({
  usage: [2, "ERROR [USAGE_ERROR]: Invalid command or arguments\n"],
  configuration: [3, "ERROR [CONFIGURATION_ERROR]: Invalid production audit configuration\n"],
  database: [5, "ERROR [DATABASE_QUERY_FAILURE]: Audit database read failed\n"],
  sheets: [6, "ERROR [SHEETS_PERMISSION_DENIED]: Audit Sheets access was denied\n"],
  render: [11, "ERROR [OUTPUT_INTERNAL_CONSISTENCY_FAILURE]: Audit output consistency verification failed\n"],
  "missing-parent": [12, "ERROR [CLI_PATH_FAILURE]: Audit output path is invalid\n"],
  extension: [12, "ERROR [CLI_PATH_FAILURE]: Audit output path is invalid\n"],
  directory: [12, "ERROR [CLI_DESTINATION_EXISTS]: Audit output destination already exists\n"],
  existing: [12, "ERROR [CLI_DESTINATION_EXISTS]: Audit output destination already exists\n"],
  "symlink-parent": [12, "ERROR [CLI_PATH_FAILURE]: Audit output path is invalid\n"],
  write: [12, "ERROR [CLI_WRITE_FAILURE]: Audit output could not be written\n"],
  cleanup: [12, "ERROR [CLI_CLEANUP_FAILURE]: Audit output cleanup failed\n"],
  success: [0, ""],
});

function runScenario(fixture, scenario, directory) {
  const child = spawnSync(process.execPath, [fixture, scenario, directory], {
    cwd: path.join(__dirname, "../.."), encoding: "utf8", timeout: 30_000, windowsHide: true,
  });
  assert.equal(child.stderr, "", scenario);
  const result = JSON.parse(child.stdout);
  if (result.skipped) return { child, result };
  assert.equal(child.status, EXPECTED[scenario][0], scenario);
  assert.equal(result.logicalExit, EXPECTED[scenario][0], scenario);
  assert.equal(result.stderr, EXPECTED[scenario][1], scenario);
  assert.equal(result.stderrWrites, scenario === "success" ? 0 : 1, scenario);
  assert.equal(result.stdout, "", scenario);
  assert.equal(result.stdoutWrites, 0, scenario);
  for (const canary of ["CANARY", "MISSING_PATH", "PATH_EXTENSION", directory]) {
    assert.equal(result.stderr.includes(canary), false, `${scenario}: ${canary}`);
  }
  return { child, result };
}

test("genuine PR1, PR2, PR3, and PR8 failures preserve exact child exits and leave no output", async () => {
  const fixture = path.join(__dirname, "fixtures", "genuine-failure.js");
  for (const scenario of ["configuration", "database", "sheets", "render"]) {
    await withTemporaryDirectory(async (directory) => {
      const { result } = runScenario(fixture, scenario, directory);
      assert.equal(result.destinationState, "absent", scenario);
      assert.deepEqual(result.temporary, [], scenario);
      if (scenario === "database") assert.equal(result.ticketReads, 1);
      if (scenario === "sheets") {
        assert.equal(result.ticketReads, 1);
        assert.equal(result.sheetsRequests, 1);
      }
      assert.deepEqual(await require("node:fs/promises").readdir(directory), []);
    });
  }
});

test("genuine path prevalidation failures avoid all source access and preserve existing destinations", async (context) => {
  const fixture = path.join(__dirname, "fixtures", "genuine-failure.js");
  for (const scenario of ["missing-parent", "extension", "directory", "existing", "symlink-parent"]) {
    await withTemporaryDirectory(async (directory) => {
      const { result } = runScenario(fixture, scenario, directory);
      if (result.skipped) { context.diagnostic(`${scenario}: ${result.skipReason}`); return; }
      assert.equal(result.ticketReads, 0, scenario);
      assert.equal(result.sheetsRequests, 0, scenario);
      assert.deepEqual(result.temporary, [], scenario);
      if (scenario === "existing") assert.equal(result.destinationState, "EXISTING_DESTINATION_CANARY");
      if (scenario === "directory") assert.equal(result.destinationState, "directory");
      if (["missing-parent", "extension", "symlink-parent"].includes(scenario)) {
        assert.equal(result.destinationState, "absent", scenario);
      }
    });
  }
});

test("genuine success and PR9 write/cleanup failures have exact exits and explicit residue behavior", async () => {
  const fixture = path.join(__dirname, "fixtures", "genuine-failure.js");
  for (const scenario of ["success", "write", "cleanup", "usage"]) {
    await withTemporaryDirectory(async (directory) => {
      const { result } = runScenario(fixture, scenario, directory);
      if (scenario === "success") {
        assert.match(result.destinationState, /^# Cloud Crowd Audit Report\n/u);
        assert.deepEqual(result.temporary, []);
      } else if (scenario === "cleanup") {
        assert.match(result.destinationState, /^# Cloud Crowd Audit Report\n/u);
        assert.equal(result.temporary.length, 1);
      } else {
        assert.equal(result.destinationState, "absent");
        assert.deepEqual(result.temporary, []);
      }
      const remaining = await require("node:fs/promises").readdir(directory);
      if (scenario === "success" || scenario === "cleanup") assert.deepEqual(remaining, ["audit.md"]);
      else assert.deepEqual(remaining, []);
    });
  }
});
