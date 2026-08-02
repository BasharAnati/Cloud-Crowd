"use strict";

const Module = require("node:module");
const { EXPECTED_HEADERS } = require("../../../src/sheets/structure");
const { fakeGoogle, responseFor, sheetsEnvironment } = require("../../sheets/helpers");
const { safeRlsRows, safeRoleRow } = require("../../postgres/helpers");

const events = [];
let ticketCalls = 0;
let clientConstructions = 0;
let clientCloses = 0;

function ticket(id, section, identity, payload) {
  return {
    id: String(id),
    section,
    status: "Open",
    payload: { [section === "cctv" ? "caseNumber" : "orderNumber"]: identity, ...payload },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const postgresRows = [
  ticket(1, "cctv", "C", { branch: "POSTGRES_RAW_CANARY", dateTime: "", cameras: [], sections: [], staff: [], reviewType: "", violations: [], notes: "SECRET_NOTES_CANARY", actionTaken: "" }),
  ticket(2, "ce", "E", { department: "", customerName: "PRIVATE_CUSTOMER_CANARY", phone: "", creationDate: "", shift: "", orderType: "", branch: "POSTGRES_RAW_CANARY", restaurant: "", channel: "", feedbackDate: "", issueCategory: "", customerNotes: "", actionTaken: "", satisfaction: "" }),
  ticket(3, "complaints", "P", { department: "", customerName: "", phone: "", creationDate: "", shift: "", orderType: "", branch: "", restaurant: "", channel: "", issueCategory: "", complaintDetails: "COMPLAINT_CANARY", actionTaken: "" }),
  ticket(4, "free-orders", "F", { customerName: "", phone: "", orderDate: "", discountAmount: "", reasonForDiscount: "", decisionMaker: "", discountDate: "", newOrderNumber: "", deductionFrom: "", caseDescription: "", actionTaken: "" }),
];

class FakeClient {
  constructor() { clientConstructions += 1; }
  async connect() { events.push("postgres:connect"); }
  async end() { clientCloses += 1; events.push("postgres:close"); }
  async query(query) {
    if (query.text.includes("FROM pg_catalog.pg_roles")) return { rows: [safeRoleRow()] };
    if (query.text.includes("JOIN pg_catalog.pg_policy")) return { rows: safeRlsRows() };
    if (query.text === "SHOW transaction_read_only") return { rows: [{ transaction_read_only: "on" }] };
    if (query.text.includes("FROM public.tickets")) {
      ticketCalls += 1;
      events.push("postgres:tickets");
      return { rows: postgresRows };
    }
    return { rows: [] };
  }
}

const identities = Object.freeze({ cctv: "C", "customer-experience": "E", complaints: "P", "complimentary-orders": "F" });

function sheetKey(params) {
  return params.ranges[0].includes("CCTV") ? "cctv" :
    params.ranges[0].includes("Customer Experience") ? "customer-experience" :
      params.ranges[0].includes("Daily Complaints") ? "complaints" : "complimentary-orders";
}

function sheetRow(module, identity) {
  const widths = { cctv: 13, "customer-experience": 16, complaints: 14, "complimentary-orders": 13 };
  const identityIndex = module === "cctv" ? 10 : module === "customer-experience" ? 15 : module === "complaints" ? 13 : 12;
  const cells = Array(widths[module]).fill("");
  cells[0] = "Open";
  cells[identityIndex] = identity;
  if (module === "customer-experience") cells[7] = "SHEETS_RAW_CANARY";
  return cells;
}

const google = fakeGoogle({
  onBatchGet(params) {
    const key = sheetKey(params);
    events.push(`sheets:${key}`);
    const header = key === "cctv"
      ? [...EXPECTED_HEADERS.cctv.slice(0, 11), "PDF Name", "PDF URL"]
      : [...EXPECTED_HEADERS[key]];
    return responseFor(params, { header, rows: [sheetRow(key, identities[key])] });
  },
});

function safeEnvironment() {
  return {
    AUDIT_TARGET: "production",
    AUDIT_MODE: "read-only",
    AUDIT_PRODUCTION_ACKNOWLEDGED: "true",
    AUDIT_ALLOW_WRITES: "false",
    AUDIT_DATABASE_URL_UNPOOLED: "postgres://synthetic.invalid/audit",
    AUDIT_DATABASE_ROLE: "audit_reader",
    ...sheetsEnvironment(),
  };
}

async function run() {
  Object.assign(process.env, safeEnvironment());
  const originalLoad = Module._load;
  Module._load = function fakeExternalDrivers(request, parent, isMain) {
    if (request === "pg") return { Client: FakeClient };
    if (request === "googleapis") return { google: google.factory() };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { runAudit } = require("../../../src/orchestrator");
    const { renderAuditOutput } = require("../../../src/output");
    const { verifyTrustedOutputArtifact } = require("../../../src/output/artifact");
    const result = await runAudit();
    const artifacts = ["json", "markdown", "html"].map((format) => renderAuditOutput(result, format));
    return {
      artifactFacts: artifacts.map((artifact) => ({
        keys: Object.keys(artifact),
        format: artifact.format,
        byteLength: artifact.byteLength,
        actualBytes: Buffer.byteLength(artifact.content, "utf8"),
        frozen: Object.isFrozen(artifact),
        nullPrototype: Object.getPrototypeOf(artifact) === null,
        trusted: verifyTrustedOutputArtifact(artifact) === artifact,
        finalLf: artifact.content.endsWith("\n") && !artifact.content.endsWith("\n\n"),
        hasCanary: ["POSTGRES_RAW_CANARY", "SHEETS_RAW_CANARY", "PRIVATE_CUSTOMER_CANARY", "SECRET_NOTES_CANARY", "COMPLAINT_CANARY"]
          .some((canary) => artifact.content.includes(canary)),
      })),
      instrumentation: {
        ticketCalls, clientConstructions, clientCloses,
        sheetsRequests: google.state.requests.length,
        authorizations: google.state.authorizations,
        events,
      },
    };
  } finally {
    Module._load = originalLoad;
  }
}

run().then((value) => process.stdout.write(`${JSON.stringify(value)}\n`), (error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
