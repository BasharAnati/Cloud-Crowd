const { google } = require("googleapis");

const TAB_NAME = "July 2025"; // غيّره إذا اسم التاب مختلف
const RANGE_READ = `${TAB_NAME}!A2:M`;
const CASE_COL_INDEX_1BASED = 11; // K column
const PDF_NAME_COL = "L";
const PDF_URL_COL  = "M";

function json(statusCode, obj) {
  return { statusCode, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Only POST allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const caseNumber = String(body.caseNumber || "").trim();
    const pdfName = String(body.pdfName || "").trim();
    const pdfBase64 = String(body.pdfBase64 || "");

    if (!caseNumber || !pdfName || !pdfBase64) {
      return json(400, { ok: false, error: "Missing required fields" });
    }

    if (!pdfBase64.startsWith("data:application/pdf;base64,")) {
      return json(400, { ok: false, error: "Invalid PDF dataUrl" });
    }

    // ✅ رابط Apps Script Web App
    const webAppUrl = String(process.env.APPS_SCRIPT_UPLOAD_URL || "").trim();
    if (!webAppUrl) {
      return json(500, { ok: false, error: "Missing APPS_SCRIPT_UPLOAD_URL env var" });
    }

    // ✅ Sheet config (لسه بنكتب بالشيت من Netlify عبر Service Account)
    const spreadsheetId = String(process.env.GOOGLE_SHEET_ID_CCTV || "").trim();
    if (!spreadsheetId) {
      return json(500, { ok: false, error: "Missing GOOGLE_SHEET_ID_CCTV env var" });
    }

    const credsRaw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
    if (!credsRaw) {
      return json(500, { ok: false, error: "Missing GOOGLE_APPLICATION_CREDENTIALS_JSON env var" });
    }

    // =========================
    // 1) Upload PDF via Apps Script (runs as YOU → no quota issue)
    // =========================
    const upRes = await fetch(webAppUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseNumber, pdfName, pdfBase64 })
    });

    const upData = await upRes.json().catch(() => ({}));
    if (!upRes.ok || !upData.ok) {
      const msg = upData?.error || `Apps Script upload failed (HTTP ${upRes.status})`;
      return json(500, { ok: false, error: msg });
    }

    const pdfUrl = String(upData.pdfUrl || "").trim();
    if (!pdfUrl) {
      return json(500, { ok: false, error: "Apps Script did not return pdfUrl" });
    }

    // =========================
    // 2) Update Google Sheet (L,M) via Service Account
    // =========================
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(credsRaw),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // Find row by Ticket ID (K)
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: RANGE_READ,
    });

    const rows = res.data.values || [];
    let foundRowIndex = -1;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const kVal = String(row[CASE_COL_INDEX_1BASED - 1] || "").trim();
      if (kVal === caseNumber) {
        foundRowIndex = i;
        break;
      }
    }

    if (foundRowIndex === -1) {
      return json(404, { ok: false, error: "Ticket ID not found" });
    }

    const sheetRowNumber = foundRowIndex + 2; // because A2 is index 0

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${TAB_NAME}!${PDF_NAME_COL}${sheetRowNumber}:${PDF_URL_COL}${sheetRowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[pdfName, pdfUrl]] },
    });

    return json(200, { ok: true, pdfName, pdfUrl });

  } catch (err) {
    console.error("upload-cctv-pdf error:", err);
    return json(500, { ok: false, error: err?.message || String(err) });
  }
};
