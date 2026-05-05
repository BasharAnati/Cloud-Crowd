// netlify/functions/maintenance.js
// Global maintenance mode API backed by Postgres/Neon.

const crypto = require("crypto");
const { Pool } = require("pg");

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

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getBearerToken(event) {
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function verifySessionToken(token) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured");
  }

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest("base64url");

    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (signatureBuffer.length !== expectedBuffer.length) return null;
    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload.exp || Math.floor(Date.now() / 1000) >= payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
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
      const token = getBearerToken(event);
      if (!token) {
        return {
          statusCode: 401,
          headers: JSON_HEADERS,
          body: JSON.stringify({ error: "Missing session token" }),
        };
      }

      const session = verifySessionToken(token);
      if (!session) {
        return {
          statusCode: 401,
          headers: JSON_HEADERS,
          body: JSON.stringify({ error: "Invalid or expired session token" }),
        };
      }

      if (session.role !== "admin") {
        return {
          statusCode: 403,
          headers: JSON_HEADERS,
          body: JSON.stringify({ error: "Admin role required" }),
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
