// netlify/functions/sync-sheet.js
// Full Lark Sheets bridge: GET (list), POST (append), PUT (update row)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };

// ===== ENV =====
const {
  LARK_APP_ID,
  LARK_APP_SECRET,
  LARK_SPREADSHEET_TOKEN, // e.g. YTVBwkRztibHsskxAy0lZTWggch
  LARK_SHEET_RANGE,       // e.g. "July 2025!A1:K2000"
} = process.env;

function assertEnv() {
  const missing = [];
  if (!LARK_APP_ID) missing.push("LARK_APP_ID");
  if (!LARK_APP_SECRET) missing.push("LARK_APP_SECRET");
  if (!LARK_SPREADSHEET_TOKEN) missing.push("LARK_SPREADSHEET_TOKEN");
  if (!LARK_SHEET_RANGE) missing.push("LARK_SHEET_RANGE");
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
}

// ====== A1 helpers ======
function splitRange(a1) {
  // "July 2025!A1:K2000" -> { sheet: 'July 2025', startCol:'A', startRow:1, endCol:'K', endRow:2000 }
  const [sheet, range] = a1.split("!");
  const [start, end] = range.split(":");
  const parse = (ref) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) throw new Error(`Bad A1 ref: ${ref}`);
    return { col: m[1], row: Number(m[2]) };
  };
  const s = parse(start);
  const e = parse(end);
  return { sheet, startCol: s.col, startRow: s.row, endCol: e.col, endRow: e.row };
}
function colLettersToIndex(letters) {
  // A -> 0, B -> 1, ..., Z -> 25, AA -> 26
  let n = 0;
  for (const ch of letters) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}
function colIndexToLetters(index) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ===== Lark helpers =====
async function getTenantAccessToken() {
  const res = await fetch(
    "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
    }
  );
  const data = await res.json();
  if (!res.ok || !data.tenant_access_token) {
    throw new Error(`Failed to get tenant_access_token: ${res.status} ${JSON.stringify(data)}`);
  }
  return data.tenant_access_token;
}

async function larkApi(path, { method = "GET", body } = {}) {
  const token = await getTenantAccessToken();
  const res = await fetch(`https://open.larksuite.com${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Lark API ${path} failed: ${res.status} ${JSON.stringify(data)}`);
  }
  if (typeof data.code === "number" && data.code !== 0) {
    throw new Error(`Lark API error ${path}: ${data.code} ${data.msg || data.message}`);
  }
  return data;
}

// Read a range values
async function readSheetRange(range) {
  const encRange = encodeURIComponent(range);
  const path = `/open-apis/sheets/v2/spreadsheets/${LARK_SPREADSHEET_TOKEN}/values?range=${encRange}`;
  const data = await larkApi(path, { method: "GET" });
  const values =
    data?.data?.valueRange?.values ||
    data?.data?.valueRanges?.[0]?.values ||
    [];
  return values;
}

// Append a row at end (use whole columns A:K to always append)
async function appendRow(sheet, startColIdx, endColIdx, rowValues) {
  const startLetter = colIndexToLetters(startColIdx);
  const endLetter = colIndexToLetters(endColIdx);
  const range = `${sheet}!${startLetter}:${endLetter}`;

  const path = `/open-apis/sheets/v2/spreadsheets/${LARK_SPREADSHEET_TOKEN}/values_append`;
  const body = {
    valueRange: {
      range,
      majorDimension: "ROWS",
      values: [rowValues],
    },
    insertDataOption: "INSERT_ROWS",
    valueInputOption: "USER_ENTERED",
  };
  const data = await larkApi(path, { method: "POST", body });
  return data;
}

// Update a specific row range
async function writeRow(sheet, startColIdx, endColIdx, rowNumber, rowValues) {
  const startLetter = colIndexToLetters(startColIdx);
  const endLetter = colIndexToLetters(endColIdx);
  const range = `${sheet}!${startLetter}${rowNumber}:${endLetter}${rowNumber}`;
  const path = `/open-apis/sheets/v2/spreadsheets/${LARK_SPREADSHEET_TOKEN}/values`;
  const body = {
    valueRange: {
      range,
      majorDimension: "ROWS",
      values: [rowValues],
    },
    valueInputOption: "USER_ENTERED",
  };

  // بعض إصدارات الـ API تتوقع PUT، وبعضها POST – نجرب PUT ثم نfallback
  try {
    return await larkApi(path, { method: "PUT", body });
  } catch (e) {
    // جرّب POST كبديل
    return await larkApi(path, { method: "POST", body });
  }
}

// ===== Mapping helpers =====
const COLS = [
  "Case Status",
  "Branch",
  "Date & Time",
  "Camera",
  "Section",
  "Staff Involved",
  "Review Type",
  "Violated Policy",
  "Details/Notes",
  "Action Taken",
];

function headerIndexes(header) {
  const idx = {};
  for (const name of COLS) {
    idx[name] = header.indexOf(name);
  }
  return idx;
}

function safe(row, j) {
  if (j === -1) return "";
  return row?.[j] ?? "";
}

function rowsToTickets(values) {
  if (!values || values.length === 0) return [];
  const header = values[0].map(h => String(h || "").trim());
  const idx = headerIndexes(header);

  const rows = values.slice(1);
  const out = [];
  rows.forEach((r, i) => {
    const hasAny = (r || []).some(v => String(v || "").trim().length > 0);
    if (!hasAny) return;

    out.push({
      _row: i + 2, // الصف الحقيقي داخل الشيت
      status: safe(r, idx["Case Status"]),
      branch: safe(r, idx["Branch"]),
      dateTime: safe(r, idx["Date & Time"]),
      camera: safe(r, idx["Camera"]),
      section: safe(r, idx["Section"]),
      staffInvolved: safe(r, idx["Staff Involved"]),
      reviewType: safe(r, idx["Review Type"]),
      violatedPolicy: safe(r, idx["Violated Policy"]),
      details: safe(r, idx["Details/Notes"]),
      actionTaken: safe(r, idx["Action Taken"]),
    });
  });
  return { tickets: out, header };
}

function bodyToRowArray(body, header) {
  // نبني الصف حسب ترتيب الأعمدة في الشيت
  const map = {
    "Case Status": body.status ?? "",
    "Branch": body.branch ?? "",
    "Date & Time": body.dateTime ?? "",
    "Camera": body.camera ?? "",
    "Section": body.section ?? "",
    "Staff Involved": body.staffInvolved ?? "",
    "Review Type": body.reviewType ?? "",
    "Violated Policy": body.violatedPolicy ?? "",
    "Details/Notes": body.details ?? "",
    "Action Taken": body.actionTaken ?? "",
  };
  return header.map(h => map[h] ?? "");
}

function mergeUpdateRow(existingRow, header, patch) {
  // بحدّث فقط الحقول اللي وصلت في PATCH
  const map = {
    status: "Case Status",
    branch: "Branch",
    dateTime: "Date & Time",
    camera: "Camera",
    section: "Section",
    staffInvolved: "Staff Involved",
    reviewType: "Review Type",
    violatedPolicy: "Violated Policy",
    details: "Details/Notes",
    actionTaken: "Action Taken",
  };
  const next = existingRow.slice();
  for (const k of Object.keys(patch || {})) {
    if (!(k in map)) continue;
    const colName = map[k];
    const j = header.indexOf(colName);
    if (j >= 0) next[j] = patch[k];
  }
  return next;
}

// ===== Handler =====
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: CORS, body: "" };
    }
    assertEnv();

    // parse range info
    const { sheet, startCol, endCol } = splitRange(LARK_SHEET_RANGE);
    const startColIdx = colLettersToIndex(startCol);
    const endColIdx = colLettersToIndex(endCol);

    if (event.httpMethod === "GET") {
      const values = await readSheetRange(LARK_SHEET_RANGE);
      const { tickets } = rowsToTickets(values);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ ok: true, count: tickets.length, tickets }),
      };
    }

    if (event.httpMethod === "POST") {
      // add new row
      const body = JSON.parse(event.body || "{}");
      const values = await readSheetRange(LARK_SHEET_RANGE);
      const header = (values[0] || COLS); // fallback if فاضي
      const row = bodyToRowArray(body, header);
      await appendRow(sheet, startColIdx, endColIdx, row);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ ok: true }),
      };
    }

    if (event.httpMethod === "PUT") {
      // update row by id/_row
      const body = JSON.parse(event.body || "{}");
      const rowNum = Number(body.id ?? body._row);
      if (!rowNum || rowNum < 2) {
        return {
          statusCode: 400,
          headers: JSON_HEADERS,
          body: JSON.stringify({ ok: false, error: "id (/_row) is required and must be >= 2" }),
        };
      }

      const values = await readSheetRange(LARK_SHEET_RANGE);
      if (!values.length) {
        return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ ok: false, error: "Sheet empty" }) };
      }
      const header = values[0];
      const rowIndex = rowNum - 1;           // 1-based index
      const curr = values[rowIndex] || new Array(header.length).fill("");

      // patch fields
      const updated = mergeUpdateRow(curr, header, body);

      await writeRow(sheet, startColIdx, endColIdx, rowNum, updated);

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ ok: true, row: rowNum }),
      };
    }

    return {
      statusCode: 405,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: "Method Not Allowed" }),
    };
  } catch (err) {
    console.error("sync-sheet error:", err);
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
