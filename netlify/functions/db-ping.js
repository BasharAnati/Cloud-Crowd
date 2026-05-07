// netlify/functions/db-ping.js
const { Client } = require('pg');
const { requireAdminSession } = require('./_auth');

const JSON_HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
};

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,OPTIONS',
        'access-control-allow-headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  try {
    requireAdminSession(event);
  } catch (authErr) {
    return json(authErr.statusCode || 500, { ok: false, error: authErr.message });
  }

  const conn =
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.DATABASE_URL;

  if (!conn) {
    return json(500, { ok: false, error: 'Missing DB connection string' });
  }

  const client = new Client({
    connectionString: conn,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const { rows } = await client.query('select now() as now');
    await client.end();

    return json(200, { ok: true, now: rows[0].now });
  } catch (err) {
    try { await client.end(); } catch {}
    return json(500, { ok: false, error: err.message });
  }
};
