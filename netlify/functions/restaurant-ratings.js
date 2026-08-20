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
const PLATFORMS = new Set(["Talabat", "Careem"]);

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

function getRatingId(event) {
  return cleanText(event.queryStringParameters?.id, 100);
}

function parseRating(value) {
  if (value === "" || value === null || value === undefined) {
    const error = new Error("rating is required");
    error.statusCode = 400;
    throw error;
  }

  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
    const error = new Error("rating must be between 0 and 5");
    error.statusCode = 400;
    throw error;
  }

  return Math.round((rating + Number.EPSILON) * 100) / 100;
}

function parseReviewsCount(value) {
  if (value === "" || value === null || value === undefined) return 0;

  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    const error = new Error("reviewsCount must be a non-negative integer");
    error.statusCode = 400;
    throw error;
  }

  return count;
}

function normalizeDate(value) {
  const date = requiredText(value, "ratingDate", 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const error = new Error("ratingDate must use YYYY-MM-DD format");
    error.statusCode = 400;
    throw error;
  }
  return date;
}

function normalizePlatform(value) {
  const platform = requiredText(value, "platform", 20);
  if (!PLATFORMS.has(platform)) {
    const error = new Error("Invalid platform");
    error.statusCode = 400;
    throw error;
  }
  return platform;
}

function normalizeRatingBody(body) {
  return {
    restaurantId: requiredText(body?.restaurantId, "restaurantId", 100),
    monthName: requiredText(body?.monthName, "monthName", 40),
    weekName: requiredText(body?.weekName, "weekName", 40),
    platform: normalizePlatform(body?.platform),
    rating: parseRating(body?.rating),
    reviewsCount: parseReviewsCount(body?.reviewsCount),
    ratingDate: normalizeDate(body?.ratingDate),
    notes: cleanText(body?.notes, 5000),
  };
}

async function ensureRatingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS restaurant_ratings (
      rating_id UUID PRIMARY KEY,
      restaurant_id UUID NOT NULL REFERENCES restaurants(restaurant_id),
      restaurant_name_snapshot TEXT NOT NULL,
      month_name TEXT NOT NULL,
      week_name TEXT NOT NULL,
      platform TEXT NOT NULL
        CHECK (platform IN ('Talabat','Careem')),
      rating NUMERIC(3,2)
        CHECK (rating >= 0 AND rating <= 5),
      reviews_count INTEGER DEFAULT 0
        CHECK (reviews_count >= 0),
      rating_date DATE NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      created_by TEXT,
      updated_by TEXT,
      deleted_at TIMESTAMPTZ,
      deleted_by TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_ratings_unique_period
      ON restaurant_ratings(restaurant_id, platform, month_name, week_name)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_restaurant_ratings_restaurant_id
      ON restaurant_ratings(restaurant_id)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_restaurant_ratings_platform
      ON restaurant_ratings(platform)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_restaurant_ratings_period
      ON restaurant_ratings(month_name, week_name)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_restaurant_ratings_latest
      ON restaurant_ratings(restaurant_id, platform, rating_date DESC, updated_at DESC)
      WHERE deleted_at IS NULL;
  `);
}

function mapRating(row) {
  const ratingDate =
    row.rating_date instanceof Date
      ? row.rating_date.toISOString().slice(0, 10)
      : String(row.rating_date || "");

  return {
    ratingId: row.rating_id,
    restaurantId: row.restaurant_id,
    restaurantNameSnapshot: row.restaurant_name_snapshot,
    monthName: row.month_name,
    weekName: row.week_name,
    platform: row.platform,
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    reviewsCount: Number(row.reviews_count || 0),
    ratingDate,
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by || "",
    updatedBy: row.updated_by || "",
  };
}

async function getActiveRestaurant(restaurantId) {
  const result = await pool.query(
    `SELECT restaurant_id, brand_name
       FROM restaurants
      WHERE restaurant_id = $1::uuid
        AND status = 'active'`,
    [restaurantId]
  );
  return result.rows[0] || null;
}

async function getRating(ratingId) {
  const result = await pool.query(
    `SELECT *
       FROM restaurant_ratings
      WHERE rating_id = $1::uuid
        AND deleted_at IS NULL`,
    [ratingId]
  );
  return result.rows.length ? mapRating(result.rows[0]) : null;
}

async function assertUniquePeriod(rating, ignoredRatingId = "") {
  const params = [
    rating.restaurantId,
    rating.platform,
    rating.monthName,
    rating.weekName,
  ];
  let ignoreClause = "";

  if (ignoredRatingId) {
    params.push(ignoredRatingId);
    ignoreClause = `AND rating_id <> $${params.length}::uuid`;
  }

  const result = await pool.query(
    `SELECT rating_id
       FROM restaurant_ratings
      WHERE restaurant_id = $1::uuid
        AND platform = $2
        AND month_name = $3
        AND week_name = $4
        AND deleted_at IS NULL
        ${ignoreClause}
      LIMIT 1`,
    params
  );

  if (result.rows.length) {
    const error = new Error(
      "A rating already exists for this restaurant, platform, month, and week"
    );
    error.statusCode = 400;
    throw error;
  }
}

async function listRatings(query = {}) {
  const conditions = ["deleted_at IS NULL"];
  const params = [];

  function addCondition(sql, value) {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  }

  const restaurantId = cleanText(query.restaurantId, 100);
  const platform = cleanText(query.platform, 20);
  const monthName = cleanText(query.monthName, 40);
  const weekName = cleanText(query.weekName, 40);
  const search = cleanText(query.search, 200);

  if (restaurantId) addCondition("restaurant_id = ?::uuid", restaurantId);
  if (platform) {
    if (!PLATFORMS.has(platform)) {
      const error = new Error("Invalid platform");
      error.statusCode = 400;
      throw error;
    }
    addCondition("platform = ?", platform);
  }
  if (monthName) addCondition("month_name = ?", monthName);
  if (weekName) addCondition("week_name = ?", weekName);
  if (search) {
    params.push(search);
    conditions.push(
      `restaurant_name_snapshot ILIKE '%' || $${params.length} || '%'`
    );
  }

  const result = await pool.query(
    `SELECT *
       FROM restaurant_ratings
      WHERE ${conditions.join(" AND ")}
      ORDER BY rating_date DESC, updated_at DESC, restaurant_name_snapshot ASC`,
    params
  );
  return result.rows.map(mapRating);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  let session;
  try {
    session = await requireValidSession(event);
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
    await requireModuleAccess(event, "restaurant_ratings", moduleAction);
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
    await ensureRatingsTable();

    if (event.httpMethod === "GET") {
      const ratingId = getRatingId(event);
      if (ratingId) {
        const rating = await getRating(ratingId);
        return rating
          ? json(200, { ok: true, rating })
          : json(404, { ok: false, error: "Rating not found" });
      }

      const ratings = await listRatings(event.queryStringParameters || {});
      return json(200, { ok: true, count: ratings.length, ratings });
    }

    if (event.httpMethod === "POST") {
      const rating = normalizeRatingBody(JSON.parse(event.body || "{}"));
      const restaurant = await getActiveRestaurant(rating.restaurantId);
      if (!restaurant) {
        return json(400, { ok: false, error: "Active restaurant not found" });
      }

      await assertUniquePeriod(rating);
      const ratingId = crypto.randomUUID();
      const username = cleanText(session.username || "unknown", 200);

      await pool.query(
        `INSERT INTO restaurant_ratings (
           rating_id,
           restaurant_id,
           restaurant_name_snapshot,
           month_name,
           week_name,
           platform,
           rating,
           reviews_count,
           rating_date,
           notes,
           created_by,
           updated_by
         ) VALUES (
           $1, $2::uuid, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $11
         )`,
        [
          ratingId,
          rating.restaurantId,
          restaurant.brand_name,
          rating.monthName,
          rating.weekName,
          rating.platform,
          rating.rating,
          rating.reviewsCount,
          rating.ratingDate,
          rating.notes || null,
          username,
        ]
      );

      return json(201, { ok: true, rating: await getRating(ratingId) });
    }

    if (event.httpMethod === "PUT") {
      const ratingId = getRatingId(event);
      if (!ratingId) {
        return json(400, { ok: false, error: "Rating id is required" });
      }

      const rating = normalizeRatingBody(JSON.parse(event.body || "{}"));
      const restaurant = await getActiveRestaurant(rating.restaurantId);
      if (!restaurant) {
        return json(400, { ok: false, error: "Active restaurant not found" });
      }

      await assertUniquePeriod(rating, ratingId);
      const username = cleanText(session.username || "unknown", 200);
      const result = await pool.query(
        `UPDATE restaurant_ratings
            SET restaurant_id = $2::uuid,
                restaurant_name_snapshot = $3,
                month_name = $4,
                week_name = $5,
                platform = $6,
                rating = $7,
                reviews_count = $8,
                rating_date = $9::date,
                notes = $10,
                updated_at = now(),
                updated_by = $11
          WHERE rating_id = $1::uuid
            AND deleted_at IS NULL
          RETURNING rating_id`,
        [
          ratingId,
          rating.restaurantId,
          restaurant.brand_name,
          rating.monthName,
          rating.weekName,
          rating.platform,
          rating.rating,
          rating.reviewsCount,
          rating.ratingDate,
          rating.notes || null,
          username,
        ]
      );

      return result.rows.length
        ? json(200, { ok: true, rating: await getRating(ratingId) })
        : json(404, { ok: false, error: "Rating not found" });
    }

    if (event.httpMethod === "DELETE") {
      const ratingId = getRatingId(event);
      if (!ratingId) {
        return json(400, { ok: false, error: "Rating id is required" });
      }

      const username = cleanText(session.username || "unknown", 200);
      const result = await pool.query(
        `UPDATE restaurant_ratings
            SET deleted_at = now(),
                deleted_by = $2,
                updated_at = now(),
                updated_by = $2
          WHERE rating_id = $1::uuid
            AND deleted_at IS NULL
          RETURNING rating_id`,
        [ratingId, username]
      );

      return result.rows.length
        ? json(200, { ok: true })
        : json(404, { ok: false, error: "Rating not found" });
    }

    return json(405, { ok: false, error: "Method Not Allowed" });
  } catch (error) {
    console.error("restaurant-ratings function error:", error);
    if (error.code === "22P02") {
      return json(400, { ok: false, error: "Invalid id" });
    }
    if (error.code === "23503") {
      return json(400, { ok: false, error: "Restaurant not found" });
    }
    if (error.code === "23505") {
      return json(400, {
        ok: false,
        error:
          "A rating already exists for this restaurant, platform, month, and week",
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
