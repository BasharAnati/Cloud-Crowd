"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { verifyTrustedOutputArtifact } = require("../../src/output/artifact");
const { CaptureStream, genuineArtifact, withTemporaryDirectory } = require("./helpers");

function cachedModule(modulePath, exports) {
  return { id: modulePath, filename: modulePath, loaded: true, exports };
}

test("production audit adapter invokes run, render, and trusted verification exactly once in order", async () => {
  const artifact = await genuineArtifact("json");
  const result = Object.freeze({ marker: "trusted-by-render-stub" });
  const events = [];
  const paths = {
    adapter: require.resolve("../../src/cli/adapter"),
    orchestrator: require.resolve("../../src/orchestrator"),
    output: require.resolve("../../src/output"),
    artifact: require.resolve("../../src/output/artifact"),
  };
  const prior = new Map(Object.values(paths).map((modulePath) => [modulePath, require.cache[modulePath]]));
  try {
    delete require.cache[paths.adapter];
    require.cache[paths.orchestrator] = cachedModule(paths.orchestrator, Object.freeze({ runAudit: async function runAudit() {
      events.push("runAudit");
      return result;
    } }));
    require.cache[paths.output] = cachedModule(paths.output, Object.freeze({ renderAuditOutput(value, format) {
      events.push(`render:${format}`);
      assert.equal(value, result);
      return artifact;
    } }));
    require.cache[paths.artifact] = cachedModule(paths.artifact, Object.freeze({ verifyTrustedOutputArtifact(value) {
      events.push("verify");
      return verifyTrustedOutputArtifact(value);
    } }));
    const { produceAuditArtifact } = require("../../src/cli/adapter");
    assert.equal(await produceAuditArtifact("json"), artifact);
    assert.deepEqual(events, ["runAudit", "render:json", "verify"]);
  } finally {
    for (const [modulePath, cached] of prior) {
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  }
});

test("adapter preserves failures for the CLI boundary, including genuine trusted identity", async () => {
  const paths = {
    adapter: require.resolve("../../src/cli/adapter"),
    orchestrator: require.resolve("../../src/orchestrator"),
  };
  const prior = new Map(Object.values(paths).map((modulePath) => [modulePath, require.cache[modulePath]]));
  const { DatabaseQueryError, classifyError } = require("../../src/errors");
  const trusted = new DatabaseQueryError("secret query");
  try {
    delete require.cache[paths.adapter];
    require.cache[paths.orchestrator] = cachedModule(paths.orchestrator,
      Object.freeze({ runAudit: async () => { throw trusted; } }));
    let operation = require("../../src/cli/adapter").produceAuditArtifact;
    await assert.rejects(operation("json"), (error) => error === trusted);

    delete require.cache[paths.adapter];
    require.cache[paths.orchestrator] = cachedModule(paths.orchestrator,
      Object.freeze({ runAudit: async () => { throw new Error("RAW_CANARY"); } }));
    operation = require("../../src/cli/adapter").produceAuditArtifact;
    await assert.rejects(operation("json"), (error) => {
      assert.deepEqual(classifyError(error), {
        publicCode: "INTERNAL_ERROR", publicMessage: "Unexpected internal failure", exitCode: 1,
      });
      return true;
    });
  } finally {
    for (const [modulePath, cached] of prior) {
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  }
});

test("CLI boundary sanitizes unexpected audit failures without replacing trusted upstream errors", async () => {
  const cliPath = require.resolve("../../src/cli");
  const commandPath = require.resolve("../../src/cli/audit-command");
  const prior = new Map([cliPath, commandPath].map((modulePath) => [modulePath, require.cache[modulePath]]));
  const { DatabaseQueryError } = require("../../src/errors");
  async function invoke(error) {
    delete require.cache[cliPath];
    require.cache[commandPath] = cachedModule(commandPath,
      Object.freeze({ executeAuditCommand: async () => { throw error; } }));
    const { run } = require("../../src/cli");
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    const exitCode = await run({
      args: ["audit", "--format", "json", "--stdout"],
      env: Object.create(null), version: "1", stdout, stderr,
    });
    return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
  }
  try {
    assert.deepEqual(await invoke(new Error("RAW_UNEXPECTED_CANARY")), {
      exitCode: 12,
      stdout: "",
      stderr: "ERROR [CLI_INTERNAL_FAILURE]: Audit command failed\n",
    });
    assert.deepEqual(await invoke(new DatabaseQueryError("RAW_DATABASE_CANARY")), {
      exitCode: 5,
      stdout: "",
      stderr: "ERROR [DATABASE_QUERY_FAILURE]: Audit database read failed\n",
    });
  } finally {
    for (const [modulePath, cached] of prior) {
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  }
});

test("an upstream audit or render failure opens no file and leaves no destination or temporary output", async () => {
  await withTemporaryDirectory(async (directory) => {
    const commandPath = require.resolve("../../src/cli/audit-command");
    const adapterPath = require.resolve("../../src/cli/adapter");
    const prior = new Map([commandPath, adapterPath].map((modulePath) => [modulePath, require.cache[modulePath]]));
    const { DatabaseQueryError } = require("../../src/errors");
    const failure = new DatabaseQueryError("RAW_SOURCE_CANARY");
    const originalOpen = fs.open;
    let openCalls = 0;
    try {
      delete require.cache[commandPath];
      require.cache[adapterPath] = cachedModule(adapterPath,
        Object.freeze({ produceAuditArtifact: async () => { throw failure; } }));
      fs.open = async (...args) => { openCalls += 1; return originalOpen.apply(fs, args); };
      const { executeAuditCommand } = require("../../src/cli/audit-command");
      const output = path.join(directory, "audit.md");
      await assert.rejects(executeAuditCommand(Object.freeze({
        kind: "audit", format: "markdown", destination: "file", outputPath: output,
      }), new CaptureStream()), (error) => error === failure);
      assert.equal(openCalls, 0);
      await assert.rejects(fs.lstat(output), { code: "ENOENT" });
      assert.deepEqual(await fs.readdir(directory), []);
    } finally {
      fs.open = originalOpen;
      for (const [modulePath, cached] of prior) {
        if (cached) require.cache[modulePath] = cached;
        else delete require.cache[modulePath];
      }
    }
  });
});
