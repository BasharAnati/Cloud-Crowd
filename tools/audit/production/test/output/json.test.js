"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { renderAuditOutput } = require("../../src/output");
const { FINDING_TYPES } = require("../../src/report/policy");
const { validateJsonGraph } = require("../../src/output/validation");
const { populatedAuditResult, zeroAuditResult } = require("./helpers");

test("JSON is the exact compact versioned projection with fixed order", async () => {
  const result = await zeroAuditResult();
  const artifact = renderAuditOutput(result, "json");
  const expected = JSON.stringify({
    outputType: "cloud-crowd-audit",
    outputSchemaVersion: "1",
    execution: { schemaVersion: "1", executionVersion: "1", completed: true },
    report: result.report,
  }) + "\n";
  assert.equal(artifact.content, expected);
  assert.equal(artifact.format, "json");
  assert.equal(artifact.mediaType, "application/json; charset=utf-8");
  assert.equal(artifact.fileExtension, ".json");
  assert.equal(artifact.outputSchemaVersion, "1");
  assert.equal(artifact.byteLength, Buffer.byteLength(expected, "utf8"));
  assert.equal(artifact.content.includes("\r"), false);
  assert.equal(artifact.content.endsWith("\n\n"), false);
  const parsed = JSON.parse(artifact.content);
  assert.deepEqual(Object.keys(parsed), ["outputType", "outputSchemaVersion", "execution", "report"]);
  assert.deepEqual(Object.keys(parsed.execution), ["schemaVersion", "executionVersion", "completed"]);
  assert.equal(Object.hasOwn(parsed, "summary"), false);
  assert.equal(Object.hasOwn(parsed, "statistics"), false);
});

test("JSON retains four modules, eight categories, fingerprints, references, and neutral empty output", async () => {
  const zero = JSON.parse(renderAuditOutput(await zeroAuditResult(), "json").content);
  assert.equal(zero.report.moduleSections.length, 4);
  assert.equal(zero.report.moduleSections.every((module) => module.categorySections.length === 8), true);
  assert.equal(zero.report.overview.emptyMessage, "No parity findings were produced.");
  const populated = JSON.parse(renderAuditOutput(await populatedAuditResult(), "json").content);
  const entries = populated.report.moduleSections.flatMap((module) => module.categorySections)
    .flatMap((category) => category.findingGroups).flatMap((group) => group.entries);
  assert.equal(entries.length > 0, true);
  assert.equal(entries.some((entry) => entry.identityFingerprint !== null), true);
  assert.equal(entries.some((entry) => entry.references.postgres.length + entry.references.sheets.length > 0), true);
  assert.deepEqual(Object.keys(populated.report.statistics.findingsByClass), ["ERROR", "WARNING", "INFO", "NOT_COMPARABLE"]);
  assert.deepEqual(Object.keys(populated.report.statistics.findingsByType), FINDING_TYPES);
});

test("JSON never emits raw source canaries", async () => {
  const content = renderAuditOutput(await populatedAuditResult(), "json").content;
  for (const canary of [
    "PRIVATE_BRANCH_CANARY", "PRIVATE_CUSTOMER_CANARY", "PRIVATE_PHONE_CANARY",
    "PRIVATE_NOTES_CANARY", "PRIVATE_SHEET_BRANCH_CANARY",
  ]) assert.equal(content.includes(canary), false);
});

test("JSON graph validation rejects unsupported values, prototypes, accessors, cycles, and invalid strings", () => {
  const invalid = [1.5, NaN, Infinity, 1n, undefined, Symbol("x"), () => {}, new String("x")];
  for (const value of invalid) assert.throws(() => validateJsonGraph(value));
  const accessor = Object.freeze(Object.defineProperty(Object.create(null), "x", { enumerable: true, get() { return "x"; } }));
  assert.throws(() => validateJsonGraph(accessor));
  assert.throws(() => validateJsonGraph(Object.freeze(new Proxy(Object.create(null), {}))));
  const cyclic = Object.create(null);
  Object.defineProperty(cyclic, "self", { value: cyclic, enumerable: true, writable: false, configurable: false });
  Object.freeze(cyclic);
  assert.throws(() => validateJsonGraph(cyclic));
  const surrogate = Object.freeze(Object.assign(Object.create(null), { value: "\ud800" }));
  assert.throws(() => validateJsonGraph(surrogate));
});
