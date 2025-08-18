// ============================
// Cloud Crowd - main.js (Cleaned + window.currentSection binding)
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

// ----------------------------
// Config: main fields on cards
// ----------------------------
const mainFields = {
  cctv: ['branch', 'staff', 'dateTime'],
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
// Form fields per section (كما زوّدتني)
// ----------------------------
const formFields = {
  cctv: [
    { label: 'Case Status', type: 'select', name: 'status', options: ['Closed', 'Under Review', 'Escalated'] },
    { label: 'Branch', type: 'select', name: 'branch', options: ['Wadi Saqra', 'Swefieh', 'Swefieh Village', 'Manara'] },
    { label: 'Date', type: 'date', name: 'date' },
    { label: 'Time', type: 'time', name: 'time' },
    { label: 'Camera(s)', type: 'multi-select', name: 'cameras', options: [
      'Back of Kitchen','Kitchen','Pepsi Kitchen','Storehouse','Cashier','Main Stove','Prep Back Area','Prep Room',
      'Back Corridor','Fingerprint','Posterior View','Refrigerators','2 Pepsi Kitchen','Main Kitchen'
    ]},
    { label: 'Section(s)', type: 'multi-select', name: 'sections', options: [
      'Cash Wrap','Counter','Line','Grill','Fryer','Freezer','Fridge','Oven','Station','Rest Area','Stairs',
      'Front Door','Back Door','Sink','Front Area','Kitchen','Prep Main Stove','Prep Back Area'
    ]},
    { label: 'Staff Involved', type: 'multi-select', name: 'staff', options: [
      'Khaled Al-Nimri','Faisal Al-Nimri','Ahmad Al-Masri','Sarah Al-Husseini','Omar Al-Khatib','Lina Abu Zaid',
      'Yazan Al-Jabari','Rania Al-Tamimi','Tareq Al-Saleh','Dalia Al-Khaled','Ziad Al-Najjar','Nour Al-Faraj',
      'Hani Al-Majali','Maya Al-Qudah','Samer Al-Hassan','Leen Al-Rawashdeh','Bilal Al-Sharif','Hana Al-Atrash',
      'Majed Al-Din','Rawan Al-Bakri','Zain Al-Hayek','Sahar Al-Saleem','Fadi Al-Masoud','Yasmin Al-Khateب',
      'Sami Al-Khalil','Nourhan Al-Salem','Kamal Al-Zu’bi','Dima Al-Hامdan','Mazen Al-Tarawneh','Huda Al-Jarrah',
      'Rami Al-Nouri','Amal Al-Sharaf','Talal Al-Masri','Lara Al-Farouq','Nader Al-Haj','Salma Al-Hussain',
      'Issa Al-Qasem','Dina Al-Majed'
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
    { label: 'Creation Date', type: 'datetime-local', name: 'creationDate' },
    { label: 'Shift', type: 'select', name: 'shift', options: ['Shift A','Shift B'] },
    { label: 'Order Type', type: 'select', name: 'orderType', options: ['Delivery','Takeout'] },
    { label: 'Branch Name', type: 'select', name: 'branch', options: ['Swefieh','Wadi Saqra','Swefieh Village'] },
    { label: 'Restaurant', type: 'select', name: 'restaurant', options: [
      'Very Good Burger','Sager','Happy Tummies','Crunchychkn','Bun Run','Butter Me Up','Bint Halال',
      'Colors Catering','Heat Burger','Thyme Table',"Evi's",'Chili Charms'
    ] },
    { label: 'Order Channel', type: 'select', name: 'channel', options: ['Circa','Talabat','Careem','Direct Order (From Store)'] },
    { label: 'Issue Category', type: 'select', name: 'issueCategory', options: [
      'Positive Experience','Service Quality','Food Quality','Delivery/Prepared Time','Employee Attitude','Other'
    ] },
    { label: 'Case Details', type: 'textarea', name: 'complaintDetails' },
    { label: 'Action Taken', type: 'textarea', name: 'actionTaken' },
    { label: 'Attached', type: 'file', name: 'attached', accept: 'image/*' }
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
          timeStr = d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true});
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

  const IGNORE = new Set(['createdAt','lastModified','date','time','dateTime','actionTaken',
    'note','notes','customerNotes','complaintDetails','caseDescription'
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

  if (notesText){
    const noteTitle = (_currentSection === 'time-table' || notesKeyUsed === 'note') ? 'Note' : 'Case Details';
    html += `
      <div class="note-box full-span">
        <div class="note-title">${noteTitle}</div>
        <div class="note-text">${escapeHtml(notesText)}</div>
      </div>
    `;
  }

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

  let metaFrag = '';
  if (ticket.lastModified){
    const md = new Date(ticket.lastModified);
    metaFrag = `
      <div class="meta-item"><strong>Last Edit:</strong> ${md.toLocaleDateString('en-US')}</div>
      <div class="meta-item"><strong>At:</strong> ${md.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true})}</div>
    `;
  }
  metaEl.innerHTML = `<span class="meta-badge ${bandClassForStatus(ticket.status)}">
    ${displayStatusName(ticket.status || 'Uncategorized')}
  </span>${metaFrag}`;

  bodyEl.innerHTML = buildDrawerReadonly(ticket);

  if (actions){
    actions.innerHTML = `<button id="drawer-edit-btn" class="edit-btn">Edit</button>`;
    actions.querySelector('#drawer-edit-btn').onclick = ()=> enterDrawerEditMode();
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

function saveDrawerEdits(){
  if (drawerIndex==null) return;
  const form = document.getElementById('drawer-edit-form');
  if (!form) return;
  const fd = new FormData(form);
  const t = tickets[_currentSection][drawerIndex];
  t.status = fd.get('status');
  t.actionTaken = fd.get('actionTaken');
  t.lastModified = new Date().toISOString();

  saveTicketsToStorage();
  renderTickets();
  openTicketDrawer(drawerIndex);
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
  window.currentSection = section; // يحدّث المتغيّر الداخلي أيضاً
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
// Add form handler
// ----------------------------
function bindFormHandler(){
  const formEl = document.getElementById('ticket-form');
  if (!formEl) return;
  formEl.addEventListener('submit',(e)=>{
    e.preventDefault();
    const t = {};
    formFields[_currentSection].forEach(field=>{
      if (field.type==='multi-select'){
        const multi = document.querySelector(`.multi-select[data-name="${field.name}"]`);
        t[field.name] = Array.from(multi.querySelectorAll('input:checked')).map(cb=>cb.value);
      } else if (field.type==='file'){
        const input = e.target.elements[field.name];
        t[field.name] = input.dataset.pasted || (input.files && input.files[0]? URL.createObjectURL(input.files[0]) : '');
      } else {
        const input = e.target.elements[field.name];
        if (input) t[field.name] = input.value;
      }
    });

    if (_currentSection==='cctv'){
      t.caseNumber = nextCaseNumber('cctv');
    }
    t.createdAt = new Date().toISOString();

    tickets[_currentSection].push(t);
    saveTicketsToStorage();
    renderTickets();
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

window.addEventListener('load', ()=>{
  const saved = localStorage.getItem('cloudCrowdTickets');
  if (saved) tickets = JSON.parse(saved);
  ensureCaseNumbers();
  saveTicketsToStorage();

  const centerLogo = document.querySelector('.nav-center-logo');
  if (centerLogo){
    centerLogo.addEventListener('click', ()=> { window.location.href = 'dashboard.html'; });
  }
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
// (Optional) Sync from Lark (safe no-op if endpoint غير موجود)
// ----------------------------
async function syncCCTVFromLark() {
  try {
    const res = await fetch('/.netlify/functions/lark-cctv-pull');
    if (!res.ok) return; // لو محذوفة الفنكشن أو 404، تجاهل بصمت
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
