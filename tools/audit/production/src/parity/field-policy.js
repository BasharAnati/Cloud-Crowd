"use strict";

const FIELD_POLICIES = Object.freeze({
  cctv: Object.freeze(["status", "branch", "createdAt", "reviewType", "notes", "actionTaken"]),
  "customer-experience": Object.freeze([
    "status", "departmentResponsible", "customerName", "customerPhone", "createdAt", "shift", "orderType",
    "branch", "restaurant", "channel", "feedbackDate", "issueCategory", "notes", "actionTaken", "satisfaction",
  ]),
  complaints: Object.freeze([
    "status", "departmentResponsible", "customerName", "customerPhone", "createdAt", "shift", "orderType",
    "branch", "restaurant", "channel", "issueCategory", "complaintDetails", "actionTaken",
  ]),
  "complimentary-orders": Object.freeze([
    "status", "customerName", "customerPhone", "createdAt", "discountAmount", "discountReason", "decisionMaker",
    "discountDate", "newOrderNumber", "deductionFrom", "caseDescription", "actionTaken",
  ]),
});

const CCTV_COLLECTION_FIELDS = Object.freeze(["cameras", "sections", "staff", "violatedPolicy"]);
const SOURCE_ONLY_FIELDS = Object.freeze({
  cctv: Object.freeze(["cctvDate", "cctvTime"]),
  "customer-experience": Object.freeze([]),
  complaints: Object.freeze([]),
  "complimentary-orders": Object.freeze(["channel"]),
});

function fieldsFor(module) { return FIELD_POLICIES[module]; }

function isDateField(field) {
  return field === "createdAt" || field === "feedbackDate" || field === "discountDate";
}

function fieldRole(module, field) {
  if (FIELD_POLICIES[module]?.includes(field)) return "COMPARABLE";
  if (SOURCE_ONLY_FIELDS[module]?.includes(field)) return "SOURCE_ONLY";
  return "NOT_COMPARABLE";
}

Object.freeze(fieldsFor);
Object.freeze(isDateField);
Object.freeze(fieldRole);

module.exports = Object.freeze({ CCTV_COLLECTION_FIELDS, fieldRole, fieldsFor, isDateField });
