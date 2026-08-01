"use strict";

const { deepFreeze } = require("./row-validation");

const EXPECTED_HEADERS = Object.freeze({
  cctv: Object.freeze(["Status", "Branch", "Date & Time", "Cameras", "Sections", "Staff", "Review Type", "Violations", "Notes", "Action Taken", "Case Number", null, null]),
  "customer-experience": Object.freeze(["Status", "Department Responsible", "Customer Name", "Phone Number", "Creation Date", "Shift", "Order Type", "Branch Name", "Restaurant", "Order Channel", "Feedback Date", "Issue Category", "Customer Experience Notes", "Action Taken", "Customer Satisfaction Level", "Order Number"]),
  complaints: Object.freeze(["Status", "Department Responsible", "Customer Name", "Phone Number", "Creation Date", "Shift", "Order Type", "Branch Name", "Restaurant", "Order Channel", "Issue Category", "Complaint Details", "Action Taken", "Order Number"]),
  "complimentary-orders": Object.freeze(["Status", "Customer Name", "Phone", "Order Date", "Discount Amount", "Reason for Discount", "Decision Maker", "Discount Date", "New Order Number", "Deduction From", "Case Description", "Action Taken", "Order Number"]),
});
const URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/;

function normalizedHeader(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function cctvHeaderClassification(headerCells) {
  const left = normalizedHeader(headerCells[11]);
  const right = normalizedHeader(headerCells[12]);
  if (left === "created by" && left && right === "created at") return "CREATION_METADATA";
  if (left === "pdf name" && right === "pdf url") return "PDF_METADATA";
  return "AMBIGUOUS";
}

function headerFlags(configuration, headerCells) {
  const flags = [];
  if (headerCells.length !== configuration.width) flags.push("HEADER_WIDTH_MISMATCH");
  const expected = EXPECTED_HEADERS[configuration.key];
  const unknown = expected.some((header, index) => header !== null && headerCells[index] !== header);
  if (unknown) flags.push("UNKNOWN_HEADER");
  if (headerCells.length > configuration.width) flags.push("UNKNOWN_TRAILING_COLUMNS");
  return flags;
}

function cctvRowMetadata(headerClassification, cells) {
  const evidence = [];
  const right = cells[12];
  if (typeof right === "string" && URL_PATTERN.test(right)) evidence.push("PDF_URL_PATTERN");
  if (typeof right === "string" && TIMESTAMP_PATTERN.test(right)) evidence.push("TIMESTAMP_PATTERN");
  let classification = headerClassification;
  if ((headerClassification === "CREATION_METADATA" && evidence.includes("PDF_URL_PATTERN")) ||
      (headerClassification === "PDF_METADATA" && evidence.includes("TIMESTAMP_PATTERN"))) {
    classification = "CONFLICTING_EVIDENCE";
  }
  return Object.freeze({ classification, evidence: Object.freeze(evidence) });
}

function annotateSnapshot(configuration, validated) {
  const structuralFlags = [];
  const headerStructuralFlags = headerFlags(configuration, validated.headerCells);
  const headerClassification = configuration.key === "cctv" ? cctvHeaderClassification(validated.headerCells) : null;
  if (validated.headerCells.length === 0 && validated.dataRows.length === 0) structuralFlags.push("EMPTY_SHEET");
  else if (validated.dataRows.length === 0) structuralFlags.push("HEADER_ONLY");
  structuralFlags.push(...headerStructuralFlags);
  if (headerClassification === "AMBIGUOUS") structuralFlags.push("CCTV_AMBIGUOUS_METADATA");
  let maximumDetectedWidth = validated.headerCells.length;
  const rows = validated.dataRows.map((cells, index) => {
    const flags = [];
    maximumDetectedWidth = Math.max(maximumDetectedWidth, cells.length);
    const trailingOmissionCount = Math.max(0, configuration.width - cells.length);
    if (cells.length < configuration.width) flags.push("SHORT_ROW", "TRAILING_CELLS_OMITTED", "ROW_WIDTH_MISMATCH");
    if (cells.length > configuration.width) flags.push("WIDE_ROW", "ROW_WIDTH_MISMATCH", "UNKNOWN_TRAILING_COLUMNS");
    let cctvMetadata;
    if (configuration.key === "cctv") {
      cctvMetadata = cctvRowMetadata(headerClassification, cells);
      if (cctvMetadata.classification === "AMBIGUOUS") flags.push("CCTV_AMBIGUOUS_METADATA");
      if (cctvMetadata.classification === "CONFLICTING_EVIDENCE") flags.push("CCTV_CONFLICTING_EVIDENCE");
    }
    return {
      physicalRowNumber: configuration.parsedRange.dataStartRow + index,
      cells,
      returnedWidth: cells.length,
      configuredWidth: configuration.width,
      trailingOmissionCount,
      structuralFlags: flags,
      ...(cctvMetadata ? { cctvMetadata } : {}),
    };
  });
  const snapshot = {
    module: configuration.module,
    sourceType: "google-sheets",
    configuredReference: configuration.reference,
    range: {
      startColumn: configuration.parsedRange.startColumn,
      endColumn: configuration.parsedRange.endColumn,
      dataStartRow: configuration.parsedRange.dataStartRow,
      dataEndRow: configuration.parsedRange.configuredEndRow,
    },
    configuredWidth: configuration.width,
    header: {
      physicalRowNumber: 1,
      cells: validated.headerCells,
      returnedWidth: validated.headerCells.length,
      structuralFlags: headerStructuralFlags,
    },
    rows,
    maximumDetectedWidth,
    cellCount: validated.cellCount,
    textLength: validated.textLength,
    structuralFlags,
    ...(headerClassification ? { cctvClassification: headerClassification } : {}),
  };
  return deepFreeze(snapshot);
}

module.exports = { EXPECTED_HEADERS, annotateSnapshot, cctvHeaderClassification };
