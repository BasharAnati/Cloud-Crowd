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
const ACCOUNT_TYPES = new Set(["employee", "external", "client", "system"]);
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
const ANATI_SYSTEM_USER = { username: "Anati", displayName: "Anati", role: "admin" };
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

function normalizeAccountType(value) {
  const accountType = cleanText(value || "external", 40).toLowerCase();
  if (!ACCOUNT_TYPES.has(accountType)) {
    const error = new Error("Invalid accountType");
    error.statusCode = 400;
    throw error;
  }
  return accountType;
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
    accountType: normalizeAccountType(body?.accountType ?? body?.account_type),
    employeeId: cleanText(body?.employeeId ?? body?.employee_id, 100),
    restaurantId: cleanText(body?.restaurantId ?? body?.restaurant_id, 100),
    isSystemAccount: normalizeBoolean(body?.isSystemAccount ?? body?.is_system_account),
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
      ADD COLUMN IF NOT EXISTS password_hash TEXT,
      ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'external',
      ADD COLUMN IF NOT EXISTS employee_id UUID,
      ADD COLUMN IF NOT EXISTS restaurant_id UUID,
      ADD COLUMN IF NOT EXISTS is_system_account BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS linked_by TEXT;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'admin_users_account_type_check'
           AND conrelid = 'admin_users'::regclass
           AND pg_get_constraintdef(oid) LIKE '%external%'
      ) THEN
        ALTER TABLE admin_users
          DROP CONSTRAINT IF EXISTS admin_users_account_type_check;

        ALTER TABLE admin_users
          ADD CONSTRAINT admin_users_account_type_check
          CHECK (account_type IN ('employee', 'external', 'client', 'system')) NOT VALID;
      END IF;

      IF to_regclass('public.employees') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint
            WHERE conname = 'admin_users_employee_id_fkey'
              AND conrelid = 'admin_users'::regclass
         ) THEN
        ALTER TABLE admin_users
          ADD CONSTRAINT admin_users_employee_id_fkey
          FOREIGN KEY (employee_id) REFERENCES employees(employee_id) NOT VALID;
      END IF;

      IF to_regclass('public.restaurants') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
             FROM pg_constraint
            WHERE conname = 'admin_users_restaurant_id_fkey'
              AND conrelid = 'admin_users'::regclass
         ) THEN
        ALTER TABLE admin_users
          ADD CONSTRAINT admin_users_restaurant_id_fkey
          FOREIGN KEY (restaurant_id) REFERENCES restaurants(restaurant_id) NOT VALID;
      END IF;
    END $$;

    UPDATE admin_users
       SET account_type = 'system',
           employee_id = NULL,
           restaurant_id = NULL,
           is_system_account = true,
           linked_at = COALESCE(linked_at, now())
     WHERE lower(username) = 'anati';

    UPDATE admin_users
       SET account_type = 'external',
           employee_id = NULL,
           restaurant_id = NULL,
           is_system_account = false,
           linked_at = NULL,
           linked_by = NULL
     WHERE lower(username) <> 'anati'
       AND COALESCE(account_type, 'external') = 'employee'
       AND employee_id IS NULL;

    UPDATE admin_users
       SET account_type = 'external'
     WHERE account_type IS NULL;

    ALTER TABLE admin_users
      ALTER COLUMN account_type SET DEFAULT 'external',
      ALTER COLUMN account_type SET NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_module_access_username_module
      ON admin_module_access(username, module_key);

    CREATE INDEX IF NOT EXISTS idx_admin_users_username
      ON admin_users(username);

    CREATE INDEX IF NOT EXISTS idx_admin_users_status
      ON admin_users(status);

    CREATE INDEX IF NOT EXISTS idx_admin_users_account_type
      ON admin_users(account_type);

    CREATE INDEX IF NOT EXISTS idx_admin_users_employee_id
      ON admin_users(employee_id);

    CREATE INDEX IF NOT EXISTS idx_admin_users_restaurant_id
      ON admin_users(restaurant_id);

    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at
      ON admin_audit_logs(created_at DESC);
  `);
}

async function tableExists(tableName) {
  const result = await pool.query("SELECT to_regclass($1) AS table_name", [`public.${tableName}`]);
  return Boolean(result.rows[0]?.table_name);
}

function mapUser(row) {
  const isSystemAccount = row.is_system_account === true || cleanText(row.username, 80).toLowerCase() === "anati";
  const rawAccountType = cleanText(row.account_type, 40).toLowerCase();
  const accountType = isSystemAccount
    ? "system"
    : rawAccountType || "external";
  const hasEmployeeLink = Boolean(row.employee_id && row.employee_name_snapshot);
  const hasRestaurantLink = Boolean(row.restaurant_id && row.restaurant_name_snapshot);
  const linkStatus = accountType === "system" || isSystemAccount
    ? "system"
    : accountType === "external"
      ? "external"
      : hasEmployeeLink || hasRestaurantLink
      ? "linked"
      : "unlinked";

  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name || "",
    email: row.email || "",
    role: row.role || "agent",
    status: row.status || "active",
    accountType,
    employeeId: row.employee_id || "",
    employeeNameSnapshot: row.employee_name_snapshot || "",
    restaurantId: row.restaurant_id || "",
    restaurantNameSnapshot: row.restaurant_name_snapshot || "",
    isSystemAccount,
    linkStatus,
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

async function ensureAnatiSystemUser(actor) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT * FROM admin_users WHERE lower(username) = 'anati' LIMIT 1"
    );

    let seeded = false;
    if (!existing.rows.length) {
      const userId = crypto.randomUUID();
      await client.query(
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
         ) VALUES ($1, $2, $3, $4, 'active', 'system', true, now(), $5, $5, $5)`,
        [userId, ANATI_SYSTEM_USER.username, ANATI_SYSTEM_USER.displayName, ANATI_SYSTEM_USER.role, actor]
      );
      await writeAudit(client, actor, "seed_system_user", "admin_user", userId, null, {
        username: ANATI_SYSTEM_USER.username,
        role: ANATI_SYSTEM_USER.role,
        status: "active",
        accountType: "system",
      });
      seeded = true;
    } else {
      await client.query(
        `UPDATE admin_users
            SET role = 'admin',
                status = 'active',
                account_type = 'system',
                employee_id = NULL,
                restaurant_id = NULL,
                is_system_account = true,
                linked_at = COALESCE(linked_at, now()),
                linked_by = COALESCE(linked_by, $1),
                disabled_at = NULL,
                updated_at = now(),
                updated_by = $1
          WHERE lower(username) = 'anati'`,
        [actor]
      );
    }

    await client.query("COMMIT");
    return seeded;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listUsers() {
  const hasEmployees = await tableExists("employees");
  const hasRestaurants = await tableExists("restaurants");
  const employeeJoin = hasEmployees
    ? "LEFT JOIN employees e ON e.employee_id = u.employee_id"
    : "";
  const restaurantJoin = hasRestaurants
    ? "LEFT JOIN restaurants r ON r.restaurant_id = u.restaurant_id"
    : "";
  const employeeName = hasEmployees ? "e.full_name" : "NULL::text";
  const restaurantName = hasRestaurants ? "r.brand_name" : "NULL::text";

  const result = await pool.query(
    `SELECT
        u.*,
        ${employeeName} AS employee_name_snapshot,
        ${restaurantName} AS restaurant_name_snapshot
       FROM admin_users u
       ${employeeJoin}
       ${restaurantJoin}
      ORDER BY
        CASE u.status WHEN 'active' THEN 0 ELSE 1 END,
        CASE u.role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,
        u.username ASC`
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
  const hasEmployees = await tableExists("employees");
  const hasRestaurants = await tableExists("restaurants");
  const employeeJoin = hasEmployees
    ? "LEFT JOIN employees e ON e.employee_id = u.employee_id"
    : "";
  const restaurantJoin = hasRestaurants
    ? "LEFT JOIN restaurants r ON r.restaurant_id = u.restaurant_id"
    : "";
  const employeeName = hasEmployees ? "e.full_name" : "NULL::text";
  const restaurantName = hasRestaurants ? "r.brand_name" : "NULL::text";

  const result = await client.query(
    `SELECT
        u.*,
        ${employeeName} AS employee_name_snapshot,
        ${restaurantName} AS restaurant_name_snapshot
       FROM admin_users u
       ${employeeJoin}
       ${restaurantJoin}
      WHERE u.user_id = $1::uuid`,
    [userId]
  );
  return result.rows.length ? mapUser(result.rows[0]) : null;
}

async function validateEmployeeLink(employeeId) {
  if (!employeeId) return null;
  if (!(await tableExists("employees"))) {
    const error = new Error("Employee profiles are not initialized");
    error.statusCode = 400;
    throw error;
  }

  const result = await pool.query(
    `SELECT employee_id, full_name
       FROM employees
      WHERE employee_id = $1::uuid
        AND status = 'active'
      LIMIT 1`,
    [employeeId]
  );
  if (!result.rows.length) {
    const error = new Error("Active employee is required");
    error.statusCode = 400;
    throw error;
  }
  return result.rows[0];
}

async function validateRestaurantLink(restaurantId) {
  if (!restaurantId) return null;
  if (!(await tableExists("restaurants"))) {
    const error = new Error("Client profiles are not initialized");
    error.statusCode = 400;
    throw error;
  }

  const result = await pool.query(
    `SELECT restaurant_id, brand_name
       FROM restaurants
      WHERE restaurant_id = $1::uuid
        AND status = 'active'
      LIMIT 1`,
    [restaurantId]
  );
  if (!result.rows.length) {
    const error = new Error("Active client profile is required");
    error.statusCode = 400;
    throw error;
  }
  return result.rows[0];
}

async function prepareUserLink(body, options = {}) {
  if (body.accountType === "system") {
    if (!body.isSystemAccount) {
      const error = new Error("System accounts require explicit confirmation");
      error.statusCode = 400;
      throw error;
    }
    return {
      accountType: "system",
      employeeId: null,
      restaurantId: null,
      isSystemAccount: true,
      linkedAtExpression: "COALESCE(linked_at, now())",
      displayNameFallback: "",
    };
  }

  if (body.accountType === "client") {
    if (options.requireLink && !body.restaurantId) {
      const error = new Error("Client accounts require a linked client profile");
      error.statusCode = 400;
      throw error;
    }
    const restaurant = body.restaurantId ? await validateRestaurantLink(body.restaurantId) : null;
    return {
      accountType: "client",
      employeeId: null,
      restaurantId: restaurant?.restaurant_id || null,
      isSystemAccount: false,
      linkedAtExpression: restaurant ? "now()" : "NULL",
      displayNameFallback: restaurant?.brand_name || "",
    };
  }

  if (body.accountType === "external") {
    return {
      accountType: "external",
      employeeId: null,
      restaurantId: null,
      isSystemAccount: false,
      linkedAtExpression: "NULL",
      displayNameFallback: "",
    };
  }

  if (!body.employeeId) {
    const error = new Error("Employee accounts require a linked active employee");
    error.statusCode = 400;
    throw error;
  }
  const employee = body.employeeId ? await validateEmployeeLink(body.employeeId) : null;
  return {
    accountType: "employee",
    employeeId: employee?.employee_id || null,
    restaurantId: null,
    isSystemAccount: false,
    linkedAtExpression: employee ? "now()" : "NULL",
    displayNameFallback: employee?.full_name || "",
  };
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

      const seeded = await ensureAnatiSystemUser(actor);
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
      const link = await prepareUserLink(body, { requireLink: true });
      const userId = crypto.randomUUID();

      await pool.query(
        `INSERT INTO admin_users (
           user_id,
           username,
           display_name,
           email,
           role,
           status,
           account_type,
           employee_id,
           restaurant_id,
           is_system_account,
           linked_at,
           linked_by,
           must_reset_password,
           password_hash,
           created_by,
           updated_by
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8::uuid, $9::uuid, $10,
           ${link.linkedAtExpression}, $11, $12, $13, $11, $11
         )`,
        [
          userId,
          body.username,
          body.displayName || link.displayNameFallback || null,
          body.email || null,
          body.role,
          body.status,
          link.accountType,
          link.employeeId,
          link.restaurantId,
          link.isSystemAccount,
          actor,
          body.mustResetPassword,
          body.temporaryPassword ? hashPassword(body.temporaryPassword) : null,
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

        const isAnati = before.username.toLowerCase() === "anati";
        const link = isAnati
          ? {
              accountType: "system",
              employeeId: null,
              restaurantId: null,
              isSystemAccount: true,
              linkedAtExpression: "COALESCE(linked_at, now())",
              displayNameFallback: "Anati",
            }
          : await prepareUserLink(body, { requireLink: false });
        const nextRole = isAnati ? "admin" : body.role;
        const nextStatus = isAnati ? "active" : body.status;
        const nextDisplayName = body.displayName || link.displayNameFallback || null;

        const result = await client.query(
          `UPDATE admin_users
              SET display_name = $2,
                  email = $3,
                  role = $4,
                  status = $5,
                  account_type = $6,
                  employee_id = $7::uuid,
                  restaurant_id = $8::uuid,
                  is_system_account = $9,
                  linked_at = ${link.linkedAtExpression},
                  linked_by = CASE
                    WHEN $7::uuid IS NOT NULL OR $8::uuid IS NOT NULL OR $9 = true THEN $10
                    ELSE NULL
                  END,
                  must_reset_password = $11,
                  password_hash = CASE
                    WHEN $12::text IS NULL THEN password_hash
                    ELSE $12::text
                  END,
                  disabled_at = CASE
                    WHEN $5 = 'disabled' AND disabled_at IS NULL THEN now()
                    WHEN $5 = 'active' THEN NULL
                    ELSE disabled_at
                  END,
                  updated_at = now(),
                  updated_by = $10
            WHERE user_id = $1::uuid
            RETURNING user_id`,
          [
            userId,
            nextDisplayName,
            body.email || null,
            nextRole,
            nextStatus,
            link.accountType,
            link.employeeId,
            link.restaurantId,
            link.isSystemAccount,
            actor,
            body.mustResetPassword,
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
        if (before.username.toLowerCase() === "anati") {
          await client.query("ROLLBACK");
          return json(400, { ok: false, error: "Anati cannot be disabled" });
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
