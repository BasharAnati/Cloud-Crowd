"use strict";

const { ParityLimitError } = require("../errors");
const { addFinding } = require("./finding");
const { extractIdentity } = require("./identity");
const { LIMITS, MODULES, safeReference } = require("./validation");

function indexRecords(records, findings, stats, source) {
  const index = new Map();
  for (const record of records) {
    const identity = extractIdentity(record, findings);
    if (!identity) {
      stats[source === "postgresql" ? "unmatchablePostgres" : "unmatchableSheets"] += 1;
      continue;
    }
    let group = index.get(identity.value);
    if (!group) {
      group = { identity, records: [] };
      index.set(identity.value, group);
    }
    group.records.push(record);
    if (group.records.length > LIMITS.duplicateGroupSize) throw new ParityLimitError("Parity duplicate limit exceeded");
  }
  return index;
}

function references(records) {
  if (records.length > LIMITS.referencesPerFinding) throw new ParityLimitError("Parity reference limit exceeded");
  return records.map(safeReference);
}

function duplicateFinding(findings, module, identity, postgres, sheets, stats) {
  const pgDuplicate = postgres.length > 1;
  const sheetDuplicate = sheets.length > 1;
  const type = pgDuplicate && sheetDuplicate ? "DUPLICATE_BOTH_SOURCES" :
    pgDuplicate ? "DUPLICATE_POSTGRES_KEY" : "DUPLICATE_SHEET_KEY";
  if (pgDuplicate && sheetDuplicate) stats.duplicateBothGroups += 1;
  else if (pgDuplicate) stats.duplicatePostgresGroups += 1;
  else stats.duplicateSheetsGroups += 1;
  stats.ambiguousMatchGroups += 1;
  stats.unmatchablePostgres += postgres.length;
  stats.unmatchableSheets += sheets.length;
  const values = {
    findingType: type, class: "ERROR", module, identityFingerprint: identity.fingerprint,
    counts: { postgres: postgres.length, sheets: sheets.length },
    postgresReferences: references(postgres), sheetsReferences: references(sheets), evidenceCode: "NON_UNIQUE_IDENTITY",
  };
  addFinding(findings, values);
}

function matchPartitions(parts, findings) {
  const stats = {
    matchedUniquePairs: 0, postgresOnly: 0, sheetsOnly: 0, unmatchablePostgres: 0, unmatchableSheets: 0,
    duplicatePostgresGroups: 0, duplicateSheetsGroups: 0, duplicateBothGroups: 0, ambiguousMatchGroups: 0,
  };
  const pairs = [];
  for (const module of MODULES) {
    const part = parts.get(module);
    if (!part.identityComparable) {
      stats.unmatchablePostgres += part.postgres.length;
      stats.unmatchableSheets += part.sheets.length;
      continue;
    }
    const pg = indexRecords(part.postgres, findings, stats, "postgresql");
    const sh = indexRecords(part.sheets, findings, stats, "google-sheets");
    const identities = new Set([...pg.keys(), ...sh.keys()]);
    for (const value of identities) {
      const pgGroup = pg.get(value);
      const shGroup = sh.get(value);
      const postgres = pgGroup ? pgGroup.records : [];
      const sheets = shGroup ? shGroup.records : [];
      const identity = (pgGroup || shGroup).identity;
      if (postgres.length > 1 || sheets.length > 1) {
        duplicateFinding(findings, module, identity, postgres, sheets, stats);
      } else if (postgres.length === 1 && sheets.length === 1) {
        pairs.push({ module, identity, postgres: postgres[0], sheets: sheets[0], comparable: part.comparable });
        stats.matchedUniquePairs += 1;
      } else if (postgres.length === 1) {
        addFinding(findings, { findingType: "POSTGRES_ONLY_RECORD", class: "ERROR", module,
          identityFingerprint: identity.fingerprint, postgresReference: safeReference(postgres[0]), evidenceCode: "MISSING_FROM_SHEETS" });
        stats.postgresOnly += 1;
      } else {
        addFinding(findings, { findingType: "SHEET_ONLY_RECORD", class: "ERROR", module,
          identityFingerprint: identity.fingerprint, sheetsReference: safeReference(sheets[0]), evidenceCode: "MISSING_FROM_POSTGRES" });
        stats.sheetsOnly += 1;
      }
    }
  }
  return { pairs, stats };
}

module.exports = Object.freeze({ matchPartitions });
