// netlify/functions/tickets.js
const { Client } = require('pg');

const connectionString = process.env.NETLIFY_DATABASE_URL;

function json(status, body, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

// يبني الجدول/الفهارس/التريجر لو مش موجودين
async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id BIGSERIAL PRIMARY KEY,
      section TEXT NOT NULL,
      status  TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_section ON tickets(section);
    CREATE INDEX IF NOT EXISTS idx_tickets_status  ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_updated ON tickets(updated_at);

    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_tickets_updated ON tickets;
    CREATE TRIGGER trg_tickets_updated
      BEFORE UPDATE ON tickets
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
}

exports.handler = async (event) => {
  if (!connectionString) {
    return json(500, { ok: false, error: 'NETLIFY_DATABASE_URL is missing' });
  }

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // تأكد من وجود الجدول عند أول استدعاء
    await ensureSchema(client);

    if (event.httpMethod === 'GET') {
      // GET /tickets?section=cctv
      const params = event.queryStringParameters || {};
      const section = params.section || null;

      const { rows } = await client.query(
        `
        SELECT id, section, status, payload, created_at, updated_at
        FROM tickets
        WHERE ($1::text IS NULL OR section = $1)
        ORDER BY updated_at DESC
        LIMIT 500
        `,
        [section]
      );

      return json(200, { ok: true, count: rows.length, tickets: rows });
    }

    if (event.httpMethod === 'POST') {
      // POST /tickets { section, status, payload }
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch {
        return json(400, { ok: false, error: 'Invalid JSON body' });
      }

      const section = (body.section || '').trim();
      const status  = (body.status || '').trim();
      const payload = body.payload || {};

      if (!section || !status) {
        return json(400, { ok: false, error: 'section and status are required' });
      }

      const insert = await client.query(
        `
        INSERT INTO tickets (section, status, payload)
        VALUES ($1, $2, $3)
        RETURNING id, section, status, payload, created_at, updated_at
        `,
        [section, status, payload]
      );

      return json(200, { ok: true, ticket: insert.rows[0] });
    }

    return json(405, { ok: false, error: 'Method Not Allowed' });

  } catch (err) {
    console.error(err);
    return json(500, { ok: false, error: err.message || 'Server error' });
  } finally {
    try { await client.end(); } catch {}
  }
};
