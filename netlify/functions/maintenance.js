// netlify/functions/maintenance.js
// Global maintenance mode API backed by Postgres/Neon.

const { Pool } = require("pg");
const {
  getBearerToken,
  verifySessionToken,
  requireAdminSession,
} = require("./_auth");

const CONNECTION_STRING =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL;

const pool = new Pool({ connectionString: CONNECTION_STRING });

const SETTINGS_KEY = "maintenance";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };

async function ensureSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

async function getMaintenanceState() {
  const result = await pool.query(
    "SELECT value FROM app_settings WHERE key = $1",
    [SETTINGS_KEY]
  );

  return result.rows[0]?.value === "1";
}

async function setMaintenanceState(maintenance) {
  await pool.query(
    `INSERT INTO app_settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [SETTINGS_KEY, maintenance ? "1" : "0"]
  );
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  try {
    await ensureSettingsTable();

    if (event.httpMethod === "GET") {
      const maintenance = await getMaintenanceState();
      const token = getBearerToken(event);
      const session = token ? verifySessionToken(token) : null;
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          maintenance,
          admin: session?.role === "admin"
        }),
      };
    }

    if (event.httpMethod === "POST") {
      try {
        requireAdminSession(event);
      } catch (authErr) {
        if (!authErr.statusCode) throw authErr;
        return {
          statusCode: authErr.statusCode || 401,
          headers: JSON_HEADERS,
          body: JSON.stringify({ error: authErr.message }),
        };
      }

      const body = JSON.parse(event.body || "{}");
      const maintenance = body.maintenance === true;
      await setMaintenanceState(maintenance);

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ maintenance }),
      };
    }

    return {
      statusCode: 405,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  } catch (err) {
    console.error("maintenance function error:", err);
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "Internal Server Error" }),
    };
  }
};
