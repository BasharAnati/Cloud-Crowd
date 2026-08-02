"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

test("one genuine PR1 through PR8 run renders all formats using only fake external drivers", () => {
  const fixture = path.join(__dirname, "fixtures", "genuine-output.js");
  const result = JSON.parse(execFileSync(process.execPath, [fixture], {
    cwd: path.join(__dirname, "../.."),
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  }));
  assert.deepEqual(result.artifactFacts.map((artifact) => artifact.format), ["json", "markdown", "html"]);
  for (const artifact of result.artifactFacts) {
    assert.deepEqual(artifact.keys, ["format", "mediaType", "fileExtension", "outputSchemaVersion", "byteLength", "content"]);
    assert.equal(artifact.byteLength, artifact.actualBytes);
    assert.equal(artifact.frozen, true);
    assert.equal(artifact.nullPrototype, true);
    assert.equal(artifact.trusted, true);
    assert.equal(artifact.finalLf, true);
    assert.equal(artifact.hasCanary, false);
  }
  assert.equal(result.instrumentation.ticketCalls, 1);
  assert.equal(result.instrumentation.clientConstructions, 1);
  assert.equal(result.instrumentation.clientCloses, 1);
  assert.equal(result.instrumentation.sheetsRequests, 4);
  assert.equal(result.instrumentation.authorizations, 1);
  assert.equal(result.instrumentation.events.findIndex((event) => event.startsWith("sheets:")) >
    result.instrumentation.events.lastIndexOf("postgres:close"), true);
});
