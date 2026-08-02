"use strict";

const { OrchestrationError } = require("../errors");
const adapter = require("./adapter");
const { createExecutionContext } = require("./context");
const { createAuditResult } = require("./result");
const { isTrustedComponentError } = require("./validation");

async function executePipeline() {
  const context = createExecutionContext();
  const postgresPages = await adapter.readPostgresPages(context.sources.postgres);
  const sheetsSnapshot = await adapter.readAllSheets(context.sources.sheets);
  const normalizedPostgres = adapter.normalizePostgresPages(postgresPages);
  const normalizedSheets = adapter.normalizeAllSheets(sheetsSnapshot);
  const bundle = adapter.assembleCanonicalParityBundle(normalizedPostgres, normalizedSheets);
  const parityResult = adapter.compareCanonicalParityBundle(bundle);
  const report = adapter.buildAuditReport(parityResult);
  return createAuditResult(parityResult, report);
}

async function runAuditPipeline() {
  try {
    return await executePipeline();
  } catch (error) {
    if (isTrustedComponentError(error)) throw error;
    throw new OrchestrationError("Audit pipeline execution failed");
  }
}

module.exports = Object.freeze({ runAuditPipeline });
