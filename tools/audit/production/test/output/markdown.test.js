"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { renderAuditOutput } = require("../../src/output");
const { CATEGORIES, MODULES } = require("../../src/output/policy");
const { populatedAuditResult, zeroAuditResult } = require("./helpers");

test("Markdown has the exact fixed zero-report structure", async () => {
  const artifact = renderAuditOutput(await zeroAuditResult(), "markdown");
  assert.equal(artifact.mediaType, "text/markdown; charset=utf-8");
  assert.equal(artifact.fileExtension, ".md");
  assert.equal(artifact.content.startsWith("# Cloud Crowd Audit Report\n\n## Overview\n\n"), true);
  assert.equal(artifact.content.includes("\nNo parity findings were produced.\n"), true);
  const moduleHeadings = artifact.content.match(/^## .+$/gm).slice(1);
  assert.deepEqual(moduleHeadings, MODULES.map((module) => `## ${module.heading}`));
  for (const module of MODULES) {
    const start = artifact.content.indexOf(`## ${module.heading}\n`);
    const next = MODULES.findIndex((candidate) => candidate === module) + 1;
    const end = next < MODULES.length ? artifact.content.indexOf(`## ${MODULES[next].heading}\n`) : artifact.content.length;
    const section = artifact.content.slice(start, end);
    assert.deepEqual(section.match(/^### .+$/gm), CATEGORIES.map((category) => `### ${category.heading}`));
    assert.equal((section.match(/^- No findings in this category\.$/gm) || []).length, 8);
  }
  assert.equal(artifact.content.includes("\r"), false);
  assert.equal(artifact.content.endsWith("\n"), true);
  assert.equal(artifact.content.endsWith("\n\n"), false);
  assert.equal(/[ \t]+$/m.test(artifact.content), false);
});

test("Markdown uses bullets, nested references, fingerprints, and no tables or links", async () => {
  const content = renderAuditOutput(await populatedAuditResult(), "markdown").content;
  assert.match(content, /^- Finding type:/m);
  assert.match(content, /^    - Finding \d+$/m);
  assert.match(content, /^      - Identity fingerprint: (?:CCTV|CE|COMPLAINTS|COMPLIMENTARY)\\-[0-9a-f]{24}$/m);
  assert.match(content, /^        - (?:DB ticket|Sheet row): [1-9][0-9]*$/m);
  assert.equal(content.includes("| --- |"), false);
  assert.equal(/\[[^\]]+\]\([^\)]+\)/.test(content), false);
  assert.equal(/https?:\/\//.test(content), false);
  assert.equal(/<\/?[a-z][^>]*>/i.test(content), false);
});

test("Markdown never emits source canaries or outcome/release wording", async () => {
  const content = renderAuditOutput(await populatedAuditResult(), "markdown").content;
  for (const canary of ["PRIVATE_BRANCH_CANARY", "PRIVATE_CUSTOMER_CANARY", "PRIVATE_PHONE_CANARY", "PRIVATE_NOTES_CANARY"])
    assert.equal(content.includes(canary), false);
  for (const word of ["PASS", "SUCCESS", "CLEAN", "HEALTHY", "READY", "COMPLIANT", "FAILED", "BLOCKED", "release decision"])
    assert.equal(content.includes(word), false);
});
