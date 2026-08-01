"use strict";

const { MODULES, nullObject } = require("./validation");
const { TYPE_ORDER } = require("./finding");

const CLASSES = Object.freeze(["ERROR", "WARNING", "INFO", "NOT_COMPARABLE"]);

function zeroObject(keys) { return Object.fromEntries(keys.map((key) => [key, 0])); }

function buildSummary(bundle, findings, stats) {
  const byModule = zeroObject(MODULES);
  const byType = zeroObject(TYPE_ORDER);
  const byClass = zeroObject(CLASSES);
  for (const finding of findings) {
    byModule[finding.module] += 1;
    byType[finding.findingType] += 1;
    byClass[finding.class] += 1;
  }
  const structural = new Set(["MODULE_EMPTY", "MODULE_HEADER_ONLY", "MODULE_STRUCTURE_WARNING", "MODULE_NOT_COMPARABLE"]);
  return nullObject([
    ["postgresTickets", bundle.postgres.length], ["sheetsTickets", bundle.sheets.filter((record) => record.recordType === "ticket").length],
    ["matchedUniquePairs", stats.matchedUniquePairs], ["postgresOnly", stats.postgresOnly], ["sheetsOnly", stats.sheetsOnly],
    ["unmatchablePostgres", stats.unmatchablePostgres], ["unmatchableSheets", stats.unmatchableSheets],
    ["duplicatePostgresGroups", stats.duplicatePostgresGroups], ["duplicateSheetsGroups", stats.duplicateSheetsGroups],
    ["duplicateBothGroups", stats.duplicateBothGroups], ["ambiguousMatchGroups", stats.ambiguousMatchGroups],
    ["fieldValueMismatches", byType.FIELD_VALUE_MISMATCH], ["fieldStateMismatches", byType.FIELD_STATE_MISMATCH],
    ["notComparableFields", byType.FIELD_NOT_COMPARABLE + byType.DATE_NOT_COMPARABLE + byType.ATTACHMENT_NOT_COMPARABLE],
    ["structuralFindings", findings.filter((finding) => structural.has(finding.findingType)).length],
    ["findingsByModule", nullObject(Object.entries(byModule))], ["findingsByType", nullObject(Object.entries(byType))],
    ["findingsByClass", nullObject(Object.entries(byClass))],
  ]);
}

module.exports = Object.freeze({ buildSummary });
