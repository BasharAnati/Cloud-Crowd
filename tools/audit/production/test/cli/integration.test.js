"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { withTemporaryDirectory } = require("./helpers");

test("one isolated genuine PR1 through PR9 execution emits all formats with fake external drivers", async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = path.join(__dirname, "fixtures", "genuine-cli.js");
    const result = JSON.parse(execFileSync(process.execPath, [fixture, directory], {
      cwd: path.join(__dirname, "../.."),
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    }));
    assert.deepEqual(result.exits, [0, 0, 0]);
    assert.equal(result.stdoutWrites, 1);
    assert.equal(result.stderrWrites, 0);
    assert.deepEqual(result.formats, ["cloud-crowd-audit", true, true]);
    assert.equal(result.finalLf, true);
    assert.equal(result.canary, false);
    assert.deepEqual(result.temporaryFiles, []);
  });
});
