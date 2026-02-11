const { google } = require("googleapis");
const { Readable } = require("stream");

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

    const folderId = String(process.env.GOOGLE_DRIVE_FOLDER_ID || "").trim();
    if (!folderId) {
      return json(500, { ok: false, error: "Missing GOOGLE_DRIVE_FOLDER_ID env var" });
    }

    const spreadsheetId = String(process.env.GOOGLE_SHEET_ID_CCTV || "").trim();
    if (!spreadsheetId) {
      return json(500, { ok: false, error: "Missing GOOGLE_SHEET_ID_CCTV env var" });
    }

    const credsRaw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
    if (!credsRaw) {
      return json(500, { ok: false, error: "Missing GOOGLE_APPLICATION_CREDENTIALS_JSON env var" });
    }

    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(credsRaw),
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
      ],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const drive  = google.drive({ version: "v3", auth });

    // ==== Upload to Drive (to folder) ====
    const base64 = pdfBase64.split(",")[1];
    const buffer = Buffer.from(base64, "base64");
    const stream = Readable.from(buffer);

    const created = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: `${caseNumber} - ${pdfName}`,
        mimeType: "application/pdf",
        parents: [folderId],
      },
      media: { mimeType: "application/pdf", body: stream },
      fields: "id",
    });

    const fileId = created?.data?.id;
    if (!fileId) {
      return json(500, { ok: false, error: "Drive upload failed: no fileId returned" });
    }

    // Make it publicly viewable
    await drive.permissions.create({
      supportsAllDrives: true,
      fileId,
      requestBody: { role: "reader", type: "anyone" },
    });

    const fileInfo = await drive.files.get({
      supportsAllDrives: true,
      fileId,
      fields: "webViewLink",
    });

    const pdfUrl = fileInfo?.data?.webViewLink || "";
    if (!pdfUrl) {
      return json(500, { ok: false, error: "Drive get link failed: no webViewLink returned" });
    }

    // ==== Find row by Ticket ID (K) ====
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

    // +2 because we read from A2 (index 0 => row 2)
    const sheetRowNumber = foundRowIndex + 2;

    // ==== Update L & M ====
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
