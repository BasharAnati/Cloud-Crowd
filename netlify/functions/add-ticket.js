// netlify/functions/add-ticket.js
const { google } = require("googleapis");
const { requireAdminSession } = require("./_auth");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: CORS, body: "" };
    }

    try {
      requireAdminSession(event);
    } catch (authErr) {
      if (!authErr.statusCode) throw authErr;
      return json(authErr.statusCode, { ok: false, error: authErr.message });
    }

    // لو ما اجا POST => رجّع خطأ
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Only POST allowed" });
    }

    // اقرأ البيانات من البودي
    const body = JSON.parse(event.body);

    // مصادقة جوجل
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // ID الشيت من المتغير
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    const range = process.env.GOOGLE_SHEET_RANGE;
    if (!range) {
      return json(500, { ok: false, error: "Missing GOOGLE_SHEET_RANGE env var" });
    }

    // نبني صف جديد بنفس ترتيب الأعمدة
    const newRow = [
      body.caseStatus || "",
      body.branch || "",
      body.time || "",
      body.camera || "",
      body.section || "",
      body.staffInvolved || "",
      body.reviewType || "",
      body.violatedPolicy || "",
      body.detailsNotes || "",
      body.actionTaken || "",
      Date.now().toString() // Ticket ID أوتوماتيك (unique)
    ];

    // أضف الصف
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [newRow],
      },
    });

    return json(200, { ok: true, message: "Ticket added", row: newRow });
  } catch (err) {
    console.error(err);
    return json(500, { ok: false, error: err.message });
  }
};
