// Auto Logout After 3 Minutes of No Activity
let idleTime = 0;
const MAX_IDLE = 3 * 60 * 1000; // 3 minutes

function resetIdle() {
  idleTime = 0;
}

// Reset timer on any user activity
["mousemove", "keydown", "click", "scroll", "touchstart"].forEach(evt => {
  window.addEventListener(evt, resetIdle);
});

// Check every second
setInterval(() => {
  idleTime += 1000;
  if (idleTime >= MAX_IDLE) {
    // Clear login from localStorage
    localStorage.removeItem('cc_user');

    // Redirect to login page
    window.location.href = "login.html";
  }
}, 1000);
