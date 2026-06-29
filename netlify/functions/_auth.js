const crypto = require("crypto");
const { Pool } = require("pg");

const CONNECTION_STRING =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL;

const pool = CONNECTION_STRING ? new Pool({ connectionString: CONNECTION_STRING }) : null;
const MODULE_ACTION_COLUMNS = {
  view: "can_view",
  create: "can_create",
  edit: "can_edit",
  delete: "can_delete",
};
const MODULE_KEY_ALIASES = {
  "customer-experience": "customer_experience",
  "daily-complaints": "daily_complaints",
  "complimentary-orders": "complimentary_orders",
  "free-order-requests": "free_order_requests",
  "free-order-share": "free_order_share",
  "call-queue": "call_queue",
  "weekly-quality": "weekly_quality",
  "employee-profiles": "employee_profiles",
  "employee-deductions": "employee_deductions",
  "agent-training": "agent_training",
  "client-profiles": "client_profiles",
  "restaurant-ratings": "restaurant_ratings",
  "anati-admin-center": "anati_admin",
};

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

function authError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function normalizeModuleKey(value) {
  const moduleKey = String(value || "").trim();
  return MODULE_KEY_ALIASES[moduleKey] || moduleKey;
}

function requireValidSession(event) {
  const token = getBearerToken(event);
  if (!token) throw authError(401, "Missing session token");

  const session = verifySessionToken(token);
  if (!session) throw authError(401, "Invalid or expired session token");

  return session;
}

function getCurrentUser(event) {
  const session = requireValidSession(event);
  return {
    username: session.username || "",
    role: session.role || "",
  };
}

function requireAdminSession(event) {
  const session = requireValidSession(event);
  if (session.role !== "admin") throw authError(403, "Admin role required");
  return session;
}

async function getModuleAccess(username, moduleKey) {
  if (!pool) return { configured: false, access: null, dbUnavailable: true };

  try {
    const result = await pool.query(
      `SELECT module_key, can_view, can_create, can_edit, can_delete
         FROM admin_module_access
        WHERE username = $1
        ORDER BY module_key ASC`,
      [username]
    );

    if (!result.rows.length) return { configured: false, access: null };
    return {
      configured: true,
      access:
        result.rows.find((row) => normalizeModuleKey(row.module_key) === moduleKey) ||
        null,
    };
  } catch {
    return { configured: false, access: null, dbUnavailable: true };
  }
}

async function requireModuleAccess(event, moduleKey, action = "view") {
  const session = requireValidSession(event);
  const username = String(session.username || "");
  const role = String(session.role || "").toLowerCase();
  const normalizedAction = String(action || "view").toLowerCase();
  const actionColumn = MODULE_ACTION_COLUMNS[normalizedAction];

  if (!actionColumn) throw authError(500, "Invalid module action");
  if (username === "Anati" && role === "admin") return session;

  const accessState = await getModuleAccess(username, moduleKey);

  // Transitional fallback: if permissions cannot be read yet, or this user has
  // no configured rows, preserve existing legacy role/function behavior.
  if (accessState.dbUnavailable || !accessState.configured) return session;

  if (accessState.access?.[actionColumn] === true) return session;
  throw authError(403, "Module access denied");
}

module.exports = {
  getBearerToken,
  verifySessionToken,
  getCurrentUser,
  requireValidSession,
  requireAdminSession,
  requireModuleAccess,
};
