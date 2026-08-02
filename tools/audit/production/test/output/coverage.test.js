"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createAuditResult } = require("../../src/orchestrator/result");
const { compareCanonicalParityBundle } = require("../../src/parity");
const { buildAuditReport } = require("../../src/report");
const { CATEGORIES, CLASSES, FINDING_TYPES } = require("../../src/report/policy");
const { renderAuditOutput } = require("../../src/output");
const { escapeMarkdown } = require("../../src/output/escaping");
const { EXPECTED_HEADERS } = require("../../src/sheets/structure");
const { bundle, bundleWithSheetOptions, postgresTicket, sheetRow } = require("../parity/helpers");

async function coverageResults() {
  const inputs = [
    await bundleWithSheetOptions([postgresTicket(1, "ce", "ORDER")], {
      cctv: { missingHeaderValues: true },
      "customer-experience": { missingHeaderValues: true },
      complaints: { missingHeaderValues: true },
      "complimentary-orders": { missingHeaderValues: true },
    }),
    await bundle([postgresTicket(2, "ce", undefined), postgresTicket(3, "complaints", "ORDER", { caseNumber: "CASE" })]),
    await bundle([
      postgresTicket(4, "complaints", "DUP"), postgresTicket(5, "complaints", "DUP"),
      postgresTicket(6, "free-orders", "POSTGRES-ONLY"),
    ], { complaints: [sheetRow("complaints", "DUP")], cctv: [sheetRow("cctv", "SHEET-ONLY")] }),
    await bundle([postgresTicket(7, "ce", "FIELD", { branch: "Left", creationDate: "2026-01-01T00:00:00Z" })], {
      "customer-experience": [sheetRow("customer-experience", "FIELD", { 7: "Right", 4: "2026-01-01T00:00" })],
    }),
    await bundle([postgresTicket(8, "cctv", "COLLECTION", { cameras: ["Camera A"] })], {
      cctv: [sheetRow("cctv", "COLLECTION")],
    }),
    await bundleWithSheetOptions([postgresTicket(9, "cctv", "CCTV")], {
      cctv: { rows: [sheetRow("cctv", "CCTV", { 11: "owner", 12: "https://private.invalid/file" })] },
    }),
    await bundleWithSheetOptions([postgresTicket(10, "cctv", "ATTACHMENT", {
      cctvPdf: { name: "private.pdf", type: "pdf", dataUrl: "private-reference" },
    })], {
      cctv: {
        header: [...EXPECTED_HEADERS.cctv.slice(0, 11), "PDF Name", "PDF URL"],
        rows: [sheetRow("cctv", "ATTACHMENT")],
      },
    }),
  ];
  return inputs.map((input) => {
    const parity = compareCanonicalParityBundle(input);
    const report = buildAuditReport(parity);
    return { parity, report, result: createAuditResult(parity, report) };
  });
}

test("genuine results exercise all categories, every class, and the closed finding taxonomy maps deterministically", async () => {
  const values = await coverageResults();
  const categories = new Set();
  const classes = new Set();
  const types = new Set();
  for (const { parity } of values) for (const finding of parity.findings) {
    classes.add(finding.class);
    types.add(finding.findingType);
  }
  for (const { report } of values) for (const module of report.moduleSections) for (const category of module.categorySections) {
    if (category.findingCount > 0) categories.add(category.category);
  }
  assert.deepEqual([...categories].sort(), [...CATEGORIES].sort());
  assert.deepEqual([...classes].sort(), [...CLASSES].sort());
  assert.equal(types.size >= 15, true);
  assert.equal(FINDING_TYPES.length, 20);
});

test("all genuinely produced categories and types render without special-case omissions in every format", async () => {
  const values = await coverageResults();
  for (const { parity, result } of values) {
    const json = renderAuditOutput(result, "json").content;
    const markdown = renderAuditOutput(result, "markdown").content;
    const html = renderAuditOutput(result, "html").content;
    for (const finding of parity.findings) {
      assert.equal(json.includes(`\"${finding.findingType}\"`), true, finding.findingType);
      assert.equal(markdown.includes(escapeMarkdown(finding.findingType)), true, finding.findingType);
      assert.equal(html.includes(finding.findingType), true, finding.findingType);
    }
  }
});
