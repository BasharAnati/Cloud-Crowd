"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildAuditReport } = require("../../src/report");
const { CATEGORIES, CLASSES, FINDING_TYPES, MODULES, typePolicy } = require("../../src/report/policy");
const { parityResult, postgresTicket, sheetRow, zeroFindingResult } = require("./helpers");

function groups(report) {
  return report.moduleSections.flatMap((module) => module.categorySections.flatMap((category) => category.findingGroups));
}

function entries(report) { return groups(report).flatMap((group) => group.entries); }

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function total(object) { return Object.values(object).reduce((sum, value) => sum + value, 0); }

test("report model has the exact format-neutral schema and fixed metadata", async () => {
  const parity = await parityResult();
  const report = buildAuditReport(parity);
  assert.deepEqual(Object.keys(report), [
    "reportType", "schemaVersion", "sourceType", "modules", "overview", "moduleSections", "statistics", "metadata",
  ]);
  assert.equal(Object.getPrototypeOf(report), null);
  assert.equal(report.reportType, "canonical-parity-audit");
  assert.equal(report.schemaVersion, "1");
  assert.equal(report.sourceType, "postgresql-google-sheets");
  assert.deepEqual(report.modules, MODULES);
  assert.equal(report.metadata.producer, "buildAuditReport");
  assert.equal(report.metadata.inputType, "trusted-parity-result");
  assert.equal(Object.hasOwn(report.metadata, "timestamp"), false);
  assert.equal(Object.hasOwn(report, "findings"), false);
  assert.equal(Object.hasOwn(report, "pass"), false);
  assert.equal(Object.hasOwn(report, "html"), false);
  assert.equal(Object.hasOwn(report, "markdown"), false);
  assertDeepFrozen(report);
});

test("every closed finding type maps once to one fixed category, label, and factual description", () => {
  assert.equal(FINDING_TYPES.length, 20);
  for (const type of FINDING_TYPES) {
    const policy = typePolicy(type);
    assert.ok(policy);
    assert.ok(CATEGORIES.includes(policy.category));
    assert.ok(CLASSES.includes(policy.class));
    assert.equal(typeof policy.label, "string");
    assert.equal(typeof policy.description, "string");
    assert.equal(policy.descriptionCode, type);
    assert.equal(Object.isFrozen(policy), true);
    assert.equal(/[<>]|https?:\/\//.test(policy.description), false);
  }
  assert.equal(typePolicy("UNKNOWN_FINDING"), null);
});

test("module, category, type grouping and all statistics reconcile exactly", async () => {
  const parity = await parityResult([
    postgresTicket(1, "ce", "MATCH", { branch: "Left", customerName: "PRIVATE CUSTOMER", customerNotes: "PRIVATE NOTE" }),
    postgresTicket(2, "ce", "PG-ONLY"),
    postgresTicket(3, "complaints", "DUPLICATE"),
    postgresTicket(4, "complaints", "DUPLICATE"),
  ], {
    "customer-experience": [
      sheetRow("customer-experience", "MATCH", { 2: "PRIVATE SHEET CUSTOMER", 7: "Right" }),
      sheetRow("customer-experience", "SH-ONLY"),
    ],
    complaints: [sheetRow("complaints", "DUPLICATE")],
  });
  const report = buildAuditReport(parity);
  assert.deepEqual(report.moduleSections.map((section) => section.module), MODULES);
  assert(report.moduleSections.every((section) => section.categorySections.length === CATEGORIES.length));
  assert.equal(entries(report).length, parity.findings.length);
  assert.equal(report.overview.totalFindings, parity.findings.length);
  assert.equal(report.metadata.findingCount, parity.findings.length);
  assert.equal(total(report.statistics.findingsByModule), parity.findings.length);
  assert.equal(total(report.statistics.findingsByCategory), parity.findings.length);
  assert.equal(total(report.statistics.findingsByType), parity.findings.length);
  assert.equal(total(report.statistics.findingsByClass), parity.findings.length);
  assert.deepEqual({ ...report.statistics.findingsByType }, { ...parity.summary.findingsByType });
  for (const section of report.moduleSections) {
    assert.equal(total(section.findingsByCategory), section.findingCount);
    assert.equal(total(section.findingsByType), section.findingCount);
    assert.equal(total(section.findingsByClass), section.findingCount);
  }
  const serialized = JSON.stringify(report);
  for (const canary of ["PRIVATE CUSTOMER", "PRIVATE NOTE", "PRIVATE SHEET CUSTOMER", "Left", "Right"])
    assert.equal(serialized.includes(canary), false);
});

test("overview copies PR5 counts without adding conclusions", async () => {
  const parity = await parityResult([postgresTicket(1, "ce", "PG")]);
  const report = buildAuditReport(parity);
  for (const [key, value] of Object.entries(parity.summary)) {
    if (typeof value === "number") assert.equal(report.overview[key], value);
  }
  assert.equal(report.overview.totalFindings, parity.findings.length);
  for (const key of ["pass", "fail", "healthy", "score", "risk", "releaseReady"]) assert.equal(Object.hasOwn(report.overview, key), false);
});

test("zero findings use only the approved neutral message", async () => {
  const parity = await zeroFindingResult();
  assert.equal(parity.findings.length, 0);
  const report = buildAuditReport(parity);
  assert.equal(report.overview.totalFindings, 0);
  assert.equal(report.overview.emptyMessage, "No parity findings were produced.");
  assert.equal(groups(report).length, 0);
  assert.equal(entries(report).length, 0);
});

test("non-empty reports do not add an outcome message", async () => {
  const report = buildAuditReport(await parityResult());
  assert.equal(report.overview.emptyMessage, null);
});

test("equivalent genuine parity results produce deterministic reports", async () => {
  const left = await parityResult([postgresTicket(1, "ce", "DUP")], {
    "customer-experience": [sheetRow("customer-experience", "DUP", { 2: "left" }), sheetRow("customer-experience", "DUP", { 2: "right" })],
  });
  const right = await parityResult([postgresTicket(1, "ce", "DUP")], {
    "customer-experience": [sheetRow("customer-experience", "DUP", { 2: "right" }), sheetRow("customer-experience", "DUP", { 2: "left" })],
  });
  assert.deepEqual(left, right);
  assert.deepEqual(buildAuditReport(left), buildAuditReport(right));
});
