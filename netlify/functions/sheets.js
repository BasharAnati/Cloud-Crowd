// netlify/functions/sheets.js  (CommonJS)
const { google } = require('googleapis');

function ok(data, extraHeaders = {}) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // بالإنتاج: استبدل * بدومينك
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-App-Secret',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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

exports.handler = async (event) => {
  try {
    // حماية بسيطة اختيارية
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

    if (event.httpMethod === 'GET') {
      // مثال: ?range=Sheet1!A1:D20
      const range = (event.queryStringParameters || {}).range || 'Sheet1!A1:D20';
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      return ok(res.data);
    }

    if (event.httpMethod === 'POST') {
      // سجّل البودي الخام لتشخيص أي مشكلة في الإرسال
      console.log('RAW_BODY:', event.body);

      let body = {};
      try {
        body = JSON.parse(event.body || '{}');
      } catch {
        return err(400, 'Invalid JSON body');
      }

      // نسمح بأكثر من اسم / صيغة
      const range = body.range || 'CCTV_July2025';
      let values = body.values ?? body.value ?? body.row ?? null;

      // لو البودي نفسه Array (مثل [["a","b"]]) اعتبره values
      if (!values && Array.isArray(body) && body.length) values = body;

      // لو أرسل صف واحد فقط ["a","b"] نحوله [["a","b"]]
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

    // لو الميثود غير GET/POST
    return err(405, 'Method Not Allowed');
  } catch (e) {
    console.error(e);
    return err(500, e.message || 'Internal Error');
  }
};
