// netlify/functions/tickets.js
// Tickets CRUD via Neon Postgres (GET, POST, PUT + history)

const { Pool } = require('pg');

const CONNECTION_STRING =
  process.env.NETLIFY_DATABASE_URL || process.env.NEON_DATABASE_URL;

const pool = new Pool({
  connectionString: CONNECTION_STRING,
  // أغلب روابط Neon فيها sslmode=require تلقائيًا
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS };

// (اختياري) ضمان وجود جدول tickets فقط
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

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  try {
    await ensureTicketsTable();

    // ===== GET =====
    if (event.httpMethod === 'GET') {
      const url = new URL(
        event.rawUrl ||
          `https://x${event.path}${
            event.queryStringParameters
              ? '?' + new URLSearchParams(event.queryStringParameters).toString()
              : ''
          }`
      );

      // /tickets?history=1&id=123  → سجل التعديلات
      const historyFlag = url.searchParams.get('history');
      const idParam     = url.searchParams.get('id');

      if (historyFlag === '1' && idParam) {
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

      // الوضع الطبيعي: حسب السكشن
      const section = url.searchParams.get('section') || 'cctv';
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

    // ===== POST  { section, status, payload } =====
    if (event.httpMethod === 'POST') {
      const body    = JSON.parse(event.body || '{}');
      const section = String(body.section || 'cctv');
      const status  = String(body.status  || 'Under Review');
      const payload = body.payload || {};

      const { rows } = await pool.query(
        `INSERT INTO tickets (section, status, payload)
         VALUES ($1::text, $2::text, $3::jsonb)
         RETURNING id, section, status, payload, created_at, updated_at`,
        [section, status, JSON.stringify(payload)]
      );

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ ok: true, ticket: rows[0] }),
      };
    }

    // ===== PUT  { id, status?, actionTaken? } =====
    if (event.httpMethod === 'PUT') {
      const body   = JSON.parse(event.body || '{}');
      const id     = Number(body.id);
      const status = body.status === undefined || body.status === null
        ? null
        : String(body.status);
      const actionTaken = body.actionTaken === undefined || body.actionTaken === null
        ? null
        : String(body.actionTaken);

      if (!id) {
        return {
          statusCode: 400,
          headers: JSON_HEADERS,
          body: JSON.stringify({ ok: false, error: 'id is required' }),
        };
      }

      const { rows } = await pool.query(
        `
        UPDATE tickets
           SET status = COALESCE($2::text, status),
               payload = CASE
                 WHEN $3 IS NULL THEN payload
                 ELSE jsonb_set(
                        COALESCE(payload, '{}'::jsonb),
                        '{actionTaken}',
                        to_jsonb(($3)::text),  -- نفرضها نص دائمًا
                        true
                      )
               END,
               updated_at = now()
         WHERE id = $1::bigint
         RETURNING id, section, status, payload, created_at, updated_at
        `,
        [id, status, actionTaken]
      );

      if (rows.length === 0) {
        return {
          statusCode: 404,
          headers: JSON_HEADERS,
          body: JSON.stringify({ ok: false, error: 'Ticket not found' }),
        };
      }

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ ok: true, ticket: rows[0] }),
      };
    }

    // Methods أخرى
    return {
      statusCode: 405,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }),
    };
  } catch (err) {
    console.error('tickets function error:', err);
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
