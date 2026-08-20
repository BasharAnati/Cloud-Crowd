const crypto = require("crypto");
const { Pool } = require("pg");
const { requireValidSession, requireModuleAccess } = require("./_auth");

const CONNECTION_STRING =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL;

const pool = new Pool({ connectionString: CONNECTION_STRING });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };

const INTERNAL_STAGES = new Set(["pending_details", "ready_to_share", "done"]);
const SHARE_STAGES = new Set(["received", "needs_response", "done"]);
const DELETE_ROLES = new Set(["admin", "manager"]);

function json(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function requiredText(value, field, maxLength) {
  const result = cleanText(value, maxLength);
  if (!result) {
    const error = new Error(`${field} is required`);
    error.statusCode = 400;
    throw error;
  }
  return result;
}

function parseDiscountAmount(value) {
  if (value === "" || value === null || value === undefined) {
    const error = new Error("discountAmount is required");
    error.statusCode = 400;
    throw error;
  }

  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    const error = new Error("discountAmount must be numeric");
    error.statusCode = 400;
    throw error;
  }
  if (amount < 0) {
    const error = new Error("discountAmount cannot be negative");
    error.statusCode = 400;
    throw error;
  }

  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function normalizeCreateBody(body) {
  return {
    orderNumber: requiredText(body?.orderNumber, "orderNumber", 120),
    customerName: requiredText(body?.customerName, "customerName", 200),
    phoneNumber: cleanText(body?.phoneNumber, 80),
    creationTime: requiredText(body?.creationTime, "creationTime", 120),
    discountAmount: parseDiscountAmount(body?.discountAmount),
    reasonForDiscount: requiredText(
      body?.reasonForDiscount,
      "reasonForDiscount",
      5000
    ),
  };
}

function normalizeDetailsBody(body) {
  return {
    decisionMaker: requiredText(body?.decisionMaker, "decisionMaker", 200),
    attached: cleanText(body?.attached, 5000),
    deductionFrom: requiredText(body?.deductionFrom, "deductionFrom", 200),
    caseDescription: requiredText(
      body?.caseDescription,
      "caseDescription",
      5000
    ),
    notes: cleanText(body?.notes, 5000),
  };
}

function normalizeShareNoteBody(body) {
  return {
    shareNote: requiredText(body?.shareNote, "shareNote", 5000),
  };
}

function getRequestId(event) {
  return cleanText(event.queryStringParameters?.id, 100);
}

async function requireDeleteSession(event) {
  const session = await requireValidSession(event);
  if (!DELETE_ROLES.has(String(session.role || "").toLowerCase())) {
    const error = new Error("Admin or manager role required");
    error.statusCode = 403;
    throw error;
  }
  return session;
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS free_order_requests (
      request_id UUID PRIMARY KEY,
      created_by TEXT,
      order_number TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      phone_number TEXT,
      creation_time TEXT NOT NULL,
      discount_amount NUMERIC(12,2),
      reason_for_discount TEXT NOT NULL,

      decision_maker TEXT,
      attached TEXT,
      deduction_from TEXT,
      case_description TEXT,
      notes TEXT,

      internal_stage TEXT NOT NULL DEFAULT 'pending_details'
        CHECK (internal_stage IN ('pending_details', 'ready_to_share', 'done')),
      share_stage TEXT
        CHECK (share_stage IN ('received', 'needs_response', 'done')),

      share_note TEXT,
      share_note_by TEXT,
      share_note_at TIMESTAMPTZ,

      completed_by TEXT,
      completed_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by TEXT,
      deleted_at TIMESTAMPTZ,
      deleted_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_free_order_requests_internal_stage
      ON free_order_requests(internal_stage)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_free_order_requests_share_stage
      ON free_order_requests(share_stage)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_free_order_requests_order_number
      ON free_order_requests(order_number)
      WHERE deleted_at IS NULL;
  `);
}

function mapRequest(row) {
  return {
    requestId: row.request_id,
    createdBy: row.created_by || "",
    orderNumber: row.order_number,
    customerName: row.customer_name,
    phoneNumber: row.phone_number || "",
    creationTime: row.creation_time,
    discountAmount:
      row.discount_amount === null || row.discount_amount === undefined
        ? null
        : Number(row.discount_amount),
    reasonForDiscount: row.reason_for_discount,
    decisionMaker: row.decision_maker || "",
    attached: row.attached || "",
    deductionFrom: row.deduction_from || "",
    caseDescription: row.case_description || "",
    notes: row.notes || "",
    internalStage: row.internal_stage,
    shareStage: row.share_stage || "",
    shareNote: row.share_note || "",
    shareNoteBy: row.share_note_by || "",
    shareNoteAt: row.share_note_at,
    completedBy: row.completed_by || "",
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || "",
  };
}

async function getRequest(requestId) {
  const result = await pool.query(
    `SELECT *
       FROM free_order_requests
      WHERE request_id = $1::uuid
        AND deleted_at IS NULL`,
    [requestId]
  );
  return result.rows.length ? mapRequest(result.rows[0]) : null;
}

async function listRequests(query = {}) {
  const conditions = ["deleted_at IS NULL"];
  const params = [];

  function addCondition(sql, value) {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  }

  const stage = cleanText(query.stage, 40);
  const view = cleanText(query.view, 40);
  const needsResponse = cleanText(query.needsResponse, 10);
  const search = cleanText(query.search, 200);

  if (view && view !== "share") {
    const error = new Error("Invalid view");
    error.statusCode = 400;
    throw error;
  }

  if (view === "share") {
    conditions.push(
      `(internal_stage IN ('ready_to_share', 'done')
        OR share_stage IN ('received', 'needs_response', 'done'))`
    );
  }

  if (stage) {
    const allowedStages = view === "share" ? SHARE_STAGES : INTERNAL_STAGES;
    if (!allowedStages.has(stage)) {
      const error = new Error("Invalid stage");
      error.statusCode = 400;
      throw error;
    }
    addCondition(view === "share" ? "share_stage = ?" : "internal_stage = ?", stage);
  }

  if (needsResponse === "1") {
    addCondition("share_stage = ?", "needs_response");
  }

  if (search) {
    const firstParam = params.length + 1;
    params.push(search, search, search);
    conditions.push(
      `(order_number ILIKE '%' || $${firstParam} || '%'
        OR customer_name ILIKE '%' || $${firstParam + 1} || '%'
        OR phone_number ILIKE '%' || $${firstParam + 2} || '%')`
    );
  }

  const result = await pool.query(
    `SELECT *
       FROM free_order_requests
      WHERE ${conditions.join(" AND ")}
      ORDER BY updated_at DESC, created_at DESC`,
    params
  );
  return result.rows.map(mapRequest);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  let session;
  try {
    const action = cleanText(event.queryStringParameters?.action, 80);
    const view = cleanText(event.queryStringParameters?.view, 40);
    const isShareFlow =
      view === "share" ||
      action === "needs-response" ||
      action === "share-done";
    const moduleKey = isShareFlow ? "free_order_share" : "free_order_requests";
    const moduleAction =
      event.httpMethod === "GET"
        ? "view"
        : event.httpMethod === "POST"
          ? "create"
          : event.httpMethod === "PUT"
            ? "edit"
            : event.httpMethod === "DELETE"
              ? "delete"
              : "view";
    session =
      event.httpMethod === "DELETE"
        ? await requireDeleteSession(event)
        : await requireValidSession(event);
    await requireModuleAccess(event, moduleKey, moduleAction);
  } catch (authError) {
    return json(authError.statusCode || 500, {
      ok: false,
      error: authError.message,
    });
  }

  if (!CONNECTION_STRING) {
    return json(500, { ok: false, error: "Database is not configured" });
  }

  try {
    await ensureTable();

    if (event.httpMethod === "GET") {
      const requests = await listRequests(event.queryStringParameters || {});
      return json(200, { ok: true, count: requests.length, requests });
    }

    if (event.httpMethod === "POST") {
      const request = normalizeCreateBody(JSON.parse(event.body || "{}"));
      const requestId = crypto.randomUUID();
      const username = cleanText(session.username || "unknown", 200);

      await pool.query(
        `INSERT INTO free_order_requests (
           request_id,
           created_by,
           order_number,
           customer_name,
           phone_number,
           creation_time,
           discount_amount,
           reason_for_discount,
           internal_stage,
           updated_by
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, 'pending_details', $2
         )`,
        [
          requestId,
          username,
          request.orderNumber,
          request.customerName,
          request.phoneNumber || null,
          request.creationTime,
          request.discountAmount,
          request.reasonForDiscount,
        ]
      );

      return json(201, {
        ok: true,
        request: await getRequest(requestId),
      });
    }

    if (event.httpMethod === "PUT") {
      const requestId = getRequestId(event);
      const action = cleanText(event.queryStringParameters?.action, 80);
      if (!requestId) {
        return json(400, { ok: false, error: "Request id is required" });
      }
      if (
        action !== "complete-details" &&
        action !== "needs-response" &&
        action !== "share-done"
      ) {
        return json(400, { ok: false, error: "Unsupported action" });
      }

      const username = cleanText(session.username || "unknown", 200);

      if (action === "complete-details") {
        const details = normalizeDetailsBody(JSON.parse(event.body || "{}"));
        const result = await pool.query(
          `UPDATE free_order_requests
              SET decision_maker = $2,
                  attached = $3,
                  deduction_from = $4,
                  case_description = $5,
                  notes = $6,
                  internal_stage = 'ready_to_share',
                  share_stage = 'received',
                  updated_at = now(),
                  updated_by = $7
            WHERE request_id = $1::uuid
              AND deleted_at IS NULL
            RETURNING request_id`,
          [
            requestId,
            details.decisionMaker,
            details.attached || null,
            details.deductionFrom,
            details.caseDescription,
            details.notes || null,
            username,
          ]
        );

        return result.rows.length
          ? json(200, { ok: true, request: await getRequest(requestId) })
          : json(404, { ok: false, error: "Request not found" });
      }

      if (action === "needs-response") {
        const note = normalizeShareNoteBody(JSON.parse(event.body || "{}"));
        const result = await pool.query(
          `UPDATE free_order_requests
              SET share_stage = 'needs_response',
                  share_note = $2,
                  share_note_by = $3,
                  share_note_at = now(),
                  updated_at = now(),
                  updated_by = $3
            WHERE request_id = $1::uuid
              AND deleted_at IS NULL
            RETURNING request_id`,
          [requestId, note.shareNote, username]
        );

        return result.rows.length
          ? json(200, { ok: true, request: await getRequest(requestId) })
          : json(404, { ok: false, error: "Request not found" });
      }

      const result = await pool.query(
        `UPDATE free_order_requests
            SET share_stage = 'done',
                internal_stage = 'done',
                completed_by = $2,
                completed_at = now(),
                updated_at = now(),
                updated_by = $2
          WHERE request_id = $1::uuid
            AND deleted_at IS NULL
          RETURNING request_id`,
        [requestId, username]
      );

      return result.rows.length
        ? json(200, { ok: true, request: await getRequest(requestId) })
        : json(404, { ok: false, error: "Request not found" });
    }

    if (event.httpMethod === "DELETE") {
      const requestId = getRequestId(event);
      if (!requestId) {
        return json(400, { ok: false, error: "Request id is required" });
      }

      const username = cleanText(session.username || "unknown", 200);
      const result = await pool.query(
        `UPDATE free_order_requests
            SET deleted_at = now(),
                deleted_by = $2,
                updated_at = now(),
                updated_by = $2
          WHERE request_id = $1::uuid
            AND deleted_at IS NULL
          RETURNING request_id`,
        [requestId, username]
      );

      return result.rows.length
        ? json(200, { ok: true })
        : json(404, { ok: false, error: "Request not found" });
    }

    return json(405, { ok: false, error: "Method Not Allowed" });
  } catch (error) {
    console.error("free-order-requests function error:", error);
    if (error.code === "22P02") {
      return json(400, { ok: false, error: "Invalid request id" });
    }
    return json(error.statusCode || 500, {
      ok: false,
      error:
        error.statusCode && error.statusCode < 500
          ? error.message
          : "Internal Server Error",
    });
  }
};
