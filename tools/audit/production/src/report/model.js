"use strict";

const { Buffer } = require("node:buffer");
const {
  categoryLabel, classLabel, comparabilityLabel, evidenceLabel, fieldLabel, moduleLabel, stateLabel,
} = require("./policy");

function nullObject(entries) {
  const output = Object.create(null);
  for (const [key, value] of entries) Object.defineProperty(output, key, {
    value, enumerable: true, writable: false, configurable: false,
  });
  return Object.freeze(output);
}

function codeLabel(code, label) { return code === null ? null : nullObject([["code", code], ["label", label]]); }

function reference(source, value) {
  const postgres = source === "postgresql";
  return nullObject([
    ["source", source], ["kind", postgres ? "ticket" : "row"], ["value", value],
    ["label", postgres ? `DB ticket: ${value}` : `Sheet row: ${value}`],
  ]);
}

function referencesFor(finding, source) {
  const single = finding[source === "postgresql" ? "postgresReference" : "sheetsReference"];
  const multiple = finding[source === "postgresql" ? "postgresReferences" : "sheetsReferences"];
  const values = multiple === null ? (single === null ? [] : [single]) : multiple;
  return Object.freeze(values.map((value) => reference(source, value)));
}

function findingEntry(finding) {
  const states = finding.postgresState === null && finding.sheetsState === null ? null : nullObject([
    ["postgres", codeLabel(finding.postgresState, stateLabel(finding.postgresState))],
    ["sheets", codeLabel(finding.sheetsState, stateLabel(finding.sheetsState))],
  ]);
  const counts = finding.counts === null ? null : nullObject([
    ["postgres", finding.counts.postgres], ["sheets", finding.counts.sheets],
  ]);
  return nullObject([
    ["class", codeLabel(finding.class, classLabel(finding.class))],
    ["field", codeLabel(finding.field, fieldLabel(finding.field))],
    ["identityFingerprint", finding.identityFingerprint],
    ["references", nullObject([
      ["postgres", referencesFor(finding, "postgresql")], ["sheets", referencesFor(finding, "google-sheets")],
    ])],
    ["states", states],
    ["comparability", codeLabel(finding.comparability, comparabilityLabel(finding.comparability))],
    ["evidence", codeLabel(finding.evidenceCode, evidenceLabel(finding.evidenceCode))],
    ["counts", counts],
  ]);
}

function zeroMap(keys) { return nullObject(keys.map((key) => [key, 0])); }

function stringBytes(value) {
  let bytes = 2;
  for (const character of value) {
    const code = character.codePointAt(0);
    if (character === '"' || character === "\\") bytes += 2;
    else if (code <= 0x1f) bytes += 6;
    else bytes += Buffer.byteLength(character, "utf8");
  }
  return bytes;
}

function estimateModelBytes(value, seen = new Set()) {
  if (value === null) return 4;
  if (typeof value === "string") return stringBytes(value);
  if (typeof value === "number") return String(value).length;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (!value || typeof value !== "object" || seen.has(value)) throw new TypeError("Report model cannot be estimated");
  seen.add(value);
  let bytes;
  if (Array.isArray(value)) {
    bytes = 2 + Math.max(0, value.length - 1);
    for (const item of value) bytes += estimateModelBytes(item, seen);
  } else {
    const keys = Object.keys(value);
    bytes = 2 + Math.max(0, keys.length - 1);
    for (const key of keys) bytes += stringBytes(key) + 1 + estimateModelBytes(value[key], seen);
  }
  seen.delete(value);
  return bytes;
}

module.exports = Object.freeze({
  categoryLabel, codeLabel, estimateModelBytes, findingEntry, moduleLabel, nullObject, zeroMap,
});
