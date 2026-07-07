const { Pool } = require("pg");
const { requireAdminSession } = require("./_auth");

const CONNECTION_STRING =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL;

const pool = CONNECTION_STRING ? new Pool({ connectionString: CONNECTION_STRING }) : null;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };

function json(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function requireAnatiAdmin(event) {
  const session = requireAdminSession(event);
  const username = cleanText(session.username, 80).toLowerCase();
  if (username !== "anati") {
    const error = new Error("Anati admin access required");
    error.statusCode = 403;
    throw error;
  }
  return session;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method Not Allowed" });
  }

  try {
    requireAnatiAdmin(event);
  } catch (authError) {
    return json(authError.statusCode || 500, { error: authError.message });
  }

  if (!pool) {
    return json(500, { error: "Database is not configured" });
  }

  try {
    const result = await pool.query(
      `SELECT
         username,
         role,
         status,
         account_type,
         is_system_account,
         password_hash IS NOT NULL AS has_password_hash,
         employee_id,
         restaurant_id
       FROM admin_users
       WHERE lower(username) = 'anati'
       LIMIT 1`
    );

    if (!result.rows.length) {
      return json(404, { error: "Anati account not found" });
    }

    const row = result.rows[0];
    return json(200, {
      username: row.username,
      role: row.role,
      status: row.status,
      account_type: row.account_type,
      is_system_account: row.is_system_account === true,
      has_password_hash: row.has_password_hash === true,
      employee_id: row.employee_id || null,
      restaurant_id: row.restaurant_id || null,
    });
  } catch (error) {
    console.error("debug-anati function error:", error);
    return json(500, { error: "Database query failed" });
  }
};
