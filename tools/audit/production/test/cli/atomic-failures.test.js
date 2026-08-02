"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { classifyError } = require("../../src/errors");
const { writeArtifactAtomically } = require("../../src/cli/atomic-write");
const { prepareOutputPath } = require("../../src/cli/path-policy");
const { genuineArtifact, withTemporaryDirectory } = require("./helpers");

function classification(code) {
  return (error) => {
    assert.equal(classifyError(error).publicCode, code);
    assert.equal(classifyError(error).exitCode, 12);
    return true;
  };
}

test("write and close failures preserve the primary write classification and publish nothing", async () => {
  await withTemporaryDirectory(async (directory) => {
    const artifact = await genuineArtifact("json");
    const output = path.join(directory, "audit.json");
    const prepared = await prepareOutputPath(output, "json");
    const originalOpen = fs.open;
    try {
      fs.open = async () => ({
        write: async () => { throw new Error("RAW_WRITE_CANARY"); },
        close: async () => { throw new Error("RAW_CLOSE_CANARY"); },
      });
      await assert.rejects(writeArtifactAtomically(artifact, prepared), classification("CLI_WRITE_FAILURE"));
    } finally {
      fs.open = originalOpen;
    }
    await assert.rejects(fs.lstat(output), { code: "ENOENT" });
    assert.deepEqual(await fs.readdir(directory), []);
  });
});

test("publication failures remove the temporary file and disclose no filesystem detail", async () => {
  await withTemporaryDirectory(async (directory) => {
    const artifact = await genuineArtifact("markdown");
    const output = path.join(directory, "audit.md");
    const prepared = await prepareOutputPath(output, "markdown");
    const originalLink = fs.link;
    try {
      fs.link = async () => { const error = new Error("RAW_PATH_ERRNO_CANARY"); error.code = "EACCES"; throw error; };
      await assert.rejects(writeArtifactAtomically(artifact, prepared), classification("CLI_WRITE_FAILURE"));
    } finally {
      fs.link = originalLink;
    }
    assert.deepEqual(await fs.readdir(directory), []);
  });
});

test("temporary-name collisions are bounded to eight attempts", async () => {
  await withTemporaryDirectory(async (directory) => {
    const artifact = await genuineArtifact("html");
    const output = path.join(directory, "audit.html");
    const prepared = await prepareOutputPath(output, "html");
    const bytes = Buffer.alloc(16, 0xab);
    const collision = path.join(directory, `.cloud-crowd-audit-${bytes.toString("hex")}.tmp`);
    await fs.writeFile(collision, "collision", { flag: "wx" });
    const originalRandomBytes = crypto.randomBytes;
    let attempts = 0;
    try {
      crypto.randomBytes = () => { attempts += 1; return bytes; };
      await assert.rejects(writeArtifactAtomically(artifact, prepared), classification("CLI_WRITE_FAILURE"));
    } finally {
      crypto.randomBytes = originalRandomBytes;
    }
    assert.equal(attempts, 8);
    await assert.rejects(fs.lstat(output), { code: "ENOENT" });
    assert.deepEqual(await fs.readdir(directory), [path.basename(collision)]);
  });
});

test("a cleanup failure is classified after complete publication and a finally retry removes the temporary file", async () => {
  await withTemporaryDirectory(async (directory) => {
    const artifact = await genuineArtifact("json");
    const output = path.join(directory, "audit.json");
    const prepared = await prepareOutputPath(output, "json");
    const originalUnlink = fs.unlink;
    let calls = 0;
    try {
      fs.unlink = async (...args) => {
        calls += 1;
        if (calls === 1) throw new Error("RAW_CLEANUP_CANARY");
        return originalUnlink.apply(fs, args);
      };
      await assert.rejects(writeArtifactAtomically(artifact, prepared), classification("CLI_CLEANUP_FAILURE"));
    } finally {
      fs.unlink = originalUnlink;
    }
    assert.equal(await fs.readFile(output, "utf8"), artifact.content);
    assert.deepEqual(await fs.readdir(directory), ["audit.json"]);
  });
});
