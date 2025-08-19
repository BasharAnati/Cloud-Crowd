// netlify/functions/tickets.js
// Handles tickets CRUD via Neon Postgres (GET, POST, PUT)

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.NETLIFY_DATABASE_URL, // Neon (pooled)
  // Neon URL already has sslmode=require; no extra ssl config needed
});

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  try {
    if (event.httpMethod === 'GET') {
      // /tickets?section=cctv
      const url = new URL(event.rawUrl || `https://x${event.path}${event.queryStringParameters ? '?' + new URLSearchParams(event.queryStringParameters).toString() : ''}`);
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
        headers: { 'Content-Type': 'application/json', ...cors },
        body: JSON.stringify({ ok: true, count: rows.length, tickets: rows }),
      };
    }

    if (event.httpMethod === 'POST') {
      // body: { section, status, payload }
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
        headers: { 'Content-Type': 'application/json', ...cors },
        body: JSON.stringify({ ok: true, ticket: rows[0] }),
      };
    }

    if (event.httpMethod === 'PUT') {
      // body: { id, section?, status?, actionTaken? }
      const body = JSON.parse(event.body || '{}');
      const id = body.id;
      const status = body.status ?? null;
      const actionTaken = body.actionTaken ?? null;

      if (!id) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', ...cors },
          body: JSON.stringify({ ok: false, error: 'id is required' }),
        };
      }

      // نبني UPDATE مرن: نعدّل status إذا وصل، ونغرس actionTaken داخل payload إذا وصل
      const { rows } = await pool.query(
        `UPDATE tickets
           SET
             status = COALESCE($2, status),
             payload = CASE
                         WHEN $3 IS NULL THEN payload
                         ELSE jsonb_set(COALESCE(payload, '{}'::jsonb), '{actionTaken}', to_jsonb($3::text), true)
                       END,
             updated_at = now()
         WHERE id = $1
         RETURNING id, section, status, payload, created_at, updated_at`,
        [id, status, actionTaken]
      );

      if (rows.length === 0) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json', ...cors },
          body: JSON.stringify({ ok: false, error: 'Ticket not found' }),
        };
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...cors },
        body: JSON.stringify({ ok: true, ticket: rows[0] }),
      };
    }

    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json', ...cors },
      body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }),
    };
  } catch (err) {
    console.error('tickets function error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...cors },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
