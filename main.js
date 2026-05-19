// ============================
// Cloud Crowd - main.js (DB-integrated + currentSection binding + image thumbs)
// ============================

// ----------------------------
// Storage (in-memory + localStorage bootstrap)
// ----------------------------
let tickets = JSON.parse(localStorage.getItem('cloudCrowdTickets')) || {
  cctv: [],
  ce: [],
  'free-orders': [],
  complaints: [],
  'time-table': []
};

// المتغيّر الداخلي الحقيقي
let _currentSection = '';

// اربط window.currentSection بهذا المتغيّر (حل مشكلة عدم ظهور الأعمدة بعد الريفريش)
Object.defineProperty(window, 'currentSection', {
  get() { return _currentSection; },
  set(v) { _currentSection = v; },
  configurable: true
});


// اسم المستخدم الحالي (من صفحة اللوجين)






// ==== Google Sheets Bridge (موحّد لكل الأقسام) ====
const SHEETS_ENDPOINT = "/.netlify/functions/sheets";
const SHEETS_APP_SECRET = "";

// أعلى الملف مع باقي الثوابت
const SEEDED_CASES_KEY = 'cloudCrowdSeededCases';

function getSeededMap(){
  try { return JSON.parse(localStorage.getItem(SEEDED_CASES_KEY)) || {}; }
  catch { return {}; }
}
function markSeeded(section, key){
  const map = getSeededMap();
  (map[section] ||= {})[key] = true;
  localStorage.setItem(SEEDED_CASES_KEY, JSON.stringify(map));
}
function wasSeeded(section, key){
  const map = getSeededMap();
  return !!(map[section] && map[section][key]);
}


// يحوّل الملف لصيغة Data URL (Base64)



// يساعدنا نعرف إذا القيمة صورة (string data:, blob:, http) أو object {dataUrl}


/* ==== Sheets row builders & sender ==== */
function rowFromTicketCCTV(t) {
  const dateTime =
    (t.date && t.time) ? `${t.date} ${t.time}` :
    (t.dateTime ? t.dateTime : "");

  const cameras  = Array.isArray(t.cameras)  ? t.cameras.join(', ')  : (t.cameras  || '');
  const sections = Array.isArray(t.sections) ? t.sections.join(', ') : (t.sections || '');
  const staff    = Array.isArray(t.staff)    ? t.staff.join(', ')    : (t.staff    || '');
  const viols    = Array.isArray(t.violations)? t.violations.join(', '):(t.violations||'');

  // رتّبها حسب أعمدة ورقتك
  return [
    t.status || 'Under Review',
    t.branch || '',
    dateTime || '',
    cameras,
    sections,
    staff,
    t.reviewType || '',
    viols,
    t.notes || t.caseDescription || t.customerNotes || '',
    t.actionTaken || '',
    t.caseNumber || '',
    t.createdBy || '',
    t.createdAt || ''
  ];
}

// === CE ===
function rowFromTicketCE(t) {
  return [
    t.status || 'Under Review',           // A: Status
    t.department || '',                   // B: Department Responsible
    t.customerName || '',                 // C: Customer Name
    t.phone || '',                        // D: Phone Number
    t.creationDate || '',                 // E: Creation Date
    t.shift || '',                        // F: Shift
    t.orderType || '',                    // G: Order Type
    t.branch || '',                       // H: Branch Name
    t.restaurant || '',                   // I: Restaurant
    t.channel || '',                      // J: Order Channel
    t.feedbackDate || '',                 // K: Feedback Date
    t.issueCategory || '',                // L: Issue Category
    t.customerNotes || '',                // M: Customer Experience Notes
    t.actionTaken || '',                  // N: Action Taken
    t.satisfaction || '',                 // O: Customer Satisfaction Level
    t.caseNumber || t.orderNumber || ''   // P: Order Number (Key)
  ];
}


// === Complaints ===
// === Complaints ===
function rowFromTicketComplaints(t) {
  return [
    t.status || 'Under Review',           // A: Status
    t.department || '',                   // B: Department Responsible
    t.customerName || '',                 // C: Customer Name
    t.phone || '',                        // D: Phone Number
    t.creationDate || '',                 // E: Creation Date
    t.shift || '',                        // F: Shift
    t.orderType || '',                    // G: Order Type
    t.branch || '',                       // H: Branch Name
    t.restaurant || '',                   // I: Restaurant
    t.channel || '',                      // J: Order Channel
    t.issueCategory || '',                // K: Issue Category
    t.complaintDetails || '',             // L: Complaint Details
    t.actionTaken || '',                  // M: Action Taken
    t.caseNumber || t.orderNumber || ''   // N: Order Number
  ].slice(0, 14); // Ensure we have only columns A to N
}



// === Free Orders (Complimentary) ===
// الشيت: A Status, B Customer Name, C Phone, D Order Date,
// E Discount Amount, F Reason for Discount, G Decision Maker,
// H Discount Date, I New Order Number, J Deduction From,
// K Case Description, L Action Taken, M Order Number (key)
function rowFromTicketFreeOrders(t) {
  return [
    t.status || 'Active',            // A
    t.customerName || '',            // B
    t.phone || '',                   // C
    t.orderDate || '',               // D
    t.discountAmount || '',          // E
    t.reasonForDiscount || '',       // F
    t.decisionMaker || '',           // G
    t.discountDate || '',            // H
    t.newOrderNumber || '',          // I
    t.deductionFrom || '',           // J
    t.caseDescription || '',         // K
    t.actionTaken || '',             // L
    t.orderNumber || t.caseNumber || '' // M (key)
  ];
}

// === Time Table ===
// (مراعاة خريطة السيرفر: status=A, note=B (هي الـaction بالسيرفر), F=returnDate, G=amountToBeRefunded, H=deliveryFees, K=key)
// A..K = Status, Note, Customer Name, Phone, Order Date, Return Date,
//        Amount to Be Refunded, Delivery Fees, Plates Quantity, Plates Numbers, Case Number
function rowFromTicketTimeTable(t) {
  return [
    t.status || 'Pending Call',        // A
    t.note || '',                      // B
    t.customerName || '',              // C
    t.phone || '',                     // D
    t.orderDate || '',                 // E
    t.returnDate || '',                // F
    t.amountToBeRefunded || '',        // G
    t.deliveryFees || '',              // H
    t.platesQuantity || '',            // I
    t.platesNumbers || '',             // J
    (t.caseNumber || t.orderNumber || '') // K  ← المفتاح الظاهر في الموقع كـ Case Number
  ];
}


async function pushToSheets(section, ticket) {
  if (!section) return;

  const headers = getAuthHeaders({ "Content-Type": "application/json" });
  if (SHEETS_APP_SECRET) headers["X-App-Secret"] = SHEETS_APP_SECRET;

  let row;
  if (section === 'cctv') row = rowFromTicketCCTV(ticket);
  else if (section === 'ce') row = rowFromTicketCE(ticket);
  else if (section === 'complaints') row = rowFromTicketComplaints(ticket);
  else if (section === 'free-orders') row = rowFromTicketFreeOrders(ticket);
  else if (section === 'time-table') row = rowFromTicketTimeTable(ticket);
  else return; // قسم غير معروف

  const res = await fetch(SHEETS_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({
      section,     // للسيرفر عشان يختار الـ Spreadsheet
      values: [row]
    })
  });
  if (handleAuthFailure(res)) return;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Sheets error ${res.status}`);
  return data;
}


/* ==== end Sheets helpers ==== */


/* ==== Sheets → App (pull) ==== */
/* ==== Sheets → App (pull) ==== */
function ticketFromSheetRowCCTV(r = []) {
  const [
    status,      // A
    branch,      // B
    dateTime,    // C
    cameras,     // D
    sections,    // E
    staff,       // F
    reviewType,  // G
    violations,  // H
    notes,       // I
    actionTaken, // J
    caseNumber,  // K
    createdBy,   // L
    createdAt    // M
  ] = r;

  return {
    status: status || 'Under Review',
    branch: branch || '',
    dateTime: dateTime || '',
    cameras: cameras ? String(cameras).split(/\s*,\s*/) : [],
    sections: sections ? String(sections).split(/\s*,\s*/) : [],
    staff: staff ? String(staff).split(/\s*,\s*/) : [],
    reviewType: reviewType || '',
    violations: violations ? String(violations).split(/\s*,\s*/) : [],
    notes: notes || '',
    actionTaken: actionTaken || '',
    caseNumber: caseNumber || '',
    createdBy: createdBy || '',
    createdAt: createdAt || '',
  };
} // ⬅️ سكّرنا دالة CCTV هنا

// CE
function ticketFromSheetRowCE(r = []) {
  const [
    status, department, customerName, phone,
    creationDate, shift, orderType, branch,
    restaurant, channel, feedbackDate, issueCategory,
    customerNotes, actionTaken, satisfaction, orderNumber
  ] = r; // A..P

  return {
    status: status || 'Under Review',
    department: department || '',
    customerName: customerName || '',
    phone: phone || '',
    creationDate: creationDate || '',
    shift: shift || '',
    orderType: orderType || '',
    branch: branch || '',
    restaurant: restaurant || '',
    channel: channel || '',
    feedbackDate: feedbackDate || '',
    issueCategory: issueCategory || '',
    customerNotes: customerNotes || '',
    actionTaken: actionTaken || '',
    satisfaction: satisfaction || '',
    caseNumber: orderNumber || '',
    orderNumber: orderNumber || ''
  };
}


// Complaints
function ticketFromSheetRowComplaints(r = []) {
  const [
    status, department, customerName, phone,
    creationDate, shift, orderType, branch,
    restaurant, channel, issueCategory,
    complaintDetails, actionTaken, caseNumber
  ] = r; // A..N

  return {
    status: status || 'Under Review',
    department: department || '',
    customerName: customerName || '',
    phone: phone || '',
    creationDate: creationDate || '',
    shift: shift || '',
    orderType: orderType || '',
    branch: branch || '',
    restaurant: restaurant || '',
    channel: channel || '',
    issueCategory: issueCategory || '',
    complaintDetails: complaintDetails || '',
    actionTaken: actionTaken || '',
    caseNumber: caseNumber || ''
  };
}



// Free Orders
function ticketFromSheetRowFreeOrders(r = []) {
  const [
    status, customerName, phone, orderDate,
    discountAmount, reasonForDiscount, decisionMaker,
    discountDate, newOrderNumber, deductionFrom,
    caseDescription, actionTaken, orderNumber // ← عمود M
  ] = r; // A..M

  return {
    status: status || 'Active',
    customerName: customerName || '',
    phone: phone || '',
    orderDate: orderDate || '',
    discountAmount: discountAmount || '',
    reasonForDiscount: reasonForDiscount || '',
    decisionMaker: decisionMaker || '',
    discountDate: discountDate || '',
    newOrderNumber: newOrderNumber || '',
    deductionFrom: deductionFrom || '',
    caseDescription: caseDescription || '',
    actionTaken: actionTaken || '',
    orderNumber: orderNumber || '',
    caseNumber: orderNumber || '' // المفتاح
  };
}


// Time Table
function ticketFromSheetRowTimeTable(r = []) {
  const [
    status, note, customerName, phone, orderDate,
    returnDate, amountToBeRefunded, deliveryFees,
    platesQuantity, platesNumbers, caseNumber
  ] = r; // A..K

  return {
    status: status || 'Pending Call',       // A
    note: note || '',                       // B
    customerName: customerName || '',       // C
    phone: phone || '',                     // D
    orderDate: orderDate || '',             // E
    returnDate: returnDate || '',           // F
    amountToBeRefunded: amountToBeRefunded || '', // G
    deliveryFees: deliveryFees || '',       // H
    platesQuantity: platesQuantity || '',   // I
    platesNumbers: platesNumbers || '',     // J
    caseNumber: caseNumber || ''            // K (يُعرض في الدروَّر كـ Case Number)
  };
}








function mergeTicketsByCase(localArr, fromSheetArr, section = _currentSection) {
  const byCase = new Map();
  const sheetLegacyKeys = new Set();

  if (section === 'ce') {
    for (const s of fromSheetArr) {
      if (!s?._sheetRowKey) continue;
      const legacyKey = (s.caseNumber || s.orderNumber || '').toString().trim();
      if (legacyKey) sheetLegacyKeys.add(legacyKey);
    }
  }

  // إضافة التذاكر من localStorage إلى Map
  for (const t of localArr) {
    if (section === 'ce') {
      const legacyKey = (t.caseNumber || t.orderNumber || '').toString().trim();
      if (t._id && !t._sheetRowKey && sheetLegacyKeys.has(legacyKey)) continue;

      const key = caseKey(t);
      if (!key) continue;
      byCase.set(key, t);
      continue;
    }

    const key = t.caseNumber || t.orderNumber || ''; // تأكد من أن caseNumber أو orderNumber موجود
    if (!key) continue; // إذا لم يوجد key لا تضيف التذكرة
    byCase.set(key, t); // حفظ التذكرة باستخدام المفتاح
  }

  // إضافة التذاكر من الشيت إلى Map
  for (const s of fromSheetArr) {
    if (section === 'ce') {
      const key = caseKey(s);
      if (!key) continue;

      if (!byCase.has(key)) {
        byCase.set(key, { ...s });
      } else {
        const cur = byCase.get(key);
        byCase.set(key, { ...cur, ...s, _fromSheet: true });
      }
      continue;
    }

    const key = s.caseNumber || s.orderNumber || ''; // تأكد من أن caseNumber أو orderNumber موجود
    if (!key) continue; // إذا لم يوجد key لا تضيف التذكرة

    // إذا كانت التذكرة مفقودة من Map، أضفها مباشرة
    if (!byCase.has(key)) {
      byCase.set(key, { ...s });
    } else {
      const cur = byCase.get(key);
      // دمج التذاكر القديمة والجديدة
      // يمكن إضافة شرط للتأكد من توافق الحقول
      byCase.set(key, { ...cur, ...s, _fromSheet: true });
    }
  }

  // تحقق من حذف التذاكر التي كانت موجودة في localStorage ولكن تم حذفها من الشيت
  const finalTickets = Array.from(byCase.values());

  // تحديث localStorage
  tickets[_currentSection] = finalTickets;
  saveTicketsToStorage();

  return finalTickets;
}

// ============================================================================

async function autoSeedSheetTickets(section) {
  const arr = tickets[section] || [];
  const toSeed = [];

  for (const t of arr) {
    const key = caseKey(t);
    if (!key) continue;

    // بدنا نسيّد فقط اللي جايات من Sheets (ما عندهن _id) ولسا ما سيّدناهن قبل
    if (!t._id && !wasSeeded(section, key)) {
      toSeed.push({ key, ticket: t });
    }
  }

  if (!toSeed.length) return;

  for (const { key, ticket } of toSeed) {
    try {
      const res = await fetch('/.netlify/functions/tickets', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          section,
          status: ticket.status || 'Under Review',
          payload: ticket,
          changedBy: CURRENT_USER || 'system-seed'
        })
      });
      if (handleAuthFailure(res)) return;

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'seed failed');

      markSeeded(section, key); // علّمنا إنو اتسيّد
    } catch (e) {
      console.warn('Auto-seed failed for', section, key, e.message);
    }
  }

  // بعد ما نخلص، اسحب من الـDB عشان التكت تاخذ _id
  try {
    await hydrateFromDB(section);
    renderTickets();
  } catch {}
}

// ============================================================================





// ============================================================================

/**
 * مصالحة بعد سَحبة الشيت:
 * بنمسح محليًا أي تذكرة أصلها من الشيت ومش موجود مفتاحها بالسحبة الحالية.
 * (تذاكر الداتابيس بنتركها بحالها)
 */
function reconcileAfterSheetsPull(section, pulled) {
  const sheetKeys = new Set(pulled.map(caseKey).filter(Boolean));

  const before = tickets[section] || [];
  const after = before.filter(t => {
    const key = caseKey(t);
    if (!key) return false;           // سطر تالف بدون مفتاح
    if (!isFromSheet(t)) return true; // من الـDB → نخليها
    return sheetKeys.has(key);        // من الشيت → نخليها فقط لو لسه موجودة بالشيت
  });

  if (after.length !== before.length) {
    tickets[section] = after;
    saveTicketsToStorage();
    // ❌ احذف renderTickets() من هون
  }
}

// ============================================================================

async function hydrateFromSheets(section) {
  if (!section) return;

  try {
    const headers = getAuthHeaders();
    if (SHEETS_APP_SECRET) headers['X-App-Secret'] = SHEETS_APP_SECRET;

    const url = `${SHEETS_ENDPOINT}?section=${encodeURIComponent(section)}`;
    const res = await fetch(url, { headers });
    if (handleAuthFailure(res)) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sheets GET failed');

    const rows = (data.values || []).filter(row => row && row.length);

    let pulled = [];
    if (section === 'cctv') {
      pulled = rows.map(ticketFromSheetRowCCTV);
    } else if (section === 'ce') {
      pulled = rows.map((row, rowIndex) => ({
        ...ticketFromSheetRowCE(row),
        _sheetRowKey: `${section}:${rowIndex + 2}`
      }));
    } else if (section === 'complaints') {
      pulled = rows.map(ticketFromSheetRowComplaints);
    } else if (section === 'free-orders') {
      pulled = rows.map(ticketFromSheetRowFreeOrders);
    } else if (section === 'time-table') {
      pulled = rows.map(ticketFromSheetRowTimeTable);
    }

    if (Array.isArray(pulled) && pulled.length > 0) {
      console.log(`Hydrated from Sheets (${section}) →`, pulled.length, 'rows');
    } else {
      console.log(`No data found for section ${section} from Sheets.`);
    }

    // 1) دمج (يحدّث/يضيف)
    tickets[section] = mergeTicketsByCase(tickets[section] || [], pulled, section);

    // 2) مصالحة (يمسح محليًا أي تذكرة من الشيت انحذفت من الشيت)
    reconcileAfterSheetsPull(section, pulled);

    // 3) سيّدنغ لأي تذكرة شيت لسه ما إلها _id
    await autoSeedSheetTickets(section);

    // ✅ بعد ما يخلص الكل نحفظ ونرسم مرة واحدة فقط
    saveTicketsToStorage();
    renderTickets();

  } catch (e) {
    console.warn('hydrateFromSheets error:', e.message);
  }
}




/* ==== end Sheets helpers ==== */

// ----------------------------
// Config: main fields on cards
// ----------------------------
// ----------------------------
// Columns per section
// ----------------------------
// ----------------------------
// Display name remap (view only)
// ----------------------------


// ----------------------------
// Form fields per section
// ----------------------------


// ----------------------------
// Case numbers
// ----------------------------
const CASE_COUNTER_KEY = 'cloudCrowdCaseCounter';
const CCTV_COUNTER_KEY  = 'cloudCrowdCCTVCaseCounter';

function nextCaseNumber(section){
  if (section === 'cctv') {
    let n = parseInt(localStorage.getItem(CCTV_COUNTER_KEY) || '0', 10);
    n += 1;
    localStorage.setItem(CCTV_COUNTER_KEY, String(n));
    return `CCTV-${n}`;
  }
  const prefix = section.toUpperCase().replace(/[^A-Z0-9]+/g,'-');
  let n = parseInt(localStorage.getItem(CASE_COUNTER_KEY) || '1000', 10);
  n += 1;
  localStorage.setItem(CASE_COUNTER_KEY, String(n));
  const serial = n.toString().padStart(5,'0');
  return `${prefix}-${serial}`;
}

function ensureCaseNumbers(){
  let updated = false;
  Object.keys(tickets).forEach(sec => {
    tickets[sec].forEach(t => {
      if (sec === 'cctv' && !t.caseNumber){
        t.caseNumber = nextCaseNumber(sec);
        updated = true;
      }
    });
  });
  if (updated) saveTicketsToStorage();
}

// ----------------------------
// Storage helper
// ----------------------------
function saveTicketsToStorage(){
  localStorage.setItem('cloudCrowdTickets', JSON.stringify(tickets));
}

// ----------------------------
// Helpers
// ----------------------------


// ----------------------------
// Drawer (read/edit)
// ----------------------------
let drawerIndex = null;

function ensureDrawerActionsContainer(){
  const drawer = document.getElementById('ticket-drawer');
  if (!drawer) return null;
  let actions = drawer.querySelector('.drawer-actions');
  if (!actions){
    actions = document.createElement('div');
    actions.className='drawer-actions';
    drawer.querySelector('.drawer-panel')?.appendChild(actions);
  }
  return actions;
}

function openTicketDrawerByCase(caseNumber){
  const idx = (tickets[_currentSection]||[]).findIndex(t =>
    getCaseDisplay(t)===caseNumber || t.caseNumber===caseNumber
  );
  if (idx>=0) openTicketDrawer(idx);
}

function buildDrawerReadonly(ticket){
  const NOTE_KEYS = ['note','notes','customerNotes','complaintDetails','caseDescription'];

  let notesText = '';
  let notesKeyUsed = '';
  for (const nk of NOTE_KEYS){
    if (ticket[nk]){
      notesText = String(ticket[nk] || '').trim();
      notesKeyUsed = nk;
      break;
    }
  }

  let dateStr = ticket.date || '';
  let timeStr = ticket.time || '';
  if ((!dateStr || !timeStr) && ticket.dateTime){
    const d = new Date(ticket.dateTime);
    if (!isNaN(d)){
      if (!dateStr) dateStr = d.toISOString().split('T')[0];
      if (!timeStr) {
        const hh = String(d.getHours()).padStart(2,'0');
        const mm = String(d.getMinutes()).padStart(2,'0');
        timeStr = `${hh}:${mm}`;
      }
    }
  }

  let html = '';
  if (dateStr) html += rowKV('Date', dateStr);
  if (timeStr) html += rowKV('Time', timeStr);

  // إخفاء مفاتيح داخلية
  const IGNORE = new Set([
    'createdAt','lastModified','date','time','dateTime','actionTaken',
    'note','notes','customerNotes','complaintDetails','caseDescription',
    '_id','id','payload','section'
  ]);

  for (const k in ticket){
    if (IGNORE.has(k)) continue;
    const v = ticket[k];
    if (Array.isArray(v) && v.length){
      html += rowKV(toLabel(k), v.join(', '));
    } else if (v && typeof v !== 'object'){
      if (k === 'status'){
        html += rowKV(toLabel(k), displayStatusName(String(v)));
      } else {
        const txt = String(v).trim();
        if (txt) html += rowKV(toLabel(k), escapeHtml(txt));
      }
    }
  }

  // الملاحظات
  if (notesText){
    const noteTitle = (_currentSection === 'time-table' || notesKeyUsed === 'note') ? 'Note' : 'Case Details';
    html += `
      <div class="note-box full-span">
        <div class="note-title">${noteTitle}</div>
        <div class="note-text">${escapeHtml(notesText)}</div>
      </div>
    `;
  }

  // Action Taken
  if (ticket.actionTaken){
    const at = String(ticket.actionTaken).trim();
    if (at){
      html += `
        <div class="action-taken-box full-span">
          <div class="action-taken-title">Action Taken</div>
          <div class="action-taken-text">${escapeHtml(at)}</div>
        </div>
      `;
    }
  }

  // ✅ عرض المرفقات (thumbnail + تكبير)
  const attachmentKeys = ['orderOnCirca', 'attached']; // المفاتيح التي نعرضها كمرفقات
  const thumbs = [];
  for (const key of attachmentKeys) {
    const src = extractImageSrc(ticket[key]);
    if (src) {
      thumbs.push(`
        <div style="display:flex; flex-direction:column; align-items:flex-start; gap:6px;">
          <div style="font-weight:600">${toLabel(key)}</div>
          <img src="${src}" alt="${toLabel(key)}" class="ticket-thumb">
          <div class="muted" style="font-size:12px">انقر لتكبير الصورة</div>
        </div>
      `);
    }
  }
  if (thumbs.length) {
    html += `<div class="full-span" style="margin-top:12px; display:grid; gap:12px;">${thumbs.join('')}</div>`;
  }

  return html || '<div class="no-tickets full-span">No details.</div>';

  function rowKV(label, value){
    return `
      <div class="kv">
        <div class="k">${escapeHtml(label)}</div>
        <div class="v">${value}</div>
      </div>
    `;
  }
}

function buildDrawerEditForm(ticket){
  const statusField = formFields[_currentSection].find(f=>f.name==='status');
  const options = statusField ? statusField.options : [];

  // حقل Return Date لقسم Thyme Table Plates فقط
  const returnDateField = (_currentSection === 'time-table') ? `
    <div class="form-group">
      <label>Return Date</label>
      <input type="date" name="returnDate" value="${escapeHtml((ticket.returnDate||'').split('T')[0])}">
    </div>
  ` : '';

  // ✅ PDF يظهر فقط في CCTV + فقط للتكتات Escalated / Under Review
  const allowPdf = (_currentSection === 'cctv') && (ticket.status === 'Escalated' || ticket.status === 'Under Review');

  const pdfField = allowPdf ? `
    <div class="form-group" id="cctv-pdf-group">
      <label>Upload PDF (optional)</label>
      <input type="file" name="cctvPdf" accept="application/pdf">
      <div class="muted" style="font-size:12px;margin-top:6px;">
        PDF will be uploaded and saved to the sheet.
      </div>
    </div>
  ` : '';

  return `
    <div class="form-group">
      <label>Status</label>
      <select name="status">
        ${options.map(o=>`<option value="${o}" ${ticket.status===o?'selected':''}>${o}</option>`).join('')}
      </select>
    </div>

    ${returnDateField}

    ${pdfField}

    <div class="form-group">
      <label>Action Taken</label>
      <textarea name="actionTaken" rows="4">${escapeHtml(ticket.actionTaken||'')}</textarea>
    </div>
  `;
}



function openTicketDrawer(index){
  drawerIndex = index;
  const ticket = tickets[_currentSection][index];
  const drawer = document.getElementById('ticket-drawer');
  if (!drawer) return;

  const line = `${drawerCaseLabel()}: <span id="drawer-caseNumber"></span>`;
  drawer.querySelector('.drawer-case').innerHTML = line;
  document.getElementById('drawer-caseNumber').textContent = getCaseDisplay(ticket);

  const titleEl = document.getElementById('drawer-title');
  const metaEl  = document.getElementById('drawer-meta');
  const bodyEl  = document.getElementById('drawer-body');
  const actions = ensureDrawerActionsContainer();

  titleEl.textContent = displayStatusName(ticket.status || 'Details');
  titleEl.style.color = statusColor(ticket.status);

  // شارة الحالة + رابط السجل
   metaEl.innerHTML = `
    <span class="meta-badge ${bandClassForStatus(ticket.status)}">
      ${displayStatusName(ticket.status || 'Uncategorized')}
    </span>
    <a class="history-link" id="drawer-history-link" title="View change history">History</a>
  `;


  const histLink = document.getElementById('drawer-history-link');
  if (histLink) {
    histLink.onclick = (e) => {
      e.preventDefault();
      if (!ticket._id) { alert('No ticket id found.'); return; }
      viewTicketHistory(ticket._id);
    };
  }

  // محتوى القراءة
  bodyEl.innerHTML = buildDrawerReadonly(ticket);

  // أزرار الأكشن: Edit دائمًا + Delete لأناتي فقط
  if (actions){
    actions.innerHTML = `<button id="drawer-edit-btn" class="edit-btn">Edit</button>`;
    actions.querySelector('#drawer-edit-btn').onclick = ()=> enterDrawerEditMode();

    if (CURRENT_USER === DELETER_USERNAME) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'danger-btn';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', ()=> deleteTicket(drawerIndex));
      actions.appendChild(delBtn);
    }
  }

  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden','false');
  document.body.classList.add('drawer-open');
}


function enterDrawerEditMode(){
  if (drawerIndex==null) return;
  const ticket = tickets[_currentSection][drawerIndex];
  const bodyEl = document.getElementById('drawer-body');
  const actions = ensureDrawerActionsContainer();
  document.getElementById('drawer-title').textContent = `Edit • ${displayStatusName(ticket.status||'')}`;

  bodyEl.innerHTML = `<form id="drawer-edit-form">${buildDrawerEditForm(ticket)}</form>`;
  if (actions){
    actions.innerHTML = `
      <button id="drawer-save-btn" class="submit-btn">Save</button>
      <button id="drawer-cancel-btn" class="cancel-btn" type="button">Cancel</button>
    `;
    actions.querySelector('#drawer-save-btn').onclick = (e)=>{ e.preventDefault(); saveDrawerEdits(); };
    actions.querySelector('#drawer-cancel-btn').onclick = (e)=>{ e.preventDefault(); openTicketDrawer(drawerIndex); };
  }
}


// ----------------------------
// Save edits (local first, then server)  ✅ hydrate فقط عند النجاح
// ----------------------------
// ----------------------------
// Save edits (local first, then server + update Sheets)
// ----------------------------
async function saveDrawerEdits() {
  if (drawerIndex == null) return;
  const form = document.getElementById('drawer-edit-form');
  if (!form) return;

  const fd = new FormData(form);
  const t  = tickets[_currentSection][drawerIndex];

  // تعديل محلي
  t.status      = fd.get('status');
  t.actionTaken = fd.get('actionTaken');

  // 👈 جديد: خزن Return Date محليًا فقط لقسم time-table
  if (_currentSection === 'time-table') {
    const rd = fd.get('returnDate') || '';
    t.returnDate = rd; // YYYY-MM-DD
  }

  // ✅ CCTV PDF upload (Edit only) + only for Escalated / Under Review
  if (_currentSection === 'cctv') {
    const newStatus = String(t.status || '');
    const allowPdfNow = (newStatus === 'Escalated' || newStatus === 'Under Review');

    if (allowPdfNow && t.caseNumber) {
      const file = fd.get('cctvPdf'); // name من buildDrawerEditForm

      if (file && file.size) {
        if (file.type !== 'application/pdf') {
          alert('PDF only.');
          return;
        }

        const MAX = 8 * 1024 * 1024; // 8MB
        if (file.size > MAX) {
          alert('PDF too large. Please upload under 8MB.');
          return;
        }

        try {
          const dataUrl = await fileToDataURL(file);

          const up = await fetch('/.netlify/functions/upload-cctv-pdf', {
            method: 'POST',
            headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              caseNumber: t.caseNumber,
              pdfName: file.name,
              pdfBase64: dataUrl
            })
          });
          if (handleAuthFailure(up)) return;

          const upData = await up.json().catch(() => ({}));

          if (!up.ok || !upData.ok) {
            const msg = upData?.error || `Upload failed (HTTP ${up.status})`;
            throw new Error(msg);
          }

          // خزّن محليًا عشان يظهر فورًا لو بدك
          t.pdfName = upData.pdfName;
          t.pdfUrl  = upData.pdfUrl;

        } catch (e) {
          console.warn('PDF upload error:', e);
          alert(`PDF upload failed: ${e.message}`);
          return;
        }
      }
    }
  }

  t.lastModified = new Date().toISOString();
  saveTicketsToStorage();
  renderTickets();

  try {
    // 1) تحديث الـ DB (لو له id)
    if (Number.isFinite(Number(t._id))) {
      const res = await fetch('/.netlify/functions/tickets', {
        method: 'PUT',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: Number(t._id),
          section: String(_currentSection),
          status: String(t.status || ''),
          actionTaken: String(t.actionTaken ?? ''),
          changedBy: CURRENT_USER
        })
      });
      if (handleAuthFailure(res)) return;

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Update failed');
    } else {
      console.warn('No DB id → ticket came from Google Sheets, DB PUT skipped.');
    }

    // 2) تحديث Google Sheets دائمًا
    if (!t.caseNumber) {
      console.warn('No caseNumber on ticket → Sheets PUT skipped.');
    } else {
      const headers = getAuthHeaders({ 'Content-Type': 'application/json' });
      if (SHEETS_APP_SECRET) headers['X-App-Secret'] = SHEETS_APP_SECRET;

      const sheetBody = {
        section: _currentSection,
        caseNumber: t.caseNumber,
        status: t.status,
        actionTaken: t.actionTaken,
      };

      // 👈 time-table returnDate
      if (_currentSection === 'time-table') {
        sheetBody.returnDate = t.returnDate ?? null;
      }

      const resS = await fetch(SHEETS_ENDPOINT, {
        method: 'PUT',
        headers,
        body: JSON.stringify(sheetBody)
      });
      if (handleAuthFailure(resS)) return;

      const dataS = await resS.json().catch(() => ({}));
      if (!resS.ok || dataS?.ok === false) {
        throw new Error(dataS?.error || 'Sheets update failed');
      }
    }

    // 3) ريفرش
    await hydrateFromDB(_currentSection);
    await hydrateFromSheets(_currentSection);

  } catch (err) {
    console.warn('Update failed:', err);
    alert('Failed to save changes to the server.');
  }

  // حاول افتح نفس التكت بعد الريفريش بطريقة آمنة
  const key = t._id
    ? { id: Number(t._id) }
    : { caseNumber: String(t.caseNumber || '') };

  reopenTicketDrawerSafe(key);
}




async function deleteTicket(idx) {
  const t = tickets[_currentSection][idx];
  if (!t) return;

  if (CURRENT_USER !== DELETER_USERNAME) {
    alert('You do not have permission to delete.');
    return;
  }

  const ref = t.caseNumber || t.orderNumber || '';
  const ok = confirm(`Delete ticket ${ref}?`);
  if (!ok) return;

  try {
    // 1) حذف من الـDB إذا له id
    if (Number.isFinite(Number(t._id))) {
      const res = await fetch('/.netlify/functions/tickets', {
        method: 'DELETE',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id: Number(t._id), section: String(_currentSection), by: CURRENT_USER })
      });
      if (handleAuthFailure(res)) return;
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || 'DB delete failed');
    }

    // 2) حذف من Google Sheets حسب caseNumber
    if (t.caseNumber) {
      const headers = getAuthHeaders({ 'Content-Type': 'application/json' });
      if (SHEETS_APP_SECRET) headers['X-App-Secret'] = SHEETS_APP_SECRET;

      const resS = await fetch(SHEETS_ENDPOINT, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({
          section: _currentSection,
          caseNumber: t.caseNumber,
          by: CURRENT_USER
        })
      });
      if (handleAuthFailure(resS)) return;
      const dataS = await resS.json().catch(() => ({}));
      if (!resS.ok || dataS?.ok === false) throw new Error(dataS?.error || 'Sheets delete failed');
    }

    // 3) حذف التذكرة محليًا (من المصفوفة)
    tickets[_currentSection].splice(idx, 1);

    // 4) حفظ التغييرات في localStorage بعد الحذف
    saveTicketsToStorage();  // تأكد من أن التذاكر يتم تخزينها مرة أخرى في localStorage

    // 5) إعادة عرض التذاكر
    renderTickets();

    // 6) تحديث البيانات من الشيت مرة أخرى
    await hydrateFromSheets(_currentSection);  // سحب البيانات مجددًا من الشيت

    alert('Ticket deleted.');
  } catch (e) {
    console.error('Delete error:', e);
    alert('Failed to delete ticket: ' + (e.message || ''));
  }
}



function closeTicketDrawer(){
  const drawer = document.getElementById('ticket-drawer');
  if (!drawer) return;
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden','true');
  document.body.classList.remove('drawer-open');
  drawerIndex = null;
}
window.closeTicketDrawer = closeTicketDrawer;

document.addEventListener('keydown',e=>{ if (e.key==='Escape') closeTicketDrawer(); });

// ----------------------------
// Modal (single tidy version)
// ----------------------------
function openModal(section){
  if (!canUserCreate(section)) {
    alert('You are not allowed to add tickets in this section.');
    return;
  }
  window.currentSection = section;
  // ... تكملة الدالة كما هي

  const modal = document.getElementById('modal');
  const dynamicForm = document.getElementById('dynamic-form');

  dynamicForm.innerHTML = '';
  dynamicForm.className = 'form-grid';

  formFields[_currentSection].forEach(field=>{
    const group = document.createElement('div');
    group.classList.add('form-group');

    const label = document.createElement('label');
    label.textContent = field.label;
    group.appendChild(label);

    const makeFull = ()=> group.classList.add('full');

    if (field.type === 'select'){
      const select = document.createElement('select');
      select.name = field.name;
      field.options.forEach(o=>{
        const opt = document.createElement('option');
        opt.value = o; opt.textContent = o;
        select.appendChild(opt);
      });
      group.appendChild(select);

    } else if (field.type === 'multi-select'){
      const multi = document.createElement('div');
      multi.classList.add('multi-select');
      multi.dataset.name = field.name;

      const selected = document.createElement('div');
      selected.classList.add('selected');
      selected.textContent='Select options...';
      multi.appendChild(selected);

      const dropdown=document.createElement('div');
      dropdown.classList.add('dropdown');
      field.options.forEach(o=>{
        const lbl=document.createElement('label');
        const cb=document.createElement('input');
        cb.type='checkbox';
        cb.value=o;
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(o));
        dropdown.appendChild(lbl);
      });
      multi.appendChild(dropdown);

      selected.addEventListener('click',()=> multi.classList.toggle('open'));
      document.addEventListener('click',(e)=>{ if (!multi.contains(e.target)) multi.classList.remove('open'); });
      dropdown.querySelectorAll('input').forEach(cb=> cb.addEventListener('change',()=> updateSelected(multi)));

      makeFull();
      group.appendChild(multi);

    } else if (field.type === 'textarea'){
      const ta = document.createElement('textarea');
      ta.name = field.name;
      group.appendChild(ta);
      makeFull();

    } else if (field.type === 'file'){
      const input = document.createElement('input');
      input.type = 'file';
      input.name = field.name;
      input.accept = field.accept || '*/*';
      group.appendChild(input);

      const preview = document.createElement('img');
      preview.classList.add('file-preview');
      group.appendChild(preview);

      input.addEventListener('change',()=>{
        if (input.files && input.files[0]){
          const reader = new FileReader();
          reader.onload = (e)=>{ preview.src = e.target.result; preview.style.display='block'; };
          reader.readAsDataURL(input.files[0]);
        } else {
          preview.style.display='none';
        }
      });
      input.addEventListener('paste',(e)=>{
        const items=(e.clipboardData||e.originalEvent?.clipboardData)?.items||[];
        for (const it of items){
          if (it.type.indexOf('image')!==-1){
            const blob=it.getAsFile(); const reader=new FileReader();
            reader.onload=(ev)=>{ preview.src=ev.target.result; preview.style.display='block'; input.dataset.pasted=ev.target.result; };
            reader.readAsDataURL(blob);
          }
        }
      });

      makeFull();

    } else {
      const inp = document.createElement('input');
      inp.type = field.type; // date/time/datetime-local/text...
      inp.name = field.name;
      group.appendChild(inp);
    }

    dynamicForm.appendChild(group);
  });

  document.getElementById('ticket-form')
    .querySelector('[name="ticketIndex"]')?.remove();

  // أضف من أنشأ التذكرة
  document.getElementById('ticket-form').dataset.createdBy = CURRENT_USER;

  modal.querySelector('h2').textContent='Add New Ticket';
  modal.style.display='flex';
}
window.openModal = openModal;

function updateSelected(multi){
  const selected = multi.querySelector('.selected');
  selected.innerHTML='';
  multi.querySelectorAll('input:checked').forEach(cb=>{
    const span=document.createElement('span'); span.textContent=cb.value;
    const x=document.createElement('button'); x.textContent='x';
    x.addEventListener('click',(e)=>{ e.stopPropagation(); cb.checked=false; updateSelected(multi); });
    span.appendChild(x); selected.appendChild(span);
  });
  if (selected.innerHTML==='') selected.textContent='Select options...';
}

function closeModal(){
  document.getElementById('modal').style.display='none';
  document.getElementById('ticket-form').reset();
  document.querySelectorAll('.multi-select').forEach(m=>{
    m.querySelector('.selected').innerHTML='';
    m.querySelectorAll('input').forEach(cb=> cb.checked=false);
    m.classList.remove('open');
  });
  document.querySelectorAll('.file-preview').forEach(p=>{ p.src=''; p.style.display='none'; });
}
window.closeModal = closeModal;

// ----------------------------
// Add form handler  (POST to DB + refresh from DB + push to Sheets)
// ----------------------------
function bindFormHandler(){
  const formEl = document.getElementById('ticket-form');
  if (!formEl) return;

  formEl.addEventListener('submit', async (e)=>{
    e.preventDefault();

        // ⬅️ أضف الشرط هون مباشرة
  if (!canUserCreate(_currentSection)) {
    alert('You are not allowed to add tickets in this section.');
    return;
  }
    const t = {};

    // نبني التذكرة مع دعم await للملفات
    for (const field of formFields[_currentSection]) {
      if (field.type === 'multi-select') {
        const multi = document.querySelector(`.multi-select[data-name="${field.name}"]`);
        t[field.name] = Array.from(multi.querySelectorAll('input:checked')).map(cb=>cb.value);
      } else if (field.type === 'file') {
        // نحفظ كـ DataURL داخل object
        const input = e.target.elements[field.name];
        if (input?.dataset?.pasted) {
          t[field.name] = { name: 'pasted', type: 'image/*', dataUrl: input.dataset.pasted };
        } else if (input?.files && input.files[0]) {
          try {
            const dataUrl = await fileToDataURL(input.files[0]);
            t[field.name] = { name: input.files[0].name, type: input.files[0].type, dataUrl };
          } catch {
            t[field.name] = null;
          }
        } else {
          t[field.name] = null;
        }
      } else {
        const input = e.target.elements[field.name];
        if (input) t[field.name] = input.value;
      }
    }

    if (_currentSection==='cctv'){
      t.caseNumber = nextCaseNumber('cctv');
    }
else {
  if (!t.caseNumber) t.caseNumber = t.orderNumber || '';
}

    t.createdAt = new Date().toISOString();
    t.createdBy = CURRENT_USER; // مهم

    // خزن محليًا مباشرة لسرعة الاستجابة
    tickets[_currentSection].push(t);
    saveTicketsToStorage();
    renderTickets();

    // ارفع إلى الداتابيس
    try {
      const res = await fetch('/.netlify/functions/tickets', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          section: _currentSection,
          status: t.status || 'Under Review',
          payload: t ,
          changedBy: CURRENT_USER   // ✅ إضافة اسم المستخدم
        })
      });
      // اسحب من الداتابيس لضمان التزامن + إعطاء ID رسمي
      if (handleAuthFailure(res)) return;
      await hydrateFromDB(_currentSection);
    } catch (err) {
      console.error('POST to DB failed:', err);
    }

    // ✅ NEW: ادفع نفس التذكرة إلى Google Sheets
    try {
      await pushToSheets(_currentSection, t);
      console.log('Sheets append OK');
    } catch (err) {
      console.warn('Sheets push failed:', err.message);
    }

    closeModal();
  });
}

if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', bindFormHandler);
else bindFormHandler();

// ----------------------------
// Navigation helpers
// ----------------------------
function goBack(){ window.location.href='dashboard.html'; }
window.goBack = goBack;

// ----------------------------
// DB <-> UI bridge
// ----------------------------
function rowToTicket(row) {
  const p = row.payload || {};
  return {
    _id: row.id,
    ...p,
    status: row.status || p.status || 'Under Review',
    caseNumber: p.caseNumber 
                || p.orderNumber 
                || (row.section === 'cctv' ? `CCTV-${row.id}` : ''), // ← هيك أدق
    createdAt: row.created_at,
    lastModified: row.updated_at
  };
}


// === DB refresh (hydrate + 15s polling) ===
// ----------------------------
// Page load + polling (موحد)
// ----------------------------
window.addEventListener('load', async () => {
  // تحميل محلي مبدئي
  const saved = localStorage.getItem('cloudCrowdTickets');
  if (saved) tickets = JSON.parse(saved);
  ensureCaseNumbers();
  saveTicketsToStorage();

  // سكشن افتراضي
  if (!window.currentSection) window.currentSection = 'cctv';

  // لوجو السنتر
  const centerLogo = document.querySelector('.nav-center-logo');
  if (centerLogo){
    centerLogo.addEventListener('click', () => { window.location.href = 'dashboard.html'; });
  }

  // اعرض المحلي أولاً
  renderTickets();

  // حمل من DB وSheets
  await hydrateFromDB(window.currentSection);
  await hydrateFromSheets(window.currentSection);
  await autoSeedSheetTickets(window.currentSection);

  // فعّل الريفريش الدوري (ويمنع التكرار)
  if (window.__ticketsPoller) clearInterval(window.__ticketsPoller);
  const poll = async () => {
    await hydrateFromDB(window.currentSection || 'cctv');
    await hydrateFromSheets(window.currentSection || 'cctv');
    await autoSeedSheetTickets(window.currentSection || 'cctv');
  };
  window.__ticketsPoller = setInterval(poll, 15000); // كل 15 ثانية
});

// === DB refresh (hydrate + تحديث جزئي للـDOM) ===
async function hydrateFromDB(section) {
  const sec = section || window.currentSection || 'cctv';
  try {
    const res = await fetch(`/.netlify/functions/tickets?section=${encodeURIComponent(sec)}`, {
      headers: getAuthHeaders()
    });
    if (handleAuthFailure(res)) return;
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'fetch failed');

    const newTickets = (data.tickets || []).map(rowToTicket);
    const oldTickets = tickets[sec] || [];
    const dbTicketsForMerge = [];
    const oldSheetLegacyKeys = new Set();

    if (sec === 'ce') {
      for (const ticket of oldTickets) {
        if (!ticket?._sheetRowKey) continue;
        const legacyKey = (ticket.caseNumber || ticket.orderNumber || '').toString().trim();
        if (legacyKey) oldSheetLegacyKeys.add(legacyKey);
      }
    }

    for (const ticket of newTickets) {
      const legacyKey = (ticket.caseNumber || ticket.orderNumber || '').toString().trim();
      if (sec === 'ce' && ticket._id && !ticket._sheetRowKey && oldSheetLegacyKeys.has(legacyKey)) continue;
      dbTicketsForMerge.push(ticket);
    }

    const mapOld = new Map(oldTickets.map(t => [caseKey(t), t]).filter(([key]) => key));
    const mapNew = new Map(dbTicketsForMerge.map(t => [caseKey(t), t]).filter(([key]) => key));

    // مقارنة التكتات وحدة بوحدة
    for (const [key, newT] of mapNew.entries()) {
      const oldT = mapOld.get(key);
      if (!oldT) {
        // 🟢 تكتة جديدة
        addTicketToDOM(newT);
      } else if (JSON.stringify(oldT) !== JSON.stringify(newT)) {
        // 🟡 تكتة محدثة
        updateTicketInDOM(newT);
      }
    }

    // 🔴 احذف التكتات اللي انحذفت من DB
    for (const [key, oldT] of mapOld.entries()) {
      if (!mapNew.has(key) && !isFromSheet(oldT)) {
        removeTicketFromDOM(key);
      }
    }

    // حدّث الكاش المحلي فقط
    const mergedByKey = new Map();
    const keylessExisting = [];
    const keylessDb = [];

    for (const ticket of oldTickets) {
      const key = caseKey(ticket);
      if (key) mergedByKey.set(key, ticket);
      else keylessExisting.push(ticket);
    }

    for (const ticket of dbTicketsForMerge) {
      const key = caseKey(ticket);
      if (key) mergedByKey.set(key, ticket);
      else keylessDb.push(ticket);
    }

    // Keep sheet-only tickets when DB has not seeded or returned the same key yet.
    tickets[sec] = [...mergedByKey.values(), ...keylessExisting, ...keylessDb];
    saveTicketsToStorage();

    console.log(`✅ Synced ${sec} with DB (${newTickets.length} tickets)`);

  } catch (err) {
    console.error('DB hydrate failed:', err);
  }
}

// -----------------------------
// دوال تحديث الـDOM
// -----------------------------
// -----------------------------
// دالة إنشاء عنصر التكت
// -----------------------------
// ----------------------------
// Auth/logout (optional)
// ----------------------------

/* ---------------------------------
   Image overlay + CSS (thumb/overlay)
-----------------------------------*/


(function ensureDangerBtnCSS(){
  if (document.getElementById('cc-danger-css')) return;
  const style = document.createElement('style');
  style.id = 'cc-danger-css';
  style.textContent = `
    .danger-btn{
      background:#d11; color:#fff; border:0;
      padding:10px 14px; border-radius:8px; cursor:pointer; margin-left:8px;
    }
    .danger-btn:hover{ filter:brightness(.95); }
  `;
  document.head.appendChild(style);
})();

// Overlay لعرض الصورة كبيرة
function showImageOverlay(src) {
  const ov = document.createElement('div');
  ov.className = 'img-ov';
  ov.innerHTML = `<img src="${src}" alt="Attachment">`;
  ov.addEventListener('click', () => ov.remove());
  document.body.appendChild(ov);
}
// نربط الحدث عالميًا لأي thumbnail
document.addEventListener('click', (e) => {
  if (e.target && e.target.classList && e.target.classList.contains('ticket-thumb')) {
    showImageOverlay(e.target.src);
  }
});

// CSS خفيف للثَمبنيل والـOverlay (يُحقن لو مش موجود)
(function ensureImageCSS(){
  if (document.getElementById('cc-img-css')) return;
  const style = document.createElement('style');
  style.id = 'cc-img-css';
  style.textContent = `
.ticket-thumb{
  max-width: 140px;
  max-height: 140px;
  border-radius: 10px;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0,0,0,.15);
  transition: transform .08s ease;
}
.ticket-thumb:active { transform: scale(0.98); }
.img-ov{
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.82);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1003;
}
.img-ov img{
  max-width: 92vw;
  max-height: 92vh;
  border-radius: 12px;
  box-shadow: 0 15px 40px rgba(0,0,0,.4);
}
  `;
  document.head.appendChild(style);
})();

function reopenTicketDrawerSafe(key){
  try {
    const list = tickets[_currentSection] || [];
    let idx = -1;

    if (key?.id && Number.isFinite(Number(key.id))) {
      idx = list.findIndex(x => Number(x?._id) === Number(key.id));
    }

    if (idx === -1 && key?.caseNumber) {
      idx = list.findIndex(x => String(x?.caseNumber || x?.orderNumber || '') === String(key.caseNumber));
    }

    if (idx === -1) {
      // ما لقيناه: سكّر الدراور/افتح أول واحد أو لا تعمل شي
      console.warn('Ticket not found after refresh. Drawer not reopened.');
      return;
    }

    openTicketDrawer(idx);
  } catch (e) {
    console.warn('reopenTicketDrawerSafe failed:', e);
  }
}
