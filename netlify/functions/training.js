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
const ASSIGNMENT_STATUSES = new Set(["Assigned", "Unassigned"]);
const TRAINING_STATUSES = new Set([
  "Trained",
  "Not Trained",
  "Coaching Needed",
  "No training or assignment needed",
]);

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

function normalizeTrainingBody(body) {
  const assignmentStatus = requiredText(
    body?.assignmentStatus,
    "assignmentStatus",
    80
  );
  const trainingStatus = requiredText(
    body?.trainingStatus,
    "trainingStatus",
    120
  );

  if (!ASSIGNMENT_STATUSES.has(assignmentStatus)) {
    const error = new Error("Invalid assignmentStatus");
    error.statusCode = 400;
    throw error;
  }
  if (!TRAINING_STATUSES.has(trainingStatus)) {
    const error = new Error("Invalid trainingStatus");
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
    restaurantId: cleanText(body?.restaurantId, 100),
    restaurantNameSnapshot: cleanText(body?.restaurantNameSnapshot, 200),
    restaurantName: requiredText(
      body?.restaurantNameSnapshot || body?.restaurantName,
      "restaurantName",
      200
    ),
    assignmentStatus,
    trainingStatus,
    trainingDate: cleanText(body?.trainingDate, 60),
    updatedByName: cleanText(body?.updatedByName, 200),
    notes: cleanText(body?.notes, 5000),
  };
}

async function ensureTrainingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_training (
      training_id UUID PRIMARY KEY,
      employee_id UUID NOT NULL REFERENCES employees(employee_id),
      employee_name_snapshot TEXT NOT NULL,
      restaurant_id UUID,
      restaurant_name_snapshot TEXT,
      restaurant_name TEXT NOT NULL,
      assignment_status TEXT NOT NULL
        CHECK (assignment_status IN ('Assigned', 'Unassigned')),
      training_status TEXT NOT NULL
        CHECK (training_status IN ('Trained', 'Not Trained', 'Coaching Needed', 'No training or assignment needed')),
      training_date TEXT,
      updated_by_name TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by TEXT,
      updated_by TEXT,
      deleted_at TIMESTAMPTZ,
      deleted_by TEXT
    );

    ALTER TABLE agent_training
      ADD COLUMN IF NOT EXISTS restaurant_id UUID;
    ALTER TABLE agent_training
      ADD COLUMN IF NOT EXISTS restaurant_name_snapshot TEXT;

    CREATE INDEX IF NOT EXISTS idx_agent_training_employee_id
      ON agent_training(employee_id)
      WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_agent_training_restaurant_id
      ON agent_training(restaurant_id)
      WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_agent_training_restaurant_name_snapshot
      ON agent_training(restaurant_name_snapshot)
      WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_agent_training_restaurant
      ON agent_training(restaurant_name)
      WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_agent_training_assignment_status
      ON agent_training(assignment_status)
      WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_agent_training_training_status
      ON agent_training(training_status)
      WHERE deleted_at IS NULL;
  `);
}

function mapTraining(row) {
  return {
    trainingId: row.training_id,
    employeeId: row.employee_id,
    employeeNameSnapshot: row.employee_name_snapshot,
    restaurantId: row.restaurant_id || "",
    restaurantNameSnapshot: row.restaurant_name_snapshot || "",
    restaurantName:
      row.restaurant_name_snapshot || row.restaurant_name || "",
    assignmentStatus: row.assignment_status,
    trainingStatus: row.training_status,
    trainingDate: row.training_date || "",
    updatedByName: row.updated_by_name || "",
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by || "",
    updatedBy: row.updated_by || "",
  };
}

async function getTraining(trainingId) {
  const result = await pool.query(
    `SELECT *
       FROM agent_training
      WHERE training_id = $1::uuid
        AND deleted_at IS NULL`,
    [trainingId]
  );
  return result.rows.length ? mapTraining(result.rows[0]) : null;
}

async function listTraining(query = {}) {
  const conditions = ["deleted_at IS NULL"];
  const params = [];

  function addCondition(sql, value) {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  }

  const employeeId = cleanText(query.employeeId, 100);
  const restaurantId = cleanText(query.restaurantId, 100);
  const restaurant = cleanText(query.restaurant, 200);
  const assignmentStatus = cleanText(query.assignmentStatus, 80);
  const trainingStatus = cleanText(query.trainingStatus, 120);

  if (employeeId) addCondition("employee_id = ?::uuid", employeeId);
  if (restaurantId) addCondition("restaurant_id = ?::uuid", restaurantId);
  if (restaurant) {
    addCondition(
      "COALESCE(NULLIF(restaurant_name_snapshot, ''), restaurant_name) = ?",
      restaurant
    );
  }
  if (assignmentStatus) {
    if (!ASSIGNMENT_STATUSES.has(assignmentStatus)) {
      const error = new Error("Invalid assignmentStatus");
      error.statusCode = 400;
      throw error;
    }
    addCondition("assignment_status = ?", assignmentStatus);
  }
  if (trainingStatus) {
    if (!TRAINING_STATUSES.has(trainingStatus)) {
      const error = new Error("Invalid trainingStatus");
      error.statusCode = 400;
      throw error;
    }
    addCondition("training_status = ?", trainingStatus);
  }

  const result = await pool.query(
    `SELECT *
       FROM agent_training
      WHERE ${conditions.join(" AND ")}
      ORDER BY
        COALESCE(NULLIF(training_date, ''), updated_at::text) DESC,
        updated_at DESC`,
    params
  );
  return result.rows.map(mapTraining);
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
    await requireModuleAccess(event, "agent_training", moduleAction);
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
    await ensureTrainingTable();

    if (event.httpMethod === "GET") {
      const training = await listTraining(event.queryStringParameters || {});
      return json(200, { ok: true, count: training.length, training });
    }

    if (event.httpMethod === "POST") {
      const training = normalizeTrainingBody(JSON.parse(event.body || "{}"));
      const trainingId = crypto.randomUUID();
      const username = cleanText(session.username || "unknown", 200);

      await pool.query(
        `INSERT INTO agent_training (
           training_id,
           employee_id,
           employee_name_snapshot,
           restaurant_id,
           restaurant_name_snapshot,
           restaurant_name,
           assignment_status,
           training_status,
           training_date,
           updated_by_name,
           notes,
           created_by,
           updated_by
         ) VALUES (
           $1, $2::uuid, $3, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12, $12
         )`,
        [
          trainingId,
          training.employeeId,
          training.employeeNameSnapshot,
          training.restaurantId || null,
          training.restaurantNameSnapshot || training.restaurantName,
          training.restaurantName,
          training.assignmentStatus,
          training.trainingStatus,
          training.trainingDate || null,
          training.updatedByName || null,
          training.notes || null,
          username,
        ]
      );

      return json(201, {
        ok: true,
        training: await getTraining(trainingId),
      });
    }

    if (event.httpMethod === "PUT") {
      const trainingId = cleanText(event.queryStringParameters?.id, 100);
      if (!trainingId) {
        return json(400, { ok: false, error: "Training id is required" });
      }

      const training = normalizeTrainingBody(JSON.parse(event.body || "{}"));
      const username = cleanText(session.username || "unknown", 200);
      const result = await pool.query(
        `UPDATE agent_training
            SET employee_id = $2::uuid,
                employee_name_snapshot = $3,
                restaurant_id = $4::uuid,
                restaurant_name_snapshot = $5,
                restaurant_name = $6,
                assignment_status = $7,
                training_status = $8,
                training_date = $9,
                updated_by_name = $10,
                notes = $11,
                updated_at = now(),
                updated_by = $12
          WHERE training_id = $1::uuid
            AND deleted_at IS NULL
          RETURNING training_id`,
        [
          trainingId,
          training.employeeId,
          training.employeeNameSnapshot,
          training.restaurantId || null,
          training.restaurantNameSnapshot || training.restaurantName,
          training.restaurantName,
          training.assignmentStatus,
          training.trainingStatus,
          training.trainingDate || null,
          training.updatedByName || null,
          training.notes || null,
          username,
        ]
      );

      return result.rows.length
        ? json(200, {
            ok: true,
            training: await getTraining(trainingId),
          })
        : json(404, { ok: false, error: "Training assignment not found" });
    }

    if (event.httpMethod === "DELETE") {
      const trainingId = cleanText(event.queryStringParameters?.id, 100);
      if (!trainingId) {
        return json(400, { ok: false, error: "Training id is required" });
      }

      const username = cleanText(session.username || "unknown", 200);
      const result = await pool.query(
        `UPDATE agent_training
            SET deleted_at = now(),
                deleted_by = $2,
                updated_at = now(),
                updated_by = $2
          WHERE training_id = $1::uuid
            AND deleted_at IS NULL
          RETURNING training_id`,
        [trainingId, username]
      );

      return result.rows.length
        ? json(200, { ok: true })
        : json(404, { ok: false, error: "Training assignment not found" });
    }

    return json(405, { ok: false, error: "Method Not Allowed" });
  } catch (error) {
    console.error("training function error:", error);
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
