// netlify/functions/maintenance.js
// Global maintenance mode API backed by Postgres/Neon.

const { Pool } = require("pg");
const { requireAnatiSession } = require("./_auth");
const { requireJsonPost } = require("./_http");

const CONNECTION_STRING =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL;

let pool = CONNECTION_STRING ? new Pool({ connectionString: CONNECTION_STRING }) : null;

const SETTINGS_KEY = "maintenance";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };

async function ensureSettingsTable() {
  if (!pool) return false;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return true;
}

async function getMaintenanceState() {
  if (!pool) return false;
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
    if (!(await ensureSettingsTable())) {
      return { statusCode: 503, headers: JSON_HEADERS, body: JSON.stringify({ error: "Maintenance service unavailable" }) };
    }

    if (event.httpMethod === "GET") {
      const maintenance = await getMaintenanceState();
      let admin = false;
      try {
        await requireAnatiSession(event);
        admin = true;
      } catch (authErr) {
        if (!authErr.statusCode) throw authErr;
      }

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          maintenance,
          admin,
        }),
      };
    }

    if (event.httpMethod === "POST") {
      try {
        await requireAnatiSession(event);
      } catch (authErr) {
        if (!authErr.statusCode) throw authErr;
        return {
          statusCode: authErr.statusCode,
          headers: JSON_HEADERS,
          body: JSON.stringify({ error: authErr.message }),
        };
      }

      let body;
      try {
        body = requireJsonPost(event);
      } catch (error) {
        return {
          statusCode: error.statusCode || 400,
          headers: { ...JSON_HEADERS, ...(error.headers || {}) },
          body: JSON.stringify({ error: error.message }),
        };
      }
      if (typeof body.maintenance !== "boolean") {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "maintenance must be a boolean" }) };
      }
      const maintenance = body.maintenance;
      await setMaintenanceState(maintenance);

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ maintenance }),
      };
    }

    return {
      statusCode: 405,
      headers: { ...JSON_HEADERS, Allow: "GET, POST, OPTIONS" },
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  } catch (err) {
    console.error("maintenance function error:", err?.code || "MAINTENANCE_FAILURE");
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "Internal Server Error" }),
    };
  }
};

module.exports._test = {
  setPool(nextPool) { pool = nextPool; },
};
