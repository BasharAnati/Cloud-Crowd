// netlify/functions/tickets.js
// Tickets CRUD via Neon Postgres (GET, POST, PUT + history + changed_by)

const { Pool } = require('pg');

const CONNECTION_STRING =
  process.env.NETLIFY_DATABASE_URL || process.env.NEON_DATABASE_URL;

const pool = new Pool({
  connectionString: CONNECTION_STRING,
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS };

// تأكد فقط من وجود جدول tickets (لو مش منشأ من قبل)
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
              ? '?' +
                new URLSearchParams(event.queryStringParameters).toString()
              : ''
          }`
      );

      // /tickets?history=1&id=123
      const historyFlag = url.searchParams.get('history');
      const idParam = url.searchParams.get('id');

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

    // ===== POST  { section, status, payload, changedBy? } =====
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const section = String(body.section || 'cctv');
      const status = String(body.status || 'Under Review');
      const payload = body.payload || {};
      const changedBy = body.changedBy ? String(body.changedBy) : null;

      // نخزّن createdBy داخل الـpayload زي ما بيجي من الواجهة
      if (changedBy && !payload.createdBy) payload.createdBy = changedBy;

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

    // ===== PUT  { id, status?, actionTaken?, changedBy? } =====
    // ===== PUT /tickets  { id, status?, actionTaken?, changedBy? } =====
if (event.httpMethod === 'PUT') {
  const body = JSON.parse(event.body || '{}');

  const id = Number(body.id);
  const status =
    body.status === undefined || body.status === null ? null : String(body.status);
  // خليه null فعلاً لو مش مبعوث
  const actionTaken =
    body.actionTaken === undefined || body.actionTaken === null
      ? null
      : String(body.actionTaken);
  const changedBy = body.changedBy ? String(body.changedBy) : null;

  if (!id) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: 'id is required' }),
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (changedBy) {
      // نوصل اسم المستخدم للتريغر عبر إعداد سيشن
      await client.query('SELECT set_config($1, $2, true)', ['cc.user', changedBy]);
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
      [id, status, actionTaken]  // $1, $2, $3
    );

    await client.query('COMMIT');

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
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PUT tickets error:', err);
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  } finally {
    client.release();
  }
}
