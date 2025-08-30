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
const CURRENT_USER = localStorage.getItem('cc_user') || 'operator';


// من له صلاحية الإضافة
const CREATOR_ALLOW = {
  all: ['Anati'],              // مسموح بكل الأقسام
  'time-table': ['Anati','Mai'] // مسموح بالـ Thyme Table Plates فقط
};

function canUserCreate(section) {
  if (CREATOR_ALLOW.all.includes(CURRENT_USER)) return true;
  if (section === 'time-table' && CREATOR_ALLOW['time-table'].includes(CURRENT_USER)) return true;
  return false;
}


// ⬅️ أضِف هذا السطر
const DELETER_USERNAME = 'Anati';

// ==== Google Sheets Bridge (موحّد لكل الأقسام) ====
const SHEETS_ENDPOINT = "https://cloudcrowd.site/.netlify/functions/sheets";
const SHEETS_APP_SECRET = "";

// أسماء التابات ونطاق القراءة لكل قسم
const SECTION_SHEETS = {
  cctv: {
    tab: "CCTV_Sep2025",
    pull: "CCTV_Sep2025!A2:M"
  },
  ce: {
    tab: "CircaCustomerExperience_Sep2025",
    pull: "CircaCustomerExperience_Sep2025!A2:P"
  },
  complaints: {
  tab: "DailyComplaints_Sep2025",
  pull: "'DailyComplaints_Sep2025'!A2:N" // ملاحظ: اسم التاب بين ''
},

  "free-orders": {
    tab: "Complimentary",
    pull: "Complimentary!A2:M"
  },
  "time-table": {
    tab: "ThymeTablePlates_Sep2025",
    pull: "ThymeTablePlates_Sep2025!A2:K"
  }
};

function sheetTab(section){ return SECTION_SHEETS[section]?.tab || null; }
function sheetPull(section){ return SECTION_SHEETS[section]?.pull || null; }

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
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);  // data:<mime>;base64,....
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}


// يساعدنا نعرف إذا القيمة صورة (string data:, blob:, http) أو object {dataUrl}
function extractImageSrc(val) {
  if (!val) return null;
  if (typeof val === 'object' && val.dataUrl) return val.dataUrl;
  if (typeof val === 'string') {
    const s = val.trim();
    if (/^data:image\//i.test(s)) return s;
    if (/^blob:|^https?:\/\//i.test(s)) return s;
  }
  return null;
}

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
function rowFromTicketTimeTable(t) {
  return [
    t.status || 'Pending Call',           // A: status
    t.note || '',                         // B: note
    t.customerName || '',                 // C: customerName
    t.phone || '',                        // D: phone
    t.orderNumber || '',                  // E: orderNumber
    t.returnDate || '',                   // F: returnDate
    t.amountToBeRefunded || '',           // G: amountToBeRefunded
    t.deliveryFees || '',                 // H: deliveryFees
    t.platesQuantity || '',               // I: platesQuantity
    t.platesNumbers || '',                // J: platesNumbers
    t.caseNumber || t.orderNumber || ''   // K: caseNumber
  ];
}

async function pushToSheets(section, ticket) {
  const tab = sheetTab(section);
  if (!tab) return;

  const headers = { "Content-Type": "application/json" };
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
      range: tab,  // اسم التاب
      values: [row]
    })
  });
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
    caseNumber: orderNumber || ''
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
    status, note, customerName, phone, returnDate,
    amountToBeRefunded, deliveryFees,
    platesQuantity, platesNumbers, orderNumber
  ] = r; // A..K

  return {
    status: status || 'Pending Call',
    note: note || '',
    customerName: customerName || '',
    phone: phone || '',
    returnDate: returnDate || '',
    amountToBeRefunded: amountToBeRefunded || '',
    deliveryFees: deliveryFees || '',
    platesQuantity: platesQuantity || '',
    platesNumbers: platesNumbers || '',
    caseNumber: orderNumber || '' // تأكد من أن هذا هو الـ "Order Number" فقط
  };
}








function mergeTicketsByCase(localArr, fromSheetArr) {
  const byCase = new Map();

  // إضافة التذاكر من localStorage إلى Map
  for (const t of localArr) {
    const key = t.caseNumber || t.orderNumber || ''; // تأكد من أن caseNumber أو orderNumber موجود
    if (!key) continue; // إذا لم يوجد key لا تضيف التذكرة
    byCase.set(key, t);  // حفظ التذكرة باستخدام المفتاح
  }

  // إضافة التذاكر من الشيت إلى Map
  for (const s of fromSheetArr) {
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



async function autoSeedSheetTickets(section){
  const arr = tickets[section] || [];
  const toSeed = [];

  for (const t of arr){
    const key = t.caseNumber || t.orderNumber;
    if (!key) continue;

    // بدنا نسيّد فقط اللي جايات من Sheets (ما عندهن _id) ولسا ما سيّدناهن قبل
    if (!t._id && !wasSeeded(section, key)){
      toSeed.push({ key, ticket: t });
    }
  }

  if (!toSeed.length) return;

  for (const {key, ticket} of toSeed){
    try {
      const res = await fetch('/.netlify/functions/tickets', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          section,
          status: ticket.status || 'Under Review',
          payload: ticket,
          changedBy: CURRENT_USER || 'system-seed'
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'seed failed');

      markSeeded(section, key); // علّمنا إنو اتسيّد
    } catch(e){
      console.warn('Auto-seed failed for', section, key, e.message);
    }
  }

  // بعد ما نخلص، اسحب من الـDB عشان التكت تاخذ _id
  try {
    await hydrateFromDB(section);
    renderTickets();
  } catch {}
}


// مفتاح موحّد للتذكرة بأي قسم
function caseKey(t) {
  return (t?.caseNumber || t?.orderNumber || '').toString().trim();
}

// التذكرة من الشيت إذا ما إلها _id (ID الداتابيس)
function isFromSheet(t) {
  return !Number.isFinite(Number(t?._id));
}

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
    if (!key) return false;            // سطر تالف بدون مفتاح
    if (!isFromSheet(t)) return true;  // من الـDB → نخليها
    return sheetKeys.has(key);         // من الشيت → نخليها فقط لو لسه موجودة بالشيت
  });

  if (after.length !== before.length) {
    tickets[section] = after;
    saveTicketsToStorage();
    renderTickets();
  }
}

async function hydrateFromSheets(section) {
  const range = sheetPull(section);
  if (!range) return;

  try {
    const headers = {};
    if (SHEETS_APP_SECRET) headers['X-App-Secret'] = SHEETS_APP_SECRET;

    const url = `${SHEETS_ENDPOINT}?range=${encodeURIComponent(range)}&section=${encodeURIComponent(section)}`;
    const res = await fetch(url, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sheets GET failed');

    const rows = (data.values || []).filter(row => row && row.length);

    let pulled = [];
    if (section === 'cctv') {
      pulled = rows.map(ticketFromSheetRowCCTV);
    } else if (section === 'ce') {
      pulled = rows.map(ticketFromSheetRowCE);
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
    tickets[section] = mergeTicketsByCase(tickets[section] || [], pulled);
    saveTicketsToStorage();
    renderTickets();

    // 2) مصالحة (يمسح محليًا أي تذكرة من الشيت انحذفت من الشيت)
    reconcileAfterSheetsPull(section, pulled);

    // 3) سيّدنغ لأي تذكرة شيت لسه ما إلها _id
    await autoSeedSheetTickets(section);

  } catch (e) {
    console.warn('hydrateFromSheets error:', e.message);
  }
}



/* ==== end Sheets helpers ==== */

// ----------------------------
// Config: main fields on cards
// ----------------------------
const mainFields = {
  cctv: ['branch', 'staff', 'sections'],
  ce: ['customerName', 'branch', 'restaurant'],
  'free-orders': ['customerName', 'orderNumber', 'discountAmount'],
  complaints: ['customerName', 'branch', 'issueCategory'],
  'time-table': ['customerName', 'orderNumber', 'phone']
};


// ----------------------------
// Columns per section
// ----------------------------
const STATUS_COLUMNS = {
  cctv: ['Escalated', 'Under Review', 'Closed'],
  ce: ['Escalated', 'Under Review', 'Pending (Customer Call Required)', 'Closed'],
  'free-orders': ['Active', 'Taken', 'Not Active'],
  complaints: ['Escalated', 'Under Review', 'Pending (Customer Call Required)', 'Closed'],
  'time-table': [
    'No Call Needed',
    'Pending Call',
    'No Answer',
    'Scheduled',
    'Issue',
    'Returned'
  ]
};

// ----------------------------
// Display name remap (view only)
// ----------------------------
const STATUS_DISPLAY_MAP = {
  'Pending (Customer Call Required)': 'Pending (Call Back)'
};
function displayStatusName(name) {
  return STATUS_DISPLAY_MAP[name] || name;
}

// ----------------------------
// Form fields per section
// ----------------------------
const formFields = {
  cctv: [
    { label: 'Case Status', type: 'select', name: 'status', options: ['Closed', 'Under Review', 'Escalated'] },
    { label: 'Branch', type: 'select', name: 'branch', options: ['Wadi Saqra', 'Swefieh', 'Swefieh Village', 'Manara'] },
    { label: 'Date', type: 'text', name: 'date' },
    { label: 'Time', type: 'text', name: 'time' },
    { label: 'Camera(s)', type: 'multi-select', name: 'cameras', options: [
      'Back of Kitchen','Kitchen','Pepsi Kitchen','Storehouse','Cashier','Main Stove','Prep Back Area','Prep Room',
      'Back Corridor','Fingerprint','Posterior View','Refrigerators','2 Pepsi Kitchen','Main Kitchen'
    ]},
    { label: 'Section(s)', type: 'multi-select', name: 'sections', options: [
      'Cash Wrap','Counter','Line','Grill','Fryer','Freezer','Fridge','Oven','Station','Rest Area','Stairs',
      'Front Door','Back Door','Sink','Front Area','Kitchen','Prep Main Stove','Prep Back Area'
    ]},
    { label: 'Staff Involved', type: 'multi-select', name: 'staff', options: [
      'Unknown','Khaled Al-Nimri','Faisal Al-Nimri','Tiffany Ghawi','Alia Al-Fares','Tamer Al-Sayegh',
      'Ibrahim Tamlih','Ahmed Athamneh','Tamer Tamlih','Osama','Mais Taha','Farid Al-Nabulsi',
      'Ahmed Dawood','Mohammed Abu Fadda','Mohammed Marafi','Mohammed Abu Abdullah','Reda Wagih',
      'Farid Al-Nabulsi','Marwa Mahmoud','Shahed Hadib','Amr Diab','Abdul Karim Noufal','Zaid Sawahy',
      'Abdul Rahman Sawalhi','Mohammed Al-Kurdi','Sabih Rani','Duaa Suleiman','Olorunsola oluwafemi bk',
      'Ahmed Al-Nabulsi','Jaber Sakr','Mohammed Awamleh','Zaid Waliili','Ihab Abu Zaid','Ahmed Naamneh',
      'Amer Al-Rantisi','Asid Ayad','Amer Abu Laila','Rand Asfour','Yaqoub Karadsheh','Diaa Al-Muzain',
      'Musab','Layla Qronfleh'
    ]},
    { label: 'Review Type', type: 'select', name: 'reviewType', options: ['Recorded', 'Live'] },
    { label: 'Violated Policy', type: 'multi-select', name: 'violations', options: [
      'Cleanliness','Punctuality','Cash Handling','Equipment Check','Personal Hygiene','Safety/Compliance',
      'Stock Management','Order Accuracy','Staff Behavior','Eating','Kitchen Tools Compliance','Other'
    ] },
    { label: 'Case Details', type: 'textarea', name: 'notes' },
    { label: 'Action Taken', type: 'textarea', name: 'actionTaken' }
  ],
  ce: [
    { label: 'Status', type: 'select', name: 'status', options: ['Closed','Under Review','Escalated','Pending (Customer Call Required)'] },
    { label: 'Order Number', type: 'text', name: 'orderNumber' },
    { label: 'Department Responsible', type: 'select', name: 'department', options: [
      'Kitchen','Delivery/Prepared Delay','Customer Service','Frontline / Cashier','IT','Operations','Management'
    ] },
    { label: 'Customer Name', type: 'text', name: 'customerName' },
    { label: 'Phone Number', type: 'text', name: 'phone' },
    { label: 'Creation Date', type: 'datetime-local', name: 'creationDate' },
    { label: 'Shift', type: 'select', name: 'shift', options: ['Shift A','Shift B'] },
    { label: 'Order Type', type: 'select', name: 'orderType', options: ['Delivery','Takeout'] },
    { label: 'Branch Name', type: 'select', name: 'branch', options: ['Swefieh','Wadi Saqra','Swefieh Village'] },
    { label: 'Restaurant', type: 'select', name: 'restaurant', options: [
      'Very Good Burger','Sager','Happy Tummies','Crunchychkn','Bun Run','Butter Me Up','Bint Halal',
      'Colors Catering','Heat Burger','Thyme Table',"Evi's",'Chili Charms'
    ] },
    { label: 'Order Channel', type: 'select', name: 'channel', options: ['Web','Call Center'] },
    { label: 'Feedback Date', type: 'datetime-local', name: 'feedbackDate' },
    { label: 'Issue Category', type: 'select', name: 'issueCategory', options: [
      'Positive Experience','Service Quality','Food Quality','Delivery/Prepared Time','Employee Attitude','Other'
    ] },
    { label: 'Case Details', type: 'textarea', name: 'customerNotes' },
    { label: 'Action Taken', type: 'textarea', name: 'actionTaken' },
    { label: 'Customer Satisfaction Level', type: 'select', name: 'satisfaction', options: ['Satisfied','Not Satisfied'] }
  ],
  'free-orders': [
    { label: 'Status', type: 'select', name: 'status', options: ['Active','Not Active','Taken'] },
    { label: 'Customer Name', type: 'text', name: 'customerName' },
    { label: 'Phone Number', type: 'text', name: 'phone' },
    { label: 'Order Date', type: 'datetime-local', name: 'orderDate' },
    { label: 'Order Number', type: 'text', name: 'orderNumber' },
    { label: 'Order on Circa', type: 'file', name: 'orderOnCirca', accept: 'image/*' },
    { label: 'Discount Amount', type: 'text', name: 'discountAmount' },
    { label: 'Reason for Discount', type: 'textarea', name: 'reasonForDiscount' },
    { label: 'Order Channel', type: 'select', name: 'channel', options: ['Circa','Talabat','Careem','Direct Order (From Store)'] },
    { label: 'Decision Maker', type: 'text', name: 'decisionMaker' },
    { label: 'Attached', type: 'file', name: 'attached', accept: 'image/*' },
    { label: 'The date of using the discount', type: 'datetime-local', name: 'discountDate' },
    { label: 'New order number', type: 'text', name: 'newOrderNumber' },
    { label: 'Deduction from', type: 'text', name: 'deductionFrom' },
    { label: 'Case description', type: 'textarea', name: 'caseDescription' }
  ],
  complaints: [
    { label: 'Status', type: 'select', name: 'status', options: ['Closed','Under Review','Escalated','Pending (Customer Call Required)'] },
    { label: 'Order Number', type: 'text', name: 'orderNumber' },
    { label: 'Department Responsible', type: 'select', name: 'department', options: [
      'Kitchen','Delivery/Prepared Delay','Customer Service','Frontline / Cashier','IT','Operations','Management'
    ] },
    { label: 'Customer Name', type: 'text', name: 'customerName' },
    { label: 'Phone Number', type: 'text', name: 'phone' },
    { label: 'Creation Date', type: 'text', name: 'creationDate' },
    { label: 'Shift', type: 'select', name: 'shift', options: ['Shift A','Shift B'] },
    { label: 'Order Type', type: 'select', name: 'orderType', options: ['Delivery','Takeout'] },
    { label: 'Branch Name', type: 'select', name: 'branch', options: ['Swefieh','Wadi Saqra','Swefieh Village'] },
    { label: 'Restaurant', type: 'select', name: 'restaurant', options: [
      'Very Good Burger','Sager','Happy Tummies','Crunchychkn','Bun Run','Butter Me Up','Bint Halal',
      'Colors Catering','Heat Burger','Thyme Table',"Evi's",'Chili Charms'
    ] },
    { label: 'Order Channel', type: 'select', name: 'channel', options: ['Circa','Talabat','Careem','Direct Order (From Store)'] },
    { label: 'Issue Category', type: 'select', name: 'issueCategory', options: [
      'Positive Experience','Service Quality','Food Quality','Delivery/Prepared Time','Employee Attitude','Other'
    ] },
    { label: 'Case Details', type: 'textarea', name: 'complaintDetails' },
    { label: 'Action Taken', type: 'textarea', name: 'actionTaken' },
  ],
  'time-table': [
    { label: 'Status', type: 'select', name: 'status', options: [
      'No Call Needed', 'Pending Call', 'No Answer', 'Scheduled', 'Issue', 'Returned'
    ] },
    { label: 'Customer Name', type: 'text', name: 'customerName' },
    { label: 'Phone Number', type: 'text', name: 'phone' },
    { label: 'Order Number', type: 'text', name: 'orderNumber' },
    { label: 'Order Date', type: 'datetime-local', name: 'orderDate' },
    { label: 'Return Date', type: 'datetime-local', name: 'returnDate' },
    { label: 'Amount to Be Refunded', type: 'text', name: 'amountToBeRefunded' },
    { label: 'Plates Quantity', type: 'text', name: 'platesQuantity' },
    { label: 'Plates Numbers', type: 'text', name: 'platesNumbers' },
    { label: 'Note', type: 'textarea', name: 'note' }
  ]
};

// ----------------------------
// Label prettifier
// ----------------------------
const FIELD_LABELS = {
  dateTime:'Date & Time', creationDate:'Creation Date', orderDate:'Order Date', returnDate:'Return Date',
  discountDate:'Discount Date', newOrderNumber:'New Order Number', orderNumber:'Order Number',
  phone:'Phone Number', reviewType:'Review Type', issueCategory:'Issue Category', decisionMaker:'Decision Maker',
  deductionFrom:'Deduction From', amountToBeRefunded:'Amount to be Refunded', platesQuantity:'Plates Quantity',
  platesNumbers:'Plates Numbers', caseDescription:'Case Description', customerNotes:'Case Details', actionTaken:'Action Taken'
};
function toLabel(field){
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  return field.replace(/[_-]/g,' ')
              .replace(/([a-z])([A-Z])/g,'$1 $2')
              .replace(/\b\w/g,ch=>ch.toUpperCase());
}

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
// Colored band + status colors
// ----------------------------
function bandClassForStatus(status){
  switch(status){
    case 'Taken': return 'band-taken';
    case 'Active': return 'band-active';
    case 'Not Active': return 'band-not-active';
    case 'Open': return 'band-open';
    case 'Follow-Up Needed': return 'band-follow-up-needed';
    case 'No Response': return 'band-no-response';
    case 'Call Back Scheduled': return 'band-call-back-scheduled';
    case 'In Progress': return 'band-in-progress';
    case 'Escalated': return 'band-escalated';
    case 'Resolved': return 'band-resolved';
    case 'Perfect Feedback': return 'band-perfect-feedback';
    case 'No Call Needed': return 'band-no-call-needed';
    case 'Pending Call': return 'band-pending-call';
    case 'Pending (Customer Call Required)': return 'band-pending-call';
    case 'No Answer': return 'band-called-no-answer';
    case 'Scheduled': return 'band-scheduled-for-delivery';
    case 'Issue': return 'band-issue-needs-follow-up';
    case 'Returned': return 'band-returned';
    case 'Closed': return 'band-closed';
    case 'Under Review': return 'band-under-review';
    default: return 'band-uncategorized';
  }
}

function statusColor(status){
  switch (status) {
    // common
    case 'Closed': return '#1a9324';
    case 'Under Review': return '#f91616';
    case 'Escalated': return '#1b16a3';

    // free-orders
    case 'Active': return '#1b16a3';
    case 'Taken': return '#1a9324';
    case 'Not Active': return '#f91616';

    // ce/complaints (alias)
    case 'Pending (Customer Call Required)':
    case 'Pending (Call Back)': return '#fd7e14';

    // time-table
    case 'Pending Call': return '#1b16a3';
    case 'No Answer': return '#ffd700';
    case 'Scheduled': return '#001f5b';
    case 'Issue': return '#ff8c00';
    case 'Returned': return '#1a9324';
    case 'No Call Needed': return '#4b4b4b';

    // others (brown family)
    case 'Open':
    case 'Follow-Up Needed':
    case 'No Response':
    case 'Call Back Scheduled':
    case 'In Progress':
    case 'Resolved':
    case 'Perfect Feedback':
      return '#8b4513';

    default:
      return '#1e3a8a';
  }
}

// ----------------------------
// Helpers
// ----------------------------
function escapeHtml(s=''){
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// ----------------------------
// Ticket list rendering
// ----------------------------
function getMainFieldsContent(ticket){
  const fields = mainFields[_currentSection] || [];
  let html='';
  fields.forEach(f=>{
    const v = ticket[f] ?? 'Not specified';
    html += `<p><strong>${toLabel(f)}:</strong> ${Array.isArray(v)? v.join(', ') : escapeHtml(v)}</p>`;
  });
  return html;
}

function getCaseDisplay(ticket){
  if (_currentSection==='cctv') return ticket.caseNumber || '—';
  return ticket.orderNumber || ticket.caseNumber || '—';
}
function drawerCaseLabel(){ return 'Case Number'; }

function renderTickets(){
  const wrap = document.getElementById('tickets');
  if (!wrap) return;
  wrap.innerHTML = '';

  const sectionTickets = tickets[_currentSection] || [];

  // group by status (using display name)
  const grouped = {};
  sectionTickets.forEach(t=>{
    const st = t.status || 'Uncategorized';
    const key = displayStatusName(st);
    (grouped[key] ||= []).push(t);
  });

  const desiredRaw = STATUS_COLUMNS[_currentSection] || Object.keys(grouped);
  const desired = desiredRaw.map(displayStatusName);
  const known = new Set(desired);
  const extras = Object.keys(grouped).filter(s=>!known.has(s));

  const HIDDEN = new Set(['Uncategorized','',null,undefined]);
  const columns = [...desired, ...extras].filter(s => !HIDDEN.has(s));

  wrap.style.setProperty('--cols', Math.max(1, columns.length));

  columns.forEach(status=>{
    const col = document.createElement('section');
    col.className = 'group';

    const count = (grouped[status]||[]).length;

    const header = document.createElement('div');
    header.className = 'col-header';
    header.innerHTML = `
      <div class="col-header-inner">
        <div class="col-title">${status}</div>
        <span class="col-count">${count}</span>
      </div>
    `;
    col.appendChild(header);

    const under = document.createElement('div');
    under.className = 'col-underbar';
    col.appendChild(under);

    (grouped[status]||[]).forEach(ticket=>{
      const card = document.createElement('div');
      card.className = 'ticket-card';

      let timeStr = '';
      const baseDT = ticket.dateTime || ticket.creationDate || ticket.orderDate;
      if (baseDT){
        const d = new Date(baseDT);
        if (!isNaN(d)) {
         timeStr = d.toLocaleDateString('en-US');

        }
      }

      const band = `
        <div class="card-band ${bandClassForStatus(ticket.status)}">
          <span class="band-status">${displayStatusName(ticket.status || 'Uncategorized')}</span>
          <span class="band-case">${escapeHtml(getCaseDisplay(ticket))}</span>
        </div>
      `;

      const head = `
        <div class="card-top"></div>
        ${band}
        <div class="card-head">
          <span class="card-time">${timeStr}</span>
        </div>
      `;

      const main = `
        <div class="card-main">
          ${getMainFieldsContent(ticket)}
          <div class="card-foot">
            <span class="card-case">${escapeHtml(getCaseDisplay(ticket))}</span>
          </div>
        </div>
      `;

      card.innerHTML = head + main;
      card.addEventListener('click', ()=> openTicketDrawerByCase(getCaseDisplay(ticket)));
      col.appendChild(card);
    });

    wrap.appendChild(col);
  });
}

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
  return `
    <div class="form-group">
      <label>Status</label>
      <select name="status">
        ${options.map(o=>`<option value="${o}" ${ticket.status===o?'selected':''}>${o}</option>`).join('')}
      </select>
    </div>
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


// ============================
// History modal (fetch + render)
// ============================

function ensureHistoryModal() {
  // يبحث عن مودال جاهز، إذا مش موجود بننشئه
  let modal = document.getElementById('history-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'history-modal';
  modal.style.cssText = `
    position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.35); z-index: 9999;
  `;
  modal.innerHTML = `
    <div id="history-panel" style="
      width: min(680px, 92vw); max-height: 80vh; overflow:auto;
      background: #fff; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      padding: 16px 18px;
    ">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <h3 style="margin:0; font-size:18px;">Change History</h3>
        <button id="history-close" style="
          border:0; background:#eee; padding:6px 10px; border-radius:8px; cursor:pointer;
        ">Close</button>
      </div>
      <div id="history-body" style="margin-top:10px; font-size:14px;"></div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#history-close').onclick = () => { modal.style.display = 'none'; };
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  return modal;
}

function formatDT(dtStr) {
  try {
    const d = new Date(dtStr);
    if (isNaN(d)) return dtStr || '';
    const dPart = d.toLocaleDateString('en-US');
    const tPart = d.toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit', hour12:true});
    return `${dPart} ${tPart}`;
  } catch {
    return dtStr || '';
  }
}

function buildHistoryHTML(rows) {
  if (!rows || rows.length === 0) {
    return `<div style="padding:8px 4px; color:#666;">No changes logged yet.</div>`;
  }

  const header = `
    <div style="
      display:grid; grid-template-columns: 150px 140px 1fr 1fr; gap:8px;
      font-weight:600; border-bottom:1px solid #eee; padding:6px 0;
    ">
      <div>When</div>
      <div>By</div>
      <div>Status</div>
      <div>Action Taken</div>
    </div>
  `;

  const rowsHtml = rows.map(r => {
    const statusPart = `
      <div>
        ${escapeHtml(r.prev_status || '—')} &nbsp;→&nbsp; <strong>${escapeHtml(r.new_status || '—')}</strong>
      </div>
    `;
    const actionPart = `
      <div>
        ${escapeHtml(r.prev_action || '—')} &nbsp;→&nbsp; <strong>${escapeHtml(r.new_action || '—')}</strong>
      </div>
    `;
    return `
      <div style="
        display:grid; grid-template-columns: 150px 140px 1fr 1fr; gap:8px;
        border-bottom:1px dashed #eee; padding:8px 0;
      ">
        <div>${formatDT(r.changed_at)}</div>
        <div>${escapeHtml(r.changed_by || '—')}</div>
        ${statusPart}
        ${actionPart}
      </div>
    `;
  }).join('');

  return header + rowsHtml;
}

async function viewTicketHistory(ticketId){
  const modal = ensureHistoryModal();
  const body  = modal.querySelector('#history-body');

  body.innerHTML = `<div style="padding:8px 4px; color:#666;">Loading…</div>`;
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/.netlify/functions/tickets?history=1&id=${encodeURIComponent(ticketId)}`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed loading history');
    body.innerHTML = buildHistoryHTML(data.history || []);
  } catch (err) {
    body.innerHTML = `<div style="padding:8px 4px; color:#c00;">${escapeHtml(err.message || 'Error')}</div>`;
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

  // تعديل محلي سريع
  t.status       = fd.get('status');
  t.actionTaken  = fd.get('actionTaken');
  t.lastModified = new Date().toISOString();
  saveTicketsToStorage();
  renderTickets();

  try {
    // 1) تحديث الـ DB لو له id
    if (Number.isFinite(Number(t._id))) {
      const res = await fetch('/.netlify/functions/tickets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: Number(t._id),
          section: String(_currentSection),
          status: String(t.status || ''),
          actionTaken: String(t.actionTaken ?? ''),
          changedBy: CURRENT_USER
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Update failed');
    } else {
      console.warn('No DB id → ticket came from Google Sheets, DB PUT skipped.');
    }

    // 2) حدّث Google Sheets دائمًا (حسب caseNumber)
    if (!t.caseNumber) {
      console.warn('No caseNumber on ticket → Sheets PUT skipped.');
    } else {
      const headers = { 'Content-Type': 'application/json' };
      if (SHEETS_APP_SECRET) headers['X-App-Secret'] = SHEETS_APP_SECRET;

      const resS = await fetch(SHEETS_ENDPOINT, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          section: _currentSection,           // مهم
          tab: sheetTab(_currentSection),     // اسم الورقة
          caseNumber: t.caseNumber,
          status: t.status,
          actionTaken: t.actionTaken
        })
      });
      const dataS = await resS.json().catch(() => ({}));
      if (!resS.ok || dataS?.ok === false) throw new Error(dataS?.error || 'Sheets update failed');
    }

    // 3) اعمل ريفرش من المصدرين
    await hydrateFromDB(_currentSection);
    await hydrateFromSheets(_currentSection);

  } catch (err) {
    console.warn('Update failed:', err);
    alert('Failed to save changes to the server.');
  }

  // أعد فتح الـDrawer محدث
  openTicketDrawer(drawerIndex);
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: Number(t._id), section: String(_currentSection), by: CURRENT_USER })
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || 'DB delete failed');
    }

    // 2) حذف من Google Sheets حسب caseNumber
    if (t.caseNumber) {
      const headers = { 'Content-Type': 'application/json' };
      if (SHEETS_APP_SECRET) headers['X-App-Secret'] = SHEETS_APP_SECRET;

      const resS = await fetch(SHEETS_ENDPOINT, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({
          section: _currentSection,
          tab: sheetTab(_currentSection),
          caseNumber: t.caseNumber,
          by: CURRENT_USER
        })
      });
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
      await fetch('/.netlify/functions/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: _currentSection,
          status: t.status || 'Under Review',
          payload: t ,
          changedBy: CURRENT_USER   // ✅ إضافة اسم المستخدم
        })
      });
      // اسحب من الداتابيس لضمان التزامن + إعطاء ID رسمي
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
async function hydrateFromDB(section) {
  const sec = section || window.currentSection || 'cctv';
  try {
    const res = await fetch(`/.netlify/functions/tickets?section=${encodeURIComponent(sec)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'fetch failed');

    tickets[sec] = (data.tickets || []).map(rowToTicket);
    saveTicketsToStorage();
    renderTickets();
   if (Array.isArray(tickets[sec]) && tickets[sec].length > 0) {
  console.log(`Hydrated ${sec} from DB →`, tickets[sec].length, 'tickets');
}

  } catch (err) {
    console.error('DB hydrate failed:', err);
  }
}

// ----------------------------
// Page load + polling (موحد)
// ----------------------------
window.addEventListener('load', async ()=>{
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
    centerLogo.addEventListener('click', ()=> { window.location.href = 'dashboard.html'; });
  }

  // اعرض المحلي ثم حمّل من الداتابيس + الشيت
  renderTickets();
  await hydrateFromDB(window.currentSection);
  await hydrateFromSheets(window.currentSection);   // ← أضِف هذا السطر
  await autoSeedSheetTickets(window.currentSection);


  // فعّل الريفريش الدوري (ويمنع التكرار)
  if (window.__ticketsPoller) clearInterval(window.__ticketsPoller);
  const poll = async () => {
    await hydrateFromDB(window.currentSection || 'cctv');
    await hydrateFromSheets(window.currentSection || 'cctv');  // ← واستدعِ الشيت هنا كمان
    await autoSeedSheetTickets(window.currentSection || 'cctv'); // أضفها هون
  };
  window.__ticketsPoller = setInterval(poll, 15000); // كل 15 ثانية
});

// ----------------------------
// Auth/logout (optional)
// ----------------------------
function logout() {
  const confirmLogout = confirm("Confirm logout?");
  if (confirmLogout) window.location.href = "index.html";
}
window.logout = logout;

// ----------------------------
// (Optional) Sync from Lark (لا تستخدم الآن)
// ----------------------------
async function syncCCTVFromLark() {
  try {
    const res = await fetch('/.netlify/functions/lark-cctv-pull');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Failed fetching CCTV tickets');

    let newTickets = data.tickets || [];
    const oldTickets = tickets.cctv || [];
    const oldKeys = new Set(oldTickets.map(t => t._key));
    const freshOnes = newTickets.filter(t => !oldKeys.has(t._key));
    tickets.cctv = [...oldTickets, ...freshOnes];

    localStorage.setItem('cloudCrowdTickets', JSON.stringify(tickets));
    renderTickets();
    console.log(`Synced ${freshOnes.length} new CCTV tickets`);
  } catch (err) {
    console.warn('Sync CCTV skipped:', err.message);
  }
}
window.syncCCTVFromLark = syncCCTVFromLark;

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








































