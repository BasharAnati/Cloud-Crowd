// Auto Logout After 3 Minutes of No Activity
let idleTime = 0;
const MAX_IDLE = 3 * 60 * 1000; // 3 minutes

function resetIdle() {
  idleTime = 0;
}

function clearAuthSession() {
  ['cc_auth', 'cc_user', 'cc_role', 'cc_token'].forEach((key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
}

// Reset timer on any user activity
["mousemove", "keydown", "click", "scroll", "touchstart"].forEach(evt => {
  window.addEventListener(evt, resetIdle);
});

// Check every second
setInterval(() => {
  idleTime += 1000;
  if (idleTime >= MAX_IDLE) {
    // Clear login from browser storage.
    clearAuthSession();

    // Redirect to login page
    window.location.href = "login.html";
  }
}, 1000);
