"use strict";

const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createAuditResult } = require("../../src/orchestrator/result");
const { renderAuditOutput } = require("../../src/output");
const { buildAuditReport } = require("../../src/report");
const { zeroFindingResult } = require("../report/helpers");

class CaptureStream extends EventEmitter {
  constructor({ accepted = true, callback = true } = {}) {
    super();
    this.accepted = accepted;
    this.callbackEnabled = callback;
    this.chunks = [];
    this.writes = 0;
    this.pendingCallback = null;
  }

  write(chunk, callback) {
    this.writes += 1;
    this.chunks.push(Buffer.from(chunk));
    this.pendingCallback = callback || null;
    if (this.callbackEnabled && callback) queueMicrotask(() => { this.pendingCallback = null; callback(); });
    return this.accepted;
  }

  content() { return Buffer.concat(this.chunks); }
  text() { return this.content().toString("utf8"); }
  complete(error) {
    const callback = this.pendingCallback;
    this.pendingCallback = null;
    if (callback) callback(error);
  }
}

async function genuineArtifact(format = "json") {
  const parity = await zeroFindingResult();
  return renderAuditOutput(createAuditResult(parity, buildAuditReport(parity)), format);
}

async function withTemporaryDirectory(operation) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-crowd-pr9-"));
  try { return await operation(directory); } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

module.exports = Object.freeze({ CaptureStream, genuineArtifact, withTemporaryDirectory });
