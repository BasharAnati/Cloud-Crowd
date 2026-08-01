"use strict";

const { ParityLimitError } = require("../errors");
const { addFinding } = require("./finding");
const { LIMITS, MODULES, safeReference, verifyBundle, verifyRecord } = require("./validation");

const TICKETS = new Set(["ticket"]);
const SHEET_TYPES = new Set(["ticket", "module"]);

function warning(findings, record, flag) {
  addFinding(findings, {
    findingType: "MODULE_STRUCTURE_WARNING", class: "WARNING", module: record.module,
    sheetsReference: safeReference(record), evidenceCode: flag,
  });
}

function partitionBundle(bundle, findings) {
  const trusted = verifyBundle(bundle);
  const modules = new Map(MODULES.map((module) => [module, {
    postgres: [], sheets: [], moduleRecords: [], comparable: true, identityComparable: true,
  }]));
  for (const record of trusted.postgres) {
    verifyRecord(record, "postgresql", TICKETS);
    modules.get(record.module).postgres.push(record);
  }
  for (const record of trusted.sheets) {
    verifyRecord(record, "google-sheets", SHEET_TYPES);
    const part = modules.get(record.module);
    (record.recordType === "ticket" ? part.sheets : part.moduleRecords).push(record);
  }
  for (const module of MODULES) {
    const part = modules.get(module);
    const moduleConditions = new Set();
    if (part.postgres.length > LIMITS.recordsPerModuleSource ||
        part.sheets.length + part.moduleRecords.length > LIMITS.recordsPerModuleSource) throw new ParityLimitError("Parity module limit exceeded");
    for (const record of [...part.moduleRecords, ...part.sheets]) {
      const moduleFlags = [
        ...record.sourceMetadata.snapshotStructuralFlags,
        ...record.sourceMetadata.headerStructuralFlags,
      ];
      if (record.recordType === "module") moduleFlags.push(...record.structuralFlags);
      for (const flag of moduleFlags) moduleConditions.add(flag);
      if (record.recordType === "ticket") {
        const rowFlags = new Set([...record.structuralFlags, ...record.sourceMetadata.rowStructuralFlags]);
        for (const flag of rowFlags) warning(findings, record, flag);
      }
    }
    for (const flag of moduleConditions) {
      if (flag === "EMPTY_SHEET") {
        addFinding(findings, { findingType: "MODULE_EMPTY", class: "INFO", module, evidenceCode: flag });
      } else if (flag === "HEADER_ONLY") {
        addFinding(findings, { findingType: "MODULE_HEADER_ONLY", class: "INFO", module, evidenceCode: flag });
      } else {
        addFinding(findings, { findingType: "MODULE_STRUCTURE_WARNING", class: "WARNING", module, evidenceCode: flag });
      }
      if (flag === "UNKNOWN_HEADER" || flag === "HEADER_WIDTH_MISMATCH") {
        part.comparable = false;
        part.identityComparable = false;
      }
    }
    if (!part.identityComparable) addFinding(findings, {
      findingType: "MODULE_NOT_COMPARABLE", class: "NOT_COMPARABLE", module,
      comparability: "IDENTITY_STRUCTURE_UNTRUSTED", evidenceCode: "UNKNOWN_IDENTITY_POSITION",
    });
  }
  return { modules, trusted };
}

module.exports = Object.freeze({ partitionBundle });
