// ============================
// History modal (fetch + render)
// ============================

function ensureHistoryModal() {
  // يبحث عن مودال جاهز، إذا مش موجود بننشئه
  let modal = document.getElementById('history-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'history-modal';
  modal.className = 'history-modal';
  modal.innerHTML = `
    <div id="history-panel" class="history-modal__panel cc-dialog__panel cc-dialog__panel--680" role="dialog" aria-modal="true" aria-labelledby="history-modal-title" data-cc-overlay-panel>
      <div class="history-modal__header cc-dialog__header">
        <h3 id="history-modal-title" class="history-modal__title cc-modal-title cc-dialog__title">Change History</h3>
        <button id="history-close" class="history-modal__close cc-dialog__close" type="button" data-cc-overlay-close>Close</button>
      </div>
      <div id="history-body" class="history-modal__body cc-dialog__body"></div>
    </div>
  `;
  document.body.appendChild(modal);

  window.CloudCrowdOverlay?.register(modal, {
    type: 'history',
    panel: '#history-panel',
    dismissOnEscape: true,
    dismissOnBackdrop: true,
    initialFocus: '#history-close',
    lockScroll: true
  });
  modal.querySelector('#history-close').onclick = () => {
    if (window.CloudCrowdOverlay) window.CloudCrowdOverlay.close(modal.id, { reason: 'close-button' });
    else modal.classList.remove('is-open');
  };

  return modal;
}



function buildHistoryHTML(rows) {
  if (!rows || rows.length === 0) {
    return `<div class="history-state history-state--empty">No changes logged yet.</div>`;
  }

  const header = `
    <div class="history-grid history-grid--header">
      <div class="history-grid__meta">When</div>
      <div class="history-grid__meta">By</div>
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
      <div class="history-grid history-grid--item">
        <div class="history-grid__meta">${formatDT(r.changed_at)}</div>
        <div class="history-grid__meta">${escapeHtml(r.changed_by || '—')}</div>
        ${statusPart}
        ${actionPart}
      </div>
    `;
  }).join('');

  return header + rowsHtml;
}

async function loadTicketHistory(ticketId, body){
  if (!body) return;
  body.innerHTML = `<div class="history-state history-state--loading">Loading&hellip;</div>`;
  try {
    const res = await fetch(`/.netlify/functions/tickets?history=1&id=${encodeURIComponent(ticketId)}`, {
      headers: getAuthHeaders()
    });
    if (handleAuthFailure(res)) return;
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed loading history');
    body.innerHTML = buildHistoryHTML(data.history || []);
  } catch (err) {
    body.innerHTML = `<div class="history-state history-state--error">${escapeHtml(err.message || 'Error')}</div>`;
  }
}

async function viewTicketHistory(ticketId, trigger, inlineBody){
  if (inlineBody) return loadTicketHistory(ticketId, inlineBody);
  const modal = ensureHistoryModal();
  const body  = modal.querySelector('#history-body');

  body.innerHTML = `<div class="history-state history-state--loading">Loading…</div>`;
  if (window.CloudCrowdOverlay) window.CloudCrowdOverlay.open(modal.id, { trigger });
  else modal.classList.add('is-open');

  try {
    const res = await fetch(`/.netlify/functions/tickets?history=1&id=${encodeURIComponent(ticketId)}`, {
      headers: getAuthHeaders()
    });
    if (handleAuthFailure(res)) return;
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed loading history');
    body.innerHTML = buildHistoryHTML(data.history || []);
  } catch (err) {
    body.innerHTML = `<div class="history-state history-state--error">${escapeHtml(err.message || 'Error')}</div>`;
  }
}

window.viewTicketHistory = viewTicketHistory;
window.loadTicketHistory = loadTicketHistory;
window.ensureHistoryModal = ensureHistoryModal;
