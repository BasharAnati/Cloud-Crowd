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
const ATTENDANCE_STATUSES = new Set(["On Time", "Left Early", "Late Logout"]);

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

function normalizeDate(value, field = "date") {
  const date = requiredText(value, field, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const error = new Error(`${field} must use YYYY-MM-DD format`);
    error.statusCode = 400;
    throw error;
  }
  return date;
}

function normalizeOptionalDate(value, field) {
  const date = cleanText(value, 20);
  if (!date) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const error = new Error(`${field} must use YYYY-MM-DD format`);
    error.statusCode = 400;
    throw error;
  }
  return date;
}

function normalizeStatus(value, field, fallback = "") {
  const status = fallback
    ? cleanText(value || fallback, 40)
    : requiredText(value, field, 40);
  if (!ATTENDANCE_STATUSES.has(status)) {
    const error = new Error(`Invalid ${field}`);
    error.statusCode = 400;
    throw error;
  }
  return status;
}

function normalizeExtraTime(value) {
  if (value === true) return true;
  if (value === false) return false;
  const text = cleanText(value, 20).toLowerCase();
  return text === "yes" || text === "true" || text === "1";
}

function parseExtraMinutes(value) {
  const text = cleanText(value, 80).toLowerCase();
  if (!text) return null;

  const hhmm = text.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    return Number(hhmm[1]) * 60 + Number(hhmm[2]);
  }

  const decimalHours = text.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)$/);
  if (decimalHours) {
    return Math.round(Number(decimalHours[1]) * 60);
  }

  const minutes = text.match(/^(\d+)\s*(m|min|mins|minute|minutes)$/);
  if (minutes) {
    return Number(minutes[1]);
  }

  const numberOnly = text.match(/^\d+$/);
  if (numberOnly) {
    return Number(text);
  }

  return null;
}

function normalizeTime(value, field) {
  const time = cleanText(value, 20);
  if (!time) return "";
  if (!/^\d{2}:\d{2}$/.test(time)) {
    const error = new Error(`${field} must use HH:MM format`);
    error.statusCode = 400;
    throw error;
  }
  return time;
}

function normalizeAttendanceBody(body, options = {}) {
  const extraTime = normalizeExtraTime(body?.extraTime);
  const extraDuration = extraTime ? cleanText(body?.extraDuration, 120) : "";

  return {
    legacyId: cleanText(body?.legacyId || body?.id, 200),
    employeeId: requiredText(body?.employeeId, "employeeId", 100),
    employeeNameSnapshot: requiredText(
      body?.employeeNameSnapshot,
      "employeeNameSnapshot",
      200
    ),
    date: normalizeDate(body?.date),
    loginStatus: normalizeStatus(body?.loginStatus, "loginStatus"),
    logoutStatus: normalizeStatus(body?.logoutStatus, "logoutStatus", "On Time"),
    extraTime,
    extraDuration,
    extraMinutes: parseExtraMinutes(extraDuration),
    note: cleanText(body?.note, 5000),
    customNote: cleanText(body?.customNote, 5000),
    fromTime: normalizeTime(body?.fromTime, "fromTime"),
    toTime: normalizeTime(body?.toTime, "toTime"),
    filledBy: cleanText(body?.filledBy, 200) || cleanText(options.username, 200),
  };
}

async function ensureAttendanceTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance_records (
      attendance_id UUID PRIMARY KEY,
      legacy_id TEXT,
      employee_id UUID REFERENCES employees(employee_id),
      employee_name_snapshot TEXT,
      record_date DATE,
      login_status TEXT,
      logout_status TEXT,
      extra_time BOOLEAN,
      extra_duration TEXT,
      extra_minutes INTEGER,
      note TEXT,
      custom_note TEXT,
      from_time TIME,
      to_time TIME,
      filled_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      created_by TEXT,
      updated_by TEXT,
      deleted_at TIMESTAMPTZ,
      deleted_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_records_employee_id
      ON attendance_records(employee_id)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_attendance_records_record_date
      ON attendance_records(record_date)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_attendance_records_employee_date
      ON attendance_records(employee_id, record_date DESC)
      WHERE deleted_at IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_records_legacy_id
      ON attendance_records(legacy_id)
      WHERE legacy_id IS NOT NULL AND deleted_at IS NULL;
  `);
}

function formatDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || "");
}

function formatTime(value) {
  if (!value) return "";
  return String(value).slice(0, 5);
}

function mapAttendance(row) {
  return {
    attendanceId: row.attendance_id,
    id: row.legacy_id || row.attendance_id,
    legacyId: row.legacy_id || "",
    employeeId: row.employee_id || "",
    employeeNameSnapshot: row.employee_name_snapshot || "",
    date: formatDate(row.record_date),
    loginStatus: row.login_status || "",
    logoutStatus: row.logout_status || "",
    extraTime: row.extra_time ? "Yes" : "No",
    extraDuration: row.extra_duration || "",
    extraMinutes:
      row.extra_minutes === null || row.extra_minutes === undefined
        ? null
        : Number(row.extra_minutes),
    note: row.note || "",
    customNote: row.custom_note || "",
    fromTime: formatTime(row.from_time),
    toTime: formatTime(row.to_time),
    filledBy: row.filled_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by || "",
    updatedBy: row.updated_by || "",
  };
}

async function getAttendance(attendanceId) {
  const result = await pool.query(
    `SELECT *
       FROM attendance_records
      WHERE attendance_id = $1::uuid
        AND deleted_at IS NULL`,
    [attendanceId]
  );
  return result.rows.length ? mapAttendance(result.rows[0]) : null;
}

async function listAttendance(query = {}) {
  const conditions = ["deleted_at IS NULL"];
  const params = [];

  function addCondition(sql, value) {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  }

  const id = cleanText(query.id, 100);
  const employeeId = cleanText(query.employeeId, 100);
  const date = normalizeOptionalDate(query.date, "date");
  const from = normalizeOptionalDate(query.from, "from");
  const to = normalizeOptionalDate(query.to, "to");
  const search = cleanText(query.search, 200);

  if (id) addCondition("attendance_id = ?::uuid", id);
  if (employeeId) addCondition("employee_id = ?::uuid", employeeId);
  if (date) addCondition("record_date = ?::date", date);
  if (from) addCondition("record_date >= ?::date", from);
  if (to) addCondition("record_date <= ?::date", to);
  if (search) {
    const firstParam = params.length + 1;
    params.push(search, search, search);
    conditions.push(
      `(employee_name_snapshot ILIKE '%' || $${firstParam} || '%'
        OR employee_id::text ILIKE '%' || $${firstParam + 1} || '%'
        OR filled_by ILIKE '%' || $${firstParam + 2} || '%')`
    );
  }

  const result = await pool.query(
    `SELECT *
       FROM attendance_records
      WHERE ${conditions.join(" AND ")}
      ORDER BY record_date DESC NULLS LAST, created_at DESC`,
    params
  );
  return result.rows.map(mapAttendance);
}

async function insertAttendance(attendance, username) {
  const attendanceId = crypto.randomUUID();

  await pool.query(
    `INSERT INTO attendance_records (
       attendance_id,
       legacy_id,
       employee_id,
       employee_name_snapshot,
       record_date,
       login_status,
       logout_status,
       extra_time,
       extra_duration,
       extra_minutes,
       note,
       custom_note,
       from_time,
       to_time,
       filled_by,
       created_by,
       updated_by
     ) VALUES (
       $1, $2, $3::uuid, $4, $5::date, $6, $7, $8, $9, $10, $11, $12,
       $13::time, $14::time, $15, $16, $16
     )`,
    [
      attendanceId,
      attendance.legacyId || null,
      attendance.employeeId,
      attendance.employeeNameSnapshot,
      attendance.date,
      attendance.loginStatus,
      attendance.logoutStatus,
      attendance.extraTime,
      attendance.extraDuration || null,
      attendance.extraMinutes,
      attendance.note || null,
      attendance.customNote || null,
      attendance.fromTime || null,
      attendance.toTime || null,
      attendance.filledBy || username,
      username,
    ]
  );

  return attendanceId;
}

async function importAttendanceRecords(records, username) {
  const summary = {
    inserted: 0,
    skippedDuplicates: 0,
    failed: 0,
    errors: [],
  };

  for (const record of records) {
    const legacyId = cleanText(record?.id || record?.legacyId, 200);
    if (!legacyId) {
      summary.failed += 1;
      summary.errors.push({ id: "", error: "legacy id is required" });
      continue;
    }

    try {
      const duplicate = await pool.query(
        `SELECT attendance_id
           FROM attendance_records
          WHERE legacy_id = $1
            AND deleted_at IS NULL
          LIMIT 1`,
        [legacyId]
      );
      if (duplicate.rows.length) {
        summary.skippedDuplicates += 1;
        continue;
      }

      const attendance = normalizeAttendanceBody(
        { ...record, legacyId },
        { username }
      );
      await insertAttendance(attendance, username);
      summary.inserted += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({
        id: legacyId,
        error:
          error.statusCode && error.statusCode < 500
            ? error.message
            : "Import failed",
      });
    }
  }

  return summary;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  let session;
  try {
    const action = cleanText(event.queryStringParameters?.action, 80);
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
      event.httpMethod === "DELETE" ||
      (event.httpMethod === "POST" && action === "bulk-import")
        ? await requireWriteSession(event)
        : await requireValidSession(event);
    await requireModuleAccess(event, "attendance", moduleAction);
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
    await ensureAttendanceTable();

    if (event.httpMethod === "GET") {
      const attendance = await listAttendance(event.queryStringParameters || {});
      return json(200, { ok: true, count: attendance.length, attendance });
    }

    if (event.httpMethod === "POST") {
      const action = cleanText(event.queryStringParameters?.action, 80);
      const body = JSON.parse(event.body || "{}");
      const username = cleanText(session.username || "unknown", 200);

      if (action === "bulk-import") {
        const records = Array.isArray(body) ? body : body.records;
        if (!Array.isArray(records)) {
          return json(400, { ok: false, error: "records array is required" });
        }

        const result = await importAttendanceRecords(records, username);
        return json(200, { ok: true, ...result });
      }

      const attendance = normalizeAttendanceBody(body, { username });
      const attendanceId = await insertAttendance(attendance, username);
      return json(201, {
        ok: true,
        attendance: await getAttendance(attendanceId),
      });
    }

    if (event.httpMethod === "PUT") {
      const attendanceId = cleanText(event.queryStringParameters?.id, 100);
      if (!attendanceId) {
        return json(400, { ok: false, error: "Attendance id is required" });
      }

      const username = cleanText(session.username || "unknown", 200);
      const attendance = normalizeAttendanceBody(JSON.parse(event.body || "{}"), {
        username,
      });
      const result = await pool.query(
        `UPDATE attendance_records
            SET legacy_id = $2,
                employee_id = $3::uuid,
                employee_name_snapshot = $4,
                record_date = $5::date,
                login_status = $6,
                logout_status = $7,
                extra_time = $8,
                extra_duration = $9,
                extra_minutes = $10,
                note = $11,
                custom_note = $12,
                from_time = $13::time,
                to_time = $14::time,
                filled_by = $15,
                updated_at = now(),
                updated_by = $16
          WHERE attendance_id = $1::uuid
            AND deleted_at IS NULL
          RETURNING attendance_id`,
        [
          attendanceId,
          attendance.legacyId || null,
          attendance.employeeId,
          attendance.employeeNameSnapshot,
          attendance.date,
          attendance.loginStatus,
          attendance.logoutStatus,
          attendance.extraTime,
          attendance.extraDuration || null,
          attendance.extraMinutes,
          attendance.note || null,
          attendance.customNote || null,
          attendance.fromTime || null,
          attendance.toTime || null,
          attendance.filledBy || username,
          username,
        ]
      );

      return result.rows.length
        ? json(200, { ok: true, attendance: await getAttendance(attendanceId) })
        : json(404, { ok: false, error: "Attendance record not found" });
    }

    if (event.httpMethod === "DELETE") {
      const attendanceId = cleanText(event.queryStringParameters?.id, 100);
      if (!attendanceId) {
        return json(400, { ok: false, error: "Attendance id is required" });
      }

      const username = cleanText(session.username || "unknown", 200);
      const result = await pool.query(
        `UPDATE attendance_records
            SET deleted_at = now(),
                deleted_by = $2,
                updated_at = now(),
                updated_by = $2
          WHERE attendance_id = $1::uuid
            AND deleted_at IS NULL
          RETURNING attendance_id`,
        [attendanceId, username]
      );

      return result.rows.length
        ? json(200, { ok: true })
        : json(404, { ok: false, error: "Attendance record not found" });
    }

    return json(405, { ok: false, error: "Method Not Allowed" });
  } catch (error) {
    console.error("attendance function error:", error);
    if (error.code === "22P02") {
      return json(400, { ok: false, error: "Invalid id" });
    }
    if (error.code === "23503") {
      return json(400, { ok: false, error: "Employee not found" });
    }
    if (error.code === "23505") {
      return json(400, {
        ok: false,
        error: "Attendance record already exists for this legacy id",
      });
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
