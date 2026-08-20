const crypto = require("crypto");
const { Pool } = require("pg");
const { RESET_PURPOSE, getBearerToken, verifySignedToken } = require("./_auth");
const { hashPassword, verifyPassword } = require("./login");
const { requireJsonPost, boundedString } = require("./_http");

const CONNECTION_STRING =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL;
let pool = CONNECTION_STRING ? new Pool({ connectionString: CONNECTION_STRING }) : null;
const MIN_PASSWORD_LENGTH = 12;
const JSON_HEADERS = { "Content-Type": "application/json" };

function json(statusCode, body, headers = {}) {
  return { statusCode, headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) };
}

function validatePassword(password, confirmation) {
  if (typeof password !== "string" || !password.trim()) {
    return { field: "newPassword", message: "Enter a new password." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { field: "newPassword", message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password !== confirmation) {
    return { field: "confirmPassword", message: "Passwords do not match." };
  }
  return null;
}

async function ensureSchema(client) {
  await client.query(`
    ALTER TABLE admin_users
      ADD COLUMN IF NOT EXISTS session_version BIGINT NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS row_version BIGINT NOT NULL DEFAULT 1;

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      audit_id UUID PRIMARY KEY,
      actor_username TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      before_data JSONB,
      after_data JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { Allow: "POST, OPTIONS" }, body: "" };
  let body;
  try {
    body = requireJsonPost(event);
    boundedString(body.newPassword, "newPassword", { required: true, maxLength: 4096 });
    boundedString(body.confirmPassword, "confirmPassword", { required: true, maxLength: 4096 });
  } catch (error) {
    return json(error.statusCode || 400, { ok: false, error: error.message }, error.headers);
  }
  const payload = verifySignedToken(getBearerToken(event), RESET_PURPOSE);
  if (!payload) return json(401, { ok: false, error: "Password reset authorization is invalid or expired" });
  const validation = validatePassword(body.newPassword, body.confirmPassword);
  if (validation) {
    return json(400, { ok: false, error: validation.message, fieldErrors: { [validation.field]: validation.message } });
  }
  if (!pool) return json(503, { ok: false, error: "Password reset service unavailable" });

  let client = null;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    await ensureSchema(client);
    const result = await client.query(
      `SELECT user_id, username, role, status, must_reset_password, session_version, password_hash
         FROM admin_users
        WHERE user_id = $1::uuid
        FOR UPDATE`,
      [payload.userId]
    );
    const user = result.rows[0];
    const currentVersion = Number(user?.session_version);
    const valid = user &&
      String(user.status || "").toLowerCase() === "active" &&
      user.must_reset_password === true &&
      currentVersion === payload.sessionVersion &&
      String(user.username || "").trim().toLowerCase() === String(payload.username || "").trim().toLowerCase();
    if (!valid) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return json(401, { ok: false, error: "Password reset authorization is invalid or expired" });
    }
    if (verifyPassword(body.newPassword, user.password_hash)) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return json(400, {
        ok: false,
        error: "Choose a password different from the temporary password.",
        fieldErrors: { newPassword: "Choose a password different from the temporary password." },
      });
    }

    const passwordHash = hashPassword(body.newPassword);
    const update = await client.query(
      `UPDATE admin_users
          SET password_hash = $2,
              must_reset_password = false,
              session_version = session_version + 1,
              row_version = row_version + 1,
              updated_at = now(),
              updated_by = $3
        WHERE user_id = $1::uuid
          AND session_version = $4
        RETURNING session_version`,
      [payload.userId, passwordHash, user.username, currentVersion]
    );
    if (update.rows.length !== 1) throw new Error("Password reset conflict");
    await client.query(
      `INSERT INTO admin_audit_logs (
         audit_id, actor_username, action, target_type, target_id, before_data, after_data
       ) VALUES ($1, $2, 'complete_password_reset', 'admin_user', $3, $4::jsonb, $5::jsonb)`,
      [
        crypto.randomUUID(),
        user.username,
        String(user.user_id),
        JSON.stringify({ mustResetPassword: true, sessionVersion: currentVersion }),
        JSON.stringify({ mustResetPassword: false, sessionVersion: Number(update.rows[0].session_version), passwordUpdated: true }),
      ]
    );
    await client.query("COMMIT");
    transactionStarted = false;
    return json(200, { ok: true, message: "Password updated. Sign in with your new password." });
  } catch (error) {
    if (client && transactionStarted) await client.query("ROLLBACK").catch(() => {});
    console.error("complete-password-reset function error:", error?.code || "RESET_FAILURE");
    return json(client ? 500 : 503, { ok: false, error: client
      ? "Password reset could not be completed"
      : "Password reset service unavailable" });
  } finally {
    if (client) client.release();
  }
};

module.exports._test = {
  validatePassword,
  ensureSchema,
  setPool(nextPool) { pool = nextPool; },
};
