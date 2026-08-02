"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const FIXTURE = path.join(__dirname, "fixtures", "genuine-pipeline.js");

function scenario(name, timeout = 30_000) {
  const output = execFileSync(process.execPath, [FIXTURE, name], {
    cwd: path.join(__dirname, "../.."),
    encoding: "utf8",
    timeout,
    windowsHide: true,
  });
  return JSON.parse(output);
}

function assertExactResult(facts) {
  assert.deepEqual(facts.keys, ["report", "summary", "statistics", "metadata"]);
  assert.equal(facts.prototypeNull, true);
  assert.equal(facts.deeplyFrozen, true);
  assert.deepEqual(facts.metadataKeys, ["schemaVersion", "executionVersion", "completed"]);
  assert.deepEqual(facts.metadata, { schemaVersion: "1", executionVersion: "1", completed: true });
  assert.equal(facts.reportTrusted, true);
  assert.equal(facts.statisticsReference, true);
  assert.equal(facts.summaryPostgresTickets, facts.reportPostgresTickets);
  for (const forbidden of ["timestamp", "duration", "environment", "pass", "fail", "releaseDecision"]) {
    assert.equal(Object.hasOwn(facts.metadata, forbidden), false);
  }
}

function assertError(result, code, exitCode) {
  assert.equal(result.kind, "error");
  assert.equal(result.error.returned, false);
  assert.equal(result.error.classification.publicCode, code);
  assert.equal(result.error.classification.exitCode, exitCode);
  assert.equal(result.error.classificationHasCanary, false);
  assert.equal(result.error.hasCause, false);
}

test("genuine one-page pipeline preserves every provenance boundary and produces zero findings", () => {
  const result = scenario("short-zero");
  assert.equal(result.kind, "success");
  assertExactResult(result.facts);
  assert.equal(result.facts.totalFindings, 0);
  assert.equal(result.instrumentation.ticketCalls, 1);
  assert.equal(result.instrumentation.sheetsRequests, 4);
  assert.equal(result.instrumentation.authorizations, 1);
  assert.equal(result.instrumentation.authClients, 1);
  assert.equal(result.instrumentation.clientConstructions, 1);
  assert.equal(result.instrumentation.clientCloses, 1);
  assert.equal(result.instrumentation.events.findIndex((entry) => entry.startsWith("sheets:")) >
    result.instrumentation.events.lastIndexOf("postgres:close"), true);
});

test("genuine populated pipeline uses all four Sheets modules", () => {
  const result = scenario("short-populated");
  assert.equal(result.kind, "success");
  assertExactResult(result.facts);
  assert.equal(result.facts.totalFindings > 0, true);
  assert.deepEqual(result.instrumentation.events.filter((entry) => entry.startsWith("sheets:")), [
    "sheets:cctv", "sheets:customer-experience", "sheets:complaints", "sheets:complimentary-orders",
  ]);
});

test("genuine full and multi-page scans preserve PR2 continuation ownership", () => {
  for (const [name, expectedTickets] of [["full-empty", 100], ["multi", 101]]) {
    const result = scenario(name);
    assert.equal(result.kind, "success", name);
    assertExactResult(result.facts);
    assert.equal(result.facts.summaryPostgresTickets, expectedTickets, name);
    assert.equal(result.instrumentation.ticketCalls, 2, name);
    assert.equal(result.instrumentation.clientConstructions, 2, name);
    assert.equal(result.instrumentation.clientCloses, 2, name);
    assert.equal(result.instrumentation.sheetsRequests, 4, name);
  }
});

test("equivalent genuine executions are deterministic and independently allocated", () => {
  const result = scenario("deterministic");
  assert.equal(result.kind, "success");
  assertExactResult(result.facts);
  assert.equal(result.equivalent, true);
  assert.equal(result.independent, true);
  assert.equal(result.instrumentation.ticketCalls, 2);
  assert.equal(result.instrumentation.authorizations, 2);
  assert.equal(result.instrumentation.sheetsRequests, 8);
});

test("two concurrent genuine audits have independent clients, reports, and results", () => {
  const result = scenario("concurrent");
  assert.equal(result.kind, "success");
  assertExactResult(result.facts);
  assertExactResult(result.secondFacts);
  assert.equal(result.independent, true);
  assert.equal(result.instrumentation.ticketCalls, 2);
  assert.equal(result.instrumentation.clientConstructions, 2);
  assert.equal(result.instrumentation.clientCloses, 2);
  assert.equal(result.instrumentation.authClients, 2);
  assert.equal(result.instrumentation.authorizations, 2);
});

test("one concurrent genuine failure does not alter the successful audit", () => {
  const result = scenario("concurrent-one-fails");
  assert.equal(result.kind, "mixed");
  assertExactResult(result.fulfilled);
  assert.equal(result.rejected.classification.publicCode, "DATABASE_QUERY_FAILURE");
  assert.equal(result.rejected.classification.exitCode, 5);
  assert.equal(result.instrumentation.sheetsRequests, 4);
  assert.equal(result.instrumentation.authorizations, 1);
  assert.equal(result.instrumentation.activeClients, 0);
});

test("genuine repeated and cyclic cursors stop before another source request", () => {
  for (const [name, calls] of [["repeat", 2], ["cycle", 3], ["long-cycle", 4]]) {
    const result = scenario(name);
    assertError(result, "ORCHESTRATION_PAGINATION_FAILURE", 10);
    assert.equal(result.instrumentation.ticketCalls, calls, name);
    assert.equal(result.instrumentation.sheetsRequests, 0, name);
    assert.equal(result.instrumentation.authorizations, 0, name);
    assert.equal(result.instrumentation.activeClients, 0, name);
  }
});

test("10,000 genuine pages are accepted and page 10,001 is never requested", { timeout: 60_000 }, () => {
  const accepted = scenario("limit-accepted", 45_000);
  assertError(accepted, "SHEETS_PERMISSION_DENIED", 6);
  assert.equal(accepted.instrumentation.ticketCalls, 10_000);
  assert.equal(accepted.instrumentation.sheetsRequests, 1);

  const rejected = scenario("limit-rejected", 45_000);
  assertError(rejected, "ORCHESTRATION_PAGINATION_FAILURE", 10);
  assert.equal(rejected.instrumentation.ticketCalls, 10_000);
  assert.equal(rejected.instrumentation.sheetsRequests, 0);
  assert.equal(rejected.instrumentation.authorizations, 0);
});

test("trusted PR1 through PR4 failures retain their classifications and stop later access", () => {
  const cases = [
    ["pr1-invalid", "CONFIGURATION_ERROR", 3, 0],
    ["pr2-query", "DATABASE_QUERY_FAILURE", 5, 0],
    ["pr2-safety", "DATABASE_SAFETY_FAILURE", 5, 0],
    ["pr3-config", "SHEETS_CREDENTIAL_FAILURE", 3, 0],
    ["pr3-permission", "SHEETS_PERMISSION_DENIED", 6, 1],
    ["pr4-normalization", "NORMALIZATION_MALFORMED_RECORD", 7, 4],
  ];
  for (const [name, code, exitCode, sheetsRequests] of cases) {
    const result = scenario(name);
    assertError(result, code, exitCode);
    assert.equal(result.instrumentation.sheetsRequests, sheetsRequests, name);
    assert.equal(result.instrumentation.activeClients, 0, name);
  }
});

test("closed producer-corruption seams preserve trusted PR5 and PR6 failures", () => {
  const parity = scenario("pr5-consistency");
  assertError(parity, "PARITY_INTERNAL_CONSISTENCY_FAILURE", 8);
  assert.equal(parity.instrumentation.sheetsRequests, 4);

  const report = scenario("pr6-validation");
  assertError(report, "REPORT_INVALID_SUMMARY", 9);
  assert.equal(report.instrumentation.sheetsRequests, 4);
});

test("unexpected local orchestration failure is fixed and sanitized", () => {
  const result = scenario("unexpected");
  assertError(result, "ORCHESTRATION_FAILURE", 10);
  assert.equal(result.error.classification.publicMessage, "Audit orchestration failed");
  assert.equal(result.instrumentation.sheetsRequests, 4);
});
