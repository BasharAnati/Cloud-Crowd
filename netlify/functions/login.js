const crypto = require("crypto");
const { Pool } = require("pg");
const {
  SESSION_PURPOSE,
  RESET_PURPOSE,
  createSignedToken,
} = require("./_auth");
const { requireJsonPost, boundedString } = require("./_http");

const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const RESET_TOKEN_TTL_SECONDS = 15 * 60;
const CONNECTION_STRING =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL;

let pool = CONNECTION_STRING ? new Pool({ connectionString: CONNECTION_STRING }) : null;

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
  });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

function verifyPassword(password, passwordHash) {
  try {
    const parts = String(passwordHash || "").split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, nValue, rValue, pValue, saltValue, hashValue] = parts;
    const expected = Buffer.from(hashValue, "base64url");
    const actual = crypto.scryptSync(password, Buffer.from(saltValue, "base64url"), expected.length, {
      N: Number(nValue),
      r: Number(rValue),
      p: Number(pValue),
      maxmem: 32 * 1024 * 1024,
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

async function ensureAdminUsersTable(client = pool) {
  if (!client) return false;
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      user_id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'agent',
      status TEXT NOT NULL DEFAULT 'active',
      must_reset_password BOOLEAN DEFAULT false,
      password_hash TEXT,
      session_version BIGINT NOT NULL DEFAULT 1,
      row_version BIGINT NOT NULL DEFAULT 1,
      access_version BIGINT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      disabled_at TIMESTAMPTZ,
      created_by TEXT,
      updated_by TEXT
    );

    ALTER TABLE admin_users
      ADD COLUMN IF NOT EXISTS password_hash TEXT,
      ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'external',
      ADD COLUMN IF NOT EXISTS employee_id UUID,
      ADD COLUMN IF NOT EXISTS restaurant_id UUID,
      ADD COLUMN IF NOT EXISTS is_system_account BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS linked_by TEXT,
      ADD COLUMN IF NOT EXISTS session_version BIGINT NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS row_version BIGINT NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS access_version BIGINT NOT NULL DEFAULT 1;
  `);
  return true;
}

async function getAdminUser(username, client = pool) {
  if (!client) return null;
  const result = await client.query(
    `SELECT user_id, username, display_name, role, status, must_reset_password,
            password_hash, session_version
       FROM admin_users
      WHERE lower(username) = lower($1)
      ORDER BY username ASC
      LIMIT 2`,
    [username]
  );
  if (result.rows.length > 1) {
    const error = new Error("Case-colliding user identities require administrator resolution");
    error.code = "IDENTITY_CONFLICT";
    throw error;
  }
  return result.rows[0] || null;
}

async function ensureAnatiSystemProfile(user, client = pool) {
  if (!client || String(user?.username || "").trim().toLowerCase() !== "anati") return;
  const result = await client.query(
    `UPDATE admin_users
        SET session_version = session_version + CASE WHEN role <> 'admin' THEN 1 ELSE 0 END,
            row_version = row_version + CASE WHEN role <> 'admin' THEN 1 ELSE 0 END,
            username = 'Anati',
            role = 'admin',
            status = 'active',
            account_type = 'system',
            employee_id = NULL,
            restaurant_id = NULL,
            is_system_account = true,
            linked_at = COALESCE(linked_at, now()),
            linked_by = COALESCE(linked_by, 'login'),
            disabled_at = NULL
      WHERE user_id = $1::uuid
      RETURNING username, role, status, session_version`,
    [user.user_id]
  );
  return result.rows[0] || null;
}

function tokenPayload(user, purpose, ttlSeconds) {
  return {
    userId: user.user_id,
    username: user.username,
    role: cleanText(user.role, 40).toLowerCase() || "agent",
    sessionVersion: Number(user.session_version),
    purpose,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
}

function loginSuccess(user) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      success: true,
      message: "Login successful",
      username: user.username,
      role: cleanText(user.role, 40).toLowerCase() || "agent",
      sessionToken: createSignedToken(tokenPayload(user, SESSION_PURPOSE, TOKEN_TTL_SECONDS)),
    }),
  };
}

function resetRequired(user) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      success: false,
      resetRequired: true,
      message: "Create a new password to continue",
      resetToken: createSignedToken(tokenPayload(user, RESET_PURPOSE, RESET_TOKEN_TTL_SECONDS)),
      expiresIn: RESET_TOKEN_TTL_SECONDS,
    }),
  };
}

function invalidCredentials() {
  return {
    statusCode: 401,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ success: false, message: "Invalid credentials" }),
  };
}

async function tryDatabaseLogin(username, password) {
  if (!pool) throw new Error("Database is not configured");
  await ensureAdminUsersTable();
  const user = await getAdminUser(username);
  if (!user || String(user.status || "").toLowerCase() !== "active") return null;
  if (!user.password_hash || !verifyPassword(password, user.password_hash)) return null;
  if (!Number.isSafeInteger(Number(user.session_version))) return null;
  return user;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { Allow: "POST, OPTIONS" }, body: "" };
  }
  try {
    const requestBody = requireJsonPost(event);
    const rawUsername = boundedString(requestBody.username, "username", { required: true, maxLength: 80 });
    const password = boundedString(requestBody.password, "password", { required: true, maxLength: 4096 });
    const username = cleanText(rawUsername, 80);
    if (!username) return invalidCredentials();
    const user = await tryDatabaseLogin(username, password);
    if (!user) return invalidCredentials();
    if (user.username.toLowerCase() === "anati") {
      Object.assign(user, await ensureAnatiSystemProfile(user));
    }
    return user.must_reset_password === true ? resetRequired(user) : loginSuccess(user);
  } catch (error) {
    if (error?.statusCode && error.statusCode < 500) {
      return {
        statusCode: error.statusCode,
        headers: { "Content-Type": "application/json", ...(error.headers || {}) },
        body: JSON.stringify({ success: false, message: error.message }),
      };
    }
    console.error("login function error:", error?.code || "LOGIN_FAILURE");
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, message: "Login service unavailable" }),
    };
  }
};

module.exports._test = {
  hashPassword,
  verifyPassword,
  ensureAdminUsersTable,
  getAdminUser,
  tokenPayload,
  setPool(nextPool) { pool = nextPool; },
};
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
