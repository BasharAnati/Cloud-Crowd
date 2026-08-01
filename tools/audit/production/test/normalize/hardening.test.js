"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  NormalizationInvalidFieldError,
  NormalizationLimitError,
  NormalizationMalformedRecordError,
  classifyError,
} = require("../../src/errors");
const { normalizePostgresSnapshot, normalizeSheetsSnapshot } = require("../../src/normalize");
const { createPostgresAdapter } = require("../../src/postgres");
const { adapterEnvironment, fakeClientClass, safeCapability } = require("../postgres/helpers");
const {
  trustedAllSheetsSnapshot,
  trustedHistorySnapshot,
  trustedSheetSnapshot,
  trustedTicketSnapshot,
} = require("./helpers");

function databaseFields(id, section, payload) {
  return {
    id: String(id), section, status: "Open", payload,
    created_at: "2026-01-01T00:00:00.123456Z",
    updated_at: "2026-01-02T00:00:00.654321+00:00",
  };
}

test("preserves every approved PostgreSQL operational field explicitly", async () => {
  const attachment = { dataUrl: "data:application/pdf;base64,AA==", name: "a.pdf", type: "application/pdf" };
  const rows = [
    databaseFields(1, "cctv", {
      actionTaken: "Act", caseNumber: "C-1", status: "Open", createdBy: "Owner", branch: "Branch",
      cameras: ["C1", "C1"], cctvPdf: attachment, date: "2026-01-01", dateTime: "2026-01-01T10:00",
      notes: "Notes", reviewType: "Review", sections: ["S1"], staff: [], time: "10:00", violations: ["V1"],
    }),
    databaseFields(2, "ce", {
      actionTaken: "Act", caseNumber: "CASE-2", orderNumber: "O-2", status: "Open", createdBy: "Owner",
      branch: "Branch", channel: "App", creationDate: "2026-01-02T11:00", customerName: "Name",
      customerNotes: "Notes", department: "Ops", feedbackDate: "2026-01-03", issueCategory: "Issue",
      orderType: "Delivery", phone: "123", restaurant: "Restaurant", satisfaction: "Happy", shift: "PM",
    }),
    databaseFields(3, "complaints", {
      actionTaken: "Act", orderNumber: "O-3", createdBy: "Owner", branch: "Branch", channel: "Call",
      complaintDetails: "Details", creationDate: "2026-01-03", customerName: "Name", department: "Ops",
      issueCategory: "Issue", orderType: "Delivery", phone: "123", restaurant: "Restaurant", shift: "AM",
    }),
    databaseFields(4, "free-orders", {
      actionTaken: "Act", orderNumber: "O-4", createdBy: "Owner", attached: attachment,
      caseDescription: "Description", channel: "App", customerName: "Name", decisionMaker: "Manager",
      deductionFrom: "Budget", discountAmount: "10", discountDate: "2026-01-05", newOrderNumber: "N-4",
      orderDate: "2026-01-04", orderOnCirca: attachment, phone: "123", reasonForDiscount: "Reason",
    }),
  ];
  const records = normalizePostgresSnapshot(await trustedTicketSnapshot(rows));
  assert.deepEqual({ ...records[0].cameras }, { raw: null, items: ["C1", "C1"] });
  assert.deepEqual({ ...records[0].sections }, { raw: null, items: ["S1"] });
  assert.deepEqual({ ...records[0].staff }, { raw: null, items: [] });
  assert.deepEqual({ ...records[0].violatedPolicy }, { raw: null, items: ["V1"] });
  assert.equal(records[0].actionTaken, "Act");
  assert.equal(records[1].departmentResponsible, "Ops");
  assert.equal(records[1].feedbackDate.local, "2026-01-03");
  assert.equal(records[1].satisfaction, "Happy");
  assert.equal(records[2].complaintDetails, "Details");
  assert.equal(records[3].discountReason, "Reason");
  assert.equal(records[3].decisionMaker, "Manager");
  assert.equal(records[3].deductionFrom, "Budget");
  assert.equal(records[3].attachments.length, 2);
  assert(records.every((record) => record.actionTaken === "Act"));
  assert.equal(records[0].databaseCreatedAt.instant, "2026-01-01T00:00:00.123456Z");
  assert.equal(records[0].updatedAt.instant, "2026-01-02T00:00:00.654321Z");
});

test("preserves every confirmed Sheet position for all four modules", async () => {
  const cases = [
    ["readCctvSheet", ["Open", "B", "2026-01-01T10:00", "CAM", "SEC", "STAFF", "REV", "VIOL", "NOTE", "ACT", "CASE", "Created", "2026-01-01"], {
      caseNumber: "CASE", reviewType: "REV", actionTaken: "ACT",
    }],
    ["readCustomerExperienceSheet", ["Open", "DEPT", "NAME", "PHONE", "2026-01-02", "SHIFT", "TYPE", "BRANCH", "REST", "CHANNEL", "2026-01-03", "ISSUE", "NOTE", "ACT", "SAT", "ORDER"], {
      departmentResponsible: "DEPT", customerName: "NAME", shift: "SHIFT", orderType: "TYPE", restaurant: "REST", channel: "CHANNEL", issueCategory: "ISSUE", satisfaction: "SAT", actionTaken: "ACT",
    }],
    ["readComplaintsSheet", ["Open", "DEPT", "NAME", "PHONE", "2026-01-03", "SHIFT", "TYPE", "BRANCH", "REST", "CHANNEL", "ISSUE", "DETAIL", "ACT", "ORDER"], {
      departmentResponsible: "DEPT", complaintDetails: "DETAIL", actionTaken: "ACT",
    }],
    ["readComplimentaryOrdersSheet", ["Open", "NAME", "PHONE", "2026-01-04", "10", "REASON", "DECISION", "2026-01-05", "NEW", "DEDUCT", "DESC", "ACT", "ORDER"], {
      discountAmount: "10", discountReason: "REASON", decisionMaker: "DECISION", newOrderNumber: "NEW", deductionFrom: "DEDUCT", caseDescription: "DESC", actionTaken: "ACT",
    }],
  ];
  for (const [method, row, expected] of cases) {
    const record = normalizeSheetsSnapshot(await trustedSheetSnapshot(method, [row]))[0];
    for (const [field, value] of Object.entries(expected)) assert.equal(record[field], value);
    if (method === "readCctvSheet") {
      assert.deepEqual({ ...record.cameras }, { raw: "CAM", items: null });
      assert.deepEqual({ ...record.sections }, { raw: "SEC", items: null });
      assert.deepEqual({ ...record.staff }, { raw: "STAFF", items: null });
      assert.deepEqual({ ...record.violatedPolicy }, { raw: "VIOL", items: null });
    }
  }
});

test("preserves CCTV L/M ambiguity, evidence, and structural omission metadata", async () => {
  const header = ["Status", "Branch", "Date & Time", "Cameras", "Sections", "Staff", "Review Type", "Violations", "Notes", "Action Taken", "Case Number", "Unknown L", "Unknown M"];
  const row = ["Open", "B", "2026-01-01", "C", "S", "Staff", "R", "V", "N", "A", "K", "raw-L", "https://example.test/raw-M"];
  const record = normalizeSheetsSnapshot(await trustedSheetSnapshot("readCctvSheet", [row], header))[0];
  assert.equal(record.cctvColumnL, "raw-L");
  assert.equal(record.cctvColumnM, "https://example.test/raw-M");
  assert.equal(record.cctvMetadataClassification, "AMBIGUOUS");
  assert.deepEqual(record.cctvMetadataEvidence, ["PDF_URL_PATTERN"]);
  assert.equal(record.owner, null);
  assert.equal(record.attachments, null);
  assert.equal(record.sourceMetadata.fieldStates.attachments, "AMBIGUOUS");
  assert.deepEqual(record.structuralFlags, ["CCTV_AMBIGUOUS_METADATA"]);

  const short = normalizeSheetsSnapshot(await trustedSheetSnapshot("readCustomerExperienceSheet", [["Open", "", ""]]))[0];
  assert.equal(short.sourceMetadata.trailingOmissionCount, 13);
  assert.equal(short.sourceMetadata.returnedWidth, 3);
  assert.deepEqual(short.sourceMetadata.rowStructuralFlags, ["SHORT_ROW", "TRAILING_CELLS_OMITTED", "ROW_WIDTH_MISMATCH"]);
  assert.equal(short.sourceMetadata.fieldStates.customerName, "EMPTY_STRING");
  assert.equal(short.sourceMetadata.fieldStates.customerPhone, "OMITTED_TRAILING_CELL");
});

test("history retains both sides of transitions and deleted-ticket references", async () => {
  const snapshot = await trustedHistorySnapshot([{
    id: "9", ticket_id: "999", section: "complaints", changed_by: "Actor",
    prev_status: "Open", new_status: "Closed", prev_action: "Before", new_action: "After",
    changed_at: "2026-01-01T01:02:03.123456Z",
  }]);
  const record = normalizePostgresSnapshot(snapshot)[0];
  assert.equal(record.recordType, "history");
  assert.equal(record.ticketId, "999");
  assert.equal(record.historyReference, "9");
  assert.equal(record.previousStatus, "Open");
  assert.equal(record.newStatus, "Closed");
  assert.equal(record.previousAction, "Before");
  assert.equal(record.newAction, "After");
  assert.equal(record.changedBy, "Actor");
  assert.equal(record.changedAt.instant, "2026-01-01T01:02:03.123456Z");
  assert.equal(record.status, null);
  assert.equal(record.actionTaken, null);
});

test("preserves explicit null, empty string, omitted cells, and empty arrays distinctly", async () => {
  const pg = normalizePostgresSnapshot(await trustedTicketSnapshot([databaseFields(1, "cctv", {
    caseNumber: "C", branch: null, cameras: [], sections: [""], staff: [], violations: [], dateTime: "",
  })]))[0];
  assert.equal(pg.branch, null);
  assert.equal(pg.sourceMetadata.fieldStates.branch, "EXPLICIT_NULL");
  assert.deepEqual({ ...pg.cameras }, { raw: null, items: [] });
  assert.equal(pg.sourceMetadata.fieldStates.cameras, "EMPTY_ARRAY");
  assert.equal(pg.createdAt, null);
  assert.equal(pg.sourceMetadata.fieldStates.createdAt, "EMPTY_STRING");

  const sheet = normalizeSheetsSnapshot(await trustedSheetSnapshot("readCustomerExperienceSheet", [["Open", "", ""]]))[0];
  assert.equal(sheet.customerName, "");
  assert.equal(sheet.sourceMetadata.fieldStates.customerName, "EMPTY_STRING");
  assert.equal(sheet.customerPhone, null);
  assert.equal(sheet.sourceMetadata.fieldStates.customerPhone, "OMITTED_TRAILING_CELL");
});

test("date values are source-aware, precise, and timezone independent", async () => {
  const originalTimezone = process.env.TZ;
  try {
    const row = databaseFields(1, "ce", { orderNumber: "O", creationDate: "2026-03-08T02:30", feedbackDate: "2026-03-08" });
    process.env.TZ = "Pacific/Honolulu";
    const first = normalizePostgresSnapshot(await trustedTicketSnapshot([row]))[0];
    process.env.TZ = "Asia/Amman";
    const second = normalizePostgresSnapshot(await trustedTicketSnapshot([row]))[0];
    assert.deepEqual(first.createdAt, second.createdAt);
    assert.deepEqual(first.updatedAt, second.updatedAt);
    assert.equal(first.createdAt.instant, null);
    assert.equal(first.createdAt.local, "2026-03-08T02:30");
    assert.equal(first.feedbackDate.local, "2026-03-08");
    assert.equal(first.updatedAt.instant, "2026-01-02T00:00:00.654321Z");
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
  const offset = databaseFields(2, "ce", { orderNumber: "O", creationDate: "2026-01-01T03:00:00.123456+03:00" });
  const record = normalizePostgresSnapshot(await trustedTicketSnapshot([offset]))[0];
  assert.equal(record.createdAt.instant, "2026-01-01T00:00:00.123456Z");
  assert.equal(record.createdAt.precision, "fraction-6");
  await assert.rejects(
    trustedSheetSnapshot("readCustomerExperienceSheet", [["Open", "", "", "", "31/12/2026"]]).then(normalizeSheetsSnapshot),
    { name: "NormalizationDateError" }
  );
});

test("accepts PR3 maximum row volumes and rejects one over at the source boundary", { timeout: 60_000 }, async () => {
  const rows = Array.from({ length: 10_000 }, () => ["Open"]);
  const moduleSnapshot = await trustedSheetSnapshot("readCustomerExperienceSheet", rows);
  assert.equal(normalizeSheetsSnapshot(moduleSnapshot).length, 10_000);

  const aggregate = await trustedAllSheetsSnapshot({
    cctv: Array.from({ length: 10_000 }, () => Array(13).fill("")),
    "customer-experience": Array.from({ length: 10_000 }, () => Array(16).fill("")),
    complaints: Array.from({ length: 10_000 }, () => Array(14).fill("")),
    "complimentary-orders": Array.from({ length: 10_000 }, () => Array(6).fill("")),
  });
  assert(aggregate.cellCount > 490_000);
  assert.equal(normalizeSheetsSnapshot(aggregate).length, 40_000);
  await assert.rejects(trustedSheetSnapshot("readCustomerExperienceSheet", [...rows, ["Open"]]), {
    name: "MalformedSheetsResponseError",
  });
});

test("normalization failures retain trusted fixed classifications without source leakage", async () => {
  const secret = "customer-secret-value";
  let error;
  try { normalizePostgresSnapshot({ rows: [secret] }); } catch (caught) { error = caught; }
  assert.equal(classifyError(error).publicCode, "NORMALIZATION_UNTRUSTED_SNAPSHOT");
  assert(!classifyError(error).publicMessage.includes(secret));
  error.code = secret;
  error.exitCode = 0;
  assert.equal(classifyError(error).publicCode, "NORMALIZATION_UNTRUSTED_SNAPSHOT");

  const badDate = databaseFields(1, "ce", { orderNumber: "O", creationDate: secret });
  try { normalizePostgresSnapshot(await trustedTicketSnapshot([badDate])); } catch (caught) { error = caught; }
  assert.equal(classifyError(error).publicCode, "NORMALIZATION_DATE_FAILURE");
  assert(!classifyError(error).publicMessage.includes(secret));

  const invalid = databaseFields(2, "ce", { orderNumber: "O", customerName: 42 });
  try { normalizePostgresSnapshot(await trustedTicketSnapshot([invalid])); } catch (caught) { error = caught; }
  assert.equal(classifyError(error).publicCode, "NORMALIZATION_INVALID_FIELD");

  const Client = fakeClientClass();
  const connection = await createPostgresAdapter({
    safety: safeCapability(), env: adapterEnvironment, expectedDatabase: "cloud_crowd", Client,
  }).inspectConnectionSafety();
  try { normalizePostgresSnapshot(connection); } catch (caught) { error = caught; }
  assert.equal(classifyError(error).publicCode, "NORMALIZATION_UNSUPPORTED_SNAPSHOT");

  for (const [instance, code] of [
    [new NormalizationMalformedRecordError(secret), "NORMALIZATION_MALFORMED_RECORD"],
    [new NormalizationInvalidFieldError(secret), "NORMALIZATION_INVALID_FIELD"],
    [new NormalizationLimitError(secret), "NORMALIZATION_LIMIT_EXCEEDED"],
  ]) {
    assert.equal(classifyError(instance).publicCode, code);
    assert(!classifyError(instance).publicMessage.includes(secret));
  }
});
