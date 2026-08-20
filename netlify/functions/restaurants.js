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
const RESTAURANT_STATUSES = new Set(["active", "inactive"]);

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

function getRestaurantId(event) {
  return String(event.queryStringParameters?.id || "").trim();
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

function normalizeStatus(value) {
  const status = requiredText(value, "status", 20).toLowerCase();
  if (!RESTAURANT_STATUSES.has(status)) {
    const error = new Error("Invalid status");
    error.statusCode = 400;
    throw error;
  }
  return status;
}

function normalizeRestaurantBody(body) {
  return {
    brandName: requiredText(body?.brandName, "brandName", 200),
    logoUrl: cleanText(body?.logoUrl, 1500000),
    status: normalizeStatus(body?.status),
    callCenterNumber: cleanText(body?.callCenterNumber, 80),
    originalRestaurantNumber: cleanText(body?.originalRestaurantNumber, 80),
    forwardedNumber: cleanText(body?.forwardedNumber, 80),
    brandOwnerName: cleanText(body?.brandOwnerName, 200),
    brandOwnerPhone: cleanText(body?.brandOwnerPhone, 80),
    accountManagerName: cleanText(body?.accountManagerName, 200),
    restaurantManagerName: cleanText(body?.restaurantManagerName, 200),
    notes: cleanText(body?.notes, 5000),
  };
}

async function ensureRestaurantsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS restaurants (
      restaurant_id UUID PRIMARY KEY,
      brand_name TEXT NOT NULL,
      logo_url TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
      call_center_number TEXT,
      original_restaurant_number TEXT,
      forwarded_number TEXT,
      brand_owner_name TEXT,
      brand_owner_phone TEXT,
      account_manager_name TEXT,
      restaurant_manager_name TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at TIMESTAMPTZ,
      created_by TEXT,
      updated_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_restaurants_status
      ON restaurants(status);
    CREATE INDEX IF NOT EXISTS idx_restaurants_brand_name
      ON restaurants(brand_name);
  `);
}

function mapRestaurant(row) {
  return {
    restaurantId: row.restaurant_id,
    brandName: row.brand_name,
    logoUrl: row.logo_url || "",
    status: row.status,
    callCenterNumber: row.call_center_number || "",
    originalRestaurantNumber: row.original_restaurant_number || "",
    forwardedNumber: row.forwarded_number || "",
    brandOwnerName: row.brand_owner_name || "",
    brandOwnerPhone: row.brand_owner_phone || "",
    accountManagerName: row.account_manager_name || "",
    restaurantManagerName: row.restaurant_manager_name || "",
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    createdBy: row.created_by || "",
    updatedBy: row.updated_by || "",
  };
}

async function getRestaurantProfile(restaurantId) {
  const result = await pool.query(
    `SELECT *
       FROM restaurants
      WHERE restaurant_id = $1::uuid`,
    [restaurantId]
  );
  return result.rows.length ? mapRestaurant(result.rows[0]) : null;
}

async function listRestaurants(statusFilter) {
  let whereClause = "WHERE status = 'active'";
  const params = [];

  if (statusFilter === "all") {
    whereClause = "";
  } else if (statusFilter === "inactive" || statusFilter === "archived") {
    whereClause = "WHERE status = 'inactive'";
  } else if (statusFilter === "active") {
    whereClause = "WHERE status = 'active'";
  }

  const result = await pool.query(
    `SELECT *
       FROM restaurants
       ${whereClause}
      ORDER BY brand_name ASC`,
    params
  );
  return result.rows.map(mapRestaurant);
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
    await requireModuleAccess(event, "client_profiles", moduleAction);
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
    await ensureRestaurantsTable();

    if (event.httpMethod === "GET") {
      const restaurantId = getRestaurantId(event);
      if (restaurantId) {
        const restaurant = await getRestaurantProfile(restaurantId);
        return restaurant
          ? json(200, { ok: true, restaurant })
          : json(404, { ok: false, error: "Restaurant not found" });
      }

      const status = cleanText(
        event.queryStringParameters?.status || "active",
        20
      ).toLowerCase();
      const restaurants = await listRestaurants(status);
      return json(200, { ok: true, count: restaurants.length, restaurants });
    }

    if (event.httpMethod === "POST") {
      const restaurant = normalizeRestaurantBody(JSON.parse(event.body || "{}"));
      const restaurantId = crypto.randomUUID();
      const username = cleanText(session.username || "unknown", 200);

      await pool.query(
        `INSERT INTO restaurants (
           restaurant_id,
           brand_name,
           logo_url,
           status,
           call_center_number,
           original_restaurant_number,
           forwarded_number,
           brand_owner_name,
           brand_owner_phone,
           account_manager_name,
           restaurant_manager_name,
           notes,
           archived_at,
           created_by,
           updated_by
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           CASE WHEN $4 = 'inactive' THEN now() ELSE NULL END,
           $13, $13
         )`,
        [
          restaurantId,
          restaurant.brandName,
          restaurant.logoUrl || null,
          restaurant.status,
          restaurant.callCenterNumber || null,
          restaurant.originalRestaurantNumber || null,
          restaurant.forwardedNumber || null,
          restaurant.brandOwnerName || null,
          restaurant.brandOwnerPhone || null,
          restaurant.accountManagerName || null,
          restaurant.restaurantManagerName || null,
          restaurant.notes || null,
          username,
        ]
      );

      return json(201, {
        ok: true,
        restaurant: await getRestaurantProfile(restaurantId),
      });
    }

    if (event.httpMethod === "PUT") {
      const restaurantId = getRestaurantId(event);
      if (!restaurantId) {
        return json(400, { ok: false, error: "Restaurant id is required" });
      }

      const restaurant = normalizeRestaurantBody(JSON.parse(event.body || "{}"));
      const username = cleanText(session.username || "unknown", 200);
      const result = await pool.query(
        `UPDATE restaurants
            SET brand_name = $2,
                logo_url = $3,
                status = $4,
                call_center_number = $5,
                original_restaurant_number = $6,
                forwarded_number = $7,
                brand_owner_name = $8,
                brand_owner_phone = $9,
                account_manager_name = $10,
                restaurant_manager_name = $11,
                notes = $12,
                archived_at = CASE
                  WHEN $4 = 'inactive' THEN COALESCE(archived_at, now())
                  ELSE NULL
                END,
                updated_at = now(),
                updated_by = $13
          WHERE restaurant_id = $1::uuid
          RETURNING restaurant_id`,
        [
          restaurantId,
          restaurant.brandName,
          restaurant.logoUrl || null,
          restaurant.status,
          restaurant.callCenterNumber || null,
          restaurant.originalRestaurantNumber || null,
          restaurant.forwardedNumber || null,
          restaurant.brandOwnerName || null,
          restaurant.brandOwnerPhone || null,
          restaurant.accountManagerName || null,
          restaurant.restaurantManagerName || null,
          restaurant.notes || null,
          username,
        ]
      );

      return result.rows.length
        ? json(200, {
            ok: true,
            restaurant: await getRestaurantProfile(restaurantId),
          })
        : json(404, { ok: false, error: "Restaurant not found" });
    }

    if (event.httpMethod === "DELETE") {
      const restaurantId = getRestaurantId(event);
      if (!restaurantId) {
        return json(400, { ok: false, error: "Restaurant id is required" });
      }

      const username = cleanText(session.username || "unknown", 200);
      const result = await pool.query(
        `UPDATE restaurants
            SET status = 'inactive',
                archived_at = COALESCE(archived_at, now()),
                updated_at = now(),
                updated_by = $2
          WHERE restaurant_id = $1::uuid
          RETURNING restaurant_id`,
        [restaurantId, username]
      );

      return result.rows.length
        ? json(200, { ok: true })
        : json(404, { ok: false, error: "Restaurant not found" });
    }

    return json(405, { ok: false, error: "Method Not Allowed" });
  } catch (error) {
    console.error("restaurants function error:", error);
    if (error.code === "22P02") {
      return json(400, { ok: false, error: "Invalid restaurant id" });
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
