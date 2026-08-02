"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { renderAuditOutput } = require("../../src/output");
const { populatedAuditResult, zeroAuditResult } = require("./helpers");

test("equivalent genuine results render byte-for-byte identically with independent artifacts", async () => {
  for (const createResult of [zeroAuditResult, populatedAuditResult]) {
    const firstResult = await createResult();
    const secondResult = await createResult();
    assert.notStrictEqual(firstResult, secondResult);
    for (const format of ["json", "markdown", "html"]) {
      const first = renderAuditOutput(firstResult, format);
      const second = renderAuditOutput(secondResult, format);
      assert.notStrictEqual(first, second);
      assert.deepEqual(first, second);
      assert.equal(first.content, second.content);
      assert.equal(first.byteLength, second.byteLength);
      assert.equal(first.content.includes("\r"), false);
      assert.equal(first.content.endsWith("\n"), true);
      assert.equal(first.content.endsWith("\n\n"), false);
    }
  }
});

test("artifacts contain no time, environment, machine, path, or release-decision metadata", async () => {
  const result = await zeroAuditResult();
  for (const format of ["json", "markdown", "html"]) {
    const artifact = renderAuditOutput(result, format);
    for (const forbidden of ["timestamp", "duration", "hostname", "environment", "runId", "releaseDecision", "release decision"])
      assert.equal(artifact.content.includes(forbidden), false, `${format}:${forbidden}`);
  }
});
