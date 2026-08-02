"use strict";

const {
  OutputInternalConsistencyError,
  OutputLimitError,
  OutputRenderError,
  OutputUnsupportedFormatError,
  classifyError,
} = require("../errors");
const { renderHtml } = require("./html");
const { renderJson } = require("./json");
const { renderMarkdown } = require("./markdown");
const { NEWLINE, OUTPUT_SCHEMA_VERSION } = require("./policy");
const { utf8Bytes } = require("./size");
const { validateAuditResult, validateFormat } = require("./validation");

const TRUSTED_OUTPUT_ARTIFACTS = new WeakMap();

const RENDERERS = Object.freeze(Object.assign(Object.create(null), {
  json: renderJson,
  markdown: renderMarkdown,
  html: renderHtml,
}));

function nullObject(entries) {
  const output = Object.create(null);
  for (const [key, value] of entries) Object.defineProperty(output, key, {
    value, enumerable: true, writable: false, configurable: false,
  });
  return Object.freeze(output);
}

function validateRenderedContent(content) {
  if (typeof content !== "string") throw new OutputInternalConsistencyError("Rendered artifact is invalid");
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if ((code < 0x20 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f) || code === 0x061c ||
        code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069)) {
      throw new OutputInternalConsistencyError("Rendered artifact is invalid");
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const following = content.charCodeAt(index + 1);
      if (!(following >= 0xdc00 && following <= 0xdfff)) {
        throw new OutputInternalConsistencyError("Rendered artifact is invalid");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new OutputInternalConsistencyError("Rendered artifact is invalid");
    }
  }
}

function finalizeRenderedArtifact(policy, content) {
  validateRenderedContent(content);
  if (content.includes("\r") || !content.endsWith(NEWLINE) || content.length < 2 ||
      content.at(-2) === NEWLINE || /[ \t]+\n/u.test(content)) {
    throw new OutputInternalConsistencyError("Rendered artifact is invalid");
  }
  const byteLength = utf8Bytes(content);
  if (byteLength > policy.maximumBytes) throw new OutputLimitError("Rendered artifact exceeds its byte limit");
  const artifact = nullObject([
    ["format", policy.format],
    ["mediaType", policy.mediaType],
    ["fileExtension", policy.fileExtension],
    ["outputSchemaVersion", OUTPUT_SCHEMA_VERSION],
    ["byteLength", byteLength],
    ["content", content],
  ]);
  TRUSTED_OUTPUT_ARTIFACTS.set(artifact, Object.freeze({
    producer: "renderAuditOutput",
    completenessState: "complete",
    format: policy.format,
  }));
  return artifact;
}

function verifyTrustedOutputArtifact(artifact) {
  const metadata = artifact && typeof artifact === "object" ? TRUSTED_OUTPUT_ARTIFACTS.get(artifact) : null;
  if (!metadata || metadata.producer !== "renderAuditOutput" || metadata.completenessState !== "complete") {
    throw new TypeError("Output artifact is not trusted");
  }
  return artifact;
}

function renderAuditOutput(result, format) {
  try {
    if (arguments.length !== 2) throw new OutputUnsupportedFormatError("Output rendering requires exactly two arguments");
    const policy = validateFormat(format);
    const trustedResult = validateAuditResult(result);
    const content = RENDERERS[format](trustedResult, policy);
    return finalizeRenderedArtifact(policy, content);
  } catch (error) {
    if (classifyError(error).publicCode !== "INTERNAL_ERROR") throw error;
    throw new OutputRenderError("Output rendering failed");
  }
}

Object.freeze(renderAuditOutput);
Object.freeze(verifyTrustedOutputArtifact);

module.exports = Object.freeze({ renderAuditOutput, verifyTrustedOutputArtifact });
