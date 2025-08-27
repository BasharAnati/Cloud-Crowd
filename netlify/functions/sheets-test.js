// netlify/functions/sheets-test.js
const { google } = require("googleapis");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: CORS, body: "" };
    }

    // 1) المتغيّرات من Netlify
    const sheetId = process.env.GOOGLE_SHEET_ID; // ID تبع الشيت
    const defaultRange =
      process.env.GOOGLE_SHEET_RANGE || "July 2025!A1:K2000"; // رينج افتراضي
    if (!sheetId) {
      return {
        statusCode: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: false,
          error:
            "Missing GOOGLE_SHEET_ID env var. ضع Google Sheet ID بمتغيرات نتلايفي.",
        }),
      };
    }

    // 2) نسمح بتمرير range كـ query ?range=Sheet!A1:K30
    const url = new URL(event.rawUrl || "https://x/");
    const range = url.searchParams.get("range") || defaultRange;

    // 3) مصادقة Google من الـ JSON الموجود في env
    const rawCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (!rawCreds) {
      return {
        statusCode: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: false,
          error:
            "Missing GOOGLE_APPLICATION_CREDENTIALS_JSON env var. ألصق ملف الـJSON كاملًا هنا.",
        }),
      };
    }

    let credentials;
    try {
      credentials =
        typeof rawCreds === "string" ? JSON.parse(rawCreds) : rawCreds;
    } catch (e) {
      return {
        statusCode: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: false,
          error: "Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON",
          detail: e.message,
        }),
      };
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // 4) قراءة القيم
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const rows = data.values || [];
    if (rows.length === 0) {
      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true, headers: [], items: [], rows: [] }),
      };
    }

    // 5) أول صف عناوين — نعمل Mapping لباقي الصفوف كـ كائنات
    const headers = rows[0].map((h) => String(h || "").trim());
    const items = rows.slice(1).map((r) => {
      const obj = {};
      headers.forEach((h, i) => (obj[h] = r[i] ?? ""));
      return obj;
    });

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        sheetId,
        range,
        count: items.length,
        headers,
        items, // الكائنات الجاهزة للاستخدام
        rows,  // الصفوف الخام (للتشخيص)
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
