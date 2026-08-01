"use strict";

const { types } = require("node:util");
const {
  NormalizationBundleConsistencyError,
  NormalizationBundleLimitError,
  NormalizationIncompletePostgresError,
  NormalizationIncompleteSheetsError,
  NormalizationInvalidPageSetError,
  NormalizationMalformedRecordError,
  NormalizationProvenanceError,
  NormalizationUnsupportedSnapshotError,
  NormalizationUntrustedSnapshotError,
  classifyError,
} = require("../errors");
const {
  verifySameTrustedPostgresTicketScan,
  verifyTrustedPostgresSnapshot,
} = require("../postgres/adapter");
const { verifyTrustedSheetsSnapshot } = require("../sheets/adapter");
const { canonicalRecord } = require("./canonical-record");
const {
  FIELD_STATES,
  normalizeAttachment,
  normalizeDate,
  normalizeIdentifier,
  normalizeRowReference,
  normalizeString,
  normalizeStringArray,
  stringState,
} = require("./field-normalizers");
const {
  assertAllowedKeys,
  assertDenseArray,
  assertExactKeys,
  assertPlainObject,
  dataValue,
  fail,
  optionalDataValue,
} = require("./validation");

const MISSING = Symbol("missing-normalization-field");
const CANONICAL_RECORDS = new WeakSet();
const NORMALIZED_RESULTS = new WeakMap();
const CANONICAL_BUNDLES = new WeakMap();
const PARITY_MODULES = Object.freeze([
  "cctv",
  "customer-experience",
  "complaints",
  "complimentary-orders",
]);
const PARITY_MODULE_SET = new Set(PARITY_MODULES);
const BUNDLE_LIMITS = Object.freeze({
  postgresPages: 10_000,
  postgresTickets: 40_000,
  ticketsPerModule: 10_000,
});
const POSTGRES_TICKET_KEYS = Object.freeze(["id", "section", "status", "payload", "created_at", "updated_at"]);
const POSTGRES_HISTORY_KEYS = Object.freeze([
  "id", "ticket_id", "section", "changed_by", "prev_status", "new_status",
  "prev_action", "new_action", "changed_at",
]);
const SHEET_ROW_KEYS = Object.freeze([
  "physicalRowNumber", "cells", "returnedWidth", "configuredWidth", "trailingOmissionCount", "structuralFlags",
]);
const SHEET_ROW_OPTIONAL_KEYS = Object.freeze(["cctvMetadata"]);

const COMMON_PAYLOAD_FIELDS = Object.freeze(["actionTaken", "caseNumber", "orderNumber", "status", "createdBy"]);
const POSTGRES_MODULES = Object.freeze({
  cctv: Object.freeze({
    key: "cctv",
    fields: Object.freeze(["branch", "cameras", "cctvPdf", "date", "dateTime", "notes", "reviewType", "sections", "staff", "time", "violations"]),
  }),
  ce: Object.freeze({
    key: "customer-experience",
    fields: Object.freeze(["branch", "channel", "creationDate", "customerName", "customerNotes", "department", "feedbackDate", "issueCategory", "orderType", "phone", "restaurant", "satisfaction", "shift"]),
  }),
  complaints: Object.freeze({
    key: "complaints",
    fields: Object.freeze(["branch", "channel", "complaintDetails", "creationDate", "customerName", "department", "issueCategory", "orderType", "phone", "restaurant", "shift"]),
  }),
  "free-orders": Object.freeze({
    key: "complimentary-orders",
    fields: Object.freeze(["attached", "caseDescription", "channel", "customerName", "decisionMaker", "deductionFrom", "discountAmount", "discountDate", "newOrderNumber", "orderDate", "orderOnCirca", "phone", "reasonForDiscount"]),
  }),
});

const SHEET_MODULES = Object.freeze({
  CCTV: Object.freeze({
    key: "cctv", width: 13,
    mappings: Object.freeze([
      [0, "status", "token"], [1, "branch", "token"], [2, "createdAt", "date"], [3, "cameras", "collection-string"],
      [4, "sections", "collection-string"], [5, "staff", "collection-string"], [6, "reviewType", "string"], [7, "violatedPolicy", "collection-string"],
      [8, "notes", "string"], [9, "actionTaken", "string"], [10, "caseNumber", "token"],
      [11, "cctvColumnL", "string"], [12, "cctvColumnM", "string"],
    ]),
  }),
  "Customer Experience": Object.freeze({
    key: "customer-experience", width: 16,
    mappings: Object.freeze([
      [0, "status", "token"], [1, "departmentResponsible", "string"], [2, "customerName", "string"],
      [3, "customerPhone", "token"], [4, "createdAt", "date"], [5, "shift", "string"], [6, "orderType", "string"],
      [7, "branch", "token"], [8, "restaurant", "string"], [9, "channel", "string"], [10, "feedbackDate", "date"],
      [11, "issueCategory", "string"], [12, "notes", "string"], [13, "actionTaken", "string"],
      [14, "satisfaction", "string"], [15, "orderNumber", "token"],
    ]),
  }),
  Complaints: Object.freeze({
    key: "complaints", width: 14,
    mappings: Object.freeze([
      [0, "status", "token"], [1, "departmentResponsible", "string"], [2, "customerName", "string"],
      [3, "customerPhone", "token"], [4, "createdAt", "date"], [5, "shift", "string"], [6, "orderType", "string"],
      [7, "branch", "token"], [8, "restaurant", "string"], [9, "channel", "string"], [10, "issueCategory", "string"],
      [11, "complaintDetails", "string"], [12, "actionTaken", "string"], [13, "orderNumber", "token"],
    ]),
  }),
  "Complimentary Orders": Object.freeze({
    key: "complimentary-orders", width: 13,
    mappings: Object.freeze([
      [0, "status", "token"], [1, "customerName", "string"], [2, "customerPhone", "token"], [3, "createdAt", "date"],
      [4, "discountAmount", "string"], [5, "discountReason", "string"], [6, "decisionMaker", "string"],
      [7, "discountDate", "date"], [8, "newOrderNumber", "token"], [9, "deductionFrom", "string"],
      [10, "caseDescription", "string"], [11, "actionTaken", "string"], [12, "orderNumber", "token"],
    ]),
  }),
});

function isTrustedNormalizationError(error) {
  return classifyError(error).publicCode.startsWith("NORMALIZATION_");
}

function withinBoundary(operation, ErrorClass = NormalizationMalformedRecordError) {
  try { return operation(); } catch (error) {
    if (isTrustedNormalizationError(error)) throw error;
    throw new ErrorClass("Normalization failed");
  }
}

function verifyPostgres(snapshot) {
  try { verifyTrustedPostgresSnapshot(snapshot); } catch (_) { throw new NormalizationUntrustedSnapshotError("Untrusted snapshot"); }
}

function verifySheets(snapshot) {
  try { verifyTrustedSheetsSnapshot(snapshot); } catch (_) { throw new NormalizationUntrustedSnapshotError("Untrusted snapshot"); }
}

function verifyTrustedCanonicalRecord(record) {
  return CANONICAL_RECORDS.has(record);
}

function verifyTrustedNormalizedResult(result) {
  const metadata = NORMALIZED_RESULTS.get(result);
  if (!metadata) throw new TypeError("Normalized result is not trusted");
  return result;
}

function verifyTrustedCanonicalBundle(bundle) {
  const metadata = CANONICAL_BUNDLES.get(bundle);
  if (!metadata || metadata.postgresComplete !== true || metadata.sheetsComplete !== true ||
      metadata.allModulesRepresented !== true || metadata.postgresTicketOnly !== true) {
    throw new TypeError("Canonical parity bundle is not trusted");
  }
  return bundle;
}

function uniqueValues(records, field) {
  const output = [];
  for (const record of records) if (!output.includes(record[field])) output.push(record[field]);
  return Object.freeze(output);
}

function registerNormalizedResult(result, metadata) {
  const safeMetadata = Object.freeze({
    producer: metadata.producer,
    normalizedSource: metadata.normalizedSource,
    recordTypes: metadata.recordTypes || uniqueValues(result, "recordType"),
    representedModules: metadata.representedModules || uniqueValues(result, "module"),
    recordCount: result.length,
    ticketCount: result.filter((record) => record.recordType === "ticket").length,
    historyCount: result.filter((record) => record.recordType === "history").length,
    moduleRecordCount: result.filter((record) => record.recordType === "module").length,
    sourceSnapshotKind: metadata.sourceSnapshotKind,
    completenessState: metadata.completenessState,
    page: metadata.page || null,
  });
  for (const record of result) CANONICAL_RECORDS.add(record);
  NORMALIZED_RESULTS.set(result, safeMetadata);
  return result;
}

function postgresPagination(snapshot) {
  const pagination = dataValue(snapshot, "pagination");
  assertExactKeys(pagination, [
    "kind", "requestedCursor", "section", "limit", "returnedCount", "firstId", "lastId", "nextCursor", "exhausted",
  ]);
  const metadata = {
    kind: dataValue(pagination, "kind"),
    requestedCursor: dataValue(pagination, "requestedCursor"),
    section: dataValue(pagination, "section"),
    limit: dataValue(pagination, "limit"),
    returnedCount: dataValue(pagination, "returnedCount"),
    firstId: dataValue(pagination, "firstId"),
    lastId: dataValue(pagination, "lastId"),
    nextCursor: dataValue(pagination, "nextCursor"),
    exhausted: dataValue(pagination, "exhausted"),
  };
  if (metadata.kind !== "tickets" || !Number.isSafeInteger(metadata.limit) || metadata.limit <= 0 ||
      !Number.isSafeInteger(metadata.returnedCount) || metadata.returnedCount < 0 ||
      (metadata.requestedCursor !== null && typeof metadata.requestedCursor !== "string") ||
      (metadata.section !== null && typeof metadata.section !== "string") ||
      (metadata.firstId !== null && typeof metadata.firstId !== "string") ||
      (metadata.lastId !== null && typeof metadata.lastId !== "string") ||
      (metadata.nextCursor !== null && typeof metadata.nextCursor !== "string") ||
      typeof metadata.exhausted !== "boolean" || metadata.nextCursor !== dataValue(snapshot, "nextCursor")) fail();
  return Object.freeze(metadata);
}

function initialStates() {
  return {};
}

function setCollectionValue(values, states, field, raw, kind) {
  const collection = { raw: null, items: null };
  values[field] = collection;
  if (raw === MISSING) {
    states[field] = FIELD_STATES.MISSING;
  } else if (raw === null) {
    states[field] = FIELD_STATES.EXPLICIT_NULL;
  } else if (kind === "collection-array") {
    collection.items = normalizeStringArray(raw);
    states[field] = collection.items.length === 0 ? FIELD_STATES.EMPTY_ARRAY : FIELD_STATES.VALUE;
  } else {
    collection.raw = normalizeString(raw);
    states[field] = stringState(collection.raw);
  }
}

function setValue(values, states, field, raw, kind = "string") {
  if (kind === "collection-array" || kind === "collection-string") {
    setCollectionValue(values, states, field, raw, kind);
    return;
  }
  if (raw === MISSING) {
    values[field] = null;
    states[field] = FIELD_STATES.MISSING;
    return;
  }
  if (raw === null) {
    values[field] = null;
    states[field] = FIELD_STATES.EXPLICIT_NULL;
    return;
  }
  if (kind === "date") {
    const normalizedText = normalizeString(raw, true);
    values[field] = normalizedText === "" ? null : normalizeDate(raw);
    states[field] = normalizedText === "" ? FIELD_STATES.EMPTY_STRING : FIELD_STATES.VALUE;
    return;
  }
  if (kind === "array") {
    values[field] = normalizeStringArray(raw);
    states[field] = values[field].length === 0 ? FIELD_STATES.EMPTY_ARRAY : FIELD_STATES.VALUE;
    return;
  }
  const normalized = normalizeString(raw, kind === "token");
  values[field] = normalized;
  states[field] = stringState(normalized);
}

function setPayloadField(values, states, payload, sourceField, canonicalField, kind = "string") {
  const raw = optionalDataValue(payload, sourceField);
  setValue(values, states, canonicalField, raw === undefined ? MISSING : raw, kind);
}

function attachmentState(value) {
  if (value === undefined) return FIELD_STATES.MISSING;
  if (value === null) return FIELD_STATES.EXPLICIT_NULL;
  return FIELD_STATES.VALUE;
}

function setPostgresAttachments(values, states, payload, fields) {
  const attachments = [];
  const attachmentFieldStates = {};
  let supported = false;
  let present = false;
  for (const field of fields) {
    supported = true;
    const raw = optionalDataValue(payload, field);
    attachmentFieldStates[field] = attachmentState(raw);
    if (raw !== undefined) present = true;
    if (raw !== undefined && raw !== null) attachments.push(normalizeAttachment(raw));
  }
  if (!supported) {
    values.attachments = null;
  } else if (!present) {
    values.attachments = null;
    states.attachments = FIELD_STATES.MISSING;
  } else {
    values.attachments = attachments;
    states.attachments = attachments.length === 0 ? FIELD_STATES.EMPTY_ARRAY : FIELD_STATES.VALUE;
  }
  return attachmentFieldStates;
}

function postgresMetadata(states, attachmentFieldStates) {
  return {
    fieldStates: states,
    attachmentFieldStates,
    snapshotStructuralFlags: [], headerStructuralFlags: [], rowStructuralFlags: [],
    trailingOmissionCount: null, returnedWidth: null, configuredWidth: null,
    headerReturnedWidth: null, maximumDetectedWidth: null,
  };
}

function assertApprovedPayload(payload, module) {
  assertPlainObject(payload);
  const allowed = new Set([...COMMON_PAYLOAD_FIELDS, ...module.fields]);
  if (Reflect.ownKeys(payload).some((field) => typeof field !== "string" || !allowed.has(field))) fail();
}

function normalizePostgresTicket(row) {
  assertExactKeys(row, POSTGRES_TICKET_KEYS);
  const section = normalizeIdentifier(dataValue(row, "section"));
  const module = POSTGRES_MODULES[section];
  if (!module) fail();
  const payload = dataValue(row, "payload");
  assertApprovedPayload(payload, module);
  const values = { source: "postgresql", recordType: "ticket", module: module.key, structuralFlags: [] };
  const states = initialStates();
  setValue(values, states, "ticketId", dataValue(row, "id"), "token");
  setValue(values, states, "status", dataValue(row, "status"), "token");
  setValue(values, states, "databaseCreatedAt", dataValue(row, "created_at"), "date");
  setValue(values, states, "updatedAt", dataValue(row, "updated_at"), "date");
  setPayloadField(values, states, payload, "orderNumber", "orderNumber", "token");
  setPayloadField(values, states, payload, "caseNumber", "caseNumber", "token");
  setPayloadField(values, states, payload, "status", "payloadStatus", "token");
  setPayloadField(values, states, payload, "createdBy", "owner", "token");
  setPayloadField(values, states, payload, "actionTaken", "actionTaken");

  if (section === "cctv") {
    setPayloadField(values, states, payload, "branch", "branch", "token");
    setPayloadField(values, states, payload, "dateTime", "createdAt", "date");
    setPayloadField(values, states, payload, "date", "cctvDate");
    setPayloadField(values, states, payload, "time", "cctvTime");
    setPayloadField(values, states, payload, "notes", "notes");
    setPayloadField(values, states, payload, "cameras", "cameras", "collection-array");
    setPayloadField(values, states, payload, "sections", "sections", "collection-array");
    setPayloadField(values, states, payload, "staff", "staff", "collection-array");
    setPayloadField(values, states, payload, "reviewType", "reviewType");
    setPayloadField(values, states, payload, "violations", "violatedPolicy", "collection-array");
  } else if (section === "ce") {
    setPayloadField(values, states, payload, "customerName", "customerName");
    setPayloadField(values, states, payload, "phone", "customerPhone", "token");
    setPayloadField(values, states, payload, "branch", "branch", "token");
    setPayloadField(values, states, payload, "creationDate", "createdAt", "date");
    setPayloadField(values, states, payload, "customerNotes", "notes");
    setPayloadField(values, states, payload, "department", "departmentResponsible");
    setPayloadField(values, states, payload, "shift", "shift");
    setPayloadField(values, states, payload, "orderType", "orderType");
    setPayloadField(values, states, payload, "restaurant", "restaurant");
    setPayloadField(values, states, payload, "channel", "channel");
    setPayloadField(values, states, payload, "feedbackDate", "feedbackDate", "date");
    setPayloadField(values, states, payload, "issueCategory", "issueCategory");
    setPayloadField(values, states, payload, "satisfaction", "satisfaction");
  } else if (section === "complaints") {
    setPayloadField(values, states, payload, "customerName", "customerName");
    setPayloadField(values, states, payload, "phone", "customerPhone", "token");
    setPayloadField(values, states, payload, "branch", "branch", "token");
    setPayloadField(values, states, payload, "creationDate", "createdAt", "date");
    setPayloadField(values, states, payload, "complaintDetails", "complaintDetails");
    setPayloadField(values, states, payload, "department", "departmentResponsible");
    setPayloadField(values, states, payload, "shift", "shift");
    setPayloadField(values, states, payload, "orderType", "orderType");
    setPayloadField(values, states, payload, "restaurant", "restaurant");
    setPayloadField(values, states, payload, "channel", "channel");
    setPayloadField(values, states, payload, "issueCategory", "issueCategory");
  } else {
    setPayloadField(values, states, payload, "customerName", "customerName");
    setPayloadField(values, states, payload, "phone", "customerPhone", "token");
    setPayloadField(values, states, payload, "orderDate", "createdAt", "date");
    setPayloadField(values, states, payload, "caseDescription", "caseDescription");
    setPayloadField(values, states, payload, "channel", "channel");
    setPayloadField(values, states, payload, "discountAmount", "discountAmount");
    setPayloadField(values, states, payload, "reasonForDiscount", "discountReason");
    setPayloadField(values, states, payload, "decisionMaker", "decisionMaker");
    setPayloadField(values, states, payload, "discountDate", "discountDate", "date");
    setPayloadField(values, states, payload, "newOrderNumber", "newOrderNumber", "token");
    setPayloadField(values, states, payload, "deductionFrom", "deductionFrom");
  }
  const attachmentFields = section === "cctv" ? ["cctvPdf"] : section === "free-orders" ? ["attached", "orderOnCirca"] : [];
  values.sourceMetadata = postgresMetadata(states, setPostgresAttachments(values, states, payload, attachmentFields));
  return canonicalRecord(values);
}

function normalizePostgresHistory(row) {
  assertExactKeys(row, POSTGRES_HISTORY_KEYS);
  const section = normalizeIdentifier(dataValue(row, "section"));
  const module = POSTGRES_MODULES[section];
  if (!module) fail();
  const values = { source: "postgresql", recordType: "history", module: module.key, structuralFlags: [] };
  const states = initialStates();
  setValue(values, states, "ticketId", dataValue(row, "ticket_id"), "token");
  setValue(values, states, "historyReference", dataValue(row, "id"), "token");
  setValue(values, states, "previousStatus", dataValue(row, "prev_status"), "token");
  setValue(values, states, "newStatus", dataValue(row, "new_status"), "token");
  setValue(values, states, "previousAction", dataValue(row, "prev_action"));
  setValue(values, states, "newAction", dataValue(row, "new_action"));
  setValue(values, states, "changedBy", dataValue(row, "changed_by"), "token");
  setValue(values, states, "changedAt", dataValue(row, "changed_at"), "date");
  values.sourceMetadata = postgresMetadata(states, {});
  return canonicalRecord(values);
}

function normalizePostgresSnapshot(snapshot) {
  verifyPostgres(snapshot);
  return withinBoundary(() => {
    if (!snapshot || !Object.hasOwn(snapshot, "rows") || !Object.hasOwn(snapshot, "nextCursor")) {
      throw new NormalizationUnsupportedSnapshotError("Unsupported snapshot");
    }
    const ticketPage = Object.hasOwn(snapshot, "pagination");
    assertExactKeys(snapshot, ticketPage ? ["rows", "nextCursor", "pagination"] : ["rows", "nextCursor"]);
    const rows = assertDenseArray(dataValue(snapshot, "rows"));
    const ticket = ticketPage || (rows.length > 0 && Object.hasOwn(rows[0], "payload"));
    const records = rows.map((row) => ticket ? normalizePostgresTicket(row) : normalizePostgresHistory(row));
    const result = Object.freeze(records);
    const pagination = ticket ? postgresPagination(snapshot) : null;
    const page = pagination === null ? null : Object.freeze({
      ...pagination,
      trustedSnapshot: snapshot,
    });
    return registerNormalizedResult(result, {
      producer: "normalizePostgresSnapshot",
      normalizedSource: "postgresql",
      sourceSnapshotKind: ticket ? "postgres-ticket-page" : "postgres-history-page",
      completenessState: ticket ? "page-bounded" : "not-applicable",
      page,
      recordTypes: Object.freeze([ticket ? "ticket" : "history"]),
    });
  });
}

function denseStringArray(value) {
  return assertDenseArray(value).map((item) => {
    if (typeof item !== "string") fail();
    return normalizeString(item);
  });
}

function setSheetCell(values, states, cells, index, field, kind) {
  if (index >= cells.length) {
    if (kind === "collection-string") setCollectionValue(values, states, field, MISSING, kind);
    else values[field] = null;
    states[field] = FIELD_STATES.OMITTED_TRAILING_CELL;
    return;
  }
  setValue(values, states, field, cells[index], kind);
}

function sheetMetadata(snapshot, row, states) {
  const header = dataValue(snapshot, "header");
  assertAllowedKeys(header, ["physicalRowNumber", "cells", "returnedWidth", "structuralFlags"]);
  return {
    fieldStates: states,
    attachmentFieldStates: {},
    snapshotStructuralFlags: denseStringArray(dataValue(snapshot, "structuralFlags")),
    headerStructuralFlags: denseStringArray(dataValue(header, "structuralFlags")),
    rowStructuralFlags: denseStringArray(dataValue(row, "structuralFlags")),
    trailingOmissionCount: dataValue(row, "trailingOmissionCount"),
    returnedWidth: dataValue(row, "returnedWidth"),
    configuredWidth: dataValue(row, "configuredWidth"),
    headerReturnedWidth: dataValue(header, "returnedWidth"),
    maximumDetectedWidth: dataValue(snapshot, "maximumDetectedWidth"),
  };
}

function sheetModuleMetadata(snapshot) {
  const header = dataValue(snapshot, "header");
  assertAllowedKeys(header, ["physicalRowNumber", "cells", "returnedWidth", "structuralFlags"]);
  return {
    fieldStates: {},
    attachmentFieldStates: {},
    snapshotStructuralFlags: denseStringArray(dataValue(snapshot, "structuralFlags")),
    headerStructuralFlags: denseStringArray(dataValue(header, "structuralFlags")),
    rowStructuralFlags: [],
    trailingOmissionCount: null,
    returnedWidth: dataValue(header, "returnedWidth"),
    configuredWidth: dataValue(snapshot, "configuredWidth"),
    headerReturnedWidth: dataValue(header, "returnedWidth"),
    maximumDetectedWidth: dataValue(snapshot, "maximumDetectedWidth"),
  };
}

function setCctvMetadata(values, states, snapshot, row, cells) {
  const metadata = optionalDataValue(row, "cctvMetadata");
  if (metadata === undefined) fail();
  assertExactKeys(metadata, ["classification", "evidence"]);
  const classification = normalizeIdentifier(dataValue(metadata, "classification"));
  const evidence = denseStringArray(dataValue(metadata, "evidence"));
  values.cctvMetadataClassification = classification;
  states.cctvMetadataClassification = FIELD_STATES.VALUE;
  values.cctvMetadataEvidence = evidence;
  states.cctvMetadataEvidence = evidence.length === 0 ? FIELD_STATES.EMPTY_ARRAY : FIELD_STATES.VALUE;
  if (classification === "CREATION_METADATA") {
    setSheetCell(values, states, cells, 11, "owner", "token");
  } else if (classification === "PDF_METADATA") {
    const name = cells.length > 11 ? normalizeString(cells[11]) : null;
    const reference = cells.length > 12 ? normalizeString(cells[12], true) : null;
    if ((name === null || name === "") && (reference === null || reference === "")) {
      values.attachments = [];
      states.attachments = FIELD_STATES.EMPTY_ARRAY;
    } else {
      values.attachments = [{ name, type: null, reference }];
      states.attachments = FIELD_STATES.VALUE;
    }
  } else {
    values.owner = null;
    values.attachments = null;
    states.owner = FIELD_STATES.AMBIGUOUS;
    states.attachments = FIELD_STATES.AMBIGUOUS;
  }
  if (dataValue(snapshot, "cctvClassification") !== classification && classification !== "CONFLICTING_EVIDENCE") fail();
}

function normalizeSheetRow(snapshot, module, row) {
  assertAllowedKeys(row, SHEET_ROW_KEYS, SHEET_ROW_OPTIONAL_KEYS);
  const cells = assertDenseArray(dataValue(row, "cells"));
  for (const cell of cells) if (typeof cell !== "string") fail();
  const values = {
    source: "google-sheets", recordType: "ticket", module: module.key,
    structuralFlags: denseStringArray(dataValue(row, "structuralFlags")),
  };
  const states = initialStates();
  setValue(values, states, "rowReference", normalizeRowReference(dataValue(row, "physicalRowNumber")), "token");
  for (const [index, field, kind] of module.mappings) setSheetCell(values, states, cells, index, field, kind);
  if (module.key === "cctv") setCctvMetadata(values, states, snapshot, row, cells);
  values.sourceMetadata = sheetMetadata(snapshot, row, states);
  return canonicalRecord(values);
}

function normalizeModuleSheetSnapshot(snapshot) {
  const moduleName = dataValue(snapshot, "module");
  const module = SHEET_MODULES[moduleName];
  if (!module || dataValue(snapshot, "sourceType") !== "google-sheets" || dataValue(snapshot, "configuredWidth") !== module.width) {
    throw new NormalizationUnsupportedSnapshotError("Unsupported snapshot");
  }
  const rows = assertDenseArray(dataValue(snapshot, "rows"));
  if (rows.length === 0) {
    return [canonicalRecord({
      source: "google-sheets",
      recordType: "module",
      module: module.key,
      structuralFlags: denseStringArray(dataValue(snapshot, "structuralFlags")),
      sourceMetadata: sheetModuleMetadata(snapshot),
    })];
  }
  return rows.map((row) => normalizeSheetRow(snapshot, module, row));
}

function normalizeSheetsSnapshot(snapshot) {
  verifySheets(snapshot);
  return withinBoundary(() => {
    if (Object.hasOwn(snapshot, "snapshots")) {
      assertExactKeys(snapshot, ["sourceType", "snapshots", "cellCount", "textLength"]);
      if (dataValue(snapshot, "sourceType") !== "google-sheets") throw new NormalizationUnsupportedSnapshotError("Unsupported snapshot");
      const modules = assertDenseArray(dataValue(snapshot, "snapshots"));
      if (modules.length !== 4) fail();
      const records = [];
      for (const moduleSnapshot of modules) {
        verifySheets(moduleSnapshot);
        records.push(...normalizeModuleSheetSnapshot(moduleSnapshot));
      }
      return registerNormalizedResult(Object.freeze(records), {
        producer: "normalizeSheetsSnapshot",
        normalizedSource: "google-sheets",
        sourceSnapshotKind: "sheets-read-all",
        completenessState: "all-configured-modules",
      });
    }
    return registerNormalizedResult(Object.freeze(normalizeModuleSheetSnapshot(snapshot)), {
      producer: "normalizeSheetsSnapshot",
      normalizedSource: "google-sheets",
      sourceSnapshotKind: "sheets-single-module",
      completenessState: "single-module-only",
    });
  });
}

function normalizeAll(postgresSnapshot, sheetsSnapshot) {
  if (arguments.length !== 2) throw new NormalizationUnsupportedSnapshotError("Unsupported normalization input");
  const result = Object.freeze([...normalizePostgresSnapshot(postgresSnapshot), ...normalizeSheetsSnapshot(sheetsSnapshot)]);
  return registerNormalizedResult(result, {
    producer: "normalizeAll",
    normalizedSource: "mixed",
    sourceSnapshotKind: "mixed-normalized-result",
    completenessState: "not-a-parity-bundle",
  });
}

function bundleFail(ErrorClass) {
  throw new ErrorClass("Canonical bundle assembly failed");
}

function bundleOwnData(object, key, ErrorClass) {
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(object, key); } catch (_) { bundleFail(ErrorClass); }
  if (!descriptor || !Object.hasOwn(descriptor, "value")) bundleFail(ErrorClass);
  return descriptor.value;
}

function assertFrozenDenseBundleArray(value, ErrorClass) {
  let isProxy;
  let isArray;
  let isFrozen;
  let keys;
  try {
    isProxy = types.isProxy(value);
    if (!isProxy) {
      isArray = Array.isArray(value);
      isFrozen = Object.isFrozen(value);
      keys = Reflect.ownKeys(value);
    }
  } catch (_) {
    bundleFail(ErrorClass);
  }
  if (isProxy || !isArray || !isFrozen ||
      keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)))) {
    bundleFail(ErrorClass);
  }
  for (let index = 0; index < value.length; index += 1) {
    let present;
    try { present = Object.hasOwn(value, index); } catch (_) { bundleFail(ErrorClass); }
    if (!present) bundleFail(ErrorClass);
  }
  return value;
}

function bundleBigIntOrder(left, right) {
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  } catch (_) {
    bundleFail(NormalizationBundleConsistencyError);
  }
}

function validateBundleRecord(record, source, allowedTypes) {
  let safeIdentity;
  try {
    safeIdentity = record !== null && typeof record === "object" && !types.isProxy(record) && Object.isFrozen(record) &&
      verifyTrustedCanonicalRecord(record);
  } catch (_) {
    bundleFail(NormalizationBundleConsistencyError);
  }
  if (!safeIdentity || bundleOwnData(record, "source", NormalizationBundleConsistencyError) !== source ||
      !allowedTypes.has(bundleOwnData(record, "recordType", NormalizationBundleConsistencyError)) ||
      !PARITY_MODULE_SET.has(bundleOwnData(record, "module", NormalizationBundleConsistencyError))) {
    bundleFail(NormalizationBundleConsistencyError);
  }
}

function validatePostgresPages(postgresPageResults) {
  assertFrozenDenseBundleArray(postgresPageResults, NormalizationInvalidPageSetError);
  if (postgresPageResults.length === 0) bundleFail(NormalizationIncompletePostgresError);
  if (postgresPageResults.length > BUNDLE_LIMITS.postgresPages) bundleFail(NormalizationBundleLimitError);

  const records = [];
  const seenPages = new Set();
  const seenRecords = new Set();
  const seenIds = new Set();
  const counts = Object.fromEntries(PARITY_MODULES.map((module) => [module, 0]));
  const ticketType = new Set(["ticket"]);
  let expectedCursor = null;
  let pageLimit = null;
  let scanAnchor = null;
  let exhausted = false;

  for (let pageIndex = 0; pageIndex < postgresPageResults.length; pageIndex += 1) {
    const page = bundleOwnData(postgresPageResults, String(pageIndex), NormalizationInvalidPageSetError);
    if (seenPages.has(page)) bundleFail(NormalizationInvalidPageSetError);
    seenPages.add(page);
    const metadata = NORMALIZED_RESULTS.get(page);
    if (!metadata) bundleFail(NormalizationProvenanceError);
    if (metadata.producer !== "normalizePostgresSnapshot" || metadata.sourceSnapshotKind !== "postgres-ticket-page" ||
        metadata.normalizedSource !== "postgresql" || metadata.recordTypes.length !== 1 || metadata.recordTypes[0] !== "ticket" ||
        !metadata.page || metadata.page.section !== null) bundleFail(NormalizationInvalidPageSetError);
    if (pageIndex === 0) scanAnchor = metadata.page.trustedSnapshot;
    try { verifySameTrustedPostgresTicketScan(scanAnchor, metadata.page.trustedSnapshot); }
    catch (_) { bundleFail(NormalizationInvalidPageSetError); }
    if (pageLimit === null) pageLimit = metadata.page.limit;
    else if (pageLimit !== metadata.page.limit) bundleFail(NormalizationInvalidPageSetError);
    if (metadata.page.requestedCursor !== expectedCursor || exhausted) bundleFail(NormalizationIncompletePostgresError);
    if (metadata.page.returnedCount !== page.length || metadata.recordCount !== page.length ||
        metadata.page.nextCursor !== (page.length === 0 ? null : metadata.page.lastId)) {
      bundleFail(NormalizationBundleConsistencyError);
    }
    if (metadata.page.exhausted !== (page.length < metadata.page.limit)) bundleFail(NormalizationBundleConsistencyError);

    let previousId = metadata.page.requestedCursor;
    for (let index = 0; index < page.length; index += 1) {
      const record = bundleOwnData(page, String(index), NormalizationBundleConsistencyError);
      validateBundleRecord(record, "postgresql", ticketType);
      if (seenRecords.has(record)) bundleFail(NormalizationBundleConsistencyError);
      seenRecords.add(record);
      const ticketId = bundleOwnData(record, "ticketId", NormalizationBundleConsistencyError);
      if (typeof ticketId !== "string" || seenIds.has(ticketId) ||
          (previousId !== null && bundleBigIntOrder(previousId, ticketId) >= 0)) {
        bundleFail(NormalizationBundleConsistencyError);
      }
      if (index === 0 && metadata.page.firstId !== ticketId) bundleFail(NormalizationBundleConsistencyError);
      if (index === page.length - 1 && metadata.page.lastId !== ticketId) bundleFail(NormalizationBundleConsistencyError);
      seenIds.add(ticketId);
      previousId = ticketId;
      const module = bundleOwnData(record, "module", NormalizationBundleConsistencyError);
      counts[module] += 1;
      if (counts[module] > BUNDLE_LIMITS.ticketsPerModule) bundleFail(NormalizationBundleLimitError);
      records.push(record);
      if (records.length > BUNDLE_LIMITS.postgresTickets) bundleFail(NormalizationBundleLimitError);
    }
    if (page.length === 0 && (metadata.page.firstId !== null || metadata.page.lastId !== null)) {
      bundleFail(NormalizationBundleConsistencyError);
    }
    exhausted = metadata.page.exhausted;
    expectedCursor = metadata.page.nextCursor;
  }
  if (!exhausted) bundleFail(NormalizationIncompletePostgresError);
  return { records: Object.freeze(records), counts };
}

function validateSheetsReadAll(sheetsReadAllResult) {
  const metadata = NORMALIZED_RESULTS.get(sheetsReadAllResult);
  if (!metadata) bundleFail(NormalizationProvenanceError);
  if (metadata.producer !== "normalizeSheetsSnapshot" || metadata.sourceSnapshotKind !== "sheets-read-all" ||
      metadata.normalizedSource !== "google-sheets" || metadata.representedModules.length !== PARITY_MODULES.length ||
      metadata.representedModules.some((module, index) => module !== PARITY_MODULES[index])) {
    bundleFail(NormalizationIncompleteSheetsError);
  }
  assertFrozenDenseBundleArray(sheetsReadAllResult, NormalizationIncompleteSheetsError);

  const records = [];
  const seenRecords = new Set();
  const moduleKinds = Object.fromEntries(PARITY_MODULES.map((module) => [module, null]));
  const counts = Object.fromEntries(PARITY_MODULES.map((module) => [module, 0]));
  const sheetTypes = new Set(["ticket", "module"]);
  let moduleIndex = 0;
  for (let index = 0; index < sheetsReadAllResult.length; index += 1) {
    const record = bundleOwnData(sheetsReadAllResult, String(index), NormalizationBundleConsistencyError);
    validateBundleRecord(record, "google-sheets", sheetTypes);
    if (seenRecords.has(record)) bundleFail(NormalizationBundleConsistencyError);
    seenRecords.add(record);
    const module = bundleOwnData(record, "module", NormalizationBundleConsistencyError);
    while (moduleIndex < PARITY_MODULES.length && PARITY_MODULES[moduleIndex] !== module) moduleIndex += 1;
    if (moduleIndex >= PARITY_MODULES.length) bundleFail(NormalizationIncompleteSheetsError);
    const type = bundleOwnData(record, "recordType", NormalizationBundleConsistencyError);
    if (moduleKinds[module] === null) moduleKinds[module] = type;
    if (moduleKinds[module] !== type || (type === "module" && counts[module] !== 0)) {
      bundleFail(NormalizationIncompleteSheetsError);
    }
    if (type === "module") {
      const flags = bundleOwnData(record, "structuralFlags", NormalizationBundleConsistencyError);
      let validFlags;
      try {
        validFlags = Array.isArray(flags) && (flags.includes("EMPTY_SHEET") || flags.includes("HEADER_ONLY"));
      } catch (_) {
        bundleFail(NormalizationIncompleteSheetsError);
      }
      if (!validFlags) bundleFail(NormalizationIncompleteSheetsError);
    }
    counts[module] += 1;
    if (type === "ticket" && counts[module] > BUNDLE_LIMITS.ticketsPerModule) {
      bundleFail(NormalizationBundleLimitError);
    }
    records.push(record);
  }
  if (PARITY_MODULES.some((module) => moduleKinds[module] === null ||
      (moduleKinds[module] === "module" && counts[module] !== 1))) {
    bundleFail(NormalizationIncompleteSheetsError);
  }
  return { records: Object.freeze(records), counts, moduleKinds };
}

function frozenNullObject(entries) {
  const object = Object.create(null);
  for (const [key, value] of entries) Object.defineProperty(object, key, {
    value, enumerable: true, writable: false, configurable: false,
  });
  return Object.freeze(object);
}

function assembleCanonicalParityBundle(postgresPageResults, sheetsReadAllResult) {
  const argumentCount = arguments.length;
  return withinBoundary(() => {
    if (argumentCount !== 2) bundleFail(NormalizationInvalidPageSetError);
    const postgres = validatePostgresPages(postgresPageResults);
    const sheets = validateSheetsReadAll(sheetsReadAllResult);
    const sheetTickets = sheets.records.filter((record) => record.recordType === "ticket").length;
    const sheetModuleRecords = sheets.records.length - sheetTickets;
    const recordsByModule = frozenNullObject(PARITY_MODULES.map((module) => [module, frozenNullObject([
      ["postgresTickets", postgres.counts[module]],
      ["sheetsTickets", sheets.moduleKinds[module] === "ticket" ? sheets.counts[module] : 0],
      ["sheetModuleRecords", sheets.moduleKinds[module] === "module" ? 1 : 0],
    ])]));
    const counts = frozenNullObject([
      ["postgresTickets", postgres.records.length],
      ["sheetsTickets", sheetTickets],
      ["sheetModuleRecords", sheetModuleRecords],
      ["postgresPages", postgresPageResults.length],
      ["recordsByModule", recordsByModule],
    ]);
    const completeness = frozenNullObject([
      ["postgresComplete", true],
      ["sheetsComplete", true],
      ["allModulesRepresented", true],
    ]);
    const bundle = frozenNullObject([
      ["postgresRecords", postgres.records],
      ["sheetsRecords", sheets.records],
      ["modules", PARITY_MODULES],
      ["counts", counts],
      ["completeness", completeness],
    ]);
    CANONICAL_BUNDLES.set(bundle, Object.freeze({
      postgresComplete: true,
      sheetsComplete: true,
      allModulesRepresented: true,
      postgresTicketOnly: true,
    }));
    return bundle;
  }, NormalizationBundleConsistencyError);
}

module.exports = Object.freeze({
  assembleCanonicalParityBundle,
  normalizeAll,
  normalizePostgresSnapshot,
  normalizeSheetsSnapshot,
  verifyTrustedCanonicalBundle,
  verifyTrustedCanonicalRecord,
  verifyTrustedNormalizedResult,
});
