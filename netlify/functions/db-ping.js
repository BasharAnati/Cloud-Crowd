// netlify/functions/db-ping.js
const { Client } = require('pg');

exports.handler = async () => {
  const conn =
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.DATABASE_URL;

  if (!conn) {
    return {
      statusCode: 500,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      },
      body: JSON.stringify({ ok: false, error: 'Missing DB connection string' }),
    };
  }

  const client = new Client({
    connectionString: conn,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const { rows } = await client.query('select now() as now');
    await client.end();

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      },
      body: JSON.stringify({ ok: true, now: rows[0].now }),
    };
  } catch (err) {
    try { await client.end(); } catch {}
    return {
      statusCode: 500,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
