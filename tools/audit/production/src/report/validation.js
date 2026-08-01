"use strict";

const { types } = require("node:util");
const {
  ReportInvalidFindingError, ReportInvalidSummaryError, ReportLimitError, ReportUntrustedInputError,
} = require("../errors");
const { verifyTrustedParityResult } = require("../parity/adapter");
const {
  CATEGORIES, CLASSES, FINDING_TYPES, MODULES, comparabilityLabel, evidenceLabel, fieldLabel, stateLabel, typePolicy,
} = require("./policy");

const LIMITS = Object.freeze({
  findings: 100_000,
  entries: 100_000,
  groups: 80,
  categorySections: 32,
  referencesPerSource: 10_000,
  referencesPerEntry: 20_000,
  descriptionBytes: 256,
  outputBytes: 48 * 1024 * 1024,
});
const FINDING_KEYS = Object.freeze([
  "findingType", "class", "module", "identityFingerprint", "field", "postgresReference", "sheetsReference",
  "postgresState", "sheetsState", "comparability", "evidenceCode", "counts", "postgresReferences", "sheetsReferences",
]);
const SUMMARY_SCALARS = Object.freeze([
  "postgresTickets", "sheetsTickets", "matchedUniquePairs", "postgresOnly", "sheetsOnly", "unmatchablePostgres",
  "unmatchableSheets", "duplicatePostgresGroups", "duplicateSheetsGroups", "duplicateBothGroups", "ambiguousMatchGroups",
  "fieldValueMismatches", "fieldStateMismatches", "notComparableFields", "structuralFindings",
]);
const SUMMARY_KEYS = Object.freeze([...SUMMARY_SCALARS, "findingsByModule", "findingsByType", "findingsByClass"]);
const PREFIXES = Object.freeze({
  cctv: "CCTV", "customer-experience": "CE", complaints: "COMPLAINTS", "complimentary-orders": "COMPLIMENTARY",
});
const ALL_MODULES = Object.freeze(["cctv", "customer-experience", "complaints", "complimentary-orders"]);
const CCTV_MODULE = Object.freeze(["cctv"]);
const NO_CODES = Object.freeze([]);
const ALL_STATES = Object.freeze([
  "MISSING", "EXPLICIT_NULL", "EMPTY_STRING", "EMPTY_ARRAY", "OMITTED_TRAILING_CELL", "AMBIGUOUS", "UNSUPPORTED", "VALUE",
]);
const COMPARABLE_FIELDS = Object.freeze({
  cctv: Object.freeze(["status", "branch", "createdAt", "reviewType", "notes", "actionTaken", "owner"]),
  "customer-experience": Object.freeze([
    "status", "departmentResponsible", "customerName", "customerPhone", "createdAt", "shift", "orderType", "branch",
    "restaurant", "channel", "feedbackDate", "issueCategory", "notes", "actionTaken", "satisfaction",
  ]),
  complaints: Object.freeze([
    "status", "departmentResponsible", "customerName", "customerPhone", "createdAt", "shift", "orderType", "branch",
    "restaurant", "channel", "issueCategory", "complaintDetails", "actionTaken",
  ]),
  "complimentary-orders": Object.freeze([
    "status", "customerName", "customerPhone", "createdAt", "discountAmount", "discountReason", "decisionMaker",
    "discountDate", "newOrderNumber", "deductionFrom", "caseDescription", "actionTaken",
  ]),
});
const COMPARABLE_AND_COLLECTION_FIELDS = Object.freeze({
  ...COMPARABLE_FIELDS,
  cctv: Object.freeze([...COMPARABLE_FIELDS.cctv, "cameras", "sections", "staff", "violatedPolicy"]),
});
const DATE_FIELDS = Object.freeze({
  cctv: Object.freeze(["createdAt"]),
  "customer-experience": Object.freeze(["createdAt", "feedbackDate"]),
  complaints: Object.freeze(["createdAt"]),
  "complimentary-orders": Object.freeze(["createdAt", "discountDate"]),
});
const COLLECTION_FIELDS = Object.freeze(["cameras", "sections", "staff", "violatedPolicy"]);
const GENERAL_STRUCTURAL_EVIDENCE = Object.freeze([
  "HEADER_WIDTH_MISMATCH", "UNKNOWN_HEADER", "UNKNOWN_TRAILING_COLUMNS", "SHORT_ROW", "WIDE_ROW",
  "ROW_WIDTH_MISMATCH", "TRAILING_CELLS_OMITTED",
]);
const CCTV_STRUCTURAL_EVIDENCE = Object.freeze([
  ...GENERAL_STRUCTURAL_EVIDENCE, "CCTV_AMBIGUOUS_METADATA", "CCTV_CONFLICTING_EVIDENCE",
]);
const STRUCTURAL_EVIDENCE_BY_MODULE = Object.freeze({
  cctv: CCTV_STRUCTURAL_EVIDENCE,
  "customer-experience": GENERAL_STRUCTURAL_EVIDENCE,
  complaints: GENERAL_STRUCTURAL_EVIDENCE,
  "complimentary-orders": GENERAL_STRUCTURAL_EVIDENCE,
});
const MISSING_IDENTITY_EVIDENCE_BY_MODULE = Object.freeze({
  cctv: Object.freeze(["MISSING", "EXPLICIT_NULL", "EMPTY_STRING", "OMITTED_TRAILING_CELL"]),
  "customer-experience": Object.freeze(["NO_USABLE_IDENTITY"]),
  complaints: Object.freeze(["NO_USABLE_IDENTITY"]),
  "complimentary-orders": Object.freeze(["NO_USABLE_IDENTITY"]),
});
const AMBIGUOUS_IDENTITY_EVIDENCE_BY_MODULE = Object.freeze({
  cctv: Object.freeze(["AMBIGUOUS", "UNSUPPORTED"]),
  "customer-experience": Object.freeze(["CONFLICTING_IDENTITY_FIELDS", "UNUSABLE_IDENTITY_STATE"]),
  complaints: Object.freeze(["CONFLICTING_IDENTITY_FIELDS", "UNUSABLE_IDENTITY_STATE"]),
  "complimentary-orders": Object.freeze(["CONFLICTING_IDENTITY_FIELDS", "UNUSABLE_IDENTITY_STATE"]),
});

function contract(values) {
  return Object.freeze({
    modules: values.modules,
    fields: values.fields || null,
    fingerprint: values.fingerprint,
    comparability: values.comparability || NO_CODES,
    evidence: values.evidence,
    evidenceByModule: values.evidenceByModule || null,
    states: values.states || NO_CODES,
    stateRule: values.stateRule || "forbidden",
    references: values.references,
    countRule: values.countRule || "forbidden",
  });
}

const FINDING_CONTRACTS = Object.freeze({
  MODULE_EMPTY: contract({ modules: ALL_MODULES, fingerprint: "forbidden", evidence: Object.freeze(["EMPTY_SHEET"]), references: "none" }),
  MODULE_HEADER_ONLY: contract({ modules: ALL_MODULES, fingerprint: "forbidden", evidence: Object.freeze(["HEADER_ONLY"]), references: "none" }),
  MODULE_STRUCTURE_WARNING: contract({
    modules: ALL_MODULES, fingerprint: "forbidden", references: "optional-sheet",
    evidence: CCTV_STRUCTURAL_EVIDENCE, evidenceByModule: STRUCTURAL_EVIDENCE_BY_MODULE,
  }),
  MODULE_NOT_COMPARABLE: contract({
    modules: ALL_MODULES, fingerprint: "forbidden", comparability: Object.freeze(["IDENTITY_STRUCTURE_UNTRUSTED"]),
    evidence: Object.freeze(["UNKNOWN_IDENTITY_POSITION"]), references: "none",
  }),
  MISSING_IDENTITY_KEY: contract({
    modules: ALL_MODULES, fingerprint: "forbidden", references: "exactly-one-single",
    evidence: Object.freeze(["MISSING", "EXPLICIT_NULL", "EMPTY_STRING", "OMITTED_TRAILING_CELL", "NO_USABLE_IDENTITY"]),
    evidenceByModule: MISSING_IDENTITY_EVIDENCE_BY_MODULE,
  }),
  AMBIGUOUS_IDENTITY_SOURCE: contract({
    modules: ALL_MODULES, fingerprint: "forbidden", references: "exactly-one-single",
    evidence: Object.freeze(["AMBIGUOUS", "UNSUPPORTED", "CONFLICTING_IDENTITY_FIELDS", "UNUSABLE_IDENTITY_STATE"]),
    evidenceByModule: AMBIGUOUS_IDENTITY_EVIDENCE_BY_MODULE,
  }),
  DUPLICATE_POSTGRES_KEY: contract({
    modules: ALL_MODULES, fingerprint: "required", evidence: Object.freeze(["NON_UNIQUE_IDENTITY"]),
    references: "duplicate-arrays", countRule: "postgres-duplicate",
  }),
  DUPLICATE_SHEET_KEY: contract({
    modules: ALL_MODULES, fingerprint: "required", evidence: Object.freeze(["NON_UNIQUE_IDENTITY"]),
    references: "duplicate-arrays", countRule: "sheets-duplicate",
  }),
  DUPLICATE_BOTH_SOURCES: contract({
    modules: ALL_MODULES, fingerprint: "required", evidence: Object.freeze(["NON_UNIQUE_IDENTITY"]),
    references: "duplicate-arrays", countRule: "both-duplicate",
  }),
  AMBIGUOUS_MATCH_SET: contract({
    modules: ALL_MODULES, fingerprint: "required", evidence: Object.freeze(["NON_UNIQUE_IDENTITY"]),
    references: "duplicate-arrays", countRule: "ambiguous-set",
  }),
  POSTGRES_ONLY_RECORD: contract({
    modules: ALL_MODULES, fingerprint: "required", evidence: Object.freeze(["MISSING_FROM_SHEETS"]), references: "postgres-single",
  }),
  SHEET_ONLY_RECORD: contract({
    modules: ALL_MODULES, fingerprint: "required", evidence: Object.freeze(["MISSING_FROM_POSTGRES"]), references: "sheets-single",
  }),
  FIELD_VALUE_MISMATCH: contract({
    modules: ALL_MODULES, fields: COMPARABLE_FIELDS, fingerprint: "required", references: "both-single",
    evidence: Object.freeze(["CANONICAL_VALUES_DIFFER", "DATE_PRECISION_DIFFERENCE", "DATE_CANONICAL_VALUE_DIFFERS"]),
  }),
  FIELD_STATE_MISMATCH: contract({
    modules: ALL_MODULES, fields: COMPARABLE_AND_COLLECTION_FIELDS, fingerprint: "required", references: "both-single",
    evidence: Object.freeze(["FIELD_STATES_DIFFER"]), states: ALL_STATES, stateRule: "field-state-mismatch",
  }),
  FIELD_NOT_COMPARABLE: contract({
    modules: ALL_MODULES, fields: COMPARABLE_AND_COLLECTION_FIELDS, fingerprint: "required", references: "both-single",
    comparability: Object.freeze(["UNSUPPORTED_OR_AMBIGUOUS", "CROSS_REPRESENTATION_COLLECTION"]),
    evidence: Object.freeze(["FIELD_STATE_NOT_COMPARABLE", "COLLECTION_REPRESENTATIONS_DIFFER"]),
    states: ALL_STATES, stateRule: "field-not-comparable",
  }),
  DATE_NOT_COMPARABLE: contract({
    modules: ALL_MODULES, fields: DATE_FIELDS, fingerprint: "required", references: "both-single",
    comparability: Object.freeze(["AWARE_LOCAL"]), evidence: Object.freeze(["TIMEZONE_KNOWLEDGE_DIFFERS"]),
  }),
  CCTV_METADATA_AMBIGUOUS: contract({
    modules: CCTV_MODULE, fields: Object.freeze({ cctv: Object.freeze(["cctvMetadataClassification"]) }), fingerprint: "required",
    comparability: Object.freeze(["CCTV_METADATA"]), evidence: Object.freeze(["AMBIGUOUS"]), references: "both-single",
  }),
  CCTV_METADATA_CONFLICT: contract({
    modules: CCTV_MODULE, fields: Object.freeze({ cctv: Object.freeze(["cctvMetadataClassification"]) }), fingerprint: "required",
    comparability: Object.freeze(["CCTV_METADATA"]), evidence: Object.freeze(["CONFLICTING_EVIDENCE"]), references: "both-single",
  }),
  ATTACHMENT_COUNT_MISMATCH: contract({
    modules: CCTV_MODULE, fields: Object.freeze({ cctv: Object.freeze(["attachments"]) }), fingerprint: "required",
    evidence: Object.freeze(["ATTACHMENT_COUNTS_DIFFER"]), states: ALL_STATES, stateRule: "attachment-comparable", references: "both-single",
  }),
  ATTACHMENT_NOT_COMPARABLE: contract({
    modules: CCTV_MODULE, fields: Object.freeze({ cctv: Object.freeze(["attachments"]) }), fingerprint: "required",
    comparability: Object.freeze(["ATTACHMENT_STATE"]), evidence: Object.freeze(["ATTACHMENT_STATE_NOT_COMPARABLE"]),
    states: ALL_STATES, stateRule: "attachment-not-comparable", references: "both-single",
  }),
});

function fail(ErrorClass) { throw new ErrorClass("Audit report validation failed"); }

function ownData(object, key, ErrorClass) {
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(object, key); } catch (_) { fail(ErrorClass); }
  if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.get || descriptor.set) fail(ErrorClass);
  return descriptor.value;
}

function exactObject(object, keys, ErrorClass) {
  if (!object || typeof object !== "object" || types.isProxy(object) || Object.getPrototypeOf(object) !== null || !Object.isFrozen(object)) fail(ErrorClass);
  let actual;
  try { actual = Reflect.ownKeys(object); } catch (_) { fail(ErrorClass); }
  if (actual.length !== keys.length || keys.some((key) => !actual.includes(key)) || actual.some((key) => typeof key !== "string")) fail(ErrorClass);
  for (const key of keys) ownData(object, key, ErrorClass);
  return object;
}

function integer(value, maximum, ErrorClass) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(ErrorClass);
  return value;
}

function reference(value, ErrorClass) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value) || value.length > 32) fail(ErrorClass);
  return value;
}

function denseFrozenArray(array, maximum, ErrorClass) {
  if (!Array.isArray(array) || types.isProxy(array) || Object.getPrototypeOf(array) !== Array.prototype || !Object.isFrozen(array) || array.length > maximum) fail(ErrorClass);
  for (let index = 0; index < array.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.get || descriptor.set) fail(ErrorClass);
  }
  return array;
}

function referenceArray(value, ErrorClass) {
  const array = denseFrozenArray(value, LIMITS.referencesPerSource, ErrorClass);
  for (const item of array) reference(item, ErrorClass);
  return array;
}

function nullableCode(value, lookup, ErrorClass) {
  if (value === null) return null;
  if (typeof value !== "string" || lookup(value) === null) fail(ErrorClass);
  return value;
}

function validateFingerprint(value, module, rule, ErrorClass) {
  if (value === null && rule === "forbidden") return;
  if (rule !== "required") fail(ErrorClass);
  if (typeof value !== "string" || !new RegExp(`^${PREFIXES[module]}-[0-9a-f]{24}$`).test(value)) fail(ErrorClass);
}

function validateField(field, module, contractValue, ErrorClass) {
  if (contractValue.fields === null) {
    if (field !== null) fail(ErrorClass);
    return;
  }
  const allowed = contractValue.fields[module];
  if (typeof field !== "string" || !allowed || !allowed.includes(field)) fail(ErrorClass);
}

function validateEvidenceForModule(contractValue, module, evidence, ErrorClass) {
  if (!contractValue.evidence.includes(evidence)) fail(ErrorClass);
  if (contractValue.evidenceByModule !== null) {
    const allowed = Object.hasOwn(contractValue.evidenceByModule, module) ? contractValue.evidenceByModule[module] : null;
    if (!allowed || !allowed.includes(evidence)) fail(ErrorClass);
  }
}

function validateStates(contractValue, field, postgresState, sheetsState, ErrorClass) {
  if (contractValue.stateRule === "forbidden") {
    if (postgresState !== null || sheetsState !== null) fail(ErrorClass);
    return;
  }
  if (!contractValue.states.includes(postgresState) || !contractValue.states.includes(sheetsState)) fail(ErrorClass);
  const nonComparable = (state) => state === "AMBIGUOUS" || state === "UNSUPPORTED";
  const collection = COLLECTION_FIELDS.includes(field);
  if (!collection && field !== "attachments" && (postgresState === "EMPTY_ARRAY" || sheetsState === "EMPTY_ARRAY")) fail(ErrorClass);
  if (contractValue.stateRule === "field-state-mismatch") {
    if (postgresState === sheetsState) fail(ErrorClass);
    if (collection) {
      if (postgresState === "VALUE" || sheetsState === "VALUE" ||
          (postgresState === "EMPTY_ARRAY" && sheetsState === "EMPTY_STRING") ||
          (postgresState === "EMPTY_STRING" && sheetsState === "EMPTY_ARRAY")) fail(ErrorClass);
    } else if (nonComparable(postgresState) || nonComparable(sheetsState)) fail(ErrorClass);
  } else if (contractValue.stateRule === "field-not-comparable") {
    if (collection) {
      if (postgresState !== "VALUE" && sheetsState !== "VALUE") fail(ErrorClass);
    } else if (!nonComparable(postgresState) && !nonComparable(sheetsState)) fail(ErrorClass);
  } else if (contractValue.stateRule === "attachment-comparable") {
    const postgresAllowed = ["MISSING", "EMPTY_ARRAY", "VALUE"];
    const sheetsAllowed = ["EMPTY_ARRAY", "VALUE"];
    if (!postgresAllowed.includes(postgresState) || !sheetsAllowed.includes(sheetsState) ||
        (postgresState !== "VALUE" && sheetsState !== "VALUE")) fail(ErrorClass);
  } else if (contractValue.stateRule === "attachment-not-comparable") {
    if (!["MISSING", "EMPTY_ARRAY", "VALUE"].includes(postgresState) || sheetsState !== "AMBIGUOUS") fail(ErrorClass);
  } else fail(ErrorClass);
}

function validateSingleReferences(rule, postgresReference, sheetsReference, ErrorClass) {
  const postgres = postgresReference !== null;
  const sheets = sheetsReference !== null;
  if (rule === "none" && (postgres || sheets)) fail(ErrorClass);
  else if (rule === "optional-sheet" && postgres) fail(ErrorClass);
  else if (rule === "exactly-one-single" && postgres === sheets) fail(ErrorClass);
  else if (rule === "postgres-single" && (!postgres || sheets)) fail(ErrorClass);
  else if (rule === "sheets-single" && (postgres || !sheets)) fail(ErrorClass);
  else if (rule === "both-single" && (!postgres || !sheets)) fail(ErrorClass);
  else if (!["none", "optional-sheet", "exactly-one-single", "postgres-single", "sheets-single", "both-single", "duplicate-arrays"].includes(rule)) fail(ErrorClass);
}

function validateDuplicateCounts(rule, postgresCount, sheetsCount, ErrorClass) {
  if (rule === "postgres-duplicate" && (postgresCount < 2 || sheetsCount > 1)) fail(ErrorClass);
  else if (rule === "sheets-duplicate" && (sheetsCount < 2 || postgresCount > 1)) fail(ErrorClass);
  else if (rule === "both-duplicate" && (postgresCount < 2 || sheetsCount < 2)) fail(ErrorClass);
  else if (rule === "ambiguous-set" && (postgresCount < 1 || sheetsCount < 1 || postgresCount + sheetsCount < 3)) fail(ErrorClass);
  else if (!["postgres-duplicate", "sheets-duplicate", "both-duplicate", "ambiguous-set"].includes(rule)) fail(ErrorClass);
}

function validateEvidenceRelationships(type, field, comparability, evidence, postgresReference, sheetsReference, ErrorClass) {
  const dateField = field === "createdAt" || field === "feedbackDate" || field === "discountDate";
  const collectionField = COLLECTION_FIELDS.includes(field);
  if (type === "FIELD_VALUE_MISMATCH") {
    if (dateField !== (evidence === "DATE_PRECISION_DIFFERENCE" || evidence === "DATE_CANONICAL_VALUE_DIFFERS")) fail(ErrorClass);
  }
  if (type === "FIELD_NOT_COMPARABLE") {
    if (collectionField) {
      if (comparability !== "CROSS_REPRESENTATION_COLLECTION" || evidence !== "COLLECTION_REPRESENTATIONS_DIFFER") fail(ErrorClass);
    } else if (comparability !== "UNSUPPORTED_OR_AMBIGUOUS" || evidence !== "FIELD_STATE_NOT_COMPARABLE") fail(ErrorClass);
  }
  if (type === "MODULE_STRUCTURE_WARNING") {
    const rowOnly = ["SHORT_ROW", "WIDE_ROW", "ROW_WIDTH_MISMATCH", "TRAILING_CELLS_OMITTED", "CCTV_CONFLICTING_EVIDENCE"];
    const moduleOnly = ["HEADER_WIDTH_MISMATCH", "UNKNOWN_HEADER"];
    if ((rowOnly.includes(evidence) && sheetsReference === null) ||
        (moduleOnly.includes(evidence) && sheetsReference !== null) || postgresReference !== null) fail(ErrorClass);
  }
}

function validateFinding(finding) {
  const ErrorClass = ReportInvalidFindingError;
  exactObject(finding, FINDING_KEYS, ErrorClass);
  const type = ownData(finding, "findingType", ErrorClass);
  const policy = typePolicy(type);
  const contractValue = FINDING_CONTRACTS[type];
  const findingClass = ownData(finding, "class", ErrorClass);
  const module = ownData(finding, "module", ErrorClass);
  if (!policy || !contractValue || findingClass !== policy.class || !contractValue.modules.includes(module)) fail(ErrorClass);
  const fingerprint = ownData(finding, "identityFingerprint", ErrorClass);
  validateFingerprint(fingerprint, module, contractValue.fingerprint, ErrorClass);
  const field = nullableCode(ownData(finding, "field", ErrorClass), fieldLabel, ErrorClass);
  const postgresState = nullableCode(ownData(finding, "postgresState", ErrorClass), stateLabel, ErrorClass);
  const sheetsState = nullableCode(ownData(finding, "sheetsState", ErrorClass), stateLabel, ErrorClass);
  const comparability = nullableCode(ownData(finding, "comparability", ErrorClass), comparabilityLabel, ErrorClass);
  const evidence = nullableCode(ownData(finding, "evidenceCode", ErrorClass), evidenceLabel, ErrorClass);
  validateField(field, module, contractValue, ErrorClass);
  validateEvidenceForModule(contractValue, module, evidence, ErrorClass);
  if ((contractValue.comparability.length === 0 && comparability !== null) ||
      (contractValue.comparability.length > 0 && !contractValue.comparability.includes(comparability))) fail(ErrorClass);
  validateStates(contractValue, field, postgresState, sheetsState, ErrorClass);
  const postgresReference = ownData(finding, "postgresReference", ErrorClass);
  const sheetsReference = ownData(finding, "sheetsReference", ErrorClass);
  if (postgresReference !== null) reference(postgresReference, ErrorClass);
  if (sheetsReference !== null) reference(sheetsReference, ErrorClass);
  validateSingleReferences(contractValue.references, postgresReference, sheetsReference, ErrorClass);
  validateEvidenceRelationships(type, field, comparability, evidence, postgresReference, sheetsReference, ErrorClass);
  const postgresReferences = ownData(finding, "postgresReferences", ErrorClass);
  const sheetsReferences = ownData(finding, "sheetsReferences", ErrorClass);
  const counts = ownData(finding, "counts", ErrorClass);
  if (contractValue.references === "duplicate-arrays") {
    if (postgresReference !== null || sheetsReference !== null || postgresReferences === null || sheetsReferences === null || counts === null) fail(ErrorClass);
    referenceArray(postgresReferences, ErrorClass);
    referenceArray(sheetsReferences, ErrorClass);
    if (postgresReferences.length + sheetsReferences.length > LIMITS.referencesPerEntry) fail(ReportLimitError);
    exactObject(counts, ["postgres", "sheets"], ErrorClass);
    const postgresCount = integer(ownData(counts, "postgres", ErrorClass), LIMITS.referencesPerSource, ErrorClass);
    const sheetsCount = integer(ownData(counts, "sheets", ErrorClass), LIMITS.referencesPerSource, ErrorClass);
    if (postgresCount !== postgresReferences.length || sheetsCount !== sheetsReferences.length) fail(ErrorClass);
    validateDuplicateCounts(contractValue.countRule, postgresCount, sheetsCount, ErrorClass);
  } else if (postgresReferences !== null || sheetsReferences !== null || counts !== null) fail(ErrorClass);
  if (contractValue.countRule === "forbidden" && counts !== null) fail(ErrorClass);
  return finding;
}

function validateCountMap(map, keys, findings, selector) {
  const ErrorClass = ReportInvalidSummaryError;
  exactObject(map, keys, ErrorClass);
  let total = 0;
  for (const key of keys) {
    const value = integer(ownData(map, key, ErrorClass), LIMITS.findings, ErrorClass);
    if (value !== findings.filter((finding) => selector(finding) === key).length) fail(ErrorClass);
    total += value;
  }
  if (total !== findings.length) fail(ErrorClass);
}

function typeCount(findings, type) { return findings.reduce((count, finding) => count + (finding.findingType === type ? 1 : 0), 0); }

function validateSummary(summary, findings) {
  const ErrorClass = ReportInvalidSummaryError;
  exactObject(summary, SUMMARY_KEYS, ErrorClass);
  for (const key of SUMMARY_SCALARS) integer(ownData(summary, key, ErrorClass), LIMITS.findings, ErrorClass);
  validateCountMap(ownData(summary, "findingsByModule", ErrorClass), MODULES, findings, (finding) => finding.module);
  validateCountMap(ownData(summary, "findingsByType", ErrorClass), FINDING_TYPES, findings, (finding) => finding.findingType);
  validateCountMap(ownData(summary, "findingsByClass", ErrorClass), CLASSES, findings, (finding) => finding.class);
  const expected = {
    postgresOnly: typeCount(findings, "POSTGRES_ONLY_RECORD"), sheetsOnly: typeCount(findings, "SHEET_ONLY_RECORD"),
    duplicatePostgresGroups: typeCount(findings, "DUPLICATE_POSTGRES_KEY"), duplicateSheetsGroups: typeCount(findings, "DUPLICATE_SHEET_KEY"),
    duplicateBothGroups: typeCount(findings, "DUPLICATE_BOTH_SOURCES"), fieldValueMismatches: typeCount(findings, "FIELD_VALUE_MISMATCH"),
    fieldStateMismatches: typeCount(findings, "FIELD_STATE_MISMATCH"),
    notComparableFields: typeCount(findings, "FIELD_NOT_COMPARABLE") + typeCount(findings, "DATE_NOT_COMPARABLE") + typeCount(findings, "ATTACHMENT_NOT_COMPARABLE"),
    structuralFindings: ["MODULE_EMPTY", "MODULE_HEADER_ONLY", "MODULE_STRUCTURE_WARNING", "MODULE_NOT_COMPARABLE"]
      .reduce((count, type) => count + typeCount(findings, type), 0),
  };
  for (const [key, value] of Object.entries(expected)) if (summary[key] !== value) fail(ErrorClass);
  if (summary.ambiguousMatchGroups !== summary.duplicatePostgresGroups + summary.duplicateSheetsGroups + summary.duplicateBothGroups) fail(ErrorClass);
  return summary;
}

function validateParityResult(result) {
  try { verifyTrustedParityResult(result); } catch (_) { fail(ReportUntrustedInputError); }
  exactObject(result, ["findings", "summary"], ReportUntrustedInputError);
  const findings = denseFrozenArray(ownData(result, "findings", ReportUntrustedInputError), LIMITS.findings, ReportUntrustedInputError);
  for (const finding of findings) validateFinding(finding);
  const summary = validateSummary(ownData(result, "summary", ReportUntrustedInputError), findings);
  return Object.freeze({ findings, summary });
}

module.exports = Object.freeze({ LIMITS, SUMMARY_SCALARS, validateParityResult });
