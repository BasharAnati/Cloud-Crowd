"use strict";

const { OutputInternalConsistencyError } = require("../errors");
const { CATEGORIES, MODULES, OVERVIEW_FIELDS, TEXT } = require("./policy");
const { escapeHtml } = require("./escaping");
const { createBoundedWriter } = require("./writer");

function numberText(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new OutputInternalConsistencyError("Rendered count is invalid");
  return String(value);
}

function codeLabel(value) {
  if (value === null) return "None";
  return `${escapeHtml(value.label)} (${escapeHtml(value.code)})`;
}

function lineValue(value) { return value === null ? "None" : escapeHtml(value); }

function htmlLine(writer, value) {
  const nodes = [...value.matchAll(/<(?!\/|!)(?:[a-z][a-z0-9]*)\b/gu)].length;
  writer.line(value, nodes);
}

function definition(writer, term, value) {
  htmlLine(writer, `<dt>${term}</dt>`);
  htmlLine(writer, `<dd>${value}</dd>`);
}

function referenceList(writer, references) {
  htmlLine(writer, "<ul>");
  if (references.length === 0) htmlLine(writer, "<li>None</li>");
  for (const reference of references) {
    writer.reference();
    htmlLine(writer, `<li>${escapeHtml(reference.label)}</li>`);
  }
  htmlLine(writer, "</ul>");
}

function renderEntry(writer, entry) {
  writer.entry();
  htmlLine(writer, "<li>");
  htmlLine(writer, "<dl>");
  definition(writer, "Class", codeLabel(entry.class));
  definition(writer, "Field", codeLabel(entry.field));
  definition(writer, "Identity fingerprint", lineValue(entry.identityFingerprint));
  htmlLine(writer, "<dt>PostgreSQL references</dt>");
  htmlLine(writer, "<dd>");
  referenceList(writer, entry.references.postgres);
  htmlLine(writer, "</dd>");
  htmlLine(writer, "<dt>Google Sheets references</dt>");
  htmlLine(writer, "<dd>");
  referenceList(writer, entry.references.sheets);
  htmlLine(writer, "</dd>");
  if (entry.states === null) definition(writer, "States", "None");
  else {
    htmlLine(writer, "<dt>States</dt>");
    htmlLine(writer, "<dd>");
    htmlLine(writer, "<dl>");
    definition(writer, "PostgreSQL", codeLabel(entry.states.postgres));
    definition(writer, "Google Sheets", codeLabel(entry.states.sheets));
    htmlLine(writer, "</dl>");
    htmlLine(writer, "</dd>");
  }
  definition(writer, "Comparability", codeLabel(entry.comparability));
  definition(writer, "Evidence", codeLabel(entry.evidence));
  if (entry.counts === null) definition(writer, "Duplicate counts", "None");
  else {
    htmlLine(writer, "<dt>Duplicate counts</dt>");
    htmlLine(writer, "<dd>");
    htmlLine(writer, "<dl>");
    definition(writer, "PostgreSQL", numberText(entry.counts.postgres));
    definition(writer, "Google Sheets", numberText(entry.counts.sheets));
    htmlLine(writer, "</dl>");
    htmlLine(writer, "</dd>");
  }
  htmlLine(writer, "</dl>");
  htmlLine(writer, "</li>");
}

function renderCategory(writer, category, expected) {
  if (category.category !== expected.code || category.label !== expected.heading) {
    throw new OutputInternalConsistencyError("Report category order is invalid");
  }
  htmlLine(writer, "<section>");
  htmlLine(writer, `<h3>${expected.heading}</h3>`);
  htmlLine(writer, `<p>Finding count: ${numberText(category.findingCount)}</p>`);
  if (category.findingGroups.length === 0) htmlLine(writer, `<p>${TEXT.emptyCategory}</p>`);
  for (const group of category.findingGroups) {
    htmlLine(writer, "<section>");
    htmlLine(writer, `<h4>${escapeHtml(group.label)} (${escapeHtml(group.findingType)})</h4>`);
    htmlLine(writer, `<p>${escapeHtml(group.description)}</p>`);
    htmlLine(writer, `<p>Finding count: ${numberText(group.findingCount)}</p>`);
    htmlLine(writer, "<ol>");
    for (const entry of group.entries) renderEntry(writer, entry);
    htmlLine(writer, "</ol>");
    htmlLine(writer, "</section>");
  }
  htmlLine(writer, "</section>");
}

function renderHtml(result, policy) {
  const writer = createBoundedWriter(policy);
  const { report } = result;
  writer.line("<!doctype html>");
  htmlLine(writer, '<html lang="en">');
  htmlLine(writer, "<head>");
  htmlLine(writer, '<meta charset="utf-8">');
  htmlLine(writer, '<meta name="viewport" content="width=device-width, initial-scale=1">');
  htmlLine(writer, '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; form-action \'none\'">');
  htmlLine(writer, `<title>${TEXT.title}</title>`);
  htmlLine(writer, "</head>");
  htmlLine(writer, "<body>");
  htmlLine(writer, `<h1>${TEXT.title}</h1>`);
  htmlLine(writer, "<section>");
  htmlLine(writer, `<h2>${TEXT.overview}</h2>`);
  htmlLine(writer, "<dl>");
  definition(writer, "Output schema version", "1");
  definition(writer, "Report schema version", escapeHtml(result.metadata.schemaVersion));
  definition(writer, "Execution version", escapeHtml(result.metadata.executionVersion));
  definition(writer, "Completed", result.metadata.completed ? "true" : "false");
  for (const [key, label] of OVERVIEW_FIELDS) definition(writer, label, numberText(report.overview[key]));
  htmlLine(writer, "</dl>");
  if (report.overview.totalFindings === 0) htmlLine(writer, `<p>${TEXT.zeroFindings}</p>`);
  htmlLine(writer, "</section>");
  for (let moduleIndex = 0; moduleIndex < MODULES.length; moduleIndex += 1) {
    const expectedModule = MODULES[moduleIndex];
    const section = report.moduleSections[moduleIndex];
    if (!section || section.module !== expectedModule.code || section.label !== expectedModule.heading ||
        section.categorySections.length !== CATEGORIES.length) {
      throw new OutputInternalConsistencyError("Report module order is invalid");
    }
    htmlLine(writer, "<section>");
    htmlLine(writer, `<h2>${expectedModule.heading}</h2>`);
    htmlLine(writer, `<p>Finding count: ${numberText(section.findingCount)}</p>`);
    for (let categoryIndex = 0; categoryIndex < CATEGORIES.length; categoryIndex += 1) {
      renderCategory(writer, section.categorySections[categoryIndex], CATEGORIES[categoryIndex]);
    }
    htmlLine(writer, "</section>");
  }
  htmlLine(writer, "</body>");
  htmlLine(writer, "</html>");
  return writer.finish();
}

Object.freeze(renderHtml);

module.exports = Object.freeze({ renderHtml });
