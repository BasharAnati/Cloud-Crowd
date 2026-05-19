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
    case 'New': return '#f91616';

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
// Ticket list rendering
// ----------------------------
function getMainFieldsContent(ticket){
  const fields = mainFields[window.currentSection] || [];
  let html='';
  fields.forEach(f=>{
    const v = ticket[f] ?? 'Not specified';
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

function renderTickets(){
  const wrap = document.getElementById('tickets');
  if (!wrap) return;
  wrap.innerHTML = '';

  const sectionTickets = tickets[window.currentSection] || [];

  // group by status (using display name)
  const grouped = {};
  sectionTickets.forEach(t=>{
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
    col.className = 'group';

    const count = (grouped[status]||[]).length;

    const header = document.createElement('div');
    header.className = 'col-header';
    header.innerHTML = `
      <div class="col-header-inner">
        <div class="col-title">${escapeHtml(status)} (${count})</div>
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
      empty.textContent = 'No tickets in this status';
      col.appendChild(empty);
    }

    statusTickets.forEach(ticket=>{
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
