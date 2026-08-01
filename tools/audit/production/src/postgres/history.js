"use strict";

const { DatabaseInputError, DatabaseQueryError, MalformedDatabaseResultError } = require("../errors");
const { deepFreeze, immutableJson, isBigIntString, isPlainObject, isTimestampString, requireBigIntString, requireRows, requireString, requireTimestamp } = require("./row-validation");

const DEFAULT_MAX_PAGE_SIZE = 100;
const HISTORY_COLUMNS = "id::text AS id, ticket_id::text AS ticket_id, section, changed_by, prev_status, new_status, prev_action, new_action, changed_at::text AS changed_at";
const HISTORY_SQL = Object.freeze({
  all: `SELECT ${HISTORY_COLUMNS} FROM public.ticket_history ORDER BY changed_at ASC, id ASC LIMIT $1::integer`,
  cursor: `SELECT ${HISTORY_COLUMNS} FROM public.ticket_history WHERE (changed_at, id) > ($1::timestamptz, $2::bigint) ORDER BY changed_at ASC, id ASC LIMIT $3::integer`,
  ticket: `SELECT ${HISTORY_COLUMNS} FROM public.ticket_history WHERE ticket_id = $1::bigint ORDER BY changed_at ASC, id ASC LIMIT $2::integer`,
  ticketCursor: `SELECT ${HISTORY_COLUMNS} FROM public.ticket_history WHERE ticket_id = $1::bigint AND (changed_at, id) > ($2::timestamptz, $3::bigint) ORDER BY changed_at ASC, id ASC LIMIT $4::integer`,
});
function positive(value, label) { if (!Number.isSafeInteger(value) || value <= 0) throw new DatabaseInputError(`${label} is invalid`); return value; }
function validateHistoryPageOptions(options, maximum) {
  try {
    if (!isPlainObject(options)) throw new DatabaseInputError("History page options are invalid");
    const allowed = new Set(["limit", "ticketId", "cursor"]);
    if (Reflect.ownKeys(options).some((key) => typeof key !== "string" || !allowed.has(key))) throw new DatabaseInputError("History page options are invalid");
    const limit = positive(options.limit, "limit");
    if (limit > maximum) throw new DatabaseInputError("History page limit exceeds the configured maximum");
    const ticketId = options.ticketId;
    if (ticketId !== undefined && !isBigIntString(ticketId)) throw new DatabaseInputError("Ticket ID filter is invalid");
    let cursor;
    if (options.cursor !== undefined) {
      if (!isPlainObject(options.cursor) || Reflect.ownKeys(options.cursor).length !== 2 || !Object.hasOwn(options.cursor, "changedAt") || !Object.hasOwn(options.cursor, "id") ||
          !isTimestampString(options.cursor.changedAt) || !isBigIntString(options.cursor.id)) throw new DatabaseInputError("History cursor is invalid");
      cursor = { changedAt: options.cursor.changedAt, id: options.cursor.id };
    }
    return { limit, ticketId, cursor };
  } catch (error) {
    if (error instanceof DatabaseInputError) throw error;
    throw new DatabaseInputError("History page options are invalid");
  }
}
function historyRow(row) {
  const keys = ["id", "ticket_id", "section", "changed_by", "prev_status", "new_status", "prev_action", "new_action", "changed_at"];
  if (!isPlainObject(row) || Reflect.ownKeys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) throw new MalformedDatabaseResultError("History row is malformed");
  return {
    id: requireBigIntString(row.id), ticket_id: requireBigIntString(row.ticket_id), section: requireString(row.section),
    changed_by: requireString(row.changed_by, true), prev_status: requireString(row.prev_status, true),
    new_status: requireString(row.new_status, true), prev_action: requireString(row.prev_action, true),
    new_action: requireString(row.new_action, true), changed_at: requireTimestamp(row.changed_at),
  };
}
async function listHistoryPage(client, options, maximumPageSize = DEFAULT_MAX_PAGE_SIZE) {
  const maximum = positive(maximumPageSize, "maximumPageSize");
  const { limit, ticketId, cursor } = validateHistoryPageOptions(options, maximum);
  let text; let values;
  if (ticketId !== undefined && cursor) { text = HISTORY_SQL.ticketCursor; values = [ticketId, cursor.changedAt, cursor.id, limit]; }
  else if (ticketId !== undefined) { text = HISTORY_SQL.ticket; values = [ticketId, limit]; }
  else if (cursor) { text = HISTORY_SQL.cursor; values = [cursor.changedAt, cursor.id, limit]; }
  else { text = HISTORY_SQL.all; values = [limit]; }
  let result;
  try { result = await client.query({ text, values }); } catch (_) { throw new DatabaseQueryError("History query failed"); }
  const rows = requireRows(result).map(historyRow);
  if (rows.length > limit) throw new MalformedDatabaseResultError("History query exceeded its bound");
  const last = rows.at(-1);
  return deepFreeze(immutableJson({ rows, nextCursor: last ? { changedAt: last.changed_at, id: last.id } : null }));
}

module.exports = { DEFAULT_MAX_PAGE_SIZE, HISTORY_SQL, listHistoryPage, validateHistoryPageOptions };
