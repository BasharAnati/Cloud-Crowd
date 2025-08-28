// netlify/functions/sheets.js  (CommonJS)
const { google } = require('googleapis');

function ok(data, extraHeaders = {}) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
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

exports.handler = async (event) => {
  try {
    // optional app secret
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

    // ---------- GET: read range ----------
    if (event.httpMethod === 'GET') {
      const range = (event.queryStringParameters || {}).range || 'Sheet1!A1:D20';
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      return ok(res.data);
    }

    // ---------- POST: append rows ----------
    if (event.httpMethod === 'POST') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); }
      catch { return err(400, 'Invalid JSON body'); }

      const range = body.range || 'CCTV_July2025';
      let values = body.values ?? body.value ?? body.row ?? null;

      if (!values && Array.isArray(body) && body.length) values = body;
      if (values && !Array.isArray(values[0])) values = [values];

      if (!Array.isArray(values) || values.length === 0) {
        return err(400, 'Body must include non-empty "values" array');
      }

      const appendRes = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
      });
      return ok(appendRes.data);
    }

    // ---------- PUT: update by caseNumber ----------
    if (event.httpMethod === 'PUT') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); }
      catch { return err(400, 'Invalid JSON body'); }

      const tab         = body.tab || 'CCTV_July2025';
      const caseNumber  = (body.caseNumber || '').toString().trim();
      const newStatus   = (body.status ?? '').toString();
      const newAction   = (body.actionTaken ?? '').toString();

      if (!caseNumber) return err(400, 'caseNumber is required');
      if (!newStatus && !newAction) return err(400, 'Nothing to update');

      // الأعمدة: K = caseNumber, A = status, J = actionTaken
      const COL_CASE   = 'K';
      const COL_STATUS = 'A';
      const COL_ACTION = 'J';

      // اقرأ عمود K كامل للعثور على الصف
      const colRange = `${tab}!${COL_CASE}:${COL_CASE}`;
      const read = await sheets.spreadsheets.values.get({ spreadsheetId, range: colRange });
      const rows = (read.data.values || []);
      let rowIndex = -1; // 1-based
      for (let i = 0; i < rows.length; i++) {
        if ((rows[i][0] || '').toString().trim() === caseNumber) {
          rowIndex = i + 1;
          break;
        }
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
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: dataUpdates,
        },
      });

      return ok({ ok: true, row: rowIndex, totalUpdatedCells: upd.data.totalUpdatedCells || 0 });
    }

    return err(405, 'Method not allowed');
  } catch (e) {
    return err(500, e.message || 'Server error');
  }
};
