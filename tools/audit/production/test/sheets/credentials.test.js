"use strict";

const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const test = require("node:test");
const { SheetsCredentialError } = require("../../src/errors");
const { MAX_CREDENTIAL_BYTES, parseCredentials } = require("../../src/sheets/credentials");
const { PRIVATE_KEY, credentialDocument } = require("./helpers");

test("service-account credentials are validated offline and frozen", () => {
  const credentials = parseCredentials(JSON.stringify(credentialDocument()));
  assert.equal(credentials.type, "service_account");
  assert.equal(credentials.privateKey, PRIVATE_KEY);
  assert.equal(Object.isFrozen(credentials), true);
  assert.equal(Object.hasOwn(credentials, "credentialsJson"), false);
});

test("literal PEM newline sequences are normalized only inside the key", () => {
  const document = credentialDocument({ private_key: PRIVATE_KEY.replace(/\n/g, "\\n") });
  const credentials = parseCredentials(JSON.stringify(document));
  assert.equal(credentials.privateKey, PRIVATE_KEY);
  assert.equal(credentials.projectId, document.project_id);
});

test("malformed, excessive, non-service-account, and incomplete credentials fail closed", () => {
  const cases = [
    undefined,
    "{not-json",
    JSON.stringify([]),
    JSON.stringify({ type: "authorized_user" }),
    "x".repeat(MAX_CREDENTIAL_BYTES + 1),
    JSON.stringify(credentialDocument({ client_email: "not-an-email" })),
    JSON.stringify(credentialDocument({ token_uri: "https://example.invalid/token" })),
    JSON.stringify(credentialDocument({ private_key: "-----BEGIN PRIVATE KEY-----\nbad\n-----END PRIVATE KEY-----\n" })),
  ];
  for (const raw of cases) assert.throws(() => parseCredentials(raw), SheetsCredentialError);
  for (const field of ["project_id", "private_key_id", "private_key", "client_email", "token_uri"]) {
    const document = credentialDocument();
    delete document[field];
    assert.throws(() => parseCredentials(JSON.stringify(document)), SheetsCredentialError, field);
  }
});

test("service-account email validation requires a proper Google domain boundary", () => {
  for (const clientEmail of [
    "reader@project-id.iam.gserviceaccount.com",
    "project-number-compute@developer.gserviceaccount.com",
    "project-id@appspot.gserviceaccount.com",
  ]) {
    assert.equal(parseCredentials(JSON.stringify(credentialDocument({ client_email: clientEmail }))).clientEmail, clientEmail);
  }
  for (const clientEmail of [
    "reader@notgserviceaccount.com",
    "reader@gserviceaccount.com",
    "Reader@project-id.iam.gserviceaccount.com",
    ".reader@project-id.iam.gserviceaccount.com",
    "reader.@project-id.iam.gserviceaccount.com",
    "read..er@project-id.iam.gserviceaccount.com",
  ]) {
    assert.throws(() => parseCredentials(JSON.stringify(credentialDocument({ client_email: clientEmail }))), SheetsCredentialError);
  }
});

test("only RSA private keys are accepted", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const ecPrivateKey = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.throws(
    () => parseCredentials(JSON.stringify(credentialDocument({ private_key: ecPrivateKey }))),
    SheetsCredentialError
  );
  assert.equal(parseCredentials(JSON.stringify(credentialDocument())).type, "service_account");
});
