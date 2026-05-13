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
    const res = await fetch(`/.netlify/functions/tickets?history=1&id=${encodeURIComponent(ticketId)}`, {
      headers: getAuthHeaders()
    });
    if (handleAuthFailure(res)) return;
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed loading history');
    body.innerHTML = buildHistoryHTML(data.history || []);
  } catch (err) {
    body.innerHTML = `<div style="padding:8px 4px; color:#c00;">${escapeHtml(err.message || 'Error')}</div>`;
  }
}

window.viewTicketHistory = viewTicketHistory;
window.ensureHistoryModal = ensureHistoryModal;
