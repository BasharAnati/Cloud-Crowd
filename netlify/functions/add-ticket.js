// netlify/functions/add-ticket.js
const { google } = require("googleapis");

exports.handler = async (event) => {
  try {
    // لو ما اجا POST => رجّع خطأ
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Only POST allowed" }),
      };
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

    // اسم الشيت (الورقة) - عندك "July 2025"
    const range = "July 2025!A:K";

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

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, message: "Ticket added", row: newRow }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
