"use strict";

const { createPrivateKey } = require("node:crypto");
const { SheetsCredentialError } = require("../errors");

const MAX_CREDENTIAL_BYTES = 64 * 1024;
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const EMAIL_PATTERN = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+gserviceaccount\.com$/;
const REQUIRED_FIELDS = Object.freeze(["project_id", "private_key_id", "private_key", "client_email", "token_uri"]);

function fail() {
  throw new SheetsCredentialError("Sheets credentials are invalid");
}

function parseCredentials(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_CREDENTIAL_BYTES) fail();
  let document;
  try { document = JSON.parse(raw); } catch (_) { fail(); }
  if (!document || typeof document !== "object" || Array.isArray(document) || Object.getPrototypeOf(document) !== Object.prototype) fail();
  if (document.type !== "service_account" || REQUIRED_FIELDS.some((field) => typeof document[field] !== "string" || document[field].trim() === "")) fail();
  const projectId = document.project_id.trim();
  const privateKeyId = document.private_key_id.trim();
  const clientEmail = document.client_email.trim();
  const tokenUri = document.token_uri.trim();
  let privateKey = document.private_key.replace(/\r\n?/g, "\n");
  if (!privateKey.includes("\n") && privateKey.includes("\\n")) privateKey = privateKey.replace(/\\n/g, "\n");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(projectId) ||
      !/^[A-Fa-f0-9]{8,256}$/.test(privateKeyId) || clientEmail.length > 254 || clientEmail.includes("..") ||
      !EMAIL_PATTERN.test(clientEmail) || tokenUri !== TOKEN_URI ||
      !/^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----\n?$/.test(privateKey)) fail();
  let keyObject;
  try { keyObject = createPrivateKey({ key: privateKey, format: "pem" }); } catch (_) { fail(); }
  if (!keyObject || keyObject.type !== "private" || keyObject.asymmetricKeyType !== "rsa") fail();
  return Object.freeze({ projectId, privateKeyId, privateKey, clientEmail, tokenUri, type: "service_account" });
}

module.exports = { MAX_CREDENTIAL_BYTES, TOKEN_URI, parseCredentials };
