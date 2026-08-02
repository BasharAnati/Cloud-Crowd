"use strict";

const { OutputInternalConsistencyError } = require("../errors");
const { CATEGORIES, MODULES, OVERVIEW_FIELDS, TEXT } = require("./policy");
const { escapeMarkdown } = require("./escaping");
const { createBoundedWriter } = require("./writer");

function numberText(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new OutputInternalConsistencyError("Rendered count is invalid");
  return String(value);
}

function codeLabel(value) {
  if (value === null) return "None";
  return `${escapeMarkdown(value.label)} (${escapeMarkdown(value.code)})`;
}

function lineValue(value) {
  return value === null ? "None" : escapeMarkdown(value);
}

function renderReferences(writer, references, indent) {
  for (const reference of references) {
    writer.reference();
    writer.line(`${indent}- ${escapeMarkdown(reference.label)}`);
  }
}

function renderEntry(writer, entry, index, indent) {
  writer.entry();
  writer.line(`${indent}- Finding ${index + 1}`);
  writer.line(`${indent}  - Class: ${codeLabel(entry.class)}`);
  writer.line(`${indent}  - Field: ${codeLabel(entry.field)}`);
  writer.line(`${indent}  - Identity fingerprint: ${lineValue(entry.identityFingerprint)}`);
  writer.line(`${indent}  - PostgreSQL references:`);
  if (entry.references.postgres.length === 0) writer.line(`${indent}    - None`);
  else renderReferences(writer, entry.references.postgres, `${indent}    `);
  writer.line(`${indent}  - Google Sheets references:`);
  if (entry.references.sheets.length === 0) writer.line(`${indent}    - None`);
  else renderReferences(writer, entry.references.sheets, `${indent}    `);
  if (entry.states === null) writer.line(`${indent}  - States: None`);
  else {
    writer.line(`${indent}  - States:`);
    writer.line(`${indent}    - PostgreSQL: ${codeLabel(entry.states.postgres)}`);
    writer.line(`${indent}    - Google Sheets: ${codeLabel(entry.states.sheets)}`);
  }
  writer.line(`${indent}  - Comparability: ${codeLabel(entry.comparability)}`);
  writer.line(`${indent}  - Evidence: ${codeLabel(entry.evidence)}`);
  if (entry.counts === null) writer.line(`${indent}  - Duplicate counts: None`);
  else {
    writer.line(`${indent}  - Duplicate counts:`);
    writer.line(`${indent}    - PostgreSQL: ${numberText(entry.counts.postgres)}`);
    writer.line(`${indent}    - Google Sheets: ${numberText(entry.counts.sheets)}`);
  }
}

function renderCategory(writer, category, expected) {
  if (category.category !== expected.code || category.label !== expected.heading) {
    throw new OutputInternalConsistencyError("Report category order is invalid");
  }
  writer.line(`### ${expected.heading}`);
  writer.line("");
  writer.line(`- Finding count: ${numberText(category.findingCount)}`);
  if (category.findingGroups.length === 0) writer.line(`- ${TEXT.emptyCategory}`);
  for (const group of category.findingGroups) {
    writer.line(`- Finding type: ${escapeMarkdown(group.label)} (${escapeMarkdown(group.findingType)})`);
    writer.line(`  - Description: ${escapeMarkdown(group.description)}`);
    writer.line(`  - Finding count: ${numberText(group.findingCount)}`);
    writer.line("  - Entries:");
    for (let index = 0; index < group.entries.length; index += 1) renderEntry(writer, group.entries[index], index, "    ");
  }
}

function renderMarkdown(result, policy) {
  const writer = createBoundedWriter(policy);
  const { report } = result;
  writer.line(`# ${TEXT.title}`);
  writer.line("");
  writer.line(`## ${TEXT.overview}`);
  writer.line("");
  writer.line(`- Output schema version: ${escapeMarkdown("1")}`);
  writer.line(`- Report schema version: ${escapeMarkdown(result.metadata.schemaVersion)}`);
  writer.line(`- Execution version: ${escapeMarkdown(result.metadata.executionVersion)}`);
  writer.line(`- Completed: ${result.metadata.completed ? "true" : "false"}`);
  for (const [key, label] of OVERVIEW_FIELDS) writer.line(`- ${label}: ${numberText(report.overview[key])}`);
  if (report.overview.totalFindings === 0) {
    writer.line("");
    writer.line(TEXT.zeroFindings);
  }
  for (let moduleIndex = 0; moduleIndex < MODULES.length; moduleIndex += 1) {
    const expectedModule = MODULES[moduleIndex];
    const section = report.moduleSections[moduleIndex];
    if (!section || section.module !== expectedModule.code || section.label !== expectedModule.heading ||
        section.categorySections.length !== CATEGORIES.length) {
      throw new OutputInternalConsistencyError("Report module order is invalid");
    }
    writer.line("");
    writer.line(`## ${expectedModule.heading}`);
    writer.line("");
    writer.line(`- Finding count: ${numberText(section.findingCount)}`);
    for (let categoryIndex = 0; categoryIndex < CATEGORIES.length; categoryIndex += 1) {
      writer.line("");
      renderCategory(writer, section.categorySections[categoryIndex], CATEGORIES[categoryIndex]);
    }
  }
  return writer.finish();
}

Object.freeze(renderMarkdown);

module.exports = Object.freeze({ renderMarkdown });
