"use strict";

const { createAuditResult } = require("../../src/orchestrator/result");
const { buildAuditReport } = require("../../src/report");
const { parityResult, postgresTicket, sheetRow, zeroFindingResult } = require("../report/helpers");

async function resultFromParity(parity) {
  return createAuditResult(parity, buildAuditReport(parity));
}

async function zeroAuditResult() {
  return resultFromParity(await zeroFindingResult());
}

async function populatedAuditResult() {
  return resultFromParity(await parityResult([
    postgresTicket(1, "ce", "MATCH", {
      branch: "PRIVATE_BRANCH_CANARY",
      customerName: "PRIVATE_CUSTOMER_CANARY",
      phone: "PRIVATE_PHONE_CANARY",
      customerNotes: "PRIVATE_NOTES_CANARY",
    }),
    postgresTicket(2, "complaints", "DUPLICATE"),
    postgresTicket(3, "complaints", "DUPLICATE"),
    postgresTicket(4, "free-orders", "POSTGRES-ONLY"),
  ], {
    "customer-experience": [sheetRow("customer-experience", "MATCH", { 7: "PRIVATE_SHEET_BRANCH_CANARY" })],
    complaints: [sheetRow("complaints", "DUPLICATE"), sheetRow("complaints", "DUPLICATE")],
    cctv: [sheetRow("cctv", "SHEET-ONLY")],
  }));
}

function deeplyFrozen(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value) && Object.values(value).every((child) => deeplyFrozen(child, seen));
}

module.exports = Object.freeze({ deeplyFrozen, populatedAuditResult, resultFromParity, zeroAuditResult });
