"use strict";

const { Buffer } = require("node:buffer");
const {
  ParityInternalConsistencyError, ParityLimitError, ParityUnsupportedInputError, classifyError,
} = require("../errors");
const { comparePair } = require("./comparator");
const { fieldsFor } = require("./field-policy");
const { sortFindings } = require("./finding");
const { matchPartitions } = require("./matcher");
const { partitionBundle } = require("./partition");
const { buildSummary } = require("./summary");
const { LIMITS, MODULES, nullObject } = require("./validation");

const FIELD_ORDER = new Map();
for (const module of MODULES) {
  fieldsFor(module).forEach((field, index) => FIELD_ORDER.set(`${module}:${field}`, index));
  ["cameras", "sections", "staff", "violatedPolicy", "owner", "attachments"].forEach((field, index) =>
    FIELD_ORDER.set(`${module}:${field}`, fieldsFor(module).length + index));
}

function isParityError(error) {
  return classifyError(error).publicCode.startsWith("PARITY_");
}

function execute(bundle) {
  const findings = [];
  const partitioned = partitionBundle(bundle, findings);
  const matched = matchPartitions(partitioned.modules, findings);
  for (const pair of matched.pairs) comparePair(findings, pair);
  sortFindings(findings, MODULES, FIELD_ORDER);
  const frozenFindings = Object.freeze(findings);
  const summary = buildSummary(partitioned.trusted, frozenFindings, matched.stats);
  const result = nullObject([["findings", frozenFindings], ["summary", summary]]);
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(result), "utf8"); } catch (_) { throw new ParityInternalConsistencyError("Parity serialization failed"); }
  if (bytes > LIMITS.outputBytes) throw new ParityLimitError("Parity output limit exceeded");
  return result;
}

function compareCanonicalParityBundle(bundle) {
  if (arguments.length !== 1) throw new ParityUnsupportedInputError("Parity requires exactly one argument");
  try { return execute(bundle); } catch (error) {
    if (isParityError(error)) throw error;
    throw new ParityInternalConsistencyError("Parity operation failed");
  }
}

module.exports = Object.freeze({ compareCanonicalParityBundle });
