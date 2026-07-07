// netlify/functions/login.js
const crypto = require("crypto");
const { Pool } = require("pg");

const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const CONNECTION_STRING =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL;

const pool = CONNECTION_STRING ? new Pool({ connectionString: CONNECTION_STRING }) : null;

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function createSessionToken(payload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured");
  }

  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
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
}

async function ensureAdminUsersTable() {
  if (!pool) return false;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      user_id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'agent',
      status TEXT NOT NULL DEFAULT 'active',
      must_reset_password BOOLEAN DEFAULT false,
      password_hash TEXT,
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
      ADD COLUMN IF NOT EXISTS linked_by TEXT;
  `);
  return true;
}

async function getAdminUser(username) {
  if (!pool) return null;

  const result = await pool.query(
    `SELECT user_id, username, display_name, role, status, must_reset_password, password_hash
       FROM admin_users
      WHERE username = $1
      LIMIT 1`,
    [username]
  );
  return result.rows[0] || null;
}

async function ensureAnatiSystemProfile(username) {
  if (!pool) return;
  if (String(username || "").trim().toLowerCase() !== "anati") return;

  await pool.query(
    `INSERT INTO admin_users (
       user_id,
       username,
       display_name,
       role,
       status,
       account_type,
       is_system_account,
       linked_at,
       linked_by,
       created_by,
       updated_by
     ) VALUES ($1, 'Anati', 'Anati', 'admin', 'active', 'system', true, now(), 'legacy-login', 'legacy-login', 'legacy-login')
     ON CONFLICT (username)
     DO UPDATE SET
       role = 'admin',
       status = 'active',
       account_type = 'system',
       employee_id = NULL,
       restaurant_id = NULL,
       is_system_account = true,
       linked_at = COALESCE(admin_users.linked_at, now()),
       linked_by = COALESCE(admin_users.linked_by, 'legacy-login'),
       disabled_at = NULL,
       updated_at = now(),
       updated_by = 'legacy-login'`,
    [crypto.randomUUID()]
  );
}

function loginSuccess(username, role) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const sessionToken = createSessionToken({ username, role, exp });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      success: true,
      message: "Login successful",
      username,
      role,
      sessionToken,
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
  const dbUser = await getAdminUser(username);
  if (!dbUser) return { ok: false };

  if (String(dbUser.status || "active").toLowerCase() !== "active") {
    return { ok: false };
  }

  if (dbUser.password_hash) {
    return {
      ok: verifyPassword(password, dbUser.password_hash),
      username: dbUser.username,
      role: cleanText(dbUser.role, 40).toLowerCase() || "agent",
    };
  }

  return { ok: false };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { username: rawUsername, password = "" } = JSON.parse(event.body || "{}");
    const username = cleanText(rawUsername, 80);
    if (!username || !password) return invalidCredentials();

    try {
      const dbResult = await tryDatabaseLogin(username, password);
      if (!dbResult.ok) return invalidCredentials();
      if (String(dbResult.username || "").toLowerCase() === "anati") {
        await ensureAnatiSystemProfile(dbResult.username);
      }
      return loginSuccess(dbResult.username, dbResult.role);
    } catch (dbError) {
      console.warn("Database login unavailable.");
      throw dbError;
    }
  } catch (error) {
    console.error("login function error:", error);
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
};
