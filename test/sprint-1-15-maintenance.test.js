"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const maintenanceSource = read("js/maintenance.js");
const backendSource = read("netlify/functions/maintenance.js");
const dashboardSource = read("js/dashboard.js");
const systemUpdateSource = read("system-update.html");
const LEGACY_PAGES = ["cctv.html", "ce.html", "complaints.html", "free-orders.html"];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function jsonResponse(data, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || (options.ok === false ? 500 : 200),
    json: options.jsonError
      ? async () => { throw options.jsonError; }
      : async () => data
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

class FakeTimers {
  constructor() {
    this.nextId = 1;
    this.intervals = new Map();
    this.timeouts = new Map();
  }
  setInterval(callback, delay) {
    const id = this.nextId++;
    this.intervals.set(id, { callback, delay });
    return id;
  }
  clearInterval(id) { this.intervals.delete(id); }
  setTimeout(callback, delay) {
    const id = this.nextId++;
    this.timeouts.set(id, { callback, delay });
    return id;
  }
  clearTimeout(id) { this.timeouts.delete(id); }
  async tickIntervals() {
    await Promise.all([...this.intervals.values()].map(({ callback }) => callback()));
    await flush();
  }
  fireTimeouts() {
    const pending = [...this.timeouts.entries()];
    this.timeouts.clear();
    pending.forEach(([, { callback }]) => callback());
  }
}

class FakeButton {
  constructor() {
    this.hidden = true;
    this.disabled = false;
    this.textContent = "OFF";
    this.title = "";
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = { toggle() {} };
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  listenerCount(type) { return this.listeners.get(type)?.size || 0; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
}

function loadMaintenance(options = {}) {
  const timers = options.timers || new FakeTimers();
  const fetchCalls = [];
  const replacements = [];
  const windowListeners = new Map();
  const sessionValues = {
    cc_token: "maintenance-token",
    cc_user: options.user || "Employee",
    cc_role: options.role || "operator",
    cc_auth: "1"
  };
  const context = {
    console: { warn() {}, error() {} },
    fetch(url, request = {}) {
      fetchCalls.push({ url, request });
      return (options.fetch || (() => jsonResponse({ maintenance: false, admin: false })))(url, request, fetchCalls.length);
    },
    location: {
      href: options.href || "dashboard.html",
      replace(route) { replacements.push(route); }
    },
    sessionStorage: { getItem(key) { return sessionValues[key] || null; } },
    setInterval: timers.setInterval.bind(timers),
    clearInterval: timers.clearInterval.bind(timers),
    setTimeout: timers.setTimeout.bind(timers),
    clearTimeout: timers.clearTimeout.bind(timers),
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { windowListeners.get(type)?.delete(listener); },
    CloudCrowdConfirmation: {
      request: options.confirmation || (async () => true)
    }
  };
  context.window = context;
  vm.runInNewContext(options.source || maintenanceSource, context, { filename: "js/maintenance.js" });
  return { context, timers, fetchCalls, replacements, windowListeners, sessionValues };
}

function replaceExact(source, before, after, label) {
  assert.equal(source.includes(before), true, `${label}: mutation target missing`);
  const mutated = source.replace(before, after);
  assert.notEqual(mutated, source, `${label}: source was not mutated`);
  new vm.Script(mutated, { filename: `${label}.js` });
  return mutated;
}

function extractInlineScripts(source) {
  return [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
}

function dispatchWindow(loaded, type, event = {}) {
  for (const listener of [...(loaded.windowListeners.get(type) || [])]) listener(event);
}

class DashboardElement extends FakeButton {
  constructor(tagName, id = "") {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.id = id;
    this.hidden = false;
    this.children = [];
    this.dataset = {};
    this.className = "";
    this.href = "";
    this.type = "";
    this.parentNode = null;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  get firstChild() { return this.children[0] || null; }
}

function loadComposedDashboard(options = {}) {
  const timers = options.timers || new FakeTimers();
  const elements = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const maintenanceFetchCalls = [];
  const permissionCalls = [];
  const shellInitializations = [];
  const register = (tag, id) => {
    const element = new DashboardElement(tag, id);
    elements.set(id, element);
    return element;
  };
  [
    ["div", "dashboard-shell"],
    ["aside", "dashboard-app-sidebar"],
    ["header", "dashboard-app-topbar"],
    ["button", "dashboard-nav-backdrop"],
    ["button", "maintenance-toggle-btn"],
    ["div", "dashboard-launcher-state"],
    ["div", "dashboard-modules"]
  ].forEach(([tag, id]) => register(tag, id));
  elements.get("dashboard-modules").hidden = true;

  const document = {
    visibilityState: "visible",
    createElement(tag) { return new DashboardElement(tag); },
    getElementById(id) { return elements.get(id) || null; },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { documentListeners.get(type)?.delete(listener); }
  };
  const permissionResult = options.permissionResult || {
    available: true,
    reason: "",
    access: [{ moduleKey: "cctv", canView: true, canCreate: false, canEdit: false, canDelete: false }]
  };
  const projectModules = (model) => model?.available === true && model.access.some((record) => record.moduleKey === "cctv" && record.canView)
    ? [{ id: "cctv", showInDashboard: true }]
    : [];
  const context = {
    document,
    console: { warn() {}, log() {}, error() {} },
    sessionStorage: { getItem(key) { return key === "cc_token" ? "dashboard-token" : ""; } },
    fetch(url, request = {}) {
      maintenanceFetchCalls.push({ url, request });
      return options.fetch(url, request, maintenanceFetchCalls.length);
    },
    setTimeout: timers.setTimeout.bind(timers),
    clearTimeout: timers.clearTimeout.bind(timers),
    setInterval: timers.setInterval.bind(timers),
    clearInterval: timers.clearInterval.bind(timers)
  };
  const window = {
    ...context,
    location: { pathname: "/dashboard.html", href: "dashboard.html" },
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { windowListeners.get(type)?.delete(listener); },
    CloudCrowdConfirmation: { request: async () => true },
    CCPermissions: {
      getMyAccessModel(request) {
        permissionCalls.push(request);
        return Promise.resolve(permissionResult);
      }
    },
    CloudCrowdAppShell: {
      getModuleById(id) { return { id }; },
      async initializeAppShell(configuration) {
        shellInitializations.push(configuration);
        return {
          permittedModules: projectModules(configuration.accessModel),
          async refreshModules(model) {
            this.permittedModules = projectModules(model);
            return this.permittedModules;
          },
          clearPermissionModules() { this.permittedModules = []; }
        };
      },
      async renderDashboardModules(container, configuration) {
        while (container.firstChild) container.removeChild(container.firstChild);
        configuration.modules.forEach((module) => {
          const card = new DashboardElement("a");
          card.dataset.moduleId = module.id;
          container.appendChild(card);
        });
      }
    },
    clearStoredSession() {},
    logout() {}
  };
  window.window = window;
  context.window = window;
  context.location = window.location;
  context.CloudCrowdConfirmation = window.CloudCrowdConfirmation;
  vm.runInNewContext(options.maintenanceSource || maintenanceSource, context, { filename: "js/maintenance.js" });
  const lifecycles = [];
  const createLifecycle = window.CloudCrowdMaintenance.createLifecycle;
  window.CloudCrowdMaintenance.createLifecycle = (configuration) => {
    const lifecycle = createLifecycle(configuration);
    lifecycles.push(lifecycle);
    return lifecycle;
  };
  vm.runInNewContext(dashboardSource, context, { filename: "js/dashboard.js" });
  return {
    context,
    window,
    timers,
    elements,
    windowListeners,
    documentListeners,
    maintenanceFetchCalls,
    permissionCalls,
    shellInitializations,
    lifecycles,
    cards() { return elements.get("dashboard-modules").children; }
  };
}

test("normal lifecycle owns one seeded GET stream and toggle rendering performs no GET", async () => {
  const loaded = loadMaintenance({ fetch: async () => jsonResponse({ maintenance: false, admin: true }) });
  const button = new FakeButton();
  const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle({ button });

  await lifecycle.enforceMaintenanceMode();
  assert.equal(loaded.fetchCalls.length, 1);
  lifecycle.startEnforcement();
  lifecycle.startEnforcement();
  lifecycle.startToggleUpdates();
  lifecycle.startToggleUpdates();

  assert.equal(loaded.fetchCalls.length, 1, "the authoritative seed is reused");
  assert.equal(loaded.timers.intervals.size, 1);
  assert.equal([...loaded.timers.intervals.values()][0].delay, 3000);
  assert.equal(button.listenerCount("click"), 1);
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, "OFF");

  await loaded.timers.tickIntervals();
  assert.equal(loaded.fetchCalls.length, 2);
});

test("in-flight ownership, timeout, and late-result isolation prevent accumulation", async () => {
  const first = deferred();
  const second = deferred();
  const queue = [first, second];
  const loaded = loadMaintenance({ fetch: () => queue.shift().promise });
  const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle();
  lifecycle.startEnforcement();
  await flush();
  assert.equal(loaded.fetchCalls.length, 1);

  [...loaded.timers.intervals.values()].forEach(({ callback }) => callback());
  [...loaded.timers.intervals.values()].forEach(({ callback }) => callback());
  assert.equal(loaded.fetchCalls.length, 1, "poll ticks share the unresolved GET");

  assert.equal([...loaded.timers.timeouts.values()][0].delay, 10000);
  loaded.timers.fireTimeouts();
  await flush();
  assert.equal(loaded.context.location.href, "system-update.html");
  assert.equal(lifecycle.getState().status, "unavailable");

  const poll = [...loaded.timers.intervals.values()][0].callback();
  await flush();
  assert.equal(loaded.fetchCalls.length, 2, "polling resumes after bounded completion");
  second.resolve(jsonResponse({ maintenance: true, admin: false }));
  await poll;
  first.resolve(jsonResponse({ maintenance: false, admin: false }));
  await flush();
  assert.equal(lifecycle.getState().maintenance, true, "timed-out late OFF is ignored");
});

test("normal authority failures and malformed payloads fail closed without local spoofing", async (t) => {
  const cases = [
    ["network", async () => { throw new Error("network"); }],
    ["HTTP", async () => jsonResponse({}, { ok: false, status: 503 })],
    ["malformed JSON", async () => jsonResponse({}, { jsonError: new Error("json") })],
    ["malformed payload", async () => jsonResponse({ maintenance: "off", admin: false })]
  ];
  for (const [name, fetch] of cases) {
    await t.test(name, async () => {
      const loaded = loadMaintenance({ fetch, user: "Anati", role: "admin" });
      const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle();
      await lifecycle.enforceMaintenanceMode();
      assert.equal(loaded.context.location.href, "system-update.html");
      assert.equal(lifecycle.getState().status, "unavailable");
    });
  }

  const spoofed = loadMaintenance({
    user: "Anati",
    role: "admin",
    fetch: async () => jsonResponse({ maintenance: true, admin: false })
  });
  await spoofed.context.CloudCrowdMaintenance.createLifecycle().enforceMaintenanceMode();
  assert.equal(spoofed.context.location.href, "system-update.html");

  const ordinary = loadMaintenance({ fetch: async () => jsonResponse({ maintenance: false, admin: false }) });
  const ordinaryButton = new FakeButton();
  const ordinaryLifecycle = ordinary.context.CloudCrowdMaintenance.createLifecycle({ button: ordinaryButton });
  await ordinaryLifecycle.enforceMaintenanceMode();
  ordinaryLifecycle.startToggleUpdates();
  assert.equal(ordinaryButton.hidden, true);
});

test("verified Anati toggle consumes shared state and POST publishes without a follow-up GET", async () => {
  let confirm = false;
  const loaded = loadMaintenance({
    confirmation: async () => confirm,
    fetch: async (_url, request) => request.method === "POST"
      ? jsonResponse({ maintenance: true })
      : jsonResponse({ maintenance: false, admin: true })
  });
  const button = new FakeButton();
  const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle({ button });
  await lifecycle.enforceMaintenanceMode();
  lifecycle.startEnforcement();
  lifecycle.startToggleUpdates();
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, "OFF");

  assert.equal(await lifecycle.toggleMaintenanceMode(), false);
  assert.equal(loaded.fetchCalls.filter(({ request }) => request.method === "POST").length, 0);

  confirm = true;
  assert.equal(await lifecycle.toggleMaintenanceMode(), true);
  const posts = loaded.fetchCalls.filter(({ request }) => request.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].request.body), { maintenance: true });
  assert.equal(loaded.fetchCalls.length, 2, "POST success does not trigger a synchronization GET");
  assert.equal(lifecycle.getState().maintenance, true);
  assert.equal(button.textContent, "ON");
  assert.equal(button.disabled, false);
});

test("POST failures are non-optimistic and malformed envelopes are rejected", async (t) => {
  for (const [name, postResponse] of [
    ["HTTP", jsonResponse({}, { ok: false, status: 500 })],
    ["malformed", jsonResponse({ maintenance: "on" })]
  ]) {
    await t.test(name, async () => {
      const loaded = loadMaintenance({
        fetch: async (_url, request) => request.method === "POST"
          ? postResponse
          : jsonResponse({ maintenance: false, admin: true })
      });
      const button = new FakeButton();
      const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle({ button });
      await lifecycle.enforceMaintenanceMode();
      lifecycle.startToggleUpdates();
      assert.equal(await lifecycle.toggleMaintenanceMode(), false);
      assert.equal(lifecycle.getState().maintenance, false);
      assert.equal(button.textContent, "OFF");
      assert.equal(button.disabled, false);
    });
  }
});

test("successful POST supersedes an older enforcement GET", async () => {
  const oldGet = deferred();
  let getCount = 0;
  const loaded = loadMaintenance({
    fetch: async (_url, request) => {
      if (request.method === "POST") return jsonResponse({ maintenance: true });
      getCount += 1;
      if (getCount === 1) return jsonResponse({ maintenance: false, admin: true });
      return oldGet.promise;
    }
  });
  const button = new FakeButton();
  const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle({ button });
  await lifecycle.enforceMaintenanceMode();
  lifecycle.startEnforcement();
  lifecycle.startToggleUpdates();
  const poll = [...loaded.timers.intervals.values()][0].callback();
  await flush();
  assert.equal(await lifecycle.toggleMaintenanceMode(), true);
  oldGet.resolve(jsonResponse({ maintenance: false, admin: true }));
  await poll;
  assert.equal(lifecycle.getState().maintenance, true);
  assert.equal(button.textContent, "ON");
});

test("teardown owns interval, click, page lifecycle, pending work, and is idempotent", async () => {
  const pending = deferred();
  const loaded = loadMaintenance({ fetch: () => pending.promise });
  const button = new FakeButton();
  const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle({ button });
  lifecycle.startEnforcement();
  lifecycle.startToggleUpdates();
  await flush();
  assert.equal(button.listenerCount("click"), 1);
  assert.equal(loaded.timers.intervals.size, 1);
  assert.equal(loaded.windowListeners.get("pagehide").size, 1);
  assert.equal(loaded.windowListeners.get("pageshow").size, 1);

  lifecycle.teardown();
  lifecycle.teardown();
  assert.equal(button.listenerCount("click"), 0);
  assert.equal(loaded.timers.intervals.size, 0);
  assert.equal(loaded.timers.timeouts.size, 0);
  assert.equal(loaded.windowListeners.get("pagehide").size, 0);
  assert.equal(loaded.windowListeners.get("pageshow").size, 0);
  pending.resolve(jsonResponse({ maintenance: true, admin: false }));
  await flush();
  assert.notEqual(loaded.context.location.href, "system-update.html");

  const replacement = loaded.context.CloudCrowdMaintenance.createLifecycle();
  replacement.startEnforcement();
  assert.equal(loaded.timers.intervals.size, 1, "a new lifecycle starts cleanly");
});

test("normal lifecycle restores fresh BFCache authority and preserves one resource set", async (t) => {
  for (const [name, restored, redirected] of [
    ["OFF", { maintenance: false, admin: false }, false],
    ["ON ordinary", { maintenance: true, admin: false }, true],
    ["ON verified Anati", { maintenance: true, admin: true }, false],
    ["unavailable", null, true]
  ]) {
    await t.test(name, async () => {
      let current = { maintenance: false, admin: true };
      const loaded = loadMaintenance({
        user: "Anati",
        role: "admin",
        fetch: async () => {
          if (current === null) throw new Error("offline");
          return jsonResponse(current);
        }
      });
      const button = new FakeButton();
      const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle({ button });
      lifecycle.startEnforcement();
      lifecycle.startToggleUpdates();
      await flush();

      dispatchWindow(loaded, "pagehide", { persisted: true });
      assert.equal(loaded.timers.intervals.size, 0);
      assert.equal(loaded.timers.timeouts.size, 0);
      assert.equal(lifecycle.getState().status, "unknown");
      assert.equal(button.hidden, true, "stale toggle authority is hidden while suspended");
      current = restored;
      dispatchWindow(loaded, "pageshow", { persisted: true });
      await flush();

      assert.equal(loaded.fetchCalls.length, 2, "restore performs one immediate fresh GET");
      assert.equal(loaded.timers.intervals.size, 1);
      assert.equal(loaded.windowListeners.get("pagehide").size, 1);
      assert.equal(loaded.windowListeners.get("pageshow").size, 1);
      assert.equal(button.listenerCount("click"), 1);
      assert.equal(loaded.context.location.href === "system-update.html", redirected);
      if (name === "ON verified Anati") {
        assert.equal(button.hidden, false);
        assert.equal(button.textContent, "ON");
      }
    });
  }

  await t.test("restore timeout fails closed", async () => {
    let restore = false;
    const loaded = loadMaintenance({ fetch: async () => restore
      ? new Promise(() => {})
      : jsonResponse({ maintenance: false, admin: false }) });
    const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle();
    lifecycle.startEnforcement();
    await flush();
    dispatchWindow(loaded, "pagehide", { persisted: true });
    restore = true;
    dispatchWindow(loaded, "pageshow", { persisted: true });
    await flush();
    assert.equal([...loaded.timers.timeouts.values()][0].delay, 10000);
    loaded.timers.fireTimeouts();
    await flush();
    assert.equal(lifecycle.getState().status, "unavailable");
    assert.equal(loaded.context.location.href, "system-update.html");
  });
});

test("normal BFCache restoration rejects every stale pre-hide authority result", async (t) => {
  for (const [name, stale, restored] of [
    ["old OFF after new ON", { maintenance: false, admin: false }, { maintenance: true, admin: false }],
    ["old ON after new OFF", { maintenance: true, admin: false }, { maintenance: false, admin: false }],
    ["old admin after new ordinary ON", { maintenance: true, admin: true }, { maintenance: true, admin: false }]
  ]) {
    await t.test(name, async () => {
      const old = deferred();
      const fresh = deferred();
      const queue = [old, fresh];
      const loaded = loadMaintenance({ fetch: () => queue.shift().promise, user: "Anati", role: "admin" });
      const button = new FakeButton();
      const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle({ button });
      lifecycle.startEnforcement();
      lifecycle.startToggleUpdates();
      await flush();
      dispatchWindow(loaded, "pagehide", { persisted: true });
      dispatchWindow(loaded, "pageshow", { persisted: true });
      await flush();
      fresh.resolve(jsonResponse(restored));
      await flush();
      old.resolve(jsonResponse(stale));
      await flush();
      assert.equal(lifecycle.getState().maintenance, restored.maintenance);
      assert.equal(lifecycle.getState().admin, restored.admin);
      assert.equal(loaded.context.location.href === "system-update.html", restored.maintenance && !restored.admin);
    });
  }
});

test("normal lifecycle survives repeated BFCache cycles but explicit teardown never resurrects", async () => {
  const loaded = loadMaintenance({ fetch: async () => jsonResponse({ maintenance: false, admin: true }) });
  const button = new FakeButton();
  const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle({ button });
  lifecycle.startEnforcement();
  lifecycle.startToggleUpdates();
  await flush();

  for (let cycle = 0; cycle < 2; cycle += 1) {
    dispatchWindow(loaded, "pagehide", { persisted: true });
    assert.equal(loaded.timers.intervals.size, 0);
    dispatchWindow(loaded, "pageshow", { persisted: true });
    await flush();
    assert.equal(loaded.timers.intervals.size, 1);
    assert.equal(loaded.windowListeners.get("pagehide").size, 1);
    assert.equal(loaded.windowListeners.get("pageshow").size, 1);
    assert.equal(button.listenerCount("click"), 1);
  }
  assert.equal(loaded.fetchCalls.length, 3);

  lifecycle.teardown();
  lifecycle.teardown();
  assert.equal(loaded.timers.intervals.size, 0);
  assert.equal(loaded.windowListeners.get("pagehide").size, 0);
  assert.equal(loaded.windowListeners.get("pageshow").size, 0);
  assert.equal(button.listenerCount("click"), 0);
  dispatchWindow(loaded, "pageshow", { persisted: true });
  lifecycle.startEnforcement();
  assert.equal(loaded.timers.intervals.size, 0);
  assert.equal(loaded.fetchCalls.length, 3);
});

test("non-BFCache pagehide permanently tears down normal and recovery lifecycles", async () => {
  for (const kind of ["normal", "recovery"]) {
    const loaded = loadMaintenance({ fetch: async () => jsonResponse({ maintenance: true, admin: false }), href: kind === "recovery" ? "system-update.html" : "dashboard.html" });
    const lifecycle = kind === "normal"
      ? loaded.context.CloudCrowdMaintenance.createLifecycle()
      : loaded.context.CloudCrowdMaintenance.createRecoveryLifecycle();
    if (kind === "normal") lifecycle.startEnforcement();
    else lifecycle.start();
    await flush();
    dispatchWindow(loaded, "pagehide", { persisted: false });
    assert.equal(loaded.timers.intervals.size, 0);
    assert.equal(loaded.timers.timeouts.size, 0);
    assert.equal(loaded.windowListeners.get("pagehide").size, 0);
    assert.equal(loaded.windowListeners.get("pageshow").size, 0);
    dispatchWindow(loaded, "pageshow", { persisted: true });
    assert.equal(loaded.fetchCalls.length, 1);
  }
});

test("a pre-hide POST cannot publish over fresh restored toggle authority", async () => {
  const oldPost = deferred();
  let getCount = 0;
  const loaded = loadMaintenance({ fetch: async (_url, request) => {
    if (request.method === "POST") return oldPost.promise;
    getCount += 1;
    return jsonResponse({ maintenance: false, admin: true });
  } });
  const button = new FakeButton();
  const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle({ button });
  lifecycle.startEnforcement();
  lifecycle.startToggleUpdates();
  await flush();
  const mutation = lifecycle.toggleMaintenanceMode();
  await flush();
  assert.equal(button.disabled, true);
  dispatchWindow(loaded, "pagehide", { persisted: true });
  dispatchWindow(loaded, "pageshow", { persisted: true });
  await flush();
  assert.equal(getCount, 2);
  oldPost.resolve(jsonResponse({ maintenance: true }));
  assert.equal(await mutation, false);
  assert.equal(lifecycle.getState().maintenance, false);
  assert.equal(button.textContent, "OFF");
  assert.equal(button.listenerCount("click"), 1);
});

test("Dashboard call order reuses one authoritative GET and schedules the next at 3000 ms", async () => {
  assert.match(dashboardSource, /await withAuthorityTimeout\(maintenance\.enforceMaintenanceMode\(\), 'maintenance'\)/);
  assert.match(dashboardSource, /maintenance\.startEnforcement\(\)/);
  assert.match(dashboardSource, /maintenance\.startToggleUpdates\(\)/);
  const loaded = loadMaintenance({ fetch: async () => jsonResponse({ maintenance: false, admin: false }) });
  const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle({ button: new FakeButton() });
  await lifecycle.enforceMaintenanceMode();
  lifecycle.startEnforcement();
  lifecycle.startToggleUpdates();
  assert.equal(loaded.fetchCalls.length, 1);
  assert.equal(loaded.timers.intervals.size, 1);
  assert.equal([...loaded.timers.intervals.values()][0].delay, 3000);
});

test("Dashboard initial-gate BFCache restore remains singular before later startup calls", async () => {
  const old = deferred();
  const fresh = deferred();
  const queue = [old, fresh];
  const loaded = loadMaintenance({ fetch: () => queue.shift().promise });
  const button = new FakeButton();
  const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle({ button });
  const initialGate = lifecycle.enforceMaintenanceMode();
  await flush();
  dispatchWindow(loaded, "pagehide", { persisted: true });
  dispatchWindow(loaded, "pageshow", { persisted: true });
  await flush();
  fresh.resolve(jsonResponse({ maintenance: false, admin: true }));
  await flush();
  await initialGate;
  lifecycle.startEnforcement();
  lifecycle.startToggleUpdates();
  assert.equal(loaded.fetchCalls.length, 2);
  assert.equal(loaded.timers.intervals.size, 1);
  assert.equal(button.listenerCount("click"), 1);
  old.resolve(jsonResponse({ maintenance: true, admin: false }));
  await flush();
  assert.equal(lifecycle.getState().maintenance, false);
  assert.equal(loaded.context.location.href, "dashboard.html");
});

test("composed Dashboard and production Maintenance keep the initial gate behind BFCache restore", async (t) => {
  for (const [name, restored, expected] of [
    ["OFF", { maintenance: false, admin: false }, { permissions: 1, cards: 1, href: "dashboard.html" }],
    ["ON ordinary", { maintenance: true, admin: false }, { permissions: 0, cards: 0, href: "system-update.html" }],
    ["ON verified Anati", { maintenance: true, admin: true }, { permissions: 1, cards: 1, href: "dashboard.html" }]
  ]) {
    await t.test(name, async () => {
      const old = deferred();
      const fresh = deferred();
      const queue = [old, fresh];
      const loaded = loadComposedDashboard({ fetch: () => queue.shift().promise });
      await flush();
      assert.equal(loaded.maintenanceFetchCalls.length, 1);
      assert.equal(loaded.permissionCalls.length, 0);
      assert.equal(loaded.cards().length, 0);

      dispatchWindow(loaded, "pagehide", { persisted: true });
      await flush();
      assert.equal(loaded.permissionCalls.length, 0, "suspension is not authority completion");
      assert.equal(loaded.cards().length, 0);

      dispatchWindow(loaded, "pageshow", { persisted: true });
      await flush();
      assert.equal(loaded.maintenanceFetchCalls.length, 2);
      assert.equal(loaded.permissionCalls.length, 0, "fresh restored authority remains pending");
      assert.equal(loaded.cards().length, 0);
      assert.equal(loaded.timers.intervals.size, 1);

      fresh.resolve(jsonResponse(restored));
      await flush();
      assert.equal(loaded.permissionCalls.length, expected.permissions);
      assert.equal(loaded.cards().length, expected.cards);
      assert.equal(loaded.window.location.href, expected.href);
      old.resolve(jsonResponse({ maintenance: !restored.maintenance, admin: false }));
      await flush();
      assert.equal(loaded.permissionCalls.length, expected.permissions);
      assert.equal(loaded.cards().length, expected.cards);
      assert.equal(loaded.window.location.href, expected.href);
    });
  }
});

test("composed Dashboard restored gate fails closed on unavailable and timeout", async (t) => {
  for (const [name, restoredResponse] of [
    ["network unavailable", () => Promise.reject(new Error("offline"))],
    ["HTTP unavailable", () => Promise.resolve(jsonResponse({}, { ok: false, status: 503 }))],
    ["malformed payload", () => Promise.resolve(jsonResponse({ maintenance: "off", admin: false }))]
  ]) {
    await t.test(name, async () => {
      const old = deferred();
      let call = 0;
      const loaded = loadComposedDashboard({ fetch: () => {
        call += 1;
        return call === 1 ? old.promise : restoredResponse();
      } });
      await flush();
      dispatchWindow(loaded, "pagehide", { persisted: true });
      dispatchWindow(loaded, "pageshow", { persisted: true });
      await flush();
      assert.equal(loaded.window.location.href, "system-update.html");
      assert.equal(loaded.permissionCalls.length, 0);
      assert.equal(loaded.cards().length, 0);
      old.reject(new Error("late old failure"));
      await flush();
    });
  }

  await t.test("timeout", async () => {
    const loaded = loadComposedDashboard({ fetch: () => new Promise(() => {}) });
    await flush();
    dispatchWindow(loaded, "pagehide", { persisted: true });
    dispatchWindow(loaded, "pageshow", { persisted: true });
    await flush();
    loaded.timers.fireTimeouts();
    await flush();
    assert.equal(loaded.window.location.href, "system-update.html");
    assert.equal(loaded.permissionCalls.length, 0);
    assert.equal(loaded.cards().length, 0);
  });
});

test("permanent teardown cannot complete a composed Dashboard gate", async (t) => {
  for (const mode of ["manual", "pagehide", "restored then manual"]) {
    await t.test(mode, async () => {
      const old = deferred();
      const fresh = deferred();
      const queue = [old, fresh];
      const loaded = loadComposedDashboard({ fetch: () => queue.shift().promise });
      await flush();
      if (mode === "restored then manual") {
        dispatchWindow(loaded, "pagehide", { persisted: true });
        dispatchWindow(loaded, "pageshow", { persisted: true });
        await flush();
        loaded.lifecycles[0].teardown();
      } else if (mode === "manual") loaded.lifecycles[0].teardown();
      else dispatchWindow(loaded, "pagehide", { persisted: false });
      await flush();
      old.resolve(jsonResponse({ maintenance: false, admin: false }));
      fresh.resolve(jsonResponse({ maintenance: false, admin: false }));
      await flush();
      assert.equal(loaded.permissionCalls.length, 0);
      assert.equal(loaded.cards().length, 0);
      assert.equal(loaded.timers.intervals.size, 0);
    });
  }
});

test("a second BFCache suspension keeps the composed Dashboard gate pending", async () => {
  const old = deferred();
  const firstRestore = deferred();
  const secondRestore = deferred();
  const queue = [old, firstRestore, secondRestore];
  const loaded = loadComposedDashboard({ fetch: () => queue.shift().promise });
  await flush();
  dispatchWindow(loaded, "pagehide", { persisted: true });
  dispatchWindow(loaded, "pageshow", { persisted: true });
  await flush();
  dispatchWindow(loaded, "pagehide", { persisted: true });
  await flush();
  assert.equal(loaded.permissionCalls.length, 0);
  assert.equal(loaded.cards().length, 0);
  dispatchWindow(loaded, "pageshow", { persisted: true });
  await flush();
  assert.equal(loaded.maintenanceFetchCalls.length, 3);
  assert.equal(loaded.permissionCalls.length, 0);
  secondRestore.resolve(jsonResponse({ maintenance: false, admin: false }));
  await flush();
  assert.equal(loaded.permissionCalls.length, 1);
  assert.equal(loaded.cards().length, 1);
  old.resolve(jsonResponse({ maintenance: true, admin: false }));
  firstRestore.resolve(jsonResponse({ maintenance: true, admin: false }));
  await flush();
  assert.equal(loaded.window.location.href, "dashboard.html");
});

test("legacy pages execute the shared fail-closed lifecycle and retire local authority", async (t) => {
  for (const page of LEGACY_PAGES) {
    await t.test(page, async () => {
      const source = read(page);
      assert.match(source, /<script src="js\/maintenance\.js"><\/script>/);
      assert.doesNotMatch(source, /MAINTENANCE_ADMIN|function fetchMaintenanceStatus|function enforceMaintenanceMode/);
      const bootstrap = extractInlineScripts(source).find((script) => script.includes("CC_MAINTENANCE_LIFECYCLE"));
      assert.ok(bootstrap);
      for (const [scenario, fetch, redirects] of [
        ["OFF", async () => jsonResponse({ maintenance: false, admin: false }), false],
        ["ON", async () => jsonResponse({ maintenance: true, admin: false }), true],
        ["network", async () => { throw new Error("offline"); }, true],
        ["HTTP", async () => jsonResponse({}, { ok: false, status: 503 }), true],
        ["malformed", async () => jsonResponse({ maintenance: "off", admin: false }), true]
      ]) {
        const loaded = loadMaintenance({ fetch, user: "Anati", role: "admin" });
        vm.runInNewContext(bootstrap, loaded.context, { filename: `${page}:${scenario}` });
        await flush();
        assert.equal(loaded.fetchCalls.length, 1, scenario);
        assert.equal(loaded.timers.intervals.size, 1, scenario);
        assert.equal(loaded.context.location.href === "system-update.html", redirects, scenario);
      }
    });
  }
});

test("all four migrated pages restore only Maintenance ownership after BFCache", async (t) => {
  for (const page of LEGACY_PAGES) {
    await t.test(page, async () => {
      const bootstrap = extractInlineScripts(read(page)).find((script) => script.includes("CC_MAINTENANCE_LIFECYCLE"));
      let restoredMode = "ON";
      let calls = 0;
      const loaded = loadMaintenance({
        user: "Anati",
        role: "admin",
        fetch: async () => {
          calls += 1;
          if (calls === 1) return jsonResponse({ maintenance: false, admin: false });
          if (restoredMode === "unavailable") throw new Error("offline");
          return jsonResponse({ maintenance: true, admin: false });
        }
      });
      vm.runInNewContext(bootstrap, loaded.context, { filename: page });
      const originalLifecycle = loaded.context.CC_MAINTENANCE_LIFECYCLE;
      await flush();
      dispatchWindow(loaded, "pagehide", { persisted: true });
      dispatchWindow(loaded, "pageshow", { persisted: true });
      await flush();
      assert.equal(loaded.context.CC_MAINTENANCE_LIFECYCLE, originalLifecycle);
      assert.equal(loaded.fetchCalls.length, 2);
      assert.equal(loaded.timers.intervals.size, 1);
      assert.equal(loaded.context.location.href, "system-update.html", "local Anati spoof cannot exempt restored ON");

      const unavailable = loadMaintenance({
        user: "Anati",
        role: "admin",
        fetch: async (_url, _request, count) => count === 1
          ? jsonResponse({ maintenance: false, admin: false })
          : Promise.reject(new Error("offline"))
      });
      vm.runInNewContext(bootstrap, unavailable.context, { filename: `${page}:unavailable` });
      await flush();
      dispatchWindow(unavailable, "pagehide", { persisted: true });
      restoredMode = "unavailable";
      dispatchWindow(unavailable, "pageshow", { persisted: true });
      await flush();
      assert.equal(unavailable.fetchCalls.length, 2);
      assert.equal(unavailable.timers.intervals.size, 1);
      assert.equal(unavailable.context.location.href, "system-update.html");
    });
  }
});

test("Employee Profiles call pattern restores one fresh fail-closed stream without a toggle", async () => {
  let restored = false;
  const loaded = loadMaintenance({ fetch: async () => restored
    ? Promise.reject(new Error("offline"))
    : jsonResponse({ maintenance: false, admin: false }) });
  const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle();
  lifecycle.startEnforcement();
  await flush();
  dispatchWindow(loaded, "pagehide", { persisted: true });
  restored = true;
  dispatchWindow(loaded, "pageshow", { persisted: true });
  await flush();
  assert.equal(loaded.fetchCalls.length, 2);
  assert.equal(loaded.timers.intervals.size, 1);
  assert.equal(loaded.context.location.href, "system-update.html");
});

test("System Update remains through every unavailable or non-recovery state", async (t) => {
  const cases = [
    ["network", async () => { throw new Error("network"); }],
    ["HTTP", async () => jsonResponse({}, { ok: false, status: 503 })],
    ["malformed JSON", async () => jsonResponse({}, { jsonError: new Error("json") })],
    ["malformed payload", async () => jsonResponse({ maintenance: "off", admin: false })],
    ["ON non-Anati", async () => jsonResponse({ maintenance: true, admin: false })]
  ];
  for (const [name, fetch] of cases) {
    await t.test(name, async () => {
      const loaded = loadMaintenance({ fetch, href: "system-update.html" });
      await loaded.context.CloudCrowdMaintenance.createRecoveryLifecycle().check();
      assert.deepEqual(loaded.replacements, []);
    });
  }
  for (const [name, state] of [
    ["OFF", { maintenance: false, admin: false }],
    ["verified Anati", { maintenance: true, admin: true }]
  ]) {
    await t.test(name, async () => {
      const loaded = loadMaintenance({ fetch: async () => jsonResponse(state), href: "system-update.html" });
      await loaded.context.CloudCrowdMaintenance.createRecoveryLifecycle().check();
      assert.deepEqual(loaded.replacements, ["dashboard.html"]);
    });
  }
});

test("System Update recovery has one bounded stream and only authoritative recovery navigates", async () => {
  const pending = deferred();
  const loaded = loadMaintenance({ fetch: () => pending.promise, href: "system-update.html" });
  const bootstrap = extractInlineScripts(systemUpdateSource).find((script) => script.includes("monitorAuthoritativeRecovery"));
  vm.runInNewContext(bootstrap, loaded.context, { filename: "system-update.html" });
  vm.runInNewContext(bootstrap, loaded.context, { filename: "system-update.html" });
  await flush();
  assert.equal(loaded.fetchCalls.length, 1);
  assert.equal(loaded.timers.intervals.size, 1);
  [...loaded.timers.intervals.values()].forEach(({ callback }) => callback());
  assert.equal(loaded.fetchCalls.length, 1, "never-settling recovery does not accumulate");
  loaded.timers.fireTimeouts();
  await flush();
  assert.deepEqual(loaded.replacements, []);

  let next = jsonResponse({ maintenance: true, admin: false });
  loaded.context.fetch = async () => next;
  await loaded.timers.tickIntervals();
  assert.deepEqual(loaded.replacements, []);
  next = jsonResponse({ maintenance: false, admin: false });
  await loaded.timers.tickIntervals();
  assert.deepEqual(loaded.replacements, ["dashboard.html"]);
});

test("System Update ignores stale timed-out OFF and stale Anati recovery", async (t) => {
  for (const stale of [
    { maintenance: false, admin: false },
    { maintenance: true, admin: true }
  ]) {
    await t.test(JSON.stringify(stale), async () => {
      const old = deferred();
      const current = deferred();
      const queue = [old, current];
      const loaded = loadMaintenance({ fetch: () => queue.shift().promise, href: "system-update.html" });
      const recovery = loaded.context.CloudCrowdMaintenance.createRecoveryLifecycle();
      recovery.start();
      await flush();
      loaded.timers.fireTimeouts();
      const poll = [...loaded.timers.intervals.values()][0].callback();
      await flush();
      current.resolve(jsonResponse({ maintenance: true, admin: false }));
      await poll;
      old.resolve(jsonResponse(stale));
      await flush();
      assert.deepEqual(loaded.replacements, []);
    });
  }
});

test("System Update BFCache restore performs one fresh authoritative recovery check", async (t) => {
  for (const [name, restored, returns] of [
    ["unavailable", null, false],
    ["ON ordinary", { maintenance: true, admin: false }, false],
    ["OFF", { maintenance: false, admin: false }, true],
    ["verified Anati", { maintenance: true, admin: true }, true]
  ]) {
    await t.test(name, async () => {
      let current = { maintenance: true, admin: false };
      const loaded = loadMaintenance({ fetch: async () => {
        if (current === null) throw new Error("offline");
        return jsonResponse(current);
      }, href: "system-update.html" });
      const recovery = loaded.context.CloudCrowdMaintenance.createRecoveryLifecycle();
      recovery.start();
      await flush();
      dispatchWindow(loaded, "pagehide", { persisted: true });
      assert.equal(loaded.timers.intervals.size, 0);
      current = restored;
      dispatchWindow(loaded, "pageshow", { persisted: true });
      await flush();
      assert.equal(loaded.fetchCalls.length, 2);
      assert.equal(loaded.timers.intervals.size, 1);
      assert.equal(loaded.windowListeners.get("pagehide").size, 1);
      assert.equal(loaded.windowListeners.get("pageshow").size, 1);
      assert.deepEqual(loaded.replacements, returns ? ["dashboard.html"] : []);
    });
  }


  await t.test("timeout", async () => {
    let restored = false;
    const loaded = loadMaintenance({ fetch: async () => restored
      ? new Promise(() => {})
      : jsonResponse({ maintenance: true, admin: false }), href: "system-update.html" });
    const recovery = loaded.context.CloudCrowdMaintenance.createRecoveryLifecycle();
    recovery.start();
    await flush();
    dispatchWindow(loaded, "pagehide", { persisted: true });
    restored = true;
    dispatchWindow(loaded, "pageshow", { persisted: true });
    await flush();
    assert.equal([...loaded.timers.timeouts.values()][0].delay, 10000);
    loaded.timers.fireTimeouts();
    await flush();
    assert.deepEqual(loaded.replacements, []);
    assert.equal(loaded.timers.intervals.size, 1);
  });
});

test("System Update BFCache restore rejects stale pre-hide OFF and admin authority", async (t) => {
  for (const stale of [
    { maintenance: false, admin: false },
    { maintenance: true, admin: true }
  ]) {
    await t.test(JSON.stringify(stale), async () => {
      const old = deferred();
      const fresh = deferred();
      const queue = [old, fresh];
      const loaded = loadMaintenance({ fetch: () => queue.shift().promise, href: "system-update.html" });
      const recovery = loaded.context.CloudCrowdMaintenance.createRecoveryLifecycle();
      recovery.start();
      await flush();
      dispatchWindow(loaded, "pagehide", { persisted: true });
      dispatchWindow(loaded, "pageshow", { persisted: true });
      await flush();
      fresh.resolve(jsonResponse({ maintenance: true, admin: false }));
      await flush();
      old.resolve(jsonResponse(stale));
      await flush();
      assert.deepEqual(loaded.replacements, []);
    });
  }
});

test("System Update repeated BFCache cycles stay singular and manual teardown cannot restore", async () => {
  const loaded = loadMaintenance({ fetch: async () => jsonResponse({ maintenance: true, admin: false }), href: "system-update.html" });
  const recovery = loaded.context.CloudCrowdMaintenance.createRecoveryLifecycle();
  recovery.start();
  await flush();
  for (let cycle = 0; cycle < 2; cycle += 1) {
    dispatchWindow(loaded, "pagehide", { persisted: true });
    dispatchWindow(loaded, "pageshow", { persisted: true });
    await flush();
    assert.equal(loaded.timers.intervals.size, 1);
    assert.equal(loaded.windowListeners.get("pagehide").size, 1);
    assert.equal(loaded.windowListeners.get("pageshow").size, 1);
  }
  assert.equal(loaded.fetchCalls.length, 3);
  recovery.teardown();
  recovery.teardown();
  assert.equal(loaded.timers.intervals.size, 0);
  assert.equal(loaded.windowListeners.get("pagehide").size, 0);
  assert.equal(loaded.windowListeners.get("pageshow").size, 0);
  dispatchWindow(loaded, "pageshow", { persisted: true });
  recovery.start();
  assert.equal(loaded.fetchCalls.length, 3);
  assert.equal(loaded.timers.intervals.size, 0);
});

test("backend distinguishes missing, OFF, ON, and malformed persisted values", async (t) => {
  for (const scenario of [
    ["missing", undefined, 200, false],
    ["OFF", "0", 200, false],
    ["ON", "1", 200, true],
    ["malformed", "unexpected", 500, undefined]
  ]) {
    const [name, value, statusCode, expected] = scenario;
    await t.test(name, async () => {
      const backend = loadBackendMutation(backendSource, { value });
      const response = await backend.handler({ httpMethod: "GET", headers: {} });
      assert.equal(response.statusCode, statusCode);
      if (statusCode === 200) assert.equal(JSON.parse(response.body).maintenance, expected);
      else assert.deepEqual(JSON.parse(response.body), { error: "Internal Server Error" });
    });
  }
});

function loadBackendMutation(source, options = {}) {
  let value = options.value;
  let mutated = false;
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    process: { env: { DATABASE_URL: "test" } },
    console: { error() {} },
    require(id) {
      if (id === "pg") return { Pool: class { async query(sql, params) {
        if (sql.includes("SELECT value")) return { rows: value === undefined ? [] : [{ value }] };
        if (sql.includes("INSERT INTO app_settings")) { value = params[1]; mutated = true; }
        return { rows: [] };
      } } };
      if (id === "./_auth") return {
        async requireAnatiSession() {
          if (options.nonAnati) { const error = new Error("denied"); error.statusCode = 403; throw error; }
        }
      };
      if (id === "./_http") return { requireJsonPost(event) { return JSON.parse(event.body); } };
      throw new Error(`Unexpected require ${id}`);
    }
  };
  vm.runInNewContext(source, context, { filename: "netlify/functions/maintenance.js" });
  return { handler: module.exports.handler, wasMutated: () => mutated };
}

const NORMAL_TEARDOWN = `    function teardown() {
      if (tornDown) return;
      tornDown = true;
      suspended = false;
      ensureRestorationGate();
      mutationGeneration += 1;`;

test("twenty-four executable Maintenance mutants are behaviorally rejected", async (t) => {
  const mutations = [
    {
      name: "second enforcement poller",
      source: () => replaceExact(maintenanceSource,
        `      toggleStarted = true;\n      renderToggle();`,
        `      toggleStarted = true;\n      window.setInterval(enforceMaintenanceMode, POLL_INTERVAL);\n      renderToggle();`, "second-poller"),
      contract: async (source) => {
        const loaded = loadMaintenance({ source, fetch: async () => jsonResponse({ maintenance: false, admin: true }) });
        const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle({ button: new FakeButton() });
        await lifecycle.enforceMaintenanceMode(); lifecycle.startEnforcement(); lifecycle.startToggleUpdates();
        assert.equal(loaded.timers.intervals.size, 1);
      }
    },
    {
      name: "independent toggle GET",
      source: () => replaceExact(maintenanceSource,
        `      toggleStarted = true;\n      renderToggle();`,
        `      toggleStarted = true;\n      enforceMaintenanceMode();\n      renderToggle();`, "toggle-get"),
      contract: async (source) => {
        const loaded = loadMaintenance({ source, fetch: async () => jsonResponse({ maintenance: false, admin: true }) });
        const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle({ button: new FakeButton() });
        await lifecycle.enforceMaintenanceMode(); lifecycle.startToggleUpdates(); await flush();
        assert.equal(loaded.fetchCalls.length, 1);
      }
    },
    {
      name: "in-flight guard removed",
      source: () => replaceExact(maintenanceSource, `      if (pending) return pending.promise;`, `      void pending;`, "inflight"),
      contract: async (source) => {
        const loaded = loadMaintenance({ source, fetch: () => new Promise(() => {}) });
        const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle(); lifecycle.startEnforcement(); await flush();
        [...loaded.timers.intervals.values()][0].callback(); await flush();
        assert.equal(loaded.fetchCalls.length, 1);
      }
    },
    {
      name: "request deadline removed",
      source: () => replaceExact(maintenanceSource,
        `        const timeoutId = window.setTimeout(() => {\n          finish(unavailableState('maintenance-timeout'));\n        }, REQUEST_DEADLINE);`,
        `        const timeoutId = null;`, "deadline"),
      contract: async (source) => {
        const loaded = loadMaintenance({ source, fetch: () => new Promise(() => {}) });
        loaded.context.CloudCrowdMaintenance.createLifecycle().startEnforcement(); await flush();
        assert.equal(loaded.timers.timeouts.size, 1);
      }
    },
    {
      name: "request failure becomes OFF",
      source: () => replaceExact(maintenanceSource,
        `    return { status: 'unavailable', maintenance: null, admin: false, reason };`,
        `    return { status: 'available', maintenance: false, admin: false, reason };`, "failure-off"),
      contract: async (source) => {
        const loaded = loadMaintenance({ source, fetch: async () => { throw new Error("offline"); } });
        await loaded.context.CloudCrowdMaintenance.createLifecycle().enforceMaintenanceMode();
        assert.equal(loaded.context.location.href, "system-update.html");
      }
    },
    {
      name: "malformed payload becomes OFF",
      source: () => replaceExact(maintenanceSource,
        `      throw new Error('Maintenance response is malformed');`,
        `      return { status: 'available', maintenance: false, admin: false, reason: '' };`, "malformed-off"),
      contract: async (source) => {
        const loaded = loadMaintenance({ source, fetch: async () => jsonResponse({ maintenance: "off", admin: false }) });
        await loaded.context.CloudCrowdMaintenance.createLifecycle().enforceMaintenanceMode();
        assert.equal(loaded.context.location.href, "system-update.html");
      }
    },
    ...["cc_user", "cc_role"].map((key) => ({
      name: `local ${key} grants exemption`,
      source: () => replaceExact(maintenanceSource,
        `    function enforcePublishedState() {`,
        `    function enforcePublishedState() {\n      if (window.sessionStorage?.getItem?.('${key}') === '${key === "cc_user" ? "Anati" : "admin"}') return;`, `local-${key}`),
      contract: async (source) => {
        const loaded = loadMaintenance({ source, user: "Anati", role: "admin", fetch: async () => jsonResponse({ maintenance: true, admin: false }) });
        await loaded.context.CloudCrowdMaintenance.createLifecycle().enforceMaintenanceMode();
        assert.equal(loaded.context.location.href, "system-update.html");
      }
    })),
    {
      name: "ordinary redirect suppressed",
      source: () => replaceExact(maintenanceSource, `        window.location.href = 'system-update.html';`, `        void window.location.href;`, "redirect"),
      contract: async (source) => {
        const loaded = loadMaintenance({ source, fetch: async () => jsonResponse({ maintenance: true, admin: false }) });
        await loaded.context.CloudCrowdMaintenance.createLifecycle().enforceMaintenanceMode();
        assert.equal(loaded.context.location.href, "system-update.html");
      }
    },
    {
      name: "recovery allowed on unavailable",
      source: () => replaceExact(maintenanceSource,
        `      if (state.status === 'available' && (state.maintenance === false || state.admin === true)) {`,
        `      if (state.status === 'unavailable' || (state.status === 'available' && (state.maintenance === false || state.admin === true))) {`, "recovery-unavailable"),
      contract: async (source) => {
        const loaded = loadMaintenance({ source, fetch: async () => { throw new Error("offline"); } });
        await loaded.context.CloudCrowdMaintenance.createRecoveryLifecycle().check();
        assert.deepEqual(loaded.replacements, []);
      }
    },
    ...[
      ["stale OFF overrides newer ON", { maintenance: false, admin: true }, true],
      ["stale ON overrides newer OFF", { maintenance: true, admin: true }, false]
    ].map(([name, stale, postValue]) => ({
      name,
      source: () => replaceExact(maintenanceSource,
        `          if (!tornDown && generation === requestGeneration && state) {`,
        `          if (!tornDown && state) {`, name),
      contract: async (source) => {
        const old = deferred(); let gets = 0;
        const loaded = loadMaintenance({ source, fetch: async (_url, request) => {
          if (request.method === "POST") return jsonResponse({ maintenance: postValue });
          gets += 1; return gets === 1 ? jsonResponse({ maintenance: !postValue, admin: true }) : old.promise;
        } });
        const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle({ button: new FakeButton() });
        await lifecycle.enforceMaintenanceMode(); lifecycle.startEnforcement(); lifecycle.startToggleUpdates();
        const poll = [...loaded.timers.intervals.values()][0].callback(); await flush();
        await lifecycle.toggleMaintenanceMode(); old.resolve(jsonResponse(stale)); await poll;
        assert.equal(lifecycle.getState().maintenance, postValue);
      }
    })),
    {
      name: "interval registered twice",
      source: () => replaceExact(maintenanceSource,
        `      else enforcePublishedState();\n      intervalId = window.setInterval(enforceMaintenanceMode, POLL_INTERVAL);`,
        `      else enforcePublishedState();\n      intervalId = window.setInterval(enforceMaintenanceMode, POLL_INTERVAL);\n      window.setInterval(enforceMaintenanceMode, POLL_INTERVAL);`, "double-interval"),
      contract: async (source) => {
        const loaded = loadMaintenance({ source }); loaded.context.CloudCrowdMaintenance.createLifecycle().startEnforcement();
        assert.equal(loaded.timers.intervals.size, 1);
      }
    },
    {
      name: "interval teardown disabled",
      source: () => replaceExact(maintenanceSource, `      window.clearInterval(intervalId);`, `      void intervalId;`, "interval-cleanup"),
      contract: async (source) => {
        const loaded = loadMaintenance({ source }); const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle(); lifecycle.startEnforcement(); lifecycle.teardown();
        assert.equal(loaded.timers.intervals.size, 0);
      }
    },
    {
      name: "click teardown disabled",
      source: () => replaceExact(maintenanceSource, `        button.removeEventListener('click', toggleMaintenanceMode);`, `        void toggleMaintenanceMode;`, "click-cleanup"),
      contract: async (source) => {
        const loaded = loadMaintenance({ source }); const button = new FakeButton(); const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle({ button }); lifecycle.startEnforcement(); lifecycle.teardown();
        assert.equal(button.listenerCount("click"), 0);
      }
    },
    {
      name: "teardown non-idempotent",
      source: () => replaceExact(maintenanceSource, NORMAL_TEARDOWN,
        NORMAL_TEARDOWN.replace(`if (tornDown) return;`, `if (tornDown) throw new Error('duplicate teardown');`), "teardown-idempotence"),
      contract: async (source) => {
        const loaded = loadMaintenance({ source }); const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle(); lifecycle.teardown(); assert.doesNotThrow(() => lifecycle.teardown());
      }
    },
    {
      name: "Dashboard seed ignored",
      source: () => replaceExact(maintenanceSource,
        `      if (state.status === 'unknown') enforceMaintenanceMode();\n      else enforcePublishedState();`,
        `      enforceMaintenanceMode();`, "seed"),
      contract: async (source) => {
        const loaded = loadMaintenance({ source }); const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle(); await lifecycle.enforceMaintenanceMode(); lifecycle.startEnforcement(); await flush(); assert.equal(loaded.fetchCalls.length, 1);
      }
    },
    {
      name: "POST success not published",
      source: () => replaceExact(maintenanceSource, `        return publish({\n          status: 'available',`, `        return void ({\n          status: 'available',`, "post-publication"),
      contract: async (source) => {
        const loaded = loadMaintenance({ source, fetch: async (_url, request) => request.method === "POST" ? jsonResponse({ maintenance: true }) : jsonResponse({ maintenance: false, admin: true }) });
        const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle(); await lifecycle.enforceMaintenanceMode(); await lifecycle.toggleMaintenanceMode(); assert.equal(lifecycle.getState().maintenance, true);
      }
    },
    {
      name: "POST failure leaves optimistic state",
      source: () => replaceExact(maintenanceSource, `      mutationInFlight = true;`, `      state = { ...state, maintenance: requestedMaintenance };\n      renderToggle();\n      mutationInFlight = true;`, "optimistic"),
      contract: async (source) => {
        const loaded = loadMaintenance({ source, fetch: async (_url, request) => request.method === "POST" ? jsonResponse({}, { ok: false }) : jsonResponse({ maintenance: false, admin: true }) });
        const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle(); await lifecycle.enforceMaintenanceMode(); await lifecycle.toggleMaintenanceMode(); assert.equal(lifecycle.getState().maintenance, false);
      }
    },
    {
      name: "malformed DB value accepted as OFF",
      source: () => replaceExact(backendSource,
        `  if (!result.rows[0]) return false;\n  if (result.rows[0].value === "1") return true;\n  if (result.rows[0].value === "0") return false;\n  throw new Error("Maintenance state is malformed");`,
        `  return result.rows[0]?.value === "1";`, "backend-malformed"),
      contract: async (source) => {
        const backend = loadBackendMutation(source, { value: "bad" }); const response = await backend.handler({ httpMethod: "GET", headers: {} }); assert.equal(response.statusCode, 500);
      }
    },
    {
      name: "non-Anati POST permitted",
      source: () => {
        const marker = `        await requireAnatiSession(event);`;
        const first = backendSource.indexOf(marker);
        const second = backendSource.indexOf(marker, first + marker.length);
        assert.notEqual(second, -1);
        const mutated = backendSource.slice(0, second) + `        void event;` + backendSource.slice(second + marker.length);
        new vm.Script(mutated);
        return mutated;
      },
      contract: async (source) => {
        const backend = loadBackendMutation(source, { value: "0", nonAnati: true });
        const response = await backend.handler({ httpMethod: "POST", headers: { "content-type": "application/json" }, body: '{"maintenance":true}' });
        assert.equal(response.statusCode, 403);
      }
    },
    {
      name: "never-settling polls accumulate",
      source: () => replaceExact(maintenanceSource, `      if (pending) return pending.promise;`, `      void pending;`, "never-settling"),
      contract: async (source) => {
        const loaded = loadMaintenance({ source, fetch: () => new Promise(() => {}) }); const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle(); lifecycle.startEnforcement(); await flush();
        for (let index = 0; index < 3; index += 1) { [...loaded.timers.intervals.values()][0].callback(); await flush(); }
        assert.equal(loaded.fetchCalls.length, 1);
      }
    },
    {
      name: "BFCache pageshow restoration disabled",
      source: () => replaceExact(maintenanceSource,
        `    function handlePageshow(event) {\n      if (event?.persisted === true) restoreFromBfcache();\n    }`,
        `    function handlePageshow(event) {\n      void event;\n    }`, "bfcache-pageshow"),
      contract: async (source) => {
        let restored = false;
        const loaded = loadMaintenance({ source, fetch: async () => jsonResponse(restored
          ? { maintenance: true, admin: false }
          : { maintenance: false, admin: false }) });
        const lifecycle = loaded.context.CloudCrowdMaintenance.createLifecycle();
        lifecycle.startEnforcement();
        await flush();
        dispatchWindow(loaded, "pagehide", { persisted: true });
        restored = true;
        dispatchWindow(loaded, "pageshow", { persisted: true });
        await flush();
        assert.equal(loaded.fetchCalls.length, 2);
        assert.equal(loaded.timers.intervals.size, 1);
        assert.equal(loaded.context.location.href, "system-update.html");
      }
    },
    {
      name: "BFCache suspension falsely completes Dashboard authority gate",
      source: () => replaceExact(maintenanceSource,
        `      suspended = true;\n      ensureRestorationGate();\n      reader.invalidate();`,
        `      suspended = true;\n      void restorationGate;\n      reader.invalidate();`, "bfcache-gate"),
      contract: async (source) => {
        const old = deferred();
        const loaded = loadComposedDashboard({ maintenanceSource: source, fetch: () => old.promise });
        await flush();
        dispatchWindow(loaded, "pagehide", { persisted: true });
        await flush();
        assert.equal(loaded.permissionCalls.length, 0);
        assert.equal(loaded.cards().length, 0);
      }
    }
  ];

  assert.equal(mutations.length, 24);
  for (const mutation of mutations) {
    await t.test(mutation.name, async () => {
      const source = mutation.source();
      await assert.rejects(() => mutation.contract(source), assert.AssertionError);
    });
  }
});

test("supplementary source invariants preserve scope and public boundaries", () => {
  assert.match(maintenanceSource, /const POLL_INTERVAL = 3000/);
  assert.match(maintenanceSource, /const REQUEST_DEADLINE = 10 \* 1000/);
  assert.match(systemUpdateSource, /location\.replace|returnRoute: 'dashboard\.html'/);
  assert.doesNotMatch(maintenanceSource, /BroadcastChannel|SharedWorker|visibilitychange|storage.*addEventListener/);
  assert.match(read("call-queue.html"), /<html[^>]*hidden>/);
});
