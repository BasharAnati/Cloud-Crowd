// Auth/session helpers shared by main.js.

// اسم المستخدم الحالي (من صفحة اللوجين)
function readSessionValue(key) {
  const sessionValue = sessionStorage.getItem(key);
  if (sessionValue) return sessionValue;

  const localValue = localStorage.getItem(key) || '';
  return localValue;
}

function clearStoredSession() {
  ['cc_auth', 'cc_user', 'cc_role', 'cc_token'].forEach((key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
}

const CURRENT_USER = readSessionValue('cc_user') || 'operator';

function getAuthHeaders(extraHeaders = {}) {
  const token = readSessionValue('cc_token') || '';
  return {
    ...extraHeaders,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

function handleAuthFailure(response) {
  if (response.status !== 401) return false;

  clearStoredSession();
  window.location.href = "login.html?expired=1";
  return true;
}

function canUserCreate(section) {
  return CREATOR_ALLOW.all.includes(CURRENT_USER);
}

function logout() {
  const confirmLogout = confirm("Confirm logout?");
  if (confirmLogout) {
    clearStoredSession();
    window.location.href = "login.html";
  }
}

window.CURRENT_USER = CURRENT_USER;
window.getAuthHeaders = getAuthHeaders;
window.handleAuthFailure = handleAuthFailure;
window.logout = logout;
window.canUserCreate = canUserCreate;
window.readSessionValue = window.readSessionValue || readSessionValue;
window.clearStoredSession = window.clearStoredSession || clearStoredSession;
