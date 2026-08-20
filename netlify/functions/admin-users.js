const crypto = require("crypto");
const { Pool } = require("pg");
const { requireValidSession, requireAnatiSession, requireModuleAccess } = require("./_auth");

const CONNECTION_STRING =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL;

let pool = new Pool({ connectionString: CONNECTION_STRING });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };

const ROLES = new Set(["admin", "manager", "agent"]);
const STATUSES = new Set(["active", "disabled"]);
const ACCOUNT_TYPES = new Set(["employee", "external", "system"]);
const MODULES = [
  { moduleKey: "dashboard", moduleName: "Dashboard", route: "dashboard.html" },
  { moduleKey: "cctv", moduleName: "CCTV", route: "cctv.html" },
  { moduleKey: "customer_experience", moduleName: "Customer Experience", route: "ce.html" },
  { moduleKey: "daily_complaints", moduleName: "Daily Complaints", route: "complaints.html" },
  { moduleKey: "complimentary_orders", moduleName: "Complimentary Orders", route: "free-orders.html" },
  { moduleKey: "free_order_requests", moduleName: "Free Order Requests", route: "free-order-requests.html" },
  { moduleKey: "free_order_share", moduleName: "Free Order Share", route: "free-order-share.html" },
  { moduleKey: "call_queue", moduleName: "Call Queue", route: "call-queue.html", administrable: false },
  { moduleKey: "attendance", moduleName: "Attendance", route: "attendance.html" },
  { moduleKey: "weekly_quality", moduleName: "Weekly Quality", route: "weekly-quality.html" },
  { moduleKey: "employee_profiles", moduleName: "Employee Profiles", route: "employee-profiles.html" },
  { moduleKey: "employee_deductions", moduleName: "Employee Deductions", route: "employee-deductions.html" },
  { moduleKey: "agent_training", moduleName: "Agent Training", route: "agent-training.html" },
  { moduleKey: "client_profiles", moduleName: "Client Profiles", route: "client-profiles.html" },
  { moduleKey: "restaurant_ratings", moduleName: "Restaurant Ratings", route: "restaurant-ratings.html" },
  { moduleKey: "anati_admin", moduleName: "Anati Admin Center", route: "anati-admin.html", administrable: false },
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
const RESERVED_MODULE_KEYS = new Set(["call_queue", "anati_admin"]);
const RESERVED_STORED_MODULE_KEYS = Object.freeze([
  "call_queue", "call-queue", "anati_admin", "anati-admin-center",
]);
function isReservedModuleKey(value) {
  return RESERVED_MODULE_KEYS.has(normalizeModuleKey(value));
}
const ADMINISTRABLE_MODULES = MODULES.filter((module) => module.administrable !== false && !isReservedModuleKey(module.moduleKey));
const ADMINISTRABLE_MODULE_KEYS = new Set(ADMINISTRABLE_MODULES.map((module) => module.moduleKey));
const ANATI_SYSTEM_USER = { username: "Anati", displayName: "Anati", role: "admin" };
const MIN_TEMP_PASSWORD_LENGTH = 12;

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

function normalizeAccountType(value, options = {}) {
  const accountType = cleanText(value || "external", 40).toLowerCase();
  if (!ACCOUNT_TYPES.has(accountType) && !(options.allowExistingClient && accountType === "client")) {
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

function requiredBoolean(value, field) {
  if (typeof value !== "boolean") {
    const error = new Error(`${field} must be a boolean`);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function requiredVersion(value, field) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    const error = new Error(`${field} is required`);
    error.statusCode = 400;
    throw error;
  }
  return version;
}

function normalizeModuleKey(value) {
  const moduleKey = cleanText(value, 120).toLowerCase();
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
  if (!password.trim()) {
    const error = new Error("temporaryPassword cannot be blank");
    error.statusCode = 400;
    throw error;
  }
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
    accountType: normalizeAccountType(body?.accountType ?? body?.account_type, options),
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

  const seen = new Set();
  const access = records.map((record) => {
      const moduleKey = normalizeModuleKey(requiredText(
        record?.moduleKey || record?.module_key,
        "moduleKey",
        120
      ));
      if (isReservedModuleKey(moduleKey) || !ADMINISTRABLE_MODULE_KEYS.has(moduleKey)) {
        const error = new Error(`Invalid moduleKey: ${moduleKey}`);
        error.statusCode = 400;
        throw error;
      }
      if (seen.has(moduleKey)) {
        const error = new Error(`Duplicate moduleKey: ${moduleKey}`);
        error.statusCode = 400;
        throw error;
      }
      seen.add(moduleKey);
      return {
        moduleKey,
        canView: requiredBoolean(record?.canView ?? record?.can_view, `${moduleKey}.canView`),
        canCreate: requiredBoolean(record?.canCreate ?? record?.can_create, `${moduleKey}.canCreate`),
        canEdit: requiredBoolean(record?.canEdit ?? record?.can_edit, `${moduleKey}.canEdit`),
        canDelete: requiredBoolean(record?.canDelete ?? record?.can_delete, `${moduleKey}.canDelete`),
      };
    });
  if (seen.size !== ADMINISTRABLE_MODULES.length) {
    const error = new Error("A complete administrable module access set is required");
    error.statusCode = 400;
    throw error;
  }

  return {
    username,
    expectedAccessVersion: requiredVersion(body?.expectedAccessVersion, "expectedAccessVersion"),
    access,
  };
}

function assertPreservedAccountType(before, nextAccountType) {
  if (before && (before.accountType === "system" || before.accountType === "client") && nextAccountType !== before.accountType) {
    const error = new Error(`${before.accountType} account type cannot be changed`);
    error.statusCode = 400;
    throw error;
  }
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
      session_version BIGINT NOT NULL DEFAULT 1,
      row_version BIGINT NOT NULL DEFAULT 1,
      access_version BIGINT NOT NULL DEFAULT 1,
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
      ADD COLUMN IF NOT EXISTS linked_by TEXT,
      ADD COLUMN IF NOT EXISTS session_version BIGINT NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS row_version BIGINT NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS access_version BIGINT NOT NULL DEFAULT 1;

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

      IF to_regclass('employees') IS NOT NULL
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

      IF to_regclass('restaurants') IS NOT NULL
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
       SET account_type = 'external'
     WHERE account_type IS NULL;

    ALTER TABLE admin_users
      ALTER COLUMN account_type SET DEFAULT 'external',
      ALTER COLUMN account_type SET NOT NULL;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM admin_module_access
         GROUP BY username, module_key
        HAVING count(*) > 1
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_module_access_username_module
          ON admin_module_access(username, module_key);
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS idx_admin_users_username
      ON admin_users(username);

    CREATE INDEX IF NOT EXISTS idx_admin_users_username_lower
      ON admin_users(lower(username));

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

async function tableExists(tableName, client = pool) {
  const result = await client.query("SELECT to_regclass($1) AS table_name", [tableName]);
  return Boolean(result.rows[0]?.table_name);
}

async function assertNoIdentityCollisions() {
  const result = await pool.query(
    `SELECT lower(username) AS canonical_username
       FROM admin_users
      GROUP BY lower(username)
     HAVING count(*) > 1
      LIMIT 1`
  );
  if (result.rows.length) {
    const error = new Error("Case-colliding user identities require administrator resolution");
    error.statusCode = 409;
    throw error;
  }
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
    version: Number(row.row_version || 1),
    accessVersion: Number(row.access_version || 1),
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
            SET session_version = session_version + CASE
                  WHEN role <> 'admin' OR status <> 'active' THEN 1 ELSE 0 END,
                row_version = row_version + CASE
                  WHEN role <> 'admin' OR status <> 'active' THEN 1 ELSE 0 END,
                role = 'admin',
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
      WHERE lower(btrim(module_key)) <> ALL($1::text[])
      ORDER BY username ASC, module_key ASC`,
    [RESERVED_STORED_MODULE_KEYS]
  );
  return result.rows.map(mapAccess);
}

async function listAccessForUser(username) {
  const result = await pool.query(
    `SELECT *
       FROM admin_module_access
      WHERE lower(username) = lower($1)
        AND lower(btrim(module_key)) <> ALL($2::text[])
      ORDER BY module_key ASC`,
    [username, RESERVED_STORED_MODULE_KEYS]
  );
  return result.rows.map(mapAccess);
}

async function getUser(userId, client = pool) {
  const hasEmployees = await tableExists("employees", client);
  const hasRestaurants = await tableExists("restaurants", client);
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

async function validateEmployeeLink(employeeId, client) {
  if (!employeeId) return null;
  if (!(await tableExists("employees", client))) {
    const error = new Error("Employee profiles are not initialized");
    error.statusCode = 400;
    throw error;
  }

  const result = await client.query(
    `SELECT employee_id, full_name
       FROM employees
      WHERE employee_id = $1::uuid
        AND status = 'active'
      LIMIT 1
      FOR UPDATE`,
    [employeeId]
  );
  if (!result.rows.length) {
    const error = new Error("Active employee is required");
    error.statusCode = 400;
    throw error;
  }
  return result.rows[0];
}

async function validateRestaurantLink(restaurantId, client) {
  if (!restaurantId) return null;
  if (!(await tableExists("restaurants", client))) {
    const error = new Error("Client profiles are not initialized");
    error.statusCode = 400;
    throw error;
  }

  const result = await client.query(
    `SELECT restaurant_id, brand_name
       FROM restaurants
      WHERE restaurant_id = $1::uuid
        AND status = 'active'
      LIMIT 1
      FOR UPDATE`,
    [restaurantId]
  );
  if (!result.rows.length) {
    const error = new Error("Active client profile is required");
    error.statusCode = 400;
    throw error;
  }
  return result.rows[0];
}

async function prepareUserLink(body, options = {}, client = pool) {
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
    const restaurant = body.restaurantId ? await validateRestaurantLink(body.restaurantId, client) : null;
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
  const employee = body.employeeId ? await validateEmployeeLink(body.employeeId, client) : null;
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
  return [...ADMINISTRABLE_MODULES, MODULES.find((module) => module.moduleKey === "anati_admin")].map((module) => ({
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
    session = await (
      event.httpMethod === "GET" && event.queryStringParameters?.["my-access"] === "1"
        ? requireValidSession(event)
        : requireAnatiSession(event)
    );
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
        modules: ADMINISTRABLE_MODULES,
        access: [],
        hasConfiguredAccess: false,
        legacyFallback: false,
        unavailable: true,
      });
    }
    return json(500, { ok: false, error: "Database is not configured" });
  }

  const actor = cleanText(session.username || "unknown", 80);

  try {
    await ensureTables();
    await assertNoIdentityCollisions();

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
          modules: ADMINISTRABLE_MODULES,
          access,
          hasConfiguredAccess: isAnatiAdmin || access.length > 0,
          legacyFallback: false,
          unavailable: false,
        });
      }

      if (event.queryStringParameters?.modules === "1") {
        return json(200, {
          ok: true,
          modules: ADMINISTRABLE_MODULES,
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
      if (body.accountType === "system") {
        return json(400, { ok: false, error: "New system accounts are not supported" });
      }
      const userId = crypto.randomUUID();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext(lower($1)))", [body.username]);
        const collision = await client.query(
          "SELECT username FROM admin_users WHERE lower(username) = lower($1) LIMIT 2",
          [body.username]
        );
        if (collision.rows.length) {
          const error = new Error("Username already exists");
          error.statusCode = 409;
          throw error;
        }
        const link = await prepareUserLink(body, { requireLink: true }, client);
        await client.query(
          `INSERT INTO admin_users (
             user_id, username, display_name, email, role, status, account_type,
             employee_id, restaurant_id, is_system_account, linked_at, linked_by,
             must_reset_password, password_hash, created_by, updated_by
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8::uuid, $9::uuid, $10,
             ${link.linkedAtExpression}, $11, $12, $13, $11, $11
           )`,
          [
            userId, body.username, body.displayName || link.displayNameFallback || null,
            body.email || null, body.role, body.status, link.accountType, link.employeeId,
            link.restaurantId, link.isSystemAccount, actor, Boolean(body.temporaryPassword),
            body.temporaryPassword ? hashPassword(body.temporaryPassword) : null,
          ]
        );
        const user = await getUser(userId, client);
        await writeAudit(client, actor, "create_user_profile", "admin_user", userId, null, {
          ...user,
          passwordSet: Boolean(body.temporaryPassword),
        });
        await client.query("COMMIT");
        return json(201, { ok: true, user });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    if (event.httpMethod === "PUT") {
      const action = cleanText(event.queryStringParameters?.action, 80);

      if (action === "module-access") {
        const body = normalizeAccessBody(JSON.parse(event.body || "{}"));
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const userCheck = await client.query(
            `SELECT user_id, username, access_version
               FROM admin_users
              WHERE lower(username) = lower($1)
              ORDER BY username ASC
              LIMIT 2
              FOR UPDATE`,
            [body.username]
          );
          if (!userCheck.rows.length) {
            await client.query("ROLLBACK");
            return json(404, { ok: false, error: "User not found" });
          }
          if (userCheck.rows.length > 1) {
            await client.query("ROLLBACK");
            return json(409, { ok: false, error: "Username identity conflict" });
          }
          const target = userCheck.rows[0];
          if (Number(target.access_version) !== body.expectedAccessVersion) {
            await client.query("ROLLBACK");
            return json(409, { ok: false, error: "Module access changed. Reload before saving." });
          }
          const before = await client.query(
            `SELECT * FROM admin_module_access
              WHERE lower(username) = lower($1)
                AND lower(btrim(module_key)) <> ALL($2::text[])
              ORDER BY module_key ASC`,
            [target.username, RESERVED_STORED_MODULE_KEYS]
          );
          await client.query(
            `DELETE FROM admin_module_access
              WHERE lower(username) = lower($1)
                AND lower(btrim(module_key)) <> ALL($2::text[])`,
            [target.username, RESERVED_STORED_MODULE_KEYS]
          );
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
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                crypto.randomUUID(),
                target.username,
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
            `SELECT * FROM admin_module_access
              WHERE username = $1
                AND lower(btrim(module_key)) <> ALL($2::text[])
              ORDER BY module_key ASC`,
            [target.username, RESERVED_STORED_MODULE_KEYS]
          );
          const versionResult = await client.query(
            `UPDATE admin_users
                SET access_version = access_version + 1,
                    updated_at = now(),
                    updated_by = $2
              WHERE user_id = $1::uuid
                AND access_version = $3
              RETURNING access_version`,
            [target.user_id, actor, body.expectedAccessVersion]
          );
          if (versionResult.rows.length !== 1) throw new Error("Module access version conflict");
          await writeAudit(
            client,
            actor,
            "update_module_access",
            "admin_module_access",
            target.username,
            before.rows,
            after.rows
          );
          await client.query("COMMIT");
          return json(200, {
            ok: true,
            username: target.username,
            accessVersion: Number(versionResult.rows[0].access_version),
            access: after.rows.map(mapAccess),
          });
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }

      const userId = cleanText(event.queryStringParameters?.id, 100);
      if (!userId) {
        return json(400, { ok: false, error: "User id is required" });
      }

      const requestBody = JSON.parse(event.body || "{}");
      const body = normalizeUserBody(requestBody, {
        requireUsername: false,
        allowExistingClient: true,
      });
      const expectedVersion = requiredVersion(requestBody.expectedVersion, "expectedVersion");

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const before = await getUser(userId, client);
        if (!before) {
          await client.query("ROLLBACK");
          return json(404, { ok: false, error: "User not found" });
        }
        if (before.version !== expectedVersion) {
          await client.query("ROLLBACK");
          return json(409, { ok: false, error: "User changed. Reload before saving." });
        }

        const isAnati = before.username.toLowerCase() === "anati";
        if (!isAnati) {
          try {
            assertPreservedAccountType(before, body.accountType);
          } catch (error) {
            await client.query("ROLLBACK");
            return json(error.statusCode, { ok: false, error: error.message });
          }
        }
        if (!isAnati && body.accountType === "system" && before.accountType !== "system") {
          await client.query("ROLLBACK");
          return json(400, { ok: false, error: "New system accounts are not supported" });
        }
        if (body.accountType === "client" && before.accountType !== "client") {
          await client.query("ROLLBACK");
          return json(400, { ok: false, error: "Client login is not supported" });
        }
        const link = isAnati
          ? {
              accountType: "system",
              employeeId: null,
              restaurantId: null,
              isSystemAccount: true,
              linkedAtExpression: "COALESCE(linked_at, now())",
              displayNameFallback: "Anati",
            }
          : before.accountType === "client" && body.accountType === "client"
            ? {
                accountType: "client",
                employeeId: null,
                restaurantId: before.restaurantId || null,
                isSystemAccount: false,
                linkedAtExpression: "linked_at",
                displayNameFallback: before.restaurantNameSnapshot || "",
              }
          : before.accountType === "system" && body.accountType === "system"
            ? {
                accountType: "system",
                employeeId: null,
                restaurantId: null,
                isSystemAccount: true,
                linkedAtExpression: "COALESCE(linked_at, now())",
                displayNameFallback: before.displayName || "",
              }
          : await prepareUserLink(body, { requireLink: false }, client);
        const nextRole = isAnati ? "admin" : body.role;
        const nextStatus = isAnati ? "active" : body.status;
        const nextDisplayName = body.displayName || link.displayNameFallback || null;
        const authorityChanged = before.role !== nextRole || before.status !== nextStatus || Boolean(body.temporaryPassword);
        const mustResetPassword = body.temporaryPassword ? true : before.mustResetPassword;

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
                  session_version = session_version + CASE WHEN $13 THEN 1 ELSE 0 END,
                  row_version = row_version + 1,
                  updated_at = now(),
                  updated_by = $10
            WHERE user_id = $1::uuid
              AND row_version = $14
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
            mustResetPassword,
            body.temporaryPassword ? hashPassword(body.temporaryPassword) : null,
            authorityChanged,
            expectedVersion,
          ]
        );

        if (!result.rows.length) {
          await client.query("ROLLBACK");
          return json(409, { ok: false, error: "User changed. Reload before saving." });
        }
        const user = await getUser(userId, client);
        const auditAction = before.status === "disabled" && user.status === "active"
          ? "reactivate_user_profile"
          : before.status === "active" && user.status === "disabled"
            ? "disable_user_profile"
            : body.temporaryPassword
              ? "replace_temporary_password"
              : "update_user_profile";
        await writeAudit(client, actor, auditAction, "admin_user", userId, before, {
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
      const expectedVersion = requiredVersion(event.queryStringParameters?.version, "version");

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
        if (before.version !== expectedVersion) {
          await client.query("ROLLBACK");
          return json(409, { ok: false, error: "User changed. Reload before disabling." });
        }
        if (before.status === "disabled") {
          await client.query("ROLLBACK");
          return json(409, { ok: false, error: "User is already disabled" });
        }

        const result = await client.query(
          `UPDATE admin_users
              SET status = 'disabled',
                  disabled_at = COALESCE(disabled_at, now()),
                  session_version = session_version + 1,
                  row_version = row_version + 1,
                  updated_at = now(),
                  updated_by = $2
            WHERE user_id = $1::uuid
              AND row_version = $3
            RETURNING user_id`,
          [userId, actor, expectedVersion]
        );
        if (!result.rows.length) {
          await client.query("ROLLBACK");
          return json(409, { ok: false, error: "User changed. Reload before disabling." });
        }

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
        modules: ADMINISTRABLE_MODULES,
        access: [],
        hasConfiguredAccess: false,
        legacyFallback: false,
        unavailable: true,
      });
    }
    if (error.code === "22P02") {
      return json(400, { ok: false, error: "Invalid user id" });
    }
    if (error.code === "23505") {
      return json(409, { ok: false, error: "Username already exists" });
    }
    if (error instanceof SyntaxError) {
      return json(400, { ok: false, error: "Invalid request" });
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

module.exports._test = {
  normalizeUserBody,
  normalizeAccessBody,
  normalizeTemporaryPassword,
  mapUser,
  administrableModules: ADMINISTRABLE_MODULES,
  reservedStoredModuleKeys: RESERVED_STORED_MODULE_KEYS,
  isReservedModuleKey,
  assertPreservedAccountType,
  prepareUserLink,
  ensureTables,
  setPool(nextPool) { pool = nextPool; },
};
