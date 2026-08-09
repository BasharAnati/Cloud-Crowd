const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createCascade, element: cssElement } = require("./css-cascade.js");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const INTERNAL_PAGES = [
  "dashboard.html", "cctv.html", "ce.html", "complaints.html", "free-orders.html", "attendance.html",
  "employee-deductions.html", "agent-training.html", "restaurant-ratings.html", "weekly-quality.html",
  "employee-profiles.html", "client-profiles.html", "free-order-requests.html", "free-order-share.html",
  "anati-admin.html", "call-queue.html"
];

function functionSource(source, name) {
  let start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `function ${name}`);
  if (source.slice(Math.max(0, start - 6), start) === "async ") start -= 6;
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

class ClassList {
  constructor(owner) { this.owner = owner; this.values = new Set(); }
  add(...values) { values.filter(Boolean).forEach((value) => this.values.add(value)); this.sync(); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); this.sync(); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const next = force === undefined ? !this.contains(value) : Boolean(force);
    if (next) this.values.add(value); else this.values.delete(value);
    this.sync();
    return next;
  }
  sync() { this.owner._className = [...this.values].join(" "); }
}

class Element {
  constructor(tag = "div", documentRef = null) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = documentRef;
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.classList = new ClassList(this);
    this._className = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.isConnected = true;
    this.nodeType = 1;
  }
  set className(value) { this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); this.classList.sync(); }
  get className() { return this._className; }
  get firstChild() { return this.children[0] || null; }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === "id") this.id = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(child) {
    if (child.parentNode && child.parentNode !== this) child.parentNode.removeChild(child);
    child.parentNode = this;
    if (!this.children.includes(child)) this.children.push(child);
    return child;
  }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  insertBefore(child, before) {
    child.parentNode = this;
    const index = this.children.indexOf(before);
    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
    return child;
  }
  removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); this.isConnected = false; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  dispatch(type, extra = {}) { (this.listeners[type] || []).forEach((listener) => listener({ target: this, preventDefault() {}, ...extra })); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; this.focused = true; }
  getBoundingClientRect() { return { width: 124 }; }
  matches(selector) {
    return selector.split(",").some((part) => {
      const candidate = part.trim();
      if (candidate === "button") return this.tagName === "BUTTON";
      if (candidate.startsWith("#")) return this.id === candidate.slice(1);
      const classes = [...candidate.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
      if (classes.length) return classes.every((name) => this.classList.contains(name));
      return false;
    });
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

class DocumentHarness {
  constructor() {
    this.listeners = {};
    this.body = new Element("body", this);
    this.documentElement = new Element("html", this);
    this.activeElement = null;
    this.readyState = "loading";
  }
  createElement(tag) { return new Element(tag, this); }
  createElementNS(_namespace, tag) { return new Element(tag, this); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== listener); }
  dispatch(type, event) { (this.listeners[type] || []).forEach((listener) => listener(event)); }
  getElementById(id) {
    const visit = (node) => node.id === id ? node : node.children.map(visit).find(Boolean);
    return visit(this.body) || null;
  }
  querySelector(selector) { return selector === "main" ? this.main || null : null; }
}

function bodyClasses(page) {
  const match = read(page).match(/<body\b[^>]*class="([^"]*)"/i);
  return match ? match[1].split(/\s+/).filter(Boolean) : [];
}

function actionCascade(page, theme, classes, extraSources = []) {
  const html = cssElement("html", { attributes: { "data-theme": theme } });
  const body = cssElement("body", { classes: bodyClasses(page) }, html);
  const target = cssElement("button", { classes }, body);
  return { cascade: createCascade(ROOT, page, { extraSources }), target };
}

function assertVariantWinners(page, theme, classes, expected) {
  const { cascade, target } = actionCascade(page, theme, classes);
  for (const [property, value] of Object.entries(expected)) {
    const winner = cascade.winner(target, property);
    assert.ok(winner, `${page} ${theme} ${property} winner`);
    assert.equal(winner.value, value, `${page} ${theme} ${property}: ${winner.selector} in ${winner.sourceName}`);
    cascade.resolveValue(target, winner.value);
  }
}

function parseRootTokens(css, selector = ":root") {
  const block = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(block, `token block ${selector}`);
  return Object.fromEntries([...block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

test("shared button contract resolves exact sizes, variants, themes, and icon button", () => {
  const tokens = parseRootTokens(read("assets/css/design-tokens.css"));
  assert.equal(tokens["--button-height-sm"], "32px");
  assert.equal(tokens["--button-padding-inline-sm"], "12px");
  assert.equal(tokens["--button-height-md"], "40px");
  assert.equal(tokens["--button-padding-inline-md"], "16px");
  assert.equal(tokens["--button-height-lg"], "48px");
  assert.equal(tokens["--button-padding-inline-lg"], "20px");
  assert.equal(tokens["--button-icon-gap"], "8px");
  const css = read("assets/css/components/buttons.css");
  ["primary", "secondary", "ghost", "outline", "danger", "success"].forEach((variant) => assert.match(css, new RegExp(`\\.cc-button--${variant}\\b`)));
  assert.match(css, /\.cc-icon-button\b/);
  assert.match(css, /var\(--color-/);
  assert.match(read("assets/css/design-tokens.css"), /\[data-theme="dark"\]/);
});

test("hover, active, focus-visible, disabled, and loading states are semantic", () => {
  const css = read("assets/css/components/buttons.css");
  [":hover", ":active", ":focus-visible", ":disabled", "aria-disabled", "aria-busy", "is-loading"].forEach((state) => assert.ok(css.includes(state), state));
  assert.match(css, /:focus-visible[\s\S]*outline:\s*var\(--button-focus-outline\)/);
  assert.match(css, /:disabled[\s\S]*cursor:\s*not-allowed/);
});

test("button loading preserves width, label, and the original enabled or disabled state", () => {
  const document = new DocumentHarness();
  const context = { window: null, document, MutationObserver: class {}, setTimeout, clearTimeout };
  context.window = context;
  vm.runInNewContext(read("assets/js/components/buttons.js"), context);
  const button = new Element("button", document);
  button.className = "primary-btn";
  button.textContent = "Save";
  context.CloudCrowdButtons.setLoading(button, true, "Saving...");
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute("aria-busy"), "true");
  assert.equal(button.style.minWidth, "124px");
  assert.equal(button.textContent, "Saving...");
  context.CloudCrowdButtons.setLoading(button, false);
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute("aria-busy"), null);
  assert.equal(button.style.minWidth, "");
  assert.equal(button.textContent, "Save");

  button.disabled = true;
  context.CloudCrowdButtons.setLoading(button, true, "Saving...");
  context.CloudCrowdButtons.setLoading(button, true, "Still saving...");
  context.CloudCrowdButtons.setLoading(button, false);
  assert.equal(button.disabled, true, "repeated loading restores the original business-disabled state");

  button.disabled = false;
  context.CloudCrowdButtons.setLoading(button, true, "Saving...");
  context.CloudCrowdButtons.setLoading(button, false);
  assert.equal(button.disabled, false, "failure/cancellation cleanup restores an originally enabled control");
});

test("loading restoration mutant is detected from executable initially-disabled behavior", () => {
  const contract = (source) => {
    const document = new DocumentHarness();
    const context = { window: null, document, MutationObserver: class {}, setTimeout, clearTimeout };
    context.window = context;
    vm.runInNewContext(source, context);
    const button = new Element("button", document);
    button.disabled = true;
    button.textContent = "Unavailable";
    context.CloudCrowdButtons.setLoading(button, true, "Loading...");
    context.CloudCrowdButtons.setLoading(button, true, "Still loading...");
    context.CloudCrowdButtons.setLoading(button, false);
    assert.equal(button.disabled, true, "original disabled gate restored");
  };
  const original = read("assets/js/components/buttons.js");
  assert.doesNotThrow(() => contract(original));
  const mutated = original.replace(
    'control.disabled = control.dataset.ccLoadingDisabled === "true";',
    "control.disabled = false;"
  );
  assert.notEqual(mutated, original, "loading restore mutation applied");
  assert.throws(() => contract(mutated), /original disabled gate restored/);
});

test("operational Add focus suppression is removed from every effective page selector", () => {
  const css = read("app-shell.css");
  for (const page of ["ce", "cctv", "complaints", "free-orders"]) {
    const rule = css.match(new RegExp(`\\.${page}-ops-center \\.${page}-actions \\.add-ticket-btn:focus-visible\\s*\\{([^}]*)\\}`));
    assert.ok(rule, page);
    assert.match(rule[1], /outline:\s*var\(--button-focus-outline\)/);
    assert.doesNotMatch(rule[1], /outline:\s*none/);
  }
});

test("Lucide delivery is local and icons honor size and accessibility contracts", () => {
  const tokens = parseRootTokens(read("assets/css/design-tokens.css"));
  assert.equal(tokens["--icon-size-sm"], "16px");
  assert.equal(tokens["--icon-size-md"], "18px");
  assert.equal(tokens["--icon-size-lg"], "20px");
  const vendor = read("assets/vendor/lucide/lucide-subset.js");
  assert.match(vendor, /0\.468\.0/);
  assert.doesNotMatch(vendor, /\b(?:fetch|import)\s*\(|\.src\s*=|cdn/i);
  INTERNAL_PAGES.forEach((page) => {
    const source = read(page);
    assert.match(source, /src="assets\/vendor\/lucide\/lucide-subset\.js"/);
    assert.doesNotMatch(source, /src="https?:\/\/[^\"]*lucide/i);
    for (const match of source.matchAll(/<button\b[^>]*class="[^"]*(?:icon-btn|modal-close|drawer-close)[^"]*"[^>]*>/gi)) {
      assert.match(match[0], /aria-label="[^"]+"/i, `${page}: ${match[0]}`);
    }
  });
  const adapter = read("assets/js/components/icons.js");
  assert.match(adapter, /setAttribute\("aria-hidden", "true"\)/);
  assert.match(read("assets/css/components/icons.css"), /content:\s*none/);
});

test("feedback replacement timers are race-safe and banners remain persistent", () => {
  const document = new DocumentHarness();
  const callbacks = [];
  const context = {
    window: null, document,
    setTimeout(callback) { callbacks.push(callback); return callbacks.length; },
    clearTimeout() {}
  };
  context.window = context;
  vm.runInNewContext(read("assets/js/components/feedback.js"), context);
  const target = new Element("div", document);
  context.CloudCrowdFeedback.inline(target, "old", "info", { duration: 10 });
  context.CloudCrowdFeedback.inline(target, "new", "success");
  callbacks[0]();
  assert.equal(target.textContent, "new");
  assert.equal(target.hidden, false);
  context.CloudCrowdFeedback.banner(target, "Persistent warning", "warning");
  assert.equal(target.textContent, "Persistent warning");
  assert.equal(target.getAttribute("aria-live"), "polite");
  assert.equal(callbacks.length, 1, "persistent banner owns no dismissal timer");
});

function createShowMessageRuntime(page, source = read(page)) {
  const document = new DocumentHarness();
  const message = new Element("div", document);
  message.id = "page-message";
  message.className = "message";
  document.body.appendChild(message);
  const context = { window: null, document, setTimeout() { return 1; }, clearTimeout() {} };
  context.window = context;
  vm.runInNewContext(read("assets/js/components/feedback.js"), context);
  vm.runInNewContext(`${functionSource(source, "showMessage")}; this.showMessage = showMessage;`, context);
  return { context, message };
}

function assertLatestMessageSeverity(page, runtime, variant, text) {
  const legacy = ["success", "error", "warning", "info"].filter((name) => runtime.message.classList.contains(name));
  const shared = ["success", "error", "warning", "info"].filter((name) => runtime.message.classList.contains(`cc-feedback--${name}`));
  assert.deepEqual(legacy, [variant], `${page} legacy severity`);
  assert.deepEqual(shared, [variant], `${page} shared severity`);
  assert.equal(runtime.message.textContent, text);

  const html = cssElement("html", { attributes: { "data-theme": "light" } });
  const body = cssElement("body", { classes: bodyClasses(page) }, html);
  const target = cssElement("div", { classes: [...runtime.message.classList.values] }, body);
  const cascade = createCascade(ROOT, page);
  for (const property of ["color", "background", "border-color"]) {
    const winner = cascade.winner(target, property);
    assert.ok(winner, `${page} ${variant} ${property}`);
    assert.match(winner.selector, new RegExp(`(?:message|cc-feedback)--?\\.?${variant}|\\.${variant}`), `${page} ${variant} ${property}: ${winner.selector}`);
  }
}

test("real compatibility showMessage functions replace sequential legacy and shared severities", () => {
  const pages = ["agent-training.html", "employee-deductions.html", "restaurant-ratings.html", "employee-profiles.html", "client-profiles.html"];
  const transitions = [["success", "error"], ["error", "success"], ["warning", "error"], ["error", "warning"]];
  for (const page of pages) {
    for (const [first, second] of transitions) {
      const runtime = createShowMessageRuntime(page);
      runtime.context.showMessage(`first ${first}`, first);
      assertLatestMessageSeverity(page, runtime, first, `first ${first}`);
      runtime.context.showMessage(`latest ${second}`, second);
      assertLatestMessageSeverity(page, runtime, second, `latest ${second}`);
    }
  }
});

test("severity-transition mutants fail for stale success and warning cascade winners", () => {
  for (const stale of ["success", "warning"]) {
    const page = "agent-training.html";
    const original = read(page);
    const contract = (source) => {
      const runtime = createShowMessageRuntime(page, source);
      runtime.context.showMessage(`first ${stale}`, stale);
      runtime.context.showMessage("latest error", "error");
      assertLatestMessageSeverity(page, runtime, "error", "latest error");
    };
    assert.doesNotThrow(() => contract(original), `${stale} baseline`);
    const mutated = original.replace("element.classList.remove('success', 'error', 'warning', 'info');", "");
    assert.notEqual(mutated, original, `${stale} mutation applied`);
    assert.throws(() => contract(mutated), /legacy severity/, `${stale} stale severity is behaviorally detected`);
  }
});

function createOperationalRuntime(showSource = functionSource(read("main.js"), "showOperationalInline")) {
  const document = new DocumentHarness();
  const main = new Element("main", document);
  const drawer = new Element("div", document);
  const drawerBody = new Element("div", document);
  drawer.className = "drawer";
  drawerBody.className = "drawer-body";
  drawer.appendChild(drawerBody);
  document.body.append(main, drawer);
  document.main = main;
  const context = { window: null, document, setTimeout() { return 1; }, clearTimeout() {} };
  context.window = context;
  vm.runInNewContext(read("assets/js/components/feedback.js"), context);
  vm.runInNewContext(`${showSource}; this.showOperationalInline = showOperationalInline;`, context);
  return { context, document, main, drawerBody };
}

function assertOperationalOwnership(runtime, firstScope) {
  if (firstScope === "drawer") {
    runtime.context.showOperationalInline("Drawer error", "error", runtime.drawerBody);
    runtime.context.showOperationalInline("Page denial", "error");
  } else {
    runtime.context.showOperationalInline("Page denial", "error");
    runtime.context.showOperationalInline("Drawer error", "error", runtime.drawerBody);
  }
  const pageRegion = runtime.document.getElementById("cc-operational-feedback-page");
  const drawerRegion = runtime.document.getElementById("cc-operational-feedback-drawer");
  assert.equal(pageRegion.parentNode, runtime.main, "page feedback remains page-owned");
  assert.equal(drawerRegion.parentNode, runtime.drawerBody, "drawer feedback remains drawer-owned");
  assert.equal(pageRegion.textContent, "Page denial");
  assert.equal(drawerRegion.textContent, "Drawer error");
  assert.notEqual(pageRegion, drawerRegion);
  runtime.context.showOperationalInline("Updated page denial", "error");
  assert.equal(runtime.document.getElementById("cc-operational-feedback-page"), pageRegion, "page scope reuses one deterministic region");
  assert.equal(pageRegion.textContent, "Updated page denial");
  assert.equal(drawerRegion.textContent, "Drawer error", "page updates do not overwrite drawer feedback");
}

test("operational inline feedback preserves page and drawer ownership in both sequences", () => {
  assertOperationalOwnership(createOperationalRuntime(), "drawer");
  assertOperationalOwnership(createOperationalRuntime(), "page");
});

test("operational ownership mutants detect drawer-to-page and page-to-drawer reuse", () => {
  const original = functionSource(read("main.js"), "showOperationalInline");
  const mutated = original.replace(
    "const regionId = container ? 'cc-operational-feedback-drawer' : 'cc-operational-feedback-page';",
    "const regionId = 'cc-operational-feedback';"
  );
  assert.notEqual(mutated, original, "ownership mutation applied");
  for (const firstScope of ["drawer", "page"]) {
    assert.doesNotThrow(() => assertOperationalOwnership(createOperationalRuntime(original), firstScope));
    assert.throws(() => assertOperationalOwnership(createOperationalRuntime(mutated), firstScope), /page feedback|Cannot read|parentNode/, `${firstScope} ownership regression detected`);
  }
});

function createWeeklyDependencyRuntime(kind, loadSource = functionSource(read("weekly-quality.html"), kind === "restaurant" ? "loadActiveRestaurants" : "loadActiveEmployees")) {
  const document = new DocumentHarness();
  const warning = new Element("div", document);
  warning.id = `${kind}-load-warning`;
  const selects = kind === "restaurant"
    ? [["campaign", new Element("select", document)]]
    : [["auditor-name", new Element("select", document)], ["agent-name", new Element("select", document)]];
  selects.forEach(([id, select]) => { select.id = id; document.body.appendChild(select); });
  document.body.appendChild(warning);
  const context = {
    window: null,
    document,
    console: { warn() {} },
    sessionStorage: { getItem() { return "token"; } },
    setTimeout() { return 1; },
    clearTimeout() {},
    escapeHtml(value) { return String(value); },
    renderRecords() {},
    logout() {},
    setRestaurantSelectState(message, disabled) {
      const select = document.getElementById("campaign");
      select.disabled = disabled;
      select.innerHTML = `<option>${message}</option>`;
    },
    setEmployeeSelectState(message, disabled) {
      for (const id of ["auditor-name", "agent-name"]) {
        const select = document.getElementById(id);
        select.disabled = disabled;
        select.innerHTML = `<option>${message}</option>`;
      }
    }
  };
  context.window = context;
  vm.runInNewContext(read("assets/js/components/feedback.js"), context);
  const declarations = kind === "restaurant"
    ? "const WEEKLY_QUALITY_RESTAURANTS_ENDPOINT = 'restaurants'; let qualityRestaurants = []; let qualityRestaurantsAvailable = false;"
    : "const WEEKLY_QUALITY_EMPLOYEES_ENDPOINT = 'employees';";
  vm.runInNewContext(`${declarations}\n${loadSource}\nthis.loadDependency = ${kind === "restaurant" ? "loadActiveRestaurants" : "loadActiveEmployees"};`, context);
  return { context, warning };
}

function successfulDependencyResponse(kind) {
  const payload = kind === "restaurant"
    ? { restaurants: [{ restaurantId: "r1", brandName: "Brand", status: "active" }] }
    : { employees: [{ employeeId: "e1", fullName: "Employee", status: "active" }] };
  return { ok: true, status: 200, json: async () => payload };
}

async function assertWeeklyWarningLifecycle(kind, loadSource) {
  const runtime = createWeeklyDependencyRuntime(kind, loadSource);
  runtime.context.CloudCrowdFeedback.banner(runtime.warning, "Previous warning", "warning");
  runtime.warning.classList.add("show");
  runtime.context.fetch = async () => successfulDependencyResponse(kind);
  await runtime.context.loadDependency();
  assert.equal(runtime.warning.hidden, true, `${kind} retry removes the prior banner`);
  assert.equal(runtime.warning.textContent, "");
  assert.equal(runtime.warning.classList.contains("show"), false);

  runtime.context.fetch = async () => { throw new Error("offline"); };
  await runtime.context.loadDependency();
  assert.equal(runtime.warning.hidden, false, `${kind} later failure is visible`);
  assert.equal(runtime.warning.classList.contains("show"), true);
  assert.match(runtime.warning.textContent, /could not be loaded/);

  runtime.context.fetch = async () => successfulDependencyResponse(kind);
  await runtime.context.loadDependency();
  assert.equal(runtime.warning.hidden, true, `${kind} successful retry clears the later warning`);
}

test("Weekly Quality fully clears restaurant and employee dependency banners across retries", async () => {
  assert.match(read("assets/css/components/feedback.css"), /\.cc-feedback\[hidden\]\s*\{\s*display:\s*none/);
  await assertWeeklyWarningLifecycle("restaurant");
  await assertWeeklyWarningLifecycle("employee");
});

test("Weekly Quality cleanup mutants detect visually present empty warnings", async () => {
  for (const kind of ["restaurant", "employee"]) {
    const name = kind === "restaurant" ? "loadActiveRestaurants" : "loadActiveEmployees";
    const original = functionSource(read("weekly-quality.html"), name);
    await assert.doesNotReject(() => assertWeeklyWarningLifecycle(kind, original));
    const mutated = original.replace("window.CloudCrowdFeedback.clear(warning);", "");
    assert.notEqual(mutated, original, `${kind} cleanup mutation applied`);
    await assert.rejects(() => assertWeeklyWarningLifecycle(kind, mutated), /retry removes the prior banner/);
  }
});

test("toast regions use severity-appropriate live behavior without duplicate ownership", () => {
  const document = new DocumentHarness();
  const context = { window: null, document, setTimeout() { return 1; }, clearTimeout() {} };
  context.window = context;
  vm.runInNewContext(read("assets/js/components/feedback.js"), context);
  context.CloudCrowdFeedback.toast("Saved", "success");
  context.CloudCrowdFeedback.toast("Failed", "error");
  assert.equal(document.getElementById("cc-toast-region-polite").getAttribute("aria-live"), "polite");
  assert.equal(document.getElementById("cc-toast-region-assertive").getAttribute("aria-live"), "assertive");
  assert.equal(document.body.children.filter((child) => child.id === "cc-toast-region-polite").length, 1);
});

test("confirmation supports Escape, focus restoration, deterministic results, and one active dialog", async () => {
  const document = new DocumentHarness();
  const trigger = new Element("button", document);
  document.body.appendChild(trigger);
  trigger.focus();
  const timers = [];
  const context = { window: null, document, setTimeout(callback) { timers.push(callback); return timers.length; } };
  context.window = context;
  vm.runInNewContext(read("assets/js/components/confirmation.js"), context);

  const cancelled = context.CloudCrowdConfirmation.request("Delete record?", { intent: "danger" });
  const duplicate = await context.CloudCrowdConfirmation.request("Duplicate?");
  assert.equal(duplicate, false);
  timers.shift()();
  document.dispatch("keydown", { key: "Escape", preventDefault() {} });
  assert.equal(await cancelled, false);
  assert.equal(document.activeElement, trigger);

  let mutations = 0;
  const confirmed = context.CloudCrowdConfirmation.request("Delete record?", { intent: "danger" });
  timers.shift()();
  const backdrop = document.body.children.at(-1);
  const confirmButton = backdrop.children[0].children[2].children[1];
  confirmButton.dispatch("click");
  confirmButton.dispatch("click");
  if (await confirmed) mutations += 1;
  assert.equal(mutations, 1);
});

test("operational ticket cancellation performs no mutation and confirmation performs exactly one DELETE", async () => {
  const calls = [];
  const messages = [];
  const context = {
    window: null,
    confirmResult: false,
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ ok: true }) }; },
    getAuthHeaders(headers) { return headers; },
    readMutationResponse: async () => {},
    CURRENT_USER: "Reviewer"
  };
  context.window = context;
  context.CloudCrowdConfirmation = { request: async (message) => { messages.push(message); return context.confirmResult; } };
  const source = `
    const _currentSection = 'ce';
    const tickets = { ce: [{ _id: 7, caseNumber: '', orderNumber: 'ORD-7' }] };
    const MUTATION_CANCELLED = Symbol('cancelled');
    const SHEETS_APP_SECRET = '';
    const SHEETS_ENDPOINT = 'sheets';
    async function runMutationLifecycle(options) {
      const prepared = await options.prepare();
      if (prepared === MUTATION_CANCELLED) return;
      return options.request(prepared);
    }
    ${functionSource(read("main.js"), "deleteTicket")}
    this.deleteTicket = deleteTicket;
  `;
  vm.runInNewContext(source, context);
  await context.deleteTicket(0, null);
  assert.deepEqual(messages, ["Delete ticket ORD-7?"]);
  assert.equal(calls.length, 0);
  context.confirmResult = true;
  await context.deleteTicket(0, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "DELETE");
});

test("all internal pages load foundations and preserve responsive reachability", () => {
  const assets = ["buttons.css", "icons.css", "feedback.css", "buttons.js", "icons.js", "feedback.js", "confirmation.js"];
  INTERNAL_PAGES.forEach((page) => assets.forEach((asset) => assert.ok(read(page).includes(asset), `${page}: ${asset}`)));
  const css = read("assets/css/components/feedback.css") + read("assets/css/components/buttons.css");
  assert.match(css, /width:\s*min\(480px, 100%\)/);
  assert.match(css, /calc\(100vw -/);
  assert.match(css, /flex-wrap:\s*wrap/);
  for (const width of [1440, 1280, 1024, 768, 390, 360, 320]) {
    assert.ok(Math.min(480, width - 32) <= width, `${width}px confirmation containment`);
  }
});

test("native API policy allows only the deferred public homepage alert", () => {
  const production = fs.readdirSync(ROOT).filter((file) => /\.html$/.test(file) && !["index.html", "login.html", "system-update.html"].includes(file))
    .map((file) => read(file)).join("\n") + "\n" + fs.readdirSync(path.join(ROOT, "js")).filter((file) => file.endsWith(".js")).map((file) => read(path.join("js", file))).join("\n") + read("main.js");
  assert.doesNotMatch(production, /\b(?:window\.)?(?:alert|confirm)\s*\(/);
  assert.match(read("homepage.js"), /\balert\s*\(/);
});

test("action hierarchy corrections win the actual linked Light and Dark cascades", () => {
  const queue = read("call-queue.html");
  assert.match(queue, /class="btn cc-button cc-button--warning cc-button--md" type="button" id="save-negative-btn">Save Negative Result/);
  assert.match(queue, /getElementById\('save-negative-btn'\)\.addEventListener\('click', negativeResult\)/);
  const share = read("free-order-share.html");
  assert.match(share, /<a class="primary-btn cc-button cc-button--outline cc-button--md" href="free-order-requests\.html">Requests<\/a>/);
  assert.match(read("js/app-shell.js"), /cc-shell-logout cc-button cc-button--outline/);

  for (const theme of ["light", "dark"]) {
    assertVariantWinners("call-queue.html", theme, ["btn", "cc-button", "cc-button--warning", "cc-button--md"], {
      background: "var(--color-warning-soft)",
      color: "var(--color-warning-text)",
      "border-color": "var(--color-warning-border)"
    });
    for (const page of ["ce.html", "cctv.html", "complaints.html", "free-orders.html", "employee-profiles.html"]) {
      assertVariantWinners(page, theme, ["cc-shell-logout", "cc-button", "cc-button--outline", "cc-button--md"], {
        background: "var(--color-surface)",
        color: "var(--color-primary)",
        "border-color": "var(--color-primary)"
      });
    }
  }
});

test("action hierarchy negative fixtures fail because actual cascade winners become Danger", () => {
  const warningContract = (classes, extraSources = []) => {
    for (const theme of ["light", "dark"]) {
      const { cascade, target } = actionCascade("call-queue.html", theme, classes, extraSources);
      assert.equal(cascade.winner(target, "background").value, "var(--color-warning-soft)", `call-queue.html ${theme} warning background`);
    }
  };
  assert.doesNotThrow(() => warningContract(["btn", "cc-button", "cc-button--warning", "cc-button--md"]));
  const dangerClasses = ["btn", "danger", "cc-button", "cc-button--warning", "cc-button--md"];
  const dangerMutant = [{
    name: "call-queue-danger-mutant.css",
    css: "body .btn.danger { color: var(--color-danger-on-solid); background: var(--color-danger); border-color: var(--color-danger); }"
  }];
  assert.throws(() => warningContract(dangerClasses, dangerMutant), /warning background/, "high-specificity .danger becomes the actual Call Queue winner");

  const logoutContract = (extraSources = []) => {
    for (const theme of ["light", "dark"]) {
      for (const page of ["ce.html", "cctv.html", "complaints.html", "free-orders.html", "employee-profiles.html"]) {
        const rootClass = bodyClasses(page).find((name) => name.endsWith("ops-center"));
        const { cascade, target } = actionCascade(
          page,
          theme,
          ["cc-shell-logout", "cc-button", "cc-button--outline", "cc-button--md"],
          extraSources.map((source) => ({ ...source, css: source.css.replaceAll("ROOT_CLASS", rootClass) }))
        );
        assert.equal(cascade.winner(target, "background").value, "var(--color-surface)", `${page} ${theme} logout background`);
      }
    }
  };
  assert.doesNotThrow(() => logoutContract());
  assert.throws(() => logoutContract([{
    name: "logout-danger-mutant.css",
    css: ".ROOT_CLASS .cc-shell-logout { color: var(--color-on-primary); background: var(--color-danger); border-color: var(--color-danger); }"
  }]), /logout background/, "scoped destructive logout becomes the actual winner");
});

test("twelve retained source-policy fixtures establish baseline before detecting each mutation", () => {
  const fixtures = [
    ["focus", read("app-shell.css"), (s) => s.replace("outline: var(--button-focus-outline);", "outline: none;"), (s) => { if (/add-ticket-btn:focus-visible\s*\{[^}]*outline:\s*none/s.test(s)) throw new Error("focus"); }],
    ["size", read("assets/css/design-tokens.css"), (s) => s.replace("--button-height-md: 40px", "--button-height-md: 41px"), (s) => { if (!s.includes("--button-height-md: 40px")) throw new Error("size"); }],
    ["disabled", read("assets/css/components/buttons.css"), (s) => s.replace("cursor: not-allowed", "cursor: pointer"), (s) => { if (!s.includes("cursor: not-allowed")) throw new Error("disabled"); }],
    ["loading", read("assets/js/components/buttons.js"), (s) => s.replace("control.disabled = true;", "control.disabled = false;"), (s) => { if (!s.includes("control.disabled = true;")) throw new Error("loading"); }],
    ["accessible", read("free-order-share.html"), (s) => s.replace(' aria-label="Close form"', ""), (s) => { const tag = s.match(/<button class="icon-btn"[^>]*>/)[0]; if (!/aria-label=/.test(tag)) throw new Error("accessible"); }],
    ["cdn", read("dashboard.html"), (s) => s.replace("assets/vendor/lucide/lucide-subset.js", "https://cdn.example/lucide.js"), (s) => { if (/https?:\/\/[^\"]*lucide/i.test(s)) throw new Error("cdn"); }],
    ["persistent", read("attendance.html"), (s) => s.replace("CloudCrowdFeedback.banner(warning, message", "CloudCrowdFeedback.toast(message"), (s) => { if (s.includes("CloudCrowdFeedback.toast(message")) throw new Error("persistent"); }],
    ["confirm", read("js/auth.js"), (s) => `${s}\nconfirm('x');`, (s) => { if (/\bconfirm\s*\(/.test(s)) throw new Error("confirm"); }],
    ["alert", read("js/auth.js"), (s) => `${s}\nalert('x');`, (s) => { if (/\balert\s*\(/.test(s)) throw new Error("alert"); }],
    ["cancel", read("anati-admin.html"), (s) => s.replace("if (!user || !await window.CloudCrowdConfirmation.request", "fetch('/mutation'); if (!user || !await window.CloudCrowdConfirmation.request"), (s) => { const fn = s.slice(s.indexOf("async function disableUser"), s.indexOf("async function saveAccess")); const mutation = fn.indexOf("fetch('/mutation')"); if (mutation >= 0 && mutation < fn.indexOf("CloudCrowdConfirmation.request")) throw new Error("cancel"); }],
    ["wording", read("anati-admin.html"), (s) => s.replace("Disable ${user.username}?", "Disable this user?"), (s) => { if (!s.includes("Disable ${user.username}?")) throw new Error("wording"); }],
    ["hierarchy", read("call-queue.html"), (s) => s.replace("cc-button cc-button--warning cc-button--md", "cc-button cc-button--danger cc-button--md"), (s) => { if (/id="save-negative-btn"/.test(s) && !/cc-button--warning[^>]*id="save-negative-btn"/.test(s)) throw new Error("hierarchy"); }]
  ];
  fixtures.forEach(([name, source, mutate, validate]) => {
    assert.doesNotThrow(() => validate(source), `${name} baseline passes`);
    const mutated = mutate(source);
    assert.notEqual(mutated, source, `${name} mutation applied`);
    assert.throws(() => validate(mutated), undefined, `${name} mutation detected`);
  });
});
