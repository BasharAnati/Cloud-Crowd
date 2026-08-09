"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { contrastRatio, createCascade, effectiveColor, element: cssElement } = require("./css-cascade");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const pages = {
  requests: read("free-order-requests.html"),
  share: read("free-order-share.html")
};
const permissionsRuntime = read("js/permissions.js");
const appShellRuntime = read("js/app-shell.js");
const shellRuntime = read("js/internal-page-shell.js");
const maintenanceRuntime = read("js/maintenance.js");

class MemoryStorage {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
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
    this.className = "";
    this.disabled = false;
    this.hidden = false;
    this.classList = new FakeClassList();
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  reset() { this.value = ""; }
  focus() {}
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.body = new FakeElement("body");
    this.documentElement = new FakeElement("html");
    this.listeners = new Map();
  }
  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new FakeElement(id));
    return this.elements.get(id);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    if (selector === ".modal.open") {
      return [...this.elements.values()].filter((element) => element.id.endsWith("-modal") && element.classList.contains("open"));
    }
    return [];
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type, event) { (this.listeners.get(type) || []).forEach((listener) => listener(event)); }
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

function loadPage(kind, role = "manager") {
  const document = new FakeDocument();
  const sessionStorage = new MemoryStorage({
    cc_auth: "1", cc_token: "token", cc_role: role, cc_user: "Reviewer"
  });
  const localStorage = new MemoryStorage();
  const context = {
    console,
    document,
    sessionStorage,
    localStorage,
    MutationObserver: class { observe() {} },
    setTimeout,
    clearTimeout,
    setInterval() { return 1; },
    clearInterval() {},
    confirm() { return true; },
    fetchHandler: async () => jsonResponse({ ok: true, requests: [] }),
    fetch(...args) { return context.fetchHandler(...args); }
  };
  context.window = context;
  context.CloudCrowdConfirmation = { request: async (message) => context.confirm(message) };
  context.CloudCrowdFeedback = {
    inline(element, message) { element.textContent = message || ""; element.hidden = !message; return element; },
    clear(element) { element.textContent = ""; element.hidden = true; }
  };
  context.location = { href: "", pathname: kind === "requests" ? "/free-order-requests.html" : "/free-order-share.html" };
  context.CCPermissions = { requirePageAccess() {} };
  context.CloudCrowdMediaViewer = {
    mediaTypeFromSource(value) { return /^https?:\/\//.test(String(value)) ? "image" : ""; }
  };

  const marker = kind === "requests"
    ? "    renderBoard();\n    loadRequests();"
    : "    renderBoard();\n    loadShareItems();";
  const exposure = kind === "requests"
    ? `window.__api = { requestDisplayStage, getFilteredRequests, updateStats, renderCard,
        loadRequests, saveRequest, saveDetails, archiveRequest, detailItem, openModal, closeModal,
        setRecords(value) { requests = value; }, state() { return requests; } };`
    : `window.__api = { shareStage, getFilteredItems, updateStats, renderCard,
        loadShareItems, saveResponse, markDone, detailItem, openModal, closeModal,
        setRecords(value) { shareItems = value; }, state() { return shareItems; } };`;
  const script = pageScript(pages[kind]).replace(marker, exposure);
  assert.notEqual(script, pageScript(pages[kind]), `${kind} test exposure was installed`);
  vm.runInNewContext(script, context, { filename: `${kind}-workflow-inline.js` });
  return { api: context.__api, context, document };
}

function setValues(document, values) {
  Object.entries(values).forEach(([id, value]) => {
    document.getElementById(id).value = value;
  });
}

function count(source, pattern) { return (source.match(pattern) || []).length; }

function loadPermissions(moduleKey) {
  const document = new FakeDocument();
  const fetchCalls = [];
  const sessionStorage = new MemoryStorage({
    cc_token: "permission-token", cc_role: "operator", cc_user: "Reviewer"
  });
  const context = {
    document,
    sessionStorage,
    console: { warn() {}, error() {}, log() {} },
    MutationObserver: class { observe() {} },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return jsonResponse({
        ok: true,
        legacyFallback: false,
        hasConfiguredAccess: true,
        access: [{ moduleKey, canView: true, canCreate: false, canEdit: true, canDelete: false }]
      });
    }
  };
  context.window = context;
  context.location = { href: `${moduleKey}.html`, pathname: `/${moduleKey}.html` };
  vm.runInNewContext(permissionsRuntime, context);
  vm.runInNewContext(appShellRuntime, context);
  return { context, fetchCalls };
}

function workflowTargets(page, theme, viewportWidth = 1440, extraSources = []) {
  const cascade = createCascade(ROOT, page, { viewportWidth, extraSources });
  const isRequests = page === "free-order-requests.html";
  const html = cssElement("html", { attributes: { "data-theme": theme } });
  const body = cssElement("body", { classes: ["workflow-page", isRequests ? "free-order-requests-page" : "free-order-share-page"] }, html);
  const shell = cssElement("div", { classes: ["cc-shell-layout", "has-responsive-navigation"] }, body);
  const main = cssElement("main", { classes: ["cc-shell-main"] }, shell);
  const container = cssElement("div", { classes: ["workflow-container"] }, main);
  const pageHeader = cssElement("header", { classes: ["cc-page-header"] }, container);
  const pageHeaderContent = cssElement("div", { classes: ["cc-page-header-content"] }, pageHeader);
  const pageTitle = cssElement("h1", { classes: ["cc-page-header-title"] }, pageHeaderContent);
  const headerActions = cssElement("div", { classes: ["cc-page-header-actions"] }, pageHeader);
  const primaryAction = cssElement(isRequests ? "button" : "a", { classes: ["primary-btn"] }, headerActions);
  const stats = cssElement("section", { classes: ["stats-grid"] }, container);
  const statCard = cssElement("article", { classes: ["stat-card"] }, stats);
  const statLabel = cssElement("span", {}, statCard);
  const statValue = cssElement("strong", {}, statCard);
  const toolbar = cssElement("section", { classes: ["toolbar"] }, container);
  const control = cssElement("input", { classes: ["control"] }, toolbar);
  const board = cssElement("section", { classes: ["board"] }, container);
  const column = cssElement("section", { classes: [isRequests ? "stage-column" : "share-column"] }, board);
  const columnHead = cssElement("div", { classes: [isRequests ? "stage-head" : "column-head"] }, column);
  const columnTitle = cssElement("h3", {}, columnHead);
  const card = cssElement("article", { classes: [isRequests ? "request-card" : "share-card"] }, column);
  const cardHead = cssElement("div", { classes: ["card-head"] }, card);
  const cardTitle = cssElement("h4", {}, cardHead);
  const status = cssElement("span", { classes: [isRequests ? "stage-badge" : "status-badge"] }, cardHead);
  const warning = cssElement("div", { classes: [isRequests ? "response-badge" : "share-note"] }, card);
  const secondaryAction = cssElement("button", { classes: ["small-btn"] }, card);
  const empty = cssElement("div", { classes: ["empty-state"] }, column);
  const error = cssElement("div", { classes: ["message", "error"] }, container);
  const modal = cssElement("div", { classes: ["modal"] }, body);
  const modalPanel = cssElement("section", { classes: ["modal-panel"] }, modal);
  const modalHeader = cssElement("div", { classes: ["modal-header"] }, modalPanel);
  const modalTitle = cssElement("h3", {}, modalHeader);
  const modalControl = cssElement("button", { classes: ["icon-btn"] }, modalHeader);
  const modalBody = cssElement("div", { classes: ["modal-body"] }, modalPanel);
  const formControl = cssElement("textarea", { classes: ["control"] }, modalBody);
  return {
    cascade, body, shell, main, container, pageHeader, pageTitle, primaryAction,
    statCard, statLabel, statValue, toolbar, control, board, column, columnHead,
    columnTitle, card, cardTitle, status, warning, secondaryAction, empty, error,
    modal, modalPanel, modalHeader, modalTitle, modalControl, modalBody, formControl
  };
}

function actualContrast(targets, label, foregroundTarget, backgroundTarget = foregroundTarget) {
  const foreground = effectiveColor(targets.cascade, foregroundTarget, "color");
  const background = effectiveColor(targets.cascade, backgroundTarget, "background-color");
  const ratio = contrastRatio(foreground.color, background.color);
  assert.ok(ratio >= 4.5,
    `${label} actual contrast ${ratio.toFixed(2)}:1 from ${foreground.declaration.sourceName} / ${background.declaration.sourceName}`);
  return { foreground, background, ratio };
}

test("legacy workflow routes, fields, stages, permissions, and storage boundaries are frozen", () => {
  const requests = pages.requests;
  const share = pages.share;
  assert.match(requests, /requirePageAccess\('free_order_requests'\)/);
  assert.match(share, /requirePageAccess\('free_order_share'\)/);
  assert.match(requests, /const API_ENDPOINT = '\/\.netlify\/functions\/free-order-requests'/);
  assert.match(share, /const API_ENDPOINT = '\/\.netlify\/functions\/free-order-requests'/);

  [
    ["order-number", "120", true], ["customer-name", "200", true],
    ["phone-number", "80", false], ["creation-time", "120", true],
    ["discount-amount", null, true], ["reason-for-discount", "5000", true],
    ["decision-maker", "200", true], ["attached", "5000", false],
    ["deduction-from", "200", true], ["case-description", "5000", true],
    ["notes", "5000", false]
  ].forEach(([id, maxlength, required]) => {
    const tag = requests.match(new RegExp(`<(?:input|textarea)[^>]*id="${id}"[^>]*>`))?.[0] || "";
    assert.ok(tag, `${id} exists`);
    if (maxlength) assert.match(tag, new RegExp(`maxlength="${maxlength}"`));
    assert.equal(/\srequired(?:\s|>)/.test(tag), required, `${id} required contract`);
  });
  assert.match(requests, /min="0"[^>]*step="0\.01"/);
  ["pending_details", "ready_to_share", "needs_response", "done"].forEach((stage) => assert.match(requests, new RegExp(stage)));
  ["received", "needs_response", "done"].forEach((stage) => assert.match(share, new RegExp(stage)));
  assert.match(requests, /data-permission-create/);
  assert.match(requests, /data-permission-edit/);
  assert.match(requests, /data-permission-delete/);
  assert.match(share, /data-permission-edit/);
  assert.match(share, /free-order-requests\.html/);

  [requests, share].forEach((source) => {
    assert.match(source, /src="idle-logout\.js"/);
    assert.doesNotMatch(source, /(?:localStorage|sessionStorage)\.(?:setItem|getItem)\(['"](?:free_order|free-order|workflow)/i);
    assert.doesNotMatch(source, /(?:setInterval|setTimeout)\s*\([^)]*(?:loadRequests|loadShareItems)/s);
  });
});

test("Requests executes projection, filtering, statistics, exact writes, archive gate, and degradation", async () => {
  const loaded = loadPage("requests", "manager");
  const records = [
    { requestId: "one", orderNumber: "A-1", customerName: "Alpha", phoneNumber: "111", internalStage: "pending_details", shareStage: "" },
    { requestId: "two", orderNumber: "B-2", customerName: "Beta", phoneNumber: "222", internalStage: "ready_to_share", shareStage: "received" },
    { requestId: "three", orderNumber: "C-3", customerName: "Gamma", phoneNumber: "333", internalStage: "ready_to_share", shareStage: "needs_response" },
    { requestId: "four", orderNumber: "D-4", customerName: "Delta", phoneNumber: "444", internalStage: "done", shareStage: "done" }
  ];
  loaded.api.setRecords(records);
  assert.equal(loaded.api.requestDisplayStage(records[2]), "needs_response");
  loaded.document.getElementById("search-filter").value = "gamma";
  loaded.document.getElementById("stage-filter").value = "needs_response";
  assert.deepEqual(Array.from(loaded.api.getFilteredRequests(), (item) => item.requestId), ["three"]);
  loaded.api.updateStats();
  assert.equal(loaded.document.getElementById("stat-total").textContent, 4);
  assert.equal(loaded.document.getElementById("stat-pending").textContent, 1);
  assert.equal(loaded.document.getElementById("stat-ready").textContent, 1);
  assert.equal(loaded.document.getElementById("stat-needs-response").textContent, 1);
  assert.equal(loaded.document.getElementById("stat-done").textContent, 1);
  assert.match(loaded.api.renderCard(records[0]), /data-complete-id="one"[^>]*data-permission-edit/);
  assert.match(loaded.api.renderCard(records[0]), /data-delete-id="one"[^>]*data-permission-delete/);
  assert.match(loaded.api.detailItem("Attached", "https:\/\/example.test\/proof.png"), /cc-media-viewer-trigger/);

  const calls = [];
  loaded.context.fetchHandler = async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({ ok: true, requests: records });
  };
  setValues(loaded.document, {
    "order-number": "ORD-9", "customer-name": "Customer", "phone-number": "555",
    "creation-time": "2026-08-08 12:00", "discount-amount": "12.50", "reason-for-discount": "Reason"
  });
  await loaded.api.saveRequest({ preventDefault() {} });
  assert.equal(calls[0].url, "/.netlify/functions/free-order-requests");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    orderNumber: "ORD-9", customerName: "Customer", phoneNumber: "555",
    creationTime: "2026-08-08 12:00", discountAmount: "12.50", reasonForDiscount: "Reason"
  });
  assert.equal(Object.hasOwn(JSON.parse(calls[0].options.body), "requestId"), false);

  calls.length = 0;
  setValues(loaded.document, {
    "details-request-id": "same-request-id", "decision-maker": "Manager", attached: "proof",
    "deduction-from": "Brand", "case-description": "Case", notes: "Note"
  });
  await loaded.api.saveDetails({ preventDefault() {} });
  assert.equal(calls[0].url, "/.netlify/functions/free-order-requests?id=same-request-id&action=complete-details");
  assert.equal(calls[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    decisionMaker: "Manager", attached: "proof", deductionFrom: "Brand", caseDescription: "Case", notes: "Note"
  });

  calls.length = 0;
  loaded.api.setRecords([{ requestId: "same-request-id", orderNumber: "ORD-9" }]);
  loaded.context.confirm = () => false;
  await loaded.api.archiveRequest("same-request-id");
  assert.equal(calls.length, 0, "archive cancellation performs no mutation");
  loaded.context.confirm = () => true;
  await loaded.api.archiveRequest("same-request-id");
  assert.equal(calls[0].url, "/.netlify/functions/free-order-requests?id=same-request-id");
  assert.equal(calls[0].options.method, "DELETE");

  loaded.api.setRecords(records);
  loaded.context.fetchHandler = async () => { throw new Error("offline"); };
  await loaded.api.loadRequests();
  assert.equal(loaded.api.state().length, 4, "GET failure retains current records and adds no fallback");
  assert.match(loaded.document.getElementById("message").textContent, /offline/);
});

test("Share executes fallback, filters, statistics, exact actions, media, and degradation", async () => {
  const loaded = loadPage("share");
  assert.equal(loaded.api.shareStage({ internalStage: "ready_to_share", shareStage: "" }), "received");
  assert.equal(loaded.api.shareStage({ internalStage: "done", shareStage: "" }), "done");
  assert.equal(loaded.api.shareStage({ internalStage: "ready_to_share", shareStage: "needs_response" }), "needs_response");
  const records = [
    { requestId: "one", orderNumber: "A-1", customerName: "Alpha", phoneNumber: "111", internalStage: "ready_to_share", shareStage: "received" },
    { requestId: "two", orderNumber: "B-2", customerName: "Beta", phoneNumber: "222", internalStage: "ready_to_share", shareStage: "needs_response" },
    { requestId: "three", orderNumber: "C-3", customerName: "Gamma", phoneNumber: "333", internalStage: "done", shareStage: "done" }
  ];
  loaded.api.setRecords(records);
  loaded.document.getElementById("search-filter").value = "beta";
  loaded.document.getElementById("stage-filter").value = "needs_response";
  assert.deepEqual(Array.from(loaded.api.getFilteredItems(), (item) => item.requestId), ["two"]);
  loaded.api.updateStats();
  assert.equal(loaded.document.getElementById("stat-received").textContent, 1);
  assert.equal(loaded.document.getElementById("stat-needs-response").textContent, 1);
  assert.equal(loaded.document.getElementById("stat-done").textContent, 1);
  assert.match(loaded.api.renderCard(records[0]), /data-response-id="one"[^>]*data-permission-edit/);
  assert.match(loaded.api.renderCard(records[0]), /data-done-id="one"[^>]*data-permission-edit/);
  assert.doesNotMatch(loaded.api.renderCard(records[1]), /data-response-id=/);
  assert.match(loaded.api.renderCard(records[1]), /data-done-id="two"/);
  assert.doesNotMatch(loaded.api.renderCard(records[2]), /data-done-id=/);
  assert.match(loaded.api.detailItem("Attached", "https:\/\/example.test\/proof.png"), /cc-media-viewer-trigger/);

  const calls = [];
  loaded.context.fetchHandler = async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({ ok: true, requests: records });
  };
  await loaded.api.loadShareItems();
  assert.equal(calls[0].url, "/.netlify/functions/free-order-requests?view=share");
  assert.equal(calls[0].options.cache, "no-store");

  calls.length = 0;
  setValues(loaded.document, { "response-request-id": "same-request-id", "share-note": "Please clarify" });
  await loaded.api.saveResponse({ preventDefault() {} });
  assert.equal(calls[0].url, "/.netlify/functions/free-order-requests?id=same-request-id&action=needs-response");
  assert.equal(calls[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].options.body), { shareNote: "Please clarify" });

  calls.length = 0;
  loaded.api.setRecords([{ requestId: "same-request-id", orderNumber: "ORD-9", shareStage: "received" }]);
  loaded.context.confirm = () => false;
  await loaded.api.markDone("same-request-id");
  assert.equal(calls.length, 0, "workflow cancellation performs no mutation");
  loaded.context.confirm = () => true;
  await loaded.api.markDone("same-request-id");
  assert.equal(calls[0].url, "/.netlify/functions/free-order-requests?id=same-request-id&action=share-done");
  assert.equal(calls[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].options.body), {});

  loaded.api.setRecords(records);
  loaded.context.fetchHandler = async () => { throw new Error("offline"); };
  await loaded.api.loadShareItems();
  assert.equal(loaded.api.state().length, 3, "GET failure retains current records and adds no fallback");
  assert.match(loaded.document.getElementById("message").textContent, /offline/);
});

test("the deterministic two-page lifecycle preserves one requestId and exact state projections", async () => {
  const requestId = "11111111-2222-4333-8444-555555555555";
  const record = { requestId, internalStage: "pending_details", shareStage: "" };
  const events = [];
  function apply(url, options = {}) {
    events.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    if ((options.method || "GET") === "POST") return;
    if (url.includes("action=complete-details")) {
      assert.equal(url.includes(`id=${requestId}`), true);
      record.internalStage = "ready_to_share";
      record.shareStage = "received";
    } else if (url.includes("action=needs-response")) {
      assert.equal(url.includes(`id=${requestId}`), true);
      record.shareStage = "needs_response";
    } else if (url.includes("action=share-done")) {
      assert.equal(url.includes(`id=${requestId}`), true);
      record.internalStage = "done";
      record.shareStage = "done";
    }
  }

  apply("/.netlify/functions/free-order-requests", { method: "POST", body: JSON.stringify({ orderNumber: "ORD-1" }) });
  assert.deepEqual([record.internalStage, record.shareStage], ["pending_details", ""]);
  apply(`/.netlify/functions/free-order-requests?id=${requestId}&action=complete-details`, { method: "PUT", body: "{}" });
  assert.deepEqual([record.internalStage, record.shareStage], ["ready_to_share", "received"]);
  apply("/.netlify/functions/free-order-requests?view=share");
  apply(`/.netlify/functions/free-order-requests?id=${requestId}&action=needs-response`, { method: "PUT", body: JSON.stringify({ shareNote: "Question" }) });
  assert.deepEqual([record.internalStage, record.shareStage], ["ready_to_share", "needs_response"]);
  const requests = loadPage("requests");
  assert.equal(requests.api.requestDisplayStage(record), "needs_response");
  apply(`/.netlify/functions/free-order-requests?id=${requestId}&action=share-done`, { method: "PUT", body: "{}" });
  assert.deepEqual([record.internalStage, record.shareStage], ["done", "done"]);
  assert.equal(requests.api.requestDisplayStage(record), "done");
  assert.equal(events.filter((event) => event.url.includes("id=")).every((event) => event.url.includes(requestId)), true);
});

test("Sprint 1.3D pages consume the shared shell, theme, Page Header, and no local navigation", () => {
  const contracts = [
    ["requests", "free-order-requests", "free_order_requests"],
    ["share", "free-order-share", "free_order_share"]
  ];
  contracts.forEach(([kind, moduleId, permissionKey]) => {
    const source = pages[kind];
    assert.ok(source.indexOf('src="assets/js/theme.js"') < source.indexOf('rel="stylesheet"'), `${kind} resolves theme before CSS`);
    assert.match(source, /<html[^>]+data-theme="light"/);
    [
      "assets/css/design-tokens.css", "app-shell.css", "assets/css/theme-base.css",
      "assets/css/pages/workflow.css"
    ].forEach((asset) => assert.match(source, new RegExp(`href="${asset.replaceAll("/", "\\/")}"`)));
    assert.match(source, /src="js\/auth\.js"/);
    assert.match(source, /src="js\/maintenance\.js" defer/);
    assert.match(source, /src="js\/app-shell\.js" defer/);
    assert.match(source, /src="js\/internal-page-shell\.js" defer/);
    assert.match(source, new RegExp(`data-shell-module="${moduleId}"`));
    assert.match(source, new RegExp(`requirePageAccess\\('${permissionKey}'\\)`));
    assert.match(source, /class="cc-shell-layout has-responsive-navigation"/);
    assert.match(source, /<aside id="internal-app-sidebar" aria-label="Application navigation"><\/aside>/);
    assert.match(source, /<header id="internal-app-topbar" role="banner">/);
    assert.match(source, /id="internal-nav-backdrop" class="cc-shell-nav-backdrop"/);
    assert.match(source, /<header class="cc-page-header">/);
    assert.equal(count(source, /<h1\b/g), 1, `${kind} has one h1`);
    assert.doesNotMatch(source, /(?:for|share)-topbar|(?:for|share)-brand|(?:for|share)-logo/);
    assert.doesNotMatch(source, /onclick="window\.location\.href='dashboard\.html'"/);
    assert.doesNotMatch(source, /(?:const|let|var)\s+(?:modules|moduleRegistry|navigationRegistry|navItems)\s*=/i);
    assert.equal(count(source, /admin-users\?my-access=1/g), 0);
    assert.equal(count(source, /\.netlify\/functions\/maintenance/g), 0);
  });
  assert.match(shellRuntime, /CloudCrowdAppShell\.initializeAppShell/);
  assert.match(shellRuntime, /CloudCrowdMaintenance\.createLifecycle/);
  assert.match(maintenanceRuntime, /const POLL_INTERVAL = 3000/);
  assert.match(pages.share, /<a class="primary-btn cc-button cc-button--outline cc-button--md" href="free-order-requests\.html">Requests<\/a>/);
  assert.doesNotMatch(pages.requests, /free-order-share\.html/);
});

test("one memoized permission model drives route access and shell filtering with distinct keys", async () => {
  for (const [id, permissionKey, route] of [
    ["free-order-requests", "free_order_requests", "free-order-requests.html"],
    ["free-order-share", "free_order_share", "free-order-share.html"]
  ]) {
    const loaded = loadPermissions(permissionKey);
    const modules = [{ id, permissionKey, route, order: 1, title: id, group: "Operations", showInSidebar: true }];
    const [access, permitted] = await Promise.all([
      loaded.context.CCPermissions.requirePageAccess(permissionKey),
      loaded.context.CloudCrowdAppShell.filterPermittedModules(modules, { fallbackMode: "legacy" })
    ]);
    assert.equal(loaded.fetchCalls.length, 1);
    assert.equal(loaded.fetchCalls[0].url, "/.netlify/functions/admin-users?my-access=1");
    assert.equal(access.canView, true);
    assert.equal(access.canEdit, true);
    assert.equal(permitted.length, 1);
  }
});

test("actual workflow Light and Dark cascade winners use semantic surfaces and readable descendants", () => {
  for (const page of ["free-order-requests.html", "free-order-share.html"]) {
    for (const theme of ["light", "dark"]) {
      const targets = workflowTargets(page, theme);
      assert.equal(targets.cascade.winner(targets.body, "background-color").value, "var(--color-bg)");
      assert.equal(targets.cascade.winner(targets.pageTitle, "color").value, "var(--color-text)");
      assert.equal(targets.cascade.winner(targets.statCard, "background-color").value, "var(--color-surface)");
      assert.equal(targets.cascade.winner(targets.control, "background-color").value, "var(--input-background)");
      assert.equal(targets.cascade.winner(targets.column, "background-color").value, "var(--color-surface-muted)");
      assert.equal(targets.cascade.winner(targets.card, "background-color").value, "var(--color-surface)");
      assert.equal(targets.cascade.winner(targets.primaryAction, "background-color").value, "var(--color-primary)");
      assert.equal(targets.cascade.winner(targets.secondaryAction, "background-color").value, "var(--color-surface)");
      assert.equal(targets.cascade.winner(targets.modalPanel, "background-color").value, "var(--modal-surface)");
      assert.equal(targets.cascade.winner(targets.error, "background-color").value, "var(--color-danger-soft)");
      actualContrast(targets, `${page} ${theme} root`, targets.body);
      actualContrast(targets, `${page} ${theme} page title`, targets.pageTitle, targets.body);
      actualContrast(targets, `${page} ${theme} statistic label`, targets.statLabel, targets.statCard);
      actualContrast(targets, `${page} ${theme} statistic value`, targets.statValue, targets.statCard);
      actualContrast(targets, `${page} ${theme} filter control`, targets.control);
      actualContrast(targets, `${page} ${theme} column title`, targets.columnTitle, targets.columnHead);
      actualContrast(targets, `${page} ${theme} card title`, targets.cardTitle, targets.card);
      actualContrast(targets, `${page} ${theme} primary action`, targets.primaryAction);
      actualContrast(targets, `${page} ${theme} secondary/media action`, targets.secondaryAction);
      actualContrast(targets, `${page} ${theme} status label`, targets.status);
      actualContrast(targets, `${page} ${theme} warning presentation`, targets.warning);
      actualContrast(targets, `${page} ${theme} empty state`, targets.empty);
      actualContrast(targets, `${page} ${theme} error state`, targets.error);
      actualContrast(targets, `${page} ${theme} modal title`, targets.modalTitle, targets.modalHeader);
      actualContrast(targets, `${page} ${theme} modal control`, targets.modalControl);
      actualContrast(targets, `${page} ${theme} modal form control`, targets.formControl);
    }
  }
});

test("negative workflow fixtures detect descendant, warning, and specificity contrast regressions", () => {
  const expectFailure = (targets, label, foreground, background = foreground) => {
    assert.throws(() => actualContrast(targets, label, foreground, background), /actual contrast/);
  };
  let targets = workflowTargets("free-order-requests.html", "dark", 1440, [{
    name: "fixture-card-title.css",
    css: ".workflow-page .request-card .card-head h4 { color: var(--color-surface); }"
  }]);
  assert.equal(targets.cascade.winner(targets.cardTitle, "color").sourceName, "fixture-card-title.css");
  expectFailure(targets, "fixture request card title", targets.cardTitle, targets.card);

  targets = workflowTargets("free-order-share.html", "dark", 1440, [{
    name: "fixture-share-warning.css",
    css: ".workflow-page .share-column .share-note { color: var(--color-warning-soft); }"
  }]);
  assert.equal(targets.cascade.winner(targets.warning, "color").sourceName, "fixture-share-warning.css");
  expectFailure(targets, "fixture share warning", targets.warning);

  targets = workflowTargets("free-order-share.html", "dark", 1440, [{
    name: "fixture-higher-specificity.css",
    css: ".workflow-page.free-order-share-page .share-card .status-badge { color: var(--color-info-soft); }"
  }]);
  assert.equal(targets.cascade.winner(targets.status, "color").sourceName, "fixture-higher-specificity.css");
  expectFailure(targets, "fixture higher specificity status", targets.status);
});

test("workflow boards retain existing responsive geometry inside shrinkable shared content", () => {
  for (const [page, desktopColumns] of [
    ["free-order-requests.html", "repeat(4,minmax(0,1fr))"],
    ["free-order-share.html", "repeat(3,minmax(0,1fr))"]
  ]) {
    for (const width of [1440, 1280]) {
      const targets = workflowTargets(page, "light", width);
      assert.equal(targets.cascade.winner(targets.board, "grid-template-columns").value.replaceAll(" ", ""), desktopColumns);
    }
    for (const width of [1024, 768, 390, 360, 320]) {
      const targets = workflowTargets(page, "light", width);
      assert.equal(targets.cascade.winner(targets.board, "grid-template-columns").value, "1fr");
    }
  }
  assert.match(read("app-shell.css"), /\.cc-shell-main\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(pages.requests, /@media \(max-width: 1040px\)[\s\S]*?\.board \{ grid-template-columns: 1fr; \}/);
  assert.match(pages.share, /@media \(max-width: 680px\)[\s\S]*?\.form-grid,[\s\S]*?grid-template-columns: 1fr/);
});

test("legacy workflow modals and shared responsive navigation remain independently operable", () => {
  const loaded = loadPage("requests");
  loaded.context.matchMedia = () => ({ matches: true, addEventListener() {}, addListener() {} });
  vm.runInNewContext(appShellRuntime, loaded.context);
  const navigation = loaded.context.CloudCrowdAppShell.setupResponsiveNavigation({
    shell: new FakeElement("shell"),
    sidebar: new FakeElement("sidebar"),
    trigger: new FakeElement("trigger"),
    backdrop: new FakeElement("backdrop")
  });
  const modal = loaded.document.getElementById("request-modal");
  loaded.api.openModal("request-modal");
  assert.equal(modal.classList.contains("open"), true);
  loaded.document.dispatch("keydown", { key: "Escape" });
  assert.equal(modal.classList.contains("open"), false);

  navigation.open();
  assert.equal(loaded.document.body.classList.contains("cc-shell-nav-lock"), true);
  loaded.api.openModal("request-modal");
  loaded.api.closeModal("request-modal");
  assert.equal(loaded.document.body.classList.contains("cc-shell-nav-lock"), true, "closing modal does not release navigation lock");
  navigation.close();
  assert.equal(loaded.document.body.classList.contains("cc-shell-nav-lock"), false);
  assert.equal(modal.classList.contains("open"), false);
  assert.doesNotMatch(pages.requests + pages.share, /classList\.(?:add|remove|toggle)\('cc-shell-nav-lock'/);
  const layered = workflowTargets("free-order-requests.html", "dark");
  assert.equal(layered.cascade.winner(layered.modal, "z-index").value, "calc(var(--layer-navigation) + 1)");
});
