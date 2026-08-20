const crypto = require("crypto");
const { Pool } = require("pg");

const CONNECTION_STRING =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL;

let pool = CONNECTION_STRING ? new Pool({ connectionString: CONNECTION_STRING }) : null;
const SESSION_PURPOSE = "application";
const RESET_PURPOSE = "password_reset";
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
const RESERVED_MODULE_KEYS = new Set(["call_queue", "anati_admin"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
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

function authError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function tokenSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw authError(503, "Authentication service unavailable");
  return secret;
}

function createSignedToken(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", tokenSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifySignedToken(token, expectedPurpose) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, signature] = parts;
    const header = JSON.parse(base64UrlDecode(encodedHeader));
    if (header?.alg !== "HS256" || header?.typ !== "JWT") return null;
    const expectedSignature = crypto
      .createHmac("sha256", tokenSecret())
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest("base64url");
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (signatureBuffer.length !== expectedBuffer.length) return null;
    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!Number.isSafeInteger(payload?.exp) || Math.floor(Date.now() / 1000) >= payload.exp) return null;
    if (payload.purpose !== expectedPurpose) return null;
    if (!UUID_PATTERN.test(String(payload.userId || ""))) return null;
    if (!Number.isSafeInteger(payload.sessionVersion) || payload.sessionVersion < 1) return null;
    return payload;
  } catch {
    return null;
  }
}

function invalidSession() {
  return authError(401, "Invalid or expired session token");
}

function normalizeModuleKey(value) {
  const moduleKey = String(value || "").trim().toLowerCase();
  return MODULE_KEY_ALIASES[moduleKey] || moduleKey;
}

async function currentAccount(payload) {
  if (!pool) throw authError(503, "Authentication service unavailable");
  let result;
  try {
    result = await pool.query(
      `SELECT user_id, username, role, status, session_version, must_reset_password
         FROM admin_users
        WHERE user_id = $1::uuid
        LIMIT 1`,
      [payload.userId]
    );
  } catch {
    throw authError(503, "Authentication service unavailable");
  }

  const account = result.rows[0];
  if (!account || String(account.status || "").toLowerCase() !== "active") throw invalidSession();
  const role = String(account.role || "").trim().toLowerCase();
  const username = String(account.username || "").trim();
  const sessionVersion = Number(account.session_version);
  if (!username || !role || !Number.isSafeInteger(sessionVersion)) throw invalidSession();
  if (sessionVersion !== payload.sessionVersion) throw invalidSession();
  if (role !== String(payload.role || "").trim().toLowerCase()) throw invalidSession();
  if (username.toLowerCase() !== String(payload.username || "").trim().toLowerCase()) throw invalidSession();
  if (account.must_reset_password === true) throw invalidSession();

  return {
    userId: account.user_id,
    username,
    role,
    status: "active",
    sessionVersion,
    mustResetPassword: account.must_reset_password === true,
    purpose: SESSION_PURPOSE,
  };
}

async function requireValidSession(event) {
  const token = getBearerToken(event);
  if (!token) throw authError(401, "Missing session token");
  const payload = verifySignedToken(token, SESSION_PURPOSE);
  if (!payload) throw invalidSession();
  return currentAccount(payload);
}

async function getCurrentUser(event) {
  const session = await requireValidSession(event);
  return { username: session.username, role: session.role, userId: session.userId };
}

async function requireAdminSession(event) {
  const session = await requireValidSession(event);
  if (session.role !== "admin") throw authError(403, "Administrator access required");
  return session;
}

async function requireAnatiSession(event) {
  const session = await requireValidSession(event);
  if (session.username.toLowerCase() !== "anati" || session.role !== "admin") {
    throw authError(403, "Anati administrator access required");
  }
  return session;
}

async function getModuleAccess(username, moduleKey) {
  if (!pool) throw authError(503, "Permission service unavailable");
  try {
    const result = await pool.query(
      `SELECT module_key, can_view, can_create, can_edit, can_delete
         FROM admin_module_access
        WHERE lower(username) = lower($1)
        ORDER BY module_key ASC`,
      [username]
    );
    const matches = result.rows.filter((row) => normalizeModuleKey(row.module_key) === moduleKey);
    if (matches.length > 1) throw authError(409, "Permission data conflict");
    return matches[0] || null;
  } catch (error) {
    if (error.statusCode) throw error;
    throw authError(503, "Permission service unavailable");
  }
}

async function requireModuleAccess(event, moduleKey, action = "view") {
  const session = await requireValidSession(event);
  const normalizedModuleKey = normalizeModuleKey(moduleKey);
  const actionColumn = MODULE_ACTION_COLUMNS[String(action || "view").toLowerCase()];
  if (!actionColumn) throw authError(500, "Invalid module action");
  if (session.username.toLowerCase() === "anati" && session.role === "admin") return session;
  if (RESERVED_MODULE_KEYS.has(normalizedModuleKey)) throw authError(403, "Module access denied");

  const access = await getModuleAccess(session.username, normalizedModuleKey);
  if (access?.[actionColumn] === true) return session;
  throw authError(403, "Module access denied");
}

module.exports = {
  SESSION_PURPOSE,
  RESET_PURPOSE,
  createSignedToken,
  verifySignedToken,
  getBearerToken,
  getCurrentUser,
  requireValidSession,
  requireAdminSession,
  requireAnatiSession,
  requireModuleAccess,
  _test: {
    setPool(nextPool) { pool = nextPool; },
    authError,
    currentAccount,
    normalizeModuleKey,
  },
};
