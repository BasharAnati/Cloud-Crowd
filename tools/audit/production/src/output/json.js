"use strict";

const { OutputInternalConsistencyError, OutputLimitError } = require("../errors");
const { NEWLINE, OUTPUT_SCHEMA_VERSION } = require("./policy");
const { utf8Bytes } = require("./size");
const { validateJsonGraph } = require("./validation");

function nullObject(entries) {
  return Object.freeze(Object.assign(Object.create(null), Object.fromEntries(entries)));
}

function renderJson(result, policy) {
  const projection = nullObject([
    ["outputType", "cloud-crowd-audit"],
    ["outputSchemaVersion", OUTPUT_SCHEMA_VERSION],
    ["execution", nullObject([
      ["schemaVersion", result.metadata.schemaVersion],
      ["executionVersion", result.metadata.executionVersion],
      ["completed", result.metadata.completed],
    ])],
    ["report", result.report],
  ]);
  validateJsonGraph(projection);
  let content;
  try { content = `${JSON.stringify(projection)}${NEWLINE}`; } catch (_) {
    throw new OutputInternalConsistencyError("JSON serialization failed");
  }
  if (utf8Bytes(content) > policy.maximumBytes) throw new OutputLimitError("JSON output exceeds its byte limit");
  return content;
}

Object.freeze(renderJson);

module.exports = Object.freeze({ renderJson });
