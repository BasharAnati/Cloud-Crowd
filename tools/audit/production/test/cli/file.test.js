"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { classifyError } = require("../../src/errors");
const { writeArtifactAtomically } = require("../../src/cli/atomic-write");
const { prepareOutputPath } = require("../../src/cli/path-policy");
const { genuineArtifact, withTemporaryDirectory } = require("./helpers");

function code(expected) {
  return (error) => {
    const value = classifyError(error);
    assert.equal(value.publicCode, expected);
    assert.equal(value.exitCode, 12);
    return true;
  };
}

test("atomic file output writes exact bytes privately and leaves no temporary file", async () => {
  await withTemporaryDirectory(async (directory) => {
    const destination = path.join(directory, "audit.json");
    const artifact = await genuineArtifact("json");
    const prepared = await prepareOutputPath(destination, "json");
    await writeArtifactAtomically(artifact, prepared);
    assert.deepEqual(await fs.readFile(destination), Buffer.from(artifact.content, "utf8"));
    const stat = await fs.stat(destination);
    assert.equal(stat.size, artifact.byteLength);
    if (process.platform !== "win32") assert.equal(stat.mode & 0o077, 0);
    assert.deepEqual((await fs.readdir(directory)).filter((name) => name.startsWith(".cloud-crowd-audit-")), []);
  });
});

test("existing destinations are rejected without modification", async () => {
  await withTemporaryDirectory(async (directory) => {
    const destination = path.join(directory, "audit.md");
    await fs.writeFile(destination, "ORIGINAL_CANARY", "utf8");
    await assert.rejects(prepareOutputPath(destination, "markdown"), code("CLI_DESTINATION_EXISTS"));
    assert.equal(await fs.readFile(destination, "utf8"), "ORIGINAL_CANARY");
  });
});

test("missing parents, directories, extension mismatches, and forged prepared paths fail closed", async () => {
  await withTemporaryDirectory(async (directory) => {
    await assert.rejects(prepareOutputPath(path.join(directory, "missing", "audit.json"), "json"), code("CLI_PATH_FAILURE"));
    await assert.rejects(prepareOutputPath(path.join(directory, "audit.md"), "json"), code("CLI_PATH_FAILURE"));
    await assert.rejects(prepareOutputPath(directory, "json"), (error) =>
      ["CLI_PATH_FAILURE", "CLI_DESTINATION_EXISTS"].includes(classifyError(error).publicCode));
    await assert.rejects(writeArtifactAtomically(await genuineArtifact("json"), Object.freeze({})),
      code("CLI_INTERNAL_FAILURE"));
  });
});

test("destination symlinks and symlinked parents are rejected where supported", async (context) => {
  await withTemporaryDirectory(async (directory) => {
    const target = path.join(directory, "target.json");
    const link = path.join(directory, "link.json");
    await fs.writeFile(target, "target", "utf8");
    try { await fs.symlink(target, link, "file"); } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) { context.skip("symlink creation is unavailable"); return; }
      throw error;
    }
    await assert.rejects(prepareOutputPath(link, "json"), code("CLI_DESTINATION_EXISTS"));

    const realParent = path.join(directory, "real-parent");
    const linkedParent = path.join(directory, "linked-parent");
    await fs.mkdir(realParent);
    try { await fs.symlink(realParent, linkedParent, process.platform === "win32" ? "junction" : "dir"); } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return;
      throw error;
    }
    await assert.rejects(prepareOutputPath(path.join(linkedParent, "audit.json"), "json"), code("CLI_PATH_FAILURE"));
  });
});

test("two writers to one destination produce one complete winner and one fixed loser", async () => {
  await withTemporaryDirectory(async (directory) => {
    const destination = path.join(directory, "audit.html");
    const artifact = await genuineArtifact("html");
    const first = await prepareOutputPath(destination, "html");
    const second = await prepareOutputPath(destination, "html");
    const outcomes = await Promise.allSettled([
      writeArtifactAtomically(artifact, first), writeArtifactAtomically(artifact, second),
    ]);
    assert.equal(outcomes.filter((value) => value.status === "fulfilled").length, 1);
    const rejected = outcomes.find((value) => value.status === "rejected");
    assert.equal(classifyError(rejected.reason).publicCode, "CLI_DESTINATION_EXISTS");
    assert.deepEqual(await fs.readFile(destination), Buffer.from(artifact.content, "utf8"));
    assert.deepEqual((await fs.readdir(directory)).filter((name) => name.endsWith(".tmp")), []);
  });
});

test("concurrent different destinations remain independent", async () => {
  await withTemporaryDirectory(async (directory) => {
    const artifact = await genuineArtifact("json");
    const paths = [path.join(directory, "one.json"), path.join(directory, "two.json")];
    const prepared = await Promise.all(paths.map((value) => prepareOutputPath(value, "json")));
    await Promise.all(prepared.map((value) => writeArtifactAtomically(artifact, value)));
    for (const destination of paths) assert.deepEqual(await fs.readFile(destination), Buffer.from(artifact.content));
  });
});
