"use strict";

const { OutputInternalConsistencyError } = require("../errors");

const DISALLOWED_CONTROLS = /[\u0000-\u001f\u007f-\u009f]/u;
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const MARKDOWN_SPECIAL = /[\\`*_{}\[\]()#+\-.!|>]/g;

function invalidText() {
  throw new OutputInternalConsistencyError("Rendered text is invalid");
}

function validateText(value) {
  if (typeof value !== "string" || DISALLOWED_CONTROLS.test(value) || BIDI_CONTROLS.test(value)) invalidText();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (!(following >= 0xdc00 && following <= 0xdfff)) invalidText();
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) invalidText();
  }
  return value;
}

function escapeMarkdown(value) {
  return validateText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(MARKDOWN_SPECIAL, "\\$&");
}

function escapeHtml(value) {
  return validateText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

for (const operation of [validateText, escapeMarkdown, escapeHtml]) Object.freeze(operation);

module.exports = Object.freeze({ escapeHtml, escapeMarkdown, validateText });
