"use strict";

function frozenLookup(entries) { return Object.freeze(Object.assign(Object.create(null), entries)); }

const MODULES = Object.freeze(["cctv", "customer-experience", "complaints", "complimentary-orders"]);
const MODULE_LABELS = frozenLookup({
  cctv: "CCTV",
  "customer-experience": "Customer Experience",
  complaints: "Complaints",
  "complimentary-orders": "Complimentary Orders",
});

const CLASSES = Object.freeze(["ERROR", "WARNING", "INFO", "NOT_COMPARABLE"]);
const CLASS_LABELS = frozenLookup({ ERROR: "Error", WARNING: "Warning", INFO: "Information", NOT_COMPARABLE: "Not comparable" });

const CATEGORIES = Object.freeze([
  "STRUCTURAL", "IDENTITY", "DUPLICATE", "PRESENCE", "FIELD", "NOT_COMPARABLE", "CCTV_METADATA", "ATTACHMENT",
]);
const CATEGORY_LABELS = frozenLookup({
  STRUCTURAL: "Structural",
  IDENTITY: "Identity",
  DUPLICATE: "Duplicate",
  PRESENCE: "Presence",
  FIELD: "Field mismatch",
  NOT_COMPARABLE: "Not comparable",
  CCTV_METADATA: "CCTV metadata",
  ATTACHMENT: "Attachment",
});

const TYPE_POLICIES = frozenLookup({
  MODULE_EMPTY: Object.freeze({ category: "STRUCTURAL", class: "INFO", label: "Module empty", descriptionCode: "MODULE_EMPTY", description: "The Google Sheets module is empty." }),
  MODULE_HEADER_ONLY: Object.freeze({ category: "STRUCTURAL", class: "INFO", label: "Header only", descriptionCode: "MODULE_HEADER_ONLY", description: "The Google Sheets module contains a header but no ticket rows." }),
  MODULE_STRUCTURE_WARNING: Object.freeze({ category: "STRUCTURAL", class: "WARNING", label: "Structure warning", descriptionCode: "MODULE_STRUCTURE_WARNING", description: "The Google Sheets module or row has a structural warning." }),
  MODULE_NOT_COMPARABLE: Object.freeze({ category: "STRUCTURAL", class: "NOT_COMPARABLE", label: "Module not comparable", descriptionCode: "MODULE_NOT_COMPARABLE", description: "Records in this module could not be matched safely because the identity structure is untrusted." }),
  MISSING_IDENTITY_KEY: Object.freeze({ category: "IDENTITY", class: "ERROR", label: "Missing identity key", descriptionCode: "MISSING_IDENTITY_KEY", description: "The record has no usable identity key." }),
  AMBIGUOUS_IDENTITY_SOURCE: Object.freeze({ category: "IDENTITY", class: "ERROR", label: "Ambiguous identity", descriptionCode: "AMBIGUOUS_IDENTITY_SOURCE", description: "The record identity cannot be determined unambiguously." }),
  DUPLICATE_POSTGRES_KEY: Object.freeze({ category: "DUPLICATE", class: "ERROR", label: "Duplicate PostgreSQL identity", descriptionCode: "DUPLICATE_POSTGRES_KEY", description: "Multiple PostgreSQL records share the same identity fingerprint." }),
  DUPLICATE_SHEET_KEY: Object.freeze({ category: "DUPLICATE", class: "ERROR", label: "Duplicate Sheet identity", descriptionCode: "DUPLICATE_SHEET_KEY", description: "Multiple Google Sheets records share the same identity fingerprint." }),
  DUPLICATE_BOTH_SOURCES: Object.freeze({ category: "DUPLICATE", class: "ERROR", label: "Duplicate identity in both sources", descriptionCode: "DUPLICATE_BOTH_SOURCES", description: "Both sources contain multiple records with the same identity fingerprint." }),
  AMBIGUOUS_MATCH_SET: Object.freeze({ category: "DUPLICATE", class: "ERROR", label: "Ambiguous match set", descriptionCode: "AMBIGUOUS_MATCH_SET", description: "The identity corresponds to an ambiguous set of records." }),
  POSTGRES_ONLY_RECORD: Object.freeze({ category: "PRESENCE", class: "ERROR", label: "PostgreSQL-only record", descriptionCode: "POSTGRES_ONLY_RECORD", description: "Present only in PostgreSQL." }),
  SHEET_ONLY_RECORD: Object.freeze({ category: "PRESENCE", class: "ERROR", label: "Sheet-only record", descriptionCode: "SHEET_ONLY_RECORD", description: "Present only in Google Sheets." }),
  FIELD_VALUE_MISMATCH: Object.freeze({ category: "FIELD", class: "ERROR", label: "Field value mismatch", descriptionCode: "FIELD_VALUE_MISMATCH", description: "Canonical field values differ between sources." }),
  FIELD_STATE_MISMATCH: Object.freeze({ category: "FIELD", class: "ERROR", label: "Field state mismatch", descriptionCode: "FIELD_STATE_MISMATCH", description: "Canonical field states differ between sources." }),
  FIELD_NOT_COMPARABLE: Object.freeze({ category: "NOT_COMPARABLE", class: "NOT_COMPARABLE", label: "Field not comparable", descriptionCode: "FIELD_NOT_COMPARABLE", description: "The field cannot be compared safely across source representations." }),
  DATE_NOT_COMPARABLE: Object.freeze({ category: "NOT_COMPARABLE", class: "NOT_COMPARABLE", label: "Date not comparable", descriptionCode: "DATE_NOT_COMPARABLE", description: "The date cannot be compared safely because source timezone knowledge differs." }),
  CCTV_METADATA_AMBIGUOUS: Object.freeze({ category: "CCTV_METADATA", class: "NOT_COMPARABLE", label: "CCTV metadata ambiguous", descriptionCode: "CCTV_METADATA_AMBIGUOUS", description: "CCTV metadata cannot be interpreted unambiguously." }),
  CCTV_METADATA_CONFLICT: Object.freeze({ category: "CCTV_METADATA", class: "NOT_COMPARABLE", label: "CCTV metadata conflict", descriptionCode: "CCTV_METADATA_CONFLICT", description: "CCTV metadata contains conflicting structural evidence." }),
  ATTACHMENT_COUNT_MISMATCH: Object.freeze({ category: "ATTACHMENT", class: "ERROR", label: "Attachment count mismatch", descriptionCode: "ATTACHMENT_COUNT_MISMATCH", description: "Attachment counts differ between sources." }),
  ATTACHMENT_NOT_COMPARABLE: Object.freeze({ category: "ATTACHMENT", class: "NOT_COMPARABLE", label: "Attachment not comparable", descriptionCode: "ATTACHMENT_NOT_COMPARABLE", description: "Attachment information cannot be compared safely." }),
});
const FINDING_TYPES = Object.freeze(Object.keys(TYPE_POLICIES));

const FIELD_LABELS = frozenLookup({
  status: "Status", branch: "Branch", createdAt: "Created at", reviewType: "Review type", notes: "Notes",
  actionTaken: "Action taken", departmentResponsible: "Department responsible", customerName: "Customer name",
  customerPhone: "Customer phone", shift: "Shift", orderType: "Order type", restaurant: "Restaurant", channel: "Channel",
  feedbackDate: "Feedback date", issueCategory: "Issue category", satisfaction: "Satisfaction",
  complaintDetails: "Complaint details", discountAmount: "Discount amount", discountReason: "Discount reason",
  decisionMaker: "Decision maker", discountDate: "Discount date", newOrderNumber: "New order number",
  deductionFrom: "Deduction from", caseDescription: "Case description", cameras: "Cameras", sections: "Sections",
  staff: "Staff", violatedPolicy: "Violated policy", owner: "Owner", attachments: "Attachments",
  cctvMetadataClassification: "CCTV metadata classification",
});

const STATE_LABELS = frozenLookup({
  MISSING: "Missing", EXPLICIT_NULL: "Explicit null", EMPTY_STRING: "Empty string", EMPTY_ARRAY: "Empty array",
  OMITTED_TRAILING_CELL: "Omitted trailing cell", AMBIGUOUS: "Ambiguous", UNSUPPORTED: "Unsupported", VALUE: "Value",
});
const COMPARABILITY_LABELS = frozenLookup({
  IDENTITY_STRUCTURE_UNTRUSTED: "Identity structure untrusted", AWARE_LOCAL: "Timezone knowledge differs",
  UNSUPPORTED_OR_AMBIGUOUS: "Unsupported or ambiguous", CROSS_REPRESENTATION_COLLECTION: "Different collection representations",
  CCTV_METADATA: "CCTV metadata", ATTACHMENT_STATE: "Attachment state",
});
const EVIDENCE_LABELS = frozenLookup({
  EMPTY_SHEET: "Empty Sheet", HEADER_ONLY: "Header only", HEADER_WIDTH_MISMATCH: "Header width mismatch",
  UNKNOWN_HEADER: "Unknown header", UNKNOWN_TRAILING_COLUMNS: "Unknown trailing columns", SHORT_ROW: "Short row",
  WIDE_ROW: "Wide row", ROW_WIDTH_MISMATCH: "Row width mismatch", TRAILING_CELLS_OMITTED: "Trailing cells omitted",
  CCTV_AMBIGUOUS_METADATA: "CCTV metadata ambiguous", CCTV_CONFLICTING_EVIDENCE: "CCTV evidence conflict",
  UNKNOWN_IDENTITY_POSITION: "Unknown identity position", CONFLICTING_IDENTITY_FIELDS: "Conflicting identity fields",
  UNUSABLE_IDENTITY_STATE: "Unusable identity state", NO_USABLE_IDENTITY: "No usable identity", NON_UNIQUE_IDENTITY: "Non-unique identity",
  MISSING_FROM_SHEETS: "Absent from Google Sheets", MISSING_FROM_POSTGRES: "Absent from PostgreSQL",
  TIMEZONE_KNOWLEDGE_DIFFERS: "Timezone knowledge differs", DATE_PRECISION_DIFFERENCE: "Date precision differs",
  DATE_CANONICAL_VALUE_DIFFERS: "Canonical date differs", FIELD_STATE_NOT_COMPARABLE: "Field state not comparable",
  FIELD_STATES_DIFFER: "Field states differ", CANONICAL_VALUES_DIFFER: "Canonical values differ",
  COLLECTION_REPRESENTATIONS_DIFFER: "Collection representations differ", AMBIGUOUS: "Ambiguous",
  CONFLICTING_EVIDENCE: "Conflicting evidence", ATTACHMENT_STATE_NOT_COMPARABLE: "Attachment state not comparable",
  ATTACHMENT_COUNTS_DIFFER: "Attachment counts differ", MISSING: "Missing", EXPLICIT_NULL: "Explicit null",
  EMPTY_STRING: "Empty string", EMPTY_ARRAY: "Empty array", OMITTED_TRAILING_CELL: "Omitted trailing cell", UNSUPPORTED: "Unsupported",
});

function lookup(table, code) { return typeof code === "string" && Object.hasOwn(table, code) ? table[code] : null; }
function moduleLabel(code) { return lookup(MODULE_LABELS, code); }
function categoryLabel(code) { return lookup(CATEGORY_LABELS, code); }
function classLabel(code) { return lookup(CLASS_LABELS, code); }
function fieldLabel(code) { return lookup(FIELD_LABELS, code); }
function stateLabel(code) { return lookup(STATE_LABELS, code); }
function comparabilityLabel(code) { return lookup(COMPARABILITY_LABELS, code); }
function evidenceLabel(code) { return lookup(EVIDENCE_LABELS, code); }
function typePolicy(code) { return lookup(TYPE_POLICIES, code); }

for (const value of [moduleLabel, categoryLabel, classLabel, fieldLabel, stateLabel, comparabilityLabel, evidenceLabel, typePolicy]) Object.freeze(value);

module.exports = Object.freeze({
  CATEGORIES, CLASSES, FINDING_TYPES, MODULES,
  categoryLabel, classLabel, comparabilityLabel, evidenceLabel, fieldLabel, moduleLabel, stateLabel, typePolicy,
});
