"use strict";

const { createHash } = require("node:crypto");
const { ParityLimitError } = require("../errors");
const { LIMITS, nullObject } = require("./validation");

const MODULE_PREFIX = Object.freeze({
  cctv: "CCTV",
  "customer-experience": "CE",
  complaints: "COMPLAINTS",
  "complimentary-orders": "COMPLIMENTARY",
});
const TYPE_ORDER = Object.freeze([
  "MODULE_EMPTY", "MODULE_HEADER_ONLY", "MODULE_STRUCTURE_WARNING", "MODULE_NOT_COMPARABLE",
  "MISSING_IDENTITY_KEY", "AMBIGUOUS_IDENTITY_SOURCE",
  "DUPLICATE_POSTGRES_KEY", "DUPLICATE_SHEET_KEY", "DUPLICATE_BOTH_SOURCES", "AMBIGUOUS_MATCH_SET",
  "POSTGRES_ONLY_RECORD", "SHEET_ONLY_RECORD",
  "FIELD_VALUE_MISMATCH", "FIELD_STATE_MISMATCH", "FIELD_NOT_COMPARABLE", "DATE_NOT_COMPARABLE",
  "CCTV_METADATA_AMBIGUOUS", "CCTV_METADATA_CONFLICT", "ATTACHMENT_COUNT_MISMATCH", "ATTACHMENT_NOT_COMPARABLE",
]);
const TYPE_INDEX = new Map(TYPE_ORDER.map((type, index) => [type, index]));

function fingerprint(module, identity) {
  return `${MODULE_PREFIX[module]}-${createHash("sha256").update(module).update("\0").update(identity).digest("hex").slice(0, 24)}`;
}

function finding(values) {
  const counts = values.counts ? nullObject(Object.entries(values.counts)) : null;
  const postgresReferences = values.postgresReferences ? Object.freeze([...values.postgresReferences]) : null;
  const sheetsReferences = values.sheetsReferences ? Object.freeze([...values.sheetsReferences]) : null;
  return nullObject([
    ["findingType", values.findingType], ["class", values.class], ["module", values.module],
    ["identityFingerprint", values.identityFingerprint || null], ["field", values.field || null],
    ["postgresReference", values.postgresReference || null], ["sheetsReference", values.sheetsReference || null],
    ["postgresState", values.postgresState || null], ["sheetsState", values.sheetsState || null],
    ["comparability", values.comparability || null], ["evidenceCode", values.evidenceCode || null], ["counts", counts],
    ["postgresReferences", postgresReferences], ["sheetsReferences", sheetsReferences],
  ]);
}

function ascii(left, right) { return left < right ? -1 : left > right ? 1 : 0; }

function sortFindings(findings, modules, fieldOrder) {
  const moduleIndex = new Map(modules.map((module, index) => [module, index]));
  findings.sort((a, b) => moduleIndex.get(a.module) - moduleIndex.get(b.module) ||
    (TYPE_INDEX.get(a.findingType) ?? 999) - (TYPE_INDEX.get(b.findingType) ?? 999) ||
    ascii(a.identityFingerprint || "", b.identityFingerprint || "") ||
    (fieldOrder.get(`${a.module}:${a.field}`) ?? 999) - (fieldOrder.get(`${b.module}:${b.field}`) ?? 999) ||
    ascii(a.postgresReference || "", b.postgresReference || "") || ascii(a.sheetsReference || "", b.sheetsReference || ""));
  return findings;
}

function addFinding(findings, value) {
  if (findings.length >= LIMITS.totalFindings) throw new ParityLimitError("Parity finding limit exceeded");
  findings.push(finding(value));
}

module.exports = Object.freeze({ TYPE_ORDER, addFinding, fingerprint, sortFindings });
