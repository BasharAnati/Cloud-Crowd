"use strict";

const { assembleCanonicalParityBundle, normalizePostgresSnapshot, normalizeSheetsSnapshot } = require("../normalize");
const { compareCanonicalParityBundle } = require("../parity");
const { createPostgresAdapter } = require("../postgres");
const { verifyTrustedPostgresSnapshot } = require("../postgres/adapter");
const { isBigIntString } = require("../postgres/row-validation");
const { buildAuditReport } = require("../report");
const { createSheetsAdapter } = require("../sheets");
const { OrchestrationPaginationError } = require("../errors");

const POSTGRES_PAGE_SIZE = 100;
const POSTGRES_PAGE_LIMIT = 10_000;
const EXPECTED_DATABASE = "cloud_crowd";

function createSourceAdapters(safety) {
  return Object.freeze(Object.assign(Object.create(null), {
    postgres: createPostgresAdapter({
      safety,
      expectedDatabase: EXPECTED_DATABASE,
      maximumPageSize: POSTGRES_PAGE_SIZE,
    }),
    sheets: createSheetsAdapter({ safety }),
  }));
}

async function readPostgresPages(postgres) {
  const pages = [];
  const continuationCursors = new Set();
  let expectedRequestedCursor = null;
  let previous = await postgres.listTicketsPage({ limit: POSTGRES_PAGE_SIZE });
  while (true) {
    const pagination = validatedPagination(previous, expectedRequestedCursor);
    pages.push(previous);
    if (pagination.exhausted) return Object.freeze(pages);
    if (pages.length >= POSTGRES_PAGE_LIMIT || continuationCursors.has(pagination.nextCursor)) paginationFailure();
    continuationCursors.add(pagination.nextCursor);
    expectedRequestedCursor = pagination.nextCursor;
    previous = await postgres.listTicketsPage(
      { limit: POSTGRES_PAGE_SIZE, lastSeenId: pagination.nextCursor },
      previous
    );
  }
}

function paginationFailure() {
  throw new OrchestrationPaginationError("PostgreSQL pagination is invalid");
}

function dataValue(object, key) {
  const descriptor = object && typeof object === "object"
    ? Object.getOwnPropertyDescriptor(object, key)
    : null;
  if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) paginationFailure();
  return descriptor.value;
}

function cursorAdvances(requestedCursor, nextCursor) {
  if (requestedCursor === null) return true;
  if (nextCursor.length !== requestedCursor.length) return nextCursor.length > requestedCursor.length;
  return nextCursor > requestedCursor;
}

function validatedPagination(snapshot, expectedRequestedCursor) {
  try { verifyTrustedPostgresSnapshot(snapshot); } catch (_) { paginationFailure(); }
  const pagination = dataValue(snapshot, "pagination");
  const kind = dataValue(pagination, "kind");
  const requestedCursor = dataValue(pagination, "requestedCursor");
  const limit = dataValue(pagination, "limit");
  const returnedCount = dataValue(pagination, "returnedCount");
  const nextCursor = dataValue(pagination, "nextCursor");
  const exhausted = dataValue(pagination, "exhausted");
  const rows = dataValue(snapshot, "rows");
  const snapshotNextCursor = dataValue(snapshot, "nextCursor");
  if (kind !== "tickets" || requestedCursor !== expectedRequestedCursor || limit !== POSTGRES_PAGE_SIZE ||
      !Number.isSafeInteger(returnedCount) || returnedCount < 0 || returnedCount > POSTGRES_PAGE_SIZE ||
      !Array.isArray(rows) || rows.length !== returnedCount || typeof exhausted !== "boolean" ||
      exhausted !== (returnedCount < POSTGRES_PAGE_SIZE) || snapshotNextCursor !== nextCursor ||
      (returnedCount === 0 && nextCursor !== null) ||
      (returnedCount > 0 && (!isBigIntString(nextCursor) || !cursorAdvances(requestedCursor, nextCursor)))) {
    paginationFailure();
  }
  return Object.freeze({ requestedCursor, nextCursor, exhausted });
}

async function readAllSheets(sheets) {
  return sheets.readAllConfiguredSheets();
}

function normalizePostgresPages(pages) {
  return Object.freeze(pages.map((page) => normalizePostgresSnapshot(page)));
}

function normalizeAllSheets(snapshot) {
  return normalizeSheetsSnapshot(snapshot);
}

module.exports = Object.freeze({
  assembleCanonicalParityBundle,
  buildAuditReport,
  compareCanonicalParityBundle,
  createSourceAdapters,
  normalizeAllSheets,
  normalizePostgresPages,
  readAllSheets,
  readPostgresPages,
});
