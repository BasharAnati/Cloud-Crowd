"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  createCascade,
  effectiveColor,
  element: cssElement
} = require("./css-cascade.js");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const pages = {
  attendance: read("attendance.html"),
  deductions: read("employee-deductions.html"),
  training: read("agent-training.html")
};
const permissionsSource = read("js/permissions.js");
const shellSource = read("js/app-shell.js");
const maintenanceSource = read("js/maintenance.js");

class MemoryStorage {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values));
  }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.textContent = "";
    this.innerHTML = "";
    this.className = "";
    this.classList = new FakeClassList();
    this.style = {};
    this.children = [];
    this.options = [];
    this.selectedIndex = 0;
    this.listeners = new Map();
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute(name, value) { this[name] = String(value); }
  appendChild(child) {
    this.children.push(child);
    if (child && Object.prototype.hasOwnProperty.call(child, "value")) {
      this.options.push({ value: child.value, text: child.textContent });
    }
    return child;
  }
  insertAdjacentHTML(_position, html) { this.innerHTML += html; }
  reset() {}
  reportValidity() { return true; }
  focus() {}
  scrollIntoView() {}
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.permissionElements = new Map();
    this.body = new FakeElement("body");
    this.documentElement = new FakeElement("html");
  }
  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new FakeElement(id));
    return this.elements.get(id);
  }
  createElement() { return new FakeElement(); }
  querySelector() { return null; }
  querySelectorAll(selector) { return this.permissionElements.get(selector) || []; }
  addEventListener() {}
}

function jsonResponse(data, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || (options.ok === false ? 500 : 200),
    async json() { return data; }
  };
}

function inlineScripts(source) {
  return [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .filter((script) => script.trim());
}

function businessScript(source) {
  return inlineScripts(source).sort((a, b) => b.length - a.length)[0];
}

function loadBusiness(source, marker, exposure, options = {}) {
  const script = businessScript(source).replace(
    /const access = await[^;]+;\s*if \(!access[^\n]+return;/,
    "const access = { canView: true, unavailable: false };"
  );
  const markerIndex = script.indexOf(marker);
  assert.ok(markerIndex > -1, `missing business initialization marker ${marker}`);
  const document = new FakeDocument();
  const sessionStorage = new MemoryStorage({
    cc_auth: "1",
    cc_token: "token",
    cc_role: options.role || "admin",
    cc_user: options.user || "Reviewer"
  });
  const localStorage = new MemoryStorage(options.localStorage);
  const fetchCalls = [];
  const context = {
    document,
    sessionStorage,
    localStorage,
    console: { warn() {}, error() {}, log() {} },
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
    CCPermissions: { requirePageAccess: async () => ({ canView: true }) },
    confirm: options.confirm || (() => true),
    fetch: async (url, requestOptions = {}) => {
      fetchCalls.push({ url, options: requestOptions });
      if (!context.fetchHandler) throw new Error("No fetch handler configured");
      return context.fetchHandler(url, requestOptions, fetchCalls.length - 1);
    }
  };
  context.window = context;
  context.globalThis = context;
  context.CloudCrowdConfirmation = { request: async (message) => context.confirm(message) };
  context.CloudCrowdFeedback = {
    inline(element, message) { element.textContent = message || ""; element.hidden = !message; return element; },
    banner(element, message) { element.textContent = message || ""; element.hidden = !message; return element; },
    clear(element) { element.textContent = ""; element.hidden = true; }
  };
  vm.runInNewContext(`${script.slice(0, markerIndex)}\n${exposure}\n})();`, context);
  return { context, document, sessionStorage, localStorage, fetchCalls, api: context.__api };
}

function loadPermissions(options = {}) {
  const document = new FakeDocument();
  const create = new FakeElement("create");
  const edit = new FakeElement("edit");
  const remove = new FakeElement("delete");
  document.permissionElements.set("[data-permission-create]", [create]);
  document.permissionElements.set("[data-permission-edit]", [edit]);
  document.permissionElements.set("[data-permission-delete]", [remove]);
  const fetchCalls = [];
  const sessionStorage = new MemoryStorage({
    cc_token: "permission-token",
    cc_role: options.role || "operator",
    cc_user: options.user || "Employee"
  });
  const context = {
    document,
    sessionStorage,
    console: { warn() {}, error() {}, log() {} },
    MutationObserver: class { observe() {} },
    fetch: async (url, requestOptions) => {
      fetchCalls.push({ url, options: requestOptions });
      return jsonResponse(options.response || {
        ok: true,
        legacyFallback: false,
        hasConfiguredAccess: true,
        access: [{
          moduleKey: "attendance",
          canView: options.canView !== false,
          canCreate: options.canCreate !== false,
          canEdit: options.canEdit !== false,
          canDelete: options.canDelete === true
        }]
      });
    }
  };
  context.window = context;
  context.window.location = { href: "attendance.html", pathname: "/attendance.html" };
  vm.runInNewContext(permissionsSource, context);
  vm.runInNewContext(shellSource, context);
  return { context, document, fetchCalls, controls: { create, edit, remove } };
}

test("one resolved permission model drives route access, actions, and shell filtering", async () => {
  const configured = loadPermissions({ canCreate: false, canEdit: true, canDelete: false });
  const modules = [{
    id: "attendance",
    route: "attendance.html",
    order: 1,
    title: "Attendance",
    group: "HR",
    permissionKey: "attendance",
    showInSidebar: true
  }];
  const [access, permitted] = await Promise.all([
    configured.context.CCPermissions.requirePageAccess("attendance"),
    configured.context.CloudCrowdAppShell.filterPermittedModules(modules, { fallbackMode: "legacy" })
  ]);
  assert.equal(configured.fetchCalls.length, 1);
  assert.equal(configured.fetchCalls[0].url, "/.netlify/functions/admin-users?my-access=1");
  assert.equal(configured.fetchCalls[0].options.headers.Authorization, "Bearer permission-token");
  assert.equal(access.canView, true);
  assert.equal(permitted.length, 1);
  assert.equal(configured.controls.create.hidden, true);
  assert.equal(configured.controls.edit.hidden, false);
  assert.equal(configured.controls.remove.hidden, true);

  const denied = loadPermissions({ canView: false });
  await Promise.all([
    denied.context.CCPermissions.requirePageAccess("attendance"),
    denied.context.CloudCrowdAppShell.filterPermittedModules(modules, { fallbackMode: "legacy" })
  ]);
  assert.equal(denied.fetchCalls.length, 1);
  assert.equal(denied.context.location.href, "dashboard.html?access=denied");

  const fallback = loadPermissions({
    response: { ok: true, legacyFallback: true, hasConfiguredAccess: false, access: [] }
  });
  const fallbackResults = await Promise.all([
    fallback.context.CCPermissions.requirePageAccess("attendance"),
    fallback.context.CloudCrowdAppShell.filterPermittedModules(modules, { fallbackMode: "legacy" })
  ]);
  assert.equal(fallback.fetchCalls.length, 1);
  assert.equal(fallbackResults[0].unavailable, true);
  assert.equal(fallbackResults[1].length, 0);

  const anati = loadPermissions({ user: "Anati", role: "admin" });
  const anatiResults = await Promise.all([
    anati.context.CCPermissions.requirePageAccess("attendance"),
    anati.context.CloudCrowdAppShell.filterPermittedModules(modules, { fallbackMode: "legacy" })
  ]);
  assert.equal(anati.fetchCalls.length, 1);
  assert.equal(anatiResults[0].canView, true);
  assert.equal(anatiResults[1].length, 1);
});

test("shared maintenance lifecycle preserves enforcement, polling, authorization, and toggle behavior", async () => {
  const intervals = [];
  const fetchCalls = [];
  const button = new FakeElement("maintenance-toggle-btn");
  const sessionStorage = new MemoryStorage({
    cc_auth: "1", cc_role: "operator", cc_user: "Employee", cc_token: "maintenance-token"
  });
  let confirmationMessage = "";
  const context = {
    sessionStorage,
    console: { warn() {}, error() {} },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      return jsonResponse({ maintenance: true, admin: false });
    },
    confirm: (message) => { confirmationMessage = message; return true; }
  };
  context.window = context;
  context.CloudCrowdConfirmation = { request: async (message) => context.confirm(message) };
  context.location = { href: "attendance.html" };
  context.setInterval = (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; };
  context.readSessionValue = (key) => sessionStorage.getItem(key) || "";
  vm.runInNewContext(maintenanceSource, context);
  const lifecycle = context.CloudCrowdMaintenance.createLifecycle({ button });
  lifecycle.startEnforcement();
  await lifecycle.enforceMaintenanceMode();
  assert.equal(context.CloudCrowdMaintenance.endpoint, "/.netlify/functions/maintenance");
  assert.equal(context.CloudCrowdMaintenance.pollInterval, 3000);
  assert.equal(intervals[0].delay, 3000);
  assert.equal(context.location.href, "system-update.html");
  assert.equal(fetchCalls[0].options.headers.Authorization, "Bearer maintenance-token");

  sessionStorage.setItem("cc_role", "admin");
  sessionStorage.setItem("cc_user", "Anati");
  let maintenanceState = false;
  context.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (options.method === "POST") {
      maintenanceState = JSON.parse(options.body).maintenance;
      return jsonResponse({ maintenance: maintenanceState });
    }
    return jsonResponse({ maintenance: maintenanceState, admin: true });
  };
  await lifecycle.updateMaintenanceToggleButton();
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, "OFF");
  lifecycle.startToggleUpdates();
  assert.equal(intervals[1].delay, 3000);
  await lifecycle.toggleMaintenanceMode();
  const post = fetchCalls.find((call) => call.options.method === "POST");
  assert.equal(post.url, "/.netlify/functions/maintenance");
  assert.equal(post.options.headers.Authorization, "Bearer maintenance-token");
  assert.deepEqual(JSON.parse(post.options.body), { maintenance: true });
  assert.equal(
    confirmationMessage,
    "Maintenance mode is currently OFF.\nIf you turn it ON, all employee accounts will be redirected to the system update page and will not be able to access the internal system.\nDo you want to continue?"
  );
  await lifecycle.updateMaintenanceToggleButton();
  assert.equal(button.textContent, "ON");

  for (const failure of [
    async () => { throw new Error("network unavailable"); },
    async () => jsonResponse({}, { ok: false, status: 500 }),
    async () => jsonResponse({ maintenance: "off", admin: false }),
  ]) {
    context.location.href = "attendance.html";
    context.fetch = failure;
    await lifecycle.enforceMaintenanceMode();
    assert.equal(context.location.href, "system-update.html", "unverified state and actor fail closed");
    assert.equal(button.hidden, true, "unverified Admin authority hides the toggle");
  }

  context.location.href = "attendance.html";
  context.fetch = async () => jsonResponse({ maintenance: false, admin: false });
  await lifecycle.enforceMaintenanceMode();
  assert.equal(context.location.href, "attendance.html", "authoritative OFF recovers normal navigation");
});

test("System Update remains stable through failure and returns only on authoritative recovery", async () => {
  const source = read("system-update.html");
  const script = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1]).sort((a, b) => b.length - a.length)[0];
  const checks = [];
  const replacements = [];
  const responses = [
    Promise.reject(new Error("network")),
    Promise.resolve(jsonResponse({}, { ok: false, status: 500 })),
    Promise.resolve(jsonResponse({ maintenance: true, admin: false })),
    Promise.resolve(jsonResponse({ maintenance: false, admin: false })),
  ];
  const context = {
    sessionStorage: { getItem() { return "token"; } },
    fetch() { return responses.shift(); },
    setInterval(callback, delay) { checks.push({ callback, delay }); return 1; },
    location: { replace(value) { replacements.push(value); } },
  };
  context.window = context;
  vm.runInNewContext(script, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks[0].delay, 3000);
  await checks[0].callback();
  await checks[0].callback();
  assert.deepEqual(replacements, [], "failure and authoritative ON remain on System Update");
  await checks[0].callback();
  assert.deepEqual(replacements, ["dashboard.html"], "authoritative OFF permits recovery");
});

test("Dashboard and HR runtimes consume the same maintenance implementation", () => {
  const dashboard = read("js/dashboard.js");
  const internal = read("js/internal-page-shell.js");
  [dashboard, internal].forEach((source) => {
    assert.match(source, /CloudCrowdMaintenance\.createLifecycle/);
    assert.match(source, /maintenance\.startEnforcement\(\)/);
    assert.match(source, /maintenance\.startToggleUpdates\(\)/);
    assert.doesNotMatch(source, /MAINTENANCE_ENDPOINT|fetchMaintenanceStatus|toggleMaintenanceMode/);
  });
});

test("page authentication guards execute valid and invalid session behavior", () => {
  Object.entries(pages).forEach(([name, source]) => {
    const guard = inlineScripts(source).find((script) => script.includes("readSessionValue('cc_auth')"));
    const run = (values) => {
      const sessionStorage = new MemoryStorage(values);
      const localStorage = new MemoryStorage(values);
      const context = {
        sessionStorage,
        localStorage,
        location: { href: `${name}.html` },
        readSessionValue: (key) => sessionStorage.getItem(key) || "",
        clearStoredSession() {
          ["cc_auth", "cc_user", "cc_role", "cc_token"].forEach((key) => {
            sessionStorage.removeItem(key);
            localStorage.removeItem(key);
          });
        }
      };
      context.window = context;
      vm.runInNewContext(guard, context);
      return { context, sessionStorage, localStorage };
    };
    const valid = run({ cc_auth: "1", cc_token: "token", cc_role: "operator", cc_user: "User" });
    assert.equal(valid.context.location.href, `${name}.html`);
    assert.equal(valid.sessionStorage.getItem("cc_token"), "token");
    const invalid = run({ cc_auth: "1", cc_token: "", cc_role: "operator", cc_user: "User" });
    assert.equal(invalid.context.location.href, "login.html");
    ["cc_auth", "cc_user", "cc_role", "cc_token"].forEach((key) => {
      assert.equal(invalid.sessionStorage.getItem(key), null);
      assert.equal(invalid.localStorage.getItem(key), null);
    });
  });
});

const attendanceExposure = `
globalThis.__api = {
  loadAttendanceRecords,
  loadActiveEmployees,
  importLocalAttendanceRecords,
  showEmployeeLoadWarning,
  showAttendanceSyncWarning,
  setSource(value) { attendanceSource = value; },
  state() { return { records: attendanceRecords.slice(), source: attendanceSource, employees: activeEmployees.slice() }; }
};`;

test("Attendance executes local-first, API replacement, failure fallback, and employee degradation", async () => {
  const localRecord = { id: "local-1", agent: "Local Agent", date: "2026-08-01" };
  const loaded = loadBusiness(pages.attendance, "hydrateAttendanceHeader();", attendanceExposure, {
    localStorage: { cc_attendance_records_v1: JSON.stringify([localRecord]) }
  });
  let resolveApi;
  loaded.context.fetchHandler = () => new Promise((resolve) => { resolveApi = resolve; });
  const pending = loaded.api.loadAttendanceRecords();
  assert.equal(loaded.api.state().source, "local");
  assert.equal(loaded.api.state().records[0].employeeNameSnapshot, "Local Agent");
  resolveApi(jsonResponse({ attendance: [{ attendanceId: "api-1", employeeNameSnapshot: "API Agent", date: "2026-08-02" }] }));
  await pending;
  assert.equal(loaded.api.state().source, "api");
  assert.equal(loaded.api.state().records[0].employeeNameSnapshot, "API Agent");

  const failed = loadBusiness(pages.attendance, "hydrateAttendanceHeader();", attendanceExposure, {
    localStorage: { cc_attendance_records_v1: JSON.stringify([localRecord]) }
  });
  failed.context.fetchHandler = async () => { throw new Error("offline"); };
  await failed.api.loadAttendanceRecords();
  assert.equal(failed.api.state().source, "local");
  assert.equal(failed.api.state().records.length, 1);
  assert.equal(failed.document.getElementById("attendance-sync-warning").classList.contains("is-error"), true);

  await failed.api.loadActiveEmployees();
  assert.equal(failed.document.getElementById("agent").disabled, true);
  assert.equal(failed.document.getElementById("save-record-btn").disabled, true);
  assert.equal(failed.document.getElementById("employee-load-warning").classList.contains("is-warning"), true);
});

test("Attendance bulk import preserves endpoint, payload, and success-only migration flag", async () => {
  const record = { id: "local-1", agent: "Local Agent", date: "2026-08-01" };
  const success = loadBusiness(pages.attendance, "hydrateAttendanceHeader();", attendanceExposure, {
    localStorage: { cc_attendance_records_v1: JSON.stringify([record]) }
  });
  success.api.setSource("api");
  success.context.fetchHandler = async (_url, _options, index) => index === 0
    ? jsonResponse({ inserted: 1, skippedDuplicates: 0, failed: 0 })
    : jsonResponse({ attendance: [] });
  await success.api.importLocalAttendanceRecords();
  assert.equal(success.fetchCalls[0].url, "/.netlify/functions/attendance?action=bulk-import");
  assert.equal(success.fetchCalls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(success.fetchCalls[0].options.body), { records: [record] });
  assert.equal(success.localStorage.getItem("cc_attendance_migration_v1_done"), "true");

  const failure = loadBusiness(pages.attendance, "hydrateAttendanceHeader();", attendanceExposure, {
    localStorage: { cc_attendance_records_v1: JSON.stringify([record]) }
  });
  failure.api.setSource("api");
  failure.context.fetchHandler = async () => jsonResponse({ error: "failed" }, { ok: false });
  await failure.api.importLocalAttendanceRecords();
  assert.equal(failure.localStorage.getItem("cc_attendance_migration_v1_done"), null);
});

const deductionsExposure = `
globalThis.__api = {
  calculateAmounts,
  saveDeduction,
  deleteDeduction,
  renderStats,
  canManage: canManageDeductions,
  setEmployees(value) { employees = value; employeesAvailable = true; },
  setDeductions(value) { deductions = value; }
};`;

function prepareDeductionForm(loaded) {
  loaded.api.setEmployees([{ employeeId: "e1", fullName: "Employee One" }]);
  const values = {
    "employee-id": "e1",
    "deduction-type": "Personal Order",
    "restaurant-name": "Brand",
    "order-number": "O-1",
    "order-date-time": "2026-08-08 10:00:00",
    "original-amount": "10.05",
    "approved-by": "Manager",
    notes: "Note"
  };
  Object.entries(values).forEach(([id, value]) => { loaded.document.getElementById(id).value = value; });
  loaded.document.getElementById("apply-discount").checked = true;
}

test("Employee Deductions executes calculation, request contracts, summaries, and role gates", async () => {
  const loaded = loadBusiness(pages.deductions, "document.querySelectorAll('.management-control')", deductionsExposure);
  prepareDeductionForm(loaded);
  const calculated = loaded.api.calculateAmounts();
  assert.deepEqual(JSON.parse(JSON.stringify(calculated)), { original: 10.05, discount: 1.01, finalAmount: 9.04 });
  assert.equal(loaded.document.getElementById("calculated-final").textContent, "9.04");
  loaded.context.fetchHandler = async (_url, _options, index) => index % 2 === 0
    ? jsonResponse({ ok: true })
    : jsonResponse({ deductions: [] });
  await loaded.api.saveDeduction({ preventDefault() {}, currentTarget: { reportValidity: () => true } });
  assert.equal(loaded.fetchCalls[0].url, "/.netlify/functions/deductions");
  assert.equal(loaded.fetchCalls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(loaded.fetchCalls[0].options.body), {
    employeeId: "e1",
    employeeNameSnapshot: "Employee One",
    deductionType: "Personal Order",
    restaurantName: "Brand",
    orderNumber: "O-1",
    orderDateTime: "2026-08-08 10:00:00",
    originalAmount: "10.05",
    applyEmployeeDiscount: true,
    approvedBy: "Manager",
    notes: "Note"
  });

  loaded.document.getElementById("deduction-id").value = "d-1";
  await loaded.api.saveDeduction({ preventDefault() {}, currentTarget: { reportValidity: () => true } });
  assert.equal(loaded.fetchCalls[2].url, "/.netlify/functions/deductions?id=d-1");
  assert.equal(loaded.fetchCalls[2].options.method, "PUT");
  assert.equal(JSON.parse(loaded.fetchCalls[2].options.body).originalAmount, "10.05");

  loaded.api.setDeductions([{ deductionId: "d-1", employeeNameSnapshot: "Employee One" }]);
  await loaded.api.deleteDeduction("d-1");
  assert.equal(loaded.fetchCalls[4].url, "/.netlify/functions/deductions?id=d-1");
  assert.equal(loaded.fetchCalls[4].options.method, "DELETE");

  const month = new Date().toISOString().slice(0, 7);
  loaded.api.setDeductions([
    { employeeId: "e1", deductionType: "Other", finalDeductionAmount: 4.5, orderDateTime: `${month}-01` },
    { employeeId: "e2", deductionType: "Other", finalDeductionAmount: 5.5, orderDateTime: `${month}-02` },
    { employeeId: "e1", deductionType: "Personal Order", finalDeductionAmount: 2, orderDateTime: "2020-01-01" }
  ]);
  loaded.api.renderStats();
  assert.equal(loaded.document.getElementById("stat-total").textContent, "12.00");
  assert.equal(loaded.document.getElementById("stat-month").textContent, "10.00");
  assert.equal(loaded.document.getElementById("stat-employees").textContent, 2);
  assert.equal(loaded.document.getElementById("stat-type").textContent, "Other");
  assert.equal(loaded.api.canManage, true);
  const operator = loadBusiness(pages.deductions, "document.querySelectorAll('.management-control')", deductionsExposure, { role: "operator" });
  assert.equal(operator.api.canManage, false);
  const manager = loadBusiness(pages.deductions, "document.querySelectorAll('.management-control')", deductionsExposure, { role: "manager" });
  assert.equal(manager.api.canManage, true);
});

const trainingExposure = `
globalThis.__api = {
  populateRestaurantSelect,
  saveTraining,
  deleteTraining,
  loadEmployees,
  loadRestaurants,
  loadTraining,
  canManage: canManageTraining,
  setEmployees(value) { employees = value; employeesAvailable = true; },
  setRestaurants(value, available = true) { restaurants = value; restaurantsAvailable = available; },
  setTraining(value) { trainingRecords = value; },
  state() { return { employees: employees.slice(), restaurants: restaurants.slice(), training: trainingRecords.slice() }; }
};`;

function prepareTrainingForm(loaded) {
  loaded.api.setEmployees([{ employeeId: "e1", fullName: "Employee One" }]);
  loaded.api.setRestaurants([{ restaurantId: "r1", brandName: "Brand One" }]);
  const values = {
    "employee-id": "e1",
    "restaurant-id": "r1",
    "assignment-status": "Assigned",
    "training-status": "Trained",
    "training-date": "2026-08-08",
    "updated-by-name": "Manager",
    notes: "Ready"
  };
  Object.entries(values).forEach(([id, value]) => { loaded.document.getElementById(id).value = value; });
}

test("Agent Training executes statuses, legacy compatibility, CRUD/archive, degradation, and role gates", async () => {
  const trainingSelect = pages.training.match(/<select class="control" id="training-status"[\s\S]*?<\/select>/)[0];
  const statusValues = [...trainingSelect.matchAll(/<option(?:\s[^>]*)?>([^<]+)<\/option>/g)]
    .map((match) => match[1].trim())
    .filter((value) => value !== "Select training status");
  assert.deepEqual(statusValues, ["Trained", "Not Trained", "Coaching Needed", "No training or assignment needed"]);
  const assignmentSelect = pages.training.match(/<select class="control" id="assignment-status"[\s\S]*?<\/select>/)[0];
  const assignmentValues = [...assignmentSelect.matchAll(/<option(?:\s[^>]*)?>([^<]+)<\/option>/g)]
    .map((match) => match[1].trim())
    .filter((value) => value !== "Select assignment status");
  assert.deepEqual(assignmentValues, ["Assigned", "Unassigned"]);

  const loaded = loadBusiness(pages.training, "document.querySelectorAll('.management-control')", trainingExposure);
  loaded.api.setRestaurants([], false);
  loaded.api.populateRestaurantSelect({ restaurantNameSnapshot: "Legacy Brand" });
  assert.match(loaded.document.getElementById("restaurant-id").innerHTML, /value="legacy:Legacy Brand"/);
  assert.equal(loaded.document.getElementById("restaurant-id").value, "legacy:Legacy Brand");

  prepareTrainingForm(loaded);
  loaded.context.fetchHandler = async (_url, _options, index) => index % 2 === 0
    ? jsonResponse({ ok: true })
    : jsonResponse({ training: [] });
  await loaded.api.saveTraining({ preventDefault() {}, currentTarget: { reportValidity: () => true } });
  assert.equal(loaded.fetchCalls[0].url, "/.netlify/functions/training");
  assert.equal(loaded.fetchCalls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(loaded.fetchCalls[0].options.body), {
    employeeId: "e1",
    employeeNameSnapshot: "Employee One",
    restaurantId: "r1",
    restaurantNameSnapshot: "Brand One",
    restaurantName: "Brand One",
    assignmentStatus: "Assigned",
    trainingStatus: "Trained",
    trainingDate: "2026-08-08",
    updatedByName: "Manager",
    notes: "Ready"
  });

  loaded.document.getElementById("training-id").value = "t-1";
  prepareTrainingForm(loaded);
  loaded.document.getElementById("training-id").value = "t-1";
  await loaded.api.saveTraining({ preventDefault() {}, currentTarget: { reportValidity: () => true } });
  assert.equal(loaded.fetchCalls[2].url, "/.netlify/functions/training?id=t-1");
  assert.equal(loaded.fetchCalls[2].options.method, "PUT");
  assert.equal(JSON.parse(loaded.fetchCalls[2].options.body).restaurantId, "r1");

  loaded.api.setTraining([{ trainingId: "t-1", employeeNameSnapshot: "Employee One" }]);
  await loaded.api.deleteTraining("t-1");
  assert.equal(loaded.fetchCalls[4].url, "/.netlify/functions/training?id=t-1");
  assert.equal(loaded.fetchCalls[4].options.method, "DELETE");
  assert.equal(loaded.document.getElementById("page-message").textContent, "Training assignment archived.");

  const degraded = loadBusiness(pages.training, "document.querySelectorAll('.management-control')", trainingExposure);
  degraded.context.fetchHandler = async (url) => {
    if (url === "/.netlify/functions/training") return jsonResponse({ training: [{ trainingId: "kept" }] });
    throw new Error("source unavailable");
  };
  await Promise.allSettled([
    degraded.api.loadEmployees(),
    degraded.api.loadRestaurants(),
    degraded.api.loadTraining()
  ]);
  assert.equal(degraded.api.state().employees.length, 0);
  assert.equal(degraded.api.state().restaurants.length, 0);
  assert.equal(degraded.api.state().training.length, 1);
  assert.equal(degraded.document.getElementById("new-training-btn").disabled, true);
  assert.equal(loaded.api.canManage, true);
  const operator = loadBusiness(pages.training, "document.querySelectorAll('.management-control')", trainingExposure, { role: "operator" });
  assert.equal(operator.api.canManage, false);
  const manager = loadBusiness(pages.training, "document.querySelectorAll('.management-control')", trainingExposure, { role: "manager" });
  assert.equal(manager.api.canManage, true);
});

function themedTargets(page, theme) {
  const cascade = createCascade(ROOT, page, { viewportWidth: 1440 });
  const html = cssElement("html", { attributes: { "data-theme": theme } });
  const pageClass = page === "attendance.html" ? "attendance-page" :
    page === "employee-deductions.html" ? "employee-deductions-page" : "agent-training-page";
  const body = cssElement("body", { classes: ["people-management-page", pageClass] }, html);
  const shell = cssElement("div", { classes: ["cc-shell-layout", "has-responsive-navigation"] }, body);
  const sidebar = cssElement("aside", { id: "internal-app-sidebar", classes: ["cc-shell-sidebar"] }, shell);
  const main = cssElement("main", { classes: ["cc-shell-main"] }, shell);
  const topbar = cssElement("header", { id: "internal-app-topbar", classes: ["cc-shell-topbar"] }, main);
  const container = cssElement("div", { classes: ["people-management-container"] }, main);
  const card = cssElement("section", { classes: ["content-card"] }, container);
  const field = cssElement("div", { classes: ["field"] }, card);
  const input = cssElement("input", {}, field);
  const tableWrap = cssElement("div", { classes: ["table-wrap"] }, card);
  const table = cssElement("table", { classes: ["records-table"] }, tableWrap);
  const thead = cssElement("thead", {}, table);
  const row = cssElement("tr", {}, thead);
  const tableHeader = cssElement("th", {}, row);
  const warning = cssElement("div", { classes: ["employee-warning", "show", "is-error"] }, container);
  const warningInfo = cssElement("div", { classes: ["employee-warning", "show", "is-warning"] }, container);
  const recordCount = cssElement("span", { id: "record-count", classes: ["role-pill"] }, card);
  return { cascade, sidebar, topbar, card, input, tableHeader, warning, warningInfo, recordCount };
}

test("actual Light and Dark cascade winners cover HR warnings, content, counters, and shell surfaces", () => {
  ["attendance.html", "employee-deductions.html", "agent-training.html"].forEach((page) => {
    const resolved = {};
    ["light", "dark"].forEach((theme) => {
      const targets = themedTargets(page, theme);
      resolved[theme] = {
        sidebar: effectiveColor(targets.cascade, targets.sidebar, "background-color").color,
        topbar: effectiveColor(targets.cascade, targets.topbar, "background-color").color,
        card: effectiveColor(targets.cascade, targets.card, "background-color").color,
        input: effectiveColor(targets.cascade, targets.input, "background-color").color,
        table: effectiveColor(targets.cascade, targets.tableHeader, "background-color").color
      };
      if (page === "attendance.html") {
        assert.equal(targets.cascade.winner(targets.warning, "background-color").value, "var(--color-danger-soft)");
        assert.equal(targets.cascade.winner(targets.warning, "color").value, "var(--color-danger-text)");
        assert.equal(targets.cascade.winner(targets.warningInfo, "background-color").value, "var(--color-warning-soft)");
        assert.equal(targets.cascade.winner(targets.warningInfo, "color").value, "var(--color-warning-text)");
      } else {
        assert.equal(targets.cascade.winner(targets.recordCount, "display").value, "inline-flex");
        assert.equal(targets.cascade.winner(targets.recordCount, "background-color").value, "var(--color-surface-muted)");
        assert.equal(targets.cascade.winner(targets.recordCount, "color").value, "var(--color-text)");
      }
    });
    assert.notEqual(resolved.light.topbar, resolved.dark.topbar, `${page} topbar changes with theme`);
    assert.notEqual(resolved.light.card, resolved.dark.card, `${page} card changes with theme`);
    assert.notEqual(resolved.light.input, resolved.dark.input, `${page} input changes with theme`);
    assert.notEqual(resolved.light.table, resolved.dark.table, `${page} table changes with theme`);
    assert.ok(resolved.light.sidebar && resolved.dark.sidebar, `${page} sidebar resolves in both themes`);
  });
});
