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
const SCORE_VALUES = new Set([0, 3, 5, 7, 10]);
const SCORE_FIELDS = [
  "greetings",
  "knowledge",
  "upselling",
  "closure",
  "repeatingOrders",
  "phoneEtiquette",
  "clarity",
  "environment",
  "equipment",
  "aat",
];

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

function normalizeCallDateTime(value) {
  const text = requiredText(value, "callDateTime", 60);
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    const error = new Error("callDateTime must be a valid date/time");
    error.statusCode = 400;
    throw error;
  }
  return text;
}

function parseOptionalInteger(value, field) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    const error = new Error(`${field} must be a non-negative integer`);
    error.statusCode = 400;
    throw error;
  }
  return number;
}

function normalizeScores(value) {
  const scores = value && typeof value === "object" ? value : {};
  const normalized = {};

  for (const field of SCORE_FIELDS) {
    if (!(field in scores)) {
      const error = new Error(`scores.${field} is required`);
      error.statusCode = 400;
      throw error;
    }

    const score = Number(scores[field]);
    if (!Number.isInteger(score) || !SCORE_VALUES.has(score)) {
      const error = new Error("Score values must be only 0, 3, 5, 7, or 10");
      error.statusCode = 400;
      throw error;
    }
    normalized[field] = score;
  }

  return normalized;
}

function normalizeQualityBody(body, options = {}) {
  const scores = normalizeScores(body?.scores);
  const totalScore = Number(body?.totalScore);
  const calculatedTotal = SCORE_FIELDS.reduce(
    (sum, field) => sum + scores[field],
    0
  );

  if (!Number.isInteger(totalScore)) {
    const error = new Error("totalScore must be an integer");
    error.statusCode = 400;
    throw error;
  }
  if (totalScore !== calculatedTotal) {
    const error = new Error("totalScore must equal the sum of all score categories");
    error.statusCode = 400;
    throw error;
  }
  if (totalScore < 0 || totalScore > 100) {
    const error = new Error("totalScore must be between 0 and 100");
    error.statusCode = 400;
    throw error;
  }

  const recording = body?.recording && typeof body.recording === "object"
    ? body.recording
    : {};

  return {
    legacyId: cleanText(body?.legacyId || body?.id, 200),
    callDateTime: normalizeCallDateTime(body?.callDateTime),
    auditorEmployeeId: cleanText(body?.auditorEmployeeId, 100),
    auditorNameSnapshot: cleanText(body?.auditorNameSnapshot, 200),
    agentEmployeeId: requiredText(body?.agentEmployeeId, "agentEmployeeId", 100),
    agentNameSnapshot: requiredText(
      body?.agentNameSnapshot,
      "agentNameSnapshot",
      200
    ),
    restaurantId: requiredText(body?.restaurantId, "restaurantId", 100),
    restaurantNameSnapshot: requiredText(
      body?.restaurantNameSnapshot,
      "restaurantNameSnapshot",
      200
    ),
    phoneNumber: cleanText(body?.phoneNumber, 80),
    notes: cleanText(body?.notes, 5000),
    recordingName: cleanText(body?.recordingName || recording.name, 500),
    recordingType: cleanText(body?.recordingType || recording.type, 120),
    recordingSize: parseOptionalInteger(
      body?.recordingSize ?? recording.size,
      "recordingSize"
    ),
    recordingLastModified: parseOptionalInteger(
      body?.recordingLastModified ?? recording.lastModified,
      "recordingLastModified"
    ),
    recordingKind: cleanText(body?.recordingKind || recording.kind, 80),
    recordingUrl: cleanText(body?.recordingUrl || recording.url, 2000),
    scores,
    totalScore,
    createdBy: cleanText(options.username, 200),
  };
}

async function ensureWeeklyQualityTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weekly_quality_evaluations (
      quality_id UUID PRIMARY KEY,
      legacy_id TEXT,
      call_date_time TIMESTAMPTZ,
      auditor_employee_id UUID REFERENCES employees(employee_id),
      auditor_name_snapshot TEXT,
      agent_employee_id UUID REFERENCES employees(employee_id),
      agent_name_snapshot TEXT,
      restaurant_id UUID REFERENCES restaurants(restaurant_id),
      restaurant_name_snapshot TEXT,
      phone_number TEXT,
      notes TEXT,
      recording_name TEXT,
      recording_type TEXT,
      recording_size INTEGER,
      recording_last_modified BIGINT,
      recording_kind TEXT,
      recording_url TEXT,
      scores JSONB NOT NULL,
      total_score INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      created_by TEXT,
      updated_by TEXT,
      deleted_at TIMESTAMPTZ,
      deleted_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_weekly_quality_agent_employee_id
      ON weekly_quality_evaluations(agent_employee_id)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_weekly_quality_auditor_employee_id
      ON weekly_quality_evaluations(auditor_employee_id)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_weekly_quality_restaurant_id
      ON weekly_quality_evaluations(restaurant_id)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_weekly_quality_call_date_time
      ON weekly_quality_evaluations(call_date_time DESC)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_weekly_quality_agent_call_date_time
      ON weekly_quality_evaluations(agent_employee_id, call_date_time DESC)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_weekly_quality_restaurant_call_date_time
      ON weekly_quality_evaluations(restaurant_id, call_date_time DESC)
      WHERE deleted_at IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_quality_legacy_id
      ON weekly_quality_evaluations(legacy_id)
      WHERE legacy_id IS NOT NULL AND deleted_at IS NULL;
  `);
}

function formatDateTime(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 19).replace("T", " ");
  }
  return String(value || "");
}

function mapQuality(row) {
  const recording = row.recording_name || row.recording_url
    ? {
        name: row.recording_name || "",
        type: row.recording_type || "",
        size: Number(row.recording_size || 0),
        lastModified: Number(row.recording_last_modified || 0),
        kind: row.recording_kind || "",
        url: row.recording_url || "",
      }
    : null;

  return {
    qualityId: row.quality_id,
    id: row.legacy_id || row.quality_id,
    legacyId: row.legacy_id || "",
    callDateTime: formatDateTime(row.call_date_time),
    auditorEmployeeId: row.auditor_employee_id || "",
    auditorNameSnapshot: row.auditor_name_snapshot || "",
    agentEmployeeId: row.agent_employee_id || "",
    agentNameSnapshot: row.agent_name_snapshot || "",
    restaurantId: row.restaurant_id || "",
    restaurantNameSnapshot: row.restaurant_name_snapshot || "",
    campaign: row.restaurant_name_snapshot || "",
    restaurant: row.restaurant_name_snapshot || "",
    phoneNumber: row.phone_number || "",
    notes: row.notes || "",
    recording,
    scores: row.scores || {},
    totalScore: Number(row.total_score || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by || "",
    updatedBy: row.updated_by || "",
  };
}

async function getQuality(qualityId) {
  const result = await pool.query(
    `SELECT *
       FROM weekly_quality_evaluations
      WHERE quality_id = $1::uuid
        AND deleted_at IS NULL`,
    [qualityId]
  );
  return result.rows.length ? mapQuality(result.rows[0]) : null;
}

async function listQuality(query = {}) {
  const conditions = ["deleted_at IS NULL"];
  const params = [];

  function addCondition(sql, value) {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  }

  const id = cleanText(query.id, 100);
  const agentEmployeeId = cleanText(query.agentEmployeeId, 100);
  const auditorEmployeeId = cleanText(query.auditorEmployeeId, 100);
  const restaurantId = cleanText(query.restaurantId, 100);
  const from = cleanText(query.from, 60);
  const to = cleanText(query.to, 60);
  const search = cleanText(query.search, 200);

  if (id) {
    params.push(id, id);
    conditions.push(
      `(quality_id::text = $${params.length - 1} OR legacy_id = $${params.length})`
    );
  }
  if (agentEmployeeId) addCondition("agent_employee_id = ?::uuid", agentEmployeeId);
  if (auditorEmployeeId) {
    addCondition("auditor_employee_id = ?::uuid", auditorEmployeeId);
  }
  if (restaurantId) addCondition("restaurant_id = ?::uuid", restaurantId);
  if (from) addCondition("call_date_time >= ?::timestamptz", from);
  if (to) addCondition("call_date_time <= ?::timestamptz", to);
  if (search) {
    const firstParam = params.length + 1;
    params.push(search, search, search, search, search);
    conditions.push(
      `(auditor_name_snapshot ILIKE '%' || $${firstParam} || '%'
        OR agent_name_snapshot ILIKE '%' || $${firstParam + 1} || '%'
        OR restaurant_name_snapshot ILIKE '%' || $${firstParam + 2} || '%'
        OR phone_number ILIKE '%' || $${firstParam + 3} || '%'
        OR notes ILIKE '%' || $${firstParam + 4} || '%')`
    );
  }

  const result = await pool.query(
    `SELECT *
       FROM weekly_quality_evaluations
      WHERE ${conditions.join(" AND ")}
      ORDER BY call_date_time DESC NULLS LAST, created_at DESC`,
    params
  );
  return result.rows.map(mapQuality);
}

async function insertQuality(quality, username) {
  const qualityId = crypto.randomUUID();

  await pool.query(
    `INSERT INTO weekly_quality_evaluations (
       quality_id,
       legacy_id,
       call_date_time,
       auditor_employee_id,
       auditor_name_snapshot,
       agent_employee_id,
       agent_name_snapshot,
       restaurant_id,
       restaurant_name_snapshot,
       phone_number,
       notes,
       recording_name,
       recording_type,
       recording_size,
       recording_last_modified,
       recording_kind,
       recording_url,
       scores,
       total_score,
       created_by,
       updated_by
     ) VALUES (
       $1, $2, $3::timestamptz, $4::uuid, $5, $6::uuid, $7, $8::uuid, $9,
       $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20, $20
     )`,
    [
      qualityId,
      quality.legacyId || null,
      quality.callDateTime,
      quality.auditorEmployeeId || null,
      quality.auditorNameSnapshot || null,
      quality.agentEmployeeId,
      quality.agentNameSnapshot,
      quality.restaurantId,
      quality.restaurantNameSnapshot,
      quality.phoneNumber || null,
      quality.notes || null,
      quality.recordingName || null,
      quality.recordingType || null,
      quality.recordingSize,
      quality.recordingLastModified,
      quality.recordingKind || null,
      quality.recordingUrl || null,
      JSON.stringify(quality.scores),
      quality.totalScore,
      username,
    ]
  );

  return qualityId;
}

async function importQualityRecords(records, username) {
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
        `SELECT quality_id
           FROM weekly_quality_evaluations
          WHERE legacy_id = $1
            AND deleted_at IS NULL
          LIMIT 1`,
        [legacyId]
      );
      if (duplicate.rows.length) {
        summary.skippedDuplicates += 1;
        continue;
      }

      const quality = normalizeQualityBody(
        { ...record, legacyId },
        { username }
      );
      await insertQuality(quality, username);
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
    session =
      event.httpMethod === "DELETE" ||
      (event.httpMethod === "POST" && action === "bulk-import")
        ? requireWriteSession(event)
        : requireValidSession(event);
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
    await ensureWeeklyQualityTable();

    if (event.httpMethod === "GET") {
      const records = await listQuality(event.queryStringParameters || {});
      return json(200, { ok: true, count: records.length, records });
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

        const result = await importQualityRecords(records, username);
        return json(200, { ok: true, ...result });
      }

      const quality = normalizeQualityBody(body, { username });
      const qualityId = await insertQuality(quality, username);
      return json(201, {
        ok: true,
        record: await getQuality(qualityId),
      });
    }

    if (event.httpMethod === "PUT") {
      const qualityId = cleanText(event.queryStringParameters?.id, 100);
      if (!qualityId) {
        return json(400, { ok: false, error: "Quality id is required" });
      }

      const username = cleanText(session.username || "unknown", 200);
      const quality = normalizeQualityBody(JSON.parse(event.body || "{}"), {
        username,
      });
      const result = await pool.query(
        `UPDATE weekly_quality_evaluations
            SET legacy_id = $2,
                call_date_time = $3::timestamptz,
                auditor_employee_id = $4::uuid,
                auditor_name_snapshot = $5,
                agent_employee_id = $6::uuid,
                agent_name_snapshot = $7,
                restaurant_id = $8::uuid,
                restaurant_name_snapshot = $9,
                phone_number = $10,
                notes = $11,
                recording_name = $12,
                recording_type = $13,
                recording_size = $14,
                recording_last_modified = $15,
                recording_kind = $16,
                recording_url = $17,
                scores = $18::jsonb,
                total_score = $19,
                updated_at = now(),
                updated_by = $20
          WHERE quality_id = $1::uuid
            AND deleted_at IS NULL
          RETURNING quality_id`,
        [
          qualityId,
          quality.legacyId || null,
          quality.callDateTime,
          quality.auditorEmployeeId || null,
          quality.auditorNameSnapshot || null,
          quality.agentEmployeeId,
          quality.agentNameSnapshot,
          quality.restaurantId,
          quality.restaurantNameSnapshot,
          quality.phoneNumber || null,
          quality.notes || null,
          quality.recordingName || null,
          quality.recordingType || null,
          quality.recordingSize,
          quality.recordingLastModified,
          quality.recordingKind || null,
          quality.recordingUrl || null,
          JSON.stringify(quality.scores),
          quality.totalScore,
          username,
        ]
      );

      return result.rows.length
        ? json(200, { ok: true, record: await getQuality(qualityId) })
        : json(404, { ok: false, error: "Quality record not found" });
    }

    if (event.httpMethod === "DELETE") {
      const qualityId = cleanText(event.queryStringParameters?.id, 100);
      if (!qualityId) {
        return json(400, { ok: false, error: "Quality id is required" });
      }

      const username = cleanText(session.username || "unknown", 200);
      const result = await pool.query(
        `UPDATE weekly_quality_evaluations
            SET deleted_at = now(),
                deleted_by = $2,
                updated_at = now(),
                updated_by = $2
          WHERE quality_id = $1::uuid
            AND deleted_at IS NULL
          RETURNING quality_id`,
        [qualityId, username]
      );

      return result.rows.length
        ? json(200, { ok: true })
        : json(404, { ok: false, error: "Quality record not found" });
    }

    return json(405, { ok: false, error: "Method Not Allowed" });
  } catch (error) {
    console.error("weekly-quality function error:", error);
    if (error.code === "22P02" || error.code === "22007") {
      return json(400, { ok: false, error: "Invalid id or date/time" });
    }
    if (error.code === "23503") {
      return json(400, {
        ok: false,
        error: "Employee or restaurant not found",
      });
    }
    if (error.code === "23505") {
      return json(400, {
        ok: false,
        error: "Weekly quality record already exists for this legacy id",
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
