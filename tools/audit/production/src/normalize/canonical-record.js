"use strict";

const { NormalizationInvalidFieldError } = require("../errors");
const { cloneAndFreeze } = require("./freeze");
const { fail } = require("./validation");

const CANONICAL_FIELDS = Object.freeze([
  "source", "recordType", "module", "ticketId", "orderNumber", "caseNumber", "status", "payloadStatus",
  "customerName", "customerPhone", "branch", "createdAt", "databaseCreatedAt", "updatedAt", "owner", "notes",
  "actionTaken", "attachments", "historyReference", "rowReference", "structuralFlags", "sourceMetadata",
  "departmentResponsible", "shift", "orderType", "restaurant", "channel", "feedbackDate", "issueCategory",
  "satisfaction", "complaintDetails", "cameras", "sections", "staff", "reviewType", "violatedPolicy",
  "cctvDate", "cctvTime", "discountAmount", "discountReason", "decisionMaker", "discountDate", "newOrderNumber",
  "deductionFrom", "caseDescription", "cctvColumnL", "cctvColumnM", "cctvMetadataClassification",
  "cctvMetadataEvidence", "previousStatus", "newStatus", "previousAction", "newAction", "changedBy", "changedAt",
]);

const STATE_FIELDS = Object.freeze(CANONICAL_FIELDS.filter((field) => ![
  "source", "recordType", "module", "structuralFlags", "sourceMetadata",
].includes(field)));

function canonicalRecord(values) {
  if (!values || typeof values !== "object") fail(NormalizationInvalidFieldError);
  let keys;
  try { keys = Reflect.ownKeys(values); } catch (_) { fail(NormalizationInvalidFieldError); }
  if (keys.some((key) => typeof key !== "string" || !CANONICAL_FIELDS.includes(key))) fail(NormalizationInvalidFieldError);
  const record = Object.create(null);
  for (const field of CANONICAL_FIELDS) {
    Object.defineProperty(record, field, {
      value: Object.hasOwn(values, field) ? values[field] : null,
      enumerable: true, writable: false, configurable: false,
    });
  }
  return cloneAndFreeze(record);
}

module.exports = { CANONICAL_FIELDS, STATE_FIELDS, canonicalRecord };
