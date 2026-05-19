function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

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

function caseKey(t) {
  if (t?._sheetRowKey && String(t._sheetRowKey).startsWith('ce:')) {
    return String(t._sheetRowKey).trim();
  }
  return (t?.caseNumber || t?.orderNumber || '').toString().trim();
}

function isFromSheet(t) {
  return !Number.isFinite(Number(t?._id));
}

function displayStatusName(name) {
  return STATUS_DISPLAY_MAP[name] || name;
}

function toLabel(field) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  return field.replace(/[_-]/g, ' ')
              .replace(/([a-z])([A-Z])/g, '$1 $2')
              .replace(/\b\w/g, ch => ch.toUpperCase());
}

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDT(dtStr) {
  try {
    const d = new Date(dtStr);
    if (isNaN(d)) return dtStr || '';
    const dPart = d.toLocaleDateString('en-US');
    const tPart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${dPart} ${tPart}`;
  } catch {
    return dtStr || '';
  }
}

window.fileToDataURL = fileToDataURL;
window.extractImageSrc = extractImageSrc;
window.caseKey = caseKey;
window.isFromSheet = isFromSheet;
window.displayStatusName = displayStatusName;
window.toLabel = toLabel;
window.escapeHtml = escapeHtml;
window.formatDT = formatDT;
