const crypto = require("crypto");
const { Pool } = require("pg");
const { requireValidSession } = require("./_auth");

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
const DISCOUNT_PERCENTAGE = 10;
const DEDUCTION_TYPES = new Set([
  "Personal Order",
  "Order Mistake",
  "Health Insurance",
  "Delivery Cost",
  "Other",
]);

function json(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

function requireWriteSession(event) {
  const session = requireValidSession(event);
  if (!WRITE_ROLES.has(String(session.role || "").toLowerCase())) {
    const error = new Error("Admin or manager role required");
    error.statusCode = 403;
    throw error;
  }
  return session;
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

function parseAmount(value) {
  if (value === "" || value === null || value === undefined) {
    const error = new Error("originalAmount is required");
    error.statusCode = 400;
    throw error;
  }

  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    const error = new Error("originalAmount must be numeric");
    error.statusCode = 400;
    throw error;
  }
  if (amount < 0) {
    const error = new Error("originalAmount cannot be negative");
    error.statusCode = 400;
    throw error;
  }

  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function normalizeDeductionBody(body) {
  const deductionType = requiredText(
    body?.deductionType,
    "deductionType",
    100
  );
  if (!DEDUCTION_TYPES.has(deductionType)) {
    const error = new Error("Invalid deductionType");
    error.statusCode = 400;
    throw error;
  }

  const originalAmount = parseAmount(body?.originalAmount);
  const applyEmployeeDiscount = body?.applyEmployeeDiscount === true;
  const discountValue = applyEmployeeDiscount
    ? Math.round(
        (originalAmount * (DISCOUNT_PERCENTAGE / 100) + Number.EPSILON) * 100
      ) / 100
    : 0;
  const finalDeductionAmount =
    Math.round((originalAmount - discountValue + Number.EPSILON) * 100) / 100;

  if (finalDeductionAmount < 0) {
    const error = new Error("finalDeductionAmount cannot be negative");
    error.statusCode = 400;
    throw error;
  }

  return {
    employeeId: requiredText(body?.employeeId, "employeeId", 100),
    employeeNameSnapshot: requiredText(
      body?.employeeNameSnapshot,
      "employeeNameSnapshot",
      200
    ),
    deductionType,
    restaurantName: cleanText(body?.restaurantName, 200),
    orderNumber: cleanText(body?.orderNumber, 120),
    orderDateTime: cleanText(body?.orderDateTime, 40),
    originalAmount,
    applyEmployeeDiscount,
    discountPercentage: DISCOUNT_PERCENTAGE,
    discountValue,
    finalDeductionAmount,
    approvedBy: cleanText(body?.approvedBy, 200),
    notes: cleanText(body?.notes, 5000),
  };
}

async function ensureDeductionsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employee_deductions (
      deduction_id UUID PRIMARY KEY,
      employee_id UUID NOT NULL REFERENCES employees(employee_id),
      employee_name_snapshot TEXT NOT NULL,
      deduction_type TEXT NOT NULL,
      restaurant_name TEXT,
      order_number TEXT,
      order_date_time TEXT,
      original_amount NUMERIC(12,2) NOT NULL,
      apply_employee_discount BOOLEAN NOT NULL DEFAULT false,
      discount_percentage NUMERIC(5,2) NOT NULL DEFAULT 10,
      discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      final_deduction_amount NUMERIC(12,2) NOT NULL,
      approved_by TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by TEXT,
      updated_by TEXT,
      deleted_at TIMESTAMPTZ,
      deleted_by TEXT,
      CHECK (original_amount >= 0),
      CHECK (discount_percentage = 10),
      CHECK (discount_value >= 0),
      CHECK (final_deduction_amount >= 0)
    );

    CREATE INDEX IF NOT EXISTS idx_employee_deductions_employee_id
      ON employee_deductions(employee_id)
      WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_employee_deductions_type
      ON employee_deductions(deduction_type)
      WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_employee_deductions_restaurant
      ON employee_deductions(restaurant_name)
      WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_employee_deductions_order_date_time
      ON employee_deductions(order_date_time)
      WHERE deleted_at IS NULL;
  `);
}

function mapDeduction(row) {
  return {
    deductionId: row.deduction_id,
    employeeId: row.employee_id,
    employeeNameSnapshot: row.employee_name_snapshot,
    deductionType: row.deduction_type,
    restaurantName: row.restaurant_name || "",
    orderNumber: row.order_number || "",
    orderDateTime: row.order_date_time || "",
    originalAmount: Number(row.original_amount),
    applyEmployeeDiscount: row.apply_employee_discount === true,
    discountPercentage: Number(row.discount_percentage),
    discountValue: Number(row.discount_value),
    finalDeductionAmount: Number(row.final_deduction_amount),
    approvedBy: row.approved_by || "",
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by || "",
    updatedBy: row.updated_by || "",
  };
}

async function getDeduction(deductionId) {
  const result = await pool.query(
    `SELECT *
       FROM employee_deductions
      WHERE deduction_id = $1::uuid
        AND deleted_at IS NULL`,
    [deductionId]
  );
  return result.rows.length ? mapDeduction(result.rows[0]) : null;
}

async function listDeductions(query = {}) {
  const conditions = ["deleted_at IS NULL"];
  const params = [];

  function addCondition(sql, value) {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  }

  const employeeId = cleanText(query.employeeId, 100);
  const month = cleanText(query.month, 7);
  const restaurant = cleanText(query.restaurant, 200);
  const deductionType = cleanText(query.deductionType, 100);

  if (employeeId) addCondition("employee_id = ?::uuid", employeeId);
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      const error = new Error("month must use YYYY-MM format");
      error.statusCode = 400;
      throw error;
    }
    addCondition("LEFT(order_date_time, 7) = ?", month);
  }
  if (restaurant) addCondition("restaurant_name = ?", restaurant);
  if (deductionType) addCondition("deduction_type = ?", deductionType);

  const result = await pool.query(
    `SELECT *
       FROM employee_deductions
      WHERE ${conditions.join(" AND ")}
      ORDER BY
        COALESCE(NULLIF(order_date_time, ''), created_at::text) DESC,
        created_at DESC`,
    params
  );
  return result.rows.map(mapDeduction);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  let session;
  try {
    session =
      event.httpMethod === "GET"
        ? requireValidSession(event)
        : requireWriteSession(event);
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
    await ensureDeductionsTable();

    if (event.httpMethod === "GET") {
      const deductions = await listDeductions(event.queryStringParameters || {});
      return json(200, { ok: true, count: deductions.length, deductions });
    }

    if (event.httpMethod === "POST") {
      const deduction = normalizeDeductionBody(JSON.parse(event.body || "{}"));
      const deductionId = crypto.randomUUID();
      const username = cleanText(session.username || "unknown", 200);

      await pool.query(
        `INSERT INTO employee_deductions (
           deduction_id,
           employee_id,
           employee_name_snapshot,
           deduction_type,
           restaurant_name,
           order_number,
           order_date_time,
           original_amount,
           apply_employee_discount,
           discount_percentage,
           discount_value,
           final_deduction_amount,
           approved_by,
           notes,
           created_by,
           updated_by
         ) VALUES (
           $1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15
         )`,
        [
          deductionId,
          deduction.employeeId,
          deduction.employeeNameSnapshot,
          deduction.deductionType,
          deduction.restaurantName || null,
          deduction.orderNumber || null,
          deduction.orderDateTime || null,
          deduction.originalAmount,
          deduction.applyEmployeeDiscount,
          deduction.discountPercentage,
          deduction.discountValue,
          deduction.finalDeductionAmount,
          deduction.approvedBy || null,
          deduction.notes || null,
          username,
        ]
      );

      return json(201, {
        ok: true,
        deduction: await getDeduction(deductionId),
      });
    }

    if (event.httpMethod === "PUT") {
      const deductionId = cleanText(event.queryStringParameters?.id, 100);
      if (!deductionId) {
        return json(400, { ok: false, error: "Deduction id is required" });
      }

      const deduction = normalizeDeductionBody(JSON.parse(event.body || "{}"));
      const username = cleanText(session.username || "unknown", 200);
      const result = await pool.query(
        `UPDATE employee_deductions
            SET employee_id = $2::uuid,
                employee_name_snapshot = $3,
                deduction_type = $4,
                restaurant_name = $5,
                order_number = $6,
                order_date_time = $7,
                original_amount = $8,
                apply_employee_discount = $9,
                discount_percentage = $10,
                discount_value = $11,
                final_deduction_amount = $12,
                approved_by = $13,
                notes = $14,
                updated_at = now(),
                updated_by = $15
          WHERE deduction_id = $1::uuid
            AND deleted_at IS NULL
          RETURNING deduction_id`,
        [
          deductionId,
          deduction.employeeId,
          deduction.employeeNameSnapshot,
          deduction.deductionType,
          deduction.restaurantName || null,
          deduction.orderNumber || null,
          deduction.orderDateTime || null,
          deduction.originalAmount,
          deduction.applyEmployeeDiscount,
          deduction.discountPercentage,
          deduction.discountValue,
          deduction.finalDeductionAmount,
          deduction.approvedBy || null,
          deduction.notes || null,
          username,
        ]
      );

      return result.rows.length
        ? json(200, {
            ok: true,
            deduction: await getDeduction(deductionId),
          })
        : json(404, { ok: false, error: "Deduction not found" });
    }

    if (event.httpMethod === "DELETE") {
      const deductionId = cleanText(event.queryStringParameters?.id, 100);
      if (!deductionId) {
        return json(400, { ok: false, error: "Deduction id is required" });
      }

      const username = cleanText(session.username || "unknown", 200);
      const result = await pool.query(
        `UPDATE employee_deductions
            SET deleted_at = now(),
                deleted_by = $2,
                updated_at = now(),
                updated_by = $2
          WHERE deduction_id = $1::uuid
            AND deleted_at IS NULL
          RETURNING deduction_id`,
        [deductionId, username]
      );

      return result.rows.length
        ? json(200, { ok: true })
        : json(404, { ok: false, error: "Deduction not found" });
    }

    return json(405, { ok: false, error: "Method Not Allowed" });
  } catch (error) {
    console.error("deductions function error:", error);
    if (error.code === "22P02") {
      return json(400, { ok: false, error: "Invalid id" });
    }
    if (error.code === "23503") {
      return json(400, { ok: false, error: "Employee not found" });
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
