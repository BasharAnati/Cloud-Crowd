"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const STATIC_DIALOGS = {
  "cctv.html": ["modal"],
  "ce.html": ["modal"],
  "complaints.html": ["modal"],
  "free-orders.html": ["modal"],
  "employee-deductions.html": ["deduction-modal", "details-modal"],
  "agent-training.html": ["details-modal"],
  "restaurant-ratings.html": ["rating-modal", "details-modal"],
  "weekly-quality.html": ["details-modal"],
  "employee-profiles.html": ["employee-modal"],
  "client-profiles.html": ["profile-modal", "client-modal"],
  "free-order-requests.html": ["request-modal", "details-modal", "view-modal"],
  "free-order-share.html": ["response-modal", "view-modal"]
};

test("all eighteen static dialog roots retain their approved IDs and titles", () => {
  let count = 0;
  for (const [page, ids] of Object.entries(STATIC_DIALOGS)) {
    const source = read(page);
    for (const id of ids) {
      assert.match(source, new RegExp(`id=["']${id}["']`), `${page}#${id}`);
      count += 1;
    }
  }
  assert.equal(count, 18);
  for (const page of ["cctv.html", "ce.html", "complaints.html", "free-orders.html"]) {
    assert.match(read(page), /<h2[^>]*class="[^"]*cc-modal-title[^"]*"[^>]*>Add New Ticket<\/h2>/);
  }
});

test("the four Operations drawers retain identity, actions, history, and 480px geometry", () => {
  for (const page of ["cctv.html", "ce.html", "complaints.html", "free-orders.html"]) {
    const source = read(page);
    assert.match(source, /id="ticket-drawer"/);
    assert.match(source, /id="drawer-title"/);
    assert.match(source, /drawer-backdrop/);
  }
  const main = read("main.js");
  assert.match(main, /let drawerIndex = null/);
  assert.match(main, /id = 'drawer-edit-btn'/);
  assert.match(main, /id = 'drawer-delete-btn'/);
  assert.match(main, /historyButton\.id = 'drawer-history-link'/);
  assert.match(main, /id="drawer-save-btn"/);
  assert.match(main, /id="drawer-cancel-btn"/);
  assert.match(main, /backdrop:\s*'\.drawer-backdrop'[\s\S]*dismissOnBackdrop:\s*true/);
  assert.match(read("styles.css"), /width:min\(480px,100%\)/);
});

test("approved compatibility widths remain explicit", () => {
  const contracts = [
    ["assets/css/components/feedback.css", /width:\s*min\(480px,\s*100%\)/],
    ["styles.css", /max-width:\s*600px/],
    ["app-shell.css", /width:\s*min\(680px,\s*92vw\)/],
    ["free-order-requests.html", /width:\s*min\(760px,\s*100%\)/],
    ["employee-deductions.html", /details-panel\{width:min\(760px,100%\)/],
    ["agent-training.html", /width:min\(760px,100%\)/],
    ["restaurant-ratings.html", /width:min\(820px,100%\)/],
    ["weekly-quality.html", /width:\s*min\(820px,\s*100%\)/],
    ["employee-profiles.html", /width:min\(920px,100%\)/],
    ["employee-deductions.html", /width:min\(940px,100%\)/],
    ["client-profiles.html", /width:min\(940px,100%\)/],
    ["client-profiles.html", /width:min\(1120px,100%\)/]
  ];
  for (const [file, pattern] of contracts) assert.match(read(file), pattern, file);
});

test("backdrop dismissibility remains family-specific", () => {
  for (const page of ["employee-deductions.html", "agent-training.html", "restaurant-ratings.html", "employee-profiles.html", "client-profiles.html"]) {
    assert.match(read(page), /if \(event\.target === modal\) closeModal\(modal\.id\)/, page);
  }
  assert.match(read("weekly-quality.html"), /if \(event\.target\.id === 'details-modal'\) closeDetails\(\)/);
  assert.doesNotMatch(read("free-order-requests.html"), /event\.target === modal/);
  assert.doesNotMatch(read("free-order-share.html"), /event\.target === modal/);
  assert.doesNotMatch(read("main.js"), /event\.target === modal[^\n]+closeModal/);
});

test("business-owned reset and close-after-success behavior remains distinct", () => {
  const operations = read("main.js");
  assert.match(operations, /function resetOperationalModal\(\)[\s\S]*form\.reset\(\)/);
  assert.match(operations, /onAfterClose:\s*resetOperationalModal/);
  assert.match(operations, /cleanup:\s*async \(\{ succeeded \}\) => \{\s*if \(succeeded\) closeModal\(\)/);
  for (const page of ["employee-deductions.html", "restaurant-ratings.html", "employee-profiles.html", "client-profiles.html"]) {
    const source = read(page);
    assert.match(source, /reset[A-Za-z]+Form\(\)[\s\S]*openModal\(/, page);
    assert.match(source, /closeModal\([^)]*modal[^)]*\)[\s\S]*(created|updated|saved)/i, page);
  }
  assert.match(read("free-order-requests.html"), /closeModal\('request-modal'\)[\s\S]*Request created/);
  assert.match(read("free-order-share.html"), /closeModal\('response-modal'\)[\s\S]*marked as Needs Response/);
});

test("history, confirmation, and media public business contracts remain stable", () => {
  const history = read("js/history.js");
  assert.match(history, /function ensureHistoryModal/);
  assert.match(history, /history=1&id=\$\{encodeURIComponent\(ticketId\)\}/);
  assert.match(history, /history-state--loading/);
  assert.match(history, /history-state--empty/);
  assert.match(history, /history-state--error/);
  assert.match(read("assets/js/components/confirmation.js"), /CloudCrowdConfirmation = Object\.freeze\(\{ request \}\)/);
  const media = read("js/media-viewer.js");
  assert.match(media, /CloudCrowdMediaViewer = \{/);
  assert.match(media, /type === 'video' \? 'video' : 'img'/);
  assert.match(media, /window\.open\(src, '_blank', 'noopener,noreferrer'\)/);
});

test("workflow identity, payload, non-dismissible backdrop, and success/error ownership stay page-owned", () => {
  const requests = read("free-order-requests.html");
  const share = read("free-order-share.html");
  assert.match(requests, /details-request-id/);
  assert.match(requests, /request\.requestId/);
  assert.match(share, /response-request-id/);
  assert.match(share, /item\.requestId/);
  assert.doesNotMatch(requests, /if \(event\.target === modal\)/);
  assert.doesNotMatch(share, /if \(event\.target === modal\)/);
  assert.match(requests, /catch \(error\)[\s\S]*Request could not be saved/);
  assert.match(share, /catch \(error\)[\s\S]*Response note could not be saved/);
});
