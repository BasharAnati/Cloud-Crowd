// netlify/functions/sheets.js  (CommonJS)
const { google } = require('googleapis');

/* -------------------- Helpers -------------------- */
function ok(data, extraHeaders = {}) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // بالإنتاج: استبدل * بدومينك
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-App-Secret',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
      ...extraHeaders,
    },
    body: JSON.stringify(data),
  };
}
function err(statusCode, message) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ error: message }),
  };
}

async function getSheetsClient() {
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credsJson) throw new Error('Missing GOOGLE_APPLICATION_CREDENTIALS_JSON');

  let creds;
  try {
    creds = JSON.parse(credsJson);
  } catch {
    throw new Error('Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON (not valid JSON)');
  }

  const auth = new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

/* -------------------- Constants -------------------- */
// اسم التاب الافتراضي داخل الشيت (يمكن تغييره من ENV أو تمريره من الفرونت)
const DEFAULT_TAB = process.env.SHEET_TAB || 'CCTV_July2025';
// خرائط الأعمدة حسب تصميمنا:
// A:status, J:actionTaken, K:caseNumber
const COL = { STATUS: 'A', ACTION: 'J', CASE: 'K' };

/* -------------------- Handler -------------------- */
exports.handler = async (event) => {
  try {
    // حماية اختيارية
    const appSecret = process.env.APP_SECRET;
    if (appSecret) {
      const clientSecret =
        event.headers['x-app-secret'] ||
        event.headers['X-App-Secret'] ||
        event.headers['x-app-secret'];
      if (clientSecret !== appSecret) return err(401, 'Unauthorized');
    }

    if (event.httpMethod === 'OPTIONS') return ok({ ok: true });

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) return err(500, 'Missing GOOGLE_SHEET_ID');

    const sheets = await getSheetsClient();

    /* ---------- GET: read range ---------- */
    if (event.httpMethod === 'GET') {
      // مثال: ?range=CCTV_July2025!A1:M
      const qs = event.queryStringParameters || {};
      const range = qs.range || `${DEFAULT_TAB}!A1:M`;
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      return ok(res.data);
    }

    /* ---------- POST: append rows ---------- */
    if (event.httpMethod === 'POST') {
      let body = {};
      try {
        body = JSON.parse(event.body || '{}');
      } catch {
        return err(400, 'Invalid JSON body');
      }

      // body: { range: 'CCTV_July2025', values: [[...], ...] }
      const tabOrRange = body.range || DEFAULT_TAB;
      let values = body.values ?? null;

      if (!values && Array.isArray(body) && body.length) values = body;
      if (values && !Array.isArray(values[0])) values = [values];
      if (!Array.isArray(values) || values.length === 0) {
        return err(400, 'Body must include non-empty "values" array');
      }

      const appendRes = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: tabOrRange,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
      });
      return ok(appendRes.data);
    }

    /* ---------- PUT: update one row (by Case Number in column K) ---------- */
    if (event.httpMethod === 'PUT') {
      let body = {};
      try {
        body = JSON.parse(event.body || '{}');
      } catch {
        return err(400, 'Invalid JSON body');
      }

      const tab = body.tab || DEFAULT_TAB;
      const caseNumber = String(body.caseNumber || '').trim();
      const newStatus = body.status;          // optional
      const newAction = body.actionTaken;     // optional

      if (!caseNumber) return err(400, 'Missing "caseNumber"');

      // 1) اقرأ عمود K بالكامل لايجاد رقم الصف
      const colRange = `${tab}!${COL.CASE}:${COL.CASE}`;
      const colRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: colRange,
      });
      const rows = (colRes.data.values || []).map(r => r[0]);
      // أول صف (index 0) هو الهيدر عادةً، لذلك نبحث بدءًا من 1
      let foundRow = -1;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i]).trim() === caseNumber) {
          foundRow = i + 1; // +1 لأن صفوف الشيت 1-based
          break;
        }
      }
      if (foundRow < 0) return err(404, `Case not found: ${caseNumber}`);

      // 2) جهّز التحديثات المطلوبة
      const data = [];
      if (typeof newStatus !== 'undefined') {
        data.push({
          range: `${tab}!${COL.STATUS}${foundRow}:${COL.STATUS}${foundRow}`,
          values: [[newStatus]],
        });
      }
      if (typeof newAction !== 'undefined') {
        data.push({
          range: `${tab}!${COL.ACTION}${foundRow}:${COL.ACTION}${foundRow}`,
          values: [[newAction]],
        });
      }
      if (data.length === 0) return err(400, 'Nothing to update');

      // 3) نفّذ batchUpdate
      const upd = await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data,
        },
      });

      return ok({ ok: true, updated: upd.data.totalUpdatedCells || 0, row: foundRow });
    }

    return err(405, 'Method Not Allowed');
  } catch (e) {
    console.error('sheets function error:', e);
    return err(500, e.message || 'Server error');
  }
};
