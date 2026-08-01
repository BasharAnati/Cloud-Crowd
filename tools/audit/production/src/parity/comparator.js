"use strict";

const { ParityInternalConsistencyError, ParityLimitError } = require("../errors");
const { CCTV_COLLECTION_FIELDS, fieldsFor, isDateField } = require("./field-policy");
const { addFinding } = require("./finding");
const { LIMITS, safeReference, stateFor } = require("./validation");

const NON_COMPARABLE_STATES = new Set(["AMBIGUOUS", "UNSUPPORTED"]);

function emit(findings, pair, findingType, field, values = {}) {
  addFinding(findings, {
    findingType, class: findingType.includes("NOT_COMPARABLE") ? "NOT_COMPARABLE" : "ERROR",
    module: pair.module, identityFingerprint: pair.identity.fingerprint, field,
    postgresReference: safeReference(pair.postgres), sheetsReference: safeReference(pair.sheets), ...values,
  });
}

function validDate(value) {
  return value && typeof value === "object" && typeof value.precision === "string" &&
    typeof value.timezoneKnown === "boolean" && (value.instant === null || typeof value.instant === "string") &&
    (value.local === null || typeof value.local === "string");
}

function compareDate(findings, pair, field, postgres, sheets) {
  if (!validDate(postgres) || !validDate(sheets)) throw new ParityInternalConsistencyError("Invalid canonical date");
  if (postgres.timezoneKnown !== sheets.timezoneKnown) {
    emit(findings, pair, "DATE_NOT_COMPARABLE", field,
      { class: "NOT_COMPARABLE", comparability: "AWARE_LOCAL", evidenceCode: "TIMEZONE_KNOWLEDGE_DIFFERS" });
    return;
  }
  if (postgres.precision !== sheets.precision) {
    emit(findings, pair, "FIELD_VALUE_MISMATCH", field, { evidenceCode: "DATE_PRECISION_DIFFERENCE" });
    return;
  }
  const equal = postgres.timezoneKnown ? postgres.instant === sheets.instant : postgres.local === sheets.local;
  if (!equal) emit(findings, pair, "FIELD_VALUE_MISMATCH", field, { evidenceCode: "DATE_CANONICAL_VALUE_DIFFERS" });
}

function compareField(findings, pair, field, postgresField = field, sheetsField = field) {
  const postgresState = stateFor(pair.postgres, postgresField);
  const sheetsState = stateFor(pair.sheets, sheetsField);
  if (NON_COMPARABLE_STATES.has(postgresState) || NON_COMPARABLE_STATES.has(sheetsState)) {
    emit(findings, pair, "FIELD_NOT_COMPARABLE", field, {
      postgresState, sheetsState, comparability: "UNSUPPORTED_OR_AMBIGUOUS", evidenceCode: "FIELD_STATE_NOT_COMPARABLE",
    });
    return;
  }
  if (postgresState !== sheetsState) {
    emit(findings, pair, "FIELD_STATE_MISMATCH", field, { postgresState, sheetsState, evidenceCode: "FIELD_STATES_DIFFER" });
    return;
  }
  if (postgresState !== "VALUE") return;
  const postgres = pair.postgres[postgresField];
  const sheets = pair.sheets[sheetsField];
  if (isDateField(field)) compareDate(findings, pair, field, postgres, sheets);
  else if (typeof postgres !== "string" || typeof sheets !== "string") throw new ParityInternalConsistencyError("Invalid comparable value");
  else if (postgres !== sheets) emit(findings, pair, "FIELD_VALUE_MISMATCH", field, { evidenceCode: "CANONICAL_VALUES_DIFFER" });
}

function meaningfulCollection(record, field, state) {
  if (state !== "VALUE") return false;
  const value = record[field];
  if (!value || typeof value !== "object" ||
      !(value.items === null || Array.isArray(value.items)) || !(value.raw === null || typeof value.raw === "string")) {
    throw new ParityInternalConsistencyError("Invalid canonical collection");
  }
  return (Array.isArray(value.items) && value.items.length > 0) || (typeof value.raw === "string" && value.raw.length > 0);
}

function compareCollections(findings, pair) {
  for (const field of CCTV_COLLECTION_FIELDS) {
    const postgresState = stateFor(pair.postgres, field);
    const sheetsState = stateFor(pair.sheets, field);
    if (meaningfulCollection(pair.postgres, field, postgresState) || meaningfulCollection(pair.sheets, field, sheetsState)) {
      emit(findings, pair, "FIELD_NOT_COMPARABLE", field, {
        postgresState, sheetsState, comparability: "CROSS_REPRESENTATION_COLLECTION",
        evidenceCode: "COLLECTION_REPRESENTATIONS_DIFFER",
      });
    } else if (postgresState !== sheetsState && !(postgresState === "EMPTY_ARRAY" && sheetsState === "EMPTY_STRING")) {
      emit(findings, pair, "FIELD_STATE_MISMATCH", field, { postgresState, sheetsState, evidenceCode: "FIELD_STATES_DIFFER" });
    }
  }
}

function attachmentCount(record) {
  if (record.attachments === null) return 0;
  if (!Array.isArray(record.attachments)) throw new ParityInternalConsistencyError("Invalid attachments");
  return record.attachments.length;
}

function compareCctvMetadata(findings, pair) {
  const classification = pair.sheets.cctvMetadataClassification;
  if (classification === "AMBIGUOUS" || classification === "CONFLICTING_EVIDENCE") {
    emit(findings, pair, classification === "AMBIGUOUS" ? "CCTV_METADATA_AMBIGUOUS" : "CCTV_METADATA_CONFLICT",
      "cctvMetadataClassification", { class: "NOT_COMPARABLE", comparability: "CCTV_METADATA",
        evidenceCode: classification });
    return;
  }
  if (classification === "CREATION_METADATA") {
    compareField(findings, pair, "owner");
    return;
  }
  if (classification === "PDF_METADATA") {
    const pgState = stateFor(pair.postgres, "attachments");
    const shState = stateFor(pair.sheets, "attachments");
    if (NON_COMPARABLE_STATES.has(pgState) || NON_COMPARABLE_STATES.has(shState)) {
      emit(findings, pair, "ATTACHMENT_NOT_COMPARABLE", "attachments", {
        postgresState: pgState, sheetsState: shState, comparability: "ATTACHMENT_STATE", evidenceCode: "ATTACHMENT_STATE_NOT_COMPARABLE",
      });
    } else if (attachmentCount(pair.postgres) !== attachmentCount(pair.sheets)) {
      emit(findings, pair, "ATTACHMENT_COUNT_MISMATCH", "attachments", {
        postgresState: pgState, sheetsState: shState, evidenceCode: "ATTACHMENT_COUNTS_DIFFER",
      });
    }
    return;
  }
  throw new ParityInternalConsistencyError("Unsupported CCTV metadata classification");
}

function comparePair(findings, pair) {
  const before = findings.length;
  if (!pair.comparable) return;
  for (const field of fieldsFor(pair.module)) compareField(findings, pair, field);
  if (pair.module === "cctv") {
    compareCollections(findings, pair);
    compareCctvMetadata(findings, pair);
  }
  if (findings.length - before > LIMITS.findingsPerMatchedRecord) throw new ParityLimitError("Matched-record finding limit exceeded");
}

module.exports = Object.freeze({ comparePair });
