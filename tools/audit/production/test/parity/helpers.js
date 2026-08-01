"use strict";

const {
  assembleCanonicalParityBundle, normalizePostgresSnapshot, normalizeSheetsSnapshot,
} = require("../../src/normalize");
const { trustedAllSheetsSnapshot, trustedCompleteTicketPages } = require("../normalize/helpers");
const { createSheetsAdapter } = require("../../src/sheets");
const { fakeGoogle, responseFor, safeCapability, sheetsEnvironment } = require("../sheets/helpers");

function postgresTicket(id, section, identity, payload = {}) {
  const identityField = section === "cctv" ? "caseNumber" : "orderNumber";
  const identityValue = identity === undefined ? {} : { [identityField]: identity };
  return {
    id: String(id), section, status: "Open", payload: { ...identityValue, ...payload },
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
}

function sheetRow(module, identity, overrides = {}) {
  const widths = { cctv: 13, "customer-experience": 16, complaints: 14, "complimentary-orders": 13 };
  const identityIndex = module === "cctv" ? 10 : module === "customer-experience" ? 15 : module === "complaints" ? 13 : 12;
  const cells = Array(widths[module]).fill("");
  cells[0] = "Open";
  cells[identityIndex] = identity;
  for (const [index, value] of Object.entries(overrides)) cells[Number(index)] = value;
  return cells;
}

async function bundle(postgresRows = [], sheetRows = {}) {
  const pages = Object.freeze((await trustedCompleteTicketPages(postgresRows, Math.max(1, postgresRows.length + 1))).map(normalizePostgresSnapshot));
  const sheets = normalizeSheetsSnapshot(await trustedAllSheetsSnapshot(sheetRows));
  return assembleCanonicalParityBundle(pages, sheets);
}

async function bundleWithSheetOptions(postgresRows, optionsByModule) {
  const google = fakeGoogle({
    onBatchGet(params) {
      const key = params.ranges[0].includes("CCTV") ? "cctv" :
        params.ranges[0].includes("Customer Experience") ? "customer-experience" :
          params.ranges[0].includes("Daily Complaints") ? "complaints" : "complimentary-orders";
      return responseFor(params, optionsByModule[key] || {});
    },
  });
  const adapter = createSheetsAdapter({ safety: safeCapability(), env: sheetsEnvironment(), googleFactory: google.factory });
  const pages = Object.freeze((await trustedCompleteTicketPages(postgresRows, Math.max(1, postgresRows.length + 1))).map(normalizePostgresSnapshot));
  return assembleCanonicalParityBundle(pages, normalizeSheetsSnapshot(await adapter.readAllConfiguredSheets()));
}

module.exports = { bundle, bundleWithSheetOptions, postgresTicket, sheetRow };
