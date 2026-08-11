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
  complaints: []
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


async function pushToSheets(section, ticket) {
  if (!section) return;

  const headers = getAuthHeaders({ "Content-Type": "application/json" });
  if (SHEETS_APP_SECRET) headers["X-App-Secret"] = SHEETS_APP_SECRET;

  let row;
  if (section === 'cctv') row = rowFromTicketCCTV(ticket);
  else if (section === 'ce') row = rowFromTicketCE(ticket);
  else if (section === 'complaints') row = rowFromTicketComplaints(ticket);
  else if (section === 'free-orders') row = rowFromTicketFreeOrders(ticket);
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
    orderNumber: orderNumber || '',
    // Legacy alias used by existing generic sheet update/delete paths.
    caseNumber: orderNumber || '',
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









function mergeTicketsByCase(localArr, fromSheetArr, section = _currentSection) {
  const byCase = new Map();
  const mergeKey = (ticket) => (
    section === 'ce'
      ? (ticket?.orderNumber || ticket?.caseNumber || '').toString().trim()
      : caseKey(ticket)
  );

  // إضافة التذاكر من localStorage إلى Map
  for (const t of localArr) {
    const key = mergeKey(t); // تأكد من أن caseNumber أو orderNumber موجود
    if (!key) continue; // إذا لم يوجد key لا تضيف التذكرة
    byCase.set(key, t); // حفظ التذكرة باستخدام المفتاح
  }

  // إضافة التذاكر من الشيت إلى Map
  for (const s of fromSheetArr) {
    const key = mergeKey(s); // تأكد من أن caseNumber أو orderNumber موجود
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
  if (section === 'ce') {
    saveTicketsToStorage();
    renderTickets();
    return;
  }

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
  const sheetKeyFor = (ticket) => (
    section === 'ce'
      ? (ticket?.orderNumber || ticket?.caseNumber || '').toString().trim()
      : caseKey(ticket)
  );
  const sheetKeys = new Set(pulled.map(sheetKeyFor).filter(Boolean));

  const before = tickets[section] || [];
  const after = before.filter(t => {
    const key = sheetKeyFor(t);
    if (section === 'ce') return !!key && sheetKeys.has(key);
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
      pulled = rows.map(ticketFromSheetRowCE);
      console.log('CE parsed sample:', {
        status: pulled[0]?.status,
        orderNumber: pulled[0]?.orderNumber,
        customerName: pulled[0]?.customerName,
        branch: pulled[0]?.branch,
        satisfaction: pulled[0]?.satisfaction
      });
    } else if (section === 'complaints') {
      pulled = rows.map(ticketFromSheetRowComplaints);
    } else if (section === 'free-orders') {
      pulled = rows.map(ticketFromSheetRowFreeOrders);
    }

    if (Array.isArray(pulled) && pulled.length > 0) {
      console.log(`Hydrated from Sheets (${section}) →`, pulled.length, 'rows');
    } else {
      console.log(`No data found for section ${section} from Sheets.`);
    }

    // 1) دمج (يحدّث/يضيف)
    tickets[section] = mergeTicketsByCase(section === 'ce' ? [] : (tickets[section] || []), pulled, section);

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

function resetOperationalModal() {
  const form = document.getElementById('ticket-form');
  if (!form) return;
  form.reset();
  document.querySelectorAll('.multi-select').forEach(m=>{
    m.querySelector('.cc-multi-select__values').innerHTML='';
    m.querySelector('.cc-multi-select__values').hidden=true;
    m.querySelector('.cc-multi-select__trigger').setAttribute('aria-expanded', 'false');
    m.querySelectorAll('input').forEach(cb=> cb.checked=false);
    m.classList.remove('open');
  });
  document.querySelectorAll('.file-preview').forEach(p=>{ p.src=''; p.style.display='none'; });
}

function registerOperationalOverlays() {
  if (!window.CloudCrowdOverlay) return;
  const modal = document.getElementById('modal');
  const drawer = document.getElementById('ticket-drawer');
  if (modal) {
    window.CloudCrowdOverlay.register(modal, {
      type: 'dialog',
      panel: '.modal-content',
      dismissOnEscape: true,
      dismissOnBackdrop: false,
      initialFocus: () => modal.querySelector('input:not([type="hidden"]), select, textarea, button'),
      lockScroll: true,
      onAfterClose: resetOperationalModal
    });
  }
  if (drawer) {
    window.CloudCrowdOverlay.register(drawer, {
      type: 'drawer',
      panel: '.drawer-panel',
      backdrop: '.drawer-backdrop',
      dismissOnEscape: true,
      dismissOnBackdrop: true,
      initialFocus: '.drawer-close',
      lockScroll: true,
      onAfterClose: () => { drawerIndex = null; }
    });
  }
}
const MUTATION_PERMISSION_KEYS = {
  create: 'canCreate',
  edit: 'canEdit',
  delete: 'canDelete'
};
const activeMutations = new Set();
const MUTATION_CANCELLED = Symbol('mutation-cancelled');

function getMutationPermission(action) {
  const permissionKey = MUTATION_PERMISSION_KEYS[action];
  const access = window.CC_PAGE_ACCESS;
  const requiredPermissionFields = ['canView', 'canCreate', 'canEdit', 'canDelete'];

  if (!permissionKey) {
    return { allowed: false, message: 'This action is not available.' };
  }
  if (
    !access ||
    typeof access !== 'object' ||
    Array.isArray(access) ||
    access.legacyFallback === true ||
    typeof access.moduleKey !== 'string' ||
    !access.moduleKey.trim() ||
    !requiredPermissionFields.every(field => typeof access[field] === 'boolean') ||
    access.canView !== true
  ) {
    return { allowed: false, message: 'Permissions are unavailable. Please reload and try again.' };
  }
  if (access[permissionKey] !== true) {
    return { allowed: false, message: `You do not have permission to ${action} tickets.` };
  }
  if (action === 'delete' && readSessionValue('cc_role').trim().toLowerCase() !== 'admin') {
    return { allowed: false, message: 'Administrator access is required to delete tickets.' };
  }
  return { allowed: true, message: '' };
}

function requireMutationPermission(action) {
  const permission = getMutationPermission(action);
  if (!permission.allowed) showOperationalInline(permission.message, 'error');
  return permission.allowed;
}

function showOperationalInline(message, variant = 'error', container = null) {
  const host = container || document.querySelector('main') || document.body;
  const regionId = container ? 'cc-operational-feedback-drawer' : 'cc-operational-feedback-page';
  const region = window.CloudCrowdFeedback.ensureInlineRegion(regionId, host);
  window.CloudCrowdFeedback.inline(region, message, variant);
}

function setMutationLoading(control, loading, label) {
  if (!control) return;

  if (window.CloudCrowdButtons) {
    window.CloudCrowdButtons.setLoading(control, loading, label);
    return;
  }

  if (loading) {
    if (!control.dataset.mutationLabel) {
      control.dataset.mutationLabel = control.textContent || '';
    }
    control.disabled = true;
    control.setAttribute('aria-busy', 'true');
    control.textContent = label || 'Saving...';
    return;
  }

  control.disabled = false;
  control.removeAttribute('aria-busy');
  if (control.dataset.mutationLabel !== undefined) {
    control.textContent = control.dataset.mutationLabel;
    delete control.dataset.mutationLabel;
  }
}

function notifyMutation(message, variant = 'success') {
  if (!message) return;
  if (variant === 'success') {
    window.CloudCrowdFeedback.toast(message, 'success');
  } else {
    showOperationalInline(message, variant);
  }
}

async function readMutationResponse(response, fallbackMessage) {
  if (handleAuthFailure(response)) throw MUTATION_CANCELLED;

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`${fallbackMessage}: Invalid server response`);
  }

  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || fallbackMessage);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.ok !== true) {
    throw new Error(`${fallbackMessage}: Unverified server response`);
  }
  return data;
}

async function runMutationLifecycle(options) {
  const {
    action,
    key,
    control,
    loadingLabel,
    prepare,
    request,
    refresh,
    successMessage,
    failureMessage,
    cleanup
  } = options;

  if (!requireMutationPermission(action)) return { ok: false, reason: 'permission' };

  const mutationKey = `${action}:${_currentSection}:${key || ''}`;
  if (activeMutations.has(mutationKey)) {
    return { ok: false, reason: 'duplicate' };
  }

  activeMutations.add(mutationKey);
  setMutationLoading(control, true, loadingLabel);

  let succeeded = false;
  let cancelled = false;
  try {
    const context = await prepare();
    if (context === MUTATION_CANCELLED) {
      cancelled = true;
      return { ok: false, reason: 'cancelled' };
    }

    const result = await request(context);
    if (result === MUTATION_CANCELLED) {
      cancelled = true;
      return { ok: false, reason: 'cancelled' };
    }

    if (refresh) await refresh(context, result);
    succeeded = true;
    notifyMutation(successMessage);
    return { ok: true, context, result };
  } catch (error) {
    if (error === MUTATION_CANCELLED) {
      cancelled = true;
      return { ok: false, reason: 'cancelled' };
    }

    console.error(`${action} mutation failed:`, error);
    notifyMutation(`${failureMessage}: ${error?.message || 'Unknown error'}`, 'error');
    return { ok: false, reason: 'error', error };
  } finally {
    try {
      if (cleanup) await cleanup({ succeeded, cancelled });
    } finally {
      setMutationLoading(control, false);
      activeMutations.delete(mutationKey);
    }
  }
}

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

function openTicketDrawerByCase(caseNumber, trigger){
  const idx = (tickets[_currentSection]||[]).findIndex(t =>
    getCaseDisplay(t)===caseNumber || t.caseNumber===caseNumber
  );
  if (idx>=0) openTicketDrawer(idx, trigger);
}

function normalizeCctvDetailValue(value){
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean).join(', ');
  }
  return String(value || '').trim();
}

function formatCctvDateTime(ticket){
  const dateText = normalizeCctvDetailValue(ticket.date);
  const timeText = normalizeCctvDetailValue(ticket.time);
  if (dateText || timeText) return [dateText, timeText].filter(Boolean).join(' ');

  const rawDateTime = normalizeCctvDetailValue(ticket.dateTime);
  if (!rawDateTime) return '';

  const parsed = new Date(rawDateTime);
  if (isNaN(parsed)) return rawDateTime;

  const datePart = parsed.toLocaleDateString('en-US');
  const timePart = parsed.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  return `${datePart} ${timePart}`;
}

function cctvDetailRow(field, label, value, options = {}){
  const text = normalizeCctvDetailValue(value);
  if (!text && !options.html) return '';

  const valueHtml = options.html || escapeHtml(text);
  return `
    <div class="kv cctv-detail-row" data-field="${escapeHtml(field)}">
      <span class="cctv-detail-icon" aria-hidden="true"></span>
      <div class="cctv-detail-copy">
        <div class="k">${escapeHtml(label)}</div>
        <div class="v">${valueHtml}</div>
      </div>
    </div>
  `;
}

function mediaTypeFromCctvAttachment(src, explicitType){
  const type = String(explicitType || '').toLowerCase();
  if (type.startsWith('image')) return 'image';
  if (type.startsWith('video')) return 'video';
  if (/^data:image\//i.test(src)) return 'image';
  if (/^data:video\//i.test(src)) return 'video';
  if (/\.(png|jpe?g|gif|webp|bmp|avif|svg)(\?.*)?$/i.test(src)) return 'image';
  if (/\.(mp4|webm|ogg|ogv|mov|m4v)(\?.*)?$/i.test(src)) return 'video';
  return '';
}

function getCctvAttachmentSource(value){
  if (!value) return null;
  if (typeof value === 'object') {
    const src = String(value.dataUrl || value.url || value.src || '').trim();
    if (!src) return null;
    return {
      src,
      type: mediaTypeFromCctvAttachment(src, value.type),
      name: value.name || ''
    };
  }

  const src = String(value || '').trim();
  if (!src) return null;
  return {
    src,
    type: mediaTypeFromCctvAttachment(src, ''),
    name: ''
  };
}

function buildCctvAttachmentsRow(ticket){
  const internalKeys = new Set([
    '_id','id','payload','section','status','branch','date','time','dateTime',
    'cameras','sections','staff','reviewType','violations','notes','note',
    'customerNotes','complaintDetails','caseDescription','actionTaken',
    'caseNumber','orderNumber','createdAt','createdBy','lastModified',
    '_fromSheet','fromSheet','pdfUrl','pdfName','cctvPdf'
  ]);
  const seen = new Set();
  const items = [];

  Object.keys(ticket || {}).forEach(key => {
    if (internalKeys.has(key)) return;
    const media = getCctvAttachmentSource(ticket[key]);
    if (!media?.src || !media.type || seen.has(media.src)) return;

    seen.add(media.src);
    const safeSrc = escapeHtml(media.src);
    const safeLabel = escapeHtml(media.name || toLabel(key));

    if (media.type === 'image') {
      items.push(`
        <div class="cctv-attachment-item">
          <img src="${safeSrc}" alt="${safeLabel}" class="ticket-thumb" data-media-src="${safeSrc}" data-media-type="image" data-media-alt="${safeLabel}">
          <span>${safeLabel}</span>
        </div>
      `);
    } else {
      items.push(`
        <button class="cctv-attachment-item cctv-attachment-trigger cc-media-viewer-trigger" type="button" data-media-src="${safeSrc}" data-media-type="video" data-media-alt="${safeLabel}">
          <span class="cctv-attachment-video" aria-hidden="true"></span>
          <span>${safeLabel}</span>
        </button>
      `);
    }
  });

  const pdfUrl = normalizeCctvDetailValue(ticket.pdfUrl);
  if (pdfUrl) {
    const pdfName = normalizeCctvDetailValue(ticket.pdfName) || 'CCTV PDF';
    items.push(`
      <a class="cctv-attachment-item cctv-pdf-link" href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener noreferrer">
        <span class="cctv-pdf-icon" aria-hidden="true"></span>
        <span>${escapeHtml(pdfName)}</span>
      </a>
    `);
  }

  if (!items.length) return '';
  return cctvDetailRow('attachments', 'Attachments', '', {
    html: `<div class="cctv-attachments-list">${items.join('')}</div>`
  });
}

function buildCctvDrawerReadonly(ticket){
  const html = [
    cctvDetailRow('branch', 'Branch', ticket.branch),
    cctvDetailRow('date-time', 'Date & Time', formatCctvDateTime(ticket)),
    cctvDetailRow('camera', 'Camera', ticket.cameras),
    cctvDetailRow('section', 'Section', ticket.sections),
    cctvDetailRow('staff', 'Staff', ticket.staff),
    cctvDetailRow('review-type', 'Review Type', ticket.reviewType),
    cctvDetailRow('violated-policy', 'Violated Policy', ticket.violations),
    cctvDetailRow('details', 'Details', ticket.notes || ticket.note || ticket.caseDescription),
    cctvDetailRow('action-taken', 'Action Taken', ticket.actionTaken),
    buildCctvAttachmentsRow(ticket)
  ].filter(Boolean).join('');

  return html || '<div class="no-tickets full-span">No details.</div>';
}

function buildDrawerReadonly(ticket){
  if (_currentSection === 'cctv') return buildCctvDrawerReadonly(ticket);

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
    const noteTitle = notesKeyUsed === 'note' ? 'Note' : 'Case Details';
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
          <img src="${src}" alt="${toLabel(key)}" class="ticket-thumb" data-media-src="${src}" data-media-type="image">
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

    ${pdfField}

    <div class="form-group">
      <label>Action Taken</label>
      <textarea name="actionTaken" rows="4">${escapeHtml(ticket.actionTaken||'')}</textarea>
    </div>
  `;
}



function createDrawerHistoryTrigger(ticket) {
  const historyButton = document.createElement('button');
  historyButton.className = 'history-link';
  historyButton.id = 'drawer-history-link';
  historyButton.type = 'button';
  historyButton.title = 'View change history';
  historyButton.textContent = 'History';
  historyButton.addEventListener('click', () => {
    if (!ticket._id) {
      showOperationalInline('No ticket id found.', 'error', document.querySelector('.drawer.open .drawer-body'));
      return;
    }
    viewTicketHistory(ticket._id, historyButton);
  });
  return historyButton;
}

function openTicketDrawer(index, trigger){
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
    <span class="meta-badge cc-status ${ticketStatusToneClass(ticket.status)}">
      ${escapeHtml(ticketStatusPresentation(ticket.status || 'Uncategorized').label)}
    </span>
  `;
  metaEl.appendChild(createDrawerHistoryTrigger(ticket));

  // محتوى القراءة
  bodyEl.innerHTML = buildDrawerReadonly(ticket);

  if (actions){
    actions.innerHTML = '';

    if (getMutationPermission('edit').allowed) {
      const editBtn = document.createElement('button');
      editBtn.id = 'drawer-edit-btn';
      editBtn.type = 'button';
      editBtn.className = 'edit-btn';
      editBtn.textContent = 'Edit';
      editBtn.setAttribute('data-permission-edit', '');
      editBtn.addEventListener('click', ()=> enterDrawerEditMode());
      actions.appendChild(editBtn);
    }

    if (getMutationPermission('delete').allowed) {
      const delBtn = document.createElement('button');
      delBtn.id = 'drawer-delete-btn';
      delBtn.type = 'button';
      delBtn.className = 'danger-btn';
      delBtn.textContent = 'Delete';
      delBtn.setAttribute('data-permission-delete', '');
      delBtn.addEventListener('click', ()=> deleteTicket(drawerIndex, delBtn));
      actions.appendChild(delBtn);
    }
  }

  if (!window.CloudCrowdOverlay) {
    drawer.classList.add('open');
    document.body?.classList?.add('cc-modal-lock');
  } else if (!window.CloudCrowdOverlay.isOpen(drawer.id)) {
    window.CloudCrowdOverlay.open(drawer.id, { trigger });
  }
}


function enterDrawerEditMode(){
  if (drawerIndex==null) return;
  if (!requireMutationPermission('edit')) return;
  const ticket = tickets[_currentSection][drawerIndex];
  const bodyEl = document.getElementById('drawer-body');
  const actions = ensureDrawerActionsContainer();
  document.getElementById('drawer-title').textContent = `Edit • ${displayStatusName(ticket.status||'')}`;

  bodyEl.innerHTML = `<form id="drawer-edit-form">${buildDrawerEditForm(ticket)}</form>`;
  if (actions){
    actions.innerHTML = `
      <button id="drawer-save-btn" class="submit-btn" data-permission-edit>Save</button>
      <button id="drawer-cancel-btn" class="cancel-btn" type="button">Cancel</button>
    `;
    const saveBtn = actions.querySelector('#drawer-save-btn');
    saveBtn.onclick = (e)=>{ e.preventDefault(); saveDrawerEdits(saveBtn); };
    actions.querySelector('#drawer-cancel-btn').onclick = (e)=>{ e.preventDefault(); openTicketDrawer(drawerIndex); };
  }
}


// ----------------------------
// Save edits (local first, then server)  ✅ hydrate فقط عند النجاح
// ----------------------------
// ----------------------------
// Save edits (local first, then server + update Sheets)
// ----------------------------
async function saveDrawerEdits(control) {
  if (drawerIndex == null) return;
  const form = document.getElementById('drawer-edit-form');
  if (!form) return;

  const section = _currentSection;
  const index = drawerIndex;
  const ticket = tickets[section][index];
  if (!ticket) return;

  const reopenKey = ticket._id
    ? { id: Number(ticket._id) }
    : { caseNumber: String(ticket.caseNumber || '') };

  return runMutationLifecycle({
    action: 'edit',
    key: ticket._id || ticket.caseNumber || index,
    control,
    loadingLabel: 'Saving...',
    prepare: async () => {
      const fd = new FormData(form);
      const nextTicket = {
        ...ticket,
        status: String(fd.get('status') || ''),
        actionTaken: String(fd.get('actionTaken') ?? '')
      };
      let pdfUpload = null;

      if (section === 'cctv') {
        const allowPdf = nextTicket.status === 'Escalated' || nextTicket.status === 'Under Review';
        const file = fd.get('cctvPdf');

        if (allowPdf && nextTicket.caseNumber && file && file.size) {
          if (file.type !== 'application/pdf') {
            throw new Error('PDF only.');
          }

          const maxPdfSize = 8 * 1024 * 1024;
          if (file.size > maxPdfSize) {
            throw new Error('PDF too large. Please upload under 8MB.');
          }

          pdfUpload = {
            caseNumber: nextTicket.caseNumber,
            pdfName: file.name,
            pdfBase64: await fileToDataURL(file)
          };
        }
      }

      return { nextTicket, pdfUpload };
    },
    request: async ({ nextTicket, pdfUpload }) => {
      let uploadedPdf = null;

      if (pdfUpload) {
        const uploadResponse = await fetch('/.netlify/functions/upload-cctv-pdf', {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(pdfUpload)
        });
        const uploadData = await readMutationResponse(uploadResponse, 'PDF upload failed');
        uploadedPdf = {
          pdfName: uploadData.pdfName,
          pdfUrl: uploadData.pdfUrl
        };
      }

      if (Number.isFinite(Number(nextTicket._id))) {
        const response = await fetch('/.netlify/functions/tickets', {
          method: 'PUT',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            id: Number(nextTicket._id),
            section,
            status: nextTicket.status,
            actionTaken: nextTicket.actionTaken,
            changedBy: CURRENT_USER
          })
        });
        await readMutationResponse(response, 'Update failed');
      } else {
        console.warn('No DB id → ticket came from Google Sheets, DB PUT skipped.');
      }

      if (!nextTicket.caseNumber) {
        console.warn('No caseNumber on ticket → Sheets PUT skipped.');
      } else {
        const headers = getAuthHeaders({ 'Content-Type': 'application/json' });
        if (SHEETS_APP_SECRET) headers['X-App-Secret'] = SHEETS_APP_SECRET;

        const sheetsResponse = await fetch(SHEETS_ENDPOINT, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            section,
            caseNumber: nextTicket.caseNumber,
            status: nextTicket.status,
            actionTaken: nextTicket.actionTaken
          })
        });
        await readMutationResponse(sheetsResponse, 'Sheets update failed');
      }

      return { nextTicket, uploadedPdf };
    },
    refresh: async (_context, { nextTicket, uploadedPdf }) => {
      Object.assign(ticket, {
        status: nextTicket.status,
        actionTaken: nextTicket.actionTaken,
        lastModified: new Date().toISOString(),
        ...(uploadedPdf || {})
      });
      saveTicketsToStorage();
      renderTickets();
      await hydrateFromDB(section);
      await hydrateFromSheets(section);
    },
    successMessage: 'Ticket updated.',
    failureMessage: 'Failed to update ticket',
    cleanup: async ({ succeeded }) => {
      if (succeeded) reopenTicketDrawerSafe(reopenKey);
    }
  });
}




async function deleteTicket(idx, control) {
  const section = _currentSection;
  const ticket = tickets[section][idx];
  if (!ticket) return;

  return runMutationLifecycle({
    action: 'delete',
    key: ticket._id || ticket.caseNumber || ticket.orderNumber || idx,
    control,
    loadingLabel: 'Deleting...',
    prepare: async () => {
      const ref = ticket.caseNumber || ticket.orderNumber || '';
      return await window.CloudCrowdConfirmation.request(`Delete ticket ${ref}?`, {
        title: 'Delete ticket',
        confirmLabel: 'Delete',
        intent: 'danger'
      }) ? { ticket } : MUTATION_CANCELLED;
    },
    request: async ({ ticket: currentTicket }) => {
      if (Number.isFinite(Number(currentTicket._id))) {
        const response = await fetch('/.netlify/functions/tickets', {
          method: 'DELETE',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            id: Number(currentTicket._id),
            section,
            by: CURRENT_USER
          })
        });
        await readMutationResponse(response, 'DB delete failed');
      }

      if (currentTicket.caseNumber) {
        const headers = getAuthHeaders({ 'Content-Type': 'application/json' });
        if (SHEETS_APP_SECRET) headers['X-App-Secret'] = SHEETS_APP_SECRET;

        const sheetsResponse = await fetch(SHEETS_ENDPOINT, {
          method: 'DELETE',
          headers,
          body: JSON.stringify({
            section,
            caseNumber: currentTicket.caseNumber,
            by: CURRENT_USER
          })
        });
        await readMutationResponse(sheetsResponse, 'Sheets delete failed');
      }

      return { ticket: currentTicket };
    },
    refresh: async () => {
      const currentIndex = tickets[section].indexOf(ticket);
      if (currentIndex >= 0) tickets[section].splice(currentIndex, 1);
      saveTicketsToStorage();
      renderTickets();
      await hydrateFromSheets(section);
    },
    successMessage: 'Ticket deleted.',
    failureMessage: 'Failed to delete ticket',
    cleanup: async ({ succeeded }) => {
      if (succeeded) closeTicketDrawer();
    }
  });
}



function closeTicketDrawer(){
  const drawer = document.getElementById('ticket-drawer');
  if (!drawer) return;
  if (window.CloudCrowdOverlay) window.CloudCrowdOverlay.close(drawer.id, { reason: 'page-close' });
  else {
    drawer.classList.remove('open');
    document.body?.classList?.remove('cc-modal-lock');
    drawerIndex = null;
  }
}
window.closeTicketDrawer = closeTicketDrawer;

// ----------------------------
// Modal (single tidy version)
// ----------------------------
const OPERATION_FORM_SECTIONS = {
  cctv: [
    { title: 'Case Context', fields: ['status', 'branch', 'date', 'time'] },
    { title: 'Footage and Location', fields: ['cameras', 'sections'] },
    { title: 'People and Policy', fields: ['staff', 'reviewType', 'violations'] },
    { title: 'Case Details', fields: ['notes'] },
    { title: 'Attachment and Action', fields: ['cctvPdf', 'actionTaken'] }
  ],
  ce: [
    { title: 'Customer and Order', fields: ['status', 'orderNumber', 'department', 'customerName', 'phone', 'creationDate'] },
    { title: 'Source and Context', fields: ['shift', 'orderType', 'branch', 'restaurant', 'channel', 'feedbackDate'] },
    { title: 'Experience Classification', fields: ['issueCategory', 'customerNotes'] },
    { title: 'Resolution', fields: ['actionTaken', 'satisfaction'] }
  ],
  complaints: [
    { title: 'Complaint and Order', fields: ['status', 'orderNumber', 'department', 'customerName', 'phone', 'creationDate'] },
    { title: 'Responsibility and Context', fields: ['shift', 'orderType', 'branch', 'restaurant', 'channel'] },
    { title: 'Issue', fields: ['issueCategory', 'complaintDetails'] },
    { title: 'Resolution', fields: ['actionTaken'] }
  ],
  'free-orders': [
    { title: 'Customer and Order', fields: ['status', 'customerName', 'phone', 'orderDate', 'orderNumber'] },
    { title: 'Order and Compensation', fields: ['orderOnCirca', 'discountAmount', 'reasonForDiscount', 'channel'] },
    { title: 'Approval and Attachment', fields: ['decisionMaker', 'attached'] },
    { title: 'Usage and Deduction', fields: ['discountDate', 'newOrderNumber', 'deductionFrom'] },
    { title: 'Case Details', fields: ['caseDescription'] }
  ]
};

function operationControlId(section, fieldName){
  return `cc-${section}-${fieldName}`.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
}

function openModal(section){
  if (!requireMutationPermission('create')) return;
  window.currentSection = section;
  // ... تكملة الدالة كما هي

  const modal = document.getElementById('modal');
  const dynamicForm = document.getElementById('dynamic-form');

  dynamicForm.innerHTML = '';
  dynamicForm.className = 'cc-form-sections';

  const fieldGroups = new Map();

  formFields[_currentSection].forEach(field=>{
    const group = document.createElement('div');
    group.classList.add('form-group', 'cc-field');
    const controlId = operationControlId(_currentSection, field.name);

    const label = document.createElement('label');
    label.id = `${controlId}-label`;
    label.htmlFor = controlId;
    label.classList.add('cc-field__label');
    label.textContent = field.label;
    group.appendChild(label);

    const makeFull = ()=> group.classList.add('full', 'cc-form-grid__full');

    if (field.type === 'select'){
      const select = document.createElement('select');
      select.id = controlId;
      select.classList.add('cc-control');
      select.name = field.name;
      field.options.forEach(o=>{
        const opt = document.createElement('option');
        opt.value = o; opt.textContent = o;
        select.appendChild(opt);
      });
      group.appendChild(select);

    } else if (field.type === 'multi-select'){
      const multi = document.createElement('div');
      multi.classList.add('multi-select', 'cc-multi-select');
      multi.dataset.name = field.name;
      multi.id = `${controlId}-group`;
      multi.setAttribute('role', 'group');
      multi.setAttribute('aria-labelledby', label.id);

      const selected = document.createElement('button');
      selected.id = controlId;
      selected.type = 'button';
      selected.classList.add('selected', 'cc-multi-select__trigger');
      selected.setAttribute('aria-labelledby', label.id);
      selected.setAttribute('aria-expanded', 'false');
      selected.setAttribute('aria-controls', `${controlId}-options`);
      selected.textContent='Select options...';
      multi.appendChild(selected);

      const values=document.createElement('div');
      values.classList.add('cc-multi-select__values');
      values.id = `${controlId}-values`;
      values.hidden = true;
      multi.appendChild(values);

      const dropdown=document.createElement('div');
      dropdown.classList.add('dropdown');
      dropdown.id = `${controlId}-options`;
      field.options.forEach((o, optionIndex)=>{
        const lbl=document.createElement('label');
        const cb=document.createElement('input');
        cb.type='checkbox';
        cb.value=o;
        cb.id = `${controlId}-option-${optionIndex}`;
        lbl.htmlFor = cb.id;
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(o));
        dropdown.appendChild(lbl);
      });
      multi.appendChild(dropdown);

      selected.addEventListener('click',()=>{
        const isOpen = multi.classList.toggle('open');
        selected.setAttribute('aria-expanded', String(isOpen));
      });
      document.addEventListener('click',(e)=>{
        if (!multi.contains(e.target)) {
          multi.classList.remove('open');
          selected.setAttribute('aria-expanded', 'false');
        }
      });
      dropdown.querySelectorAll('input').forEach(cb=> cb.addEventListener('change',()=> updateSelected(multi)));

      makeFull();
      group.appendChild(multi);

    } else if (field.type === 'textarea'){
      const ta = document.createElement('textarea');
      ta.id = controlId;
      ta.classList.add('cc-control');
      ta.name = field.name;
      group.appendChild(ta);
      makeFull();

    } else if (field.type === 'file'){
      const input = document.createElement('input');
      input.id = controlId;
      input.classList.add('cc-control');
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
      inp.id = controlId;
      inp.classList.add('cc-control');
      inp.type = field.type; // date/time/datetime-local/text...
      inp.name = field.name;
      group.appendChild(inp);
    }

    fieldGroups.set(field.name, group);
  });

  (OPERATION_FORM_SECTIONS[_currentSection] || []).forEach((definition, sectionIndex)=>{
    const formSection = document.createElement('section');
    formSection.className = 'cc-form-section';
    const title = document.createElement('h3');
    title.className = 'cc-form-section__title';
    title.id = `cc-${_currentSection}-form-section-${sectionIndex}`;
    title.textContent = definition.title;
    formSection.setAttribute('aria-labelledby', title.id);
    formSection.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'form-grid cc-form-grid';
    definition.fields.forEach((fieldName)=>{
      const group = fieldGroups.get(fieldName);
      if (group) grid.appendChild(group);
    });
    formSection.appendChild(grid);
    dynamicForm.appendChild(formSection);
  });

  document.getElementById('ticket-form')
    .querySelector('[name="ticketIndex"]')?.remove();

  // أضف من أنشأ التذكرة
  document.getElementById('ticket-form').dataset.createdBy = CURRENT_USER;

  modal.querySelector('h2').textContent='Add New Ticket';
  if (window.CloudCrowdOverlay) window.CloudCrowdOverlay.open(modal.id);
  else {
    modal.classList.add('open');
    document.body?.classList?.add('cc-modal-lock');
  }
}
window.openModal = openModal;

function updateSelected(multi){
  const values = multi.querySelector('.cc-multi-select__values');
  values.innerHTML='';
  multi.querySelectorAll('input:checked').forEach(cb=>{
    const span=document.createElement('span'); span.textContent=cb.value;
    const x=document.createElement('button'); x.textContent='x';
    x.type='button';
    x.classList.add('cc-multi-select__remove');
    x.setAttribute('aria-label', `Remove ${cb.value}`);
    x.addEventListener('click',(e)=>{ e.preventDefault(); e.stopPropagation(); cb.checked=false; updateSelected(multi); });
    span.appendChild(x); values.appendChild(span);
  });
  values.hidden = values.innerHTML==='';
}

function closeModal(){
  if (window.CloudCrowdOverlay) window.CloudCrowdOverlay.close('modal', { reason: 'page-close' });
  else {
    document.getElementById('modal')?.classList.remove('open');
    document.body?.classList?.remove('cc-modal-lock');
    if (typeof resetOperationalModal === 'function') resetOperationalModal();
    else {
      document.getElementById('ticket-form')?.reset();
      document.querySelectorAll('.multi-select').forEach(m=>{
        m.querySelector('.cc-multi-select__values').innerHTML='';
        m.querySelector('.cc-multi-select__values').hidden=true;
        m.querySelector('.cc-multi-select__trigger').setAttribute('aria-expanded', 'false');
        m.querySelectorAll('input').forEach(cb=> cb.checked=false);
        m.classList.remove('open');
      });
      document.querySelectorAll('.file-preview').forEach(p=>{ p.src=''; p.style.display='none'; });
    }
  }
}
window.closeModal = closeModal;

registerOperationalOverlays();

// ----------------------------
// Add form handler  (POST to DB + refresh from DB + push to Sheets)
// ----------------------------
function bindFormHandler(){
  const formEl = document.getElementById('ticket-form');
  if (!formEl) return;

  formEl.addEventListener('submit', async (e)=>{
    e.preventDefault();

    const section = _currentSection;
    const control = e.submitter || formEl.querySelector('[type="submit"]');

    await runMutationLifecycle({
      action: 'create',
      key: section,
      control,
      loadingLabel: 'Submitting...',
      prepare: async () => {
        const ticket = {};

        for (const field of formFields[section]) {
          if (field.type === 'multi-select') {
            const multi = formEl.querySelector(`.multi-select[data-name="${field.name}"]`);
            ticket[field.name] = Array.from(multi.querySelectorAll('input:checked')).map(cb=>cb.value);
          } else if (field.type === 'file') {
            const input = formEl.elements[field.name];
            if (input?.dataset?.pasted) {
              ticket[field.name] = { name: 'pasted', type: 'image/*', dataUrl: input.dataset.pasted };
            } else if (input?.files && input.files[0]) {
              try {
                const dataUrl = await fileToDataURL(input.files[0]);
                ticket[field.name] = {
                  name: input.files[0].name,
                  type: input.files[0].type,
                  dataUrl
                };
              } catch {
                ticket[field.name] = null;
              }
            } else {
              ticket[field.name] = null;
            }
          } else {
            const input = formEl.elements[field.name];
            if (input) ticket[field.name] = input.value;
          }
        }

        if (section === 'cctv') {
          ticket.caseNumber = nextCaseNumber('cctv');
        } else if (!ticket.caseNumber) {
          ticket.caseNumber = ticket.orderNumber || '';
        }

        ticket.createdAt = new Date().toISOString();
        ticket.createdBy = CURRENT_USER;
        return { ticket };
      },
      request: async ({ ticket }) => {
        const response = await fetch('/.netlify/functions/tickets', {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            section,
            status: ticket.status || 'Under Review',
            payload: ticket,
            changedBy: CURRENT_USER
          })
        });
        const data = await readMutationResponse(response, 'Create failed');

        await hydrateFromDB(section);

        try {
          await pushToSheets(section, ticket);
          console.log('Sheets append OK');
        } catch (error) {
          console.warn('Sheets push failed:', error.message);
        }

        return { ticket, data };
      },
      refresh: async () => {
        renderTickets();
      },
      successMessage: 'Ticket created.',
      failureMessage: 'Failed to create ticket',
      cleanup: async ({ succeeded }) => {
        if (succeeded) closeModal();
      }
    });
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
    const hydrateKey = (ticket) => (
      sec === 'ce'
        ? (ticket?.orderNumber || ticket?.caseNumber || '').toString().trim()
        : caseKey(ticket)
    );

    const mapOld = new Map(oldTickets.map(t => [hydrateKey(t), t]).filter(([key]) => key));
    const mapNew = new Map(newTickets.map(t => [hydrateKey(t), t]).filter(([key]) => key));

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
      const key = hydrateKey(ticket);
      if (key) mergedByKey.set(key, ticket);
      else keylessExisting.push(ticket);
    }

    for (const ticket of newTickets) {
      const key = hydrateKey(ticket);
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
  if (window.CloudCrowdMediaViewer) {
    window.CloudCrowdMediaViewer.open({ src, type: 'image', alt: 'Attachment' });
  }
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
