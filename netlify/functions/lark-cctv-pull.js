// netlify/functions/lark-cctv-pull.js
const LARK_TOKEN_URL =
  'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal';
const LARK_SHEETS_BATCH_GET = (spreadsheetToken) =>
  `https://open.larksuite.com/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values_batch_get`;

exports.handler = async () => {
  try {
    const app_id = process.env.LARK_APP_ID;
    const app_secret = process.env.LARK_APP_SECRET;
    const spreadsheetToken = process.env.LARK_SHEET_TOKEN;      // توكن ملف الشيت
    const sheetName = process.env.LARK_SHEET_CCTV || 'CCTV';     // اسم التبويب

    if (!app_id || !app_secret || !spreadsheetToken) {
      return json({ ok: false, error: 'Missing Lark env vars' }, 500);
    }

    // 1) token
    const tokRes = await fetch(LARK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ app_id, app_secret })
    });
    const tokJson = await tokRes.json();
    const tenantAccessToken = tokJson?.tenant_access_token;
    if (!tenantAccessToken) return json({ ok:false, error:'Failed getting tenant_access_token', raw: tokJson }, 502);

    // 2) read sheet
    const ranges = [`${sheetName}!A1:Z2000`];
    const api = LARK_SHEETS_BATCH_GET(spreadsheetToken) + '?' + new URLSearchParams({ ranges }).toString();
    const sheetRes = await fetch(api, { headers: { Authorization: `Bearer ${tenantAccessToken}` } });
    const sheetJson = await sheetRes.json();
    const valueRanges = sheetJson?.data?.valueRanges || [];
    const values = valueRanges[0]?.values || [];
    if (!values.length) return json({ ok: true, tickets: [] });

    const headers = values[0].map(h => (h || '').toString().trim());
    const rows = values.slice(1);

    // طابق أسماء الأعمدة كما هي في الشيت
    const mapIdx = indexer(headers, {
      status:       'Case Status',
      branch:       'Branch',
      date:         'Date',
      time:         'Time',
      cameras:      'Camera(s)',
      sections:     'Section(s)',
      staff:        'Staff Involved',
      reviewType:   'Review Type',
      violations:   'Violated Policy',
      notes:        'Case Details',
      actionTaken:  'Action Taken'
    });

    const tickets = rows
      .filter(r => r.some(cell => (cell || '').toString().trim() !== ''))
      .map(r => {
        const dateStr = pick(r, mapIdx.date);
        const timeStr = pick(r, mapIdx.time);
        const dateTimeISO = toISOFromDateTime(dateStr, timeStr);
        const splitList = (val) => (val ? val.split(',').map(s => s.trim()).filter(Boolean) : []);
        const t = {
          status: pick(r, mapIdx.status) || 'Under Review',
          branch: pick(r, mapIdx.branch) || '',
          date:   dateStr || '',
          time:   timeStr || '',
          dateTime: dateTimeISO || '',
          cameras:   splitList(pick(r, mapIdx.cameras)),
          sections:  splitList(pick(r, mapIdx.sections)),
          staff:     splitList(pick(r, mapIdx.staff)),
          violations:splitList(pick(r, mapIdx.violations)),
          reviewType:  pick(r, mapIdx.reviewType) || '',
          notes:       pick(r, mapIdx.notes) || '',
          actionTaken: pick(r, mapIdx.actionTaken) || '',
          createdAt: new Date().toISOString()
        };
        t._key = buildKey(t);
        return t;
      });

    return json({ ok: true, tickets });

  } catch (err) {
    return json({ ok:false, error: err.message }, 500);
  }
};

function json(obj, statusCode = 200) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) };
}
function indexer(headers, map) {
  const idx = {};
  for (const key in map) idx[key] = headers.findIndex(h => h.toLowerCase() === map[key].toLowerCase());
  return idx;
}
function pick(row, i) { return i >= 0 ? (row[i] || '').toString().trim() : ''; }
function toISOFromDateTime(dateStr, timeStr) {
  const d = (dateStr || '').trim(), t = (timeStr || '').trim();
  if (!d && !t) return '';
  const combined = d && t ? `${d} ${t}` : (d || t);
  const parsed = new Date(combined);
  return isNaN(parsed) ? combined : parsed.toISOString();
}
function buildKey(t) {
  return [
    (t.date || '').slice(0,10),
    (t.time || ''),
    (t.branch || ''),
    (t.reviewType || ''),
    (t.notes || '').slice(0,20)
  ].join('|').toLowerCase();
}
