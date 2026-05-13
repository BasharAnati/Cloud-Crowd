// Auth/session helpers shared by main.js.

// اسم المستخدم الحالي (من صفحة اللوجين)
const CURRENT_USER = localStorage.getItem('cc_user') || 'operator';

function getAuthHeaders(extraHeaders = {}) {
  const token = localStorage.getItem('cc_token') || '';
  return {
    ...extraHeaders,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

function handleAuthFailure(response) {
  if (response.status !== 401) return false;

  localStorage.removeItem('cc_auth');
  localStorage.removeItem('cc_user');
  localStorage.removeItem('cc_role');
  localStorage.removeItem('cc_token');
  window.location.href = "login.html?expired=1";
  return true;
}

function canUserCreate(section) {
  if (CREATOR_ALLOW.all.includes(CURRENT_USER)) return true;
  if (section === 'time-table' && CREATOR_ALLOW['time-table'].includes(CURRENT_USER)) return true;
  return false;
}

function logout() {
  const confirmLogout = confirm("Confirm logout?");
  if (confirmLogout) {
    localStorage.removeItem('cc_auth');
    localStorage.removeItem('cc_user');
    localStorage.removeItem('cc_role');
    localStorage.removeItem('cc_token');
    window.location.href = "login.html";
  }
}

window.CURRENT_USER = CURRENT_USER;
window.getAuthHeaders = getAuthHeaders;
window.handleAuthFailure = handleAuthFailure;
window.logout = logout;
window.canUserCreate = canUserCreate;
