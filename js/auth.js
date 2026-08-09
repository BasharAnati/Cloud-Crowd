// Auth/session helpers shared by main.js.

// اسم المستخدم الحالي (من صفحة اللوجين)
function readSessionValue(key) {
  return sessionStorage.getItem(key) || '';
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

async function logout() {
  const confirmLogout = await window.CloudCrowdConfirmation.request("Confirm logout?", {
    title: "Log out",
    confirmLabel: "Log out"
  });
  if (!confirmLogout) return;
  clearStoredSession();
  window.location.href = "login.html";
}

window.CURRENT_USER = CURRENT_USER;
window.getAuthHeaders = getAuthHeaders;
window.handleAuthFailure = handleAuthFailure;
window.logout = logout;
window.canUserCreate = canUserCreate;
window.readSessionValue = window.readSessionValue || readSessionValue;
window.clearStoredSession = window.clearStoredSession || clearStoredSession;
