// netlify/functions/tickets.js
// Tickets CRUD via Neon Postgres (GET, POST, PUT)

const { Pool } = require('pg');

// خذ أي متغير متاح عندك
const CONNECTION_STRING =
  process.env.NETLIFY_DATABASE_URL || process.env.NEON_DATABASE_URL;

if (!CONNECTION_STRING) {
  console.error(
    'Missing DB URL env var (NEON_DATABASE_URL or NETLIFY_DATABASE_URL)'
  );
}

// اتصال Neon (SSL آمن)
const pool = new Pool({
  connectionString: CONNECTION_STRING,
  ssl: { rejectUnauthorized: false },
});

// هيدرز + CORS
const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// تأكيد وجود جدول tickets
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id BIGSERIAL PRIMARY KEY,
      section   TEXT   NOT NULL,
      status    TEXT   NOT NULL DEFAULT 'Under Review',
      payload   JSONB  NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    await ensureSchema();

    // ========== GET ==========
    // /.netlify/functions/tickets?section=cctv
    // /.netlify/functions/tickets?history=1&id=3
    if (event.httpMethod === 'GET') {
      const url = new URL(
        event.rawUrl ||
          `https://x${event.path}${
            event.queryStringParameters
              ? '?' +
                new URLSearchParams(
                  event.queryStringParameters
                ).toString()
              : ''
          }`
      );

      const section = url.searchParams.get('section') || 'cctv';
      const historyFlag = url.searchParams.get('history');
      const idParam = url.searchParams.get('id');

      // تاريخ تعديل تكت معيّن
      if (historyFlag === '1' && idParam) {
        const { rows } = await pool.query(
          `SELECT id, ticket_id, section, changed_by, prev_status, new_status, prev_action, new_action, changed_at
             FROM ticket_history
            WHERE ticket_id = $1
            ORDER BY changed_at DESC`,
          [Number(idParam)]
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ ok: true, history: rows }),
        };
      }

      // القراءة العادية حسب السكشن
      const { rows } = await pool.query(
        `SELECT id, section, status, payload, created_at, updated_at
           FROM tickets
          WHERE section = $1
          ORDER BY id ASC`,
        [section]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, count: rows.length, tickets: rows }),
      };
    }

    // ========== POST ==========
    // body: { section, status?, payload? }
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const section = body.section || 'cctv';
      const status = body.status || 'Under Review';
      const payload = body.payload || {};

      const { rows } = await pool.query(
        `INSERT INTO tickets (section, status, payload)
         VALUES ($1, $2, $3::jsonb)
         RETURNING id, section, status, payload, created_at, updated_at`,
        [section, status, JSON.stringify(payload)]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, ticket: rows[0] }),
      };
    }

    // ========== PUT ==========
    // body: { id, status?, actionTaken? }
    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body || '{}');

      const id = Number(body.id);
      const status = body.status ?? null;
      const actionTaken = body.actionTaken ?? null;

      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ ok: false, error: 'id is required' }),
        };
      }

      const { rows } = await pool.query(
        `UPDATE tickets
           SET
             status = COALESCE($2, status),
             payload = CASE
                         WHEN $3 IS NULL THEN payload
                         ELSE jsonb_set(
                                COALESCE(payload, '{}'::jsonb),
                                '{actionTaken}',
                                to_jsonb(($3)::text),
                                true
                              )
                       END,
             updated_at = now()
         WHERE id = $1
         RETURNING id, section, status, payload, created_at, updated_at`,
        [id, status, actionTaken]
      );

      if (rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ ok: false, error: 'Ticket not found' }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, ticket: rows[0] }),
      };
    }

    // غير ذلك
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }),
    };
  } catch (err) {
    console.error('tickets function error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
