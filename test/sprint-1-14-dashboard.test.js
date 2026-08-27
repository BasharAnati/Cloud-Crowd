"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createCascade, element: cssElement } = require("./css-cascade.js");

const ROOT = path.resolve(__dirname, "..");
const shellSource = fs.readFileSync(path.join(ROOT, "js/app-shell.js"), "utf8");
const dashboardRuntime = fs.readFileSync(path.join(ROOT, "js/dashboard.js"), "utf8");
const dashboardHtml = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
const dashboardCss = fs.readFileSync(path.join(ROOT, "assets/css/pages/dashboard.css"), "utf8");

class FakeElement {
  constructor(tagName, id = "") {
    this.tagName = String(tagName).toUpperCase();
    this.id = id;
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.className = "";
    this.hidden = false;
    this.inert = false;
    this.textContent = "";
    this.parentNode = null;
    this.href = "";
    this.classList = {
      add: (...names) => names.forEach((name) => this.setClass(name, true)),
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.hasClass(name) : Boolean(force);
        this.setClass(name, enabled);
        return enabled;
      },
      contains: (name) => this.hasClass(name)
    };
  }

  hasClass(name) {
    return this.className.split(/\s+/).filter(Boolean).includes(name);
  }

  setClass(name, enabled) {
    const classes = new Set(this.className.split(/\s+/).filter(Boolean));
    if (enabled) classes.add(name);
    else classes.delete(name);
    this.className = Array.from(classes).join(" ");
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
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

  get firstChild() {
    return this.children[0] || null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
    this.onListenerAdded?.(type, listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    (this.listeners.get(type) || []).forEach((listener) => listener({ type, ...event }));
  }

  focus() {
    FakeElement.focused = this;
  }

  matches(selector) {
    return selector.split(",").some((part) => {
      const trimmed = part.trim();
      return trimmed.startsWith(".") && this.hasClass(trimmed.slice(1));
    });
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => node.children.forEach((child) => {
      if (child.matches(selector)) matches.push(child);
      visit(child);
    });
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function accessModel(allowed = [], options = {}) {
  if (options.available === false) {
    return { available: false, reason: options.reason || "permission-service-unavailable", access: [] };
  }
  return {
    available: true,
    reason: "",
    access: allowed.map((moduleKey) => ({
      moduleKey,
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false
    }))
  };
}

async function flush(turns = 8) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function fastTimeoutSource(source = dashboardRuntime) {
  const mutated = source.replace("const AUTHORITY_TIMEOUT_MS = 10 * 1000;", "const AUTHORITY_TIMEOUT_MS = 10;");
  assert.notEqual(mutated, source, "fast Dashboard authority timeout applied");
  return mutated;
}

async function waitForTimeout() {
  await new Promise((resolve) => setTimeout(resolve, 25));
  await flush();
}

function loadDashboard(options = {}) {
  const elements = new Map();
  const createdElements = [];
  let listenerFailureTriggered = false;
  const maybeFailElementListener = (element, type) => {
    if (listenerFailureTriggered || type !== "click") return;
    const point = options.listenerFailure;
    const matches = (point === "trigger" && element.hasClass("cc-shell-nav-trigger")) ||
      (point === "backdrop" && element.id === "dashboard-nav-backdrop") ||
      (point === "link" && element.hasClass("cc-shell-nav-link"));
    if (!matches) return;
    listenerFailureTriggered = true;
    throw new Error(`Injected ${point} listener failure`);
  };
  const createElement = (tag, id = "") => {
    const element = new FakeElement(tag, id);
    element.onListenerAdded = (type) => maybeFailElementListener(element, type);
    createdElements.push(element);
    return element;
  };
  const createRegistered = (tag, id, className = "") => {
    const element = createElement(tag, id);
    element.className = className;
    elements.set(id, element);
    return element;
  };
  const shell = createRegistered("div", "dashboard-shell", "cc-shell-layout has-responsive-navigation");
  const sidebar = createRegistered("aside", "dashboard-app-sidebar");
  const main = createElement("main");
  const topbar = createRegistered("header", "dashboard-app-topbar");
  const maintenanceButton = createRegistered("button", "maintenance-toggle-btn");
  const state = createRegistered("div", "dashboard-launcher-state", "dashboard-launcher-state cc-empty-state");
  const stateTransitions = [];
  state.dataset = new Proxy({}, {
    set(target, key, value) {
      if (key === "state") stateTransitions.push(value);
      target[key] = value;
      return true;
    }
  });
  const modules = createRegistered("div", "dashboard-modules", "dashboard-module-groups");
  const backdrop = createRegistered("button", "dashboard-nav-backdrop");
  backdrop.hidden = true;
  topbar.appendChild(maintenanceButton);
  main.appendChild(topbar);
  main.appendChild(state);
  main.appendChild(modules);
  shell.appendChild(sidebar);
  shell.appendChild(main);
  shell.appendChild(backdrop);

  const documentListeners = new Map();
  const windowListeners = new Map();
  const mediaListeners = [];
  const mediaQuery = {
    matches: options.compact === true,
    addEventListener(type, listener) {
      if (type !== "change") return;
      mediaListeners.push(listener);
      if (!listenerFailureTriggered && options.listenerFailure === "media") {
        listenerFailureTriggered = true;
        throw new Error("Injected media listener failure");
      }
    },
    removeEventListener(type, listener) {
      if (type !== "change") return;
      const index = mediaListeners.indexOf(listener);
      if (index >= 0) mediaListeners.splice(index, 1);
    }
  };
  const document = {
    body: createElement("body"),
    visibilityState: "visible",
    createElement(tagName) { return createElement(tagName); },
    getElementById(id) { return elements.get(id) || null; },
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
      if (!listenerFailureTriggered && options.listenerFailure === "keydown" && type === "keydown") {
        listenerFailureTriggered = true;
        throw new Error("Injected keydown listener failure");
      }
    },
    removeEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
      documentListeners.set(type, listeners);
    }
  };
  const values = {
    cc_token: "authoritative-token",
    cc_user: options.username || "Local User",
    cc_role: options.role || "agent"
  };
  const permissionResults = options.permissionResults || [accessModel(["cctv"])];
  const permissionCalls = [];
  const pageAccessCalls = [];
  const clearCalls = [];
  const networkCalls = [];
  const storageReads = [];
  const maintenanceCalls = { enforce: 0, start: 0, toggle: 0 };
  const errors = [];
  const window = {
    document,
    location: { pathname: "/dashboard.html", href: "dashboard.html" },
    sessionStorage: { getItem(key) { return values[key] || ""; } },
    setTimeout,
    clearTimeout,
    matchMedia() { return mediaQuery; },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    CloudCrowdTheme: {
      createToggle() {
        if (options.themeFailure) throw new Error("Theme toggle initialization failed");
        return new FakeElement("button");
      }
    },
    clearStoredSession() { clearCalls.push(true); },
    logout() {}
  };
  window.window = window;
  window.CCPermissions = {
    getMyAccessModel(requestOptions) {
      permissionCalls.push(requestOptions);
      const result = permissionResults.shift();
      return Promise.resolve(result === undefined
        ? accessModel([], { available: false })
        : result);
    },
    getModuleAccess(model, moduleKey) {
      if (!model || model.available !== true) {
        return { moduleKey, canView: false, unavailable: true, reason: model?.reason };
      }
      return model.access.find((record) => record.moduleKey === moduleKey) || {
        moduleKey, canView: false, canCreate: false, canEdit: false, canDelete: false, unavailable: false
      };
    },
    requirePageAccess(moduleKey) {
      pageAccessCalls.push(moduleKey);
      return Promise.resolve({ moduleKey, canView: true });
    }
  };
  window.CloudCrowdMaintenance = {
    createLifecycle() {
      return {
        async enforceMaintenanceMode() {
          maintenanceCalls.enforce += 1;
          if (options.maintenanceGate) await options.maintenanceGate.promise;
          if (options.maintenance === "on" || options.maintenance === "unavailable") {
            window.location.href = "system-update.html";
          }
        },
        startEnforcement() { maintenanceCalls.start += 1; },
        startToggleUpdates() { maintenanceCalls.toggle += 1; }
      };
    }
  };
  const context = {
    window,
    document,
    sessionStorage: window.sessionStorage,
    localStorage: { getItem(key) { storageReads.push(key); return null; } },
    fetch(resource) {
      networkCalls.push(String(resource));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    },
    console: { warn() {}, log() {}, error(...args) { errors.push(args); } },
    setTimeout,
    clearTimeout,
    setImmediate,
    clearImmediate
  };
  vm.runInNewContext(options.shellSource || shellSource, context, { filename: "app-shell.js" });
  vm.runInNewContext(options.dashboardSource || dashboardRuntime, context, { filename: "dashboard.js" });

  return {
    context, document, window, elements, modules, sidebar, state, permissionResults,
    permissionCalls, pageAccessCalls, maintenanceCalls, clearCalls, errors, mediaListeners,
    networkCalls, storageReads, stateTransitions, mediaQuery, createdElements,
    dispatchWindow(type) { (windowListeners.get(type) || []).forEach((listener) => listener({ type })); },
    dispatchDocument(type) { (documentListeners.get(type) || []).forEach((listener) => listener({ type })); },
    listenerCount(target, type) {
      const source = target === "window" ? windowListeners : documentListeners;
      return (source.get(type) || []).length;
    },
    cards() { return modules.querySelectorAll(".cc-shell-module-card"); },
    navLinks() { return sidebar.querySelectorAll(".cc-shell-nav-link"); },
    createdByClass(className) { return createdElements.filter((element) => element.hasClass(className)); },
    listenerTotal(className, type) {
      return this.createdByClass(className).reduce(
        (total, element) => total + (element.listeners.get(type) || []).length,
        0
      );
    }
  };
}

test("Dashboard starts with one restrained status region and no static launcher metadata", () => {
  assert.match(dashboardHtml, /id="dashboard-launcher-state"[\s\S]*?data-state="loading"[\s\S]*?role="status"[\s\S]*?aria-live="polite"/);
  assert.match(dashboardHtml, /id="dashboard-modules"[\s\S]*?aria-busy="true"[\s\S]*?hidden/);
  assert.equal((dashboardHtml.match(/aria-live=/g) || []).length, 1);
  assert.doesNotMatch(dashboardHtml, /data-module-id|cc-shell-module-card/);
});

test("initial Maintenance authority settles before permission resolution or usable launchers", async () => {
  const gate = deferred();
  const loaded = loadDashboard({ maintenanceGate: gate });
  await flush(2);
  assert.equal(loaded.permissionCalls.length, 0);
  assert.equal(loaded.cards().length, 0);
  assert.equal(loaded.modules.hidden, true);
  assert.equal(loaded.state.dataset.state, "loading");
  gate.resolve();
  await flush();
  assert.equal(loaded.permissionCalls.length, 1);
  assert.equal(loaded.cards().length, 1);
});

test("Maintenance ON and unavailable fail closed before permission or shell startup", async () => {
  for (const maintenance of ["on", "unavailable"]) {
    const loaded = loadDashboard({ maintenance });
    await flush();
    assert.equal(loaded.window.location.href, "system-update.html", maintenance);
    assert.equal(loaded.permissionCalls.length, 0, maintenance);
    assert.equal(loaded.cards().length, 0, maintenance);
    assert.equal(loaded.maintenanceCalls.start, 0, maintenance);
  }
});

test("never-settling Maintenance authority times out fail closed and ignores late completion", async () => {
  const gate = deferred();
  const loaded = loadDashboard({
    maintenanceGate: gate,
    dashboardSource: fastTimeoutSource()
  });
  await waitForTimeout();
  assert.equal(loaded.window.location.href, "system-update.html");
  assert.equal(loaded.permissionCalls.length, 0);
  assert.equal(loaded.cards().length, 0);
  assert.equal(loaded.modules.hidden, true);
  gate.resolve();
  await flush();
  assert.equal(loaded.permissionCalls.length, 0, "late Maintenance completion cannot restart Dashboard");
  assert.equal(loaded.cards().length, 0);
});

test("permission timeout is unavailable, remains cardless, and Retry succeeds without late repaint", async () => {
  const timedOut = deferred();
  const loaded = loadDashboard({
    dashboardSource: fastTimeoutSource(),
    permissionResults: [timedOut.promise, accessModel(["attendance"])]
  });
  await waitForTimeout();
  assert.equal(loaded.state.dataset.state, "unavailable");
  assert.equal(loaded.cards().length, 0);
  assert.equal(loaded.navLinks().length, 0);
  loaded.state.querySelectorAll(".cc-button")[0].dispatch("click");
  await flush();
  assert.deepEqual(loaded.cards().map((card) => card.dataset.moduleId), ["attendance"]);
  timedOut.resolve(accessModel(["cctv"]));
  await flush();
  assert.deepEqual(loaded.cards().map((card) => card.dataset.moduleId), ["attendance"]);
});

test("authorized, zero-module, unavailable, and malformed authority have distinct fail-closed states", async (t) => {
  await t.test("authorized", async () => {
    const loaded = loadDashboard({ permissionResults: [accessModel(["cctv"])] });
    await flush();
    assert.equal(loaded.state.hidden, true);
    assert.equal(loaded.modules.hidden, false);
    assert.deepEqual(loaded.cards().map((card) => card.dataset.moduleId), ["cctv"]);
    assert.equal(loaded.cards()[0].tagName, "A");
  });
  await t.test("zero module", async () => {
    const loaded = loadDashboard({ permissionResults: [accessModel([])] });
    await flush();
    assert.equal(loaded.state.dataset.state, "empty");
    assert.equal(loaded.cards().length, 0);
    assert.match(loaded.state.children[1].textContent, /No application sections/);
  });
  for (const reason of ["permission-service-unavailable", "malformed-permission-response"]) {
    await t.test(reason, async () => {
      const loaded = loadDashboard({
        permissionResults: [accessModel([], { available: false, reason })]
      });
      await flush();
      assert.equal(loaded.state.dataset.state, "unavailable");
      assert.equal(loaded.cards().length, 0);
      assert.equal(loaded.navLinks().length, 0);
      assert.equal(loaded.state.querySelectorAll(".cc-button").length, 2);
    });
  }
});

test("invalid session clears local lifecycle state, removes launchers, and exits to Login", async () => {
  const loaded = loadDashboard({
    permissionResults: [accessModel([], { available: false, reason: "invalid-session" })]
  });
  await flush();
  assert.equal(loaded.state.dataset.state, "invalid-session");
  assert.equal(loaded.cards().length, 0);
  assert.equal(loaded.navLinks().length, 0);
  assert.equal(loaded.clearCalls.length, 1);
  assert.equal(loaded.window.location.href, "login.html?expired=1");
});

test("malformed registry produces a controlled initialization failure instead of partial rendering", async () => {
  const malformed = shellSource.replace(
    "description: 'Main operations dashboard and module launcher.'",
    "description: null"
  );
  const loaded = loadDashboard({ shellSource: malformed });
  await flush();
  assert.equal(loaded.state.dataset.state, "error");
  assert.equal(loaded.cards().length, 0);
  assert.equal(loaded.modules.hidden, true);
  assert.equal(loaded.errors.length > 0, true);
});

test("late shell initialization failure rolls back permission Sidebar navigation", async () => {
  const loaded = loadDashboard({ themeFailure: true });
  await flush();
  assert.equal(loaded.state.dataset.state, "error");
  assert.equal(loaded.cards().length, 0);
  assert.equal(loaded.navLinks().length, 0);
  assert.equal(loaded.listenerCount("document", "keydown"), 0);
  assert.equal(loaded.mediaListeners.length, 0);
});

test("responsive shell setup transactionally removes every listener after each partial failure", async (t) => {
  for (const listenerFailure of ["trigger", "backdrop", "link", "keydown", "media"]) {
    await t.test(listenerFailure, async () => {
      const loaded = loadDashboard({ listenerFailure });
      await flush();
      assert.equal(loaded.state.dataset.state, "error");
      assert.equal(loaded.cards().length, 0);
      assert.equal(loaded.navLinks().length, 0);
      assert.equal(loaded.listenerTotal("cc-shell-nav-trigger", "click"), 0);
      assert.equal((loaded.elements.get("dashboard-nav-backdrop").listeners.get("click") || []).length, 0);
      assert.equal(loaded.listenerTotal("cc-shell-mobile-close", "click"), 0);
      assert.equal(loaded.listenerTotal("cc-shell-nav-link", "click"), 0);
      assert.equal(loaded.listenerCount("document", "keydown"), 0);
      assert.equal(loaded.mediaListeners.length, 0);
      assert.equal(loaded.elements.get("dashboard-shell").classList.contains("is-nav-open"), false);
      assert.equal(loaded.document.body.classList.contains("cc-shell-nav-lock"), false);
      assert.equal(loaded.elements.get("dashboard-nav-backdrop").hidden, true);
      assert.match(String(loaded.errors[0]?.[1]?.message || ""), new RegExp(listenerFailure, "i"));
    });
  }
});

test("a cleaned failed shell can initialize once, navigate normally, and teardown idempotently", async () => {
  const loaded = loadDashboard({ listenerFailure: "media", compact: true });
  await flush();
  assert.equal(loaded.listenerCount("document", "keydown"), 0);
  assert.equal(loaded.mediaListeners.length, 0);

  const controller = await loaded.window.CloudCrowdAppShell.initializeAppShell({
    shell: loaded.elements.get("dashboard-shell"),
    sidebar: loaded.elements.get("dashboard-app-sidebar"),
    topbar: loaded.elements.get("dashboard-app-topbar"),
    backdrop: loaded.elements.get("dashboard-nav-backdrop"),
    activeModule: loaded.window.CloudCrowdAppShell.getModuleById("dashboard"),
    fallbackMode: "legacy",
    accessModel: accessModel(["cctv"]),
    brandImage: "assets/images/logo.png",
    userId: "dashboard-user-name",
    roleId: "dashboard-role-badge",
    utilityActions: [loaded.elements.get("maintenance-toggle-btn")],
    onLogout: loaded.window.logout
  });

  assert.equal(loaded.listenerTotal("cc-shell-nav-trigger", "click"), 1);
  assert.equal((loaded.elements.get("dashboard-nav-backdrop").listeners.get("click") || []).length, 1);
  assert.equal(loaded.listenerCount("document", "keydown"), 1);
  assert.equal(loaded.mediaListeners.length, 1);
  loaded.navLinks().forEach((link) => assert.equal((link.listeners.get("click") || []).length, 1));

  const trigger = loaded.createdByClass("cc-shell-nav-trigger").at(-1);
  trigger.dispatch("click");
  assert.equal(loaded.elements.get("dashboard-shell").classList.contains("is-nav-open"), true);
  assert.equal(loaded.elements.get("dashboard-nav-backdrop").hidden, false);
  loaded.elements.get("dashboard-nav-backdrop").dispatch("click");
  assert.equal(loaded.elements.get("dashboard-shell").classList.contains("is-nav-open"), false);
  assert.equal(FakeElement.focused, trigger);

  controller.navigation.teardown();
  controller.navigation.teardown();
  assert.equal(loaded.listenerTotal("cc-shell-nav-trigger", "click"), 0);
  assert.equal((loaded.elements.get("dashboard-nav-backdrop").listeners.get("click") || []).length, 0);
  assert.equal(loaded.listenerTotal("cc-shell-nav-link", "click"), 0);
  assert.equal(loaded.listenerCount("document", "keydown"), 0);
  assert.equal(loaded.mediaListeners.length, 0);
  assert.equal(loaded.document.body.classList.contains("cc-shell-nav-lock"), false);
});

test("focus and visible restoration revoke and grant launcher plus Sidebar access", async () => {
  const loaded = loadDashboard({ permissionResults: [
    accessModel(["cctv"]),
    accessModel([]),
    accessModel(["attendance"])
  ] });
  await flush();
  assert.deepEqual(loaded.cards().map((card) => card.dataset.moduleId), ["cctv"]);

  loaded.dispatchWindow("focus");
  assert.equal(loaded.modules.hidden, true, "old cards are unusable synchronously");
  await flush();
  assert.equal(loaded.state.dataset.state, "empty");
  assert.equal(loaded.navLinks().some((link) => link.dataset.moduleId === "cctv"), false);

  loaded.document.visibilityState = "visible";
  loaded.dispatchDocument("visibilitychange");
  await flush();
  assert.deepEqual(loaded.cards().map((card) => card.dataset.moduleId), ["attendance"]);
  assert.equal(loaded.navLinks().some((link) => link.dataset.moduleId === "attendance"), true);
  assert.equal(loaded.permissionCalls.every((call) => call.force === true), true);
});

test("a timed-out Dashboard permission response cannot repaint a successful Retry", async () => {
  const older = deferred();
  const loaded = loadDashboard({
    dashboardSource: fastTimeoutSource(),
    permissionResults: [accessModel(["cctv"]), older.promise, accessModel(["attendance"])]
  });
  await flush();
  loaded.dispatchWindow("focus");
  await waitForTimeout();
  loaded.state.querySelectorAll(".cc-button")[0].dispatch("click");
  await flush();
  assert.deepEqual(loaded.cards().map((card) => card.dataset.moduleId), ["attendance"]);
  older.resolve(accessModel(["cctv"]));
  await flush();
  assert.deepEqual(loaded.cards().map((card) => card.dataset.moduleId), ["attendance"]);
});

test("one resume burst coalesces requests and announces loading once while later events still refresh", async () => {
  const inFlight = deferred();
  const loaded = loadDashboard({ permissionResults: [
    accessModel(["cctv"]), inFlight.promise, accessModel(["attendance"])
  ] });
  await flush();
  const initialCalls = loaded.permissionCalls.length;
  const initialLoadingTransitions = loaded.stateTransitions.filter((state) => state === "loading").length;
  loaded.dispatchWindow("focus");
  loaded.document.visibilityState = "visible";
  loaded.dispatchDocument("visibilitychange");
  loaded.dispatchWindow("focus");
  await flush(2);
  assert.equal(loaded.permissionCalls.length, initialCalls + 1);
  assert.equal(
    loaded.stateTransitions.filter((state) => state === "loading").length,
    initialLoadingTransitions + 1
  );
  inFlight.resolve(accessModel([]));
  await flush();
  loaded.dispatchWindow("focus");
  await flush();
  assert.equal(loaded.permissionCalls.length, initialCalls + 2);
  assert.deepEqual(loaded.cards().map((card) => card.dataset.moduleId), ["attendance"]);
});

test("repeated refresh retains one shell lifecycle and one handler per current menu link", async () => {
  const loaded = loadDashboard({ permissionResults: [
    accessModel(["cctv"]), accessModel(["attendance"]), accessModel(["cctv"])
  ] });
  await flush();
  const initialKeydown = loaded.listenerCount("document", "keydown");
  const initialMedia = loaded.mediaListeners.length;
  assert.equal(loaded.listenerCount("window", "focus"), 1);
  assert.equal(loaded.listenerCount("document", "visibilitychange"), 1);

  loaded.dispatchWindow("focus");
  await flush();
  loaded.dispatchWindow("focus");
  await flush();
  assert.equal(loaded.listenerCount("document", "keydown"), initialKeydown);
  assert.equal(loaded.mediaListeners.length, initialMedia);
  assert.equal(loaded.listenerCount("window", "focus"), 1);
  assert.equal(loaded.listenerCount("document", "visibilitychange"), 1);
  loaded.navLinks().forEach((link) => assert.equal((link.listeners.get("click") || []).length, 1));
});

test("local role and username never grant cards, Admin Center, or Manager defaults", async () => {
  for (const identity of [
    { username: "Anati", role: "admin" },
    { username: "Local Admin", role: "admin" },
    { username: "Local Manager", role: "manager" },
    { username: "Local Agent", role: "agent" }
  ]) {
    const loaded = loadDashboard({ ...identity, permissionResults: [accessModel([])] });
    await flush();
    assert.equal(loaded.cards().length, 0, identity.username);
    assert.equal(loaded.navLinks().some((link) => link.dataset.moduleId === "anati-admin"), false);
  }
  assert.doesNotMatch(dashboardRuntime, /requirePageAccess\(['"]dashboard/);
});

test("Call Queue stays hidden even if authority data contains a historical allow record", async () => {
  const loaded = loadDashboard({ permissionResults: [accessModel(["call_queue", "cctv"])] });
  await flush();
  assert.equal(loaded.cards().some((card) => card.dataset.moduleId === "call-queue"), false);
  assert.equal(loaded.navLinks().some((link) => link.dataset.moduleId === "call-queue"), false);
  assert.doesNotMatch(dashboardRuntime, /cc_call_queue_tickets_v1|call-queue|call_queue/i);
});

test("Dashboard runtime owns no domain, summary, metric, chart, activity, or Call Queue request", () => {
  assert.doesNotMatch(dashboardRuntime, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource/);
  assert.doesNotMatch(dashboardRuntime, /\/\.netlify\/functions\/(?:tickets|sheets|employees|attendance|training|weekly-quality|restaurants|restaurant-ratings|free-order-requests)/);
  assert.doesNotMatch(dashboardRuntime, /summary|metric|chart|activity|call.?queue/i);
  assert.match(shellSource, /ACCESS_ENDPOINT|CCPermissions\.getMyAccessModel/);
});

test("actual Dashboard launcher grid is shrinkable and reachable at all eight contract widths", () => {
  for (const width of [1440, 1280, 1024, 768, 430, 390, 360, 320]) {
    const cascade = createCascade(ROOT, "dashboard.html", { viewportWidth: width });
    const html = cssElement("html", { attributes: { "data-theme": "light" } });
    const body = cssElement("body", { classes: ["dashboard-page"] }, html);
    const shell = cssElement("div", { classes: ["cc-shell-layout", "has-responsive-navigation"] }, body);
    const sidebar = cssElement("aside", { classes: ["cc-shell-sidebar"] }, shell);
    const main = cssElement("main", { classes: ["cc-shell-main"] }, shell);
    const container = cssElement("div", { classes: ["dashboard-page-container", "cc-page-container", "cc-page-container--standard"] }, main);
    const groups = cssElement("div", { classes: ["dashboard-module-groups"] }, container);
    const section = cssElement("section", { classes: ["cc-dashboard-module-group"] }, groups);
    const grid = cssElement("div", { classes: ["cc-shell-dashboard-grid"] }, section);
    const card = cssElement("a", { classes: ["cc-shell-module-card", "cc-card"] }, grid);
    cssElement("h3", { classes: ["cc-shell-module-card-title"] }, card);
    cssElement("p", { classes: ["cc-shell-module-card-description"] }, card);

    assert.equal(cascade.resolveValue(grid, cascade.winner(grid, "min-width").value), "0", `${width} grid shrink`);
    assert.equal(cascade.resolveValue(card, cascade.winner(card, "min-width").value), "0", `${width} card shrink`);
    assert.equal(cascade.winner(card, "overflow-wrap").value, "anywhere", `${width} long content wraps`);
    assert.notEqual(cascade.winner(container, "overflow-x")?.value, "hidden", `${width} page not clipped`);
    const columns = cascade.resolveValue(grid, cascade.winner(grid, "grid-template-columns").value);
    if (width <= 620) assert.equal(columns, "1fr", `${width} one-column launcher`);
    else if (width <= 900) assert.match(columns, /auto-fit.*minmax\(min\(100%, 300px\), 1fr\)/, `${width} two-column launcher`);
    else assert.match(columns, /auto-fit.*minmax\(min\(100%, 205px\), 1fr\)/, `${width} precision launcher`);
    assert.equal(cascade.winner(sidebar, "position").value, width <= 1024 ? "fixed" : "sticky", `${width} shell relationship`);
  }
  assert.match(dashboardCss, /\.dashboard-page\s*\{[\s\S]*?min-width:\s*320px/);
});

test("twenty executable Sprint 1.14 mutants fail their intended behavioral contracts", async (t) => {
  const mutate = (source, find, replacement, name) => {
    const mutant = source.replace(find, replacement);
    assert.notEqual(mutant, source, `${name} mutation applied`);
    return mutant;
  };
  const maintenanceWithoutAwait = deferred();
  const staleOlder = deferred();
  const staleNewer = deferred();
  const preAuthority = deferred();
  const refreshWithoutCleanup = deferred();
  const cases = [
    {
      name: "denied permission renders cards",
      options: { shellSource: mutate(shellSource,
        "return candidates.filter((module) => canViewModule(module, accessModel)).map(cloneModule);",
        "return candidates.map(cloneModule);", "denied") , permissionResults: [accessModel([])] },
      contract: (loaded) => assert.equal(loaded.cards().length, 0, "denied authority must render no cards")
    },
    {
      name: "permission unavailable becomes allow-all",
      options: { shellSource: mutate(shellSource,
        "if (accessModel?.available !== true) throw new Error('Permission state unavailable');",
        "if (accessModel?.available !== true) return candidates.map(cloneModule);", "unavailable"),
        permissionResults: [accessModel([], { available: false })] },
      contract: (loaded) => assert.equal(loaded.navLinks().length, 0, "unavailable authority must clear Sidebar")
    },
    {
      name: "local cc_role grants authority",
      options: { role: "admin", shellSource: mutate(shellSource,
        "if (!module.permissionKey) return true;",
        "if (readSessionValue('cc_role') === 'admin') return true;\n    if (!module.permissionKey) return true;", "role"),
        permissionResults: [accessModel([])] },
      contract: (loaded) => assert.equal(loaded.cards().length, 0, "local role must grant no cards")
    },
    {
      name: "local cc_user grants authority",
      options: { username: "Anati", shellSource: mutate(shellSource,
        "if (!module.permissionKey) return true;",
        "if (readSessionValue('cc_user') === 'Anati') return true;\n    if (!module.permissionKey) return true;", "user"),
        permissionResults: [accessModel([])] },
      contract: (loaded) => assert.equal(loaded.cards().length, 0, "local username must grant no cards")
    },
    {
      name: "non-Anati receives Admin Center",
      options: { shellSource: mutate(shellSource,
        "if (!module.permissionKey) return true;",
        "if (!module.permissionKey || module.permissionKey === 'anati_admin') return true;", "Admin authority"),
        permissionResults: [accessModel([])] },
      contract: (loaded) => assert.equal(loaded.cards().some((card) => card.dataset.moduleId === "anati-admin"), false)
    },
    {
      name: "hidden filtering removed",
      options: { shellSource: shellSource.replaceAll("module.hidden !== true", "true"),
        permissionResults: [accessModel(["call_queue"])] },
      verifyMutation: (options) => assert.notEqual(options.shellSource, shellSource),
      contract: (loaded) => assert.equal(loaded.cards().some((card) => card.dataset.moduleId === "call-queue"), false)
    },
    {
      name: "Call Queue hidden flag neutralized",
      options: { shellSource: mutate(shellSource, "hidden: true,", "hidden: false,", "Call Queue hidden"),
        permissionResults: [accessModel(["call_queue"])] },
      contract: (loaded) => assert.equal(loaded.navLinks().some((link) => link.dataset.moduleId === "call-queue"), false)
    },
    {
      name: "manual Call Queue launcher injected",
      options: { dashboardSource: mutate(dashboardRuntime,
        "modules.hidden = false;",
        "const injected = document.createElement('a'); injected.className = 'cc-shell-module-card'; injected.dataset.moduleId = 'call-queue'; modules.appendChild(injected); modules.hidden = false;",
        "manual Call Queue"), permissionResults: [accessModel(["cctv"])] },
      contract: (loaded) => assert.equal(loaded.cards().some((card) => card.dataset.moduleId === "call-queue"), false)
    },
    {
      name: "Call Queue storage dependency introduced",
      options: { dashboardSource: mutate(dashboardRuntime, "startDashboard();",
        "localStorage.getItem('cc_call_queue_tickets_v1'); startDashboard();", "Call Queue storage") },
      contract: (loaded) => assert.deepEqual(loaded.storageReads, [])
    },
    {
      name: "Maintenance await removed",
      options: { maintenanceGate: maintenanceWithoutAwait, dashboardSource: mutate(dashboardRuntime,
        "await withAuthorityTimeout(maintenance.enforceMaintenanceMode(), 'maintenance');",
        "maintenance.enforceMaintenanceMode();", "Maintenance await") },
      contract: (loaded) => assert.equal(loaded.cards().length, 0, "pending Maintenance must block cards"),
      cleanup: () => maintenanceWithoutAwait.resolve()
    },
    {
      name: "invalid-session redirect removed",
      options: { dashboardSource: mutate(dashboardRuntime, "window.location.href = LOGIN_ROUTE;", "return;", "invalid redirect"),
        permissionResults: [accessModel([], { available: false, reason: "invalid-session" })] },
      contract: (loaded) => assert.equal(loaded.window.location.href, "login.html?expired=1")
    },
    {
      name: "stale generations and synchronization removed",
      options: (() => {
        let source = dashboardRuntime.replaceAll("if (generation !== refreshGeneration) return;", "");
        source = mutate(source, "if (refreshInFlight) return refreshInFlight;", "", "stale synchronization");
        return { dashboardSource: source, permissionResults: [accessModel(["cctv"]), staleOlder.promise, staleNewer.promise] };
      })(),
      async scenario(loaded) {
        loaded.dispatchWindow("focus");
        await flush(2);
        loaded.dispatchWindow("focus");
        await flush(2);
        staleNewer.resolve(accessModel(["attendance"]));
        await flush();
        staleOlder.resolve(accessModel(["cctv"]));
        await flush();
      },
      contract: (loaded) => assert.deepEqual(loaded.cards().map((card) => card.dataset.moduleId), ["attendance"])
    },
    {
      name: "pre-authority launcher render introduced",
      options: { dashboardSource: mutate(dashboardRuntime,
        "const accessModel = await withAuthorityTimeout(",
        "showAuthorizedModules(); const accessModel = await withAuthorityTimeout(", "pre-authority"),
        permissionResults: [preAuthority.promise] },
      async scenario() { await flush(2); },
      contract: (loaded) => assert.equal(loaded.modules.hidden, true, "pending permission must keep launchers hidden"),
      cleanup: () => preAuthority.resolve(accessModel([]))
    },
    {
      name: "refresh cleanup removed",
      options: { dashboardSource: mutate(dashboardRuntime,
        "if (refreshInFlight) return refreshInFlight;\n    clearPresentedAuthority();",
        "if (refreshInFlight) return refreshInFlight;", "refresh cleanup"),
        permissionResults: [accessModel(["cctv"]), refreshWithoutCleanup.promise] },
      async scenario(loaded) { loaded.dispatchWindow("focus"); await flush(2); },
      contract: (loaded) => assert.equal(loaded.navLinks().some((link) => link.dataset.moduleId === "cctv"), false),
      cleanup: () => refreshWithoutCleanup.resolve(accessModel([]))
    },
    {
      name: "native anchor replaced with div",
      options: { shellSource: mutate(shellSource,
        "function createModuleCard(module) {\n    const link = document.createElement('a');",
        "function createModuleCard(module) {\n    const link = document.createElement('div');", "anchor") },
      contract: (loaded) => assert.equal(loaded.cards()[0].tagName, "A")
    },
    {
      name: "zero-module state removed",
      options: { dashboardSource: mutate(dashboardRuntime, "if (dashboardModules.length === 0) {", "if (false) {", "zero state"),
        permissionResults: [accessModel([])] },
      contract: (loaded) => assert.equal(loaded.state.dataset.state, "empty")
    },
    {
      name: "malformed registry validation fails open",
      options: { shellSource: mutate(
        mutate(shellSource, "description: 'Main operations dashboard and module launcher.'", "description: null", "malformed registry"),
        "if (!valid || ids.has(module.id) || routes.has(module.route)) {", "if (false) {", "registry fail-open") },
      contract: (loaded) => assert.equal(loaded.state.dataset.state, "error")
    },
    {
      name: "domain summary request introduced",
      options: { dashboardSource: mutate(dashboardRuntime, "startDashboard();", "fetch('/.netlify/functions/dashboard-summary'); startDashboard();", "domain request") },
      contract: (loaded) => assert.deepEqual(loaded.networkCalls, [])
    },
    {
      name: "Admin copy regresses to planning language",
      options: { shellSource: mutate(shellSource,
        "Manage user accounts, roles, temporary-password lifecycle, and enforced module access.",
        "Manage user profiles, roles, module access planning, and future workflow permissions.", "Admin copy"),
        permissionResults: [accessModel(["anati_admin"])] },
      contract(loaded) {
        const card = loaded.cards().find((entry) => entry.dataset.moduleId === "anati-admin");
        assert.equal(card.children[2].textContent,
          "Manage user accounts, roles, temporary-password lifecycle, and enforced module access.");
      }
    },
    {
      name: "late responsive shell teardown removed",
      options: { listenerFailure: "media", shellSource: mutate(shellSource,
        "      teardown();\n      throw error;", "      void teardown;\n      throw error;", "responsive teardown") },
      contract(loaded) {
        assert.equal(loaded.listenerCount("document", "keydown"), 0, "failed setup must remove keydown");
        assert.equal(loaded.mediaListeners.length, 0, "failed setup must remove media listener");
        assert.equal(loaded.listenerTotal("cc-shell-nav-trigger", "click"), 0, "failed setup must remove trigger");
        assert.equal((loaded.elements.get("dashboard-nav-backdrop").listeners.get("click") || []).length, 0,
          "failed setup must remove backdrop");
        assert.equal(loaded.listenerTotal("cc-shell-nav-link", "click"), 0, "failed setup must remove link handlers");
      }
    }
  ];

  assert.equal(cases.length, 20);
  for (const mutant of cases) {
    await t.test(mutant.name, async () => {
      mutant.verifyMutation?.(mutant.options);
      const loaded = loadDashboard(mutant.options);
      if (mutant.scenario) await mutant.scenario(loaded);
      else if (mutant.settle !== false) await flush();
      try {
        assert.throws(() => mutant.contract(loaded), undefined, `${mutant.name} behavioral contract rejected mutant`);
      } finally {
        mutant.cleanup?.();
        await flush(2);
      }
    });
  }
});

test("supplementary Dashboard source invariants preserve product boundaries", () => {
  assert.doesNotMatch(dashboardRuntime, /requirePageAccess\(['"]dashboard|getModuleAccess\([^)]*dashboard/);
  assert.doesNotMatch(dashboardRuntime, /cc_call_queue_tickets_v1|\bfetch\s*\(/);
  assert.match(shellSource, /id: 'call-queue',[\s\S]*?hidden: true,/);
});

test("Dashboard state CSS remains semantic, focus-compatible, and reduced-motion-neutral", () => {
  assert.doesNotMatch(dashboardCss, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  assert.match(dashboardCss, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(dashboardCss, /outline:\s*none|animation:/);
  const themeBase = fs.readFileSync(path.join(ROOT, "assets/css/theme-base.css"), "utf8");
  assert.match(themeBase, /:focus-visible/);
  assert.match(themeBase, /@media \(prefers-reduced-motion: reduce\)/);
});
