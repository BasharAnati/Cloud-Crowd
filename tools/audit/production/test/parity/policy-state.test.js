"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyError } = require("../../src/errors");
const parity = require("../../src/parity");
const policy = require("../../src/parity/field-policy");
const { comparePair } = require("../../src/parity/comparator");
const { stateFor } = require("../../src/parity/validation");
const { bundle, postgresTicket, sheetRow } = require("./helpers");

function recordWithState(state, value, statesOverride, field = "field") {
  const states = statesOverride || Object.freeze(Object.assign(Object.create(null), { [field]: state }));
  return Object.freeze(Object.assign(Object.create(null), {
    [field]: value,
    sourceMetadata: Object.freeze(Object.assign(Object.create(null), { fieldStates: states })),
  }));
}

function assertConsistencyFailure(operation) {
  assert.throws(operation, (error) => {
    const classification = classifyError(error);
    assert.equal(classification.publicCode, "PARITY_INTERNAL_CONSISTENCY_FAILURE");
    assert.equal(classification.exitCode, 8);
    return true;
  });
}

test("date and field-role policy exposes only frozen functions and frozen field arrays", () => {
  assert.deepEqual(Object.keys(policy), ["CCTV_COLLECTION_FIELDS", "fieldRole", "fieldsFor", "isDateField"]);
  assert.equal(Object.isFrozen(policy), true);
  for (const value of Object.values(policy)) {
    assert.equal(value instanceof Set || value instanceof Map, false);
    assert.equal(Object.isFrozen(value), true);
  }
  for (const module of ["cctv", "customer-experience", "complaints", "complimentary-orders"])
    assert.equal(Object.isFrozen(policy.fieldsFor(module)), true);
  assert.equal(policy.fieldRole("cctv", "createdAt"), "COMPARABLE");
  assert.equal(policy.fieldRole("cctv", "cctvDate"), "SOURCE_ONLY");
  assert.equal(policy.fieldRole("cctv", "cctvTime"), "SOURCE_ONLY");
  assert.equal(policy.fieldRole("complimentary-orders", "channel"), "SOURCE_ONLY");
});

test("importing field policy cannot alter date comparison behavior", async () => {
  const input = await bundle([postgresTicket(1, "ce", "DATE", { creationDate: "2026-03-04" })], {
    "customer-experience": [sheetRow("customer-experience", "DATE", { 4: "2026-03-04" })],
  });
  const before = parity.compareCanonicalParityBundle(input);
  assert.throws(() => policy.fieldsFor("customer-experience").push("status"));
  assert.throws(() => { policy.isDateField = () => false; });
  assert.equal(Object.hasOwn(policy, "DATE_FIELDS"), false);
  assert.deepEqual(parity.compareCanonicalParityBundle(input), before);

  for (const name of ["../../src/parity/index", "../../src/parity/adapter", "../../src/parity/comparator", "../../src/parity/field-policy"])
    delete require.cache[require.resolve(name)];
  const independentlyLoaded = require("../../src/parity");
  assert.deepEqual(independentlyLoaded.compareCanonicalParityBundle(input), before);
});

test("source-only fields do not generate fabricated per-record non-comparability", async () => {
  const input = await bundle([
    postgresTicket(1, "cctv", "C-1", { dateTime: "2026-03-04T10:30" }),
    postgresTicket(2, "free-orders", "F-1", { channel: "postgres-only" }),
  ], {
    cctv: [sheetRow("cctv", "C-1", { 2: "2026-03-04T10:30" })],
    "complimentary-orders": [sheetRow("complimentary-orders", "F-1")],
  });
  const result = parity.compareCanonicalParityBundle(input);
  assert.equal(result.findings.some((finding) => ["cctvDate", "cctvTime", "channel"].includes(finding.field)), false);
  assert.equal(result.findings.some((finding) => finding.field === "createdAt" && finding.findingType === "FIELD_VALUE_MISMATCH"), false);
});

test("approved canonical state/value combinations are accepted", () => {
  const combinations = [
    ["MISSING", null], ["EXPLICIT_NULL", null], ["EMPTY_STRING", ""],
    ["OMITTED_TRAILING_CELL", null], ["AMBIGUOUS", null],
    ["UNSUPPORTED", null], ["VALUE", "value"],
  ];
  for (const [state, value] of combinations) assert.equal(stateFor(recordWithState(state, value), "field"), state);
  const date = Object.freeze(Object.assign(Object.create(null), {
    raw: "2026-01-01", instant: null, local: "2026-01-01", precision: "date", timezoneKnown: false,
  }));
  assert.equal(stateFor(recordWithState("VALUE", date, undefined, "createdAt"), "createdAt"), "VALUE");
  assert.equal(stateFor(recordWithState("EMPTY_STRING", null, undefined, "createdAt"), "createdAt"), "EMPTY_STRING");
  assert.equal(stateFor(recordWithState("EMPTY_ARRAY", Object.freeze([]), undefined, "attachments"), "attachments"), "EMPTY_ARRAY");
});

test("missing, malformed, contradictory, accessor, and hostile state metadata fail closed", () => {
  const invalid = [
    recordWithState("NOT_A_STATE", null),
    recordWithState("VALUE", null),
    recordWithState("VALUE", ""),
    recordWithState("EMPTY_STRING", "not-empty"),
    recordWithState("EMPTY_ARRAY", Object.freeze(["value"])),
    recordWithState("MISSING", "invented"),
    recordWithState("EXPLICIT_NULL", "invented"),
    recordWithState("OMITTED_TRAILING_CELL", "invented"),
  ];
  const noState = Object.freeze(Object.assign(Object.create(null), {}));
  invalid.push(recordWithState(undefined, null, noState));
  for (const record of invalid) assertConsistencyFailure(() => stateFor(record, "field"));

  const accessorStates = Object.create(null);
  Object.defineProperty(accessorStates, "field", { enumerable: true, get() { throw new Error("secret trap"); } });
  assertConsistencyFailure(() => stateFor(recordWithState(undefined, null, Object.freeze(accessorStates)), "field"));
  assertConsistencyFailure(() => stateFor(recordWithState(undefined, null, new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("secret trap"); } })), "field"));
});

function comparisonRecord(source, statusState, statusValue, omitStatus = false) {
  const values = Object.create(null);
  const states = Object.create(null);
  for (const field of policy.fieldsFor("complaints")) {
    values[field] = null;
    states[field] = "MISSING";
  }
  if (!omitStatus) {
    values.status = statusValue;
    states.status = statusState;
  } else delete states.status;
  values.source = source;
  values.ticketId = source === "postgresql" ? "1" : null;
  values.rowReference = source === "google-sheets" ? "2" : null;
  values.sourceMetadata = Object.freeze(Object.assign(Object.create(null), { fieldStates: Object.freeze(states) }));
  return Object.freeze(values);
}

function compareStatus(postgresState, postgresValue, sheetsState, sheetsValue) {
  const findings = [];
  comparePair(findings, {
    module: "complaints", identity: { fingerprint: "COMPLAINTS-synthetic" }, comparable: true,
    postgres: comparisonRecord("postgresql", postgresState, postgresValue),
    sheets: comparisonRecord("google-sheets", sheetsState, sheetsValue),
  });
  return findings.filter((finding) => finding.field === "status");
}

test("field-state comparison matrix remains closed and state-sensitive", () => {
  assert.equal(compareStatus("MISSING", null, "MISSING", null).length, 0);
  assert.equal(compareStatus("MISSING", null, "EXPLICIT_NULL", null)[0].findingType, "FIELD_STATE_MISMATCH");
  assert.equal(compareStatus("EXPLICIT_NULL", null, "EXPLICIT_NULL", null).length, 0);
  assert.equal(compareStatus("EMPTY_STRING", "", "EMPTY_STRING", "").length, 0);
  assert.equal(compareStatus("EMPTY_STRING", "", "OMITTED_TRAILING_CELL", null)[0].findingType, "FIELD_STATE_MISMATCH");
  assert.equal(compareStatus("AMBIGUOUS", null, "VALUE", "value")[0].findingType, "FIELD_NOT_COMPARABLE");
  assert.equal(compareStatus("UNSUPPORTED", null, "VALUE", "value")[0].findingType, "FIELD_NOT_COMPARABLE");
  assert.equal(compareStatus("VALUE", "same", "VALUE", "same").length, 0);
  assert.equal(compareStatus("VALUE", "left", "VALUE", "right")[0].findingType, "FIELD_VALUE_MISMATCH");
});

test("a compared field with absent state metadata fails before emitting a finding", () => {
  const findings = [];
  assertConsistencyFailure(() => comparePair(findings, {
    module: "complaints", identity: { fingerprint: "COMPLAINTS-synthetic" }, comparable: true,
    postgres: comparisonRecord("postgresql", "MISSING", null, true),
    sheets: comparisonRecord("google-sheets", "MISSING", null),
  }));
  assert.deepEqual(findings, []);
});

function collectionValue(raw, items, extraEntries = []) {
  return Object.freeze(Object.assign(Object.create(null), { raw, items }, Object.fromEntries(extraEntries)));
}

function cctvComparisonRecord(source, camerasState, camerasValue) {
  const values = Object.create(null);
  const states = Object.create(null);
  for (const field of policy.fieldsFor("cctv")) {
    values[field] = null;
    states[field] = "MISSING";
  }
  for (const field of policy.CCTV_COLLECTION_FIELDS) {
    values[field] = collectionValue(null, null);
    states[field] = "MISSING";
  }
  values.cameras = camerasValue;
  states.cameras = camerasState;
  values.owner = null;
  states.owner = "MISSING";
  values.cctvMetadataClassification = "CREATION_METADATA";
  values.source = source;
  values.ticketId = source === "postgresql" ? "1" : null;
  values.rowReference = source === "google-sheets" ? "2" : null;
  values.sourceMetadata = Object.freeze(Object.assign(Object.create(null), { fieldStates: Object.freeze(states) }));
  return Object.freeze(values);
}

function compareCameras(state, value) {
  const findings = [];
  comparePair(findings, {
    module: "cctv", identity: { fingerprint: "CCTV-synthetic" }, comparable: true,
    postgres: cctvComparisonRecord("postgresql", state, value),
    sheets: cctvComparisonRecord("google-sheets", state, value),
  });
  return findings;
}

test("scalar comparison states reject collection descriptors without partial findings", () => {
  const descriptor = collectionValue(null, null);
  for (const state of ["VALUE", "MISSING", "EXPLICIT_NULL", "AMBIGUOUS", "UNSUPPORTED"]) {
    const findings = [];
    assertConsistencyFailure(() => comparePair(findings, {
      module: "complaints", identity: { fingerprint: "COMPLAINTS-synthetic" }, comparable: true,
      postgres: comparisonRecord("postgresql", state, descriptor),
      sheets: comparisonRecord("google-sheets", state, descriptor),
    }));
    assert.deepEqual(findings, []);
  }
});

test("collection comparison accepts only exact frozen null-prototype data descriptors", () => {
  const populated = collectionValue("confirmed", null);
  assert.doesNotThrow(() => compareCameras("VALUE", populated));

  const inheritedPrototype = Object.freeze(Object.assign(Object.create(null), { raw: null, items: null }));
  const inherited = Object.freeze(Object.create(inheritedPrototype));
  const accessor = Object.create(null);
  Object.defineProperties(accessor, {
    raw: { enumerable: true, get() { return null; } },
    items: { enumerable: true, get() { return null; } },
  });
  Object.freeze(accessor);
  const proxy = new Proxy(collectionValue(null, null), {});
  const extra = collectionValue(null, null, [["unexpected", true]]);
  const missing = Object.freeze(Object.assign(Object.create(null), { raw: null }));
  const customPrototype = Object.freeze(Object.assign(Object.create({ marker: true }), { raw: null, items: null }));
  const plainObject = Object.freeze({ raw: null, items: null });
  const emptyValue = collectionValue(null, null);

  const extraItems = ["confirmed"];
  extraItems.extra = "unexpected";
  Object.freeze(extraItems);
  const symbolItems = ["confirmed"];
  Object.defineProperty(symbolItems, Symbol("unexpected"), { value: true });
  Object.freeze(symbolItems);
  const accessorItems = ["confirmed"];
  Object.defineProperty(accessorItems, "extra", { get() { return "unexpected"; } });
  Object.freeze(accessorItems);
  const customItems = ["confirmed"];
  Object.setPrototypeOf(customItems, Object.create(Array.prototype));
  Object.freeze(customItems);

  for (const value of [
    inherited, accessor, proxy, extra, missing, customPrototype, plainObject, emptyValue,
    collectionValue(null, extraItems), collectionValue(null, symbolItems),
    collectionValue(null, accessorItems), collectionValue(null, customItems),
  ]) {
    const findings = [];
    assertConsistencyFailure(() => comparePair(findings, {
      module: "cctv", identity: { fingerprint: "CCTV-synthetic" }, comparable: true,
      postgres: cctvComparisonRecord("postgresql", "VALUE", value),
      sheets: cctvComparisonRecord("google-sheets", "VALUE", value),
    }));
    assert.deepEqual(findings, []);
  }
});
