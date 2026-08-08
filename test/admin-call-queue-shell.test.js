"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { colorFromValue, contrastRatio, createCascade, effectiveColor, element: cssElement } = require("./css-cascade");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const pages = {
  admin: read("anati-admin.html"),
  callQueue: read("call-queue.html")
};
const permissionsRuntime = read("js/permissions.js");
const appShellRuntime = read("js/app-shell.js");
const internalShellRuntime = read("js/internal-page-shell.js");
const authRuntime = read("js/auth.js");
const maintenanceRuntime = read("js/maintenance.js");
const adminBackend = read("netlify/functions/admin-users.js");

class MemoryStorage {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values));
    this.writes = [];
  }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    const text = String(value);
    this.values.set(key, text);
    this.writes.push({ key, value: text });
  }
  removeItem(key) { this.values.delete(key); }
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const enabled = force === undefined ? !this.values.has(value) : Boolean(force);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.hidden = false;
    this.disabled = false;
    this.required = false;
    this.checked = false;
    this.dataset = {};
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.selectorResults = new Map();
    this.children = [];
    this.parentNode = null;
  }
  get firstChild() { return this.children[0] || null; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  querySelectorAll(selector) { return this.selectorResults.get(selector) || []; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  setAttribute(name, value) { this[name] = String(value); }
  getAttribute(name) { return this[name] ?? null; }
  focus() {}
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.selectorResults = new Map();
    this.body = new FakeElement("body");
    this.documentElement = new FakeElement("html");
  }
  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new FakeElement(id));
    return this.elements.get(id);
  }
  querySelectorAll(selector) { return this.selectorResults.get(selector) || []; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener() {}
  createElement(tag) { return new FakeElement(tag); }
}

function inlineScripts(source) {
  return [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .filter((script) => script.trim());
}

function pageScript(source) {
  return inlineScripts(source).sort((a, b) => b.length - a.length)[0];
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

function session(role, username = "Reviewer") {
  return new MemoryStorage({ cc_auth: "1", cc_token: "token", cc_role: role, cc_user: username });
}

function runAccessGuard(kind, role, username, extra = {}) {
  const source = inlineScripts(pages[kind]).find((script) =>
    kind === "admin" ? script.includes('sessionStorage.getItem("cc_user")') : script.includes("allowedCallQueueRoles")
  );
  const sessionStorage = session(role, username);
  if (extra.invalidSession) sessionStorage.removeItem("cc_token");
  const localStorage = new MemoryStorage();
  const redirects = [];
  let currentHref = "";
  const location = {
    get href() { return currentHref; },
    set href(value) { currentHref = value; redirects.push(value); }
  };
  const context = {
    sessionStorage,
    localStorage,
    location,
    readSessionValue(key) { return sessionStorage.getItem(key) || ""; },
    clearStoredSession() {
      ["cc_auth", "cc_user", "cc_role", "cc_token"].forEach((key) => {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
      });
    },
    ...extra
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: `${kind}-access-guard.js` });
  return extra.returnDetails
    ? { href: context.location.href, redirects, token: sessionStorage.getItem("cc_token") }
    : context.location.href;
}

function loadRegistry(role, username, configuredAccess = []) {
  const context = {
    console: { warn() {}, error() {}, log() {} },
    sessionStorage: session(role, username),
    location: { pathname: "/dashboard.html" },
    document: new FakeDocument(),
    CCPermissions: {
      async getMyAccessModel() {
        return { legacyFallback: false, fullAccess: false, access: configuredAccess };
      },
      getModuleAccess(model, moduleKey) {
        return model.access.find((record) => record.moduleKey === moduleKey) || {
          moduleKey, canView: false, canCreate: false, canEdit: false, canDelete: false
        };
      }
    }
  };
  context.window = context;
  vm.runInNewContext(appShellRuntime, context);
  return context.CloudCrowdAppShell;
}

function loadPermissionIntegration(role, username, configuredAccess = [], integrationOptions = {}) {
  const document = new FakeDocument();
  const fetchCalls = [];
  const context = {
    console: { warn() {}, error() {}, log() {} },
    sessionStorage: session(role, username),
    document,
    MutationObserver: class { observe() {} },
    fetch: async (url, requestOptions) => {
      fetchCalls.push({ url, options: requestOptions });
      const legacyFallback = Boolean(integrationOptions.legacyFallback);
      return jsonResponse({
        ok: true,
        legacyFallback,
        hasConfiguredAccess: !legacyFallback,
        access: legacyFallback ? [] : configuredAccess
      });
    }
  };
  context.window = context;
  context.location = { href: "", pathname: role === "admin" ? "/anati-admin.html" : "/call-queue.html" };
  vm.runInNewContext(permissionsRuntime, context);
  vm.runInNewContext(appShellRuntime, context);
  return { context, fetchCalls };
}

function callQueuePermissionRecord(canView) {
  return {
    moduleKey: "call_queue",
    canView,
    canCreate: canView,
    canEdit: canView,
    canDelete: canView
  };
}

async function evaluateCallQueueLifecycle(role, permissionMode) {
  return executeCompleteCallQueueLifecycle(role, permissionMode);
}

function permissionGatedInternalShellRuntime() {
  const marker = "    await window.CloudCrowdAppShell.initializeAppShell({";
  const replacement = `    const routeModule = window.CloudCrowdAppShell.getModuleById(page.dataset.shellModule);
    await window.CCPermissions.requirePageAccess(routeModule.permissionKey);

${marker}`;
  assert.match(internalShellRuntime, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  return internalShellRuntime.replace(marker, replacement);
}

async function executeCompleteCallQueueLifecycle(role, permissionMode, options = {}) {
  const username = role === "admin" ? "Other Admin" : role === "manager" ? "Manager" : "Agent";
  const legacyFallback = permissionMode === "legacy";
  const configuredAccess = legacyFallback ? [] : [callQueuePermissionRecord(permissionMode === "allow")];
  const document = new FakeDocument();
  document.body.dataset = {
    shellModule: "call-queue",
    shellUserId: "call-queue-shell-user",
    shellRoleId: "call-queue-shell-role"
  };
  for (const id of [
    "maintenance-toggle-btn", "internal-page-shell", "internal-app-sidebar",
    "internal-app-topbar", "internal-nav-backdrop"
  ]) document.getElementById(id);

  const sessionStorage = session(role, username);
  const localStorage = new MemoryStorage();
  const redirects = [];
  const permissionCalls = {
    getMyAccessModel: [], getModuleAccess: [], getMyAccess: [], requirePageAccess: []
  };
  const maintenanceCalls = { createLifecycle: 0, startEnforcement: 0, startToggleUpdates: 0 };
  const errors = [];
  let currentHref = "";
  let shellResult = null;
  let resolveShellAttempt;
  const shellAttempted = new Promise((resolve) => { resolveShellAttempt = resolve; });
  const location = {
    pathname: "/call-queue.html",
    get href() { return currentHref; },
    set href(value) { currentHref = value; redirects.push(value); }
  };
  const context = {
    console: { warn() {}, log() {}, error(...args) { errors.push(args); } },
    document,
    sessionStorage,
    localStorage,
    location,
    MutationObserver: class { observe() {} },
    confirm() { return true; },
    matchMedia() {
      return { matches: false, addEventListener() {}, addListener() {} };
    },
    async fetch(url) {
      assert.equal(url, "/.netlify/functions/admin-users?my-access=1");
      return jsonResponse({
        ok: true,
        legacyFallback,
        hasConfiguredAccess: !legacyFallback,
        access: legacyFallback ? [] : configuredAccess
      });
    }
  };
  context.window = context;

  vm.runInNewContext(authRuntime, context, { filename: "js/auth.js" });
  const accessGuard = inlineScripts(pages.callQueue).find((script) => script.includes("allowedCallQueueRoles"));
  vm.runInNewContext(accessGuard, context, { filename: "call-queue-access-guard.js" });
  vm.runInNewContext(permissionsRuntime, context, { filename: "js/permissions.js" });
  vm.runInNewContext(appShellRuntime, context, { filename: "js/app-shell.js" });

  for (const method of Object.keys(permissionCalls)) {
    const productionMethod = context.CCPermissions[method].bind(context.CCPermissions);
    context.CCPermissions[method] = (...args) => {
      permissionCalls[method].push(args);
      return productionMethod(...args);
    };
  }

  const productionInitialize = context.CloudCrowdAppShell.initializeAppShell.bind(context.CloudCrowdAppShell);
  context.CloudCrowdAppShell.initializeAppShell = async (...args) => {
    try {
      shellResult = await productionInitialize(...args);
      return shellResult;
    } finally {
      resolveShellAttempt();
    }
  };
  context.CloudCrowdMaintenance = {
    createLifecycle() {
      maintenanceCalls.createLifecycle += 1;
      return {
        startEnforcement() { maintenanceCalls.startEnforcement += 1; },
        startToggleUpdates() { maintenanceCalls.startToggleUpdates += 1; }
      };
    }
  };

  vm.runInNewContext(options.internalShellRuntime || internalShellRuntime, context, {
    filename: options.mutantName || "js/internal-page-shell.js"
  });
  await shellAttempted;
  await Promise.resolve();

  const permitted = shellResult?.permittedModules || [];
  return {
    role,
    permissionMode,
    routeAllowed: !redirects.includes("dashboard.html"),
    navigationVisible: permitted.some((module) => module.id === "call-queue"),
    redirects,
    permissionCalls,
    maintenanceCalls,
    shellResult,
    errors,
    permissionRuntime: context.CCPermissions,
    appShell: context.CloudCrowdAppShell
  };
}

function assertApprovedCallQueuePolicy(result) {
  const expectedRoute = result.role === "admin" || result.role === "manager";
  assert.equal(result.routeAllowed, expectedRoute,
    `Call Queue route policy: ${result.role}/${result.permissionMode}`);
  assert.equal(result.navigationVisible, false,
    `Call Queue navigation policy: ${result.role}/${result.permissionMode}`);
  assert.equal(result.permissionCalls.requirePageAccess.length, 0,
    `Call Queue route must not call requirePageAccess: ${result.role}/${result.permissionMode}`);
  assert.equal(result.permissionCalls.getMyAccess.length, 0,
    `Call Queue route must not call getMyAccess: ${result.role}/${result.permissionMode}`);
  assert.equal(result.permissionCalls.getModuleAccess.some(([model, moduleKey]) => moduleKey === "call_queue"), false,
    `Hidden Call Queue must not enter configured module filtering: ${result.role}/${result.permissionMode}`);
  assert.equal(result.permissionCalls.getMyAccessModel.length, 1,
    `Shared shell retrieves one permission model: ${result.role}/${result.permissionMode}`);
  assert.deepEqual(result.maintenanceCalls,
    { createLifecycle: 1, startEnforcement: 1, startToggleUpdates: 1 });
  assert.equal(result.errors.length, 0);
}

function callQueueInlinePermissionCalls(source) {
  return inlineScripts(source).filter((script) => {
    const callsConfiguredPermissionApi = /\b(?:requirePageAccess|getMyAccess|getModuleAccess|getMyAccessModel)\s*\(/s.test(script);
    return callsConfiguredPermissionApi;
  });
}

function assertNoCallQueueRoutePermissionWiring(source) {
  assert.equal(callQueueInlinePermissionCalls(source).length, 0,
    "Call Queue direct route must not invoke configured permission APIs");
}

function replaceLast(source, marker, replacement) {
  const index = source.lastIndexOf(marker);
  assert.notEqual(index, -1, `marker exists: ${marker}`);
  return source.slice(0, index) + replacement + source.slice(index + marker.length);
}

function loadAdmin() {
  const document = new FakeDocument();
  const sessionStorage = session("admin", "Anati");
  const localStorage = new MemoryStorage();
  const calls = [];
  const confirmations = [];
  const context = {
    console,
    document,
    sessionStorage,
    localStorage,
    location: { href: "", pathname: "/anati-admin.html" },
    MutationObserver: class { observe() {} },
    confirm(message) { confirmations.push(message); return true; },
    readSessionValue(key) { return sessionStorage.getItem(key) || ""; },
    clearStoredSession() {},
    CCPermissions: { requirePageAccess() {} },
    fetchHandler: async () => jsonResponse({ ok: true }),
    fetch(url, options = {}) {
      calls.push({ url, options });
      return context.fetchHandler(url, options);
    }
  };
  context.window = context;
  const exposure = `window.__api = {
    apiRequest, dataRequest, renderStats, renderUsers, renderModules, updateAccountFields,
    saveUser, disableUser, collectAccessPayload, saveAccess, loadAdminCenter,
    setUsers(value) { adminUsers = value; }, setEmployees(value) { activeEmployees = value; },
    setModules(value) { moduleRegistry = value; }, setAccess(value) { moduleAccess = value; }
  };`;
  const script = replaceLast(pageScript(pages.admin), "    loadAdminCenter();", `    ${exposure}`);
  vm.runInNewContext(script, context, { filename: "admin-business.js" });
  return { api: context.__api, context, document, calls, confirmations };
}

function loadCallQueue(savedTickets = null, role = "manager", username = "Queue User") {
  const document = new FakeDocument();
  const initial = { cc_auth: "1", cc_token: "token", cc_role: role, cc_user: username };
  const sessionStorage = new MemoryStorage(initial);
  const localStorage = new MemoryStorage(savedTickets === null ? {} : {
    cc_call_queue_tickets_v1: JSON.stringify(savedTickets)
  });
  let fetchCalls = 0;
  const context = {
    console,
    document,
    sessionStorage,
    localStorage,
    location: { href: "", pathname: "/call-queue.html" },
    fetch() { fetchCalls += 1; throw new Error("Call Queue must not fetch"); }
  };
  context.window = context;
  const exposure = `window.__api = {
    seedTickets, loadTickets, saveTickets, findTicket, renderQueue, renderWorkspace, render,
    addNote, startCall, positiveResult, negativeResult, moveToDone,
    state() { return tickets; }, selected() { return selectedTicketId; },
    select(id) { selectedTicketId = id; render(); },
    setTickets(value) { tickets = value; selectedTicketId = tickets[0]?.id || null; }
  };`;
  const script = replaceLast(pageScript(pages.callQueue), "    render();", `    ${exposure}`);
  vm.runInNewContext(script, context, { filename: "call-queue-business.js" });
  return { api: context.__api, context, document, localStorage, get fetchCalls() { return fetchCalls; } };
}

function setValues(document, values) {
  Object.entries(values).forEach(([id, value]) => { document.getElementById(id).value = value; });
}

function freshQueueMutation(status, username = "Mona") {
  const loaded = loadCallQueue(null, "manager", username);
  loaded.localStorage.writes.length = 0;
  const ticket = loaded.api.state()[0];
  ticket.status = status;
  ticket.lastUpdated = "before-mutation";
  return { loaded, ticket };
}

function assertFullQueuePersistence(loaded, ticket, expected = {}) {
  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.notEqual(ticket.lastUpdated, "before-mutation");
  assert.equal(loaded.localStorage.writes.length, 1);
  assert.equal(loaded.localStorage.writes[0].key, "cc_call_queue_tickets_v1");
  const persisted = JSON.parse(loaded.localStorage.writes[0].value);
  assert.equal(persisted.length, loaded.api.state().length);
  assert.deepEqual(Array.from(persisted, (item) => item.id),
    Array.from(loaded.api.state(), (item) => item.id));
  const persistedTicket = persisted.find((item) => item.id === ticket.id);
  Object.entries(expected).forEach(([key, value]) => assert.deepEqual(plain(persistedTicket[key]), plain(value)));
  const reloaded = loadCallQueue(persisted, "manager", "Mona");
  const reloadedTicket = reloaded.api.state().find((item) => item.id === ticket.id);
  Object.entries(expected).forEach(([key, value]) => assert.deepEqual(plain(reloadedTicket[key]), plain(value)));
  return { persisted, persistedTicket, reloadedTicket };
}

function renderedButtonDisabled(loaded, id) {
  loaded.api.renderWorkspace();
  const html = loaded.document.getElementById("workspace-panel").innerHTML;
  const button = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] || "";
  assert.ok(button, `${id} is rendered`);
  return /\sdisabled(?:\s|>)/.test(button);
}

test("approved Admin and Call Queue access matrices are frozen before migration", async () => {
  assert.equal(runAccessGuard("admin", "admin", "Anati"), "");
  assert.equal(runAccessGuard("admin", "manager", "Anati"), "dashboard.html");
  assert.equal(runAccessGuard("admin", "admin", "Other Admin"), "dashboard.html");
  assert.equal(runAccessGuard("admin", "manager", "Manager"), "dashboard.html");
  assert.equal(runAccessGuard("admin", "agent", "Agent"), "dashboard.html");
  assert.deepEqual(runAccessGuard("admin", "admin", "Anati", { invalidSession: true, returnDetails: true }), {
    href: "dashboard.html", redirects: ["login.html", "dashboard.html"], token: null
  });
  assert.equal(runAccessGuard("callQueue", "admin", "Other Admin"), "");
  assert.equal(runAccessGuard("callQueue", "manager", "Manager"), "");
  assert.equal(runAccessGuard("callQueue", "agent", "Agent"), "dashboard.html");
  assert.deepEqual(runAccessGuard("callQueue", "manager", "Manager", { invalidSession: true, returnDetails: true }), {
    href: "dashboard.html", redirects: ["login.html", "dashboard.html"], token: null
  });

  const configured = [{ moduleKey: "call_queue", canView: true }];
  for (const [role, username] of [["admin", "Other Admin"], ["manager", "Manager"], ["agent", "Agent"]]) {
    const shell = loadRegistry(role, username, configured);
    const visible = await shell.filterPermittedModules(shell.getAllModules(), { fallbackMode: "legacy" });
    assert.equal(visible.some((module) => module.id === "call-queue"), false);
  }
  const otherAdminShell = loadRegistry("admin", "Other Admin", [{ moduleKey: "anati_admin", canView: true }]);
  assert.equal((await otherAdminShell.filterPermittedModules(otherAdminShell.getAllModules(), { fallbackMode: "legacy" }))
    .some((module) => module.id === "anati-admin"), false);
  const anatiShell = loadRegistry("admin", "Anati");
  assert.equal((await anatiShell.filterPermittedModules(anatiShell.getAllModules(), { fallbackMode: "legacy" }))
    .some((module) => module.id === "anati-admin"), true);
});

test("Admin executes exact create, update, disable, access, statistics, and degradation contracts", async () => {
  const loaded = loadAdmin();
  loaded.context.fetchHandler = async (url) => {
    if (url.includes("employees")) return jsonResponse({ ok: true, employees: [] });
    if (url.includes("modules=1")) return jsonResponse({ ok: true, modules: [], access: [] });
    return jsonResponse({ ok: true, users: [], access: [] });
  };
  await loaded.api.loadAdminCenter();
  assert.deepEqual(loaded.calls.map((call) => [call.url, call.options.method || "GET"]), [
    ["/.netlify/functions/admin-users", "GET"],
    ["/.netlify/functions/admin-users?modules=1", "GET"],
    ["./.netlify/functions/employees?status=active", "GET"]
  ]);
  loaded.calls.length = 0;
  setValues(loaded.document, {
    username: "new-user", "display-name": "New User", email: "new@example.test",
    role: "manager", status: "active", "account-type": "external", "employee-id": "",
    "temporary-password": "temporary-secret"
  });
  loaded.document.getElementById("must-reset-password").checked = false;
  await loaded.api.saveUser({ preventDefault() {} });
  assert.equal(loaded.calls[0].url, "/.netlify/functions/admin-users");
  assert.equal(loaded.calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(loaded.calls[0].options.body), {
    username: "new-user", displayName: "New User", email: "new@example.test", role: "manager",
    status: "active", accountType: "external", employeeId: "", isSystemAccount: false,
    mustResetPassword: true, temporaryPassword: "temporary-secret"
  });

  loaded.calls.length = 0;
  loaded.document.getElementById("user-id").value = "user-id-1";
  loaded.document.getElementById("temporary-password").value = "";
  await loaded.api.saveUser({ preventDefault() {} });
  assert.equal(loaded.calls[0].url, "/.netlify/functions/admin-users?id=user-id-1");
  assert.equal(loaded.calls[0].options.method, "PUT");
  assert.equal(Object.hasOwn(JSON.parse(loaded.calls[0].options.body), "temporaryPassword"), false);

  loaded.calls.length = 0;
  loaded.api.setUsers([{ userId: "user-id-1", username: "worker", role: "agent", status: "active" }]);
  await loaded.api.disableUser("user-id-1");
  assert.equal(loaded.calls[0].url, "/.netlify/functions/admin-users?id=user-id-1");
  assert.equal(loaded.calls[0].options.method, "DELETE");
  assert.deepEqual(loaded.confirmations, ["Disable worker?"]);

  loaded.calls.length = 0;
  loaded.document.getElementById("access-user").value = "worker";
  const row = new FakeElement("module-row");
  row.dataset.moduleKey = "attendance";
  const view = new FakeElement("view");
  view.dataset.accessField = "canView";
  view.checked = true;
  const edit = new FakeElement("edit");
  edit.dataset.accessField = "canEdit";
  edit.checked = true;
  row.selectorResults.set("[data-access-field]", [view, edit]);
  loaded.document.selectorResults.set("#modules-body tr[data-module-key]", [row]);
  loaded.context.fetchHandler = async () => jsonResponse({ ok: true, access: [] });
  await loaded.api.saveAccess();
  assert.equal(loaded.calls[0].url, "/.netlify/functions/admin-users?action=module-access");
  assert.equal(loaded.calls[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(loaded.calls[0].options.body), {
    username: "worker",
    access: [{ moduleKey: "attendance", canView: true, canCreate: false, canEdit: true, canDelete: false }]
  });

  loaded.api.setUsers([
    { role: "admin", status: "active" }, { role: "manager", status: "active" },
    { role: "agent", status: "disabled" }
  ]);
  loaded.api.renderStats();
  assert.equal(loaded.document.getElementById("stat-total").textContent, 3);
  assert.equal(loaded.document.getElementById("stat-active").textContent, 2);
  assert.equal(loaded.document.getElementById("stat-disabled").textContent, 1);
  assert.equal(loaded.document.getElementById("stat-leaders").textContent, 2);

  loaded.context.fetchHandler = async () => jsonResponse({ ok: false, error: "offline" }, 500);
  await assert.rejects(() => loaded.api.apiRequest(""), /offline/);
});

test("Admin source preserves account, endpoint, Anati, and incomplete-section boundaries", () => {
  assert.match(pages.admin, /option value="employee"/);
  assert.match(pages.admin, /option value="external"/);
  assert.match(pages.admin, /option value="system"/);
  assert.match(pages.admin, /option value="client" disabled>Client - coming later/);
  assert.match(pages.admin, /Workflow Permissions/);
  assert.match(pages.admin, /Maintenance Control/);
  assert.match(pages.admin, /Audit Logs/);
  assert.match(pages.admin, /forced password change screens come in a later phase/);
  assert.match(pages.admin, /GET|ADMIN_USERS_ENDPOINT/);
  assert.match(pages.admin, /EMPLOYEES_ENDPOINT = "\.\/\.netlify\/functions\/employees"/);
  assert.match(adminBackend, /Anati cannot be disabled/);
  assert.match(adminBackend, /SET status = 'disabled'/);
});

test("Call Queue independently persists every valid mutation with timestamps and reload survival", () => {
  let state = freshQueueMutation("Need Call");
  state.loaded.api.startCall();
  assert.equal(state.ticket.status, "In Call");
  assert.equal(state.ticket.assignedTo, "Mona");
  assertFullQueuePersistence(state.loaded, state.ticket, { status: "In Call", assignedTo: "Mona" });

  state = freshQueueMutation("In Call");
  state.loaded.api.positiveResult();
  assert.equal(state.ticket.status, "Called");
  assert.equal(state.ticket.notes.at(-1), "Mona: Positive call result.");
  assertFullQueuePersistence(state.loaded, state.ticket, {
    status: "Called",
    notes: state.ticket.notes
  });

  state = freshQueueMutation("In Call");
  setValues(state.loaded.document, { "negative-reason": "No answer", "negative-note": "" });
  state.loaded.api.negativeResult();
  assert.equal(state.ticket.status, "Pending");
  assert.equal(state.ticket.negativeReason, "No answer");
  assert.equal(state.ticket.notes.at(-1), "Mona: Negative result - No answer");
  assertFullQueuePersistence(state.loaded, state.ticket, {
    status: "Pending",
    negativeReason: "No answer",
    notes: state.ticket.notes
  });

  state = freshQueueMutation("Called");
  state.loaded.api.moveToDone();
  assert.equal(state.ticket.status, "Done");
  assert.equal(state.ticket.notes.at(-1), "Mona: Moved ticket to Done.");
  assertFullQueuePersistence(state.loaded, state.ticket, {
    status: "Done",
    notes: state.ticket.notes
  });

  state = freshQueueMutation("Pending");
  state.loaded.document.getElementById("note-input").value = "Customer requested email";
  state.loaded.api.addNote();
  assert.equal(state.ticket.notes.at(-1), "Mona: Customer requested email");
  assertFullQueuePersistence(state.loaded, state.ticket, { notes: state.ticket.notes });
  assert.equal(state.loaded.fetchCalls, 0);
});

test("Call Queue rejects blank negative reasons and blank notes without mutation or persistence", () => {
  let state = freshQueueMutation("In Call");
  const originalStorage = state.loaded.localStorage.getItem("cc_call_queue_tickets_v1");
  const originalNotes = state.ticket.notes.slice();
  setValues(state.loaded.document, { "negative-reason": "   ", "negative-note": "Ignored" });
  state.loaded.api.negativeResult();
  assert.equal(state.ticket.status, "In Call");
  assert.equal(state.ticket.negativeReason, "");
  assert.equal(state.ticket.lastUpdated, "before-mutation");
  assert.deepEqual(state.ticket.notes, originalNotes);
  assert.equal(state.loaded.localStorage.writes.length, 0);
  assert.equal(state.loaded.localStorage.getItem("cc_call_queue_tickets_v1"), originalStorage);

  state = freshQueueMutation("Need Call");
  const blankNoteStorage = state.loaded.localStorage.getItem("cc_call_queue_tickets_v1");
  const blankNoteNotes = state.ticket.notes.slice();
  state.loaded.document.getElementById("note-input").value = "   ";
  state.loaded.api.addNote();
  assert.equal(state.ticket.lastUpdated, "before-mutation");
  assert.deepEqual(state.ticket.notes, blankNoteNotes);
  assert.equal(state.loaded.localStorage.writes.length, 0);
  assert.equal(state.loaded.localStorage.getItem("cc_call_queue_tickets_v1"), blankNoteStorage);
});

test("Call Queue renders the approved action gates for every status", () => {
  const expected = {
    "Need Call": { "start-call-btn": false, "positive-btn": true, "negative-btn": true, "done-btn": true },
    "In Call": { "start-call-btn": true, "positive-btn": false, "negative-btn": false, "done-btn": true },
    "Called": { "start-call-btn": true, "positive-btn": true, "negative-btn": true, "done-btn": false },
    "Pending": { "start-call-btn": true, "positive-btn": true, "negative-btn": true, "done-btn": false },
    "Done": { "start-call-btn": true, "positive-btn": true, "negative-btn": true, "done-btn": true }
  };
  for (const [status, gates] of Object.entries(expected)) {
    const state = freshQueueMutation(status);
    for (const [id, disabled] of Object.entries(gates)) {
      assert.equal(renderedButtonDisabled(state.loaded, id), disabled, `${status}: ${id}`);
    }
  }
});

test("Call Queue saved data, reload selection, image placeholder, and prototype boundaries remain exact", () => {
  const saved = [
    { id: "CQ-SAVED-2", customerName: "Second", phone: "2", branch: "B", restaurant: "R", orderNumber: "O2", callReason: "Reason", orderImage: "", assignedTo: "", status: "Need Call", notes: [], negativeReason: "", lastUpdated: "old" },
    { id: "CQ-SAVED-1", customerName: "First", phone: "1", branch: "B", restaurant: "R", orderNumber: "O1", callReason: "Reason", orderImage: "https://example.test/order.png", assignedTo: "", status: "Pending", notes: [], negativeReason: "Busy", lastUpdated: "old" }
  ];
  const loaded = loadCallQueue(saved);
  assert.deepEqual(Array.from(loaded.api.state(), (ticket) => ticket.id), ["CQ-SAVED-2", "CQ-SAVED-1"]);
  assert.equal(loaded.api.selected(), "CQ-SAVED-2");
  loaded.api.renderWorkspace();
  assert.match(loaded.document.getElementById("workspace-panel").innerHTML, /Order image placeholder/);
  loaded.api.select("CQ-SAVED-1");
  assert.match(loaded.document.getElementById("workspace-panel").innerHTML, /<img src="https:\/\/example\.test\/order\.png"/);
  assert.match(pages.callQueue, /const STATUSES = \['Need Call', 'In Call', 'Called', 'Pending', 'Done'\]/);
  assert.doesNotMatch(pages.callQueue, /fetch\([^M]|WebSocket|EventSource/);
  assertNoCallQueueRoutePermissionWiring(pages.callQueue);
  const persistedKeys = Array.from(
    pages.callQueue.matchAll(/(?:localStorage|sessionStorage)\.setItem\(\s*([^,\n]+)/g),
    (match) => match[1].trim()
  );
  assert.deepEqual(persistedKeys, ["STORAGE_KEY", "STORAGE_KEY"]);
  assert.doesNotMatch(pages.callQueue, /tickets\.filter\([^)]*(?:assignedTo|currentUser)/s);
});

test("Sprint 1.3E pages consume the shared shell, theme, Page Header, and maintenance lifecycle", () => {
  for (const [kind, moduleId] of [["admin", "anati-admin"], ["callQueue", "call-queue"]]) {
    const source = pages[kind];
    assert.ok(source.indexOf('src="assets/js/theme.js"') < source.indexOf('rel="stylesheet"'), `${kind} resolves theme before CSS`);
    assert.match(source, /<html[^>]+data-theme="light"/);
    for (const asset of [
      "assets/css/design-tokens.css", "app-shell.css", "assets/css/theme-base.css",
      "assets/css/pages/admin-call-queue.css"
    ]) assert.match(source, new RegExp(`href="${asset.replaceAll("/", "\\/")}"`));
    assert.match(source, /src="js\/auth\.js"/);
    assert.match(source, /src="js\/permissions\.js"/);
    assert.match(source, /src="js\/maintenance\.js" defer/);
    assert.match(source, /src="js\/app-shell\.js" defer/);
    assert.match(source, /src="js\/internal-page-shell\.js" defer/);
    assert.match(source, new RegExp(`data-shell-module="${moduleId}"`));
    assert.match(source, /class="cc-shell-layout has-responsive-navigation"/);
    assert.match(source, /<aside id="internal-app-sidebar" aria-label="Application navigation"><\/aside>/);
    assert.match(source, /<header id="internal-app-topbar" role="banner">/);
    assert.match(source, /id="internal-nav-backdrop" class="cc-shell-nav-backdrop"/);
    assert.match(source, /<header class="cc-page-header">/);
    assert.equal((source.match(/<h1\b/g) || []).length, 1, `${kind} has one h1`);
    assert.doesNotMatch(source, /class="(?:sidebar|topbar|nav|brand|logout)"/);
    assert.doesNotMatch(source, /function logout\s*\(/);
    assert.equal((source.match(/admin-users\?my-access=1/g) || []).length, 0);
    assert.equal((source.match(/\.netlify\/functions\/maintenance/g) || []).length, 0);
  }
  assert.match(internalShellRuntime, /CloudCrowdAppShell\.initializeAppShell/);
  assert.match(internalShellRuntime, /CloudCrowdMaintenance\.createLifecycle/);
  assert.match(maintenanceRuntime, /const POLL_INTERVAL = 3000/);
});

test("approved registry boundaries and direct-route enforcement stay distinct", async () => {
  const adminShell = loadRegistry("admin", "Anati");
  const adminModule = adminShell.getModuleById("anati-admin");
  const queueModule = adminShell.getModuleById("call-queue");
  assert.equal(adminModule.anatiOnly, true);
  assert.equal(adminModule.permissionKey, "anati_admin");
  assert.equal(queueModule.hidden, true);
  assert.equal(queueModule.permissionKey, "call_queue");
  assert.equal(adminShell.getSidebarModules().some((module) => module.id === "call-queue"), false);
  assert.equal(adminShell.getDashboardModules().some((module) => module.id === "call-queue"), false);
  assert.match(pages.admin, /requirePageAccess\('anati_admin'\)/);
  assert.equal((pages.admin.match(/requirePageAccess\(/g) || []).length, 1);
  assertNoCallQueueRoutePermissionWiring(pages.callQueue);
  assert.match(pages.callQueue, /const allowedCallQueueRoles = \['admin', 'manager'\]/);
});

test("Call Queue complete route and navigation lifecycle ignores configured and fallback permission state", async () => {
  for (const [role, permissionMode] of [
    ["admin", "allow"], ["admin", "deny"],
    ["manager", "allow"], ["manager", "deny"],
    ["agent", "allow"], ["agent", "deny"],
    ["manager", "legacy"], ["agent", "legacy"]
  ]) {
    assertApprovedCallQueuePolicy(await evaluateCallQueueLifecycle(role, permissionMode));
  }
  assertNoCallQueueRoutePermissionWiring(pages.callQueue);
});

test("shared internal-page lifecycle permission-gate mutant fails Call Queue route policy", async () => {
  const mutantRuntime = permissionGatedInternalShellRuntime();

  const managerDeny = await executeCompleteCallQueueLifecycle("manager", "deny", {
    internalShellRuntime: mutantRuntime,
    mutantName: "fixture-internal-page-shell-permission-gate.js"
  });
  assert.deepEqual(managerDeny.permissionCalls.requirePageAccess.map(([moduleKey]) => moduleKey), ["call_queue"]);
  assert.deepEqual(managerDeny.redirects, ["dashboard.html"]);
  assert.equal(managerDeny.navigationVisible, false);
  assert.throws(() => assertApprovedCallQueuePolicy(managerDeny),
    /Call Queue route policy: manager\/deny/);

  const agentAllow = await executeCompleteCallQueueLifecycle("agent", "allow", {
    internalShellRuntime: mutantRuntime,
    mutantName: "fixture-internal-page-shell-permission-gate.js"
  });
  assert.equal(agentAllow.routeAllowed, false, "the local Agent role denial remains authoritative");
  assert.equal(agentAllow.navigationVisible, false);
  assert.deepEqual(agentAllow.permissionCalls.requirePageAccess.map(([moduleKey]) => moduleKey), ["call_queue"]);
  assert.throws(() => assertApprovedCallQueuePolicy(agentAllow),
    /must not call requirePageAccess: agent\/allow/);
});

test("negative Call Queue policy fixtures detect permission-driven routes, visibility, and alternate syntax", async () => {
  const managerDeny = await evaluateCallQueueLifecycle("manager", "deny");
  const managerAccess = await managerDeny.permissionRuntime.getMyAccess("call_queue");
  await assert.rejects(async () => assertApprovedCallQueuePolicy({
    ...managerDeny,
    routeAllowed: managerAccess.canView
  }), /Call Queue route policy/);

  const agentAllow = await evaluateCallQueueLifecycle("agent", "allow");
  const agentAccess = await agentAllow.permissionRuntime.getMyAccess("call_queue");
  await assert.rejects(async () => assertApprovedCallQueuePolicy({
    ...agentAllow,
    routeAllowed: agentAccess.canView
  }), /Call Queue route policy/);

  const managerAllow = await evaluateCallQueueLifecycle("manager", "allow");
  const accidentallyVisibleModules = managerAllow.appShell.getAllModules().map((module) =>
    module.id === "call-queue" ? { ...module, hidden: false } : module
  );
  const visible = await managerAllow.appShell.filterPermittedModules(accidentallyVisibleModules, { fallbackMode: "legacy" });
  await assert.rejects(async () => assertApprovedCallQueuePolicy({
    ...managerAllow,
    navigationVisible: visible.some((module) => module.id === "call-queue")
  }), /Call Queue navigation policy/);

  const doubleQuotedWiring = pages.callQueue.replace("</body>", `
    <script>window.CCPermissions.requirePageAccess(
      "call_queue"
    );</script>
  </body>`);
  assert.throws(() => assertNoCallQueueRoutePermissionWiring(doubleQuotedWiring),
    /must not invoke configured permission APIs/);
});

test("one memoized permission model supports Admin route access and both shared shells", async () => {
  const admin = loadPermissionIntegration("admin", "Anati", [
    { moduleKey: "anati_admin", canView: true, canCreate: true, canEdit: true, canDelete: true }
  ]);
  assert.equal(
    admin.context.CCPermissions.getMyAccessModel(),
    admin.context.CCPermissions.getMyAccessModel(),
    "Admin route and shell share one memoized model"
  );
  const adminModules = admin.context.CloudCrowdAppShell.getAllModules();
  const [routeAccess, permitted] = await Promise.all([
    admin.context.CCPermissions.requirePageAccess("anati_admin"),
    admin.context.CloudCrowdAppShell.filterPermittedModules(adminModules, { fallbackMode: "legacy" })
  ]);
  assert.equal(routeAccess.canView, true);
  assert.equal(permitted.some((module) => module.id === "anati-admin"), true);
  assert.equal(admin.fetchCalls.length, 0, "Anati full access resolves locally without broadening access");

  const queue = loadPermissionIntegration("manager", "Manager", [
    { moduleKey: "call_queue", canView: false, canCreate: false, canEdit: false, canDelete: false }
  ]);
  assert.equal(
    queue.context.CCPermissions.getMyAccessModel(),
    queue.context.CCPermissions.getMyAccessModel(),
    "Call Queue shell reuses one memoized model"
  );
  const queuePermitted = await queue.context.CloudCrowdAppShell.filterPermittedModules(
    queue.context.CloudCrowdAppShell.getAllModules(),
    { fallbackMode: "legacy" }
  );
  assert.equal(queuePermitted.some((module) => module.id === "call-queue"), false);
  assert.equal(queue.fetchCalls.length, 1);
  assert.equal(runAccessGuard("callQueue", "manager", "Manager"), "");
});

function cssNode(tag, classes, parent, options = {}) {
  return cssElement(tag, { classes, ...options }, parent);
}

function colorLayer(value) {
  const rgba = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/i);
  if (rgba) {
    return {
      channels: rgba.slice(1, 4).map(Number),
      alpha: rgba[4] === undefined ? 1 : Number(rgba[4])
    };
  }
  const color = colorFromValue(value);
  return {
    channels: color.slice(1).match(/../g).map((part) => parseInt(part, 16)),
    alpha: 1
  };
}

function colorHex(channels) {
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function paintedBackground(cascade, target) {
  for (let current = target; current; current = current.parent) {
    const declaration = cascade.winner(current, "background-color");
    if (!declaration) continue;
    const resolved = cascade.resolveValue(current, declaration.value);
    if (resolved === "transparent") continue;
    const layer = colorLayer(resolved);
    if (layer.alpha === 0) continue;
    if (layer.alpha === 1) return { color: colorHex(layer.channels), declaration, target: current };
    const backing = paintedBackground(cascade, current.parent);
    const composite = layer.channels.map((channel, index) =>
      channel * layer.alpha + parseInt(backing.color.slice(1).match(/../g)[index], 16) * (1 - layer.alpha)
    );
    return { color: colorHex(composite), declaration, target: current };
  }
  throw new Error(`${cascade.page}: no painted background found`);
}

function assertActualContrast(targets, name) {
  const target = targets.nodes[name];
  const foreground = effectiveColor(targets.cascade, target, "color");
  const background = paintedBackground(targets.cascade, target);
  const ratio = contrastRatio(foreground.color, background.color);
  assert.ok(ratio >= 4.5,
    `${targets.cascade.page} ${name} actual contrast ${ratio.toFixed(2)}:1 from ${foreground.declaration.sourceName} / ${background.declaration.sourceName}`);
  return { foreground, background, ratio };
}

function pageCascadeTargets(page, theme, options = {}) {
  const cascade = createCascade(ROOT, page, options);
  const html = cssNode("html", [], null, { attributes: { "data-theme": theme } });
  const kind = page === "anati-admin.html" ? "admin-center-page" : "call-queue-page";
  const body = cssNode("body", ["admin-call-queue-page", kind], html);
  const shell = cssNode("div", ["cc-shell-layout", "has-responsive-navigation"], body);
  const main = cssNode("main", ["cc-shell-main"], shell);
  const container = cssNode("div", ["admin-call-queue-container", kind === "admin-center-page" ? "admin-center-container" : "call-queue-container"], main);
  const pageHeader = cssNode("header", ["cc-page-header"], container);
  const headerContent = cssNode("div", ["cc-page-header-content"], pageHeader);
  const pageTitle = cssNode("h1", ["cc-page-header-title"], headerContent);
  const nodes = { body, shell, main, container, pageHeader, pageTitle };
  const contrastNames = ["body", "pageTitle"];

  if (page === "anati-admin.html") {
    const notice = cssNode("div", ["notice"], container);
    const stats = cssNode("section", ["stats"], container);
    const stat = cssNode("div", ["stat"], stats);
    const statLabel = cssNode("span", [], stat);
    const statValue = cssNode("strong", [], stat);
    const panel = cssNode("div", ["panel"], container);
    const panelTitle = cssNode("h3", [], panel);
    const panelText = cssNode("p", [], panel);
    const tableWrap = cssNode("div", ["table-wrap"], panel);
    const table = cssNode("table", [], tableWrap);
    const thead = cssNode("thead", [], table);
    const headerRow = cssNode("tr", [], thead);
    const tableHeader = cssNode("th", [], headerRow);
    const tbody = cssNode("tbody", [], table);
    const bodyRow = cssNode("tr", [], tbody);
    const tableCell = cssNode("td", [], bodyRow);
    const form = cssNode("form", [], panel);
    const label = cssNode("label", [], form);
    const input = cssNode("input", [], label);
    const select = cssNode("select", [], label);
    const primaryButton = cssNode("button", ["btn"], form);
    const secondaryButton = cssNode("button", ["btn", "secondary"], form);
    const message = cssNode("div", ["message"], panel);
    const errorMessage = cssNode("div", ["message", "error"], panel);
    const accessPanel = cssNode("section", ["panel"], container);
    const accessWrap = cssNode("div", ["table-wrap"], accessPanel);
    const accessTable = cssNode("table", ["access-table"], accessWrap);
    const accessBody = cssNode("tbody", [], accessTable);
    const accessRow = cssNode("tr", [], accessBody);
    const accessCell = cssNode("td", ["access-cell"], accessRow);
    const activeBadge = cssNode("span", ["chip", "active"], tableCell);
    const disabledBadge = cssNode("span", ["chip", "disabled"], tableCell);
    const warningBadge = cssNode("span", ["chip", "warning"], tableCell);
    const systemBadge = cssNode("span", ["chip", "system"], tableCell);
    const placeholder = cssNode("div", ["placeholder"], container);
    const placeholderTitle = cssNode("h3", [], placeholder);
    const placeholderText = cssNode("p", [], placeholder);
    Object.assign(nodes, {
      notice, stats, stat, statLabel, statValue, panel, panelTitle, panelText,
      tableWrap, table, tableHeader, tableCell, form, label, input, select,
      primaryButton, secondaryButton, message, errorMessage, accessPanel,
      accessWrap, accessTable, accessCell, activeBadge, disabledBadge,
      warningBadge, systemBadge, placeholder, placeholderTitle, placeholderText
    });
    contrastNames.push(
      "notice", "statLabel", "statValue", "panelTitle", "panelText",
      "tableHeader", "tableCell", "label", "input", "select",
      "primaryButton", "secondaryButton", "message", "errorMessage",
      "accessCell", "activeBadge", "disabledBadge", "warningBadge",
      "systemBadge", "placeholderTitle", "placeholderText"
    );
  } else {
    const workspace = cssNode("section", ["workspace"], container);
    const queuePanel = cssNode("div", ["panel", "queue-panel"], workspace);
    const queueItem = cssNode("button", ["ticket"], queuePanel);
    const queueTitle = cssNode("strong", [], queueItem);
    const queueMetadata = cssNode("span", [], queueItem);
    const selectedItem = cssNode("button", ["ticket", "active"], queuePanel);
    const selectedTitle = cssNode("strong", [], selectedItem);
    const selectedMetadata = cssNode("span", [], selectedItem);
    const selectedChip = cssNode("span", ["chip"], selectedItem);
    const detailPanel = cssNode("div", ["panel", "workspace-panel"], workspace);
    const detailHead = cssNode("div", ["detail-head"], detailPanel);
    const ticketTitle = cssNode("h3", [], detailHead);
    const statusBadge = cssNode("span", ["status-badge"], detailHead);
    const infoGrid = cssNode("div", ["info-grid"], detailPanel);
    const info = cssNode("div", ["info"], infoGrid);
    const infoLabel = cssNode("span", [], info);
    const infoValue = cssNode("strong", [], info);
    const imageBox = cssNode("div", ["image-box"], detailPanel);
    const imagePlaceholder = cssNode("div", ["placeholder-art"], imageBox);
    const notesBox = cssNode("div", ["notes-box"], detailPanel);
    const notesTitle = cssNode("h4", [], notesBox);
    const latestNote = cssNode("p", ["latest-note"], notesBox);
    const noteInput = cssNode("textarea", [], notesBox);
    const actions = cssNode("div", ["actions"], detailPanel);
    const actionTitle = cssNode("h4", [], actions);
    const primaryButton = cssNode("button", ["btn"], actions);
    const secondaryButton = cssNode("button", ["btn", "secondary"], actions);
    const warningButton = cssNode("button", ["btn", "warning"], actions);
    const dangerButton = cssNode("button", ["btn", "danger"], actions);
    const negativeDetails = cssNode("div", ["negative-details", "open"], actions);
    const negativeLabel = cssNode("label", [], negativeDetails);
    const negativeInput = cssNode("input", [], negativeDetails);
    const emptyState = cssNode("div", ["empty-state"], detailPanel);
    Object.assign(nodes, {
      workspace, queuePanel, queueItem, queueTitle, queueMetadata, selectedItem,
      selectedTitle, selectedMetadata, selectedChip, detailPanel, detailHead,
      ticketTitle, statusBadge, infoGrid, info, infoLabel, infoValue, imageBox,
      imagePlaceholder, notesBox, notesTitle, latestNote, noteInput, actions,
      actionTitle, primaryButton, secondaryButton, warningButton, dangerButton,
      negativeDetails, negativeLabel, negativeInput, emptyState
    });
    contrastNames.push(
      "queueItem", "queueTitle", "queueMetadata", "selectedItem",
      "selectedTitle", "selectedMetadata", "selectedChip", "ticketTitle",
      "statusBadge", "infoLabel", "infoValue", "imagePlaceholder",
      "notesTitle", "latestNote", "noteInput", "actionTitle", "primaryButton",
      "secondaryButton", "warningButton", "dangerButton", "negativeLabel",
      "negativeInput", "emptyState"
    );
  }
  return { cascade, nodes, contrastNames };
}

test("actual Admin and Call Queue descendants use readable semantic Light and Dark cascade winners", () => {
  for (const page of ["anati-admin.html", "call-queue.html"]) {
    for (const theme of ["light", "dark"]) {
      const targets = pageCascadeTargets(page, theme);
      assert.equal(targets.cascade.winner(targets.nodes.body, "background-color").value, "var(--color-bg)");
      assert.equal(targets.cascade.winner(
        targets.nodes[page === "anati-admin.html" ? "panel" : "queuePanel"], "background-color"
      ).value, "var(--color-surface)");
      targets.contrastNames.forEach((name) => assertActualContrast(targets, name));
    }
  }
});

function expectCascadeContrastFailure(page, targetName, css, theme = "dark") {
  const name = `fixture-${page}-${targetName}.css`;
  const targets = pageCascadeTargets(page, theme, { extraSources: [{ name, css }] });
  assert.equal(targets.cascade.winner(targets.nodes[targetName], "color").sourceName, name);
  assert.throws(() => assertActualContrast(targets, targetName), /actual contrast/);
}

test("high-specificity fixtures fail actual descendant contrast assertions", () => {
  expectCascadeContrastFailure("call-queue.html", "selectedTitle",
    ".admin-call-queue-page.call-queue-page .queue-panel .ticket.active strong { color: var(--color-surface-muted); }");
  expectCascadeContrastFailure("call-queue.html", "statusBadge",
    ".admin-call-queue-page.call-queue-page .workspace-panel .status-badge { color: var(--color-info-soft); background-color: var(--color-info-soft); }");
  expectCascadeContrastFailure("call-queue.html", "negativeInput",
    ".admin-call-queue-page.call-queue-page .negative-details input { color: var(--color-warning-soft); background-color: var(--color-warning-soft); }");
  expectCascadeContrastFailure("anati-admin.html", "tableCell",
    ".admin-call-queue-page.admin-center-page .panel .table-wrap table tbody td { color: var(--color-surface); }");
  expectCascadeContrastFailure("anati-admin.html", "activeBadge",
    ".admin-call-queue-page.admin-center-page .table-wrap .chip.active { color: var(--color-success-soft); background-color: var(--color-success-soft); }");
  expectCascadeContrastFailure("anati-admin.html", "placeholderText",
    ".admin-call-queue-page.admin-center-page .placeholder p { color: var(--color-surface); }");
});

function assertAdminGeometry(width, extraSources = []) {
  const targets = pageCascadeTargets("anati-admin.html", "light", { viewportWidth: width, extraSources });
  const { cascade, nodes } = targets;
  assert.equal(cascade.winner(nodes.main, "min-width").value, "0");
  assert.equal(cascade.winner(nodes.container, "min-width").value, "0");
  for (const wrapper of [nodes.tableWrap, nodes.accessWrap]) {
    const horizontalOverflow = cascade.winner(wrapper, "overflow-x") || cascade.winner(wrapper, "overflow");
    assert.equal(horizontalOverflow.value, "auto", `Admin ${width}px horizontal access`);
    assert.equal(cascade.winner(wrapper, "max-width").value, "100%");
  }
  assert.equal(cascade.winner(nodes.table, "min-width").value, "760px");
  assert.equal(cascade.winner(nodes.accessTable, "min-width").value, "760px");
}

test("Admin tables and access matrix retain actual horizontal access at every required width", () => {
  [1440, 1280, 1024, 768, 390, 360, 320].forEach((width) => assertAdminGeometry(width));
  const clippingFixture = [{
    name: "fixture-admin-overflow.css",
    css: ".admin-call-queue-page.admin-center-page .panel .table-wrap { overflow-x: hidden; }"
  }];
  assert.throws(() => assertAdminGeometry(390, clippingFixture), /horizontal access/);
});

test("Call Queue retains actual wide, collapsed, narrow-detail, and scrolling geometry", () => {
  for (const width of [1440, 1280, 1024, 768, 390, 360, 320]) {
    const targets = pageCascadeTargets("call-queue.html", "light", { viewportWidth: width });
    const { cascade, nodes } = targets;
    assert.equal(cascade.winner(nodes.main, "min-width").value, "0");
    assert.equal(cascade.winner(nodes.workspace, "grid-template-columns").value,
      width > 1080 ? "minmax(330px,.82fr) minmax(0,1.18fr)" : "1fr");
    const queueOverflow = cascade.winner(nodes.queuePanel, "overflow-y") || cascade.winner(nodes.queuePanel, "overflow");
    assert.equal(queueOverflow.value, "auto");
    assert.equal(cascade.winner(nodes.infoGrid, "grid-template-columns").value,
      width <= 680 ? "1fr" : "repeat(2,minmax(0,1fr))");
    assert.equal(cascade.winner(nodes.container, "padding").value,
      width <= 620 ? "var(--page-padding-mobile)" : width <= 1024 ? "var(--page-padding-tablet)" : "var(--page-padding-desktop)");
  }
});
