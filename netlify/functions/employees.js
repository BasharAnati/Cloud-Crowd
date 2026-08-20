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
const WRITE_ROLES = new Set(["admin", "manager"]);

function json(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

async function requireWriteSession(event) {
  const session = await requireValidSession(event);
  if (!WRITE_ROLES.has(String(session.role || "").toLowerCase())) {
    const error = new Error("Admin or manager role required");
    error.statusCode = 403;
    throw error;
  }
  return session;
}

function getEmployeeId(event) {
  return String(event.queryStringParameters?.id || "").trim();
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizePhoneNumbers(value) {
  if (!Array.isArray(value)) return [];

  const phoneNumbers = value
    .map((phone) => ({
      label: cleanText(phone?.label, 80),
      phoneNumber: cleanText(phone?.phoneNumber, 60),
      isPrimary: phone?.isPrimary === true,
    }))
    .filter((phone) => phone.label || phone.phoneNumber);

  if (phoneNumbers.filter((phone) => phone.isPrimary).length > 1) {
    const error = new Error("Only one phone number may be primary");
    error.statusCode = 400;
    throw error;
  }

  return phoneNumbers;
}

function normalizeEmergencyContacts(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((contact) => ({
      contactName: cleanText(contact?.contactName, 160),
      relationship: cleanText(contact?.relationship, 100),
      phoneNumber: cleanText(contact?.phoneNumber, 60),
    }))
    .filter(
      (contact) =>
        contact.contactName || contact.relationship || contact.phoneNumber
    );
}

function normalizeRestaurants(value) {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .map((restaurant) => cleanText(restaurant, 160))
        .filter(Boolean)
    ),
  ];
}

function normalizeEmployeeBody(body) {
  const fullName = cleanText(body?.fullName, 200);
  if (!fullName) {
    const error = new Error("fullName is required");
    error.statusCode = 400;
    throw error;
  }

  return {
    fullName,
    notes: cleanText(body?.notes, 5000),
    phoneNumbers: normalizePhoneNumbers(body?.phoneNumbers),
    emergencyContacts: normalizeEmergencyContacts(body?.emergencyContacts),
    assignedRestaurants: normalizeRestaurants(body?.assignedRestaurants),
  };
}

async function ensureEmployeeTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      employee_id UUID PRIMARY KEY,
      full_name TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at TIMESTAMPTZ,
      created_by TEXT,
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS employee_phone_numbers (
      id UUID PRIMARY KEY,
      employee_id UUID NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
      label TEXT,
      phone_number TEXT,
      is_primary BOOLEAN NOT NULL DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS employee_emergency_contacts (
      id UUID PRIMARY KEY,
      employee_id UUID NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
      contact_name TEXT,
      relationship TEXT,
      phone_number TEXT
    );

    CREATE TABLE IF NOT EXISTS employee_restaurants (
      id UUID PRIMARY KEY,
      employee_id UUID NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
      restaurant_name TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_employees_status
      ON employees(status);
    CREATE INDEX IF NOT EXISTS idx_employee_phone_numbers_employee_id
      ON employee_phone_numbers(employee_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_phone_numbers_one_primary
      ON employee_phone_numbers(employee_id)
      WHERE is_primary = true;
    CREATE INDEX IF NOT EXISTS idx_employee_emergency_contacts_employee_id
      ON employee_emergency_contacts(employee_id);
    CREATE INDEX IF NOT EXISTS idx_employee_restaurants_employee_id
      ON employee_restaurants(employee_id);
  `);
}

async function insertChildRecords(client, employeeId, employee) {
  for (const phone of employee.phoneNumbers) {
    await client.query(
      `INSERT INTO employee_phone_numbers
         (id, employee_id, label, phone_number, is_primary)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        crypto.randomUUID(),
        employeeId,
        phone.label || null,
        phone.phoneNumber || null,
        phone.isPrimary,
      ]
    );
  }

  for (const contact of employee.emergencyContacts) {
    await client.query(
      `INSERT INTO employee_emergency_contacts
         (id, employee_id, contact_name, relationship, phone_number)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        crypto.randomUUID(),
        employeeId,
        contact.contactName || null,
        contact.relationship || null,
        contact.phoneNumber || null,
      ]
    );
  }

  for (const restaurantName of employee.assignedRestaurants) {
    await client.query(
      `INSERT INTO employee_restaurants
         (id, employee_id, restaurant_name)
       VALUES ($1, $2, $3)`,
      [crypto.randomUUID(), employeeId, restaurantName]
    );
  }
}

async function getEmployeeProfile(employeeId) {
  const employeeResult = await pool.query(
    `SELECT employee_id, full_name, notes, status, created_at, updated_at
       FROM employees
      WHERE employee_id = $1::uuid`,
    [employeeId]
  );

  if (!employeeResult.rows.length) return null;

  const [phonesResult, contactsResult, restaurantsResult] = await Promise.all([
    pool.query(
      `SELECT label, phone_number, is_primary
         FROM employee_phone_numbers
        WHERE employee_id = $1::uuid
        ORDER BY is_primary DESC, label ASC, id ASC`,
      [employeeId]
    ),
    pool.query(
      `SELECT contact_name, relationship, phone_number
         FROM employee_emergency_contacts
        WHERE employee_id = $1::uuid
        ORDER BY contact_name ASC, id ASC`,
      [employeeId]
    ),
    pool.query(
      `SELECT restaurant_name
         FROM employee_restaurants
        WHERE employee_id = $1::uuid
        ORDER BY restaurant_name ASC`,
      [employeeId]
    ),
  ]);

  const employee = employeeResult.rows[0];
  return {
    employeeId: employee.employee_id,
    fullName: employee.full_name,
    notes: employee.notes || "",
    status: employee.status,
    phoneNumbers: phonesResult.rows.map((phone) => ({
      label: phone.label || "",
      phoneNumber: phone.phone_number || "",
      isPrimary: phone.is_primary === true,
    })),
    emergencyContacts: contactsResult.rows.map((contact) => ({
      contactName: contact.contact_name || "",
      relationship: contact.relationship || "",
      phoneNumber: contact.phone_number || "",
    })),
    assignedRestaurants: restaurantsResult.rows.map(
      (restaurant) => restaurant.restaurant_name
    ),
    createdAt: employee.created_at,
    updatedAt: employee.updated_at,
  };
}

async function listEmployees(statusFilter) {
  const params = [];
  let whereClause = "WHERE e.status = 'active'";

  if (statusFilter === "all") {
    whereClause = "";
  } else if (statusFilter === "archived" || statusFilter === "inactive") {
    whereClause = "WHERE e.status = 'inactive'";
  }

  const result = await pool.query(
    `SELECT
       e.employee_id,
       e.full_name,
       e.status,
       (
         SELECT p.phone_number
           FROM employee_phone_numbers p
          WHERE p.employee_id = e.employee_id
          ORDER BY p.is_primary DESC, p.id ASC
          LIMIT 1
       ) AS primary_phone,
       COALESCE(
         (
           SELECT json_agg(r.restaurant_name ORDER BY r.restaurant_name)
             FROM employee_restaurants r
            WHERE r.employee_id = e.employee_id
         ),
         '[]'::json
       ) AS assigned_restaurants
     FROM employees e
     ${whereClause}
     ORDER BY e.full_name ASC`,
    params
  );

  return result.rows.map((employee) => ({
    employeeId: employee.employee_id,
    fullName: employee.full_name,
    primaryPhone: employee.primary_phone || "",
    assignedRestaurants: employee.assigned_restaurants || [],
    status: employee.status,
  }));
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  let session;
  try {
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
    session =
      event.httpMethod === "GET"
        ? await requireValidSession(event)
        : await requireWriteSession(event);
    await requireModuleAccess(event, "employee_profiles", moduleAction);
  } catch (authError) {
    return json(authError.statusCode || 500, {
      ok: false,
      error: authError.message,
    });
  }

  if (!CONNECTION_STRING) {
    return json(500, { ok: false, error: "Database is not configured" });
  }

  try {
    await ensureEmployeeTables();

    if (event.httpMethod === "GET") {
      const employeeId = getEmployeeId(event);
      if (employeeId) {
        const employee = await getEmployeeProfile(employeeId);
        return employee
          ? json(200, { ok: true, employee })
          : json(404, { ok: false, error: "Employee not found" });
      }

      const status = cleanText(
        event.queryStringParameters?.status || "active",
        20
      ).toLowerCase();
      const employees = await listEmployees(status);
      return json(200, { ok: true, count: employees.length, employees });
    }

    if (event.httpMethod === "POST") {
      const employee = normalizeEmployeeBody(JSON.parse(event.body || "{}"));
      const employeeId = crypto.randomUUID();
      const username = cleanText(session.username || "unknown", 200);
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO employees
             (employee_id, full_name, notes, status, created_by, updated_by)
           VALUES ($1, $2, $3, 'active', $4, $4)`,
          [employeeId, employee.fullName, employee.notes || null, username]
        );
        await insertChildRecords(client, employeeId, employee);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      return json(201, {
        ok: true,
        employee: await getEmployeeProfile(employeeId),
      });
    }

    if (event.httpMethod === "PUT") {
      const employeeId = getEmployeeId(event);
      if (!employeeId) {
        return json(400, { ok: false, error: "Employee id is required" });
      }

      const employee = normalizeEmployeeBody(JSON.parse(event.body || "{}"));
      const username = cleanText(session.username || "unknown", 200);
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        const updateResult = await client.query(
          `UPDATE employees
              SET full_name = $2,
                  notes = $3,
                  updated_at = now(),
                  updated_by = $4
            WHERE employee_id = $1::uuid
            RETURNING employee_id`,
          [employeeId, employee.fullName, employee.notes || null, username]
        );

        if (!updateResult.rows.length) {
          await client.query("ROLLBACK");
          return json(404, { ok: false, error: "Employee not found" });
        }

        await client.query(
          "DELETE FROM employee_phone_numbers WHERE employee_id = $1::uuid",
          [employeeId]
        );
        await client.query(
          "DELETE FROM employee_emergency_contacts WHERE employee_id = $1::uuid",
          [employeeId]
        );
        await client.query(
          "DELETE FROM employee_restaurants WHERE employee_id = $1::uuid",
          [employeeId]
        );
        await insertChildRecords(client, employeeId, employee);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      return json(200, {
        ok: true,
        employee: await getEmployeeProfile(employeeId),
      });
    }

    if (event.httpMethod === "DELETE") {
      const employeeId = getEmployeeId(event);
      if (!employeeId) {
        return json(400, { ok: false, error: "Employee id is required" });
      }

      const username = cleanText(session.username || "unknown", 200);
      const result = await pool.query(
        `UPDATE employees
            SET status = 'inactive',
                archived_at = COALESCE(archived_at, now()),
                updated_at = now(),
                updated_by = $2
          WHERE employee_id = $1::uuid
          RETURNING employee_id`,
        [employeeId, username]
      );

      return result.rows.length
        ? json(200, { ok: true })
        : json(404, { ok: false, error: "Employee not found" });
    }

    return json(405, { ok: false, error: "Method Not Allowed" });
  } catch (error) {
    console.error("employees function error:", error);
    if (error.code === "22P02") {
      return json(400, { ok: false, error: "Invalid employee id" });
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
