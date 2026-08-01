"use strict";

const { ParityIdentityError } = require("../errors");
const { addFinding, fingerprint } = require("./finding");
const { safeReference } = require("./validation");

function candidate(record, field) {
  const states = record.sourceMetadata.fieldStates;
  const state = Object.hasOwn(states, field) ? states[field] : "MISSING";
  const value = record[field];
  if (state === "VALUE" && (typeof value !== "string" || value.length === 0)) throw new ParityIdentityError("Identity value is invalid");
  return { field, state, value, usable: state === "VALUE" };
}

function identityFinding(findings, record, findingType, evidenceCode) {
  addFinding(findings, {
    findingType, class: "ERROR", module: record.module,
    postgresReference: record.source === "postgresql" ? safeReference(record) : null,
    sheetsReference: record.source === "google-sheets" ? safeReference(record) : null,
    evidenceCode,
  });
}

function extractIdentity(record, findings) {
  if (record.module === "cctv") {
    const value = candidate(record, "caseNumber");
    if (value.usable) return { value: value.value, fingerprint: fingerprint(record.module, value.value) };
    const ambiguous = value.state === "AMBIGUOUS" || value.state === "UNSUPPORTED";
    identityFinding(findings, record, ambiguous ? "AMBIGUOUS_IDENTITY_SOURCE" : "MISSING_IDENTITY_KEY", value.state);
    return null;
  }
  const firstField = record.module === "complimentary-orders" ? "orderNumber" : "caseNumber";
  const secondField = firstField === "caseNumber" ? "orderNumber" : "caseNumber";
  const first = candidate(record, firstField);
  const second = candidate(record, secondField);
  if (first.usable && second.usable) {
    if (first.value !== second.value) {
      identityFinding(findings, record, "AMBIGUOUS_IDENTITY_SOURCE", "CONFLICTING_IDENTITY_FIELDS");
      return null;
    }
    return { value: first.value, fingerprint: fingerprint(record.module, first.value) };
  }
  if (first.usable) return { value: first.value, fingerprint: fingerprint(record.module, first.value) };
  if (second.usable) return { value: second.value, fingerprint: fingerprint(record.module, second.value) };
  const ambiguous = [first.state, second.state].some((state) => state === "AMBIGUOUS" || state === "UNSUPPORTED");
  identityFinding(findings, record, ambiguous ? "AMBIGUOUS_IDENTITY_SOURCE" : "MISSING_IDENTITY_KEY",
    ambiguous ? "UNUSABLE_IDENTITY_STATE" : "NO_USABLE_IDENTITY");
  return null;
}

module.exports = Object.freeze({ extractIdentity });
