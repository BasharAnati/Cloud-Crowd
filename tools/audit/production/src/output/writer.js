"use strict";

const { OutputInternalConsistencyError, OutputLimitError } = require("../errors");
const { LIMITS, NEWLINE } = require("./policy");
const { utf8Bytes } = require("./size");

function createBoundedWriter(formatPolicy) {
  const chunks = [];
  let bytes = 0;
  let lines = 0;
  let entries = 0;
  let references = 0;
  let htmlNodes = 0;

  function limit() { throw new OutputLimitError("Rendered output limit exceeded"); }

  function line(value = "", nodes = 0) {
    if (typeof value !== "string" || value.includes("\r") || value.includes("\n") || /[ \t]$/.test(value) ||
        !Number.isSafeInteger(nodes) || nodes < 0) {
      throw new OutputInternalConsistencyError("Rendered line is invalid");
    }
    const chunk = `${value}${NEWLINE}`;
    const chunkBytes = utf8Bytes(chunk);
    if (bytes + chunkBytes > formatPolicy.maximumBytes || lines + 1 > LIMITS.lines ||
        htmlNodes + nodes > LIMITS.htmlNodes) limit();
    chunks.push(chunk);
    bytes += chunkBytes;
    lines += 1;
    htmlNodes += nodes;
  }

  function entry() {
    if (entries + 1 > LIMITS.entries) limit();
    entries += 1;
  }

  function reference() {
    if (references + 1 > LIMITS.references) limit();
    references += 1;
  }

  function finish() {
    const content = chunks.join("");
    if (content.length < 2 || !content.endsWith(NEWLINE) || content.at(-2) === NEWLINE ||
        content.includes("\r") || utf8Bytes(content) !== bytes) {
      throw new OutputInternalConsistencyError("Rendered output is inconsistent");
    }
    return content;
  }

  return Object.freeze({ line, entry, reference, finish });
}

Object.freeze(createBoundedWriter);

module.exports = Object.freeze({ createBoundedWriter });
