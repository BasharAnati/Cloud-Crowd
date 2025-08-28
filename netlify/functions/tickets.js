// netlify/functions/tickets.js
// Tickets API (GET/POST/PUT + optional history)
// Works with Neon/Postgres via pg Pool

const { Pool } = require("pg");

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
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret", 
};
const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };

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
    await ensureTicketsTable();
    // history infra is optional but harmless; run once
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
        const { rows } = await pool.query(
          `SELECT id, ticket_id, section, changed_by, prev_status, new_status,
                  prev_action, new_action, changed_at
             FROM ticket_history
            WHERE ticket_id = $1::bigint
            ORDER BY changed_at DESC`,
          [Number(idParam)]
        );
        return {
          statusCode: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify({ ok: true, history: rows }),
        };
      }

      const section = url.searchParams.get("section") || "cctv";
      const { rows } = await pool.query(
        `SELECT id, section, status, payload, created_at, updated_at
           FROM tickets
          WHERE section = $1
          ORDER BY id ASC`,
        [section]
      );

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ ok: true, count: rows.length, tickets: rows }),
      };
    }

    // ===== POST  { section, status, payload, changedBy? } =====
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const section = String(body.section || "cctv");
      const status = String(body.status || "Under Review");
      const payload = body.payload || {};
      const changedBy = body.changedBy ? String(body.changedBy) : null;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (changedBy) {
          await client.query("SELECT set_config($1,$2,true)", [
            "cc.user",
            changedBy,
          ]);
        }
        const { rows } = await client.query(
          `INSERT INTO tickets (section, status, payload)
           VALUES ($1::text, $2::text, $3::jsonb)
           RETURNING id, section, status, payload, created_at, updated_at`,
          [section, status, JSON.stringify(payload)]
        );
        await client.query("COMMIT");
        return {
          statusCode: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify({ ok: true, ticket: rows[0] }),
        };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    // ===== PUT  { id, status?, actionTaken?, changedBy? } =====
    if (event.httpMethod === "PUT") {
      const body = JSON.parse(event.body || "{}");

      const id = Number(body.id);
      const status =
        body.status === undefined || body.status === null
          ? null
          : String(body.status);
      const actionTaken =
        body.actionTaken === undefined || body.actionTaken === null
          ? null
          : String(body.actionTaken);
      const changedBy = body.changedBy ? String(body.changedBy) : null;

      if (!id) {
        return {
          statusCode: 400,
          headers: JSON_HEADERS,
          body: JSON.stringify({ ok: false, error: "id is required" }),
        };
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (changedBy) {
          await client.query("SELECT set_config($1,$2,true)", [
            "cc.user",
            changedBy,
          ]);
        }
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
          return {
            statusCode: 404,
            headers: JSON_HEADERS,
            body: JSON.stringify({ ok: false, error: "Ticket not found" }),
          };
        }

        return {
          statusCode: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify({ ok: true, ticket: rows[0] }),
        };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }


// ===== DELETE  { id, by? } =====
if (event.httpMethod === "DELETE") {
  // (اختياري) تحصين بمفتاح سري من السيرفر فقط:
  const ADMIN_SECRET = process.env.ADMIN_SECRET; // اتركه فارغًا إذا لا تريد استخدامه
  const hdr = event.headers || {};
  const reqSecret = hdr["x-admin-secret"] || hdr["X-Admin-Secret"];
  if (ADMIN_SECRET && reqSecret !== ADMIN_SECRET) {
    return {
      statusCode: 401,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: "Bad admin secret" }),
    };
  }

  const body = JSON.parse(event.body || "{}");
  const id = Number(body.id);
  const byRaw = body.by ? String(body.by) : "";
  if (!id) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: "id is required" }),
    };
  }

  // اسم المصرّح بالحذف فقط (غير حساس لحالة الأحرف)
  const ALLOWED_DELETER = (process.env.ADMIN_DELETER || "Anati").toLowerCase();
  if (byRaw.toLowerCase() !== ALLOWED_DELETER) {
    return {
      statusCode: 403,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: "Not authorized to delete" }),
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // سجل اسم المنفّذ في جلسة الـDB (يظهر في ticket_history)
    await client.query("SELECT set_config($1,$2,true)", ["cc.user", byRaw]);

    // احضر السجل قبل الحذف (لأرشفة حدث الحذف)
    const { rows: curRows } = await client.query(
      `SELECT id, section, status, payload FROM tickets WHERE id=$1::bigint`,
      [id]
    );
    if (curRows.length === 0) {
      await client.query("ROLLBACK");
      return {
        statusCode: 404,
        headers: JSON_HEADERS,
        body: JSON.stringify({ ok: false, error: "Ticket not found" }),
      };
    }
    const cur = curRows[0];
    const prevAction = (cur.payload && cur.payload.actionTaken) || null;

    // سجّل عملية الحذف في التاريخ
    await client.query(
      `INSERT INTO ticket_history
         (ticket_id, section, changed_by, prev_status, new_status, prev_action, new_action, changed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
      [id, cur.section, byRaw, cur.status, "DELETED", prevAction, null]
    );

    // احذف السجل
    await client.query(`DELETE FROM tickets WHERE id=$1::bigint`, [id]);

    await client.query("COMMIT");
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("DELETE error:", err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ ok: false, error: err.message }) };
  } finally {
    client.release();
  }
}


    // method not allowed
    return {
      statusCode: 405,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: "Method Not Allowed" }),
    };
  } catch (err) {
    console.error("tickets function error:", err);
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
