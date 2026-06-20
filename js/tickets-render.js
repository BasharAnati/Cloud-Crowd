// ----------------------------
// Colored band + status colors
// ----------------------------
function bandClassForStatus(status){
  switch(status){
    case 'Taken': return 'band-taken';
    case 'Active': return 'band-active';
    case 'New': return 'band-not-active';
    case 'Open': return 'band-open';
    case 'Follow-Up Needed': return 'band-follow-up-needed';
    case 'No Response': return 'band-no-response';
    case 'Call Back Scheduled': return 'band-call-back-scheduled';
    case 'In Progress': return 'band-in-progress';
    case 'Escalated': return 'band-escalated';
    case 'Resolved': return 'band-resolved';
    case 'Perfect Feedback': return 'band-perfect-feedback';
    case 'Pending (Customer Call Required)': return 'band-pending-call';
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
    case 'New': return '#f91616';

    // ce/complaints (alias)
    case 'Pending (Customer Call Required)':
    case 'Pending (Call Back)': return '#fd7e14';

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
// Ticket list rendering
// ----------------------------
function getMainFieldsContent(ticket){
  const fields = mainFields[window.currentSection] || [];
  let html='';
  fields.forEach(f=>{
    const v = (window.currentSection === 'ce' && f === 'orderNumber')
      ? (ticket.orderNumber || ticket.caseNumber || 'Not specified')
      : (ticket[f] ?? 'Not specified');
    html += `<p><strong>${toLabel(f)}:</strong> ${Array.isArray(v)? v.join(', ') : escapeHtml(v)}</p>`;
  });
  return html;
}

function getCaseDisplay(ticket){
  if (!ticket) return '—';
  if (window.currentSection==='cctv') return ticket.caseNumber || '—';
  return ticket.orderNumber || ticket.caseNumber || '—';
}

function drawerCaseLabel(){
  return window.currentSection === 'ce' ? 'Order Number' : 'Case Number';
}

function normalizeFilterText(value){
  return String(value || '').trim().toLowerCase();
}

function getCeFilterState(){
  const search = document.getElementById('ce-search');
  const status = document.getElementById('ce-status-filter');
  const branch = document.getElementById('ce-branch-filter');
  const restaurant = document.getElementById('ce-restaurant-filter');

  return {
    query: normalizeFilterText(search?.value),
    status: status?.value || '',
    branch: branch?.value || '',
    restaurant: restaurant?.value || ''
  };
}

function updateSelectOptions(select, values, placeholder){
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>`;
  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = displayStatusName(value);
    select.appendChild(option);
  });
  select.value = values.includes(current) ? current : '';
}

function bindCeFilters(){
  if (window.__ceFiltersBound) return;
  const controls = [
    document.getElementById('ce-search'),
    document.getElementById('ce-status-filter'),
    document.getElementById('ce-branch-filter'),
    document.getElementById('ce-restaurant-filter')
  ].filter(Boolean);

  controls.forEach(control => {
    const eventName = control.tagName === 'INPUT' ? 'input' : 'change';
    control.addEventListener(eventName, () => renderTickets());
  });
  window.__ceFiltersBound = true;
}

function updateCeStatsAndFilters(sectionTickets){
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  };

  setText('ce-stat-total', sectionTickets.length);
  setText('ce-stat-under-review', sectionTickets.filter(t => t.status === 'Under Review').length);
  setText('ce-stat-pending', sectionTickets.filter(t => t.status === 'Pending (Customer Call Required)').length);
  setText('ce-stat-closed', sectionTickets.filter(t => t.status === 'Closed').length);

  const statusValues = STATUS_COLUMNS.ce || [];
  const branchValues = [...new Set(sectionTickets.map(t => t.branch).filter(Boolean))].sort();
  const restaurantValues = [...new Set(sectionTickets.map(t => t.restaurant).filter(Boolean))].sort();

  updateSelectOptions(document.getElementById('ce-status-filter'), statusValues, 'All statuses');
  updateSelectOptions(document.getElementById('ce-branch-filter'), branchValues, 'All branches');
  updateSelectOptions(document.getElementById('ce-restaurant-filter'), restaurantValues, 'All restaurants');
  bindCeFilters();
}

function ceTicketMatchesFilters(ticket, filters){
  if (filters.status && ticket.status !== filters.status) return false;
  if (filters.branch && ticket.branch !== filters.branch) return false;
  if (filters.restaurant && ticket.restaurant !== filters.restaurant) return false;

  if (!filters.query) return true;
  const haystack = [
    ticket.orderNumber,
    ticket.caseNumber,
    ticket.customerName,
    ticket.phone
  ].map(normalizeFilterText).join(' ');

  return haystack.includes(filters.query);
}

function formatTicketDate(ticket){
  const baseDT = ticket.feedbackDate || ticket.creationDate || ticket.dateTime || ticket.orderDate;
  if (!baseDT) return '';
  const d = new Date(baseDT);
  return isNaN(d) ? String(baseDT) : d.toLocaleDateString('en-US');
}

function getCeCardContent(ticket){
  const orderNumber = getCaseDisplay(ticket);
  const status = ticket.status || 'Uncategorized';
  const dateText = formatTicketDate(ticket);
  const field = (label, value) => value
    ? `<span><strong>${label}</strong>${escapeHtml(value)}</span>`
    : '';

  return `
    <div class="ce-ticket-top">
      <span class="ce-status-pill ${bandClassForStatus(status)}">${displayStatusName(status)}</span>
      ${dateText ? `<span class="ce-ticket-date">${escapeHtml(dateText)}</span>` : ''}
    </div>
    <div class="ce-ticket-order">${escapeHtml(orderNumber)}</div>
    <div class="ce-ticket-customer">${escapeHtml(ticket.customerName || 'Customer not specified')}</div>
    <div class="ce-ticket-grid">
      ${field('Branch', ticket.branch)}
      ${field('Restaurant', ticket.restaurant)}
      ${field('Issue', ticket.issueCategory)}
      ${field('Phone', ticket.phone)}
    </div>
  `;
}

function createCeEmptyState(kind){
  const empty = document.createElement('div');
  empty.className = 'ce-empty-state';
  if (kind === 'filter') {
    empty.innerHTML = `
      <strong>No matching cases</strong>
      <span>Adjust the search or filters to bring tickets back into view.</span>
    `;
  } else {
    empty.innerHTML = `
      <strong>No Customer Experience cases yet</strong>
      <span>New tickets will appear here as soon as they are created or synced.</span>
    `;
  }
  return empty;
}

function renderTickets(){
  const wrap = document.getElementById('tickets');
  if (!wrap) return;
  wrap.innerHTML = '';

  const isCe = window.currentSection === 'ce';
  const sectionTickets = tickets[window.currentSection] || [];
  if (isCe) updateCeStatsAndFilters(sectionTickets);
  const visibleTickets = isCe
    ? sectionTickets.filter(ticket => ceTicketMatchesFilters(ticket, getCeFilterState()))
    : sectionTickets;

  if (isCe && !sectionTickets.length) {
    wrap.appendChild(createCeEmptyState('board'));
  } else if (isCe && !visibleTickets.length) {
    wrap.appendChild(createCeEmptyState('filter'));
  }

  // group by status (using display name)
  const grouped = {};
  visibleTickets.forEach(t=>{
    const st = t.status || 'Uncategorized';
    const key = displayStatusName(st);
    (grouped[key] ||= []).push(t);
  });

  const desiredRaw = STATUS_COLUMNS[window.currentSection] || Object.keys(grouped);
  const desired = desiredRaw.map(displayStatusName);
  const known = new Set(desired);
  const extras = Object.keys(grouped).filter(s=>!known.has(s));

  const HIDDEN = new Set(['Uncategorized','',null,undefined]);
  const columns = [...desired, ...extras].filter(s => !HIDDEN.has(s));

  wrap.style.setProperty('--cols', Math.max(1, columns.length));

  columns.forEach(status=>{
    const col = document.createElement('section');
    col.className = `group ${isCe ? 'ce-column' : ''}`;

    const count = (grouped[status]||[]).length;

    const header = document.createElement('div');
    header.className = 'col-header';
    header.innerHTML = `
      <div class="col-header-inner">
        <div class="col-title">${escapeHtml(status)}${isCe ? '' : ` (${count})`}</div>
        ${isCe ? `<span class="col-count">${count}</span>` : ''}
      </div>
    `;
    col.appendChild(header);

    const under = document.createElement('div');
    under.className = 'col-underbar';
    col.appendChild(under);

    const statusTickets = grouped[status] || [];

    if (!statusTickets.length) {
      const empty = document.createElement('div');
      empty.className = 'kanban-empty-state';
      empty.textContent = isCe ? 'No cases in this status' : 'No tickets in this status';
      col.appendChild(empty);
    }

    statusTickets.forEach(ticket=>{
      const card = document.createElement('div');
      card.className = isCe ? 'ticket-card ce-ticket-card' : 'ticket-card';

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

      card.innerHTML = isCe ? getCeCardContent(ticket) : head + main;
      card.addEventListener('click', ()=> openTicketDrawerByCase(getCaseDisplay(ticket)));
      col.appendChild(card);
    });

    wrap.appendChild(col);
  });
}

// -----------------------------
// DOM update helpers
// -----------------------------
function addTicketToDOM(ticket) {
  const container = document.querySelector('.tickets-container');
  if (!container) return;
  const el = createTicketElement(ticket);
  container.appendChild(el);
}

function updateTicketInDOM(ticket) {
  const el = document.querySelector(`[data-case="${ticket.caseNumber}"]`);
  if (!el) return addTicketToDOM(ticket); // Ù„Ùˆ Ù…Ø´ Ù…ÙˆØ¬ÙˆØ¯ØŒ Ø£Ø¶ÙÙ‡
  const newEl = createTicketElement(ticket);
  el.replaceWith(newEl);
}

function removeTicketFromDOM(key) {
  const el = document.querySelector(`[data-case="${key}"]`);
  if (el) el.remove();
}

// -----------------------------
// Ticket element factory
// -----------------------------
function createTicketElement(ticket) {
  const div = document.createElement('div');
  div.className = 'ticket';
  div.setAttribute('data-case', ticket.caseNumber || ticket.orderNumber);

  // Ù…Ø­ØªÙˆÙ‰ Ø§Ù„ØªÙƒØª (ØªÙ‚Ø¯Ø± ØªØ¹Ø¯Ù„ Ø­Ø³Ø¨ Ø§Ù„ØªØµÙ…ÙŠÙ…)
  div.innerHTML = `
    <h4>${ticket.title || 'Untitled'}</h4>
    <p>Status: ${ticket.status || 'Unknown'}</p>
    <p>Assigned to: ${ticket.assigned || 'Unassigned'}</p>
  `;
  return div;
}

window.renderTickets = renderTickets;
window.addTicketToDOM = addTicketToDOM;
window.updateTicketInDOM = updateTicketInDOM;
window.removeTicketFromDOM = removeTicketFromDOM;
window.getCaseDisplay = getCaseDisplay;
window.drawerCaseLabel = drawerCaseLabel;
window.bandClassForStatus = bandClassForStatus;
window.statusColor = statusColor;
