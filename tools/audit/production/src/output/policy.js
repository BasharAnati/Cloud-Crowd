"use strict";

function frozenNull(entries) {
  return Object.freeze(Object.assign(Object.create(null), entries));
}

const OUTPUT_SCHEMA_VERSION = "1";
const NEWLINE = "\n";
const FORMAT_NAMES = Object.freeze(["json", "markdown", "html"]);
const FORMAT_POLICIES = frozenNull({
  json: frozenNull({
    format: "json",
    mediaType: "application/json; charset=utf-8",
    fileExtension: ".json",
    maximumBytes: 64 * 1024 * 1024,
  }),
  markdown: frozenNull({
    format: "markdown",
    mediaType: "text/markdown; charset=utf-8",
    fileExtension: ".md",
    maximumBytes: 64 * 1024 * 1024,
  }),
  html: frozenNull({
    format: "html",
    mediaType: "text/html; charset=utf-8",
    fileExtension: ".html",
    maximumBytes: 96 * 1024 * 1024,
  }),
});

const LIMITS = frozenNull({
  entries: 100_000,
  references: 1_000_000,
  lines: 2_000_000,
  htmlNodes: 2_000_000,
});

const MODULES = Object.freeze([
  frozenNull({ code: "cctv", heading: "CCTV" }),
  frozenNull({ code: "customer-experience", heading: "Customer Experience" }),
  frozenNull({ code: "complaints", heading: "Complaints" }),
  frozenNull({ code: "complimentary-orders", heading: "Complimentary Orders" }),
]);

const CATEGORIES = Object.freeze([
  frozenNull({ code: "STRUCTURAL", heading: "Structural" }),
  frozenNull({ code: "IDENTITY", heading: "Identity" }),
  frozenNull({ code: "DUPLICATE", heading: "Duplicate" }),
  frozenNull({ code: "PRESENCE", heading: "Presence" }),
  frozenNull({ code: "FIELD", heading: "Field mismatch" }),
  frozenNull({ code: "NOT_COMPARABLE", heading: "Not comparable" }),
  frozenNull({ code: "CCTV_METADATA", heading: "CCTV metadata" }),
  frozenNull({ code: "ATTACHMENT", heading: "Attachment" }),
]);

const OVERVIEW_FIELDS = Object.freeze([
  ["postgresTickets", "PostgreSQL tickets"],
  ["sheetsTickets", "Google Sheets tickets"],
  ["matchedUniquePairs", "Matched unique pairs"],
  ["postgresOnly", "PostgreSQL-only records"],
  ["sheetsOnly", "Sheet-only records"],
  ["unmatchablePostgres", "Unmatchable PostgreSQL records"],
  ["unmatchableSheets", "Unmatchable Sheet records"],
  ["duplicatePostgresGroups", "Duplicate PostgreSQL groups"],
  ["duplicateSheetsGroups", "Duplicate Sheet groups"],
  ["duplicateBothGroups", "Duplicate groups in both sources"],
  ["ambiguousMatchGroups", "Ambiguous match groups"],
  ["fieldValueMismatches", "Field value mismatches"],
  ["fieldStateMismatches", "Field state mismatches"],
  ["notComparableFields", "Not-comparable fields"],
  ["structuralFindings", "Structural findings"],
  ["totalFindings", "Total findings"],
].map((entry) => Object.freeze(entry)));

const TEXT = frozenNull({
  title: "Cloud Crowd Audit Report",
  overview: "Overview",
  emptyCategory: "No findings in this category.",
  zeroFindings: "No parity findings were produced.",
});

function formatPolicy(format) {
  return typeof format === "string" && Object.hasOwn(FORMAT_POLICIES, format)
    ? FORMAT_POLICIES[format]
    : null;
}

Object.freeze(formatPolicy);

module.exports = Object.freeze({
  CATEGORIES,
  FORMAT_NAMES,
  FORMAT_POLICIES,
  LIMITS,
  MODULES,
  NEWLINE,
  OUTPUT_SCHEMA_VERSION,
  OVERVIEW_FIELDS,
  TEXT,
  formatPolicy,
});
