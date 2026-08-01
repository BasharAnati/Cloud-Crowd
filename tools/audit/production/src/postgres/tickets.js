"use strict";

const { DatabaseInputError, DatabaseQueryError, MalformedDatabaseResultError } = require("../errors");
const { deepFreeze, isBigIntString, isPlainObject, requireBigIntString, requireRows, requireString, requireTimestamp } = require("./row-validation");

const DEFAULT_MAX_PAGE_SIZE = 100;
const BASE_COLUMNS = "id::text AS id, section, status, payload, created_at::text AS created_at, updated_at::text AS updated_at";
const TICKET_SQL = Object.freeze({
  all: `SELECT ${BASE_COLUMNS} FROM public.tickets ORDER BY id ASC LIMIT $1::integer`,
  after: `SELECT ${BASE_COLUMNS} FROM public.tickets WHERE id > $1::bigint ORDER BY id ASC LIMIT $2::integer`,
  section: `SELECT ${BASE_COLUMNS} FROM public.tickets WHERE section = $1::text ORDER BY id ASC LIMIT $2::integer`,
  sectionAfter: `SELECT ${BASE_COLUMNS} FROM public.tickets WHERE section = $1::text AND id > $2::bigint ORDER BY id ASC LIMIT $3::integer`,
});

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new DatabaseInputError(`${label} must be a positive integer`);
  return value;
}
function validateMaximum(maximumPageSize) { return positiveInteger(maximumPageSize, "maximumPageSize"); }
function validateTicketPageOptions(options, maximumPageSize) {
  try {
    if (!isPlainObject(options)) throw new DatabaseInputError("Ticket page options are invalid");
    const allowed = new Set(["limit", "lastSeenId", "section"]);
    if (Reflect.ownKeys(options).some((key) => typeof key !== "string" || !allowed.has(key))) throw new DatabaseInputError("Ticket page options are invalid");
    const limit = positiveInteger(options.limit, "limit");
    if (limit > maximumPageSize) throw new DatabaseInputError("Ticket page limit exceeds the configured maximum");
    const lastSeenId = options.lastSeenId;
    if (lastSeenId !== undefined && !isBigIntString(lastSeenId)) throw new DatabaseInputError("Ticket cursor is invalid");
    const section = options.section;
    if (section !== undefined && (typeof section !== "string" || section.trim() === "" || section.length > 128)) throw new DatabaseInputError("Section filter is invalid");
    return { limit, lastSeenId, section };
  } catch (error) {
    if (error instanceof DatabaseInputError) throw error;
    throw new DatabaseInputError("Ticket page options are invalid");
  }
}
function ticketRow(row) {
  if (!isPlainObject(row)) throw new MalformedDatabaseResultError("Ticket row is malformed");
  const keys = ["id", "section", "status", "payload", "created_at", "updated_at"];
  if (Reflect.ownKeys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) throw new MalformedDatabaseResultError("Ticket row is malformed");
  if (!isPlainObject(row.payload)) throw new MalformedDatabaseResultError("Ticket payload is malformed");
  return {
    id: requireBigIntString(row.id), section: requireString(row.section), status: requireString(row.status),
    payload: row.payload, created_at: requireTimestamp(row.created_at), updated_at: requireTimestamp(row.updated_at),
  };
}
async function listTicketsPage(client, options, maximumPageSize = DEFAULT_MAX_PAGE_SIZE) {
  const maximum = validateMaximum(maximumPageSize);
  const { limit, lastSeenId, section } = validateTicketPageOptions(options, maximum);
  let text; let values;
  if (section !== undefined && lastSeenId !== undefined) { text = TICKET_SQL.sectionAfter; values = [section, lastSeenId, limit]; }
  else if (section !== undefined) { text = TICKET_SQL.section; values = [section, limit]; }
  else if (lastSeenId !== undefined) { text = TICKET_SQL.after; values = [lastSeenId, limit]; }
  else { text = TICKET_SQL.all; values = [limit]; }
  let result;
  try { result = await client.query({ text, values }); } catch (_) { throw new DatabaseQueryError("Ticket query failed"); }
  const rows = requireRows(result).map(ticketRow);
  if (rows.length > limit) throw new MalformedDatabaseResultError("Ticket query exceeded its bound");
  const snapshot = { rows, nextCursor: rows.length === 0 ? null : rows[rows.length - 1].id };
  return deepFreeze(require("./row-validation").immutableJson(snapshot));
}

module.exports = { DEFAULT_MAX_PAGE_SIZE, TICKET_SQL, listTicketsPage, validateTicketPageOptions };
