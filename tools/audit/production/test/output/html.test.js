"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { renderAuditOutput } = require("../../src/output");
const { CATEGORIES, MODULES } = require("../../src/output/policy");
const { populatedAuditResult, zeroAuditResult } = require("./helpers");

const EXACT_HEAD = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n" +
  "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; base-uri 'none'; form-action 'none'\">\n" +
  "<title>Cloud Crowd Audit Report</title>\n</head>\n<body>\n";

test("HTML has the exact fixed document shell and complete empty structure", async () => {
  const artifact = renderAuditOutput(await zeroAuditResult(), "html");
  assert.equal(artifact.mediaType, "text/html; charset=utf-8");
  assert.equal(artifact.fileExtension, ".html");
  assert.equal(artifact.content.startsWith(EXACT_HEAD), true);
  assert.equal(artifact.content.endsWith("</body>\n</html>\n"), true);
  assert.equal(artifact.content.endsWith("\n\n"), false);
  assert.equal(artifact.content.includes("<p>No parity findings were produced.</p>"), true);
  assert.deepEqual([...artifact.content.matchAll(/<h2>([^<]+)<\/h2>/g)].map((match) => match[1]).slice(1),
    MODULES.map((module) => module.heading));
  for (const category of CATEGORIES) {
    assert.equal((artifact.content.match(new RegExp(`<h3>${category.heading}<\\/h3>`, "g")) || []).length, 4);
  }
  assert.equal((artifact.content.match(/<p>No findings in this category\.<\/p>/g) || []).length, 32);
});

test("HTML is semantic, escaped, static, and contains no unsafe surface", async () => {
  const content = renderAuditOutput(await populatedAuditResult(), "html").content;
  assert.match(content, /<section>/);
  assert.match(content, /<ol>/);
  assert.match(content, /<dl>/);
  for (const forbidden of [/<script/i, /<style/i, /\sstyle=/i, /\son[a-z]+=/i, /<a\b/i, /<form/i, /<img/i,
    /data:/i, /https?:\/\//i, /<!--/, /application\/json/i, /sourceMappingURL/i]) assert.equal(forbidden.test(content), false);
});

test("HTML never emits source canaries", async () => {
  const content = renderAuditOutput(await populatedAuditResult(), "html").content;
  for (const canary of ["PRIVATE_BRANCH_CANARY", "PRIVATE_CUSTOMER_CANARY", "PRIVATE_PHONE_CANARY",
    "PRIVATE_NOTES_CANARY", "PRIVATE_SHEET_BRANCH_CANARY"]) assert.equal(content.includes(canary), false);
});
