"use strict";

const Module = require("node:module");
const { classifyError, ParityInternalConsistencyError } = require("../../../src/errors");
const { EXPECTED_HEADERS } = require("../../../src/sheets/structure");
const { fakeGoogle, responseFor, sheetsEnvironment } = require("../../sheets/helpers");
const { safeRlsRows, safeRoleRow } = require("../../postgres/helpers");

const scenario = process.argv[2];
const events = [];
let ticketCalls = 0;
let clientConstructions = 0;
let clientCloses = 0;
let activeClients = 0;
let maximumActiveClients = 0;

function ticket(id, section = "ce", identity = `ORDER-${id}`, payload = {}) {
  const identityField = section === "cctv" ? "caseNumber" : "orderNumber";
  return {
    id: String(id),
    section,
    status: "Open",
    payload: { [identityField]: identity, ...payload },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function sheetRow(module, identity) {
  const widths = { cctv: 13, "customer-experience": 16, complaints: 14, "complimentary-orders": 13 };
  const identityIndex = module === "cctv" ? 10 : module === "customer-experience" ? 15 : module === "complaints" ? 13 : 12;
  const cells = Array(widths[module]).fill("");
  cells[0] = "Open";
  cells[identityIndex] = identity;
  return cells;
}

function fullPage(lastId) {
  return Array.from({ length: 100 }, () => ticket(lastId));
}

function ascendingPage(start, count) {
  return Array.from({ length: count }, (_, index) => ticket(start + index));
}

function requestedCursor(query) {
  return query.values.length === 1 ? null : query.values[0];
}

const matchedIdentities = Object.freeze({
  cctv: "C",
  "customer-experience": "E",
  complaints: "P",
  "complimentary-orders": "F",
});
const matchedPostgresRows = Object.freeze([
  ticket(1, "cctv", "C", { branch: "", dateTime: "", cameras: [], sections: [], staff: [], reviewType: "", violations: [], notes: "", actionTaken: "" }),
  ticket(2, "ce", "E", { department: "", customerName: "", phone: "", creationDate: "", shift: "", orderType: "", branch: "", restaurant: "", channel: "", feedbackDate: "", issueCategory: "", customerNotes: "", actionTaken: "", satisfaction: "" }),
  ticket(3, "complaints", "P", { department: "", customerName: "", phone: "", creationDate: "", shift: "", orderType: "", branch: "", restaurant: "", channel: "", issueCategory: "", complaintDetails: "", actionTaken: "" }),
  ticket(4, "free-orders", "F", { customerName: "", phone: "", orderDate: "", discountAmount: "", reasonForDiscount: "", decisionMaker: "", discountDate: "", newOrderNumber: "", deductionFrom: "", caseDescription: "", actionTaken: "" }),
]);

function rowsForTicketQuery(query) {
  ticketCalls += 1;
  events.push(`postgres:${ticketCalls}`);
  const cursor = requestedCursor(query);
  if (scenario === "short-zero" || scenario === "deterministic" || scenario === "concurrent") return matchedPostgresRows;
  if (scenario === "short-populated" || scenario === "pr3-config" || scenario === "pr3-permission" ||
      scenario === "pr5-consistency" || scenario === "pr6-validation" || scenario === "unexpected") return [ticket(1)];
  if (scenario === "full-empty" || scenario === "concurrent-isolation") return cursor === null ? ascendingPage(1, 100) : [];
  if (scenario === "multi") return cursor === null ? ascendingPage(1, 100) : [ticket(101)];
  if (scenario === "repeat") return fullPage("1");
  if (scenario === "cycle") return fullPage(["1", "2", "1"][ticketCalls - 1]);
  if (scenario === "long-cycle") return fullPage(["1", "2", "3", "2"][ticketCalls - 1]);
  if (scenario === "limit-accepted") return ticketCalls === 10_000 ? [ticket(ticketCalls)] : fullPage(String(ticketCalls));
  if (scenario === "limit-rejected") return fullPage(String(ticketCalls));
  if (scenario === "pr2-query") throw new Error("raw database query canary");
  if (scenario === "pr4-normalization") return [{ ...ticket(1), payload: { orderNumber: "ONE", unexpected: "producer-corruption-canary" } }];
  if (scenario === "concurrent-one-fails") {
    if (ticketCalls === 1) throw new Error("one-run-only database canary");
    return [ticket(2)];
  }
  return [];
}

class FakeClient {
  constructor() {
    clientConstructions += 1;
    activeClients += 1;
    maximumActiveClients = Math.max(maximumActiveClients, activeClients);
  }
  async connect() { events.push("postgres:connect"); }
  async end() { clientCloses += 1; activeClients -= 1; events.push("postgres:close"); }
  async query(query) {
    if (query.text.includes("FROM pg_catalog.pg_roles")) {
      return { rows: [safeRoleRow(scenario === "pr2-safety" ? { role_name: "wrong_role" } : {})] };
    }
    if (query.text.includes("JOIN pg_catalog.pg_policy")) return { rows: safeRlsRows() };
    if (query.text === "SHOW transaction_read_only") return { rows: [{ transaction_read_only: "on" }] };
    if (query.text.includes("FROM public.tickets")) return { rows: rowsForTicketQuery(query) };
    return { rows: [] };
  }
}

function sheetKey(params) {
  return params.ranges[0].includes("CCTV") ? "cctv" :
    params.ranges[0].includes("Customer Experience") ? "customer-experience" :
      params.ranges[0].includes("Daily Complaints") ? "complaints" : "complimentary-orders";
}

const google = fakeGoogle({
  onBatchGet(params) {
    const key = sheetKey(params);
    events.push(`sheets:${key}`);
    if (scenario === "pr3-permission" || scenario === "limit-accepted") {
      const error = new Error("raw Sheets permission canary");
      error.response = { status: 403 };
      throw error;
    }
    if (scenario === "short-zero" || scenario === "deterministic" || scenario === "concurrent") {
      const header = key === "cctv"
        ? [...EXPECTED_HEADERS.cctv.slice(0, 11), "PDF Name", "PDF URL"]
        : [...EXPECTED_HEADERS[key]];
      return responseFor(params, { header, rows: [sheetRow(key, matchedIdentities[key])] });
    }
    return responseFor(params, { rows: [] });
  },
});

function installClosedFailureSeam() {
  const installed = [];
  if (scenario === "pr5-consistency") {
    const path = require.resolve("../../../src/parity/partition");
    const actual = require(path);
    installed.push({ path, prior: require.cache[path] });
    require.cache[path] = {
      id: path,
      filename: path,
      loaded: true,
      exports: Object.freeze({
        ...actual,
        partitionBundle() { throw new ParityInternalConsistencyError("closed parity producer corruption"); },
      }),
    };
  }
  if (scenario === "pr6-validation") {
    const path = require.resolve("../../../src/parity/summary");
    installed.push({ path, prior: require.cache[path] });
    require.cache[path] = {
      id: path,
      filename: path,
      loaded: true,
      exports: Object.freeze({ buildSummary() { return Object.freeze(Object.create(null)); } }),
    };
  }
  if (scenario === "unexpected") {
    const path = require.resolve("../../../src/orchestrator/result");
    installed.push({ path, prior: require.cache[path] });
    require.cache[path] = {
      id: path,
      filename: path,
      loaded: true,
      exports: Object.freeze({ createAuditResult() { throw new Error("unexpected-orchestration-canary"); } }),
    };
  }
  return installed;
}

function deepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value) && Object.values(value).every((child) => deepFrozen(child, seen));
}

function resultFacts(result) {
  let reportTrusted = false;
  try {
    require("../../../src/report/adapter").verifyTrustedAuditReport(result.report);
    reportTrusted = true;
  } catch (_) {}
  return {
    keys: Object.keys(result),
    prototypeNull: Object.getPrototypeOf(result) === null,
    deeplyFrozen: deepFrozen(result),
    metadata: result.metadata,
    metadataKeys: Object.keys(result.metadata),
    reportTrusted,
    statisticsReference: result.statistics === result.report.statistics,
    summaryPostgresTickets: result.summary.postgresTickets,
    reportPostgresTickets: result.report.overview.postgresTickets,
    totalFindings: result.report.overview.totalFindings,
  };
}

function instrumentation() {
  return {
    ticketCalls,
    clientConstructions,
    clientCloses,
    activeClients,
    maximumActiveClients,
    sheetsRequests: google.state.requests.length,
    authorizations: google.state.authorizations,
    authClients: google.state.authClients.length,
    events,
  };
}

function errorFacts(error) {
  const classification = classifyError(error);
  return {
    name: error && error.name,
    classification,
    classificationHasCanary: JSON.stringify(classification).includes("canary"),
    hasCause: error && Object.hasOwn(error, "cause"),
    returned: false,
  };
}

async function run() {
  const environment = {
    AUDIT_TARGET: "production",
    AUDIT_MODE: "read-only",
    AUDIT_PRODUCTION_ACKNOWLEDGED: "true",
    AUDIT_ALLOW_WRITES: "false",
    AUDIT_DATABASE_URL_UNPOOLED: "postgres://synthetic.invalid/audit",
    AUDIT_DATABASE_ROLE: "audit_reader",
    ...sheetsEnvironment(),
  };
  if (scenario === "pr1-invalid") delete environment.AUDIT_TARGET;
  if (scenario === "pr3-config") environment.GOOGLE_APPLICATION_CREDENTIALS_JSON = "invalid-credential-canary";
  Object.assign(process.env, environment);
  if (scenario === "pr1-invalid") delete process.env.AUDIT_TARGET;
  const closedSeams = installClosedFailureSeam();
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "pg") return { Client: FakeClient };
    if (request === "googleapis") return { google: google.factory() };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { runAudit } = require("../../../src/orchestrator");
    if (scenario === "deterministic") {
      const first = await runAudit();
      const second = await runAudit();
      return { kind: "success", facts: resultFacts(first), equivalent: JSON.stringify(first) === JSON.stringify(second), independent: first !== second, instrumentation: instrumentation() };
    }
    if (scenario === "concurrent") {
      const [first, second] = await Promise.all([runAudit(), runAudit()]);
      return { kind: "success", facts: resultFacts(first), secondFacts: resultFacts(second), independent: first !== second && first.report !== second.report, instrumentation: instrumentation() };
    }
    if (scenario === "concurrent-one-fails") {
      const settled = await Promise.allSettled([runAudit(), runAudit()]);
      const fulfilled = settled.find((entry) => entry.status === "fulfilled");
      const rejected = settled.find((entry) => entry.status === "rejected");
      return { kind: "mixed", fulfilled: resultFacts(fulfilled.value), rejected: errorFacts(rejected.reason), instrumentation: instrumentation() };
    }
    try {
      const result = await runAudit();
      return { kind: "success", facts: resultFacts(result), instrumentation: instrumentation() };
    } catch (error) {
      return { kind: "error", error: errorFacts(error), instrumentation: instrumentation() };
    }
  } finally {
    Module._load = originalLoad;
    for (const { path, prior } of closedSeams.reverse()) {
      if (prior) require.cache[path] = prior;
      else delete require.cache[path];
    }
  }
}

run().then((value) => process.stdout.write(`${JSON.stringify(value)}\n`), (error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
