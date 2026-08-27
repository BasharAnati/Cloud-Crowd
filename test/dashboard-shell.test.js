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
const shellSource = fs.readFileSync(path.join(ROOT, "js/app-shell.js"), "utf8");
const permissionsSource = fs.readFileSync(path.join(ROOT, "js/permissions.js"), "utf8");
const dashboardSource = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
const dashboardRuntime = fs.readFileSync(path.join(ROOT, "js/dashboard.js"), "utf8");
const maintenanceRuntime = fs.readFileSync(path.join(ROOT, "js/maintenance.js"), "utf8");
const shellCss = fs.readFileSync(path.join(ROOT, "app-shell.css"), "utf8");
const dashboardCss = fs.readFileSync(path.join(ROOT, "assets/css/pages/dashboard.css"), "utf8");
const PERMISSION_KEYS = [
  "cctv", "customer_experience", "daily_complaints", "complimentary_orders",
  "free_order_requests", "free_order_share", "call_queue", "employee_profiles",
  "attendance", "weekly_quality", "agent_training", "employee_deductions",
  "client_profiles", "restaurant_ratings", "anati_admin"
];

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.className = "";
    this.hidden = false;
    this.inert = false;
    this.textContent = "";
    this.parentNode = null;
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
  }

  dispatch(type, event = {}) {
    (this.listeners.get(type) || []).forEach((listener) => listener({ type, ...event }));
  }

  click() {
    this.dispatch("click");
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
    const visit = (node) => {
      node.children.forEach((child) => {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      });
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function loadShell(options = {}) {
  const values = {
    cc_user: options.username || "Test User",
    cc_role: options.role || "agent",
    cc_token: Object.prototype.hasOwnProperty.call(options, "token") ? options.token : "test-token"
  };
  const documentListeners = new Map();
  const fetchCalls = [];
  const mediaListeners = [];
  const mediaQuery = {
    matches: options.compact === true,
    addEventListener(type, listener) {
      if (type === "change") mediaListeners.push(listener);
    }
  };
  const document = {
    body: new FakeElement("body"),
    createElement(tagName) { return new FakeElement(tagName); },
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    }
  };
  const window = {
    document,
    location: { pathname: "/dashboard.html", href: "" },
    matchMedia() { return mediaQuery; },
    sessionStorage: { getItem(key) { return values[key] || ""; } },
    CloudCrowdTheme: { createToggle() { return new FakeElement("button"); } }
  };
  window.window = window;
  const fetch = async (url, requestOptions) => {
    fetchCalls.push({ url, options: requestOptions });
    return {
      ok: true,
      async json() {
        if (options.legacyFallback) {
          return { ok: true, legacyFallback: true, hasConfiguredAccess: false, access: [] };
        }
        return {
          ok: true,
          legacyFallback: false,
          hasConfiguredAccess: true,
          access: PERMISSION_KEYS.map((moduleKey) => ({
            moduleKey,
            canView: moduleKey !== "anati_admin"
              ? !(options.denied || []).includes(moduleKey)
              : values.cc_user.toLowerCase() === "anati" && values.cc_role === "admin",
            canCreate: true,
            canEdit: true,
            canDelete: false
          }))
        };
      }
    };
  };
  const context = {
    window,
    document,
    sessionStorage: window.sessionStorage,
    fetch,
    console: { warn() {}, error: console.error, log: console.log }
  };
  vm.runInNewContext(permissionsSource, context);
  vm.runInNewContext(shellSource, context);
  return { api: window.CloudCrowdAppShell, document, documentListeners, fetchCalls, mediaQuery, window };
}

test("Dashboard loads the shared theme and shell before page-specific presentation", () => {
  const themeIndex = dashboardSource.indexOf('src="assets/js/theme.js"');
  const firstStylesheetIndex = dashboardSource.indexOf('rel="stylesheet"');
  assert.ok(themeIndex > -1 && themeIndex < firstStylesheetIndex);
  assert.match(dashboardSource, /<html[^>]+data-theme="light"/);
  assert.match(dashboardSource, /href="assets\/css\/design-tokens\.css"/);
  assert.match(dashboardSource, /href="app-shell\.css"/);
  assert.match(dashboardSource, /href="assets\/css\/theme-base\.css"/);
  assert.match(dashboardSource, /src="js\/app-shell\.js" defer/);
  assert.match(dashboardSource, /src="js\/maintenance\.js" defer/);
  assert.match(dashboardSource, /src="js\/dashboard\.js" defer/);
});

test("Dashboard has one page heading and only semantic launcher navigation", () => {
  assert.equal((dashboardSource.match(/<h1\b/g) || []).length, 1);
  assert.match(dashboardSource, /<aside id="dashboard-app-sidebar"/);
  assert.match(dashboardSource, /<main class="cc-shell-main" id="main-content">/);
  assert.match(dashboardSource, /<header class="dashboard-hero cc-page-header">/);
  assert.match(dashboardSource, /class="dashboard-hero-earth"/);
  assert.match(dashboardSource, /src="assets\/images\/dashboard\/dashboard-hero-earth\.png"/);
  assert.match(dashboardSource, /alt=""/);
  assert.match(dashboardSource, /aria-hidden="true"/);
  assert.match(dashboardSource, /width="1772"/);
  assert.match(dashboardSource, /height="887"/);
  assert.match(dashboardSource, /decoding="async"/);
  assert.match(dashboardSource, /<div class="cc-page-header-content">/);
  assert.match(dashboardSource, /<p class="cc-page-header-context">/);
  assert.match(dashboardSource, /<h1 class="cc-page-header-title">/);
  assert.match(dashboardSource, /<p class="cc-page-header-description">/);
  assert.doesNotMatch(dashboardSource, /dashboard-page-header|dashboard-page-context|dashboard-page-description/);
  assert.doesNotMatch(dashboardCss, /dashboard-page-header|dashboard-page-context|dashboard-page-description/);
  assert.match(shellCss, /\.cc-page-header\s*\{/);
  assert.doesNotMatch(dashboardSource, /class="(?:sidebar|nav-item|section-card)\b/);
  assert.doesNotMatch(dashboardSource, /onclick=|role="link"|tabindex="0"/);
  assert.doesNotMatch(dashboardSource, /DASHBOARD_MODULE_KEYS|DASHBOARD_ACCESS_ENDPOINT/);
});

test("The shared route registry preserves Dashboard routes, titles, descriptions, and special visibility", () => {
  const { api } = loadShell();
  const expected = [
    ["cctv", "CCTV Operator Observations", "cctv.html", "cctv", "Track CCTV operator notes and document observed violations to support stronger security and discipline."],
    ["customer-experience", "Customer Experience", "ce.html", "customer_experience", "Collect customer feedback through calls and record complaints or comments that require follow-up."],
    ["daily-complaints", "Daily Complaints", "complaints.html", "daily_complaints", "Document all complaints received by the call center and keep daily operational follow-up visible."],
    ["complimentary-orders", "Complimentary Orders", "free-orders.html", "complimentary_orders", "Record order and customer details for discounts or compensations, including approval details."],
    ["free-order-requests", "Free Order Requests", "free-order-requests.html", "free_order_requests", "Manage immediate free order compensation requests from entry to sharing readiness."],
    ["free-order-share", "Free Order Share", "free-order-share.html", "free_order_share", "Review ready free order requests, request clarifications, and mark completed shares."],
    ["employee-profiles", "Employee Profiles", "employee-profiles.html", "employee_profiles", "Maintain central employee records, contact details, emergency contacts, and restaurant assignments."],
    ["attendance", "Attendance & Shift Tracking", "attendance.html", "attendance", "Track employee attendance, shift schedules, and extra hours."],
    ["weekly-quality", "Weekly Quality Sheet", "weekly-quality.html", "weekly_quality", "Evaluate weekly call quality, calculate performance scores, and track pending or reviewed calls."],
    ["agent-training", "Agent Training", "agent-training.html", "agent_training", "Manage brand assignments, training status, coaching needs, and employee training progress."],
    ["employee-deductions", "Employee Deductions", "employee-deductions.html", "employee_deductions", "Track employee deductions, personal orders, discounts, and financial adjustments."],
    ["client-profiles", "Client Profiles", "client-profiles.html", "client_profiles", "Maintain restaurant and brand profiles, ownership contacts, numbers, logos, and operational notes."],
    ["restaurant-ratings", "Restaurant Ratings", "restaurant-ratings.html", "restaurant_ratings", "Track weekly Talabat and Careem ratings across active restaurant and brand profiles."],
    ["anati-admin", "Anati Admin Center", "anati-admin.html", "anati_admin", "Manage user accounts, roles, temporary-password lifecycle, and enforced module access."]
  ];
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.getDashboardModules().map((module) => [
      module.id,
      module.title,
      module.route,
      module.permissionKey,
      module.description
    ]))),
    expected
  );
  assert.equal(api.getAllModules().find((module) => module.id === "call-queue").hidden, true);
  assert.equal(api.getModuleById("anati-admin").anatiOnly, true);
  const allModules = api.getAllModules();
  assert.equal(new Set(allModules.map((module) => module.id)).size, allModules.length);
  assert.equal(new Set(allModules.map((module) => module.route)).size, allModules.length);
  allModules.forEach((module) => {
    assert.equal(fs.existsSync(path.join(ROOT, module.route)), true, `missing route ${module.route}`);
  });
});

test("One permission result synchronizes sidebar and Dashboard module visibility", async () => {
  const { api, fetchCalls } = loadShell({ denied: ["daily_complaints", "attendance"] });
  const permitted = await api.filterPermittedModules(api.getAllModules(), { fallbackMode: "legacy" });
  const sidebarIds = permitted.filter((module) => module.showInSidebar).map((module) => module.id);
  const dashboardIds = permitted.filter((module) => module.showInDashboard).map((module) => module.id);
  assert.equal(sidebarIds.includes("daily-complaints"), false);
  assert.equal(dashboardIds.includes("daily-complaints"), false);
  assert.equal(sidebarIds.includes("attendance"), false);
  assert.equal(dashboardIds.includes("attendance"), false);
  assert.equal(sidebarIds.includes("cctv"), true);
  assert.equal(dashboardIds.includes("cctv"), true);
  assert.equal(sidebarIds.includes("anati-admin"), false);
  assert.equal(fetchCalls.length, 1);
});

test("Shared page access honors configured records and fails closed without local Anati authority", async () => {
  const configured = loadShell({ denied: ["attendance"] });
  const denied = await configured.window.CCPermissions.getMyAccess("attendance");
  assert.equal(denied.canView, false);
  assert.notEqual(denied.legacyFallback, true);
  assert.equal(configured.fetchCalls.length, 1);

  const legacy = loadShell({ legacyFallback: true });
  const legacyAccess = await legacy.window.CCPermissions.getMyAccess("attendance");
  assert.equal(legacyAccess.canView, false);
  assert.equal(legacyAccess.unavailable, true);
  assert.equal(legacy.fetchCalls.length, 1);

  const anati = loadShell({ username: "Anati", role: "admin" });
  const anatiAccess = await anati.window.CCPermissions.getMyAccess("anati_admin");
  assert.equal(anatiAccess.canView, true);
  assert.notEqual(anatiAccess.unavailable, true);
  assert.equal(anati.fetchCalls.length, 1);
});

test("Dashboard route lifecycle builds shell, topbar, and cards from one permission retrieval", async () => {
  const { api, fetchCalls } = loadShell({ denied: ["attendance"] });
  const shell = new FakeElement("div");
  const sidebar = new FakeElement("aside");
  sidebar.id = "dashboard-app-sidebar";
  const topbar = new FakeElement("header");
  const moduleContainer = new FakeElement("div");
  const backdrop = new FakeElement("button");
  const result = await api.initializeAppShell({
    shell,
    sidebar,
    topbar,
    backdrop,
    activeModule: api.getModuleById("dashboard"),
    fallbackMode: "legacy",
    onLogout() {}
  });
  await api.renderDashboardModules(moduleContainer, {
    modules: result.permittedModules.filter((module) => module.showInDashboard),
    modulesArePermitted: true
  });

  assert.equal(result.permittedModules.some((module) => module.id === "attendance"), false);
  assert.equal(sidebar.querySelectorAll(".cc-shell-nav-link").some((link) => link.dataset.moduleId === "attendance"), false);
  assert.equal(moduleContainer.querySelectorAll(".cc-shell-module-card").some((link) => link.dataset.moduleId === "attendance"), false);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "/.netlify/functions/admin-users?my-access=1");
  assert.equal(fetchCalls[0].options.headers.Authorization, "Bearer test-token");
  assert.ok(result.navigation);
  assert.ok(result.topbar.navigationButton);
});

test("The shared shell lifecycle is page-neutral and Dashboard keeps page rendering in its runtime", () => {
  assert.match(shellSource, /async function initializeAppShell/);
  assert.doesNotMatch(shellSource, /initializeDashboard|moduleContainer/);
  assert.match(dashboardRuntime, /CloudCrowdAppShell\.initializeAppShell/);
  assert.match(dashboardRuntime, /CloudCrowdAppShell\.renderDashboardModules/);
  assert.ok(
    dashboardRuntime.indexOf("initializeAppShell") < dashboardRuntime.indexOf("renderDashboardModules"),
    "Dashboard must resolve the shared shell before rendering its page-family content"
  );
});

test("Permission-service fallback is empty while authoritative Anati access remains available", async () => {
  const regular = loadShell({ legacyFallback: true });
  const regularModules = await regular.api.filterPermittedModules(regular.api.getAllModules(), { fallbackMode: "legacy" });
  assert.equal(regularModules.some((module) => module.id === "cctv"), false);
  assert.equal(regularModules.some((module) => module.id === "anati-admin"), false);
  assert.equal(regularModules.some((module) => module.id === "call-queue"), false);

  const anati = loadShell({ username: "Anati", role: "admin" });
  const anatiModules = await anati.api.filterPermittedModules(anati.api.getAllModules(), { fallbackMode: "legacy" });
  assert.equal(anatiModules.some((module) => module.id === "anati-admin"), true);
  assert.equal(anatiModules.some((module) => module.id === "call-queue"), false);
});

test("Shared Dashboard renderer creates grouped semantic links from registry records", async () => {
  const { api } = loadShell();
  const container = new FakeElement("div");
  const modules = api.getDashboardModules().filter((module) => ["cctv", "employee-profiles", "client-profiles"].includes(module.id));
  await api.renderDashboardModules(container, { modules, modulesArePermitted: true });
  assert.deepEqual(container.children.map((section) => section.dataset.group), ["Operations", "HR", "Business"]);
  const cards = container.querySelectorAll(".cc-shell-module-card");
  assert.equal(cards.length, 3);
  assert.equal(cards.every((card) => card.tagName === "A"), true);
  assert.deepEqual(cards.map((card) => card.href), ["cctv.html", "employee-profiles.html", "client-profiles.html"]);
});

test("Responsive navigation opens, closes, restores focus, and exposes current route", async () => {
  const { api, document, documentListeners } = loadShell({ compact: true });
  const shell = new FakeElement("div");
  shell.classList.add("has-responsive-navigation");
  const sidebar = new FakeElement("aside");
  sidebar.id = "dashboard-app-sidebar";
  const topbar = new FakeElement("header");
  const backdrop = new FakeElement("button");
  const modules = api.getAllModules().filter((module) => ["dashboard", "cctv"].includes(module.id));
  await api.buildSidebar(sidebar, {
    activeModule: api.getModuleById("dashboard"),
    modules,
    modulesArePermitted: true,
    responsiveNavigation: true
  });
  const topbarResult = api.buildTopbar(topbar, {
    activeModule: api.getModuleById("dashboard"),
    responsiveNavigation: true,
    sidebarId: sidebar.id
  });
  api.setupResponsiveNavigation({ shell, sidebar, trigger: topbarResult.navigationButton, backdrop });

  const activeLink = sidebar.querySelectorAll(".cc-shell-nav-link").find((link) => link.dataset.moduleId === "dashboard");
  assert.equal(activeLink.getAttribute("aria-current"), "page");
  assert.equal(sidebar.getAttribute("aria-hidden"), "true");
  topbarResult.navigationButton.click();
  assert.equal(shell.classList.contains("is-nav-open"), true);
  assert.equal(topbarResult.navigationButton.getAttribute("aria-expanded"), "true");
  assert.equal(sidebar.getAttribute("aria-hidden"), "false");
  assert.equal(document.body.classList.contains("cc-shell-nav-lock"), true);
  sidebar.querySelector(".cc-shell-mobile-close").click();
  assert.equal(shell.classList.contains("is-nav-open"), false);
  assert.equal(FakeElement.focused, topbarResult.navigationButton);

  topbarResult.navigationButton.click();
  backdrop.click();
  assert.equal(shell.classList.contains("is-nav-open"), false);
  assert.equal(document.body.classList.contains("cc-shell-nav-lock"), false);

  topbarResult.navigationButton.click();
  documentListeners.get("keydown").forEach((listener) => listener({ key: "Escape" }));
  assert.equal(shell.classList.contains("is-nav-open"), false);
  assert.equal(FakeElement.focused, topbarResult.navigationButton);

  topbarResult.navigationButton.click();
  sidebar.querySelectorAll(".cc-shell-nav-link")[1].click();
  assert.equal(shell.classList.contains("is-nav-open"), false);
  assert.equal(document.body.classList.contains("cc-shell-nav-lock"), false);
});

test("shared responsive controls remain hidden on desktop and visible only in drawer mode", () => {
  for (const [width, expectedDisplay] of [[1440, "none"], [1025, "none"], [1024, "inline-flex"], [390, "inline-flex"]]) {
    const cascade = createCascade(ROOT, "dashboard.html", { viewportWidth: width });
    const html = cssElement("html");
    const body = cssElement("body", { classes: ["dashboard-page"] }, html);
    const shell = cssElement("div", { classes: ["cc-shell-layout", "has-responsive-navigation"] }, body);
    const sidebar = cssElement("aside", { classes: ["cc-shell-sidebar"] }, shell);
    const topbar = cssElement("header", { classes: ["cc-shell-topbar"] }, shell);
    const trigger = cssElement("button", { classes: ["cc-shell-nav-trigger", "cc-button", "cc-button--secondary", "cc-button--md"] }, topbar);
    const close = cssElement("button", { classes: ["cc-shell-mobile-close", "cc-button", "cc-button--secondary", "cc-button--md"] }, sidebar);
    assert.equal(cascade.winner(trigger, "display").value, expectedDisplay, `${width} Menu visibility`);
    assert.equal(cascade.winner(close, "display").value, expectedDisplay, `${width} Close visibility`);
  }
});

test("Responsive shell geometry is opt-in and leaves existing production pages unchanged", () => {
  const existingPages = [
    ["cctv.html", ["cctv-page", "cctv-ops-center"], "cctv-module-shell", "cctv-app-sidebar"],
    ["ce.html", ["ce-page", "ce-ops-center"], "ce-module-shell", "ce-app-sidebar"],
    ["complaints.html", ["complaints-page", "complaints-ops-center"], "complaints-module-shell", "complaints-app-sidebar"],
    ["free-orders.html", ["free-orders-page", "free-orders-ops-center"], "free-orders-module-shell", "free-orders-app-sidebar"]
  ];

  existingPages.forEach(([page, bodyClasses, shellClass, sidebarId]) => {
    const cascade = createCascade(ROOT, page, { viewportWidth: 1024 });
    const html = cssElement("html");
    const body = cssElement("body", { classes: bodyClasses }, html);
    const shell = cssElement("div", { classes: [shellClass, "cc-shell-layout"] }, body);
    const sidebar = cssElement("aside", { id: sidebarId, classes: ["cc-shell-sidebar"] }, shell);
    const position = cascade.winner(sidebar, "position");
    const height = cascade.winner(sidebar, "height");
    assert.notEqual(position?.value, "sticky", `${page} must not inherit the Dashboard sticky sidebar`);
    assert.notEqual(position?.value, "fixed", `${page} must not inherit the Dashboard off-canvas sidebar`);
    assert.notEqual(height?.value, "100vh", `${page} must not inherit the Dashboard viewport-height sidebar`);
  });

  const cascade = createCascade(ROOT, "dashboard.html", { viewportWidth: 1024 });
  const html = cssElement("html");
  const body = cssElement("body", { classes: ["dashboard-page"] }, html);
  const shell = cssElement("div", { classes: ["cc-shell-layout", "has-responsive-navigation"] }, body);
  const sidebar = cssElement("aside", { id: "dashboard-app-sidebar", classes: ["cc-shell-sidebar"] }, shell);
  assert.equal(cascade.winner(sidebar, "position").value, "fixed");
  assert.equal(cascade.winner(sidebar, "height").value, "100vh");
});

test("Dashboard consumes shared semantic theme surfaces in light and dark modes", () => {
  const resolved = {};
  ["light", "dark"].forEach((theme) => {
    const cascade = createCascade(ROOT, "dashboard.html", { viewportWidth: 1440 });
    const html = cssElement("html", { attributes: { "data-theme": theme } });
    const body = cssElement("body", { classes: ["dashboard-page"] }, html);
    const shell = cssElement("div", { classes: ["cc-shell-layout", "has-responsive-navigation"] }, body);
    const main = cssElement("main", { classes: ["cc-shell-main"] }, shell);
    const container = cssElement("div", { classes: ["dashboard-page-container"] }, main);
    const header = cssElement("header", { classes: ["cc-page-header"] }, container);
    const content = cssElement("div", { classes: ["cc-page-header-content"] }, header);
    const title = cssElement("h1", { classes: ["cc-page-header-title"] }, content);
    const card = cssElement("a", { classes: ["cc-shell-module-card"] }, container);
    resolved[theme] = {
      title: effectiveColor(cascade, title, "color").color,
      card: effectiveColor(cascade, card, "background-color").color
    };
  });
  assert.notEqual(resolved.light.title, resolved.dark.title);
  assert.notEqual(resolved.light.card, resolved.dark.card);

  const themeRuntime = fs.readFileSync(path.join(ROOT, "assets/js/theme.js"), "utf8");
  assert.match(themeRuntime, /const STORAGE_KEY = "cc_theme"/);
  assert.match(themeRuntime, /"system"/);
});

test("Dashboard lifecycle preserves authentication, logout, maintenance, and idle contracts", () => {
  assert.match(dashboardSource, /src="js\/auth\.js"/);
  assert.match(dashboardSource, /readSessionValue\('cc_auth'\) !== '1'/);
  assert.match(dashboardSource, /readSessionValue\('cc_token'\)/);
  assert.match(dashboardSource, /readSessionValue\('cc_role'\)/);
  assert.match(dashboardSource, /src="idle-logout\.js"/);
  assert.match(dashboardRuntime, /onLogout: window\.logout/);
  assert.match(dashboardRuntime, /CloudCrowdMaintenance\.createLifecycle/);
  assert.match(dashboardRuntime, /maintenance\.startEnforcement\(\)/);
  assert.match(dashboardRuntime, /maintenance\.startToggleUpdates\(\)/);
  assert.match(maintenanceRuntime, /const MAINTENANCE_ENDPOINT = '\/\.netlify\/functions\/maintenance'/);
  assert.match(maintenanceRuntime, /const POLL_INTERVAL = 3000/);
  assert.match(maintenanceRuntime, /const REQUEST_DEADLINE = 10 \* 1000/);
  assert.match(maintenanceRuntime, /window\.location\.href = 'system-update\.html'/);
  assert.match(maintenanceRuntime, /method: 'POST'/);
  assert.match(maintenanceRuntime, /JSON\.stringify\(\{ maintenance: requestedMaintenance \}\)/);
  assert.match(maintenanceRuntime, /startToggleUpdates\(\)[\s\S]*renderToggle\(\)/);
  assert.match(maintenanceRuntime, /CloudCrowdConfirmation\.request\(message/);
});

test("Dashboard responsive and focus presentation uses approved shared contracts", () => {
  assert.match(shellCss, /@media \(max-width: 1024px\)[\s\S]*\.has-responsive-navigation \.cc-shell-sidebar/);
  assert.match(shellCss, /body\.cc-shell-nav-lock\s*\{\s*overflow: hidden/);
  assert.match(shellCss, /@media \(max-width: 620px\)[\s\S]*\.cc-shell-dashboard-grid\s*\{\s*grid-template-columns: 1fr/);
  assert.match(dashboardCss, /padding: var\(--page-padding\)/);
  assert.doesNotMatch(dashboardCss, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  assert.match(fs.readFileSync(path.join(ROOT, "assets/css/theme-base.css"), "utf8"), /:focus-visible/);
});
