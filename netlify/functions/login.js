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
const LEGACY_USERS = [
  { username: "Mai", password: "M#123", role: "manager" },
  { username: "Tuleen", password: "000000**", role: "agent" },
  { username: "Anati", password: "A@1995", role: "admin" },
  { username: "Aser", password: "000000**", role: "agent" },
  { username: "Tala", password: "000000**", role: "agent" },
];

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function getRole(username) {
  if (username === "Anati") return "admin";
  if (username === "Mai") return "manager";
  return "agent";
}

function findLegacyUser(username, password) {
  return LEGACY_USERS.find((user) => user.username === username && user.password === password) || null;
}

function legacyProfile(username) {
  const legacy = LEGACY_USERS.find((user) => user.username === username);
  if (!legacy) return null;
  return {
    username: legacy.username,
    role: legacy.role || getRole(legacy.username),
    displayName: legacy.username,
  };
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
      ADD COLUMN IF NOT EXISTS password_hash TEXT;
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

async function seedLegacyProfileIfMissing(username) {
  if (!pool) return;

  const profile = legacyProfile(username);
  if (!profile) return;

  await pool.query(
    `INSERT INTO admin_users (
       user_id,
       username,
       display_name,
       role,
       status,
       created_by,
       updated_by
     ) VALUES ($1, $2, $3, $4, 'active', 'legacy-login', 'legacy-login')
     ON CONFLICT (username) DO NOTHING`,
    [crypto.randomUUID(), profile.username, profile.displayName, profile.role]
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
  if (!pool) return { handled: false };

  await ensureAdminUsersTable();
  const dbUser = await getAdminUser(username);
  if (!dbUser) return { handled: false };

  if (String(dbUser.status || "active").toLowerCase() !== "active") {
    return { handled: true, ok: false };
  }

  if (dbUser.password_hash) {
    return {
      handled: true,
      ok: verifyPassword(password, dbUser.password_hash),
      username: dbUser.username,
      role: cleanText(dbUser.role, 40).toLowerCase() || getRole(dbUser.username),
    };
  }

  return { handled: false, existingUserWithoutPassword: true };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { username: rawUsername, password = "" } = JSON.parse(event.body || "{}");
    const username = cleanText(rawUsername, 80);
    if (!username || !password) return invalidCredentials();

    let dbAvailable = Boolean(pool);
    try {
      const dbResult = await tryDatabaseLogin(username, password);
      if (dbResult.handled) {
        return dbResult.ok
          ? loginSuccess(dbResult.username, dbResult.role)
          : invalidCredentials();
      }
    } catch (dbError) {
      dbAvailable = false;
      console.warn("Database login unavailable; falling back to legacy login.");
    }

    const legacy = findLegacyUser(username, password);
    if (!legacy) return invalidCredentials();

    if (dbAvailable) {
      try {
        await seedLegacyProfileIfMissing(legacy.username);
      } catch {
        console.warn("Legacy profile seed failed after successful legacy login.");
      }
    }

    return loginSuccess(legacy.username, legacy.role || getRole(legacy.username));
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
