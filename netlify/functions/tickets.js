// netlify/functions/tickets.js
// Tickets CRUD via Neon Postgres (GET, POST, PUT)

const { Pool } = require('pg');

// اشتغل مع أي اسم متغيّر عندك: NETLIFY_DATABASE_URL أو NEON_DATABASE_URL
const CONNECTION_STRING =
  process.env.NETLIFY_DATABASE_URL || process.env.NEON_DATABASE_URL;

if (!CONNECTION_STRING) {
  console.error('Missing DB URL env var (NEON_DATABASE_URL or NETLIFY_DATABASE_URL)');
}

// Neon URL فيه sslmode=require عادة، بس منأمن زيادة:
const pool = new Pool({
  connectionString: CONNECTION_STRING,
  ssl: { rejectUnauthorized: false },
});

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// نضمن وجود الجدول (لو مش معمول)
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

    // ===== GET /tickets?section=cctv =====
    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      const section = qs.section || 'cctv';

      const { rows } = await pool.query(
        `SELECT id, section, status, payload, created_at, updated_at
           FROM tickets
          WHERE section = $1
          ORDER BY id DESC`, // الأحدث أولاً
        [section]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, count: rows.length, tickets: rows }),
      };
    }

    // ===== PUT /tickets  { id, status?, actionTaken? } =====
if (event.httpMethod === 'PUT') {
  const body = JSON.parse(event.body || '{}');

  const id = Number(body.id);              // مهم: نحوله رقم
  const status = body.status ?? null;      // قد تكون null
  const actionTaken = body.actionTaken ?? null; // قد تكون null

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
                            to_jsonb(($3)::text),  -- إجبار النوع إلى نص
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

