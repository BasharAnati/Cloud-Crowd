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

function fsError(code, canary) {
  const error = new Error(canary);
  Object.defineProperty(error, "code", { value: code });
  return error;
}

function expectCode(publicCode) {
  return (error) => {
    const classification = classifyError(error);
    assert.equal(classification.publicCode, publicCode);
    assert.equal(classification.exitCode, 12);
    assert.equal(classification.publicMessage.includes("CANARY"), false);
    return true;
  };
}

async function temporaryNames(directory) {
  return (await fs.readdir(directory)).filter((name) => /^\.cloud-crowd-audit-[0-9a-f]{32}\.tmp$/u.test(name));
}

async function setup(directory, format = "json") {
  const artifact = await genuineArtifact(format);
  const destination = path.join(directory, `audit${artifact.fileExtension}`);
  return { artifact, destination, prepared: await prepareOutputPath(destination, format) };
}

function wrapHandle(handle, overrides = {}) {
  return {
    write: overrides.write || handle.write.bind(handle),
    sync: overrides.sync || handle.sync.bind(handle),
    stat: overrides.stat || handle.stat.bind(handle),
    close: overrides.close || handle.close.bind(handle),
  };
}

test("temporary randomness, collision, and non-EEXIST open failures are bounded and residue-free", async () => {
  await withTemporaryDirectory(async (directory) => {
    const { artifact, destination, prepared } = await setup(directory);
    const originalRandomBytes = crypto.randomBytes;
    try {
      crypto.randomBytes = () => { throw new Error("RANDOM_CANARY"); };
      await assert.rejects(writeArtifactAtomically(artifact, prepared), expectCode("CLI_WRITE_FAILURE"));
    } finally { crypto.randomBytes = originalRandomBytes; }
    await assert.rejects(fs.lstat(destination), { code: "ENOENT" });
    assert.deepEqual(await temporaryNames(directory), []);

    const collisionBytes = Buffer.alloc(16, 0xcd);
    const collision = path.join(directory, `.cloud-crowd-audit-${collisionBytes.toString("hex")}.tmp`);
    await fs.writeFile(collision, "COLLISION_CANARY", { flag: "wx" });
    let attempts = 0;
    try {
      crypto.randomBytes = () => { attempts += 1; return collisionBytes; };
      await assert.rejects(writeArtifactAtomically(artifact, prepared), expectCode("CLI_WRITE_FAILURE"));
    } finally { crypto.randomBytes = originalRandomBytes; }
    assert.equal(attempts, 8);
    assert.equal(await fs.readFile(collision, "utf8"), "COLLISION_CANARY");
    await fs.unlink(collision);

    const originalOpen = fs.open;
    try {
      fs.open = async () => { throw fsError("EACCES", "OPEN_PATH_CANARY"); };
      await assert.rejects(writeArtifactAtomically(artifact, prepared), expectCode("CLI_WRITE_FAILURE"));
    } finally { fs.open = originalOpen; }
    await assert.rejects(fs.lstat(destination), { code: "ENOENT" });
    assert.deepEqual(await temporaryNames(directory), []);
  });
});

test("partial writes complete exactly and invalid progress fails before publication", async () => {
  await withTemporaryDirectory(async (directory) => {
    const { artifact, destination, prepared } = await setup(directory);
    const originalOpen = fs.open;
    let calls = 0;
    try {
      fs.open = async (...args) => {
        const handle = await originalOpen.apply(fs, args);
        return wrapHandle(handle, { async write(buffer, offset, length, position) {
          calls += 1;
          const bounded = calls === 1 ? Math.max(1, Math.floor(length / 2)) : length;
          return handle.write(buffer, offset, bounded, position);
        } });
      };
      await writeArtifactAtomically(artifact, prepared);
    } finally { fs.open = originalOpen; }
    assert.equal(calls >= 2, true);
    assert.deepEqual(await fs.readFile(destination), Buffer.from(artifact.content, "utf8"));
  });

  for (const [name, bytesWritten] of [["zero", 0], ["negative", -1], ["fraction", 0.5], ["oversized", Number.MAX_SAFE_INTEGER]]) {
    await withTemporaryDirectory(async (directory) => {
      const { artifact, destination, prepared } = await setup(directory);
      const originalOpen = fs.open;
      try {
        fs.open = async (...args) => {
          const handle = await originalOpen.apply(fs, args);
          return wrapHandle(handle, { write: async () => ({ bytesWritten }) });
        };
        await assert.rejects(writeArtifactAtomically(artifact, prepared), expectCode("CLI_WRITE_FAILURE"), name);
      } finally { fs.open = originalOpen; }
      await assert.rejects(fs.lstat(destination), { code: "ENOENT" });
      assert.deepEqual(await temporaryNames(directory), []);
    });
  }
});

test("a write rejection after partial progress preserves the primary error and cleans the temp", async () => {
  await withTemporaryDirectory(async (directory) => {
    const { artifact, destination, prepared } = await setup(directory);
    const originalOpen = fs.open;
    let calls = 0;
    try {
      fs.open = async (...args) => {
        const handle = await originalOpen.apply(fs, args);
        return wrapHandle(handle, { async write(buffer, offset, length, position) {
          calls += 1;
          if (calls === 1) return handle.write(buffer, offset, Math.max(1, Math.floor(length / 2)), position);
          throw new Error("PARTIAL_WRITE_CANARY");
        } });
      };
      await assert.rejects(writeArtifactAtomically(artifact, prepared), expectCode("CLI_WRITE_FAILURE"));
    } finally { fs.open = originalOpen; }
    assert.equal(calls, 2);
    await assert.rejects(fs.lstat(destination), { code: "ENOENT" });
    assert.deepEqual(await temporaryNames(directory), []);
  });
});

test("fsync and stat failures, wrong size, and non-file stat prevent publication", async () => {
  const cases = [
    ["fsync", (handle) => ({ sync: async () => { throw new Error("FSYNC_CANARY"); } })],
    ["stat", (handle) => ({ stat: async () => { throw new Error("STAT_CANARY"); } })],
    ["wrong-size", (handle) => ({ stat: async () => ({ isFile: () => true, size: 1 }) })],
    ["non-file", (handle) => ({ stat: async () => ({ isFile: () => false, size: 0 }) })],
  ];
  for (const [name, overrides] of cases) {
    await withTemporaryDirectory(async (directory) => {
      const { artifact, destination, prepared } = await setup(directory);
      const originalOpen = fs.open;
      try {
        fs.open = async (...args) => {
          const handle = await originalOpen.apply(fs, args);
          return wrapHandle(handle, overrides(handle));
        };
        await assert.rejects(writeArtifactAtomically(artifact, prepared), expectCode("CLI_WRITE_FAILURE"), name);
      } finally { fs.open = originalOpen; }
      await assert.rejects(fs.lstat(destination), { code: "ENOENT" });
      assert.deepEqual(await temporaryNames(directory), []);
    });
  }
});

test("initial close failure remains primary whether the finally close retry succeeds or fails", async () => {
  for (const retryFails of [false, true]) {
    await withTemporaryDirectory(async (directory) => {
      const { artifact, destination, prepared } = await setup(directory);
      const originalOpen = fs.open;
      let closeCalls = 0;
      let rawHandle;
      try {
        fs.open = async (...args) => {
          rawHandle = await originalOpen.apply(fs, args);
          return wrapHandle(rawHandle, { async close() {
            closeCalls += 1;
            if (closeCalls === 1 || retryFails) throw new Error("CLOSE_CANARY");
            return rawHandle.close();
          } });
        };
        await assert.rejects(writeArtifactAtomically(artifact, prepared), expectCode("CLI_WRITE_FAILURE"));
      } finally {
        fs.open = originalOpen;
        if (retryFails && rawHandle) await rawHandle.close().catch(() => {});
      }
      assert.equal(closeCalls, 2);
      await assert.rejects(fs.lstat(destination), { code: "ENOENT" });
      assert.deepEqual(await temporaryNames(directory), []);
    });
  }
});

test("changed parent realpath is detected before link and the temp is removed", async () => {
  await withTemporaryDirectory(async (directory) => {
    const { artifact, destination, prepared } = await setup(directory);
    const originalRealpath = fs.realpath;
    const originalLink = fs.link;
    let realpathCalls = 0;
    let linkCalls = 0;
    try {
      fs.realpath = async (...args) => {
        realpathCalls += 1;
        const actual = await originalRealpath.apply(fs, args);
        return realpathCalls === 1 ? actual : `${actual}-REPLACED_CANARY`;
      };
      fs.link = async (...args) => { linkCalls += 1; return originalLink.apply(fs, args); };
      await assert.rejects(writeArtifactAtomically(artifact, prepared), expectCode("CLI_PATH_FAILURE"));
    } finally {
      fs.realpath = originalRealpath;
      fs.link = originalLink;
    }
    assert.equal(realpathCalls, 2);
    assert.equal(linkCalls, 0);
    await assert.rejects(fs.lstat(destination), { code: "ENOENT" });
    assert.deepEqual(await temporaryNames(directory), []);
  });
});

test("destination/link races fail closed, preserve existing bytes, and clean the temp", async () => {
  const cases = [["EEXIST", "CLI_DESTINATION_EXISTS"], ["ENOTSUP", "CLI_WRITE_FAILURE"], ["EACCES", "CLI_WRITE_FAILURE"]];
  for (const [linkCode, expected] of cases) {
    await withTemporaryDirectory(async (directory) => {
      const { artifact, destination, prepared } = await setup(directory);
      const originalLink = fs.link;
      try {
        fs.link = async () => {
          if (linkCode === "EEXIST") await fs.writeFile(destination, "EXISTING_DESTINATION_CANARY", { flag: "wx" });
          throw fsError(linkCode, `LINK_${linkCode}_PATH_CANARY`);
        };
        await assert.rejects(writeArtifactAtomically(artifact, prepared), expectCode(expected));
      } finally { fs.link = originalLink; }
      if (linkCode === "EEXIST") assert.equal(await fs.readFile(destination, "utf8"), "EXISTING_DESTINATION_CANARY");
      else await assert.rejects(fs.lstat(destination), { code: "ENOENT" });
      assert.deepEqual(await temporaryNames(directory), []);
    });
  }
});

test("cleanup precedence and persistent post-publication cleanup behavior are explicit", async () => {
  await withTemporaryDirectory(async (directory) => {
    const { artifact, destination, prepared } = await setup(directory);
    const originalOpen = fs.open;
    const originalUnlink = fs.unlink;
    let tempPath;
    try {
      fs.open = async (...args) => {
        tempPath = args[0];
        const handle = await originalOpen.apply(fs, args);
        return wrapHandle(handle, { write: async () => { throw new Error("PRIMARY_WRITE_CANARY"); } });
      };
      fs.unlink = async (...args) => {
        await originalUnlink.apply(fs, args);
        throw new Error("CLEANUP_AFTER_PRIMARY_CANARY");
      };
      await assert.rejects(writeArtifactAtomically(artifact, prepared), expectCode("CLI_WRITE_FAILURE"));
    } finally {
      fs.open = originalOpen;
      fs.unlink = originalUnlink;
    }
    await assert.rejects(fs.lstat(destination), { code: "ENOENT" });
    if (tempPath) await assert.rejects(fs.lstat(tempPath), { code: "ENOENT" });
  });

  await withTemporaryDirectory(async (directory) => {
    const { artifact, destination, prepared } = await setup(directory);
    const originalUnlink = fs.unlink;
    let calls = 0;
    try {
      fs.unlink = async () => { calls += 1; throw new Error("PERSISTENT_CLEANUP_PATH_CANARY"); };
      await assert.rejects(writeArtifactAtomically(artifact, prepared), expectCode("CLI_CLEANUP_FAILURE"));
    } finally { fs.unlink = originalUnlink; }
    assert.equal(calls, 2);
    assert.deepEqual(await fs.readFile(destination), Buffer.from(artifact.content, "utf8"));
    const leftovers = await temporaryNames(directory);
    assert.equal(leftovers.length, 1);
    await fs.unlink(path.join(directory, leftovers[0]));
  });
});
