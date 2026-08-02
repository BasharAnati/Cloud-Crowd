"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ConfigurationError,
  DatabaseQueryError,
  NormalizationMalformedRecordError,
  OrchestrationError,
  ParityInternalConsistencyError,
  ReportInvalidSummaryError,
  SheetsPermissionError,
  classifyError,
} = require("../../src/errors");

const MODULE_PATHS = Object.freeze([
  "../../src/environment",
  "../../src/safety-kernel",
  "../../src/postgres",
  "../../src/postgres/adapter",
  "../../src/sheets",
  "../../src/normalize",
  "../../src/parity",
  "../../src/parity/adapter",
  "../../src/report",
  "../../src/report/adapter",
]);

const ORCHESTRATOR_PATHS = Object.freeze([
  "../../src/orchestrator",
  "../../src/orchestrator/adapter",
  "../../src/orchestrator/context",
  "../../src/orchestrator/pipeline",
  "../../src/orchestrator/result",
  "../../src/orchestrator/validation",
]);

function frozenNull(entries) {
  return Object.freeze(Object.assign(Object.create(null), Object.fromEntries(entries)));
}

function installModule(request, exports) {
  const id = require.resolve(request);
  const prior = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports };
  return () => {
    if (prior) require.cache[id] = prior;
    else delete require.cache[id];
  };
}

function fixture(overrides = {}) {
  const events = [];
  const counts = Object.create(null);
  const count = (name) => {
    events.push(name);
    counts[name] = (counts[name] || 0) + 1;
    if (overrides.failAt === name) throw overrides.error || new Error(`failure:${name}`);
  };
  const page = Object.freeze({
    rows: Object.freeze([]),
    nextCursor: null,
    pagination: Object.freeze({
      kind: "tickets", requestedCursor: null, limit: 100, returnedCount: 0, nextCursor: null, exhausted: true,
    }),
  });
  const sheetsSnapshot = Object.freeze({ sourceType: "sheets" });
  const normalizedPostgres = Object.freeze([]);
  const normalizedSheets = Object.freeze([]);
  const bundle = frozenNull([["bundle", true]]);
  const summary = frozenNull([["total", 0]]);
  const parityResult = frozenNull([["findings", Object.freeze([])], ["summary", summary]]);
  const statistics = frozenNull([["total", 0]]);

  const stubs = {
    "../../src/environment": Object.freeze({
      loadEnvironment() { count("create-context"); return Object.freeze({}); },
    }),
    "../../src/safety-kernel": Object.freeze({
      enforceSafety() { count("enforce-safety"); return frozenNull([["safe", true]]); },
    }),
    "../../src/postgres": Object.freeze({
      createPostgresAdapter({ safety, expectedDatabase, maximumPageSize }) {
        count("create-postgres");
        assert.equal(Object.isFrozen(safety), true);
        assert.equal(expectedDatabase, "cloud_crowd");
        assert.equal(maximumPageSize, 100);
        return Object.freeze({
          async listTicketsPage(options, previous) {
            count("read-postgres");
            assert.deepEqual(options, { limit: 100 });
            assert.equal(previous, undefined);
            return page;
          },
        });
      },
    }),
    "../../src/postgres/adapter": Object.freeze({
      verifyTrustedPostgresSnapshot(value) { assert.strictEqual(value, page); },
    }),
    "../../src/sheets": Object.freeze({
      createSheetsAdapter({ safety }) {
        count("create-sheets");
        assert.equal(Object.isFrozen(safety), true);
        return Object.freeze({
          async readAllConfiguredSheets() { count("read-sheets"); return sheetsSnapshot; },
        });
      },
    }),
    "../../src/normalize": Object.freeze({
      normalizePostgresSnapshot(value) { count("normalize-postgres"); assert.strictEqual(value, page); return normalizedPostgres; },
      normalizeSheetsSnapshot(value) { count("normalize-sheets"); assert.strictEqual(value, sheetsSnapshot); return normalizedSheets; },
      assembleCanonicalParityBundle(postgres, sheets) {
        count("assemble-bundle");
        assert.equal(Object.isFrozen(postgres), true);
        assert.strictEqual(postgres[0], normalizedPostgres);
        assert.strictEqual(sheets, normalizedSheets);
        return bundle;
      },
    }),
    "../../src/parity": Object.freeze({
      compareCanonicalParityBundle(value) { count("compare-bundle"); assert.strictEqual(value, bundle); return parityResult; },
    }),
    "../../src/report": Object.freeze({
      buildAuditReport(value) {
        count("build-report");
        assert.strictEqual(value, parityResult);
        return frozenNull([
          ["schemaVersion", "1"],
          ["statistics", statistics],
          ["payload", frozenNull([["complete", true]])],
        ]);
      },
    }),
    "../../src/parity/adapter": Object.freeze({
      verifyTrustedParityResult(value) { count("verify-parity"); assert.strictEqual(value, parityResult); return value; },
    }),
    "../../src/report/adapter": Object.freeze({
      verifyTrustedAuditReport(value) { count("verify-report"); return value; },
    }),
  };

  const priorOrchestratorModules = ORCHESTRATOR_PATHS.map((request) => {
    const id = require.resolve(request);
    const prior = require.cache[id];
    delete require.cache[id];
    return { id, prior };
  });
  const restore = [];
  let orchestrator;
  try {
    for (const request of MODULE_PATHS) restore.push(installModule(request, stubs[request]));
    orchestrator = require("../../src/orchestrator");
  } finally {
    for (const operation of restore.reverse()) operation();
    for (const { id, prior } of priorOrchestratorModules) {
      if (prior) require.cache[id] = prior;
      else delete require.cache[id];
    }
  }
  return { orchestrator, events, counts };
}

test("public API is exact, frozen, import-safe, and accepts zero arguments only", async () => {
  const { orchestrator, events } = fixture();
  assert.deepEqual(Object.keys(orchestrator), ["runAudit"]);
  assert.equal(Object.isFrozen(orchestrator), true);
  assert.equal(Object.isFrozen(orchestrator.runAudit), true);
  assert.deepEqual(events, []);
  await assert.rejects(orchestrator.runAudit(null), OrchestrationError);
  assert.deepEqual(events, []);
});

test("narrow unit seam sequences each stage exactly once", async () => {
  const { orchestrator, events, counts } = fixture();
  await orchestrator.runAudit();
  assert.deepEqual(events, [
    "create-context", "enforce-safety", "create-postgres", "create-sheets",
    "read-postgres", "read-sheets", "normalize-postgres", "normalize-sheets",
    "assemble-bundle", "compare-bundle", "build-report", "verify-parity", "verify-report",
  ]);
  for (const event of new Set(events)) assert.equal(counts[event], 1, event);
});

test("trusted PR1 through PR6 errors retain exact identity at the orchestration boundary", async () => {
  const cases = [
    ["create-context", new ConfigurationError("trusted PR1 failure"), "CONFIGURATION_ERROR"],
    ["read-postgres", new DatabaseQueryError("trusted PR2 failure"), "DATABASE_QUERY_FAILURE"],
    ["read-sheets", new SheetsPermissionError("trusted PR3 failure"), "SHEETS_PERMISSION_DENIED"],
    ["normalize-postgres", new NormalizationMalformedRecordError("trusted PR4 failure"), "NORMALIZATION_MALFORMED_RECORD"],
    ["compare-bundle", new ParityInternalConsistencyError("trusted PR5 failure"), "PARITY_INTERNAL_CONSISTENCY_FAILURE"],
    ["build-report", new ReportInvalidSummaryError("trusted PR6 failure"), "REPORT_INVALID_SUMMARY"],
  ];
  for (const [failAt, trusted, code] of cases) {
    const { orchestrator, events } = fixture({ failAt, error: trusted });
    let output = Symbol("not-returned");
    await assert.rejects(orchestrator.runAudit().then((value) => { output = value; }), (error) => {
      assert.strictEqual(error, trusted, failAt);
      assert.equal(classifyError(error).publicCode, code, failAt);
      return true;
    });
    assert.equal(typeof output, "symbol", failAt);
    assert.equal(events.at(-1), failAt);
  }
});

test("each stage stops the pipeline immediately on its first failure", async () => {
  const order = [
    "create-context", "enforce-safety", "create-postgres", "create-sheets", "read-postgres", "read-sheets",
    "normalize-postgres", "normalize-sheets", "assemble-bundle", "compare-bundle", "build-report",
  ];
  for (const failedStage of order) {
    const { orchestrator, events } = fixture({ failAt: failedStage });
    await assert.rejects(orchestrator.runAudit(), (error) => {
      assert.equal(error instanceof OrchestrationError, true);
      assert.equal(classifyError(error).publicCode, "ORCHESTRATION_FAILURE");
      return true;
    });
    assert.equal(events.at(-1), failedStage);
    assert.equal(events.some((event) => order.indexOf(event) > order.indexOf(failedStage)), false);
  }
});
