"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const INTERNAL_PAGES = [
  "dashboard.html", "cctv.html", "ce.html", "complaints.html", "free-orders.html",
  "attendance.html", "employee-deductions.html", "agent-training.html",
  "restaurant-ratings.html", "weekly-quality.html", "employee-profiles.html",
  "client-profiles.html", "free-order-requests.html", "free-order-share.html",
  "anati-admin.html", "call-queue.html"
];

function functionSource(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} exists`);
  const open = source.indexOf("{", start);
  let depth = 1;
  let quote = "";
  for (let index = open + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

class Storage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class Control {
  constructor(text = "Save") {
    this.textContent = text;
    this.disabled = false;
    this.dataset = {};
    this.attributes = new Map();
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) || null; }
}

test("all 16 internal pages retain the characterized shell, routes, and action hooks", () => {
  assert.equal(INTERNAL_PAGES.length, 16);
  for (const page of INTERNAL_PAGES) {
    const source = read(page);
    assert.match(source, /<main\b[^>]*id="main-content"/i, `${page} main route target`);
    assert.match(source, /<h1\b/i, `${page} page heading`);
    assert.match(source, /(?:app-shell\.js|js\/dashboard\.js)/, `${page} shared shell runtime`);
  }

  const contracts = new Map([
    ["attendance.html", [/id="add-record-btn"[^>]*data-permission-create/, /id="save-record-btn"[^>]*disabled/]],
    ["employee-deductions.html", [/data-edit-id=/, /data-delete-id=/, /data-permission-delete/]],
    ["agent-training.html", [/data-edit-id=/, /data-delete-id=/, /data-permission-delete/]],
    ["restaurant-ratings.html", [/data-view-id=/, /data-archive-id=/, /data-permission-delete/]],
    ["weekly-quality.html", [/data-details-id=/, /data-delete-id=/, /data-permission-delete/]],
    ["employee-profiles.html", [/data-view-id=/, /data-archive-id=/, /data-back-to-directory/]],
    ["client-profiles.html", [/data-view-id=/, /data-edit-id=/, /data-archive-id=/]],
    ["free-order-requests.html", [/data-complete-id=/, /data-delete-id=/, /data-view-id=/]],
    ["free-order-share.html", [/href="free-order-requests\.html"/, /data-response-id=/, /data-done-id=/]],
    ["anati-admin.html", [/data-edit-user=/, /data-disable-user=/]],
    ["call-queue.html", [/id="start-call-btn"/, /id="positive-btn"/, /id="negative-btn"/, /id="save-negative-btn"/]]
  ]);
  for (const [page, patterns] of contracts) {
    const source = read(page);
    patterns.forEach((pattern) => assert.match(source, pattern, `${page}: ${pattern}`));
  }
});

test("form submission and navigation semantics are frozen before presentation migration", () => {
  const pages = INTERNAL_PAGES.map((page) => [page, read(page)]);
  for (const [page, source] of pages) {
    for (const match of source.matchAll(/<button\b[^>]*>/gi)) {
      if (/\btype="submit"/i.test(match[0])) assert.doesNotMatch(match[0], /\btype="button"/i, page);
    }
  }
  assert.match(read("free-order-share.html"), /<a\s+class="primary-btn cc-button cc-button--outline cc-button--md"\s+href="free-order-requests\.html">Requests<\/a>/);
  assert.match(read("js/app-shell.js"), /const link = document\.createElement\('a'\);[\s\S]*link\.href = module\.route/);
});

test("shared logout cancellation preserves every session value and route", async () => {
  const localStorage = new Storage({ cc_auth: "1", cc_user: "worker", cc_role: "agent", cc_token: "token" });
  const sessionStorage = new Storage({ cc_auth: "1", cc_user: "worker", cc_role: "agent", cc_token: "token" });
  const confirmations = [];
  const context = {
    localStorage,
    sessionStorage,
    CREATOR_ALLOW: { all: [] },
    location: { href: "dashboard.html" },
    confirm(message) { confirmations.push(message); return false; }
  };
  context.window = context;
  context.CloudCrowdConfirmation = { request: async (message) => context.confirm(message) };
  vm.runInNewContext(read("js/auth.js"), context);
  await context.logout();
  assert.deepEqual(confirmations, ["Confirm logout?"]);
  for (const key of ["cc_auth", "cc_user", "cc_role", "cc_token"]) {
    assert.notEqual(localStorage.getItem(key), null);
    assert.notEqual(sessionStorage.getItem(key), null);
  }
  assert.equal(context.location.href, "dashboard.html");
});

test("maintenance cancellation preserves exact wording and performs no POST", async () => {
  const calls = [];
  const confirmations = [];
  const sessionStorage = new Storage({ cc_auth: "1", cc_role: "admin", cc_user: "Anati", cc_token: "token" });
  const context = {
    console: { warn() {}, error() {} },
    sessionStorage,
    location: { href: "dashboard.html" },
    setInterval() { return 1; },
    readSessionValue(key) { return sessionStorage.getItem(key) || ""; },
    confirm(message) { confirmations.push(message); return false; },
    async fetch(url, options = {}) {
      calls.push({ url, options });
      return { ok: true, async json() { return { maintenance: false, admin: true }; } };
    }
  };
  context.window = context;
  context.CloudCrowdConfirmation = { request: async (message) => context.confirm(message) };
  vm.runInNewContext(read("js/maintenance.js"), context);
  const lifecycle = context.CloudCrowdMaintenance.createLifecycle({ button: new Control("OFF") });
  await lifecycle.updateMaintenanceToggleButton();
  calls.length = 0;
  await lifecycle.toggleMaintenanceMode();
  assert.deepEqual(confirmations, [
    "Maintenance mode is currently OFF.\nIf you turn it ON, all employee accounts will be redirected to the system update page and will not be able to access the internal system.\nDo you want to continue?"
  ]);
  assert.equal(calls.length, 0);
});

test("record confirmations remain before protected mutations with exact wording", () => {
  const contracts = [
    ["employee-profiles.html", "archiveEmployee", "Archive ${employee?.fullName || 'this employee'}? Historical records will remain available."],
    ["agent-training.html", "deleteTraining", "Archive the training assignment for ${record.employeeNameSnapshot}?"],
    ["employee-deductions.html", "deleteDeduction", "Delete the deduction for ${deduction.employeeNameSnapshot}?"],
    ["restaurant-ratings.html", "archiveRating", "Archive the ${record.platform} rating for ${record.restaurantNameSnapshot}?"],
    ["client-profiles.html", "archiveRestaurant", "Archive ${restaurant?.brandName || 'this client'}?"],
    ["free-order-requests.html", "archiveRequest", "Archive request ${request.orderNumber}?"],
    ["free-order-share.html", "markDone", "Mark request ${item.orderNumber} as done?"],
    ["anati-admin.html", "disableUser", "Disable ${user.username}?"],
    ["weekly-quality.html", "deleteRecord", "Delete this quality evaluation?"]
  ];
  for (const [file, name, wording] of contracts) {
    const source = functionSource(read(file), name);
    const gate = source.indexOf(wording);
    const mutation = Math.min(...["fetch(", "apiRequest(", "deleteQualityRecord(", "saveQualityRecords("]
      .map((marker) => source.indexOf(marker)).filter((index) => index >= 0));
    assert.ok(gate >= 0, `${file} ${name} wording`);
    assert.ok(gate < mutation, `${file} ${name} cancellation gate precedes mutation`);
  }
});

test("operational busy behavior disables, announces, labels, and restores controls", () => {
  const source = read("main.js");
  const context = {};
  context.window = context;
  vm.runInNewContext(`${functionSource(source, "setMutationLoading")}; this.setMutationLoading = setMutationLoading;`, context);
  const control = new Control("Save");
  context.setMutationLoading(control, true, "Saving...");
  assert.equal(control.disabled, true);
  assert.equal(control.getAttribute("aria-busy"), "true");
  assert.equal(control.textContent, "Saving...");
  context.setMutationLoading(control, false);
  assert.equal(control.disabled, false);
  assert.equal(control.getAttribute("aria-busy"), null);
  assert.equal(control.textContent, "Save");
});

test("dynamic operational actions retain IDs, permissions, and handler bindings", () => {
  const source = read("main.js");
  for (const contract of [
    /editBtn\.id = 'drawer-edit-btn'/,
    /editBtn\.setAttribute\('data-permission-edit', ''\)/,
    /delBtn\.id = 'drawer-delete-btn'/,
    /delBtn\.setAttribute\('data-permission-delete', ''\)/,
    /id="drawer-save-btn" class="submit-btn" data-permission-edit/,
    /id="drawer-cancel-btn" class="cancel-btn" type="button"/,
    /loadingLabel: 'Saving\.\.\.'/,
    /loadingLabel: 'Deleting\.\.\.'/,
    /loadingLabel: 'Submitting\.\.\.'/
  ]) assert.match(source, contract);
});
