"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const themeApi = require("../assets/js/theme.js");
const { createCascade, effectiveColor, element: cssElement } = require("./css-cascade.js");

const ROOT = path.resolve(__dirname, "..");
const EMPLOYEE_FILE = "employee-profiles.html";
const CLIENT_FILE = "client-profiles.html";
const employeeSource = fs.readFileSync(path.join(ROOT, EMPLOYEE_FILE), "utf8");
const clientSource = fs.readFileSync(path.join(ROOT, CLIENT_FILE), "utf8");
const dialogSource = fs.readFileSync(path.join(ROOT, "assets/js/components/dialog.js"), "utf8");
const masterDetailSource = fs.readFileSync(path.join(ROOT, "assets/js/components/master-detail.js"), "utf8");
const masterDetailCss = fs.readFileSync(path.join(ROOT, "assets/css/components/master-detail.css"), "utf8");
const appShellSource = fs.readFileSync(path.join(ROOT, "js/app-shell.js"), "utf8");
const permissionsSource = fs.readFileSync(path.join(ROOT, "js/permissions.js"), "utf8");
const maintenanceSource = fs.readFileSync(path.join(ROOT, "js/maintenance.js"), "utf8");
const appShellCss = fs.readFileSync(path.join(ROOT, "app-shell.css"), "utf8");
const RESPONSIVE_WIDTHS = [1440, 1280, 1024, 768, 390, 360, 320];
const QUALITY_FIELDS = [
  "greetings", "knowledge", "upselling", "closure", "repeatingOrders",
  "phoneEtiquette", "clarity", "environment", "equipment", "aat"
];
const QUALITY_LABELS = Object.fromEntries(QUALITY_FIELDS.map((field) => [field, field]));

function functionSource(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `Expected function ${name}`);
  const start = match.index;
  const openParenthesis = source.indexOf("(", start);
  let parenthesisDepth = 0;
  let bodyStart = -1;
  for (let index = openParenthesis; index < source.length; index += 1) {
    if (source[index] === "(") parenthesisDepth += 1;
    if (source[index] === ")" && --parenthesisDepth === 0) {
      bodyStart = source.indexOf("{", index);
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `Expected body for ${name}`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) { escaped = false; continue; }
    if (quote) {
      if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"' || character === "`") { quote = character; continue; }
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unterminated function ${name}`);
}

function evaluateFunctions(source, names, context = {}, overrides = {}) {
  const sandbox = vm.createContext({ URL, URLSearchParams, console, ...context });
  const declarations = names.map((name) => overrides[name] || functionSource(source, name)).join("\n");
  vm.runInContext(`${declarations}\nthis.characterized = { ${names.join(", ")} };`, sandbox);
  return { ...sandbox.characterized, sandbox };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function documentFixture(values = {}) {
  const elements = new Map();
  Object.entries(values).forEach(([id, value]) => {
    elements.set(id, typeof value === "object" ? value : { value });
  });
  return {
    elements,
    body: { classList: { add() {}, remove() {} } },
    createElement(tagName) {
      return { tagName: tagName.toUpperCase(), className: "", innerHTML: "", children: [], appendChild(child) { this.children.push(child); return child; } };
    },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { innerHTML: "", textContent: "", value: "", classList: { add() {}, remove() {} } });
      return elements.get(id);
    },
    querySelectorAll() { return []; }
  };
}

function employeeFixture(id, name = `Employee ${id}`, status = "active") {
  return {
    employeeId: id,
    fullName: name,
    status,
    notes: "",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-02",
    phoneNumbers: [{ label: "Primary", phoneNumber: `555-${id}`, isPrimary: true }],
    emergencyContacts: [],
    assignedRestaurants: []
  };
}

function restaurantFixture(id, name = `Restaurant ${id}`) {
  return {
    restaurantId: id,
    brandName: name,
    status: "active",
    logoUrl: "",
    callCenterNumber: "",
    originalRestaurantNumber: "",
    forwardedNumber: "",
    brandOwnerName: "",
    brandOwnerPhone: "",
    accountManagerName: "",
    restaurantManagerName: "",
    notes: ""
  };
}

function employeeSelectionHarness(options = {}) {
  const document = options.document || documentFixture({ "employee-workspace": { innerHTML: "initial" } });
  const events = [];
  const employees = options.employees || [employeeFixture("A"), employeeFixture("B")];
  const emptyQuality = (_employee, records) => ({
    records: [...records], average: records.length ? 80 : 0, best: records.length ? 80 : 0,
    worst: records.length ? 80 : 0, lastDate: records[0]?.callDateTime || "", topCampaign: null
  });
  const emptyAttendance = (_employee, records) => ({
    records: [...records], onTime: 0, leftEarly: 0, lateLogout: 0, extraTime: 0,
    totalExtraMinutes: 0, unparsedDurations: 0, lastDate: records[0]?.date || ""
  });
  const defaultWindow = {
    CCPermissions: { applyPermissionVisibility() { events.push("permissions"); } },
    CC_PAGE_ACCESS: {}
  };
  const context = {
    document,
    window: options.window || defaultWindow,
    employeeMasterDetail: options.masterDetail || {
      announce() {}, focusDetail() {}, isMobile: () => false, setSelectionHidden() {}, showDetail() {},
      renderState(settings) {
        document.getElementById("employee-workspace").innerHTML = `<div data-state="${settings.state}"><h2>${settings.title}</h2><p>${settings.message}</p>${settings.action || ""}</div>`;
      }
    },
    employees,
    selectedEmployeeId: "",
    workspaceRequestToken: 0,
    canManageEmployees: Boolean(options.canManage),
    renderEmployees() { events.push(["directory", context.selectedEmployeeId]); },
    renderWorkspaceLoading(id) { document.getElementById("employee-workspace").innerHTML = `loading:${id}`; events.push(["loading", id]); },
    renderWorkspaceError(message) { document.getElementById("employee-workspace").innerHTML = `error:${message}`; events.push(["error", message]); },
    updateWorkspaceUrl(id) { events.push(["url", id]); },
    focusWorkspaceOnSmallScreen() { events.push("focus-workspace"); },
    getEmployeeProfile: options.getEmployeeProfile || (async (id) => employees.find((employee) => employee.employeeId === id)),
    getEmployeeDependencyAccess: options.getEmployeeDependencyAccess || (async () => ({ attendance: "allowed", training: "allowed", deductions: "allowed", quality: "allowed" })),
    isPermissionDenied: options.isPermissionDenied || ((error) => Number(error?.status) === 403 || /403|forbidden|permission denied/i.test(String(error?.message || error || ""))),
    getEmployeeQualityRecords: options.getEmployeeQualityRecords || (async () => []),
    getEmployeeAttendance: options.getEmployeeAttendance || (async () => []),
    getEmployeeDeductions: options.getEmployeeDeductions || (async () => []),
    getEmployeeTraining: options.getEmployeeTraining || (async () => []),
    getStoredQualityRecords: options.getStoredQualityRecords || (() => []),
    getStoredAttendanceRecords: options.getStoredAttendanceRecords || (() => []),
    getQualitySummary: options.getQualitySummary || emptyQuality,
    getAttendanceSummary: options.getAttendanceSummary || emptyAttendance,
    getQualityScore: (record) => Number(record.totalScore || 0),
    qualityDetails: options.qualityDetails || (() => "details"),
    attendanceNote: options.attendanceNote || (() => "-"),
    formatScore: (value) => `${value}%`,
    formatDuration: (value) => `duration:${value}`,
    currentProfileMonth: () => "2026-08",
    formatDeductionAmount: (value) => Number(value || 0).toFixed(2),
    getEmployeeInitials: (name) => name.slice(0, 2).toUpperCase(),
    formatProfileDate: String,
    employeeStatusBadge: (status) => `<span>${status}</span>`,
    valueOrDash: (value) => String(value || "-"),
    escapeHtml: options.escapeHtml || ((value) => String(value ?? ""))
  };
  const source = options.selectionSource || functionSource(employeeSource, "selectEmployee");
  const api = evaluateFunctions(employeeSource, ["selectEmployee"], context, { selectEmployee: source });
  return { ...api, context, document, events };
}

function clientViewHarness(options = {}) {
  const document = options.document || documentFixture({
    "client-workspace": { innerHTML: "" }
  });
  const events = [];
  const messages = [];
  const restaurants = options.restaurants || [restaurantFixture("r1")];
  const masterDetail = options.masterDetail || {
    showDetail: (...args) => events.push(["show-detail", ...args]),
    announce: (message) => events.push(["announce", message]),
    isMobile: () => false
  };
  const context = {
    document,
    window: options.window || { CCPermissions: { applyPermissionVisibility() {} }, CC_PAGE_ACCESS: {} },
    restaurants,
    selectedRestaurantId: "",
    workspaceRequestToken: 0,
    clientMasterDetail: masterDetail,
    renderRestaurants: () => events.push(["directory"]),
    renderWorkspaceLoading: (id) => { document.getElementById("client-workspace").innerHTML = `loading:${id}`; events.push(["loading", id]); },
    renderEmptyWorkspace: () => { document.getElementById("client-workspace").innerHTML = "empty-selection"; events.push(["empty-selection"]); },
    renderUnavailableWorkspace: (message, id) => { document.getElementById("client-workspace").innerHTML = `unavailable:${id}:${message}`; events.push(["unavailable", id]); },
    renderWorkspaceError: (message) => { document.getElementById("client-workspace").innerHTML = `error:${message}`; events.push(["error", message]); },
    getRestaurantProfile: options.getRestaurantProfile,
    getClientDependencyAccess: options.getClientDependencyAccess || (async () => ({ training: "allowed", quality: "allowed", ratings: "allowed" })),
    getRestaurantTraining: options.getRestaurantTraining || (async () => []),
    getRestaurantRatings: options.getRestaurantRatings || (async () => []),
    loadClientQualityRecords: options.loadClientQualityRecords || (async () => ({ records: [], error: "", degraded: false })),
    renderTrainingSection: options.renderTrainingSection || ((records, error) => `training:${records.length}:${error}`),
    renderDeliveryRatingsSection: options.renderDeliveryRatingsSection || ((records, error) => `ratings:${records.length}:${error}`),
    renderDependencyState: options.renderDependencyState || ((label, state) => `${label}:${state}`),
    renderQualityFallbackNotice: options.renderQualityFallbackNotice || ((error) => `quality-error:${error}`),
    renderQualityPerformanceSection: options.renderQualityPerformanceSection || ((records) => `quality:${records.length}`),
    renderWeakAreasSection: options.renderWeakAreasSection || ((records) => `weak:${records.length}`),
    logoMarkup: (restaurant) => `logo:${restaurant.restaurantId}`,
    statusBadge: (status) => status,
    valueOrDash: (value) => String(value || "-"),
    escapeHtml: (value) => String(value ?? ""),
    isPermissionDenied: options.isPermissionDenied || ((error) => Number(error?.status) === 403 || /403|forbidden|permission denied/i.test(String(error?.message || error || ""))),
    showMessage: (message) => messages.push(message)
  };
  const api = evaluateFunctions(clientSource, ["viewRestaurant", "handleClientHistoryNavigation"], context);
  return { ...api, context: api.sandbox, document, events, messages };
}

function integratedClientHistoryHarness(options = {}) {
  const mobile = Boolean(options.mobile);
  const initialUrl = options.initialUrl || "https://example.test/client-profiles.html?status=all#clients";
  const listeners = new Map();
  const focus = [];
  const writes = [];
  const profileCalls = [];
  const announcements = [];
  let activeElement = null;
  let navigationPromise = Promise.resolve();
  let profileResponder = options.getRestaurantProfile || (async (id) => options.restaurants.find((record) => record.restaurantId === id));
  const element = (name) => ({
    name, dataset: {}, hidden: false, innerHTML: "", textContent: "",
    focus() { focus.push(name); activeElement = this; },
    getClientRects: () => [1], querySelector: () => null,
    contains(candidate) { return candidate === this; }
  });
  const root = element("root");
  const list = element("list");
  const detail = element("detail");
  const heading = element("detail-heading");
  const search = element("search");
  const announcement = element("announcement");
  const hiddenNotice = { ...element("hidden-notice"), hidden: true };
  const items = new Map(options.restaurants.map((record) => [record.restaurantId, element(`item-${record.restaurantId}`)]));
  const document = documentFixture({
    "client-workspace": detail,
    "client-detail-announcement": announcement
  });
  document.head = null;
  Object.defineProperty(document, "activeElement", { get: () => activeElement });

  const location = { href: initialUrl, search: new URL(initialUrl).search };
  const stack = [{ href: initialUrl, state: {} }];
  let index = 0;
  function syncLocation(href) {
    const url = new URL(href, location.href);
    location.href = url.href;
    location.search = url.search;
  }
  async function traverse(nextIndex) {
    if (nextIndex < 0 || nextIndex >= stack.length || nextIndex === index) return;
    index = nextIndex;
    syncLocation(stack[index].href);
    navigationPromise = Promise.resolve(listeners.get("popstate")?.());
    await navigationPromise;
  }
  const history = {
    get state() { return stack[index].state; },
    replaceState(state, _title, href) {
      writes.push(["replace", new URL(href, location.href).searchParams.get("restaurantId") || "", state]);
      stack[index] = { href: new URL(href, location.href).href, state };
      syncLocation(stack[index].href);
    },
    pushState(state, _title, href) {
      writes.push(["push", new URL(href, location.href).searchParams.get("restaurantId") || "", state]);
      stack.splice(index + 1);
      stack.push({ href: new URL(href, location.href).href, state });
      index += 1;
      syncLocation(stack[index].href);
    },
    back() { void traverse(index - 1); }
  };
  const media = { matches: mobile, addEventListener() {} };
  const window = {
    document, location, history, window: null, CCPermissions: { applyPermissionVisibility() {} }, CC_PAGE_ACCESS: {},
    matchMedia: () => media,
    setTimeout(callback) { callback(); },
    addEventListener(type, listener) { listeners.set(type, listener); }
  };
  window.window = window;
  vm.runInNewContext(options.masterSource || masterDetailSource, { window });

  const context = {
    document, window, restaurants: options.restaurants, selectedRestaurantId: "", workspaceRequestToken: 0,
    clientMasterDetail: null,
    renderRestaurants() {},
    getRestaurantProfile: async (id) => { profileCalls.push(id); return profileResponder(id); },
    getClientDependencyAccess: async () => ({ training: "allowed", quality: "allowed", ratings: "allowed" }),
    getRestaurantTraining: async () => [], getRestaurantRatings: async () => [],
    loadClientQualityRecords: async () => ({ records: [], error: "", degraded: false }),
    renderTrainingSection: () => "training", renderDeliveryRatingsSection: () => "ratings",
    renderDependencyState: (label, state) => `${label}:${state}`,
    renderQualityFallbackNotice: () => "", renderQualityPerformanceSection: () => "quality", renderWeakAreasSection: () => "weak",
    logoMarkup: (restaurant) => `logo:${restaurant.restaurantId}`, statusBadge: String,
    valueOrDash: (value) => String(value || "-"), escapeHtml: (value) => String(value ?? ""),
    isPermissionDenied: (error) => [401, 403].includes(Number(error?.status)), showMessage() {}
  };
  const names = [
    "updateClientUrl", "renderEmptyWorkspace", "renderWorkspaceLoading", "renderWorkspaceError",
    "renderUnavailableWorkspace", "viewRestaurant", "handleClientHistoryNavigation", "backToClientDirectory"
  ];
  const api = evaluateFunctions(clientSource, names, context, options.clientOverrides || {});
  const controller = window.CloudCrowdMasterDetail.create({
    root, list, detail, announcement, hiddenNotice, mediaQuery: media,
    history: {
      read: () => new URLSearchParams(location.search).get("restaurantId") || "",
      readState: () => history.state,
      write: (id, mode, metadata) => api.updateClientUrl(id, mode, metadata),
      back: () => history.back()
    },
    historyKey: "client-profiles",
    getItem: (id) => items.get(id), getListFallback: () => search, getDetailFocus: () => heading,
    onNavigate: api.handleClientHistoryNavigation
  });
  api.sandbox.clientMasterDetail = controller;
  controller.syncInitial(new URLSearchParams(location.search).get("restaurantId") || "");
  Object.defineProperty(announcement, "textContent", {
    get() { return this._text || ""; },
    set(value) { this._text = String(value); if (value) announcements.push(String(value)); }
  });
  return {
    api, controller, detail, list, focus, writes, profileCalls, announcements,
    ids: () => stack.map((entry) => new URL(entry.href).searchParams.get("restaurantId") || ""),
    currentId: () => new URL(stack[index].href).searchParams.get("restaurantId") || "",
    currentState: () => stack[index].state,
    back: () => traverse(index - 1), forward: () => traverse(index + 1),
    navigation: () => navigationPromise,
    setProfileResponder(responder) { profileResponder = responder; }
  };
}

function linkedStyles(source) {
  return [...source.matchAll(/<link\b[^>]*\brel=(?:["']stylesheet["']|stylesheet)[^>]*>/gi)].map((match) => {
    const href = match[0].match(/\bhref=(?:["']([^"']+)["']|([^\s>]+))/i);
    return href?.[1] || href?.[2];
  });
}

function themeTargets(page, theme, width) {
  const cascade = createCascade(ROOT, page, { viewportWidth: width });
  const html = cssElement("html", { attributes: { "data-theme": theme } });
  const bodyClasses = page === EMPLOYEE_FILE ? ["employee-profiles-page"] : ["business-quality-page", "client-profiles-page"];
  const body = cssElement("body", { classes: bodyClasses }, html);
  const card = cssElement("section", { classes: ["content-card"] }, body);
  const wrap = cssElement("div", { classes: ["profile-table-wrap", "cc-table-wrap"] }, card);
  const table = cssElement("table", { classes: ["profile-table"] }, wrap);
  return { cascade, body, card, wrap, table };
}

function resolvedManagementRole(source, role, variableName) {
  const roleDeclaration = source.match(/const currentRole = \(sessionStorage\.getItem\('cc_role'\) \|\| ''\)\.toLowerCase\(\);/)[0];
  const managementDeclaration = source.match(new RegExp(`const ${variableName} = \\['admin', 'manager'\\]\\.includes\\(currentRole\\);`))[0];
  const sandbox = vm.createContext({ sessionStorage: { getItem: () => role } });
  return vm.runInContext(`${roleDeclaration}\n${managementDeclaration}\n${variableName};`, sandbox);
}

function profileLayoutTargets(page, width) {
  const cascade = createCascade(ROOT, page, {
    viewportWidth: width,
    extraSources: page === EMPLOYEE_FILE
      ? [{ name: "assets/css/components/master-detail.css", css: masterDetailCss, after: "assets/css/components/dialogs.css" }]
      : []
  });
  const html = cssElement("html", { attributes: { "data-theme": "light" } });
  if (page === EMPLOYEE_FILE) {
    const body = cssElement("body", { classes: ["employee-profiles-page", "employee-profiles-ops-center"] }, html);
    const layout = cssElement("section", { classes: ["employee-profiles-workspace-layout", "cc-master-detail"], attributes: { "data-view": "detail" } }, body);
    const directory = cssElement("aside", { classes: ["employee-directory-pane", "content-card", "cc-master-detail__list"] }, layout);
    const workspace = cssElement("section", { classes: ["employee-workspace-pane", "cc-master-detail__detail"] }, layout);
    const card = cssElement("article", { classes: ["employee-card", "cc-card", "is-selected"] }, directory);
    const select = cssElement("button", { classes: ["employee-card-head", "employee-select"], states: ["focus-visible"] }, card);
    const back = cssElement("button", { classes: ["workspace-back-btn", "cc-master-detail__back"] }, workspace);
    return { cascade, layout, directory, workspace, card, select, back };
  }
  const body = cssElement("body", { classes: ["business-quality-page", "client-profiles-page"] }, html);
  const layout = cssElement("section", { classes: ["client-profiles-workspace-layout", "cc-master-detail"], attributes: { "data-view": "detail" } }, body);
  const directory = cssElement("aside", { classes: ["client-directory-pane", "content-card", "cc-master-detail__list"] }, layout);
  const workspace = cssElement("section", { classes: ["client-workspace-pane", "content-card", "cc-master-detail__detail"] }, layout);
  const grid = cssElement("div", { classes: ["client-grid"] }, directory);
  const card = cssElement("article", { classes: ["client-card", "cc-card", "is-selected"] }, grid);
  const select = cssElement("button", { classes: ["small-btn", "client-select"], states: ["focus-visible"] }, card);
  const back = cssElement("button", { classes: ["small-btn", "cc-master-detail__back"] }, workspace);
  return { cascade, layout, directory, workspace, grid, card, select, back };
}

async function permissionRuntimeFixture(profileKey, deniedKeys, document) {
  const access = [
    { moduleKey: profileKey, canView: true, canCreate: true, canEdit: true, canDelete: true },
    ...deniedKeys.map((moduleKey) => ({ moduleKey, canView: false, canCreate: false, canEdit: false, canDelete: false }))
  ];
  assert.ok(document, "Permission runtime must share the Profile harness document");
  document.documentElement ||= {};
  class MutationObserver { observe() {} }
  const window = { location: { href: "profile.html" } };
  window.window = window;
  vm.runInNewContext(permissionsSource, {
    window, document, MutationObserver,
    sessionStorage: { getItem: (key) => ({ cc_user: "agent", cc_role: "agent", cc_token: "token" })[key] || "" },
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, legacyFallback: false, hasConfiguredAccess: true, access }) }),
    console: { warn() {} }
  });
  await window.CCPermissions.requirePageAccess(profileKey);
  return window;
}

test("Employee loading resolves to explicit empty selection without automatic first-record selection", async () => {
  async function run(search, records) {
    const document = documentFixture({ "employee-workspace": { innerHTML: "loading-workspace" } });
    const calls = [];
    const context = {
      document,
      window: { location: { search } },
      EMPLOYEES_ENDPOINT: "/employees",
      employees: [],
      selectedEmployeeId: "",
      apiRequest: async () => ({ employees: records }),
      renderEmployees: () => calls.push("directory"),
      renderStats: () => calls.push("stats"),
      selectEmployee: async (id, settings) => calls.push(["select", id, settings]),
      updateWorkspaceUrl: (id) => calls.push(["url", id]),
      renderWorkspaceError: (message, retry) => calls.push(["error", message, retry]),
      renderUnavailableWorkspace: (message) => calls.push(["unavailable", message]),
      renderEmptyWorkspace: () => {
        document.getElementById("employee-workspace").innerHTML = "empty-selection";
        calls.push("empty-selection");
      },
      escapeHtml: String
    };
    const { loadEmployees, sandbox } = evaluateFunctions(employeeSource, ["loadEmployees"], context);
    await loadEmployees();
    return { calls, workspace: document.getElementById("employee-workspace").innerHTML, selected: sandbox.selectedEmployeeId };
  }

  const ordinary = await run("", [employeeFixture("first"), employeeFixture("second")]);
  assert.deepEqual(plain(ordinary.calls), ["directory", "stats", "empty-selection"]);
  assert.equal(ordinary.workspace, "empty-selection");
  assert.equal(ordinary.selected, "");
  assert.equal(ordinary.calls.some((call) => Array.isArray(call) && call[0] === "url"), false);

  const empty = await run("", []);
  assert.equal(empty.workspace, "empty-selection");
  const valid = await run("?employeeId=second", [employeeFixture("first"), employeeFixture("second")]);
  assert.deepEqual(plain(valid.calls.at(-1)), ["select", "second", { updateUrl: false, navigationSource: "direct" }]);
  const invalid = await run("?employeeId=missing", [employeeFixture("first")]);
  assert.deepEqual(plain(invalid.calls.at(-1)), ["unavailable", "The requested employee record is missing or inaccessible."]);
  assert.equal(invalid.calls.some((call) => Array.isArray(call) && call[0] === "url"), false);
  const archived = await run("?employeeId=old", [employeeFixture("old", "Archived", "inactive")]);
  assert.deepEqual(plain(archived.calls.at(-1)), ["unavailable", "This employee is archived and is unavailable for selection."]);
});

test("Employee directory and authoritative workspace execute loading, empty, error, populated, and degraded states", async () => {
  const employee = { ...employeeFixture("e1", "State Agent"), primaryPhone: "555-state" };
  const initialDirectory = employeeSource.match(/<div class="employee-grid" id="employee-grid">([\s\S]*?)<\/div>\s*<\/aside>/)[1];
  const pendingDirectory = deferred();
  const loadingDocument = documentFixture({
    "employee-grid": { innerHTML: initialDirectory }, "employee-workspace": { innerHTML: "" },
    "employee-search": "", "status-filter": "all", "record-count": { textContent: "" },
    "stat-total": {}, "stat-active": {}, "stat-archived": {}, "stat-restaurants": {}
  });
  const loadingApi = evaluateFunctions(employeeSource, [
    "getFilteredEmployees", "renderEmployees", "renderStats", "renderEmptyWorkspace", "loadEmployees"
  ], {
    document: loadingDocument, window: { location: { search: "" } }, EMPLOYEES_ENDPOINT: "/employees",
    employees: [], selectedEmployeeId: "", apiRequest: () => pendingDirectory.promise,
    selectEmployee() {}, updateWorkspaceUrl() {}, renderWorkspaceError() {},
    employeeStatusBadge: String, escapeHtml: String, canManageEmployees: false
  });
  const loadingRun = loadingApi.loadEmployees();
  await flush();
  assert.match(loadingDocument.getElementById("employee-grid").innerHTML, /Loading employee profiles/);
  pendingDirectory.resolve({ employees: [] });
  await loadingRun;
  assert.match(loadingDocument.getElementById("employee-grid").innerHTML, /No employee profiles match this view/);
  assert.match(loadingDocument.getElementById("employee-workspace").innerHTML, /Select an employee/);

  const profile = deferred();
  const selected = employeeSelectionHarness({ employees: [employee], getEmployeeProfile: () => profile.promise });
  const selectedApi = evaluateFunctions(employeeSource, ["renderWorkspaceLoading", "renderWorkspaceError", "selectEmployee"], selected.context);
  const selectedRun = selectedApi.selectEmployee("e1");
  await flush();
  assert.match(selected.document.getElementById("employee-workspace").innerHTML, /aria-busy="true"[\s\S]*Loading State Agent workspace/);
  profile.resolve(employee);
  await selectedRun;
  assert.match(selected.document.getElementById("employee-workspace").innerHTML, /Employee record[\s\S]*State Agent[\s\S]*Operational Summary/);

  const currentFailure = employeeSelectionHarness({ employees: [employee], getEmployeeProfile: async () => { throw new Error("current profile denied"); } });
  const failureApi = evaluateFunctions(employeeSource, ["renderWorkspaceLoading", "renderWorkspaceError", "selectEmployee"], currentFailure.context);
  await failureApi.selectEmployee("e1");
  assert.match(currentFailure.document.getElementById("employee-workspace").innerHTML, /data-state="error"[\s\S]*current profile denied[\s\S]*Try again/);

  const inaccessible = employeeSelectionHarness({
    employees: [employee], getEmployeeProfile: async () => { throw new Error("403 Forbidden"); }
  });
  const inaccessibleApi = evaluateFunctions(employeeSource, ["renderWorkspaceLoading", "renderUnavailableWorkspace", "selectEmployee"], inaccessible.context);
  await inaccessibleApi.selectEmployee("e1");
  assert.match(inaccessible.document.getElementById("employee-workspace").innerHTML, /data-state="unavailable"[\s\S]*inaccessible/);
  assert.doesNotMatch(inaccessible.document.getElementById("employee-workspace").innerHTML, /Try again/);

  const degraded = employeeSelectionHarness({
    employees: [employee], getEmployeeProfile: async () => employee,
    getEmployeeQualityRecords: async () => { throw new Error("quality offline"); },
    getStoredQualityRecords: () => [{ totalScore: 88, callDateTime: "2026-08-10" }],
    getEmployeeAttendance: async () => { throw new Error("attendance offline"); },
    getStoredAttendanceRecords: () => [{ date: "2026-08-10" }],
    getEmployeeTraining: async () => { throw new Error("training offline"); },
    getEmployeeDeductions: async () => { throw new Error("deductions offline"); }
  });
  const degradedApi = evaluateFunctions(employeeSource, ["renderWorkspaceLoading", "renderWorkspaceError", "selectEmployee"], degraded.context);
  await degradedApi.selectEmployee("e1");
  const degradedOutput = degraded.document.getElementById("employee-workspace").innerHTML;
  assert.match(degradedOutput, /Browser fallback/);
  assert.match(degradedOutput, /Training[\s\S]*Unavailable/);
  assert.match(degradedOutput, /Deductions[\s\S]*Unavailable/);
  assert.doesNotMatch(degradedOutput, /aria-busy="true"/);
});

test("Employee uses restrained announcements for success, partial detail, errors, and unavailable states", async () => {
  const announcements = [];
  const document = documentFixture({ "employee-workspace": { innerHTML: "" } });
  const masterDetail = {
    announce: (message) => announcements.push(message), focusDetail() {}, isMobile: () => false,
    setSelectionHidden() {}, showDetail() {},
    renderState(settings) { document.getElementById("employee-workspace").innerHTML = settings.title; }
  };
  const employee = employeeFixture("e1", "Announced Agent");
  const success = employeeSelectionHarness({ document, masterDetail, employees: [employee], getEmployeeProfile: async () => employee });
  await success.selectEmployee("e1");
  assert.equal(announcements.at(-1), "Announced Agent details updated.");

  const partial = employeeSelectionHarness({
    document, masterDetail, employees: [employee], getEmployeeProfile: async () => employee,
    getEmployeeDependencyAccess: async () => ({ attendance: "unavailable", training: "allowed", deductions: "allowed", quality: "allowed" })
  });
  await partial.selectEmployee("e1");
  assert.equal(announcements.at(-1), "Announced Agent details updated. Some linked modules are restricted or unavailable.");

  const stateApi = evaluateFunctions(employeeSource, ["renderWorkspaceError", "renderUnavailableWorkspace"], {
    document, employeeMasterDetail: masterDetail, selectedEmployeeId: "e1", URLSearchParams,
    window: { location: { search: "?employeeId=e1" } }, escapeHtml: String
  });
  stateApi.renderWorkspaceError("offline");
  assert.equal(announcements.at(-1), "Employee profile could not be loaded.");
  stateApi.renderUnavailableWorkspace("missing", "e1");
  assert.equal(announcements.at(-1), "Employee is unavailable or inaccessible.");
  assert.ok(announcements.every((message) => message.length < 120));
});

test("Employee filtering hides only the selected directory projection and preserves workspace and selection", () => {
  const selected = employeeFixture("e1", "Selected Agent", "active");
  const other = employeeFixture("e2", "Visible Agent", "active");
  const document = documentFixture({
    "employee-search": "visible",
    "status-filter": "all",
    "employee-grid": { innerHTML: "" },
    "record-count": { textContent: "" },
    "employee-workspace": { innerHTML: "selected-workspace:e1" }
  });
  let selectionCalls = 0;
  const hiddenStates = [];
  const context = {
    document,
    employeeMasterDetail: { setSelectionHidden: (hidden) => hiddenStates.push(hidden) },
    employees: [selected, other],
    selectedEmployeeId: "e1",
    canManageEmployees: false,
    selectEmployee: () => { selectionCalls += 1; },
    employeeStatusBadge: (status) => status,
    escapeHtml: String
  };
  const { getFilteredEmployees, renderEmployees, sandbox } = evaluateFunctions(
    employeeSource, ["getFilteredEmployees", "renderEmployees"], context
  );
  assert.deepEqual(plain(getFilteredEmployees().map((employee) => employee.employeeId)), ["e2"]);
  renderEmployees();
  assert.equal(sandbox.selectedEmployeeId, "e1");
  assert.equal(selectionCalls, 0);
  assert.equal(document.getElementById("employee-workspace").innerHTML, "selected-workspace:e1");
  assert.doesNotMatch(document.getElementById("employee-grid").innerHTML, /Selected Agent|is-selected|aria-current/);
  assert.match(document.getElementById("employee-grid").innerHTML, /Visible Agent/);
  assert.equal(document.getElementById("record-count").textContent, "1 record");
  assert.deepEqual(hiddenStates, [true]);

  let resetRenders = 0;
  let searchFocused = 0;
  document.getElementById("employee-search").focus = () => { searchFocused += 1; };
  const reset = evaluateFunctions(employeeSource, ["resetEmployeeFilters"], {
    document, selectedEmployeeId: "e1", renderEmployees: () => { resetRenders += 1; }
  });
  reset.resetEmployeeFilters();
  assert.equal(document.getElementById("employee-search").value, "");
  assert.equal(document.getElementById("status-filter").value, "all");
  assert.equal(resetRenders, 1);
  assert.equal(searchFocused, 1, "hidden selection restores focus to the safe search fallback");
});

test("Employee search fields, status filters, metrics, counts, and visible selection hooks execute", () => {
  const employees = [
    { ...employeeFixture("name", "Search Name"), primaryPhone: "111", assignedRestaurants: ["Alpha", "Shared"] },
    { ...employeeFixture("phone", "Phone Agent", "inactive"), primaryPhone: "222-special", assignedRestaurants: ["Beta"] },
    { ...employeeFixture("restaurant", "Restaurant Agent"), primaryPhone: "333", assignedRestaurants: ["Gamma Kitchen", "Shared"] }
  ];
  const document = documentFixture({
    "employee-search": "", "status-filter": "all", "employee-grid": { innerHTML: "" },
    "record-count": { textContent: "" }, "stat-total": {}, "stat-active": {}, "stat-archived": {}, "stat-restaurants": {}
  });
  const api = evaluateFunctions(employeeSource, ["getFilteredEmployees", "renderEmployees", "renderStats"], {
    document, employees, selectedEmployeeId: "phone", employeeStatusBadge: String, escapeHtml: String
  });
  const search = document.getElementById("employee-search");
  const status = document.getElementById("status-filter");
  const ids = () => plain(api.getFilteredEmployees().map((record) => record.employeeId));
  for (const [term, expected] of [["search name", ["name"]], ["222-special", ["phone"]], ["gamma kitchen", ["restaurant"]]]) {
    search.value = term; status.value = "all";
    assert.deepEqual(ids(), expected);
  }
  search.value = "";
  for (const [filter, expected] of [["all", ["name", "phone", "restaurant"]], ["active", ["name", "restaurant"]], ["inactive", ["phone"]]]) {
    status.value = filter;
    assert.deepEqual(ids(), expected);
  }
  api.renderStats();
  assert.deepEqual(["stat-total", "stat-active", "stat-archived", "stat-restaurants"].map((id) => document.getElementById(id).textContent), [3, 2, 1, 4]);
  status.value = "inactive";
  api.renderEmployees();
  assert.equal(document.getElementById("record-count").textContent, "1 record");
  assert.match(document.getElementById("employee-grid").innerHTML, /employee-card cc-card is-selected[\s\S]*aria-current="true"[\s\S]*data-view-id="phone"/);
  search.value = "no-match";
  api.renderEmployees();
  assert.equal(document.getElementById("record-count").textContent, "0 records");
  assert.match(document.getElementById("employee-grid").innerHTML, /No employee profiles match this view/);
});

test("Employee URL adapter and shared history stack avoid duplicate mobile list entries", async () => {
  const updateSource = functionSource(employeeSource, "updateWorkspaceUrl");
  const replacements = [];
  const pushes = [];
  const window = {
    location: { href: "https://example.test/employee-profiles.html?status=all#team" },
    history: { replaceState: (...args) => replacements.push(args), pushState: (...args) => pushes.push(args) }
  };
  const { updateWorkspaceUrl } = evaluateFunctions(employeeSource, ["updateWorkspaceUrl"], { window });
  updateWorkspaceUrl("e 1");
  updateWorkspaceUrl("e 2", "push");
  updateWorkspaceUrl("");
  assert.equal(replacements[0][2], "/employee-profiles.html?status=all&employeeId=e+1#team");
  assert.equal(replacements[1][2], "/employee-profiles.html?status=all#team");
  assert.equal(pushes[0][2], "/employee-profiles.html?status=all&employeeId=e+2#team");
  assert.match(updateSource, /pushState[\s\S]*replaceState/);

  function sharedController(mobile, initialId = "") {
    const listeners = new Map();
    const writes = [];
    const focus = [];
    const stack = [{ id: initialId, state: {} }];
    let index = 0;
    let activeElement = null;
    const element = (name) => ({
      name, dataset: {}, hidden: false, textContent: "", innerHTML: "",
      focus: () => { focus.push(name); activeElement = elements[name]; }, getClientRects: () => [1], querySelector: () => null,
      contains: (candidate) => candidate === elements[name]
    });
    const elements = {};
    const root = elements.root = element("root");
    const list = elements.list = element("list");
    const detail = elements.detail = element("detail");
    const item = elements.item = element("item");
    const fallback = elements.search = element("search");
    const heading = elements.heading = element("heading");
    let mediaListener = null;
    const media = { matches: mobile, addEventListener: (_type, listener) => { mediaListener = listener; } };
    const document = { head: null, get activeElement() { return activeElement; } };
    const sharedWindow = {
      matchMedia: () => media, setTimeout: (callback) => callback(),
      addEventListener: (type, listener) => listeners.set(type, listener), document
    };
    sharedWindow.window = sharedWindow;
    vm.runInNewContext(masterDetailSource, { window: sharedWindow });
    const controller = sharedWindow.CloudCrowdMasterDetail.create({
      root, list, detail, mediaQuery: media,
      history: {
        read: () => stack[index].id,
        readState: () => stack[index].state,
        write: (id, mode, state) => {
          writes.push([id, mode, state]);
          if (mode === "push") { stack.splice(index + 1); stack.push({ id, state }); index += 1; }
          else stack[index] = { id, state };
        },
        back: () => { if (index > 0) { index -= 1; void listeners.get("popstate")(); } }
      },
      historyKey: "employee-profiles",
      getItem: () => item, getListFallback: () => fallback, getDetailFocus: () => heading
    });
    controller.syncInitial(initialId);
    return {
      controller, writes, focus, list, detail,
      ids: () => stack.map((entry) => entry.id),
      current: () => stack[index],
      back: async () => { if (index > 0) index -= 1; await listeners.get("popstate")(); },
      forward: async () => { if (index < stack.length - 1) index += 1; await listeners.get("popstate")(); },
      setMobile: (matches) => { media.matches = matches; mediaListener(); },
      setActive: (name) => { activeElement = elements[name]; }
    };
  }
  const desktop = sharedController(false);
  desktop.controller.showDetail("desktop", { focus: true });
  assert.deepEqual(desktop.writes.map(([id, mode]) => [id, mode]), [["desktop", "replace"]]);
  assert.deepEqual(desktop.focus, ["item"], "desktop selection focuses the connected replacement item, not detail");
  assert.equal(desktop.list.hidden, false);
  assert.equal(desktop.detail.hidden, false);

  const mobile = sharedController(true);
  mobile.controller.showDetail("mobile", { focus: true });
  assert.deepEqual(mobile.ids(), ["", "mobile"]);
  assert.deepEqual(mobile.writes.map(([id, mode]) => [id, mode]), [["", "replace"], ["mobile", "push"]]);
  assert.deepEqual(mobile.focus, ["heading"]);
  assert.equal(mobile.list.hidden, true);
  assert.equal(mobile.detail.hidden, false);
  assert.equal(mobile.controller.backToList({ restoreFocus: true }), "history");
  await flush();
  assert.deepEqual(mobile.ids(), ["", "mobile"], "Internal Back traverses instead of producing list/list");
  assert.equal(mobile.current().id, "");
  assert.deepEqual(mobile.focus, ["heading", "item"]);
  assert.equal(mobile.list.hidden, false);
  assert.equal(mobile.detail.hidden, true);

  await mobile.forward();
  assert.equal(mobile.current().id, "mobile");
  assert.equal(mobile.detail.hidden, false, "Browser Forward restores pushed detail");

  const browserBack = sharedController(true);
  browserBack.controller.showDetail("mobile", { focus: true });
  await browserBack.back();
  assert.deepEqual(browserBack.ids(), ["", "mobile"]);
  assert.equal(browserBack.list.hidden, false);
  assert.equal(browserBack.detail.hidden, true);
  assert.deepEqual(browserBack.focus, ["heading", "item"]);

  const direct = sharedController(true, "direct");
  assert.deepEqual(direct.focus, [], "direct initial synchronization does not force focus");
  assert.equal(direct.controller.backToList({ restoreFocus: true }), "replace");
  assert.deepEqual(direct.ids(), [""]);
  assert.equal(direct.current().state.ccMasterDetail.view, "list");

  const backHandler = employeeSource.match(/if \(backButton\) \{([\s\S]*?)\n\s*\}/)[1];
  assert.match(backHandler, /const restoreId = [\s\S]*selectedEmployeeId = ''[\s\S]*renderEmployees\(\)[\s\S]*backToList\(\{ restoreFocus: true, restoreId \}\)/);
  assert.match(masterDetailSource, /addEventListener\?\.\('popstate', handlePopState\)/);

  function requireDeepLinkContract(source) {
    assert.match(functionSource(source, "loadEmployees"), /URLSearchParams\(window\.location\.search\)\.get\('employeeId'\)/);
    assert.match(functionSource(source, "updateWorkspaceUrl"), /searchParams\.delete\('employeeId'/);
  }
  requireDeepLinkContract(employeeSource);
  assert.throws(() => requireDeepLinkContract(employeeSource.replace("searchParams.delete('employeeId')", "searchParams.set('employeeId', '')")));
});

test("Employee unavailable ownership clears selection while preserving route and detail view", async () => {
  const archived = employeeFixture("e1", "Archived Agent", "inactive");
  const document = documentFixture({
    "employee-search": "", "status-filter": "all", "employee-grid": { innerHTML: "" },
    "record-count": { textContent: "" }, "employee-workspace": { innerHTML: "" },
    "stat-total": {}, "stat-active": {}, "stat-archived": {}, "stat-restaurants": {}
  });
  const hidden = [];
  const calls = [];
  const context = {
    document, window: { location: { search: "?employeeId=e1" } }, EMPLOYEES_ENDPOINT: "/employees",
    employees: [employeeFixture("e1", "Previously Active")], selectedEmployeeId: "e1", canManageEmployees: false,
    apiRequest: async () => ({ employees: [archived] }), selectEmployee() {},
    employeeMasterDetail: {
      syncInitial: (id, settings) => calls.push(["sync", id, settings]),
      setSelectionHidden: (value) => hidden.push(value)
    },
    renderUnavailableWorkspace: (message) => calls.push(["unavailable", message]),
    renderEmptyWorkspace() {}, employeeStatusBadge: String, escapeHtml: String
  };
  const api = evaluateFunctions(employeeSource, ["getFilteredEmployees", "renderEmployees", "renderStats", "loadEmployees"], context);
  await api.loadEmployees();
  assert.equal(api.sandbox.selectedEmployeeId, "");
  assert.doesNotMatch(document.getElementById("employee-grid").innerHTML, /is-selected|aria-current/);
  assert.equal(hidden.at(-1), false);
  assert.deepEqual(plain(calls.at(-1)), ["unavailable", "This employee is archived and is unavailable for selection."]);
  assert.equal(context.window.location.search, "?employeeId=e1", "unavailable route remains until Back");

  const mediaListeners = [];
  const focus = [];
  const media = { matches: false, addEventListener: (_type, listener) => mediaListeners.push(listener) };
  const root = { dataset: {} };
  const list = { hidden: false, contains: () => false };
  const detail = { hidden: false, contains: () => false, innerHTML: "" };
  const item = { hidden: false, getClientRects: () => [1], focus: () => focus.push("origin") };
  const heading = { focus: () => focus.push("detail") };
  const sharedWindow = { document: { head: null, activeElement: null }, setTimeout: (fn) => fn(), addEventListener() {}, window: null };
  sharedWindow.window = sharedWindow;
  vm.runInNewContext(masterDetailSource, { window: sharedWindow });
  const controller = sharedWindow.CloudCrowdMasterDetail.create({
    root, list, detail, mediaQuery: media,
    history: { read: () => "e1", readState: () => ({}), write() {} },
    getItem: () => item, getListFallback: () => item, getDetailFocus: () => heading
  });
  controller.showDetail("e1", { updateHistory: false });
  controller.showDetail("", { routeId: "e1", updateHistory: false, rememberOrigin: false });
  assert.equal(controller.getSelectedId(), "");
  assert.equal(controller.getRouteId(), "e1");
  assert.equal(controller.getView(), "detail");
  media.matches = true;
  mediaListeners[0]();
  assert.equal(controller.getView(), "detail");
  assert.equal(list.hidden, true);
  assert.equal(detail.hidden, false);
  controller.focusList();
  assert.deepEqual(focus, ["origin"], "unavailable detail retains a safe restoration origin");

  for (const status of [403, 404]) {
    const transitions = [];
    const transitionDocument = documentFixture({ "employee-workspace": { innerHTML: "" } });
    const transitionMaster = {
      announce() {}, focusDetail() {}, isMobile: () => false, setSelectionHidden: (value) => transitions.push(["hidden", value]),
      showDetail: (id, settings) => transitions.push(["detail", id, settings.routeId]),
      renderState: (settings) => { transitionDocument.getElementById("employee-workspace").innerHTML = settings.title; }
    };
    const active = employeeFixture("gone", "Formerly Valid");
    const transitionHarness = employeeSelectionHarness({
      document: transitionDocument, masterDetail: transitionMaster, employees: [active],
      getEmployeeProfile: async () => { const error = new Error("record lookup failed"); error.status = status; throw error; }
    });
    const transitionApi = evaluateFunctions(employeeSource, ["renderUnavailableWorkspace", "selectEmployee"], transitionHarness.context);
    await transitionApi.selectEmployee("gone");
    assert.equal(transitionApi.sandbox.selectedEmployeeId, "");
    assert.ok(transitions.some((entry) => entry[0] === "hidden" && entry[1] === false));
    assert.deepEqual(plain(transitions.find((entry) => entry[0] === "detail" && entry[1] === "")), ["detail", "", "gone"]);
    assert.match(transitionDocument.getElementById("employee-workspace").innerHTML, /Employee is unavailable/);
  }
});

test("Employee request token makes later selection authoritative over stale success and stale error", async () => {
  const slowQuality = deferred();
  const profiles = { A: employeeFixture("A", "Slow A"), B: employeeFixture("B", "Fast B") };
  const harness = employeeSelectionHarness({
    employees: Object.values(profiles),
    getEmployeeProfile: async (id) => profiles[id],
    getEmployeeQualityRecords: (id) => id === "A" ? slowQuality.promise : Promise.resolve([])
  });
  const a = harness.selectEmployee("A");
  await flush();
  await harness.selectEmployee("B");
  assert.match(harness.document.getElementById("employee-workspace").innerHTML, /Fast B/);
  slowQuality.resolve([{ totalScore: 10, callDateTime: "2026-01-01" }]);
  await a;
  assert.match(harness.document.getElementById("employee-workspace").innerHTML, /Fast B/);
  assert.doesNotMatch(harness.document.getElementById("employee-workspace").innerHTML, /Slow A/);

  const slowProfile = deferred();
  const errorHarness = employeeSelectionHarness({
    employees: Object.values(profiles),
    getEmployeeProfile: (id) => id === "A" ? slowProfile.promise : Promise.resolve(profiles.B)
  });
  const staleError = errorHarness.selectEmployee("A");
  await errorHarness.selectEmployee("B");
  slowProfile.reject(new Error("obsolete failure"));
  await staleError;
  assert.match(errorHarness.document.getElementById("employee-workspace").innerHTML, /Fast B/);
  assert.equal(errorHarness.events.some((event) => Array.isArray(event) && event[0] === "error"), false);
});

test("Employee stale-result guard is mutation-resistant and behaviorally necessary", async () => {
  const original = functionSource(employeeSource, "selectEmployee");
  const unguarded = original.replace(/if \(requestToken !== workspaceRequestToken \|\| employeeId !== selectedEmployeeId\) return;/g, "");
  assert.notEqual(unguarded, original);
  const slow = deferred();
  const profiles = { A: employeeFixture("A", "Obsolete A"), B: employeeFixture("B", "Current B") };
  const harness = employeeSelectionHarness({
    selectionSource: unguarded,
    employees: Object.values(profiles),
    getEmployeeProfile: async (id) => profiles[id],
    getEmployeeQualityRecords: (id) => id === "A" ? slow.promise : Promise.resolve([])
  });
  const a = harness.selectEmployee("A");
  await flush();
  await harness.selectEmployee("B");
  slow.resolve([]);
  await a;
  assert.match(harness.document.getElementById("employee-workspace").innerHTML, /Obsolete A/);
});

test("Employee API dependency adapters preserve success, empty, and propagated 403 behavior", async () => {
  const names = ["getEmployeeAttendance", "getEmployeeTraining", "getEmployeeDeductions", "getEmployeeQualityRecords"];
  const payloads = {
    getEmployeeAttendance: { attendance: [{ id: "a" }] },
    getEmployeeTraining: { training: [{ id: "t" }] },
    getEmployeeDeductions: { deductions: [{ id: "d" }] },
    getEmployeeQualityRecords: { records: [{ id: "q" }] }
  };
  const keys = { getEmployeeAttendance: "attendance", getEmployeeTraining: "training", getEmployeeDeductions: "deductions", getEmployeeQualityRecords: "records" };
  for (const name of names) {
    const calls = [];
    let responder = async () => payloads[name];
    const context = {
      ATTENDANCE_ENDPOINT: "/attendance", TRAINING_ENDPOINT: "/training", DEDUCTIONS_ENDPOINT: "/deductions", WEEKLY_QUALITY_ENDPOINT: "/quality",
      apiRequest: async (url) => { calls.push(url); return responder(); }
    };
    const fn = evaluateFunctions(employeeSource, [name], context)[name];
    assert.deepEqual(plain(await fn("e 1")), payloads[name][keys[name]]);
    assert.match(calls[0], /employeeId=e%201|agentEmployeeId=e%201/);
    responder = async () => ({ [keys[name]]: null });
    assert.deepEqual(plain(await fn("e1")), []);
    responder = async () => { throw new Error("403 Forbidden"); };
    await assert.rejects(fn("e1"), /403 Forbidden/);
  }
});

test("Employee dependency 403 responses suppress local fallback and render independent restricted states", async () => {
  const localQuality = [{ totalScore: 88, callDateTime: "2026-08-01", campaign: "Local" }];
  const localAttendance = [{ date: "2026-08-01", loginStatus: "On Time" }];
  const forbidden = async () => { const error = new Error("Access blocked"); error.status = 403; throw error; };
  const harness = employeeSelectionHarness({
    employees: [employeeFixture("e1", "Restricted Employee")],
    getEmployeeQualityRecords: forbidden,
    getEmployeeAttendance: forbidden,
    getEmployeeTraining: forbidden,
    getEmployeeDeductions: forbidden,
    getStoredQualityRecords: () => localQuality,
    getStoredAttendanceRecords: () => localAttendance
  });
  await harness.selectEmployee("e1");
  const output = harness.document.getElementById("employee-workspace").innerHTML;
  assert.match(output, /Attendance count<\/span><strong>-[\s\S]*Restricted/);
  assert.match(output, /Quality score<\/span><strong>-[\s\S]*Restricted/);
  assert.match(output, /Training count<\/span><strong>-[\s\S]*Restricted/);
  assert.match(output, /Deductions count<\/span><strong>-[\s\S]*Restricted/);
  for (const key of ["attendance", "weekly_quality", "agent_training", "employee_deductions"]) {
    assert.match(output, new RegExp(`data-module-permission="${key}" data-state="restricted"`));
  }
  assert.doesNotMatch(output, /80%|Browser fallback|2026-08-01|Access blocked/);

  const api = evaluateFunctions(employeeSource, ["apiRequest", "isPermissionDenied"], {
    fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: "Access blocked" }) }),
    authHeaders: (headers) => headers, handleAuthFailure: () => false
  });
  const statusError = await api.apiRequest("/protected").catch((error) => error);
  assert.equal(statusError.status, 403);
  assert.equal(api.isPermissionDenied(statusError), true, "HTTP status owns denial even when message has no denial wording");
});

test("Employee permitted Deductions success path renders two records and rejects an undeclared-length mutation", async () => {
  const employee = employeeFixture("e1", "Deductions Agent");
  const deductions = [
    { deductionId: "d1", orderDateTime: "2026-08-11", deductionType: "Personal Order", restaurantName: "Alpha", orderNumber: "A-1", finalDeductionAmount: 3.5 },
    { deductionId: "d2", orderDateTime: "2026-08-10", deductionType: "Order Mistake", restaurantName: "Beta", orderNumber: "B-2", finalDeductionAmount: 2.25 }
  ];

  async function requireDeductionsSuccess(selectionSource = functionSource(employeeSource, "selectEmployee")) {
    const requests = [];
    const announcements = [];
    const document = documentFixture({ "employee-workspace": { innerHTML: "" } });
    const masterDetail = {
      announce: (message) => announcements.push(message), focusDetail() {}, isMobile: () => false,
      setSelectionHidden() {}, showDetail() {},
      renderState(settings) { document.getElementById("employee-workspace").innerHTML = `<div data-state="${settings.state}">${settings.title}</div>`; }
    };
    const harness = employeeSelectionHarness({
      document, masterDetail, selectionSource, employees: [employee], getEmployeeProfile: async () => employee,
      getEmployeeDependencyAccess: async () => ({ attendance: "allowed", training: "allowed", deductions: "allowed", quality: "allowed" }),
      getEmployeeAttendance: async () => { requests.push("attendance"); return []; },
      getEmployeeTraining: async () => { requests.push("agent_training"); return []; },
      getEmployeeQualityRecords: async () => { requests.push("weekly_quality"); return []; },
      getEmployeeDeductions: async () => { requests.push("employee_deductions"); return deductions; }
    });
    await harness.selectEmployee("e1");
    const output = document.getElementById("employee-workspace").innerHTML;
    assert.deepEqual(requests, ["weekly_quality", "attendance", "employee_deductions", "agent_training"],
      "All explicitly allowed dependency requests must execute");
    assert.match(output, /Deductions count<\/span><strong>2/, "Deductions count must remain 2");
    assert.match(output, /data-module-permission="employee_deductions" data-state="success"/);
    assert.match(output, /workspace-profile-header[\s\S]*Deductions Agent[\s\S]*workspace-summary-section[\s\S]*workspace-modules-section/);
    assert.doesNotMatch(output, /^(?:error:)|data-state="(?:error|unavailable)"|Employee profile could not be loaded|Employee is unavailable/);
    assert.equal(announcements.at(-1), "Deductions Agent details updated.");
  }

  await requireDeductionsSuccess();
  const validSource = functionSource(employeeSource, "selectEmployee");
  const invalidIdentifier = ["deductions", "Records"].join("");
  const mutantSource = validSource.replace("deductionRecords.length", `${invalidIdentifier}.length`);
  assert.notEqual(mutantSource, validSource, "Mutation must replace the exercised Deductions length reference");
  await assert.rejects(() => requireDeductionsSuccess(mutantSource), /Deductions count must remain 2/);
});

test("Employee local compatibility matching is ID-first, unique-name-only, ordered, and mutation-resistant", () => {
  const employees = [employeeFixture("e1", "Alex Same"), employeeFixture("e2", "Jordan Other")];
  const storage = new Map();
  storage.set("quality", JSON.stringify([
    { id: "wrong-id", agentEmployeeId: "e2", agentNameSnapshot: "Alex Same", callDateTime: "2026-08-09" },
    { id: "legacy", agentNameSnapshot: "alex same", callDateTime: "2026-08-08" },
    { id: "new", agentEmployeeId: "e1", callDateTime: "2026-08-10" }
  ]));
  storage.set("attendance", JSON.stringify([
    { id: "old", employeeId: "e1", date: "2026-08-01" },
    { id: "new", employeeId: "e1", date: "2026-08-11" }
  ]));
  const names = [
    "readStoredRecords", "normalizeEmployeeName", "canUseLegacyNameMatch", "recordMatchesEmployee", "recordTimestamp",
    "getStoredQualityRecords", "getStoredAttendanceRecords"
  ];
  const api = evaluateFunctions(employeeSource, names, {
    employees,
    localStorage: { getItem: (key) => storage.get(key) || null },
    WEEKLY_QUALITY_STORAGE_KEY: "quality",
    ATTENDANCE_STORAGE_KEY: "attendance"
  });
  assert.deepEqual(plain(api.getStoredQualityRecords(employees[0]).map((record) => record.id)), ["new", "legacy"]);
  assert.deepEqual(plain(api.getStoredAttendanceRecords(employees[0]).map((record) => record.id)), ["new", "old"]);
  employees.push(employeeFixture("e3", " ALEX   SAME "));
  assert.equal(api.recordMatchesEmployee({ agent: "Alex Same" }, employees[0], "agentEmployeeId", "agentNameSnapshot", "agent"), false);

  const idFirst = functionSource(employeeSource, "recordMatchesEmployee");
  assert.ok(idFirst.indexOf("if (recordEmployeeId)") < idFirst.indexOf("canUseLegacyNameMatch"));
  const mutated = idFirst.replace("if (recordEmployeeId) return recordEmployeeId === String(employee.employeeId);", "");
  assert.throws(() => assert.ok(mutated.indexOf("if (recordEmployeeId)") >= 0));
});

test("Employee protected Quality and Attendance summaries execute ordering and calculations", () => {
  const employee = employeeFixture("e1", "Metrics Employee");
  const api = evaluateFunctions(employeeSource, [
    "recordTimestamp", "getQualityScore", "getQualitySummary", "parseDurationMinutes",
    "attendanceHasStatus", "getAttendanceSummary"
  ], {});
  const quality = api.getQualitySummary(employee, [
    { callDateTime: "2026-08-01", totalScore: 60, campaign: "A" },
    { callDateTime: "2026-08-03", totalScore: 90, campaign: "B" },
    { callDateTime: "2026-08-02", totalScore: 80, campaign: "B" }
  ]);
  assert.deepEqual(plain(quality.records.map((record) => record.totalScore)), [90, 80, 60]);
  assert.equal(quality.average, 230 / 3);
  assert.equal(quality.best, 90);
  assert.equal(quality.worst, 60);
  assert.deepEqual(plain(quality.topCampaign), { name: "B", average: 85, count: 2 });

  const attendance = api.getAttendanceSummary(employee, [
    { date: "2026-08-01", loginStatus: "On Time", logoutStatus: "Left Early", extraTime: "Yes", extraDuration: "1h 30m" },
    { date: "2026-08-03", loginStatus: "Late", logoutStatus: "Late Logout", extraTime: "Yes", extraDuration: "00:45" },
    { date: "2026-08-02", loginStatus: "On Time", extraTime: "Yes", extraDuration: "unknown" }
  ]);
  assert.deepEqual(plain(attendance.records.map((record) => record.date)), ["2026-08-03", "2026-08-02", "2026-08-01"]);
  assert.deepEqual(plain({ onTime: attendance.onTime, leftEarly: attendance.leftEarly, lateLogout: attendance.lateLogout, extraTime: attendance.extraTime, total: attendance.totalExtraMinutes, unparsed: attendance.unparsedDurations }),
    { onTime: 2, leftEarly: 1, lateLogout: 1, extraTime: 3, total: 135, unparsed: 1 });
});

test("Employee detail executes five-row projections, role actions, and empty dependency summaries", async () => {
  const qualityRecords = Array.from({ length: 6 }, (_, index) => ({ totalScore: 70 + index, callDateTime: `2026-08-0${6 - index}`, campaign: `Q${index}` }));
  const summary = (_employee, records) => ({ records, average: 72.5, best: 75, worst: 70, lastDate: records[0].callDateTime, topCampaign: null });
  for (const [role, canManage] of [["admin", true], ["manager", true], ["agent", false]]) {
    let qualityRowComputations = 0;
    const harness = employeeSelectionHarness({
      canManage,
      employees: [employeeFixture("e1", `${role} Employee`)],
      getEmployeeQualityRecords: async () => qualityRecords,
      getQualitySummary: summary,
      qualityDetails: () => { qualityRowComputations += 1; return "details"; }
    });
    await harness.selectEmployee("e1");
    const output = harness.document.getElementById("employee-workspace").innerHTML;
    assert.equal(qualityRowComputations, 5, role);
    assert.match(output, /Attendance count[\s\S]*0 linked records[\s\S]*Training count[\s\S]*0 linked records[\s\S]*Deductions count[\s\S]*0 linked records/);
    if (canManage) assert.match(output, /data-edit-id="e1"[\s\S]*data-archive-id="e1"/);
    else assert.doesNotMatch(output, /data-edit-id|data-archive-id/);
  }
  assert.match(employeeSource, /canManageEmployees = \['admin', 'manager'\]\.includes\(currentRole\)/);
  assert.doesNotMatch(functionSource(employeeSource, "selectEmployee"), /restore|reactivat/i);
});

test("Employee and Client role-resolution expressions map Admin and Manager to management and Agent to read-only", () => {
  for (const [role, expected] of [["admin", true], ["ADMIN", true], ["manager", true], ["Manager", true], ["agent", false], ["", false]]) {
    assert.equal(resolvedManagementRole(employeeSource, role, "canManageEmployees"), expected, `Employee ${role || "empty"}`);
    assert.equal(resolvedManagementRole(clientSource, role, "canManageClients"), expected, `Client ${role || "empty"}`);
  }
});

test("Employee Attendance, Training, and Deduction projections execute newest-five ordering", async () => {
  const escaped = [];
  const attendance = Array.from({ length: 6 }, (_, index) => ({
    date: `2026-08-0${index + 1}`, fromTime: "09:00", toTime: "17:00",
    loginStatus: "On Time", logoutStatus: "On Time", extraTime: "No", note: `attendance-${index}`
  }));
  const deductions = Array.from({ length: 6 }, (_, index) => ({
    orderDateTime: `2026-08-0${index + 1} 10:00:00`, deductionType: "Order Mistake",
    restaurantName: `deduction-${index}`, orderNumber: `D-${index}`, finalDeductionAmount: index + 1
  }));
  const training = Array.from({ length: 6 }, (_, index) => ({
    trainingDate: `2026-08-0${index + 1}`, restaurantName: `training-${index}`,
    assignmentStatus: "Assigned", trainingStatus: "Trained", updatedByName: "Manager"
  }));
  const harness = employeeSelectionHarness({
    employees: [employeeFixture("e1", "Projection Employee")],
    getEmployeeAttendance: async () => attendance,
    getEmployeeDeductions: async () => deductions,
    getEmployeeTraining: async () => training,
    getAttendanceSummary: (_employee, records) => ({
      records: [...records].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
      onTime: 6, leftEarly: 0, lateLogout: 0, extraTime: 0,
      totalExtraMinutes: 0, unparsedDurations: 0, lastDate: "2026-08-06"
    }),
    attendanceNote: (record) => record.note,
    escapeHtml: (value) => { escaped.push(String(value ?? "")); return String(value ?? ""); }
  });
  await harness.selectEmployee("e1");
  for (const prefix of ["attendance", "deduction", "training"]) {
    assert.equal(escaped.includes(`${prefix}-5`), true, `${prefix} newest record computed`);
    assert.equal(escaped.includes(`${prefix}-0`), false, `${prefix} oldest record excluded by five-row limit`);
  }
});

test("Employee archive executes DELETE for the selected employee and retains selection through reload ownership", async () => {
  const requests = [];
  let reloads = 0;
  const context = {
    canManageEmployees: true,
    selectedEmployeeId: "e1",
    employees: [employeeFixture("e1", "Selected Employee")],
    EMPLOYEES_ENDPOINT: "/employees",
    window: { CloudCrowdConfirmation: { request: async () => true } },
    apiRequest: async (...args) => { requests.push(args); },
    showMessage() {},
    loadEmployees: async () => { reloads += 1; }
  };
  const { archiveEmployee, sandbox } = evaluateFunctions(employeeSource, ["archiveEmployee"], context);
  await archiveEmployee("e1");
  assert.deepEqual(plain(requests), [["/employees?id=e1", { method: "DELETE" }]]);
  assert.equal(reloads, 1);
  assert.equal(sandbox.selectedEmployeeId, "e1");
  assert.doesNotMatch(employeeSource, /restoreEmployee|data-restore/);
});

test("Employee child rows render protected fields and primary-phone enforcement preserves exactly the chosen primary", () => {
  const document = documentFixture({ "phone-list": { children: [], appendChild(child) { this.children.push(child); } } });
  const api = evaluateFunctions(employeeSource, ["phoneRow", "contactRow", "restaurantRow", "addRow", "enforceSinglePrimary"], {
    document, escapeHtml: String
  });
  const phone = api.phoneRow({ label: "Work", phoneNumber: "123", isPrimary: true });
  const contact = api.contactRow({ contactName: "Pat", relationship: "Parent", phoneNumber: "456" });
  const restaurant = api.restaurantRow("North Grill");
  assert.match(phone.innerHTML, /phone-label[\s\S]*Work[\s\S]*phone-number[\s\S]*123[\s\S]*phone-primary[\s\S]*checked/);
  assert.match(contact.innerHTML, /Pat[\s\S]*Parent[\s\S]*456/);
  assert.match(restaurant.innerHTML, /restaurant-name[\s\S]*North Grill/);
  api.addRow("phone-list", phone);
  assert.equal(document.getElementById("phone-list").children[0], phone);

  const chosen = { checked: true, classList: { contains: () => true } };
  const other = { checked: true };
  document.querySelectorAll = () => [chosen, other];
  api.enforceSinglePrimary({ target: chosen });
  assert.equal(chosen.checked, true);
  assert.equal(other.checked, false);
});

test("Client directory executes every search field, status, metric, state, and downstream management rendering", async () => {
  const productionInitialGrid = clientSource.match(/<div class="client-grid" id="client-grid"[^>]*>([\s\S]*?)<\/div>\s*<\/aside>/)[1].trim();
  assert.equal(productionInitialGrid, '<div class="empty-state cc-empty-state" role="status">Loading client profiles...</div>');
  const restaurants = [
    { ...restaurantFixture("brand", "Brand Needle"), status: "active" },
    { ...restaurantFixture("phone", "Phone Client"), callCenterNumber: "Phone Needle", status: "inactive" },
    { ...restaurantFixture("owner", "Owner Client"), brandOwnerName: "Owner Needle", status: "active" },
    { ...restaurantFixture("account", "Account Client"), accountManagerName: "Account Needle", status: "active" },
    { ...restaurantFixture("manager", "Manager Client"), restaurantManagerName: "Manager Needle", status: "active" }
  ];
  function gridElement(innerHTML = productionInitialGrid) {
    return { innerHTML, dataset: {}, setAttribute() {}, removeAttribute() {} };
  }
  function directory(canManageClients, records = restaurants, selectedRestaurantId = "") {
    const document = documentFixture({
      "client-search": "", "status-filter": "all", "client-grid": gridElement(),
      "record-count": { textContent: "" }, "stat-total": {}, "stat-active": {}, "stat-archived": {}, "stat-agents": {}
    });
    let selectionHidden = false;
    const api = evaluateFunctions(clientSource, ["getFilteredRestaurants", "renderStats", "renderRestaurants"], {
      document, restaurants: records, selectedRestaurantId, canManageClients, escapeHtml: String,
      clientMasterDetail: { setSelectionHidden(value) { selectionHidden = value; } },
      logoMarkup: (restaurant) => `logo:${restaurant.restaurantId}`, valueOrDash: String, statusBadge: String
    });
    return { document, api, selectionHidden: () => selectionHidden };
  }
  const characterized = directory(true);
  const search = characterized.document.getElementById("client-search");
  const status = characterized.document.getElementById("status-filter");
  const ids = () => plain(characterized.api.getFilteredRestaurants().map((record) => record.restaurantId));
  for (const [term, expected] of [
    ["brand needle", ["brand"]], ["phone needle", ["phone"]], ["owner needle", ["owner"]],
    ["account needle", ["account"]], ["manager needle", ["manager"]]
  ]) {
    search.value = term; status.value = "all";
    assert.deepEqual(ids(), expected);
  }
  search.value = "";
  for (const [filter, expected] of [
    ["all", ["brand", "phone", "owner", "account", "manager"]],
    ["active", ["brand", "owner", "account", "manager"]], ["inactive", ["phone"]]
  ]) {
    status.value = filter;
    assert.deepEqual(ids(), expected);
  }
  characterized.api.renderStats();
  assert.deepEqual(["stat-total", "stat-active", "stat-archived", "stat-agents"].map((id) => characterized.document.getElementById(id).textContent), [5, 4, 1, "0"]);
  status.value = "inactive";
  characterized.api.renderRestaurants();
  assert.equal(characterized.document.getElementById("record-count").textContent, "1 record");
  assert.match(characterized.document.getElementById("client-grid").innerHTML, /data-edit-id="phone"[\s\S]*data-archive-id="phone"/);
  search.value = "absent";
  characterized.api.renderRestaurants();
  assert.equal(characterized.document.getElementById("record-count").textContent, "0 records");
  assert.match(characterized.document.getElementById("client-grid").innerHTML, /No client profiles match this view/);

  const readOnly = directory(false, [restaurants[0]]);
  readOnly.api.renderRestaurants();
  assert.doesNotMatch(readOnly.document.getElementById("client-grid").innerHTML, /data-edit-id|data-archive-id|is-selected|aria-current/);
  readOnly.api.renderRestaurants();
  assert.doesNotMatch(readOnly.document.getElementById("client-grid").innerHTML, /is-selected|aria-current/, "rendering does not persist a selected-card state");
  const selected = directory(false, [restaurants[0]], "brand");
  selected.api.renderRestaurants();
  assert.match(selected.document.getElementById("client-grid").innerHTML, /is-selected[\s\S]*aria-current="true"[\s\S]*data-cc-master-item="brand"[\s\S]*client-select[\s\S]*aria-current="true"/);
  selected.document.getElementById("client-search").value = "absent";
  selected.api.renderRestaurants();
  assert.equal(selected.selectionHidden(), true, "filtering preserves valid selection ownership and reveals recovery notice");

  let restoredFocus = 0;
  const resetDocument = documentFixture({ "client-search": "hidden", "status-filter": "inactive" });
  resetDocument.querySelectorAll = () => [{
    dataset: { ccMasterItem: "brand" },
    querySelector: () => ({ focus() { restoredFocus += 1; } })
  }];
  const reset = evaluateFunctions(clientSource, ["resetClientFilters"], {
    document: resetDocument, selectedRestaurantId: "brand", renderRestaurants() {}
  });
  reset.resetClientFilters();
  assert.equal(resetDocument.getElementById("client-search").value, "");
  assert.equal(resetDocument.getElementById("status-filter").value, "all");
  assert.equal(restoredFocus, 1, "Clear Filters restores the selected directory trigger when visible");

  async function loadWith(result, search = "") {
    const document = documentFixture({
      "client-search": "", "status-filter": "all", "client-grid": gridElement(),
      "record-count": {}, "stat-total": {}, "stat-active": {}, "stat-archived": {}, "stat-agents": {}
    });
    let profileSelections = 0;
    let workspaceState = "";
    const api = evaluateFunctions(clientSource, ["getFilteredRestaurants", "renderStats", "renderRestaurants", "loadRestaurants"], {
      document, window: { location: { search } }, RESTAURANTS_ENDPOINT: "/restaurants", restaurants: [], selectedRestaurantId: "", workspaceRequestToken: 0, canManageClients: false,
      clientMasterDetail: { setSelectionHidden() {}, syncInitial() {}, isMobile: () => false },
      apiRequest: () => result, viewRestaurant: () => { profileSelections += 1; }, escapeHtml: String,
      logoMarkup: () => "logo", valueOrDash: String, statusBadge: String,
      renderEmptyWorkspace() { workspaceState = "empty"; }, renderUnavailableWorkspace() { workspaceState = "unavailable"; },
      renderWorkspaceError() { workspaceState = "error"; }
    });
    const pending = api.loadRestaurants();
    await flush();
    return { api, document, pending, selections: () => profileSelections, workspaceState: () => workspaceState };
  }
  const deferredLoad = deferred();
  const loading = await loadWith(deferredLoad.promise);
  assert.equal(loading.document.getElementById("client-grid").innerHTML, productionInitialGrid);
  assert.equal(loading.api.sandbox.workspaceRequestToken, 1, "directory reload invalidates pending workspace ownership immediately");
  deferredLoad.resolve({ restaurants: [] });
  await loading.pending;
  assert.match(loading.document.getElementById("client-grid").innerHTML, /No client profiles are available/);
  assert.equal(loading.document.getElementById("client-grid").dataset.state, "empty-collection");
  assert.deepEqual(["stat-total", "stat-active", "stat-archived", "stat-agents"].map((id) => loading.document.getElementById(id).textContent), [0, 0, 0, "0"]);
  assert.equal(loading.selections(), 0, "loading an empty collection performs no automatic selection");

  const populated = await loadWith(Promise.resolve({ restaurants }));
  await populated.pending;
  assert.match(populated.document.getElementById("client-grid").innerHTML, /Brand Needle[\s\S]*Manager Client/);
  assert.equal(populated.selections(), 0, "loading a populated collection performs no automatic selection");

  const failed = await loadWith(Promise.reject(new Error("directory offline")));
  await failed.pending;
  assert.match(failed.document.getElementById("client-grid").innerHTML, /data-state="error"[\s\S]*Client directory could not be loaded[\s\S]*directory offline/);
  assert.deepEqual(["stat-total", "stat-active", "stat-archived", "stat-agents"].map((id) => failed.document.getElementById(id).textContent), [0, 0, 0, "0"]);
  const failedRoute = await loadWith(Promise.reject(new Error("directory offline")), "?restaurantId=routed");
  await failedRoute.pending;
  assert.equal(failedRoute.workspaceState(), "error", "directory failure does not falsely classify a routed Client as missing");
});

test("Client inline workspace renders loading, populated, and generic error states without modal ownership", async () => {
  const profile = deferred();
  const harness = clientViewHarness({ getRestaurantProfile: () => profile.promise });
  const pending = harness.viewRestaurant("r1");
  await flush();
  assert.equal(harness.document.getElementById("client-workspace").innerHTML, "loading:r1");
  profile.resolve(restaurantFixture("r1", "Resolved Client"));
  await pending;
  assert.match(harness.document.getElementById("client-workspace").innerHTML, /data-cc-detail-focus>Resolved Client<[\s\S]*Brand Overview/);
  assert.doesNotMatch(clientSource, /id="profile-modal"|openModal\('profile-modal'\)/);

  const failed = clientViewHarness({ getRestaurantProfile: async () => { throw new Error("profile denied"); } });
  await failed.viewRestaurant("r1");
  assert.equal(failed.document.getElementById("client-workspace").innerHTML, "error:profile denied");
});

test("Client request ownership rejects stale primary success and stale primary error", async () => {
  const a = deferred();
  const b = deferred();
  const records = [restaurantFixture("A", "Obsolete A"), restaurantFixture("B", "Current B")];
  const harness = clientViewHarness({ restaurants: records, getRestaurantProfile: (id) => id === "A" ? a.promise : b.promise });
  const pendingA = harness.viewRestaurant("A");
  const pendingB = harness.viewRestaurant("B");
  b.resolve(restaurantFixture("B", "Current B"));
  await pendingB;
  assert.match(harness.document.getElementById("client-workspace").innerHTML, /Current B/);
  a.resolve(restaurantFixture("A", "Obsolete A"));
  await pendingA;
  assert.match(harness.document.getElementById("client-workspace").innerHTML, /Current B/);
  assert.doesNotMatch(harness.document.getElementById("client-workspace").innerHTML, /Obsolete A/);

  const staleError = deferred();
  const current = deferred();
  const errors = clientViewHarness({ restaurants: records, getRestaurantProfile: (id) => id === "A" ? staleError.promise : current.promise });
  const oldPending = errors.viewRestaurant("A");
  const currentPending = errors.viewRestaurant("B");
  current.resolve(restaurantFixture("B", "Current B"));
  await currentPending;
  staleError.reject(new Error("obsolete error"));
  await oldPending;
  assert.match(errors.document.getElementById("client-workspace").innerHTML, /Current B/);
  assert.doesNotMatch(errors.document.getElementById("client-workspace").innerHTML, /obsolete error/);
  assert.match(functionSource(clientSource, "viewRestaurant"), /requestToken !== workspaceRequestToken \|\| restaurantId !== selectedRestaurantId/);
});

test("Client request ownership rejects stale dependencies and Back invalidates pending work", async () => {
  const trainingA = deferred();
  const records = [restaurantFixture("A", "Client A"), restaurantFixture("B", "Client B")];
  const harness = clientViewHarness({
    restaurants: records,
    getRestaurantProfile: async (id) => records.find((record) => record.restaurantId === id),
    getRestaurantTraining: (id) => id === "A" ? trainingA.promise : Promise.resolve([{ employeeNameSnapshot: "Current Agent" }]),
    renderTrainingSection: (rows) => rows.map((row) => row.employeeNameSnapshot).join(',')
  });
  const pendingA = harness.viewRestaurant("A");
  await flush();
  const pendingB = harness.viewRestaurant("B");
  await pendingB;
  assert.match(harness.document.getElementById("client-workspace").innerHTML, /Client B[\s\S]*Current Agent/);
  trainingA.resolve([{ employeeNameSnapshot: "Obsolete Agent" }]);
  await pendingA;
  assert.doesNotMatch(harness.document.getElementById("client-workspace").innerHTML, /Obsolete Agent/);

  const ratingsA = deferred();
  const dependencyErrors = clientViewHarness({
    restaurants: records,
    getRestaurantProfile: async (id) => records.find((record) => record.restaurantId === id),
    getRestaurantRatings: (id) => id === "A" ? ratingsA.promise : Promise.resolve([])
  });
  const obsoleteDependency = dependencyErrors.viewRestaurant("A");
  await flush();
  await dependencyErrors.viewRestaurant("B");
  ratingsA.reject(new Error("obsolete ratings error"));
  await obsoleteDependency;
  assert.match(dependencyErrors.document.getElementById("client-workspace").innerHTML, /Client B/);
  assert.doesNotMatch(dependencyErrors.document.getElementById("client-workspace").innerHTML, /obsolete ratings error/);

  const profile = deferred();
  const back = clientViewHarness({ restaurants: [records[0]], getRestaurantProfile: () => profile.promise });
  const pending = back.viewRestaurant("A");
  await flush();
  await back.handleClientHistoryNavigation("");
  profile.resolve(records[0]);
  await pending;
  assert.equal(back.document.getElementById("client-workspace").innerHTML, "empty-selection");
  assert.equal(back.context.selectedRestaurantId, "");

  const archiveRequest = deferred();
  const archive = evaluateFunctions(clientSource, ["archiveRestaurant"], {
    canManageClients: true,
    restaurants: records,
    selectedRestaurantId: "A",
    workspaceRequestToken: 7,
    window: { CloudCrowdConfirmation: { request: async () => true } },
    RESTAURANTS_ENDPOINT: "/restaurants",
    apiRequest: () => archiveRequest.promise,
    showMessage() {},
    loadRestaurants: async () => {}
  });
  const archivedPending = archive.archiveRestaurant("A");
  await flush();
  assert.equal(archive.sandbox.workspaceRequestToken, 8, "archive invalidates pending workspace ownership before its request completes");
  archiveRequest.resolve({ ok: true });
  await archivedPending;
});

test("Client uses restrained announcements for success, partial detail, errors, and unavailable routes", async () => {
  const success = clientViewHarness({ getRestaurantProfile: async () => restaurantFixture("r1", "Complete Client") });
  await success.viewRestaurant("r1");
  assert.deepEqual(plain(success.events.filter(([type]) => type === "announce")), [["announce", "Complete Client details updated."]]);

  const partial = clientViewHarness({
    getRestaurantProfile: async () => restaurantFixture("r1", "Partial Client"),
    getClientDependencyAccess: async () => ({ training: "denied", quality: "unavailable", ratings: "allowed" })
  });
  await partial.viewRestaurant("r1");
  assert.deepEqual(plain(partial.events.filter(([type]) => type === "announce")), [["announce", "Partial Client details updated. Some linked modules are restricted or unavailable."]]);

  const events = [];
  const document = documentFixture({ "client-workspace": { innerHTML: "" } });
  const masterDetail = {
    renderState(settings) { events.push(["state", settings.state, settings.title, settings.role]); },
    announce(message) { events.push(["announce", message]); },
    showDetail() {}, setSelectionHidden() {}, isMobile: () => false
  };
  const states = evaluateFunctions(clientSource, ["renderWorkspaceError", "renderUnavailableWorkspace"], {
    document, selectedRestaurantId: "r1", clientMasterDetail: masterDetail, escapeHtml: String
  });
  states.renderWorkspaceError("network unavailable");
  states.renderUnavailableWorkspace("missing", "r1");
  assert.deepEqual(events, [
    ["state", "error", "Client profile could not be loaded", "alert"],
    ["state", "unavailable", "Client is unavailable", "alert"]
  ]);
  assert.doesNotMatch(clientSource.match(/id="client-workspace"[^>]*>/)[0], /aria-live/);
  assert.match(clientSource, /id="client-detail-announcement"[^>]*aria-live="polite"/);
});

test("Client primary workspace renderers execute one intentional semantic announcement path per state", async () => {
  const root = { dataset: {} };
  const list = { hidden: false, contains: () => false };
  const detail = { hidden: false, contains: () => false, innerHTML: "" };
  const announcement = { textContent: "" };
  const document = documentFixture({
    "client-workspace": detail,
    "client-detail-announcement": announcement
  });
  document.head = null;
  const sharedWindow = {
    document, window: null, matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout(callback) { callback(); }, addEventListener() {},
    location: { search: "" }
  };
  sharedWindow.window = sharedWindow;
  vm.runInNewContext(masterDetailSource, { window: sharedWindow });
  const controller = sharedWindow.CloudCrowdMasterDetail.create({
    root, list, detail, announcement,
    getListFallback: () => null, getDetailFocus: () => null
  });
  const renderers = evaluateFunctions(clientSource, [
    "renderEmptyWorkspace", "renderWorkspaceLoading", "renderWorkspaceError",
    "renderUnavailableWorkspace", "renderDependencyState"
  ], {
    document, window: sharedWindow, restaurants: [restaurantFixture("r1", "Semantic Client")],
    selectedRestaurantId: "r1", clientMasterDetail: controller, escapeHtml: String
  });

  renderers.renderWorkspaceLoading("r1");
  assert.match(detail.innerHTML, /class="client-workspace-loading" role="status" aria-busy="true" tabindex="-1" data-cc-detail-focus/);
  assert.match(detail.innerHTML, /<h2 class="cc-section-title">Loading Client profile<\/h2>/);

  renderers.renderEmptyWorkspace();
  assert.match(detail.innerHTML, /data-state="empty-selection" role="status"/);
  assert.match(detail.innerHTML, /<h2 class="cc-section-title" tabindex="-1" data-cc-detail-focus>Select a Client<\/h2>/);

  controller.announce("Previous populated detail announcement.");
  assert.equal(announcement.textContent, "Previous populated detail announcement.");
  renderers.renderWorkspaceError("network offline");
  assert.match(detail.innerHTML, /data-state="error" role="alert"/);
  assert.match(detail.innerHTML, /data-cc-detail-focus>Client profile could not be loaded<\/h2>/);
  assert.equal(announcement.textContent, "", "the alert state clears, rather than duplicates, the dedicated announcement");

  controller.announce("Previous populated detail announcement.");
  renderers.renderUnavailableWorkspace("missing", "r1");
  assert.match(detail.innerHTML, /data-state="unavailable" role="alert"/);
  assert.match(detail.innerHTML, /data-cc-detail-focus>Client is unavailable<\/h2>/);
  assert.equal(announcement.textContent, "", "the unavailable alert is the only announcement path for that transition");

  const initialState = clientSource.match(/<div class="cc-master-detail__state" data-state="empty-selection"[^>]*>/)[0];
  assert.match(initialState, /role="status"/);
  const workspaceTag = clientSource.match(/id="client-workspace"[^>]*>/)[0];
  assert.doesNotMatch(workspaceTag, /aria-live/);
  assert.match(clientSource, /id="client-detail-announcement"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.doesNotMatch(functionSource(clientSource, "renderWorkspaceError"), /\.announce\(/);
  assert.doesNotMatch(functionSource(clientSource, "renderUnavailableWorkspace"), /\.announce\(/);

  const populated = clientViewHarness({ getRestaurantProfile: async () => restaurantFixture("r1", "Quiet Populated Client") });
  await populated.viewRestaurant("r1");
  assert.doesNotMatch(populated.document.getElementById("client-workspace").innerHTML, /aria-live|role="(?:status|alert)"/);
  assert.match(renderers.renderDependencyState("Training", "denied"), /data-state="restricted" role="status"/);
  assert.match(renderers.renderDependencyState("Training", "unavailable"), /data-state="permission-unavailable" role="status"/);

  function requirePrimarySemanticContract(source) {
    assert.doesNotMatch(source.match(/id="client-workspace"[^>]*>/)[0], /aria-live/);
    assert.match(functionSource(source, "renderWorkspaceLoading"), /role="status"[\s\S]*aria-busy="true"/);
    assert.match(functionSource(source, "renderWorkspaceError"), /role: 'alert'/);
    assert.match(functionSource(source, "renderUnavailableWorkspace"), /role: 'alert'/);
    assert.doesNotMatch(functionSource(source, "renderWorkspaceError"), /\.announce\(/);
    assert.match(source, /id="client-detail-announcement"[^>]*aria-live="polite"/);
  }
  requirePrimarySemanticContract(clientSource);
  assert.throws(() => requirePrimarySemanticContract(clientSource.replace('id="client-workspace" aria-label=', 'id="client-workspace" aria-live="polite" aria-label=')));
  assert.throws(() => requirePrimarySemanticContract(clientSource.replace('role="status" aria-busy="true"', 'aria-busy="true"')));
  assert.throws(() => requirePrimarySemanticContract(clientSource.replace("role: 'alert',\n        eyebrow: 'Workspace error'", "eyebrow: 'Workspace error'")));
  assert.throws(() => requirePrimarySemanticContract(clientSource.replace(
    "document.getElementById('client-detail-announcement').textContent = '';",
    "clientMasterDetail?.announce('Client profile could not be loaded.');"
  )));
});

test("Client URL adapter preserves restaurantId and unavailable history navigation never substitutes", async () => {
  const replacements = [];
  const pushes = [];
  const window = {
    location: { href: "https://example.test/client-profiles.html?status=all#clients" },
    history: { state: {}, replaceState: (...args) => replacements.push(args), pushState: (...args) => pushes.push(args) }
  };
  const { updateClientUrl } = evaluateFunctions(clientSource, ["updateClientUrl"], { window });
  updateClientUrl("r 1");
  updateClientUrl("r 2", "push");
  updateClientUrl("");
  assert.equal(replacements[0][2], "/client-profiles.html?status=all&restaurantId=r+1#clients");
  assert.equal(pushes[0][2], "/client-profiles.html?status=all&restaurantId=r+2#clients");
  assert.equal(replacements[1][2], "/client-profiles.html?status=all#clients");

  const archived = { ...restaurantFixture("archived", "Archived"), status: "inactive" };
  const harness = clientViewHarness({ restaurants: [archived], getRestaurantProfile: async () => { throw new Error("must not request archived"); } });
  await harness.handleClientHistoryNavigation("archived");
  assert.equal(harness.context.selectedRestaurantId, "");
  assert.match(harness.document.getElementById("client-workspace").innerHTML, /unavailable:archived:[\s\S]*archived/);
  await harness.handleClientHistoryNavigation("missing");
  assert.equal(harness.context.selectedRestaurantId, "");
  assert.match(harness.document.getElementById("client-workspace").innerHTML, /unavailable:missing:[\s\S]*missing or inaccessible/);
});

test("Client history integration executes real adapters, onNavigate, ownership, Back, Forward, and unavailable routes", async () => {
  const records = [restaurantFixture("A", "Client A")];
  const desktop = integratedClientHistoryHarness({ mobile: false, restaurants: records });
  await desktop.api.viewRestaurant("A");
  assert.deepEqual(desktop.ids(), ["A"]);
  assert.deepEqual(desktop.writes.map(([mode, id]) => [mode, id]), [["replace", "A"]]);
  assert.match(desktop.detail.innerHTML, /Client A[\s\S]*Brand Overview/);
  assert.deepEqual(desktop.focus, ["item-A"], "desktop user selection focuses the connected replacement card");
  assert.equal(desktop.controller.getSelectedId(), "A");

  const mobile = integratedClientHistoryHarness({ mobile: true, restaurants: records });
  await mobile.api.viewRestaurant("A");
  assert.deepEqual(mobile.ids(), ["", "A"], "mobile selection establishes exactly [list, detail]");
  assert.deepEqual(mobile.writes.map(([mode, id]) => [mode, id]), [["replace", ""], ["push", "A"]]);
  assert.equal(mobile.currentState().ccMasterDetail.key, "client-profiles");
  assert.equal(mobile.currentState().ccMasterDetail.fromList, true);
  assert.match(mobile.detail.innerHTML, /Client A[\s\S]*Brand Overview/);
  assert.equal(mobile.focus.at(-1), "detail-heading");

  const tokenBeforeBack = mobile.api.sandbox.workspaceRequestToken;
  assert.equal(mobile.api.backToClientDirectory(), "history");
  await mobile.navigation();
  assert.deepEqual(mobile.ids(), ["", "A"], "Internal Back traverses owned history without creating another list entry");
  assert.equal(mobile.currentId(), "");
  assert.equal(mobile.api.sandbox.selectedRestaurantId, "");
  assert.ok(mobile.api.sandbox.workspaceRequestToken > tokenBeforeBack, "Internal Back invalidates pending workspace ownership");
  assert.match(mobile.detail.innerHTML, /data-state="empty-selection" role="status"[\s\S]*Select a Client/);
  assert.equal(mobile.focus.at(-1), "item-A", "Internal Back restores the valid originating card");

  await mobile.forward();
  assert.equal(mobile.currentId(), "A");
  assert.equal(mobile.api.sandbox.selectedRestaurantId, "A");
  assert.equal(mobile.controller.getSelectedId(), "A");
  assert.match(mobile.detail.innerHTML, /Client A[\s\S]*Brand Overview/);
  assert.deepEqual(mobile.profileCalls, ["A", "A"], "Browser Forward reaches the real Client onNavigate adapter and re-fetches the route");
  assert.equal(mobile.announcements.at(-1), "Client A details updated.");
  assert.equal(mobile.focus.at(-1), "detail-heading");

  await mobile.back();
  const staleProfile = deferred();
  mobile.setProfileResponder(() => staleProfile.promise);
  const staleForward = mobile.forward();
  await flush();
  assert.equal(mobile.currentId(), "A");
  await mobile.back();
  staleProfile.resolve(records[0]);
  await staleForward;
  assert.equal(mobile.currentId(), "");
  assert.equal(mobile.api.sandbox.selectedRestaurantId, "");
  assert.match(mobile.detail.innerHTML, /data-state="empty-selection"/);
  assert.doesNotMatch(mobile.detail.innerHTML, /Brand Overview/, "an old Forward result cannot repaint after later Back ownership");

  mobile.setProfileResponder(async (id) => records.find((record) => record.restaurantId === id));
  mobile.api.updateClientUrl("missing", "push", { ccMasterDetail: { key: "client-profiles", view: "detail", fromList: true } });
  await mobile.back();
  await mobile.forward();
  assert.equal(mobile.currentId(), "missing", "missing route remains present");
  assert.equal(mobile.api.sandbox.selectedRestaurantId, "");
  assert.equal(mobile.controller.getSelectedId(), "");
  assert.match(mobile.detail.innerHTML, /data-state="unavailable" role="alert"[\s\S]*Client is unavailable/);
  assert.doesNotMatch(mobile.detail.innerHTML, /Client A[\s\S]*Brand Overview/);

  const archived = { ...restaurantFixture("archived", "Archived Client"), status: "inactive" };
  const unavailable = integratedClientHistoryHarness({ mobile: true, restaurants: [records[0], archived] });
  unavailable.api.updateClientUrl("archived", "push", { ccMasterDetail: { key: "client-profiles", view: "detail", fromList: true } });
  await unavailable.back();
  await unavailable.forward();
  assert.equal(unavailable.currentId(), "archived");
  assert.equal(unavailable.api.sandbox.selectedRestaurantId, "");
  assert.match(unavailable.detail.innerHTML, /data-state="unavailable" role="alert"[\s\S]*archived/);
  assert.deepEqual(unavailable.profileCalls, [], "archived navigation never requests or substitutes a profile");

  const direct = integratedClientHistoryHarness({
    mobile: true, restaurants: records,
    initialUrl: "https://example.test/client-profiles.html?restaurantId=A"
  });
  await direct.api.viewRestaurant("A", { updateUrl: false, focusWorkspace: true, navigationSource: "direct" });
  assert.equal(direct.api.backToClientDirectory(), "replace");
  assert.deepEqual(direct.ids(), [""]);
  assert.equal(direct.currentId(), "");
  assert.equal(direct.currentState().ccMasterDetail.view, "list");
  assert.equal(direct.api.sandbox.selectedRestaurantId, "");

  const duplicateListMutation = masterDetailSource.replace(
    "writeHistory('', 'replace', historyMarker('list'), true)",
    "writeHistory('', 'push', historyMarker('list'), true)"
  );
  assert.notEqual(duplicateListMutation, masterDetailSource);
  await assert.rejects(async () => {
    const mutated = integratedClientHistoryHarness({ mobile: true, restaurants: records, masterSource: duplicateListMutation });
    await mutated.api.viewRestaurant("A");
    assert.deepEqual(mutated.ids(), ["", "A"], "single list entry invariant");
  }, /single list entry invariant/);

  const adapterSource = functionSource(clientSource, "updateClientUrl");
  const pushOnlyAdapterMutation = adapterSource.replace(
    "mode === 'push' ? 'pushState' : 'replaceState'",
    "'pushState'"
  );
  assert.notEqual(pushOnlyAdapterMutation, adapterSource);
  await assert.rejects(async () => {
    const mutated = integratedClientHistoryHarness({
      mobile: false, restaurants: records,
      clientOverrides: { updateClientUrl: pushOnlyAdapterMutation }
    });
    await mutated.api.viewRestaurant("A");
    assert.deepEqual(mutated.writes.map(([mode, id]) => [mode, id]), [["replace", "A"]], "desktop Client adapter replacement invariant");
  }, /desktop Client adapter replacement invariant/);
});

test("Client Training renderer executes success, empty, error, metrics, ordering, and six-row limit", () => {
  const api = evaluateFunctions(clientSource, ["renderTrainingSection"], {
    escapeHtml: String,
    trainingStatusBadge: String
  });
  assert.match(api.renderTrainingSection([], ""), /data-state="empty"[\s\S]*No assigned agents/);
  assert.match(api.renderTrainingSection([], "403 Forbidden"), /data-state="error"[\s\S]*403 Forbidden/);
  const records = Array.from({ length: 7 }, (_, index) => ({
    employeeNameSnapshot: `Agent-${index}`,
    assignmentStatus: "Assigned",
    trainingStatus: index < 4 ? "Trained" : "Not Trained",
    trainingDate: `2026-08-0${index + 1}`,
    notes: ""
  }));
  const output = api.renderTrainingSection(records, "");
  assert.match(output, /Assigned Agents<\/span><strong>7[\s\S]*Trained<\/span><strong>4[\s\S]*Training Completion<\/span><strong>57%/);
  assert.equal((output.match(/Agent-\d/g) || []).length, 6);
  assert.match(output, /Agent-6/);
  assert.doesNotMatch(output, /Agent-0/);
});

test("Client Weekly Quality executes ID-first/legacy matching, metrics, ordering, weak areas, and five-row limit", () => {
  const local = [
    { id: "wrong", restaurantId: "other", restaurantNameSnapshot: "North" },
    { id: "legacy", restaurantNameSnapshot: " north " },
    { id: "id", restaurantId: "r1", restaurantNameSnapshot: "Other" }
  ];
  const names = [
    "normalizeName", "getQualityRestaurantName", "getQualityAgentName", "getQualityAuditorName", "getQualityDateTime",
    "getQualityScore", "getQualityTotal", "formatScore", "qualitySortTime", "readWeeklyQualityRecords",
    "getClientQualityRecords", "renderQualityDetails", "renderQualityPerformanceSection", "renderWeakAreasSection"
  ];
  const api = evaluateFunctions(clientSource, names, {
    localStorage: { getItem: () => JSON.stringify(local) }, WEEKLY_QUALITY_STORAGE_KEY: "quality",
    QUALITY_SCORE_FIELDS: QUALITY_FIELDS, QUALITY_SCORE_LABELS: QUALITY_LABELS, escapeHtml: String
  });
  assert.deepEqual(plain(api.getClientQualityRecords({ restaurantId: "r1", brandName: "North" }).map((record) => record.id)), ["legacy", "id"]);
  const records = Array.from({ length: 6 }, (_, index) => ({
    createdAt: `2026-08-0${index + 1}T10:00:00Z`, callDateTime: `2026-08-0${index + 1} 10:00:00`,
    agentNameSnapshot: `Agent-${index}`, auditorNameSnapshot: `Auditor-${index}`, totalScore: 50 + index * 10,
    scores: Object.fromEntries(QUALITY_FIELDS.map((field, fieldIndex) => [field, index + fieldIndex]))
  }));
  const output = api.renderQualityPerformanceSection(records);
  assert.match(output, /Average Quality Score<\/span><strong>75%[\s\S]*Best Score<\/span><strong>100%[\s\S]*Worst Score<\/span><strong>50%[\s\S]*Total Evaluations<\/span><strong>6/);
  assert.equal((output.match(/<td>Agent-\d<\/td>/g) || []).length, 5);
  assert.match(output, /Agent-5/);
  assert.doesNotMatch(output, /Agent-0/);
  const weak = api.renderWeakAreasSection(records);
  assert.equal((weak.match(/class="weak-item"/g) || []).length, 3);
  assert.match(api.renderQualityPerformanceSection([]), /data-state="empty"/);

  const matchingSource = functionSource(clientSource, "getClientQualityRecords");
  assert.ok(matchingSource.indexOf("if (restaurantId && recordRestaurantId)") < matchingSource.indexOf("normalizeName(getQualityRestaurantName"));
});

test("Client Restaurant Ratings executes success, empty, error, latest metrics, ordering, and five-row limit", () => {
  const api = evaluateFunctions(clientSource, ["formatRating", "ratingSortTime", "latestRatingByPlatform", "ratingValue", "renderDeliveryRatingsSection"], {
    escapeHtml: String
  });
  assert.match(api.renderDeliveryRatingsSection([], ""), /data-state="empty"/);
  assert.match(api.renderDeliveryRatingsSection([], "403 Forbidden"), /data-state="error"[\s\S]*403 Forbidden/);
  const records = Array.from({ length: 6 }, (_, index) => ({
    platform: index % 2 ? "Careem" : "Talabat", rating: 3 + index / 10,
    monthName: "August", weekName: `Week-${index}`, ratingDate: `2026-08-0${index + 1}`,
    reviewsCount: index, notes: `Rating-${index}`
  }));
  const output = api.renderDeliveryRatingsSection(records, "");
  assert.match(output, /Latest Talabat Rating[\s\S]*3\.40[\s\S]*Latest Careem Rating[\s\S]*3\.50[\s\S]*Average Latest Rating[\s\S]*3\.45/);
  assert.equal((output.match(/Rating-\d/g) || []).length, 5);
  assert.match(output, /Rating-5/);
  assert.doesNotMatch(output, /Rating-0/);
});

test("Client integration adapters propagate dependency 403 and permit only non-authorization Quality fallback", async () => {
  const request = evaluateFunctions(clientSource, ["apiRequest"], {
    fetch: async () => ({ status: 403, ok: false, json: async () => ({ error: "neutral denial" }) }),
    authHeaders: (headers) => headers,
    logout() {}
  });
  await assert.rejects(request.apiRequest("/protected"), (error) => error.message === "neutral denial" && error.status === 403);

  for (const [name, key, endpoint] of [
    ["getRestaurantTraining", "training", "TRAINING_ENDPOINT"],
    ["getRestaurantRatings", "ratings", "RESTAURANT_RATINGS_ENDPOINT"]
  ]) {
    let responder = async () => ({ [key]: [{ id: key }] });
    const context = { apiRequest: async () => responder(), [endpoint]: `/${key}` };
    const fn = evaluateFunctions(clientSource, [name], context)[name];
    assert.deepEqual(plain(await fn("r 1")), [{ id: key }]);
    responder = async () => ({ [key]: null });
    assert.deepEqual(plain(await fn("r1")), []);
    responder = async () => { throw new Error("403 Forbidden"); };
    await assert.rejects(fn("r1"), /403 Forbidden/);
  }

  const local = [{ restaurantId: "r1", totalScore: 77 }];
  const api = evaluateFunctions(clientSource, [
    "normalizeName", "getQualityRestaurantName", "readWeeklyQualityRecords", "getClientQualityRecords",
    "isPermissionDenied", "getClientQualityRecordsFromApi", "loadClientQualityRecords"
  ], {
    WEEKLY_QUALITY_ENDPOINT: "/quality", WEEKLY_QUALITY_STORAGE_KEY: "quality",
    localStorage: { getItem: () => JSON.stringify(local) },
    apiRequest: async () => { const error = new Error("neutral denial"); error.status = 403; throw error; },
    console: { warn() {} }
  });
  await assert.rejects(api.loadClientQualityRecords(restaurantFixture("r1", "North")), /neutral denial/);

  api.sandbox.apiRequest = async () => { throw new Error("network offline"); };
  const result = await api.loadClientQualityRecords(restaurantFixture("r1", "North"));
  assert.deepEqual(plain(result.records), local);
  assert.equal(result.error, "network offline");
  assert.equal(result.degraded, true);
});

test("Client Weekly Quality lifecycle preserves compatible fallback but suppresses authorization failures", async () => {
  function qualityApi(responder, localRecords = []) {
    const calls = [];
    const api = evaluateFunctions(clientSource, [
      "normalizeName", "getQualityRestaurantName", "readWeeklyQualityRecords", "getClientQualityRecords",
      "isPermissionDenied", "getClientQualityRecordsFromApi", "loadClientQualityRecords"
    ], {
      WEEKLY_QUALITY_ENDPOINT: "/quality", WEEKLY_QUALITY_STORAGE_KEY: "quality",
      localStorage: { getItem: () => JSON.stringify(localRecords) },
      apiRequest: async (url) => { calls.push(url); return responder(); }, console: { warn() {} }
    });
    return { api, calls };
  }
  const restaurant = restaurantFixture("r 1", "Unique Legacy");
  const success = qualityApi(() => ({ records: [{ id: "api", restaurantId: "r 1" }] }));
  assert.deepEqual(plain(await success.api.getClientQualityRecordsFromApi("r 1")), [{ id: "api", restaurantId: "r 1" }]);
  assert.equal(success.calls[0], "/quality?restaurantId=r%201");
  const successLoad = await success.api.loadClientQualityRecords(restaurant);
  assert.deepEqual(plain(successLoad), { records: [{ id: "api", restaurantId: "r 1" }], error: "", degraded: false });

  const empty = qualityApi(() => ({ records: [] }), [{ id: "must-not-fallback", restaurantId: "r 1" }]);
  assert.deepEqual(plain(await empty.api.loadClientQualityRecords(restaurant)), { records: [], error: "", degraded: false });

  for (const message of ["network offline", "service unavailable"]) {
    const local = [
      { id: "wrong-id", restaurantId: "other", restaurantNameSnapshot: "Unique Legacy" },
      { id: "legacy", restaurantNameSnapshot: " unique legacy " },
      { id: "id-first", restaurantId: "r 1", restaurantNameSnapshot: "Different" }
    ];
    const failed = qualityApi(() => { throw new Error(message); }, local);
    const result = await failed.api.loadClientQualityRecords(restaurant);
    assert.deepEqual(plain(result.records.map((record) => record.id)), ["legacy", "id-first"]);
    assert.equal(result.error, message);
    assert.equal(result.degraded, true);
  }
  const denied = qualityApi(() => { const error = new Error("neutral authorization failure"); error.status = 403; throw error; }, [{ id: "must-not-leak", restaurantId: "r 1" }]);
  await assert.rejects(denied.api.loadClientQualityRecords(restaurant), /neutral authorization failure/);
});

test("Client HTTP 401 preserves status and fails closed before Weekly Quality compatibility data can render", async () => {
  const names = [
    "apiRequest", "normalizeName", "getQualityRestaurantName", "readWeeklyQualityRecords",
    "getClientQualityRecords", "isPermissionDenied", "getClientQualityRecordsFromApi", "loadClientQualityRecords"
  ];
  function httpLifecycle(response, localRecords = [], overrides = {}) {
    let logoutCalls = 0;
    let fallbackReads = 0;
    const api = evaluateFunctions(clientSource, names, {
      fetch: async () => response,
      authHeaders: (headers) => headers,
      logout: () => { logoutCalls += 1; },
      WEEKLY_QUALITY_ENDPOINT: "/quality", WEEKLY_QUALITY_STORAGE_KEY: "quality",
      localStorage: { getItem: () => { fallbackReads += 1; return JSON.stringify(localRecords); } },
      console: { warn() {} }
    }, overrides);
    return { api, logoutCalls: () => logoutCalls, fallbackReads: () => fallbackReads };
  }
  async function capture(promise) {
    try { return { value: await promise, error: null }; }
    catch (error) { return { value: undefined, error }; }
  }
  const restaurant = restaurantFixture("r1", "Secret Client");
  const cached = [{
    id: "cached-secret", restaurantId: "r1", totalScore: 99,
    callDateTime: "2026-08-13", campaignName: "Secret Campaign", agentName: "Secret Agent"
  }];

  const unauthorized = httpLifecycle({
    status: 401, ok: false, json: async () => ({ error: "neutral response" })
  }, cached);
  const unauthorizedResult = await capture(unauthorized.api.loadClientQualityRecords(restaurant));
  assert.equal(unauthorized.logoutCalls(), 1);
  assert.equal(unauthorizedResult.error?.message, "Session expired");
  assert.equal(unauthorizedResult.error?.status, 401);
  assert.equal(unauthorizedResult.value, undefined, "401 never returns a degraded compatibility result");
  assert.equal(unauthorized.fallbackReads(), 0, "401 never calls the local fallback accessor");

  const rendered = clientViewHarness({
    getRestaurantProfile: async () => restaurant,
    loadClientQualityRecords: unauthorized.api.loadClientQualityRecords,
    isPermissionDenied: unauthorized.api.isPermissionDenied
  });
  await rendered.viewRestaurant("r1");
  const renderedOutput = rendered.document.getElementById("client-workspace").innerHTML;
  assert.match(renderedOutput, /data-module-permission="weekly_quality" data-state="restricted"/);
  assert.doesNotMatch(renderedOutput, /cached-secret|99|2026-08-13|Secret Campaign|Secret Agent|local browser records|fallback/i);
  assert.equal(unauthorized.fallbackReads(), 0);

  const forbidden = httpLifecycle({
    status: 403, ok: false, json: async () => ({ error: "neutral response" })
  }, cached);
  const forbiddenResult = await capture(forbidden.api.loadClientQualityRecords(restaurant));
  assert.equal(forbiddenResult.error?.status, 403);
  assert.equal(forbidden.fallbackReads(), 0);

  let wordingFallbackReads = 0;
  const wording = evaluateFunctions(clientSource, [
    "normalizeName", "getQualityRestaurantName", "readWeeklyQualityRecords", "getClientQualityRecords",
    "isPermissionDenied", "getClientQualityRecordsFromApi", "loadClientQualityRecords"
  ], {
    WEEKLY_QUALITY_ENDPOINT: "/quality", WEEKLY_QUALITY_STORAGE_KEY: "quality",
    localStorage: { getItem: () => { wordingFallbackReads += 1; return JSON.stringify(cached); } },
    apiRequest: async () => { throw new Error("not authorized to view Weekly Quality"); },
    console: { warn() {} }
  });
  await assert.rejects(wording.loadClientQualityRecords(restaurant), /not authorized/);
  assert.equal(wordingFallbackReads, 0, "authorization wording remains fail-closed without a numeric status");

  const fallbackRecords = [
    { id: "wrong-id", restaurantId: "other", restaurantNameSnapshot: "Secret Client" },
    { id: "legacy", restaurantNameSnapshot: " secret client " },
    { id: "id-first", restaurantId: "r1", restaurantNameSnapshot: "Other Name" }
  ];
  const serviceFailure = httpLifecycle({
    status: 503, ok: false, json: async () => ({ error: "neutral service failure" })
  }, fallbackRecords);
  const degraded = await serviceFailure.api.loadClientQualityRecords(restaurant);
  assert.deepEqual(plain(degraded.records.map((record) => record.id)), ["legacy", "id-first"]);
  assert.equal(degraded.error, "neutral service failure");
  assert.equal(degraded.degraded, true);
  assert.equal(serviceFailure.fallbackReads(), 1);

  for (const records of [[{ id: "api", restaurantId: "r1" }], []]) {
    const success = httpLifecycle({ status: 200, ok: true, json: async () => ({ records }) }, cached);
    assert.deepEqual(plain(await success.api.loadClientQualityRecords(restaurant)), { records, error: "", degraded: false });
    assert.equal(success.fallbackReads(), 0, "successful and authoritative-empty responses never read fallback");
  }

  async function require401FailClosed(overrides = {}) {
    const lifecycle = httpLifecycle({ status: 401, ok: false, json: async () => ({ error: "neutral" }) }, cached, overrides);
    const result = await capture(lifecycle.api.loadClientQualityRecords(restaurant));
    assert.ok(result.error, "401 must reject rather than return cached data");
    assert.equal(result.error.status, 401, "401 status must survive apiRequest");
    assert.equal(result.value, undefined);
    assert.equal(lifecycle.fallbackReads(), 0, "401 must not reach local fallback");
  }
  await require401FailClosed();
  const apiRequestSource = functionSource(clientSource, "apiRequest");
  const discardedStatusMutation = apiRequestSource.replace(
    "const error = new Error('Session expired');\n        error.status = response.status;\n        throw error;",
    "throw new Error('Session expired');"
  );
  assert.notEqual(discardedStatusMutation, apiRequestSource);
  await assert.rejects(() => require401FailClosed({ apiRequest: discardedStatusMutation }), /401 status must survive apiRequest/);

  const classifierSource = functionSource(clientSource, "isPermissionDenied");
  const fallbackLeakMutation = classifierSource.replace(
    "[401, 403].includes(Number(error?.status)) || /(?:^|\\b)(?:401|403)(?:\\b|$)|unauthorized|session expired|forbidden|not authorized|permission denied/i",
    "Number(error?.status) === 403 || /(?:^|\\b)403(?:\\b|$)|forbidden|not authorized|permission denied/i"
  );
  assert.notEqual(fallbackLeakMutation, classifierSource);
  await assert.rejects(() => require401FailClosed({ isPermissionDenied: fallbackLeakMutation }), /401 must reject rather than return cached data/);
});

test("Client Profile isolates dependency 403 states without exposing Quality fallback", async () => {
  const harness = clientViewHarness({
    getRestaurantProfile: async () => restaurantFixture("r1", "Restricted Client"),
    getRestaurantTraining: async () => { throw new Error("403 Training"); },
    getRestaurantRatings: async () => { throw new Error("403 Ratings"); },
    loadClientQualityRecords: async () => { const error = new Error("neutral Quality denial"); error.status = 403; throw error; }
  });
  await harness.viewRestaurant("r1");
  const output = harness.document.getElementById("client-workspace").innerHTML;
  assert.match(output, /data-module-permission="agent_training" data-state="restricted"/);
  assert.match(output, /data-module-permission="restaurant_ratings" data-state="restricted"/);
  assert.match(output, /data-module-permission="weekly_quality" data-state="restricted"/);
  assert.doesNotMatch(output, /91|local browser records|neutral Quality denial/);
});

test("Employee and Client enforce independent dependency permissions with strict Client tri-state ownership", async () => {
  const moduleKeys = ["attendance", "weekly_quality", "agent_training", "employee_deductions", "restaurant_ratings"];
  for (const key of moduleKeys) assert.match(appShellSource, new RegExp(`permissionKey: '${key}'`));
  const permissionHookPattern = /data-permission(?:-view)?(?:\s|=)|data-module-permission|aria-hidden|\shidden(?:\s|=|>)/;
  function requireIndependentGap(source, functionName, panelScopes) {
    assert.doesNotMatch(functionSource(source, functionName), /CCPermissions\.(?:getMyAccess|getModuleAccess)|data-permission-view/);
    for (const scope of panelScopes) {
      const responsibleTags = [...scope.matchAll(/<(?:section|article)\b[^>]*>/g)].map((match) => match[0]);
      assert.ok(responsibleTags.length, "Expected responsible dependency panel tags");
      for (const tag of responsibleTags) assert.doesNotMatch(tag, permissionHookPattern);
    }
  }
  function requireEmployeePermissionContract(source, panelScope) {
    const selection = functionSource(source, "selectEmployee");
    assert.match(selection, /getEmployeeDependencyAccess\(\)/);
    for (const permission of ["quality", "attendance", "deductions", "training"]) {
      assert.match(selection, new RegExp(`dependencyAccess\\.${permission} === 'allowed'`));
    }
    for (const key of ["attendance", "weekly_quality", "agent_training", "employee_deductions"]) {
      assert.match(panelScope, new RegExp(`data-module-permission="${key}"`));
    }
  }

  const employeeDocument = documentFixture({ "employee-workspace": { innerHTML: "initial" } });
  const employeeVisibilitySelectors = [];
  employeeDocument.querySelectorAll = (selector) => { employeeVisibilitySelectors.push(selector); return []; };
  const employeeWindow = await permissionRuntimeFixture(
    "employee_profiles", ["attendance", "weekly_quality", "agent_training", "employee_deductions"], employeeDocument
  );
  for (const key of ["attendance", "weekly_quality", "agent_training", "employee_deductions"]) {
    assert.equal((await employeeWindow.CCPermissions.getMyAccess(key)).canView, false);
  }
  const employeePermissionLookups = [];
  const employeeGetMyAccess = employeeWindow.CCPermissions.getMyAccess.bind(employeeWindow.CCPermissions);
  employeeWindow.CCPermissions.getMyAccess = (...args) => { employeePermissionLookups.push(args[0]); return employeeGetMyAccess(...args); };
  const employeeCalls = [];
  const employee = employeeFixture("e1", "Restricted Employee");
  const employeeAccess = evaluateFunctions(employeeSource, ["getEmployeeDependencyAccess"], {
    window: employeeWindow, dependencyAccessPromise: null,
    EMPLOYEE_DEPENDENCY_KEYS: { attendance: "attendance", training: "agent_training", deductions: "employee_deductions", quality: "weekly_quality" }
  });
  const employeeHarness = employeeSelectionHarness({
    document: employeeDocument, window: employeeWindow,
    employees: [employee], getEmployeeProfile: async () => employee,
    getEmployeeDependencyAccess: employeeAccess.getEmployeeDependencyAccess,
    getEmployeeQualityRecords: async () => { employeeCalls.push("weekly_quality"); throw new Error("403 quality"); },
    getStoredQualityRecords: () => [{ totalScore: 91, callDateTime: "2026-08-11" }],
    getEmployeeAttendance: async () => { employeeCalls.push("attendance"); throw new Error("403 attendance"); },
    getStoredAttendanceRecords: () => [{ date: "2026-08-11" }],
    getEmployeeTraining: async () => { employeeCalls.push("agent_training"); throw new Error("403 training"); },
    getEmployeeDeductions: async () => { employeeCalls.push("employee_deductions"); throw new Error("403 deductions"); }
  });
  await employeeHarness.selectEmployee("e1");
  assert.deepEqual(employeeCalls, [], "denied Employee dependencies are not requested");
  assert.deepEqual(employeePermissionLookups, ["attendance", "agent_training", "employee_deductions", "weekly_quality"]);
  assert.equal(employeeHarness.context.window, employeeWindow);
  assert.equal(employeeHarness.document, employeeDocument);
  assert.ok(employeeVisibilitySelectors.includes("[data-permission-create]"));
  assert.ok(employeeVisibilitySelectors.includes("[data-permission-edit]"));
  assert.ok(employeeVisibilitySelectors.includes("[data-permission-delete]"));
  const employeeOutput = employeeHarness.document.getElementById("employee-workspace").innerHTML;
  assert.doesNotMatch(employeeOutput, /Browser fallback|91%|2026-08-11/);
  assert.match(employeeOutput, /Attendance[\s\S]*Restricted/);
  assert.match(employeeOutput, /Weekly Quality[\s\S]*Restricted/);
  assert.match(employeeOutput, /Training[\s\S]*Restricted/);
  assert.match(employeeOutput, /Deductions[\s\S]*Restricted/);
  const employeePanelScope = employeeOutput.match(/<section class="workspace-modules-section"[\s\S]*?<\/section>/)[0];
  requireEmployeePermissionContract(employeeSource, employeePanelScope);

  const dependencySource = functionSource(employeeSource, "getEmployeeDependencyAccess");
  async function requireFailClosedPermissions(accessSource = dependencySource) {
    const lookups = [];
    const access = evaluateFunctions(employeeSource, ["getEmployeeDependencyAccess"], {
      window: { CCPermissions: { getMyAccess: async (key) => {
        lookups.push(key);
        if (key === "attendance") throw new Error("permission service offline");
        if (key === "agent_training") return { canView: false };
        if (key === "employee_deductions") return { canView: true };
        return {};
      } } },
      dependencyAccessPromise: null,
      EMPLOYEE_DEPENDENCY_KEYS: { attendance: "attendance", training: "agent_training", deductions: "employee_deductions", quality: "weekly_quality" }
    }, { getEmployeeDependencyAccess: accessSource });
    const result = await access.getEmployeeDependencyAccess();
    assert.deepEqual(plain(result), {
      attendance: "unavailable", training: "denied", deductions: "allowed", quality: "unavailable"
    }, "Only explicit boolean true may authorize a dependency");
    return { result, lookups };
  }
  const mixedAccess = await requireFailClosedPermissions();
  const mixedResult = mixedAccess.result;
  const mixedLookups = mixedAccess.lookups;
  const mixedCalls = [];
  const mixedHarness = employeeSelectionHarness({
    employees: [employee], getEmployeeProfile: async () => employee,
    getEmployeeDependencyAccess: async () => mixedResult,
    getEmployeeAttendance: async () => { mixedCalls.push("attendance"); return []; },
    getEmployeeTraining: async () => { mixedCalls.push("agent_training"); return []; },
    getEmployeeDeductions: async () => { mixedCalls.push("employee_deductions"); return []; },
    getEmployeeQualityRecords: async () => { mixedCalls.push("weekly_quality"); return []; },
    getStoredAttendanceRecords: () => [{ note: "must-not-leak" }],
    getStoredQualityRecords: () => [{ totalScore: 99, note: "must-not-leak" }]
  });
  await mixedHarness.selectEmployee("e1");
  assert.deepEqual(mixedCalls, ["employee_deductions"]);
  const mixedOutput = mixedHarness.document.getElementById("employee-workspace").innerHTML;
  assert.match(mixedOutput, /Restricted Employee/);
  assert.match(mixedOutput, /Attendance[\s\S]*Permission unavailable/);
  assert.match(mixedOutput, /Training[\s\S]*Restricted/);
  assert.match(mixedOutput, /Weekly Quality[\s\S]*Permission unavailable/);
  assert.match(mixedOutput, /data-module-permission="attendance" data-state="permission-unavailable"/);
  assert.match(mixedOutput, /data-module-permission="agent_training" data-state="restricted"/);
  assert.match(mixedOutput, /data-module-permission="weekly_quality" data-state="permission-unavailable"/);
  assert.match(mixedOutput, /data-module-permission="employee_deductions" data-state="empty"/);
  assert.doesNotMatch(mixedOutput, /must-not-leak|99%/);
  assert.deepEqual(mixedLookups, ["attendance", "agent_training", "employee_deductions", "weekly_quality"]);
  const permissiveMutation = dependencySource.replace(
    "access?.canView === true\n              ? 'allowed'\n              : access?.canView === false\n                ? 'denied'\n                : 'unavailable'",
    "access?.canView === false ? 'denied' : 'allowed'"
  );
  assert.notEqual(permissiveMutation, dependencySource, "Mutation must restore the fail-open policy");
  await assert.rejects(() => requireFailClosedPermissions(permissiveMutation), /Only explicit boolean true may authorize a dependency/);

  const clientDocument = documentFixture({ "client-workspace": { innerHTML: "" } });
  const clientVisibilitySelectors = [];
  clientDocument.querySelectorAll = (selector) => { clientVisibilitySelectors.push(selector); return []; };
  const clientWindow = await permissionRuntimeFixture(
    "client_profiles", ["agent_training", "weekly_quality", "restaurant_ratings"], clientDocument
  );
  for (const key of ["agent_training", "weekly_quality", "restaurant_ratings"]) {
    assert.equal((await clientWindow.CCPermissions.getMyAccess(key)).canView, false);
  }
  const clientPermissionLookups = [];
  const clientGetMyAccess = clientWindow.CCPermissions.getMyAccess.bind(clientWindow.CCPermissions);
  clientWindow.CCPermissions.getMyAccess = (...args) => { clientPermissionLookups.push(args[0]); return clientGetMyAccess(...args); };
  const renderers = evaluateFunctions(clientSource, [
    "getQualityAgentName", "getQualityAuditorName", "getQualityDateTime", "getQualityScore", "getQualityTotal",
    "formatScore", "formatRating", "ratingSortTime", "latestRatingByPlatform", "ratingValue", "qualitySortTime",
    "renderQualityDetails", "renderTrainingSection", "renderQualityPerformanceSection", "renderWeakAreasSection",
    "renderDependencyState", "renderQualityFallbackNotice", "renderDeliveryRatingsSection"
  ], {
    QUALITY_SCORE_FIELDS: QUALITY_FIELDS, QUALITY_SCORE_LABELS: QUALITY_LABELS,
    escapeHtml: String, trainingStatusBadge: String
  });
  const clientCalls = [];
  const clientHarness = clientViewHarness({
    document: clientDocument, window: clientWindow,
    getRestaurantProfile: async () => restaurantFixture("r1", "Restricted Client"),
    getClientDependencyAccess: async () => ({ training: "denied", quality: "denied", ratings: "denied" }),
    getRestaurantTraining: async () => { clientCalls.push("agent_training"); throw new Error("403 training"); },
    getRestaurantRatings: async () => { clientCalls.push("restaurant_ratings"); throw new Error("403 ratings"); },
    loadClientQualityRecords: async () => { clientCalls.push("weekly_quality"); return { records: [{ totalScore: 93, createdAt: "2026-08-11" }], error: "403 quality", degraded: true }; },
    renderTrainingSection: renderers.renderTrainingSection,
    renderDeliveryRatingsSection: renderers.renderDeliveryRatingsSection,
    renderDependencyState: renderers.renderDependencyState,
    renderQualityFallbackNotice: renderers.renderQualityFallbackNotice,
    renderQualityPerformanceSection: renderers.renderQualityPerformanceSection,
    renderWeakAreasSection: renderers.renderWeakAreasSection
  });
  await clientHarness.viewRestaurant("r1");
  clientWindow.CCPermissions.applyPermissionVisibility(clientWindow.CC_PAGE_ACCESS);
  assert.deepEqual(clientCalls, [], "denied Client dependencies are not requested");
  assert.equal(clientHarness.document, clientDocument);
  assert.ok(clientVisibilitySelectors.includes("[data-permission-create]"));
  assert.ok(clientVisibilitySelectors.includes("[data-permission-edit]"));
  assert.ok(clientVisibilitySelectors.includes("[data-permission-delete]"));
  const clientOutput = clientHarness.document.getElementById("client-workspace").innerHTML;
  for (const key of ["agent_training", "weekly_quality", "restaurant_ratings"]) {
    assert.match(clientOutput, new RegExp(`data-module-permission="${key}" data-state="restricted"`));
  }
  assert.doesNotMatch(clientOutput, /93%|local browser records|403 quality/);

  async function clientAccessResult(accessByKey) {
    const access = evaluateFunctions(clientSource, ["getClientDependencyAccess"], {
      window: { CCPermissions: { getMyAccess: async (key) => {
        const result = accessByKey[key];
        if (result instanceof Error) throw result;
        return result;
      } } }, dependencyAccessPromise: null,
      CLIENT_DEPENDENCY_KEYS: { training: "agent_training", quality: "weekly_quality", ratings: "restaurant_ratings" }
    });
    return plain(await access.getClientDependencyAccess());
  }
  assert.deepEqual(await clientAccessResult({
    agent_training: { canView: true, legacyFallback: false },
    weekly_quality: { canView: false, legacyFallback: false },
    restaurant_ratings: { canView: true, legacyFallback: true }
  }), { training: "allowed", quality: "denied", ratings: "unavailable" });
  assert.deepEqual(await clientAccessResult({
    agent_training: null,
    weekly_quality: { canView: "yes" },
    restaurant_ratings: new Error("permission service offline")
  }), { training: "unavailable", quality: "unavailable", ratings: "unavailable" });
  assert.match(functionSource(clientSource, "viewRestaurant"), /dependencyAccess\.training === 'allowed'[\s\S]*dependencyAccess\.ratings === 'allowed'[\s\S]*dependencyAccess\.quality === 'allowed'/);

  assert.throws(() => requireEmployeePermissionContract(
    employeeSource.replace(/dependencyAccess\.attendance === 'allowed'/g, "true"), employeePanelScope
  ));
  assert.throws(() => requireEmployeePermissionContract(
    employeeSource, employeePanelScope.replace('data-module-permission="attendance"', 'data-domain="attendance"')
  ));
});

test("Client planned modules render labels and non-interactive Coming soon cards", async () => {
  const harness = clientViewHarness({ getRestaurantProfile: async () => restaurantFixture("r1", "Planned Client") });
  await harness.viewRestaurant("r1");
  const output = harness.document.getElementById("client-workspace").innerHTML;
  const scope = output.match(/<section class="detail-section">\s*<h3>Future Modules<\/h3>([\s\S]*?)<\/section>/)[1];
  for (const label of ["Complaints", "Free Orders", "Call Queue"]) assert.match(scope, new RegExp(`<strong>${label}</strong>[\\s\\S]*<span>Coming soon</span>`));
  assert.equal((scope.match(/cc-planned-card/g) || []).length, 3);
  assert.doesNotMatch(scope, /<(?:a|button)\b|href=|data-(?:view|edit|manage)-id/);
});

test("Client logo render, validation, edit preview, and isolated removal handler execute", async () => {
  class FileReader {
    readAsDataURL() { this.result = "data:image/png;base64,AA=="; this.onload(); }
  }
  const document = documentFixture({
    "brand-name": { value: "Cloud Cafe" }, "logo-upload": { value: "selected.png" },
    "logo-url": { value: "" }, "logo-preview": { innerHTML: "" }
  });
  const api = evaluateFunctions(clientSource, ["initials", "logoMarkup", "updateLogoPreview", "readLogoFile"], {
    document, escapeHtml: String, FileReader, MAX_LOGO_BYTES: 750 * 1024
  });
  assert.match(api.logoMarkup({ brandName: "Cloud Cafe", logoUrl: "data:image/png;base64,x" }), /<img[\s\S]*data-media-src/);
  assert.match(api.logoMarkup({ brandName: "Cloud Cafe", logoUrl: "" }), /client-logo-placeholder[\s\S]*CC/);
  await assert.rejects(api.readLogoFile({ type: "text/plain", size: 1 }), /must be an image/);
  await assert.rejects(api.readLogoFile({ type: "image/png", size: 750 * 1024 + 1 }), /750 KB or smaller/);
  assert.equal(await api.readLogoFile({ type: "image/png", size: 2 }), "data:image/png;base64,AA==");
  document.getElementById("logo-url").value = "data:image/png;base64,edit";
  api.updateLogoPreview();
  assert.match(document.getElementById("logo-preview").innerHTML, /Logo preview[\s\S]*data:image\/png;base64,edit/);
  const removeHandler = clientSource.match(/clear-logo-btn['"]\)\.addEventListener\('click', \(\) => \{([\s\S]*?)\n\s*\}\);/)[1];
  vm.runInNewContext(removeHandler, { document, updateLogoPreview: api.updateLogoPreview });
  assert.equal(document.getElementById("logo-upload").value, "");
  assert.equal(document.getElementById("logo-url").value, "");
  assert.equal(document.getElementById("logo-preview").innerHTML, "CC");
});

test("Client archive and Edit-driven reactivation execute DELETE, form population, collection, and active-status PUT", async () => {
  const archiveRequests = [];
  const archive = evaluateFunctions(clientSource, ["archiveRestaurant"], {
    canManageClients: true, restaurants: [restaurantFixture("r1", "Archived Client")], RESTAURANTS_ENDPOINT: "/restaurants",
    selectedRestaurantId: "", workspaceRequestToken: 0,
    window: { CloudCrowdConfirmation: { request: async () => true } },
    apiRequest: async (...args) => archiveRequests.push(args), showMessage() {}, loadRestaurants: async () => {}
  });
  await archive.archiveRestaurant("r1");
  assert.deepEqual(plain(archiveRequests), [["/restaurants?id=r1", { method: "DELETE" }]]);

  const fieldIds = [
    "brand-name", "logo-url", "status", "call-center-number", "original-restaurant-number", "forwarded-number",
    "brand-owner-name", "brand-owner-phone", "account-manager-name", "restaurant-manager-name", "notes"
  ];
  const document = documentFixture(Object.fromEntries([
    ["client-form", { reset() {} }], ["restaurant-id", { value: "" }], ["logo-preview", { innerHTML: "" }],
    ["client-modal-title", { textContent: "" }], ["save-client-btn", { textContent: "", disabled: false }],
    ...fieldIds.map((id) => [id, { value: "" }])
  ]));
  const saveRequests = [];
  const opened = [];
  const inactive = {
    ...restaurantFixture("r1", "Archived Client"), status: "inactive", logoUrl: "data:image/png;base64,old",
    callCenterNumber: "111", originalRestaurantNumber: "222", forwardedNumber: "333",
    brandOwnerName: "Owner", brandOwnerPhone: "444", accountManagerName: "Account", restaurantManagerName: "Manager", notes: "Archived notes"
  };
  const save = evaluateFunctions(clientSource, [
    "initials", "updateLogoPreview", "resetClientForm", "collectClientData", "saveClient", "editRestaurant"
  ], {
    document, canManageClients: true, RESTAURANTS_ENDPOINT: "/restaurants",
    getRestaurantProfile: async (id) => { assert.equal(id, "r1"); return inactive; },
    apiRequest: async (...args) => saveRequests.push(args), openModal: (id) => opened.push(id), closeModal() {},
    showMessage() {}, loadRestaurants: async () => {}, escapeHtml: String
  });
  await save.editRestaurant("r1");
  assert.equal(document.getElementById("restaurant-id").value, "r1");
  assert.equal(document.getElementById("status").value, "inactive");
  assert.equal(document.getElementById("brand-name").value, "Archived Client");
  assert.equal(document.getElementById("logo-url").value, "data:image/png;base64,old");
  assert.match(document.getElementById("logo-preview").innerHTML, /data:image\/png;base64,old/);
  assert.equal(document.getElementById("client-modal-title").textContent, "Edit Client");
  assert.deepEqual(opened, ["client-modal"]);
  document.getElementById("status").value = "active";
  await save.saveClient({ preventDefault() {}, currentTarget: { reportValidity: () => true } });
  assert.equal(saveRequests[0][1].method, "PUT");
  assert.equal(saveRequests[0][0], "/restaurants?id=r1");
  assert.deepEqual(JSON.parse(saveRequests[0][1].body), {
    brandName: "Archived Client", logoUrl: "data:image/png;base64,old", status: "active",
    callCenterNumber: "111", originalRestaurantNumber: "222", forwardedNumber: "333",
    brandOwnerName: "Owner", brandOwnerPhone: "444", accountManagerName: "Account",
    restaurantManagerName: "Manager", notes: "Archived notes"
  });
});

class OverlayElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.isConnected = true;
    this.id = "";
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, force) => { if (force) classes.add(name); else classes.delete(name); }
    };
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelectorAll(selector) {
    if (selector.includes(",")) return this.descendants().filter((node) => ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "A"].includes(node.tagName));
    if (selector === "[autofocus]") return this.descendants().filter((node) => node.getAttribute("autofocus") !== null);
    if (selector.includes("input:not")) return this.descendants().filter((node) => ["INPUT", "SELECT", "TEXTAREA"].includes(node.tagName));
    if (selector.includes("data-cc-overlay-close")) return this.descendants().filter((node) => node.getAttribute("data-cc-overlay-close") !== null);
    return [];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  matches() { return false; }
  focus() { this.ownerDocument.activeElement = this; }
  getClientRects() { return this.hidden ? [] : [1]; }
}

function overlayHarness() {
  const listeners = new Map();
  const document = {
    activeElement: null,
    elements: new Map(),
    body: null,
    createElement(tag) { return new OverlayElement(tag, document); },
    getElementById(id) { return this.elements.get(id) || null; },
    querySelectorAll() { return []; },
    addEventListener(type, listener) { const list = listeners.get(type) || []; list.push(listener); listeners.set(type, list); },
    dispatch(type, event) { (listeners.get(type) || []).forEach((listener) => listener(event)); }
  };
  document.body = document.createElement("body");
  document.activeElement = document.body;
  const window = { document, setTimeout: (callback) => callback() };
  window.window = window;
  vm.runInNewContext(dialogSource, { window, document, globalThis: window, Map, Set, Array, Object });
  return { document, window, api: window.CloudCrowdOverlay };
}

test("Client Create/Edit dialog ownership uses actual overlay focus entry, containment, closing, and restoration", () => {
  const env = overlayHarness();
  const trigger = env.document.createElement("button");
  const root = env.document.createElement("div"); root.id = "client-modal";
  const panel = env.document.createElement("section");
  const first = env.document.createElement("input"); first.id = "brand-name";
  const last = env.document.createElement("button"); last.setAttribute("data-cc-overlay-close", "");
  panel.appendChild(first); panel.appendChild(last); root.appendChild(panel);
  env.document.body.appendChild(trigger); env.document.body.appendChild(root);
  env.document.elements.set(root.id, root);
  trigger.focus();
  env.api.register(root, { panel, type: "dialog", dismissOnEscape: true, dismissOnBackdrop: true, initialFocus: first });
  env.api.open("client-modal", { trigger });
  assert.equal(env.document.activeElement, first);
  last.focus();
  const tab = { key: "Tab", shiftKey: false, preventDefault() { this.prevented = true; } };
  env.document.dispatch("keydown", tab);
  assert.equal(env.document.activeElement, first);
  assert.equal(tab.prevented, true);
  const escape = { key: "Escape", preventDefault() {}, stopImmediatePropagation() {}, stopPropagation() {} };
  env.document.dispatch("keydown", escape);
  assert.equal(env.api.isOpen("client-modal"), false);
  assert.equal(env.document.activeElement, trigger);

  env.api.open("client-modal", { trigger });
  env.document.dispatch("click", {
    target: root,
    preventDefault() {}, stopImmediatePropagation() {}, stopPropagation() {}
  });
  assert.equal(env.api.isOpen("client-modal"), false, "backdrop closes the registered Client dialog");
  assert.equal(env.document.activeElement, trigger);

  const openModal = functionSource(clientSource, "openModal");
  const closeModal = functionSource(clientSource, "closeModal");
  assert.match(openModal, /CloudCrowdOverlay\.open\(id\)/);
  assert.match(closeModal, /CloudCrowdOverlay\.close\(id, \{ reason: 'page-close' \}\)/);
  assert.match(clientSource.match(/if \(closeButton\)[^\n]+/)[0], /closeModal/);
});

test("Client Add dialog executes management gate, dialog opening, and brand-field focus entry", () => {
  for (const canManage of [true, false]) {
    const focused = [];
    const opened = [];
    const reset = [];
    const document = documentFixture({ "brand-name": { focus: () => focused.push("brand") } });
    const { openCreateClient } = evaluateFunctions(clientSource, ["openCreateClient"], {
      canManageClients: canManage, document,
      resetClientForm: () => reset.push("reset"), openModal: (id) => opened.push(id)
    });
    openCreateClient();
    assert.deepEqual({ reset, opened, focused }, canManage
      ? { reset: ["reset"], opened: ["client-modal"], focused: ["brand"] }
      : { reset: [], opened: [], focused: [] });
  }
  const edit = functionSource(clientSource, "editRestaurant");
  assert.match(edit, /resetClientForm\(\)[\s\S]*status'\)\.value = restaurant\.status \|\| 'active'[\s\S]*openModal\('client-modal'\)/);
});

test("System theme executes stored preference, OS light/dark resolution, and preference-change events", () => {
  function fixture(systemDark) {
    const listeners = [];
    const attributes = new Map();
    const media = {
      matches: systemDark,
      addEventListener(type, listener) { if (type === "change") listeners.push(listener); }
    };
    const documentElement = { setAttribute: (name, value) => attributes.set(name, value), getAttribute: (name) => attributes.get(name) || null };
    const environment = {
      document: { documentElement, body: null },
      localStorage: { getItem: () => "system", setItem() {} },
      matchMedia: () => media,
      addEventListener() {},
      dispatchEvent() {},
      CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } }
    };
    const manager = themeApi.createThemeManager(environment);
    return {
      manager, media, attributes,
      change(dark) { media.matches = dark; listeners.forEach((listener) => listener({ matches: dark })); }
    };
  }
  const dark = fixture(true);
  assert.equal(dark.manager.init(), "dark");
  assert.equal(dark.attributes.get("data-theme"), "dark");
  dark.change(false);
  assert.equal(dark.manager.getTheme(), "light");
  assert.equal(dark.attributes.get("data-theme"), "light");

  const light = fixture(false);
  assert.equal(light.manager.init(), "light");
  light.change(true);
  assert.equal(light.manager.getTheme(), "dark");
  assert.match(employeeSource, /assets\/js\/theme\.js/);
  assert.match(clientSource, /assets\/js\/theme\.js/);
});

test("Employee maintenance parity executes polling enforcement and preserves the Anati exemption", async () => {
  async function lifecycle({ user, role, maintenance, admin = false }) {
    const intervals = [];
    const values = { cc_auth: "1", cc_user: user, cc_role: role, cc_token: "token" };
    const window = {
      location: { href: "employee-profiles.html" },
      setInterval: (callback, delay) => intervals.push([callback, delay])
    };
    window.window = window;
    vm.runInNewContext(maintenanceSource, {
      window,
      readSessionValue: (key) => values[key] || "",
      fetch: async () => ({ ok: true, json: async () => ({ maintenance, admin }) }),
      console: { warn() {} }
    });
    const instance = window.CloudCrowdMaintenance.createLifecycle();
    instance.startEnforcement();
    await flush();
    return { window, intervals };
  }
  const employee = await lifecycle({ user: "agent", role: "agent", maintenance: true });
  assert.equal(employee.window.location.href, "system-update.html");
  assert.equal(employee.intervals[0][1], 3000);
  const anati = await lifecycle({ user: "Anati", role: "admin", maintenance: true, admin: true });
  assert.equal(anati.window.location.href, "employee-profiles.html");
  const disabled = await lifecycle({ user: "agent", role: "agent", maintenance: false });
  assert.equal(disabled.window.location.href, "employee-profiles.html");
  assert.match(employeeSource, /<script src="js\/maintenance\.js"><\/script>[\s\S]*CloudCrowdMaintenance\.createLifecycle\(\)[\s\S]*startEnforcement\(\)/);
});

test("Profile stylesheet order and Light/Dark cascade winners remain deterministic", () => {
  assert.deepEqual(linkedStyles(employeeSource), [
    "assets/css/design-tokens.css", "app-shell.css", "assets/css/theme-base.css",
    "assets/css/layouts/page-layout.css", "assets/css/components/buttons.css", "assets/css/components/icons.css",
    "assets/css/components/feedback.css", "assets/css/components/forms.css", "assets/css/components/filters.css",
    "assets/css/components/cards.css", "assets/css/components/status.css", "assets/css/components/tables.css",
    "assets/css/components/dialogs.css", "assets/css/components/master-detail.css"
  ]);
  assert.deepEqual(linkedStyles(clientSource), [
    "assets/css/design-tokens.css", "app-shell.css", "assets/css/theme-base.css", "media-viewer.css",
    "assets/css/pages/business-quality.css", "assets/css/layouts/page-layout.css", "assets/css/components/buttons.css",
    "assets/css/components/icons.css", "assets/css/components/feedback.css", "assets/css/components/forms.css",
    "assets/css/components/filters.css", "assets/css/components/cards.css", "assets/css/components/status.css",
    "assets/css/components/tables.css", "assets/css/components/dialogs.css", "assets/css/components/master-detail.css"
  ]);
  assert.match(employeeSource, /assets\/js\/components\/master-detail\.js/);
  assert.match(employeeSource, /<link rel=stylesheet href=assets\/css\/components\/master-detail\.css>/);
  assert.match(masterDetailSource, /assets\/css\/components\/master-detail\.css[\s\S]*dataset\.ccComponent = 'master-detail'/);
  let duplicateLinks = 0;
  const staticLinkWindow = {
    document: {
      head: { appendChild: () => { duplicateLinks += 1; } },
      querySelector: () => ({ rel: "stylesheet" }),
      createElement: () => { throw new Error("static stylesheet must prevent dynamic duplication"); }
    }
  };
  staticLinkWindow.window = staticLinkWindow;
  vm.runInNewContext(masterDetailSource, { window: staticLinkWindow });
  assert.equal(duplicateLinks, 0);
  for (const page of [EMPLOYEE_FILE, CLIENT_FILE]) {
    const light = themeTargets(page, "light", 1440);
    const dark = themeTargets(page, "dark", 1440);
    assert.notEqual(effectiveColor(light.cascade, light.body, "background-color").color, effectiveColor(dark.cascade, dark.body, "background-color").color);
    assert.notEqual(effectiveColor(light.cascade, light.card, "background-color").color, effectiveColor(dark.cascade, dark.card, "background-color").color);
  }
});

test("Exact supported widths retain table horizontal reachability declarations", () => {
  for (const width of RESPONSIVE_WIDTHS) {
    for (const [page, minimum] of [[EMPLOYEE_FILE, "760px"], [CLIENT_FILE, "680px"]]) {
      const targets = themeTargets(page, "light", width);
      assert.equal(targets.cascade.winner(targets.wrap, "overflow-x").value, "auto", `${page} ${width}`);
      assert.equal(targets.cascade.winner(targets.table, "min-width").value, minimum, `${page} ${width}`);
    }
  }
});

test("Profile layout cascade executes shared two-pane/stacked sizing and selection-focus hooks", () => {
  const employeeWide = profileLayoutTargets(EMPLOYEE_FILE, 1440);
  assert.equal(employeeWide.cascade.winner(employeeWide.layout, "display").value, "grid");
  assert.equal(employeeWide.cascade.winner(employeeWide.layout, "grid-template-columns").value, "minmax(300px, 360px) minmax(0, 1fr)");
  assert.equal(employeeWide.cascade.winner(employeeWide.directory, "position").value, "sticky");
  assert.equal(employeeWide.cascade.winner(employeeWide.directory, "max-height").value, "calc(100vh - 96px)");
  assert.equal(employeeWide.cascade.winner(employeeWide.workspace, "min-height").value, "640px");
  assert.equal(employeeWide.cascade.winner(employeeWide.back, "display").value, "none");
  const selectedRule = appShellCss.match(/\.employee-profiles-ops-center \.employee-directory-pane \.employee-card\.is-selected \{([\s\S]*?)\}/)[1];
  assert.match(selectedRule, /background:\s*linear-gradient/);
  assert.match(selectedRule, /box-shadow:\s*inset 3px 0 0/);
  assert.equal(employeeWide.cascade.winner(employeeWide.select, "outline").value, "2px solid var(--color-border)");
  assert.equal(employeeWide.cascade.winner(employeeWide.select, "outline-offset").value, "3px");

  const employeeMedium = profileLayoutTargets(EMPLOYEE_FILE, 1024);
  assert.equal(employeeMedium.cascade.winner(employeeMedium.layout, "grid-template-columns").value, "minmax(280px, 320px) minmax(0, 1fr)");
  const employeeStacked = profileLayoutTargets(EMPLOYEE_FILE, 768);
  assert.equal(employeeStacked.cascade.winner(employeeStacked.layout, "grid-template-columns").value, "1fr");
  assert.equal(employeeStacked.cascade.winner(employeeStacked.directory, "position").value, "relative");
  assert.equal(employeeStacked.cascade.winner(employeeStacked.directory, "max-height").value, "520px");
  assert.equal(employeeStacked.cascade.winner(employeeStacked.workspace, "min-height").value, "520px");
  assert.equal(employeeStacked.cascade.winner(employeeStacked.back, "display").value, "inline-flex");
  assert.equal(employeeStacked.cascade.winner(employeeStacked.directory, "display").sourceName, "assets/css/components/master-detail.css");
  assert.equal(employeeStacked.cascade.winner(employeeStacked.directory, "display").value, "none");
  const employeeMobile = profileLayoutTargets(EMPLOYEE_FILE, 390);
  assert.equal(employeeMobile.cascade.winner(employeeMobile.directory, "max-height").value, "480px");
  for (const width of RESPONSIVE_WIDTHS) {
    const targets = profileLayoutTargets(EMPLOYEE_FILE, width);
    assert.ok(targets.cascade.winner(targets.layout, "display"));
    assert.ok(targets.cascade.winner(targets.directory, "max-height"));
    assert.ok(targets.cascade.winner(targets.workspace, "min-height"));
  }
  assert.match(masterDetailCss, /\.cc-master-detail\[data-view="list"\] \.cc-master-detail__detail/);
  assert.match(masterDetailCss, /\.cc-master-detail\[data-view="detail"\] \.cc-master-detail__list/);
  for (const target of [employeeWide, employeeMedium, employeeStacked, employeeMobile]) {
    assert.equal(target.cascade.winner(target.layout, "grid-template-columns").sourceName, "app-shell.css",
      "higher-specificity Employee compatibility selectors remain the effective geometry owners");
  }

  const clientWide = profileLayoutTargets(CLIENT_FILE, 1440);
  assert.equal(clientWide.cascade.winner(clientWide.layout, "display").value, "grid");
  assert.equal(clientWide.cascade.winner(clientWide.layout, "grid-template-columns").value, "minmax(300px, 360px) minmax(0, 1fr)");
  assert.equal(clientWide.cascade.winner(clientWide.directory, "position").value, "sticky");
  assert.equal(clientWide.cascade.winner(clientWide.directory, "max-height").value, "calc(100vh - 96px)");
  assert.equal(clientWide.cascade.winner(clientWide.workspace, "min-height").value, "640px");
  assert.equal(clientWide.cascade.winner(clientWide.grid, "display").value, "grid");
  assert.equal(clientWide.cascade.winner(clientWide.grid, "grid-template-columns").value, "1fr");
  assert.equal(clientWide.cascade.winner(clientWide.back, "display").value, "none");
  assert.equal(clientWide.cascade.winner(clientWide.select, "outline").value, "2px solid var(--color-border)");
  const clientMobile = profileLayoutTargets(CLIENT_FILE, 390);
  assert.equal(clientMobile.cascade.winner(clientMobile.grid, "grid-template-columns").value, "1fr");
  assert.equal(clientMobile.cascade.winner(clientMobile.layout, "grid-template-columns").value, "1fr");
  assert.equal(clientMobile.cascade.winner(clientMobile.directory, "max-height").value, "480px");
  assert.equal(clientMobile.cascade.winner(clientMobile.directory, "display").value, "none");
  assert.equal(clientMobile.cascade.winner(clientMobile.back, "display").value, "inline-flex");

  const employeeMarkup = employeeSource.match(/<section class="employee-profiles-workspace-layout cc-master-detail"[\s\S]*?<\/section>\s*<p class="cc-master-detail__announcement"/)[0];
  assert.match(employeeMarkup, /cc-master-detail__list[\s\S]*cc-master-detail__notice[\s\S]*cc-master-detail__detail/);
  const clientMarkup = clientSource.match(/<section class="client-profiles-workspace-layout cc-master-detail"[\s\S]*?<p class="cc-master-detail__announcement"/)[0];
  assert.match(clientMarkup, /cc-master-detail__list[\s\S]*cc-master-detail__notice[\s\S]*cc-master-detail__detail/);
});

test("Profile presentation, Client history, and maintenance contracts are implemented without scope expansion", () => {
  const employeeWorkspace = employeeSource.match(/<section class="employee-profiles-workspace-layout cc-master-detail"[\s\S]*?<\/section>\s*<p class="cc-master-detail__announcement"/)[0];
  assert.match(employeeWorkspace, /employee-directory-pane[\s\S]*employee-workspace-pane/);
  const clientWorkspace = clientSource.match(/<section class="client-profiles-workspace-layout cc-master-detail"[\s\S]*?<p class="cc-master-detail__announcement"/)[0];
  assert.match(clientWorkspace, /client-directory-pane[\s\S]*client-workspace-pane/);
  assert.doesNotMatch(clientSource, /id="profile-modal"|openModal\('profile-modal'\)/);
  assert.match(functionSource(clientSource, "updateClientUrl"), /searchParams\.set\('restaurantId'[\s\S]*searchParams\.delete\('restaurantId'[\s\S]*pushState[\s\S]*replaceState/);
  assert.match(clientSource, /historyKey: 'client-profiles'[\s\S]*onNavigate: handleClientHistoryNavigation/);
  assert.match(masterDetailSource, /addEventListener\?\.\('popstate', handlePopState\)/);

  const employeeScripts = [...employeeSource.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
  const clientScripts = [...clientSource.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(employeeScripts.includes("js/maintenance.js"), true);
  assert.equal(clientScripts.includes("js/maintenance.js"), true);
  assert.match(employeeSource, /CloudCrowdMaintenance\.createLifecycle\(\)[\s\S]*startEnforcement\(\)/);
});
