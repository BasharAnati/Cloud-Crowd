// netlify/functions/tickets.js
// Tickets API (GET/POST/PUT + optional history)
// Works with Neon/Postgres via pg Pool

const { Pool } = require("pg");
const {
  requireValidSession,
  requireAdminSession,
  requireModuleAccess,
} = require("./_auth");
const TICKET_DOMAIN_CONFIG = require("../../shared/ticket-domain-config");

// pick connection string (uses pooled URL if set)
const CONNECTION_STRING =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL;

const pool = new Pool({ connectionString: CONNECTION_STRING });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", // ← أضف DELETE
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };
const SECTION_IDS = TICKET_DOMAIN_CONFIG.sectionIds;
const TICKET_STATUS_OPTIONS = TICKET_DOMAIN_CONFIG.statusOptions;
const TICKET_DOMAIN_OPTIONS = TICKET_DOMAIN_CONFIG.options;
const SECTION_MODULES = {
  [SECTION_IDS.CCTV]: "cctv",
  [SECTION_IDS.CUSTOMER_EXPERIENCE]: "customer_experience",
  [SECTION_IDS.COMPLAINTS]: "daily_complaints",
  [SECTION_IDS.COMPLIMENTARY_ORDERS]: "complimentary_orders",
};
const SECTION_STATUSES = {
  [SECTION_IDS.CCTV]: new Set(TICKET_STATUS_OPTIONS.cctv),
  [SECTION_IDS.CUSTOMER_EXPERIENCE]: new Set(TICKET_STATUS_OPTIONS.ce),
  [SECTION_IDS.COMPLAINTS]: new Set(TICKET_STATUS_OPTIONS.complaints),
  [SECTION_IDS.COMPLIMENTARY_ORDERS]: new Set(
    TICKET_STATUS_OPTIONS["free-orders"]
  ),
};
const AUDIT_IDENTITY_FIELDS = new Set([
  "actor",
  "by",
  "changedby",
  "createdby",
  "performedby",
  "role",
  "user",
  "username",
]);
const COMMON_PAYLOAD_FIELDS = new Set([
  "actionTaken",
  "caseNumber",
  "orderNumber",
  "status",
]);
const SERVER_OWNED_PAYLOAD_FIELDS = new Set([
  "_fromSheet",
  "_id",
  "createdAt",
  "created_at",
  "databaseId",
  "database_id",
  "fromSheet",
  "id",
  "lastModified",
  "pdfName",
  "pdfUrl",
  "section",
  "ticketId",
  "ticket_id",
  "updatedAt",
  "updated_at",
]);
const SECTION_PAYLOAD_FIELDS = {
  cctv: new Set([
    "branch",
    "cameras",
    "cctvPdf",
    "date",
    "dateTime",
    "notes",
    "reviewType",
    "sections",
    "staff",
    "time",
    "violations",
  ]),
  ce: new Set([
    "branch",
    "channel",
    "creationDate",
    "customerName",
    "customerNotes",
    "department",
    "feedbackDate",
    "issueCategory",
    "orderType",
    "phone",
    "restaurant",
    "satisfaction",
    "shift",
  ]),
  complaints: new Set([
    "branch",
    "channel",
    "complaintDetails",
    "creationDate",
    "customerName",
    "department",
    "issueCategory",
    "orderType",
    "phone",
    "restaurant",
    "shift",
  ]),
  "free-orders": new Set([
    "attached",
    "caseDescription",
    "channel",
    "customerName",
    "decisionMaker",
    "deductionFrom",
    "discountAmount",
    "discountDate",
    "newOrderNumber",
    "orderDate",
    "orderOnCirca",
    "phone",
    "reasonForDiscount",
  ]),
};
const ARRAY_FIELDS = new Set(["cameras", "sections", "staff", "violations"]);
const ATTACHMENT_FIELDS = new Set(["attached", "cctvPdf", "orderOnCirca"]);
const LONG_TEXT_FIELDS = new Set([
  "actionTaken",
  "caseDescription",
  "complaintDetails",
  "customerNotes",
  "notes",
  "reasonForDiscount",
]);
const PAYLOAD_ENUMS = {
  [SECTION_IDS.CCTV]: {
    branch: new Set(TICKET_DOMAIN_OPTIONS.cctv.branch),
    cameras: new Set(TICKET_DOMAIN_OPTIONS.cctv.cameras),
    reviewType: new Set(TICKET_DOMAIN_OPTIONS.cctv.reviewType),
    sections: new Set(TICKET_DOMAIN_OPTIONS.cctv.sections),
    staff: new Set(TICKET_DOMAIN_OPTIONS.cctv.staff),
    violations: new Set(TICKET_DOMAIN_OPTIONS.cctv.violations),
  },
  [SECTION_IDS.CUSTOMER_EXPERIENCE]: {
    department: new Set(TICKET_DOMAIN_OPTIONS.ce.department),
    shift: new Set(TICKET_DOMAIN_OPTIONS.ce.shift),
    orderType: new Set(TICKET_DOMAIN_OPTIONS.ce.orderType),
    branch: new Set(TICKET_DOMAIN_OPTIONS.ce.branch),
    restaurant: new Set(TICKET_DOMAIN_OPTIONS.ce.restaurant),
    channel: new Set(TICKET_DOMAIN_OPTIONS.ce.channel),
    issueCategory: new Set(TICKET_DOMAIN_OPTIONS.ce.issueCategory),
    satisfaction: new Set(TICKET_DOMAIN_OPTIONS.ce.satisfaction),
  },
  [SECTION_IDS.COMPLAINTS]: {
    department: new Set(TICKET_DOMAIN_OPTIONS.complaints.department),
    shift: new Set(TICKET_DOMAIN_OPTIONS.complaints.shift),
    orderType: new Set(TICKET_DOMAIN_OPTIONS.complaints.orderType),
    branch: new Set(TICKET_DOMAIN_OPTIONS.complaints.branch),
    restaurant: new Set(TICKET_DOMAIN_OPTIONS.complaints.restaurant),
    channel: new Set(TICKET_DOMAIN_OPTIONS.complaints.channel),
    issueCategory: new Set(TICKET_DOMAIN_OPTIONS.complaints.issueCategory),
  },
  [SECTION_IDS.COMPLIMENTARY_ORDERS]: {
    channel: new Set(TICKET_DOMAIN_OPTIONS["free-orders"].channel),
  },
};
const MAX_SHORT_TEXT_LENGTH = 1000;
const MAX_LONG_TEXT_LENGTH = 20000;
const MAX_ATTACHMENT_DATA_LENGTH = 12000000;

function json(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseRequestBody(event) {
  if (typeof event.body !== "string" || !event.body.trim()) {
    throw validationError("Request body must be a JSON object");
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    throw validationError("Request body contains invalid JSON");
  }

  if (!isPlainObject(body)) {
    throw validationError("Request body must be a JSON object");
  }
  return body;
}

function isAuditIdentityField(field) {
  return AUDIT_IDENTITY_FIELDS.has(
    String(field || "")
      .replace(/_/g, "")
      .toLowerCase()
  );
}

function isServerOwnedPayloadField(field) {
  return SERVER_OWNED_PAYLOAD_FIELDS.has(field);
}

function requireAllowedRequestFields(body, allowedFields) {
  for (const field of Object.keys(body)) {
    if (!allowedFields.has(field) && !isAuditIdentityField(field)) {
      throw validationError(`Unexpected request field: ${field}`);
    }
  }
}

function requirePositiveInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw validationError(`${fieldName} must be a positive integer`);
  }
  return value;
}

function requireString(value, fieldName, options = {}) {
  if (typeof value !== "string") {
    throw validationError(`${fieldName} must be a string`);
  }
  if (options.required && !value.trim()) {
    throw validationError(`${fieldName} is required`);
  }
  const maxLength = options.maxLength || MAX_SHORT_TEXT_LENGTH;
  if (value.length > maxLength) {
    throw validationError(`${fieldName} is too long`);
  }
  return value;
}

function requireStringArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw validationError(`${fieldName} must be an array`);
  }
  if (value.length > 200) {
    throw validationError(`${fieldName} contains too many values`);
  }
  value.forEach((item, index) => {
    requireString(item, `${fieldName}[${index}]`, { required: true });
  });
}

function requireAttachment(value, fieldName) {
  if (value === null) return;
  if (!isPlainObject(value)) {
    throw validationError(`${fieldName} must be an attachment object or null`);
  }

  const allowedFields = new Set(["dataUrl", "name", "type"]);
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      throw validationError(`Unexpected ${fieldName} field: ${field}`);
    }
  }

  requireString(value.name, `${fieldName}.name`, { required: true });
  requireString(value.type, `${fieldName}.type`, { required: true });
  requireString(value.dataUrl, `${fieldName}.dataUrl`, {
    required: true,
    maxLength: MAX_ATTACHMENT_DATA_LENGTH,
  });
}

function cleanSection(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getModuleForSection(section) {
  return SECTION_MODULES[section] || "";
}

function requireKnownSection(section) {
  if (typeof section !== "string") {
    throw validationError("section must be a string");
  }
  const clean = cleanSection(section);
  if (!clean || clean !== section || !getModuleForSection(clean)) {
    throw validationError("Invalid section");
  }
  return clean;
}

function requireValidStatus(section, value, options = {}) {
  const status = requireString(value, "status", { required: true });
  if (!SECTION_STATUSES[section]?.has(status)) {
    throw validationError(`Invalid status for section: ${section}`);
  }
  if (options.payloadStatus !== undefined && options.payloadStatus !== status) {
    throw validationError("payload.status must match status");
  }
  return status;
}

function requirePayloadIdentity(section, payload) {
  if (section === "cctv") {
    requireString(payload.caseNumber, "payload.caseNumber", { required: true });
    return;
  }

  const identity = payload.orderNumber || payload.caseNumber;
  requireString(identity, "payload.orderNumber or payload.caseNumber", {
    required: true,
  });
}

function validatePayloadField(section, field, value) {
  if (ARRAY_FIELDS.has(field)) {
    requireStringArray(value, `payload.${field}`);
    const allowedValues = PAYLOAD_ENUMS[section]?.[field];
    if (allowedValues) {
      value.forEach((item) => {
        if (!allowedValues.has(item)) {
          throw validationError(`Invalid payload.${field} value`);
        }
      });
    }
    return;
  }
  if (ATTACHMENT_FIELDS.has(field)) {
    requireAttachment(value, `payload.${field}`);
    return;
  }
  const maxLength = LONG_TEXT_FIELDS.has(field)
    ? MAX_LONG_TEXT_LENGTH
    : MAX_SHORT_TEXT_LENGTH;
  requireString(value, `payload.${field}`, { maxLength });

  const allowedValues = PAYLOAD_ENUMS[section]?.[field];
  if (value && allowedValues && !allowedValues.has(value)) {
    throw validationError(`Invalid payload.${field} value`);
  }
}

function validateAndSanitizePayload(section, payload, actor, status) {
  if (!isPlainObject(payload)) {
    throw validationError("payload must be a JSON object");
  }

  const allowedFields = new Set([
    ...COMMON_PAYLOAD_FIELDS,
    ...(SECTION_PAYLOAD_FIELDS[section] || []),
  ]);
  const trustedPayload = {};

  for (const [field, value] of Object.entries(payload)) {
    if (isAuditIdentityField(field)) continue;
    if (isServerOwnedPayloadField(field)) continue;
    if (!allowedFields.has(field)) {
      throw validationError(`Unexpected payload field: ${field}`);
    }
    validatePayloadField(section, field, value);
    trustedPayload[field] = value;
  }

  requirePayloadIdentity(section, trustedPayload);
  if (trustedPayload.status !== undefined) {
    requireValidStatus(section, trustedPayload.status, { payloadStatus: status });
  }

  trustedPayload.createdBy = actor;
  return trustedPayload;
}

function requireSessionActor(session) {
  if (typeof session?.username !== "string" || !session.username.trim()) {
    const error = new Error("Invalid session identity");
    error.statusCode = 401;
    throw error;
  }
  return session.username.trim();
}

async function requireSectionAccess(event, section, action) {
  return requireModuleAccess(event, getModuleForSection(requireKnownSection(section)), action);
}

async function getTicketSection(ticketId) {
  const ticketResult = await pool.query(
    `SELECT section
       FROM tickets
      WHERE id = $1::bigint
      LIMIT 1`,
    [ticketId]
  );
  if (ticketResult.rows.length) return ticketResult.rows[0].section;

  const historyResult = await pool.query(
    `SELECT section
       FROM ticket_history
      WHERE ticket_id = $1::bigint
      ORDER BY changed_at DESC
      LIMIT 1`,
    [ticketId]
  );
  return historyResult.rows[0]?.section || "";
}

// --- bootstrap: ensure tickets table exists ---
async function ensureTicketsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id BIGSERIAL PRIMARY KEY,
      section    TEXT   NOT NULL,
      status     TEXT   NOT NULL DEFAULT 'Under Review',
      payload    JSONB  NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

// --- (optional) history infra: table + trigger ---
async function ensureHistoryArtifacts() {
  // table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_history (
      id          BIGSERIAL PRIMARY KEY,
      ticket_id   BIGINT      NOT NULL,
      section     TEXT        NOT NULL,
      changed_by  TEXT,
      prev_status TEXT,
      new_status  TEXT,
      prev_action TEXT,
      new_action  TEXT,
      changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket_id
      ON ticket_history(ticket_id);
  `);

  // function
  await pool.query(`
    CREATE OR REPLACE FUNCTION log_ticket_update()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_prev_action TEXT := COALESCE(OLD.payload->>'actionTaken', NULL);
      v_new_action  TEXT := COALESCE(NEW.payload->>'actionTaken', NULL);
      v_user        TEXT := current_setting('cc.user', true);
    BEGIN
      IF (NEW.status IS DISTINCT FROM OLD.status)
         OR (v_new_action IS DISTINCT FROM v_prev_action) THEN

        INSERT INTO ticket_history (
          ticket_id, section, changed_by,
          prev_status, new_status, prev_action, new_action, changed_at
        )
        VALUES (
          OLD.id,
          COALESCE(NEW.section, OLD.section, 'cctv'),
          v_user,
          OLD.status,
          NEW.status,
          v_prev_action,
          v_new_action,
          now()
        );
      END IF;

      RETURN NEW;
    END
    $$;
  `);

  // trigger (drop if exists then create)
  await pool.query(`DROP TRIGGER IF EXISTS trg_tickets_audit ON tickets;`);
  await pool.query(`
    CREATE TRIGGER trg_tickets_audit
    AFTER UPDATE ON tickets
    FOR EACH ROW
    EXECUTE FUNCTION log_ticket_update();
  `);
}

// map db row → UI ticket
function rowToTicket(row) {
  const p = row.payload || {};
  return {
    _id: row.id,
    ...p,
    status: row.status || p.status || "Under Review",
    caseNumber: p.caseNumber || `CCTV-${row.id}`,
    createdAt: row.created_at,
    lastModified: row.updated_at,
  };
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  try {
    if (!["GET", "POST", "PUT", "DELETE"].includes(event.httpMethod)) {
      return json(405, { ok: false, error: "Method Not Allowed" });
    }

    let session = null;
    try {
      if (event.httpMethod === "DELETE") {
        session = requireAdminSession(event);
      } else if (["GET", "POST", "PUT"].includes(event.httpMethod)) {
        session = requireValidSession(event);
      }
    } catch (authErr) {
      if (!authErr.statusCode) throw authErr;
      return json(authErr.statusCode, { ok: false, error: authErr.message });
    }

    await ensureTicketsTable();
    await ensureHistoryArtifacts();

    // ===== GET =====
    if (event.httpMethod === "GET") {
      const url = new URL(
        event.rawUrl ||
          `https://x${event.path}${
            event.queryStringParameters
              ? "?" +
                new URLSearchParams(event.queryStringParameters).toString()
              : ""
          }`
      );

      // /tickets?history=1&id=123
      const historyFlag = url.searchParams.get("history");
      const idParam = url.searchParams.get("id");

      if (historyFlag === "1" && idParam) {
        if (!/^[1-9]\d*$/.test(idParam)) {
          throw validationError("id must be a positive integer");
        }
        const ticketId = requirePositiveInteger(Number(idParam), "id");

        const section = await getTicketSection(ticketId);
        if (!section) return json(404, { ok: false, error: "Ticket not found" });
        await requireSectionAccess(event, section, "view");

        const { rows } = await pool.query(
          `SELECT id, ticket_id, section, changed_by, prev_status, new_status,
                  prev_action, new_action, changed_at
             FROM ticket_history
            WHERE ticket_id = $1::bigint
            ORDER BY changed_at DESC`,
          [ticketId]
        );
        return json(200, { ok: true, history: rows });
      }

      const section = requireKnownSection(url.searchParams.get("section"));
      await requireSectionAccess(event, section, "view");

      const { rows } = await pool.query(
        `SELECT id, section, status, payload, created_at, updated_at
           FROM tickets
          WHERE section = $1
          ORDER BY id ASC`,
        [section]
      );

      return json(200, { ok: true, count: rows.length, tickets: rows });
    }

    // ===== POST  { section, status, payload } =====
    if (event.httpMethod === "POST") {
      const body = parseRequestBody(event);
      requireAllowedRequestFields(
        body,
        new Set(["section", "status", "payload"])
      );
      const section = requireKnownSection(body.section);
      const actor = requireSessionActor(session);
      const status = requireValidStatus(section, body.status);
      const payload = validateAndSanitizePayload(
        section,
        body.payload,
        actor,
        status
      );
      await requireSectionAccess(event, section, "create");

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config($1,$2,true)", ["cc.user", actor]);
        const { rows } = await client.query(
          `INSERT INTO tickets (section, status, payload)
           VALUES ($1::text, $2::text, $3::jsonb)
           RETURNING id, section, status, payload, created_at, updated_at`,
          [section, status, JSON.stringify(payload)]
        );
        await client.query("COMMIT");
        return json(200, { ok: true, ticket: rows[0] });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    // ===== PUT  { id, section?, status?, actionTaken? } =====
    if (event.httpMethod === "PUT") {
      const body = parseRequestBody(event);
      requireAllowedRequestFields(
        body,
        new Set(["id", "section", "status", "actionTaken"])
      );

      const id = requirePositiveInteger(body.id, "id");
      const requestedSection =
        body.section === undefined ? null : requireKnownSection(body.section);
      const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
      const hasAction = Object.prototype.hasOwnProperty.call(body, "actionTaken");
      if (!hasStatus && !hasAction) {
        throw validationError("At least one mutation field is required");
      }
      const actionTaken = hasAction
        ? requireString(body.actionTaken, "actionTaken", {
            maxLength: MAX_LONG_TEXT_LENGTH,
          })
        : null;
      const actor = requireSessionActor(session);

      const ticketSection = await getTicketSection(id);
      if (!ticketSection) return json(404, { ok: false, error: "Ticket not found" });
      if (requestedSection && requestedSection !== ticketSection) {
        throw validationError("section does not match ticket");
      }
      const status = hasStatus
        ? requireValidStatus(ticketSection, body.status)
        : null;
      await requireSectionAccess(event, ticketSection, "edit");

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config($1,$2,true)", ["cc.user", actor]);
        const { rows } = await client.query(
          `
          UPDATE tickets
             SET
               status = COALESCE($2::text, status),
               payload =
                 CASE
                   WHEN $3::text IS NOT NULL THEN
                     jsonb_set(
                       COALESCE(payload, '{}'::jsonb),
                       '{actionTaken}',
                       to_jsonb($3::text),
                       true
                     )
                   ELSE payload
                 END,
               updated_at = now()
           WHERE id = $1::bigint
           RETURNING id, section, status, payload, created_at, updated_at
          `,
          [id, status, actionTaken]
        );
        await client.query("COMMIT");

        if (rows.length === 0) {
          return json(404, { ok: false, error: "Ticket not found" });
        }

        return json(200, { ok: true, ticket: rows[0] });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }


    // ===== DELETE  { id, section? } =====
    if (event.httpMethod === "DELETE") {
      const body = parseRequestBody(event);
      requireAllowedRequestFields(body, new Set(["id", "section"]));
      const id = requirePositiveInteger(body.id, "id");
      const requestedSection =
        body.section === undefined ? null : requireKnownSection(body.section);
      const actor = requireSessionActor(session);

      const ticketSection = await getTicketSection(id);
      if (!ticketSection) return json(404, { ok: false, error: "Ticket not found" });
      if (requestedSection && requestedSection !== ticketSection) {
        throw validationError("section does not match ticket");
      }
      await requireSectionAccess(event, ticketSection, "delete");

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Preserve the authenticated actor for the existing audit trigger.
        await client.query("SELECT set_config($1,$2,true)", ["cc.user", actor]);

        const { rows: curRows } = await client.query(
          `SELECT id, section, status, payload FROM tickets WHERE id=$1::bigint`,
          [id]
        );
        if (curRows.length === 0) {
          await client.query("ROLLBACK");
          return json(404, { ok: false, error: "Ticket not found" });
        }
        const cur = curRows[0];
        const prevAction = (cur.payload && cur.payload.actionTaken) || null;

        await client.query(
          `INSERT INTO ticket_history
             (ticket_id, section, changed_by, prev_status, new_status, prev_action, new_action, changed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
          [id, cur.section, actor, cur.status, "DELETED", prevAction, null]
        );

        await client.query(`DELETE FROM tickets WHERE id=$1::bigint`, [id]);

        await client.query("COMMIT");
        return json(200, { ok: true });
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("DELETE error:", err);
        return json(500, { ok: false, error: "Internal Server Error" });
      } finally {
        client.release();
      }
    }
  } catch (err) {
    if (err.statusCode) return json(err.statusCode, { ok: false, error: err.message });
    console.error("tickets function error:", err);
    return json(500, { ok: false, error: "Internal Server Error" });
  }
};
