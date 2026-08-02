"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyError } = require("../../src/errors");
const { escapeHtml, escapeMarkdown, validateText } = require("../../src/output/escaping");

function internal(error) {
  assert.equal(classifyError(error).publicCode, "OUTPUT_INTERNAL_CONSISTENCY_FAILURE");
  assert.equal(classifyError(error).exitCode, 11);
  return true;
}

test("valid Unicode including ordinary Arabic and Hebrew is preserved", () => {
  for (const value of ["تقرير تدقيق", "דוח ביקורת", "audit 😀 café"]) {
    assert.equal(validateText(value), value);
    assert.equal(escapeMarkdown(value), value);
    assert.equal(escapeHtml(value), value);
  }
});

test("unpaired surrogates, controls, embedded layout, and bidi controls fail closed", () => {
  const invalid = [
    "\ud800", "\udc00", "a\ud800b", "\u0000", "\u001f", "\u007f", "\u0085",
    "line\rbreak", "line\nbreak", "tab\tvalue", "left\u202eright", "isolate\u2066value", "mark\u200fvalue",
  ];
  for (const value of invalid) assert.throws(() => validateText(value), internal);
  assert.throws(() => validateText(new String("text")), internal);
  const proxy = new Proxy(new String("text"), {});
  assert.throws(() => validateText(proxy), internal);
});

test("Markdown escaping covers every structural surface", () => {
  const source = "\\ ` * _ { } [ ] ( ) # + - . ! | > < &";
  const escaped = escapeMarkdown(source);
  for (const token of ["\\\\", "\\`", "\\*", "\\_", "\\{", "\\}", "\\[", "\\]", "\\(", "\\)",
    "\\#", "\\+", "\\-", "\\.", "\\!", "\\|", "&gt;", "&lt;", "&amp;"]) assert.equal(escaped.includes(token), true, token);
  assert.equal(/<[^>]*>/.test(escaped), false);
});

test("HTML escaping covers text and attribute metacharacters", () => {
  assert.equal(escapeHtml("&<>\"'"), "&amp;&lt;&gt;&quot;&#39;");
});
