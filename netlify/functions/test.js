// netlify/functions/test.js
const { google } = require("googleapis");

exports.handler = async () => {
  try {
    const keyJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const range = process.env.GOOGLE_SHEET_RANGE || "July 2025!A1:K20";

    if (!keyJson || !sheetId) {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: "Missing env vars (GOOGLE_APPLICATION_CREDENTIALS_JSON / GOOGLE_SHEET_ID)" }),
      };
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

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        range,
        rows: data.values || [],
        rowCount: (data.values || []).length,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
