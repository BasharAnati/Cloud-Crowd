const crypto = require("crypto");
const { Pool } = require("pg");
const { requireValidSession, requireModuleAccess } = require("./_auth");

const CONNECTION_STRING =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL;

const pool = new Pool({ connectionString: CONNECTION_STRING });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };

const ROLES = new Set(["admin", "manager", "agent"]);
const STATUSES = new Set(["active", "disabled"]);
const MODULES = [
  { moduleKey: "dashboard", moduleName: "Dashboard", route: "dashboard.html" },
  { moduleKey: "cctv", moduleName: "CCTV", route: "cctv.html" },
  { moduleKey: "customer_experience", moduleName: "Customer Experience", route: "ce.html" },
  { moduleKey: "daily_complaints", moduleName: "Daily Complaints", route: "complaints.html" },
  { moduleKey: "complimentary_orders", moduleName: "Complimentary Orders", route: "free-orders.html" },
  { moduleKey: "free_order_requests", moduleName: "Free Order Requests", route: "free-order-requests.html" },
  { moduleKey: "free_order_share", moduleName: "Free Order Share", route: "free-order-share.html" },
  { moduleKey: "call_queue", moduleName: "Call Queue", route: "call-queue.html" },
  { moduleKey: "attendance", moduleName: "Attendance", route: "attendance.html" },
  { moduleKey: "weekly_quality", moduleName: "Weekly Quality", route: "weekly-quality.html" },
  { moduleKey: "employee_profiles", moduleName: "Employee Profiles", route: "employee-profiles.html" },
  { moduleKey: "employee_deductions", moduleName: "Employee Deductions", route: "employee-deductions.html" },
  { moduleKey: "agent_training", moduleName: "Agent Training", route: "agent-training.html" },
  { moduleKey: "client_profiles", moduleName: "Client Profiles", route: "client-profiles.html" },
  { moduleKey: "restaurant_ratings", moduleName: "Restaurant Ratings", route: "restaurant-ratings.html" },
  { moduleKey: "anati_admin", moduleName: "Anati Admin Center", route: "anati-admin.html" },
];
const MODULE_KEYS = new Set(MODULES.map((module) => module.moduleKey));
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
const SEED_USERS = [
  { username: "Anati", displayName: "Anati", role: "admin" },
  { username: "Mai", displayName: "Mai", role: "manager" },
  { username: "Tuleen", displayName: "Tuleen", role: "agent" },
  { username: "Aser", displayName: "Aser", role: "agent" },
  { username: "Tala", displayName: "Tala", role: "agent" },
];
const MIN_TEMP_PASSWORD_LENGTH = 6;

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

function requiredText(value, field, maxLength) {
  const result = cleanText(value, maxLength);
  if (!result) {
    const error = new Error(`${field} is required`);
    error.statusCode = 400;
    throw error;
  }
  return result;
}

function normalizeRole(value) {
  const role = cleanText(value || "agent", 40).toLowerCase();
  if (!ROLES.has(role)) {
    const error = new Error("Invalid role");
    error.statusCode = 400;
    throw error;
  }
  return role;
}

function normalizeStatus(value) {
  const status = cleanText(value || "active", 40).toLowerCase();
  if (!STATUSES.has(status)) {
    const error = new Error("Invalid status");
    error.statusCode = 400;
    throw error;
  }
  return status;
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  const text = cleanText(value, 20).toLowerCase();
  return text === "1" || text === "true" || text === "yes";
}

function normalizeModuleKey(value) {
  const moduleKey = cleanText(value, 120);
  return MODULE_KEY_ALIASES[moduleKey] || moduleKey;
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

function normalizeTemporaryPassword(value) {
  const password = String(value ?? "");
  if (!password) return "";
  if (password.length < MIN_TEMP_PASSWORD_LENGTH) {
    const error = new Error(`temporaryPassword must be at least ${MIN_TEMP_PASSWORD_LENGTH} characters`);
    error.statusCode = 400;
    throw error;
  }
  return password;
}

function normalizeUserBody(body, options = {}) {
  const temporaryPassword = normalizeTemporaryPassword(body?.temporaryPassword);
  return {
    username: options.requireUsername === false
      ? cleanText(body?.username, 80)
      : requiredText(body?.username, "username", 80),
    displayName: cleanText(body?.displayName, 200),
    email: cleanText(body?.email, 320),
    role: normalizeRole(body?.role),
    status: normalizeStatus(body?.status),
    mustResetPassword: temporaryPassword ? true : normalizeBoolean(body?.mustResetPassword),
    temporaryPassword,
  };
}

function normalizeAccessBody(body) {
  const username = requiredText(body?.username, "username", 80);
  const records = Array.isArray(body?.access) ? body.access : [];
  if (!records.length) {
    const error = new Error("access array is required");
    error.statusCode = 400;
    throw error;
  }

  return {
    username,
    access: records.map((record) => {
      const moduleKey = normalizeModuleKey(requiredText(
        record?.moduleKey || record?.module_key,
        "moduleKey",
        120
      ));
      if (!MODULE_KEYS.has(moduleKey)) {
        const error = new Error(`Invalid moduleKey: ${moduleKey}`);
        error.statusCode = 400;
        throw error;
      }

      return {
        moduleKey,
        canView: normalizeBoolean(record?.canView ?? record?.can_view),
        canCreate: normalizeBoolean(record?.canCreate ?? record?.can_create),
        canEdit: normalizeBoolean(record?.canEdit ?? record?.can_edit),
        canDelete: normalizeBoolean(record?.canDelete ?? record?.can_delete),
      };
    }),
  };
}

function requireAnatiAdmin(event) {
  const session = requireValidSession(event);
  const username = cleanText(session.username, 80);
  const role = cleanText(session.role, 40).toLowerCase();
  if (username.toLowerCase() !== "anati" || role !== "admin") {
    const error = new Error("Anati admin access required");
    error.statusCode = 403;
    throw error;
  }
  return session;
}

async function ensureTables() {
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

    CREATE TABLE IF NOT EXISTS admin_module_access (
      access_id UUID PRIMARY KEY,
      username TEXT NOT NULL,
      module_key TEXT NOT NULL,
      can_view BOOLEAN DEFAULT false,
      can_create BOOLEAN DEFAULT false,
      can_edit BOOLEAN DEFAULT false,
      can_delete BOOLEAN DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT
    );

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

    ALTER TABLE admin_users
      ADD COLUMN IF NOT EXISTS password_hash TEXT;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_module_access_username_module
      ON admin_module_access(username, module_key);

    CREATE INDEX IF NOT EXISTS idx_admin_users_username
      ON admin_users(username);

    CREATE INDEX IF NOT EXISTS idx_admin_users_status
      ON admin_users(status);

    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at
      ON admin_audit_logs(created_at DESC);
  `);
}

function mapUser(row) {
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name || "",
    email: row.email || "",
    role: row.role || "agent",
    status: row.status || "active",
    mustResetPassword: row.must_reset_password === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    disabledAt: row.disabled_at,
    createdBy: row.created_by || "",
    updatedBy: row.updated_by || "",
  };
}

function mapAccess(row) {
  return {
    accessId: row.access_id,
    username: row.username,
    moduleKey: normalizeModuleKey(row.module_key),
    canView: row.can_view === true,
    canCreate: row.can_create === true,
    canEdit: row.can_edit === true,
    canDelete: row.can_delete === true,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || "",
  };
}

async function writeAudit(client, actor, action, targetType, targetId, beforeData, afterData) {
  await client.query(
    `INSERT INTO admin_audit_logs (
       audit_id,
       actor_username,
       action,
       target_type,
       target_id,
       before_data,
       after_data
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      crypto.randomUUID(),
      actor,
      action,
      targetType,
      targetId,
      beforeData ? JSON.stringify(beforeData) : null,
      afterData ? JSON.stringify(afterData) : null,
    ]
  );
}

async function seedUsersIfEmpty(actor) {
  const count = await pool.query("SELECT COUNT(*)::int AS count FROM admin_users");
  if (Number(count.rows[0]?.count || 0) > 0) return false;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const user of SEED_USERS) {
      const userId = crypto.randomUUID();
      await client.query(
        `INSERT INTO admin_users (
           user_id,
           username,
           display_name,
           role,
           status,
           created_by,
           updated_by
         ) VALUES ($1, $2, $3, $4, 'active', $5, $5)`,
        [userId, user.username, user.displayName, user.role, actor]
      );
      await writeAudit(client, actor, "seed_user", "admin_user", userId, null, {
        username: user.username,
        role: user.role,
        status: "active",
      });
    }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listUsers() {
  const result = await pool.query(
    `SELECT *
       FROM admin_users
      ORDER BY
        CASE status WHEN 'active' THEN 0 ELSE 1 END,
        CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,
        username ASC`
  );
  return result.rows.map(mapUser);
}

async function listAccess() {
  const result = await pool.query(
    `SELECT *
       FROM admin_module_access
      ORDER BY username ASC, module_key ASC`
  );
  return result.rows.map(mapAccess);
}

async function listAccessForUser(username) {
  const result = await pool.query(
    `SELECT *
       FROM admin_module_access
      WHERE username = $1
      ORDER BY module_key ASC`,
    [username]
  );
  return result.rows.map(mapAccess);
}

async function getUser(userId, client = pool) {
  const result = await client.query(
    `SELECT *
       FROM admin_users
      WHERE user_id = $1::uuid`,
    [userId]
  );
  return result.rows.length ? mapUser(result.rows[0]) : null;
}

function allModuleAccessFor(username) {
  return MODULES.map((module) => ({
    accessId: "",
    username,
    moduleKey: module.moduleKey,
    canView: true,
    canCreate: true,
    canEdit: true,
    canDelete: true,
    updatedAt: null,
    updatedBy: "",
  }));
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  let session;
  try {
    session =
      event.httpMethod === "GET" && event.queryStringParameters?.["my-access"] === "1"
        ? requireValidSession(event)
        : requireAnatiAdmin(event);
    if (!(event.httpMethod === "GET" && event.queryStringParameters?.["my-access"] === "1")) {
      const moduleAction =
        event.httpMethod === "GET"
          ? "view"
          : event.httpMethod === "POST"
            ? "create"
            : event.httpMethod === "PUT"
              ? "edit"
              : event.httpMethod === "DELETE"
                ? "delete"
                : "view";
      await requireModuleAccess(event, "anati_admin", moduleAction);
    }
  } catch (authError) {
    return json(authError.statusCode || 500, {
      ok: false,
      error: authError.message,
    });
  }

  if (!CONNECTION_STRING) {
    if (event.httpMethod === "GET" && event.queryStringParameters?.["my-access"] === "1") {
      return json(200, {
        ok: true,
        modules: MODULES,
        access: [],
        hasConfiguredAccess: false,
        legacyFallback: true,
      });
    }
    return json(500, { ok: false, error: "Database is not configured" });
  }

  const actor = cleanText(session.username || "unknown", 80);

  try {
    await ensureTables();

    if (event.httpMethod === "GET") {
      if (event.queryStringParameters?.["my-access"] === "1") {
        const username = cleanText(session.username, 80);
        const role = cleanText(session.role, 40).toLowerCase();
        const isAnatiAdmin = username.toLowerCase() === "anati" && role === "admin";
        const access = isAnatiAdmin
          ? allModuleAccessFor(username)
          : await listAccessForUser(username);

        return json(200, {
          ok: true,
          modules: MODULES,
          access,
          hasConfiguredAccess: isAnatiAdmin || access.length > 0,
          legacyFallback: !isAnatiAdmin && access.length === 0,
        });
      }

      if (event.queryStringParameters?.modules === "1") {
        return json(200, {
          ok: true,
          modules: MODULES,
          access: await listAccess(),
        });
      }

      const seeded = await seedUsersIfEmpty(actor);
      const users = await listUsers();
      return json(200, {
        ok: true,
        seeded,
        count: users.length,
        users,
        access: await listAccess(),
      });
    }

    if (event.httpMethod === "POST") {
      const body = normalizeUserBody(JSON.parse(event.body || "{}"));
      const userId = crypto.randomUUID();

      await pool.query(
        `INSERT INTO admin_users (
           user_id,
           username,
           display_name,
           email,
           role,
           status,
           must_reset_password,
           password_hash,
           created_by,
           updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        [
          userId,
          body.username,
          body.displayName || null,
          body.email || null,
          body.role,
          body.status,
          body.mustResetPassword,
          body.temporaryPassword ? hashPassword(body.temporaryPassword) : null,
          actor,
        ]
      );

      const user = await getUser(userId);
      const client = await pool.connect();
      try {
        await writeAudit(client, actor, "create_user_profile", "admin_user", userId, null, {
          ...user,
          passwordSet: Boolean(body.temporaryPassword),
        });
      } finally {
        client.release();
      }

      return json(201, { ok: true, user });
    }

    if (event.httpMethod === "PUT") {
      const action = cleanText(event.queryStringParameters?.action, 80);

      if (action === "module-access") {
        const body = normalizeAccessBody(JSON.parse(event.body || "{}"));
        const userCheck = await pool.query(
          "SELECT username FROM admin_users WHERE username = $1 LIMIT 1",
          [body.username]
        );
        if (!userCheck.rows.length) {
          return json(404, { ok: false, error: "User not found" });
        }

        const before = await pool.query(
          "SELECT * FROM admin_module_access WHERE username = $1 ORDER BY module_key ASC",
          [body.username]
        );

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (const record of body.access) {
            await client.query(
              `INSERT INTO admin_module_access (
                 access_id,
                 username,
                 module_key,
                 can_view,
                 can_create,
                 can_edit,
                 can_delete,
                 updated_by
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (username, module_key)
               DO UPDATE SET
                 can_view = EXCLUDED.can_view,
                 can_create = EXCLUDED.can_create,
                 can_edit = EXCLUDED.can_edit,
                 can_delete = EXCLUDED.can_delete,
                 updated_at = now(),
                 updated_by = EXCLUDED.updated_by`,
              [
                crypto.randomUUID(),
                body.username,
                record.moduleKey,
                record.canView,
                record.canCreate,
                record.canEdit,
                record.canDelete,
                actor,
              ]
            );
          }

          const after = await client.query(
            "SELECT * FROM admin_module_access WHERE username = $1 ORDER BY module_key ASC",
            [body.username]
          );
          await writeAudit(
            client,
            actor,
            "update_module_access",
            "admin_module_access",
            body.username,
            before.rows,
            after.rows
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }

        return json(200, {
          ok: true,
          username: body.username,
          access: await listAccess(),
        });
      }

      const userId = cleanText(event.queryStringParameters?.id, 100);
      if (!userId) {
        return json(400, { ok: false, error: "User id is required" });
      }

      const body = normalizeUserBody(JSON.parse(event.body || "{}"), {
        requireUsername: false,
      });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const before = await getUser(userId, client);
        if (!before) {
          await client.query("ROLLBACK");
          return json(404, { ok: false, error: "User not found" });
        }

        const result = await client.query(
          `UPDATE admin_users
              SET display_name = $2,
                  email = $3,
                  role = $4,
                  status = $5,
                  must_reset_password = $6,
                  password_hash = CASE
                    WHEN $8::text IS NULL THEN password_hash
                    ELSE $8::text
                  END,
                  disabled_at = CASE
                    WHEN $5 = 'disabled' AND disabled_at IS NULL THEN now()
                    WHEN $5 = 'active' THEN NULL
                    ELSE disabled_at
                  END,
                  updated_at = now(),
                  updated_by = $7
            WHERE user_id = $1::uuid
            RETURNING user_id`,
          [
            userId,
            body.displayName || null,
            body.email || null,
            body.role,
            body.status,
            body.mustResetPassword,
            actor,
            body.temporaryPassword ? hashPassword(body.temporaryPassword) : null,
          ]
        );

        const user = result.rows.length ? await getUser(userId, client) : null;
        await writeAudit(client, actor, "update_user_profile", "admin_user", userId, before, {
          ...user,
          passwordUpdated: Boolean(body.temporaryPassword),
        });
        await client.query("COMMIT");
        return json(200, { ok: true, user });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    if (event.httpMethod === "DELETE") {
      const userId = cleanText(event.queryStringParameters?.id, 100);
      if (!userId) {
        return json(400, { ok: false, error: "User id is required" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const before = await getUser(userId, client);
        if (!before) {
          await client.query("ROLLBACK");
          return json(404, { ok: false, error: "User not found" });
        }

        await client.query(
          `UPDATE admin_users
              SET status = 'disabled',
                  disabled_at = COALESCE(disabled_at, now()),
                  updated_at = now(),
                  updated_by = $2
            WHERE user_id = $1::uuid`,
          [userId, actor]
        );

        const user = await getUser(userId, client);
        await writeAudit(client, actor, "disable_user_profile", "admin_user", userId, before, user);
        await client.query("COMMIT");
        return json(200, { ok: true, user });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    return json(405, { ok: false, error: "Method Not Allowed" });
  } catch (error) {
    console.error("admin-users function error:", error);
    if (event.httpMethod === "GET" && event.queryStringParameters?.["my-access"] === "1") {
      return json(200, {
        ok: true,
        modules: MODULES,
        access: [],
        hasConfiguredAccess: false,
        legacyFallback: true,
      });
    }
    if (error.code === "22P02") {
      return json(400, { ok: false, error: "Invalid user id" });
    }
    if (error.code === "23505") {
      return json(400, { ok: false, error: "Username already exists" });
    }
    return json(error.statusCode || 500, {
      ok: false,
      error:
        error.statusCode && error.statusCode < 500
          ? error.message
          : "Internal Server Error",
    });
  }
};
