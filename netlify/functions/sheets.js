// netlify/functions/sheets.js  (CommonJS)
const { google } = require('googleapis');

/* ------------------------ helpers: http ------------------------ */
function ok(data, extraHeaders = {}) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-App-Secret',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
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
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-App-Secret',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    },
    body: JSON.stringify({ error: message }),
  };
}

/* ------------------ auth: service account to Sheets ------------------ */
async function getSheetsClient() {
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credsJson) throw new Error('Missing GOOGLE_APPLICATION_CREDENTIALS_JSON');

  let creds;
  try { creds = JSON.parse(credsJson); }
  catch { throw new Error('Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON (not valid JSON)'); }

  const auth = new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

/* ----------------- multi-sheet mapping (by section/tab) ---------------- */
const SHEET_IDS = {
  cctv:          process.env.GOOGLE_SHEET_ID_CCTV,
  ce:            process.env.GOOGLE_SHEET_ID_CUSTOMER_EXPERIENCE,
  complaints:    process.env.GOOGLE_SHEET_ID_DAILY_COMPLAINTS,
  'free-orders': process.env.GOOGLE_SHEET_ID_COMPLIMENTARY,
  'time-table':  process.env.GOOGLE_SHEET_ID_THYME_TABLE_PLATES,
};

// fallback لو لسه عندك GOOGLE_SHEET_ID قديم
const DEFAULT_SHEET_ID =
  SHEET_IDS.cctv ||
  process.env.GOOGLE_SHEET_ID ||
  SHEET_IDS['free-orders'] ||
  SHEET_IDS.ce ||
  SHEET_IDS.complaints ||
  SHEET_IDS['time-table'];

// اختَر Spreadsheet ID حسب السكشن أو اسم التاب/الرينج
function pickSpreadsheetId({ section, tab, range } = {}) {
  if (section && SHEET_IDS[section]) return SHEET_IDS[section];

  const name = (tab || (range ? String(range).split('!')[0] : '') || '').trim();
  if (/^CCTV/i.test(name)) return SHEET_IDS.cctv || DEFAULT_SHEET_ID;
  if (/^CircaCustomerExperience/i.test(name)) return SHEET_IDS.ce || DEFAULT_SHEET_ID;
  if (/^DailyComplaints/i.test(name)) return SHEET_IDS.complaints || DEFAULT_SHEET_ID;
  if (/^Complimentary/i.test(name)) return SHEET_IDS['free-orders'] || DEFAULT_SHEET_ID;
  if (/^ThymeTablePlates/i.test(name)) return SHEET_IDS['time-table'] || DEFAULT_SHEET_ID;

  return DEFAULT_SHEET_ID;
}

// أعمدة كل سكشن (مفتاح/حالة/أكشن) — لازم تطابق تصميم شيتاتك
const SECTION_COLS = {
  cctv:          { key: 'K', status: 'A', action: 'J' }, // caseNumber K, status A, actionTaken J
  ce:            { key: 'P', status: 'A', action: 'N' },
  complaints:    { key: 'N', status: 'A', action: 'M' },
  'free-orders': { key: 'M', status: 'A', action: 'L' },
  'time-table':  { key: 'K', status: 'A', action: 'B' }, // ملاحظة: B = note بدال action
};
function getCols(section = 'cctv') { return SECTION_COLS[section] || SECTION_COLS.cctv; }

/* ------------------------------ handler ------------------------------ */
exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') return ok({ ok: true });

    // (اختياري) حماية برأس سري
    const appSecret = process.env.APP_SECRET;
    if (appSecret) {
      const clientSecret =
        event.headers['x-app-secret'] ||
        event.headers['X-App-Secret'] ||
        event.headers['x-app-secret'];
      if (clientSecret !== appSecret) return err(401, 'Unauthorized');
    }

    const sheets = await getSheetsClient();

    /* ------------------------------- GET ------------------------------- */
    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      const range = qs.range || 'Sheet1!A1:D20';
      const spreadsheetId = pickSpreadsheetId({ section: qs.section, range });
      if (!spreadsheetId) return err(500, 'No Spreadsheet ID configured');
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      return ok(res.data);
    }

    /* ------------------------------ POST (append) ------------------------------ */
    if (event.httpMethod === 'POST') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); }
      catch { return err(400, 'Invalid JSON body'); }

      const section = body.section || undefined;
      const range   = body.range || body.tab || 'CCTV_Sep2025'; // append يفهم اسم التاب
      const spreadsheetId = pickSpreadsheetId({ section, tab: range });
      if (!spreadsheetId) return err(500, 'No Spreadsheet ID configured');

      let values = body.values ?? body.value ?? body.row ?? null;
      if (!values && Array.isArray(body) && body.length) values = body;
      if (values && !Array.isArray(values[0])) values = [values];
      if (!Array.isArray(values) || values.length === 0) {
        return err(400, 'Body must include non-empty "values" array');
      }

      const appendRes = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range, // اسم التاب
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
      });
      return ok(appendRes.data);
    }

    /* ------------------------------ PUT (update by key) ------------------------------ */
    if (event.httpMethod === 'PUT') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); }
      catch { return err(400, 'Invalid JSON body'); }

      const section = String(body.section || 'cctv');
      const tab     = String(body.tab || 'CCTV_Sep2025');
      const spreadsheetId = pickSpreadsheetId({ section, tab });
      if (!spreadsheetId) return err(500, 'No Spreadsheet ID configured');

      const caseNumber = (body.caseNumber || '').toString().trim();
      const newStatus  = (body.status ?? '').toString();
      const newAction  = (body.actionTaken ?? '').toString();
      if (!caseNumber) return err(400, 'caseNumber is required');
      if (!newStatus && !newAction) return err(400, 'Nothing to update');

      const { key: COL_CASE, status: COL_STATUS, action: COL_ACTION } = getCols(section);

      // اقرأ عمود المفتاح لتحديد الصف
      const colRange = `${tab}!${COL_CASE}:${COL_CASE}`;
      const read = await sheets.spreadsheets.values.get({ spreadsheetId, range: colRange });
      const rows = (read.data.values || []);
      let rowIndex = -1; // 1-based
      for (let i = 0; i < rows.length; i++) {
        if ((rows[i][0] || '').toString().trim() === caseNumber) { rowIndex = i + 1; break; }
      }
      if (rowIndex < 1) return err(404, 'caseNumber not found');

      // جهّز التحديثات
      const dataUpdates = [];
      if (newStatus) {
        dataUpdates.push({
          range: `${tab}!${COL_STATUS}${rowIndex}:${COL_STATUS}${rowIndex}`,
          values: [[newStatus]],
        });
      }
      if (newAction || newAction === '') {
        dataUpdates.push({
          range: `${tab}!${COL_ACTION}${rowIndex}:${COL_ACTION}${rowIndex}`,
          values: [[newAction]],
        });
      }
      if (!dataUpdates.length) return err(400, 'Nothing to update');

      const upd = await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: dataUpdates },
      });

      return ok({ ok: true, row: rowIndex, totalUpdatedCells: upd.data.totalUpdatedCells || 0 });
    }

    /* ------------------------------ DELETE (delete by key) ------------------------------ */
    if (event.httpMethod === 'DELETE') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); }
      catch { return err(400, 'Invalid JSON body'); }

      const section = String(body.section || 'cctv');
      const tab     = String(body.tab || 'CCTV_Sep2025');
      const spreadsheetId = pickSpreadsheetId({ section, tab });
      if (!spreadsheetId) return err(500, 'No Spreadsheet ID configured');

      const caseNumber = String(body.caseNumber || '').trim();
      if (!caseNumber) return err(400, 'caseNumber is required');

      const { key: COL_CASE } = getCols(section);

      // ابحث عن الصف عبر عمود المفتاح
      const colRange = `${tab}!${COL_CASE}:${COL_CASE}`;
      const read = await sheets.spreadsheets.values.get({ spreadsheetId, range: colRange });
      const rows = read.data.values || [];
      let rowIndex = -1; // 1-based
      for (let i = 0; i < rows.length; i++) {
        if ((rows[i][0] || '').toString().trim() === caseNumber) { rowIndex = i + 1; break; }
      }
      if (rowIndex < 1) return ok({ ok: true, note: 'not found' });

      // جيب sheetId الخاص بالتاب
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const sheet = (meta.data.sheets || []).find(s => s.properties.title === tab);
      if (!sheet) return err(404, 'Sheet not found');
      const sheetId = sheet.properties.sheetId;

      // احذف الصف (تأكد ما تحذف الهيدر)
      const startIndex = Math.max(1, rowIndex - 1); // 0-based; صف 0 هو الهيدر الافتراضي عند كثيرين
      const endIndex   = startIndex + 1;

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex, endIndex }
            }
          }]
        }
      });

      return ok({ ok: true, deletedRow: rowIndex });
    }

    return err(405, 'Method not allowed');
  } catch (e) {
    return err(500, e.message || 'Server error');
  }
};
