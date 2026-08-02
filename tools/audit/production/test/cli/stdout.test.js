"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyError } = require("../../src/errors");
const { writeArtifactToStdout } = require("../../src/cli/stdout");
const { CaptureStream, genuineArtifact } = require("./helpers");

test("stdout writes one genuine artifact as one exact UTF-8 Buffer", async () => {
  const artifact = await genuineArtifact("json");
  const stream = new CaptureStream();
  await writeArtifactToStdout(stream, artifact);
  assert.equal(stream.writes, 1);
  assert.deepEqual(stream.content(), Buffer.from(artifact.content, "utf8"));
  assert.equal(stream.content().length, artifact.byteLength);
});

test("stdout rejects arbitrary strings, lookalikes, clones, JSON copies, and proxies before writing", async () => {
  const artifact = await genuineArtifact("markdown");
  const values = ["ARBITRARY_SECRET_CANARY", Object.freeze({ ...artifact }), JSON.parse(JSON.stringify(artifact)),
    new Proxy(artifact, {})];
  const revoked = Proxy.revocable(artifact, {});
  revoked.revoke();
  values.push(revoked.proxy);
  for (const value of values) {
    const stream = new CaptureStream();
    await assert.rejects(writeArtifactToStdout(stream, value), (error) => {
      assert.equal(classifyError(error).publicCode, "CLI_INTERNAL_FAILURE");
      return true;
    });
    assert.equal(stream.writes, 0);
  }
});

test("stdout waits for both callback and drain when backpressure is reported", async () => {
  const artifact = await genuineArtifact("html");
  const stream = new CaptureStream({ accepted: false, callback: false });
  let settled = false;
  const writing = writeArtifactToStdout(stream, artifact).then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  stream.emit("drain");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  stream.complete();
  await writing;
  assert.equal(settled, true);
});

test("stdout maps synchronous and asynchronous EPIPE without leaking raw details", async () => {
  const artifact = await genuineArtifact("json");
  const synchronous = new CaptureStream();
  synchronous.write = () => { throw Object.assign(new Error("RAW_PIPE_CANARY"), { code: "EPIPE" }); };
  await assert.rejects(writeArtifactToStdout(synchronous, artifact), (error) => {
    const value = classifyError(error);
    assert.equal(value.publicCode, "CLI_BROKEN_PIPE");
    assert.equal(value.exitCode, 12);
    assert.equal(value.publicMessage.includes("CANARY"), false);
    return true;
  });

  const asynchronous = new CaptureStream({ callback: false });
  const writing = writeArtifactToStdout(asynchronous, artifact);
  queueMicrotask(() => asynchronous.emit("error", Object.assign(new Error("RAW_ASYNC_CANARY"), { code: "EPIPE" })));
  await assert.rejects(writing, (error) => classifyError(error).publicCode === "CLI_BROKEN_PIPE");
});

test("stdout close or ordinary error is a fixed write failure", async () => {
  const artifact = await genuineArtifact("json");
  for (const event of ["close", "error"]) {
    const stream = new CaptureStream({ callback: false });
    const writing = writeArtifactToStdout(stream, artifact);
    queueMicrotask(() => event === "close" ? stream.emit("close") : stream.emit("error", new Error("RAW_CANARY")));
    await assert.rejects(writing, (error) => classifyError(error).publicCode === "CLI_WRITE_FAILURE");
  }
});
