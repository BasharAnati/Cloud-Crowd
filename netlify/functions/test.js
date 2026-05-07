// netlify/functions/test.js
const { google } = require("googleapis");
const { requireAdminSession } = require("./_auth");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
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

    const keyJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const range = process.env.GOOGLE_SHEET_RANGE;

    if (!keyJson || !sheetId || !range) {
      return json(500, { ok: false, error: "Missing env vars (GOOGLE_APPLICATION_CREDENTIALS_JSON / GOOGLE_SHEET_ID / GOOGLE_SHEET_RANGE)" });
    }

    const creds = JSON.parse(keyJson);

    const auth = new google.auth.JWT(
      creds.client_email,
      null,
      creds.private_key,
      ["https://www.googleapis.com/auth/spreadsheets.readonly"] // قراءة فقط
    );

    await auth.authorize();

    const sheets = google.sheets({ version: "v4", auth });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });

    return json(200, {
      ok: true,
      range,
      rows: data.values || [],
      rowCount: (data.values || []).length,
    });
  } catch (err) {
    return json(500, { ok: false, error: err.message });
  }
};
