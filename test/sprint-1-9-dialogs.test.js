"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createCascade, element: cssElement } = require("./css-cascade.js");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function functionSource(source, name) {
  const start = source.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  assert.ok(start >= 0, `${name} exists`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

class Classes {
  constructor(owner) { this.owner = owner; this.values = new Set(); }
  add(...names) { names.filter(Boolean).forEach((name) => this.values.add(name)); this.sync(); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); this.sync(); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const next = force === undefined ? !this.contains(name) : Boolean(force);
    next ? this.values.add(name) : this.values.delete(name);
    this.sync();
    return next;
  }
  sync() { this.owner._className = Array.from(this.values).join(" "); }
  set(value) { this.values = new Set(String(value || "").split(/\s+/).filter(Boolean)); this.sync(); }
}

function selectorMatch(node, selector) {
  return selector.split(",").some((part) => {
    let source = part.trim();
    if (!source || source.includes(" ")) return false;
    if (/\[disabled\]/.test(source) && node.getAttribute("disabled") !== null) return false;
    if (/\[type=['\"]hidden['\"]\]/.test(source) && node.getAttribute("type") === "hidden") return false;
    if (/\[tabindex=['\"]-1['\"]\]/.test(source) && node.getAttribute("tabindex") === "-1") return false;
    source = source.replace(/:not\([^)]*\)/g, "");
    const tag = source.match(/^[a-z][\w-]*/i)?.[0];
    if (tag && node.tagName !== tag.toUpperCase()) return false;
    const id = source.match(/#([\w-]+)/)?.[1];
    if (id && node.id !== id) return false;
    for (const name of Array.from(source.matchAll(/\.([\w-]+)/g), (match) => match[1])) {
      if (!node.classList.contains(name)) return false;
    }
    for (const match of source.matchAll(/\[([\w-]+)(?:=['\"]?([^'\"\]]+)['\"]?)?\]/g)) {
      const value = node.getAttribute(match[1]);
      if (value === null || (match[2] !== undefined && value !== match[2])) return false;
    }
    return true;
  });
}

class FakeElement {
  constructor(tag, document) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.classList = new Classes(this);
    this.listeners = new Map();
    this.dataset = {};
    this.style = { setProperty() {} };
    this.hidden = false;
    this.disabled = false;
    this.isConnected = true;
    this._innerHTML = "";
    this.textContent = "";
  }
  set id(value) { this.setAttribute("id", value); }
  get id() { return this.getAttribute("id") || ""; }
  set className(value) { this.classList.set(value); }
  get className() { return this._className || ""; }
  set type(value) { this.setAttribute("type", value); }
  get type() { return this.getAttribute("type") || ""; }
  set tabIndex(value) { this.setAttribute("tabindex", value); }
  get tabIndex() { return Number(this.getAttribute("tabindex") ?? -1); }
  set innerHTML(value) {
    this.innerHTMLSetCount = (this.innerHTMLSetCount || 0) + 1;
    this._innerHTML = String(value);
    if (!value) { this.children = []; return; }
    if (this._innerHTML.includes('id="history-panel"')) {
      const panel = this.ownerDocument.createElement("div"); panel.id = "history-panel"; panel.className = "history-modal__panel cc-dialog__panel cc-dialog__panel--680";
      panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-labelledby", "history-modal-title"); panel.setAttribute("data-cc-overlay-panel", "");
      const title = this.ownerDocument.createElement("h3"); title.id = "history-modal-title"; title.textContent = "Change History";
      const close = this.ownerDocument.createElement("button"); close.id = "history-close"; close.type = "button"; close.setAttribute("data-cc-overlay-close", "");
      const body = this.ownerDocument.createElement("div"); body.id = "history-body";
      panel.append(title, close, body); this.appendChild(panel);
    } else if (this._innerHTML.includes("cc-media-viewer__stage")) {
      const close = this.ownerDocument.createElement("button"); close.className = "cc-media-viewer__close"; close.type = "button"; close.setAttribute("aria-label", "Close media viewer");
      const stage = this.ownerDocument.createElement("div"); stage.className = "cc-media-viewer__stage"; stage.setAttribute("data-media-viewer-backdrop", "");
      const content = this.ownerDocument.createElement("div"); content.className = "cc-media-viewer__content"; stage.appendChild(content);
      this.append(close, stage);
    }
  }
  get innerHTML() { return this._innerHTML; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "disabled") this.disabled = true;
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); if (name === "disabled") this.disabled = false; }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  appendChild(node) {
    if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((child) => child !== node);
    node.parentNode = this; node.isConnected = this.isConnected; this.children.push(node); return node;
  }
  setConnected(value) { this.isConnected = value; this.children.forEach((child) => child.setConnected(value)); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this); this.parentNode = null; this.setConnected(false); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  matches(selector) { return selectorMatch(this, selector); }
  querySelectorAll(selector) { return this.children.flatMap((child) => [child, ...child.querySelectorAll(selector)]).filter((node) => selectorMatch(node, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback); }
  dispatchEvent(event) { event.target ||= this; event.currentTarget = this; for (const callback of this.listeners.get(event.type) || []) callback(event); if (typeof this[`on${event.type}`] === "function") this[`on${event.type}`](event); }
  click() { this.dispatchEvent(fakeEvent("click", this)); }
  focus() {
    const native = ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(this.tagName)
      || (this.tagName === "A" && this.getAttribute("href") !== null);
    const explicit = this.getAttribute("tabindex") !== null;
    if (this.isConnected && !this.hidden && !this.disabled && this.getAttribute("aria-hidden") !== "true" && this.type !== "hidden" && (native || explicit)) {
      this.ownerDocument.activeElement = this;
    }
  }
  getClientRects() { return this.hidden ? [] : [1]; }
  closest(selector) { let node = this; while (node) { if (node.matches(selector)) return node; node = node.parentNode; } return null; }
}

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.body = new FakeElement("body", this);
    this.activeElement = this.body;
  }
  createElement(tag) { return new FakeElement(tag, this); }
  getElementById(id) { return this.body.id === id ? this.body : this.body.querySelector(`#${id}`); }
  querySelector(selector) { return this.body.querySelector(selector); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback); }
  dispatchEvent(event) { for (const callback of this.listeners.get(event.type) || []) { if (event.immediateStopped) break; callback(event); } }
}

function fakeEvent(type, target, extras = {}) {
  return {
    type, target, key: extras.key, shiftKey: Boolean(extras.shiftKey), defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.immediateStopped = true; }
  };
}

function harness(extra = {}, runtimeSource = read("assets/js/components/dialog.js")) {
  const document = new FakeDocument();
  const opened = [];
  const window = {
    document, innerWidth: 1440, innerHeight: 900, setTimeout: (callback) => callback(),
    addEventListener() {}, open: (...args) => opened.push(args), ...extra
  };
  window.window = window;
  const context = vm.createContext({ window, document, globalThis: window, console, Map, Set, Promise, Array, Object, String, Boolean, Math, encodeURIComponent, fetch: extra.fetch });
  vm.runInContext(runtimeSource, context, { filename: "dialog.js" });
  return { document, window, context, opened, api: window.CloudCrowdOverlay };
}

function overlay(env, id, type = "dialog", options = {}) {
  const trigger = env.document.createElement("button"); trigger.id = `${id}-trigger`; env.document.body.appendChild(trigger); trigger.focus();
  const root = env.document.createElement("div"); root.id = id;
  const panel = env.document.createElement("section"); panel.className = type === "drawer" ? "cc-drawer__panel" : "cc-dialog__panel"; panel.setAttribute("data-cc-overlay-panel", "");
  const first = env.document.createElement("button"); first.id = `${id}-first`;
  const last = env.document.createElement("button"); last.id = `${id}-last`;
  panel.append(first, last); root.appendChild(panel); env.document.body.appendChild(root);
  env.api.register(root, { type, panel, dismissOnBackdrop: true, lockScroll: true, ...options });
  return { root, panel, first, last, trigger };
}

function renderOperationsTickets(source = read("js/tickets-render.js")) {
  const env = harness();
  const ticketsRoot = env.document.createElement("div"); ticketsRoot.id = "tickets"; env.document.body.appendChild(ticketsRoot);
  const drawer = overlay(env, "rendered-card-drawer", "drawer");
  const activations = [];
  const records = [
    { _id: "ticket-one", caseNumber: "CASE-ONE", status: "Open", branch: "North", dateTime: "2026-01-01" },
    { _id: "ticket-two", caseNumber: "CASE-TWO", status: "Open", branch: "South", dateTime: "2026-01-02" }
  ];
  env.window.currentSection = "cctv";
  const context = vm.createContext({
    window: env.window,
    document: env.document,
    tickets: { cctv: records },
    STATUS_COLUMNS: { cctv: ["Open"] },
    updateCctvStatsAndFilters() {},
    getCctvFilterState: () => ({}),
    cctvTicketMatchesFilters: () => true,
    displayStatusName: String,
    getMainFieldsContent: () => "",
    escapeHtml: String,
    openTicketDrawerByCase(caseNumber, trigger) {
      activations.push({ caseNumber, trigger });
      env.api.open(drawer.root.id, { trigger });
    },
    console,
    Set,
    Math,
    Date,
    Array,
    String
  });
  const productionFunctions = [
    "bandClassForStatus", "getCaseDisplay", "ticketStatusPresentation", "ticketStatusToneClass",
    "formatTicketDate", "arrayText", "cctvCardValue", "formatCctvCardDate", "getCctvCardObservationDate",
    "getCctvCardContent", "makeTicketCardInteractive", "renderTickets"
  ].map((name) => functionSource(source, name)).join("\n");
  new vm.Script(productionFunctions);
  vm.runInContext(`${productionFunctions}\nthis.renderOperationsTickets = renderTickets;`, context, { filename: "tickets-render.integration.js" });
  context.renderOperationsTickets();
  return { env, drawer, activations, records, cards: env.document.querySelectorAll(".ticket-card") };
}

function assertRenderedCardSemantics(rendered, index, key) {
  const { env, drawer, activations, records, cards } = rendered;
  const card = cards[index];
  assert.ok(card, `renderTickets produced card ${index + 1}`);
  assert.equal(card.getAttribute("role"), "button");
  assert.equal(card.getAttribute("tabindex"), "0");
  card.focus(); assert.equal(env.document.activeElement, card);
  const before = activations.length;
  const event = key ? fakeEvent("keydown", card, { key }) : fakeEvent("click", card);
  card.dispatchEvent(event);
  assert.equal(activations.length, before + 1, `${key || "click"} activates exactly once`);
  assert.equal(activations.at(-1).caseNumber, records[index].caseNumber);
  assert.equal(activations.at(-1).trigger, card);
  if (key === " ") assert.equal(event.defaultPrevented, true);
  assert.equal(env.api.isOpen(drawer.root.id), true);
  env.api.close(drawer.root.id);
  assert.equal(env.document.activeElement, card);
  return card;
}

test("real runtime registers, opens, closes, orders, and synchronizes semantics", () => {
  const env = harness(); const one = overlay(env, "one"); const two = overlay(env, "two", "drawer");
  env.api.open("one", { trigger: one.trigger }); env.api.open("two", { trigger: two.trigger });
  assert.equal(env.api.top().id, "two"); assert.equal(env.api.isOpen("one"), true); assert.equal(two.root.getAttribute("aria-hidden"), "false");
  env.api.open("one", { trigger: two.last }); assert.equal(env.api.top().id, "one"); assert.equal(env.api.locks.size(), 2);
  assert.equal(env.api.close("one"), true); assert.equal(env.document.activeElement, two.last); assert.equal(env.api.close("one"), false);
  env.api.close("two"); assert.equal(env.api.locks.size(), 0); assert.equal(env.document.body.classList.contains("cc-modal-lock"), false);
});

test("live topmost focus trap handles Tab, Shift+Tab, and dynamic controls", () => {
  const env = harness(); const parent = overlay(env, "parent"); const child = overlay(env, "child");
  env.api.open("parent"); env.api.open("child"); child.last.focus();
  let event = fakeEvent("keydown", child.last, { key: "Tab" }); env.document.dispatchEvent(event); assert.equal(env.document.activeElement, child.first); assert.equal(event.defaultPrevented, true);
  const dynamic = env.document.createElement("button"); dynamic.id = "dynamic"; child.panel.appendChild(dynamic); child.first.focus();
  event = fakeEvent("keydown", child.first, { key: "Tab", shiftKey: true }); env.document.dispatchEvent(event); assert.equal(env.document.activeElement, dynamic);
  assert.notEqual(env.document.activeElement, parent.first);
});

test("Escape and backdrop affect only the topmost eligible overlay", () => {
  const env = harness(); const parent = overlay(env, "parent"); const child = overlay(env, "child"); let legacy = 0;
  env.document.addEventListener("keydown", () => { legacy += 1; }); env.api.open("parent"); env.api.open("child");
  env.document.dispatchEvent(fakeEvent("keydown", child.root, { key: "Escape" }));
  assert.equal(env.api.isOpen("child"), false); assert.equal(env.api.isOpen("parent"), true); assert.equal(legacy, 0);
  const panelClick = fakeEvent("click", parent.panel); env.document.dispatchEvent(panelClick); assert.equal(env.api.isOpen("parent"), true);
  env.document.dispatchEvent(fakeEvent("click", parent.root)); assert.equal(env.api.isOpen("parent"), false);
});

test("non-dismissible backdrops, navigation locks, and disconnected triggers are safe", () => {
  const env = harness(); const item = overlay(env, "fixed", "dialog", { dismissOnBackdrop: false }); let legacyClose = 0;
  env.document.addEventListener("click", () => { legacyClose += 1; });
  env.document.body.classList.add("cc-shell-nav-lock"); env.api.open("fixed"); env.document.dispatchEvent(fakeEvent("click", item.root)); assert.equal(env.api.isOpen("fixed"), true); assert.equal(legacyClose, 0);
  item.trigger.remove(); assert.doesNotThrow(() => env.api.close("fixed")); assert.equal(env.document.body.classList.contains("cc-shell-nav-lock"), true);
});

test("out-of-order ancestor closure preserves topmost focus and restoration ancestry", () => {
  const env = harness();
  const pageTrigger = env.document.createElement("button"); pageTrigger.id = "page-trigger"; env.document.body.appendChild(pageTrigger); pageTrigger.focus();
  const parent = overlay(env, "parent"); env.api.open("parent", { trigger: pageTrigger });
  parent.last.focus();
  const child = overlay(env, "child"); env.api.open("child", { trigger: parent.last }); child.first.focus();

  env.api.close("parent", { reason: "programmatic" });
  assert.equal(env.api.top().id, "child");
  assert.equal(env.api.isOpen("child"), true);
  assert.equal(env.document.activeElement, child.first, "non-top close does not steal focus");
  env.api.close("child");
  assert.equal(env.document.activeElement, pageTrigger, "closed ancestor is skipped for restoration");
  assert.equal(env.api.top(), null);
  assert.equal(env.api.locks.size(), 0);

  pageTrigger.focus();
  const a = overlay(env, "a"); env.api.open("a", { trigger: pageTrigger }); a.last.focus();
  const b = overlay(env, "b"); env.api.open("b", { trigger: a.last }); b.last.focus();
  const c = overlay(env, "c"); env.api.open("c", { trigger: b.last }); c.first.focus();
  env.api.close("b");
  assert.equal(env.document.activeElement, c.first);
  env.api.close("c");
  assert.equal(env.document.activeElement, a.last);
  env.api.close("a");
  assert.equal(env.document.activeElement, pageTrigger);
});

test("realistic focus harness rejects plain divs, href-less anchors, hidden, and disabled controls", () => {
  const env = harness();
  const stable = env.document.createElement("button"); env.document.body.appendChild(stable); stable.focus();
  for (const candidate of [env.document.createElement("div"), env.document.createElement("a")]) {
    env.document.body.appendChild(candidate); candidate.focus(); assert.equal(env.document.activeElement, stable);
  }
  const hidden = env.document.createElement("button"); hidden.hidden = true; env.document.body.appendChild(hidden); hidden.focus(); assert.equal(env.document.activeElement, stable);
  const disabled = env.document.createElement("button"); disabled.setAttribute("disabled", ""); env.document.body.appendChild(disabled); disabled.focus(); assert.equal(env.document.activeElement, stable);
  const programmatic = env.document.createElement("div"); programmatic.tabIndex = -1; env.document.body.appendChild(programmatic); programmatic.focus(); assert.equal(env.document.activeElement, programmatic);
});

test("actual renderTickets cards preserve click, keyboard, nested-action, and restoration identity", () => {
  const rendered = renderOperationsTickets();
  assert.equal(rendered.cards.length, 2);
  const second = assertRenderedCardSemantics(rendered, 1, null);
  assertRenderedCardSemantics(rendered, 1, "Enter");
  assertRenderedCardSemantics(rendered, 1, " ");

  const nested = rendered.env.document.createElement("button"); let nestedActivations = 0;
  nested.addEventListener("click", () => { nestedActivations += 1; }); second.appendChild(nested);
  const nestedEvent = fakeEvent("click", nested); nested.dispatchEvent(nestedEvent); second.dispatchEvent(nestedEvent);
  assert.equal(nestedActivations, 1); assert.equal(rendered.activations.length, 3, "nested action does not activate its card");

  const first = assertRenderedCardSemantics(rendered, 0, "Enter");
  assert.notEqual(first, second); assert.equal(rendered.activations.at(-1).trigger, first);
});

test("renderer integration mutant keeps click rendering but loses the real card contract", () => {
  const baseline = read("js/tickets-render.js");
  const integration = "makeTicketCardInteractive(card, () => openTicketDrawerByCase(getCaseDisplay(ticket), card));";
  const clickOnly = "card.addEventListener('click', () => openTicketDrawerByCase(getCaseDisplay(ticket), card));";
  const mutant = baseline.replace(integration, clickOnly);
  assert.notEqual(mutant, baseline, "renderer/helper integration mutation applied");
  assert.equal(functionSource(mutant, "makeTicketCardInteractive"), functionSource(baseline, "makeTicketCardInteractive"), "helper remains intact");
  assert.doesNotThrow(() => new vm.Script(mutant), "actual mutated artifact compiles");

  const rendered = renderOperationsTickets(mutant);
  assert.equal(rendered.cards.length, 2, "mutant still renders ticket cards");
  const card = rendered.cards[0]; card.dispatchEvent(fakeEvent("click", card));
  assert.equal(rendered.activations.length, 1, "mutant retains click-only behavior");
  assert.equal(rendered.activations[0].trigger, card);
  rendered.env.api.close(rendered.drawer.root.id);
  assert.throws(() => assertRenderedCardSemantics(renderOperationsTickets(mutant), 0, "Enter"), assert.AssertionError, "missing renderer integration is detected");
});

test("actual Operations History control is a button and is captured by real History open", async () => {
  const calls = [];
  const env = harness({ fetch: async (url) => { calls.push(url); return { ok: true, json: async () => ({ ok: true, history: [] }) }; } });
  Object.assign(env.context, { fetch: env.window.fetch, getAuthHeaders: () => ({}), handleAuthFailure: () => false, escapeHtml: String, formatDT: String });
  vm.runInContext(read("js/history.js"), env.context, { filename: "history.js" });
  const drawer = overlay(env, "drawer", "drawer"); env.api.open("drawer");
  const mainContext = vm.createContext({ document: env.document, viewTicketHistory: env.window.viewTicketHistory, showOperationalInline() {} });
  vm.runInContext(`${functionSource(read("main.js"), "createDrawerHistoryTrigger")}\nthis.createDrawerHistoryTrigger = createDrawerHistoryTrigger;`, mainContext);
  const historyTrigger = mainContext.createDrawerHistoryTrigger({ _id: "ticket-77" });
  drawer.panel.appendChild(historyTrigger); historyTrigger.focus(); historyTrigger.click();
  await Promise.resolve();
  assert.equal(calls[0], "/.netlify/functions/tickets?history=1&id=ticket-77");
  assert.equal(historyTrigger.tagName, "BUTTON"); assert.equal(historyTrigger.type, "button");
  assert.equal(env.api.top().id, "history-modal");
  env.document.dispatchEvent(fakeEvent("keydown", env.document.body, { key: "Escape" }));
  assert.equal(env.api.isOpen("drawer"), true); assert.equal(env.document.activeElement, historyTrigger);
  assert.match(functionSource(read("main.js"), "createDrawerHistoryTrigger"), /type\s*=\s*['"]button['"]/);
  assert.match(functionSource(read("main.js"), "createDrawerHistoryTrigger"), /viewTicketHistory\(ticket\._id,\s*historyButton\)/);
});

test("invalid restoration targets fall through to a safe active-parent target", () => {
  const env = harness(); const parent = overlay(env, "fallback-parent"); const child = overlay(env, "fallback-child");
  env.api.open("fallback-parent"); parent.first.focus();
  const plainDiv = env.document.createElement("div"); parent.panel.appendChild(plainDiv);
  env.api.open("fallback-child", { trigger: plainDiv }); child.first.focus();
  env.api.close("fallback-child");
  assert.equal(env.document.activeElement, parent.first);
  assert.equal(parent.root.contains(env.document.activeElement), true);
});

test("real confirmation preserves API, wording, initial Cancel, results, and parent", async () => {
  const env = harness(); vm.runInContext(read("assets/js/components/confirmation.js"), env.context, { filename: "confirmation.js" });
  const parent = overlay(env, "drawer", "drawer"); env.api.open("drawer"); parent.last.focus();
  const cancelled = env.window.CloudCrowdConfirmation.request("Delete exact record?", { title: "Confirm delete" });
  const dialog = env.document.querySelector(".cc-confirmation"); const buttons = dialog.querySelectorAll("button");
  assert.equal(dialog.querySelector(".cc-confirmation__message").textContent, "Delete exact record?"); assert.equal(env.document.activeElement, buttons[0]);
  buttons[0].click(); assert.equal(await cancelled, false); assert.equal(env.api.isOpen("drawer"), true); assert.equal(env.document.activeElement, parent.last);
  const confirmed = env.window.CloudCrowdConfirmation.request("Proceed?"); env.document.querySelector(".cc-confirmation").querySelectorAll("button")[1].click(); assert.equal(await confirmed, true);
  env.api.close("drawer"); assert.equal(env.api.locks.size(), 0);
});

test("real history uses exact ticket identity, renders states, and nests above drawer", async () => {
  const calls = [];
  const env = harness({ fetch: async (url) => { calls.push(url); return { ok: true, json: async () => ({ ok: true, history: [] }) }; } });
  Object.assign(env.context, { fetch: env.window.fetch, getAuthHeaders: () => ({ Authorization: "test" }), handleAuthFailure: () => false, escapeHtml: String, formatDT: String });
  vm.runInContext(read("js/history.js"), env.context, { filename: "history.js" });
  const drawer = overlay(env, "drawer", "drawer"); env.api.open("drawer"); drawer.last.focus();
  await env.window.viewTicketHistory("ticket/42");
  assert.equal(calls[0], "/.netlify/functions/tickets?history=1&id=ticket%2F42"); assert.match(env.document.getElementById("history-body").innerHTML, /No changes logged yet/);
  env.document.dispatchEvent(fakeEvent("keydown", env.document.body, { key: "Escape" })); assert.equal(env.api.isOpen("history-modal"), false); assert.equal(env.api.isOpen("drawer"), true);
});

test("real media viewer handles images, video, fallback, close, and parent nesting", () => {
  const env = harness(); vm.runInContext(read("js/media-viewer.js"), env.context, { filename: "media-viewer.js" });
  const parent = overlay(env, "parent"); env.api.open("parent"); parent.last.focus();
  env.window.CloudCrowdMediaViewer.open({ src: "/a.jpg", alt: "A" });
  let media = env.document.querySelector(".cc-media-viewer__media"); assert.equal(media.tagName, "IMG"); assert.equal(media.alt, "A"); assert.equal(env.api.isOpen("parent"), true);
  const content = env.document.querySelector(".cc-media-viewer__content"); const cleanupCount = content.innerHTMLSetCount;
  env.window.CloudCrowdMediaViewer.close(); assert.equal(env.api.isOpen("parent"), true); assert.equal(env.document.activeElement, parent.last);
  assert.equal(content.children.length, 0); assert.equal(content.innerHTMLSetCount - cleanupCount, 1);
  env.window.CloudCrowdMediaViewer.open({ src: "/a.mp4" }); media = env.document.querySelector(".cc-media-viewer__media"); assert.equal(media.tagName, "VIDEO"); assert.equal(media.controls, true);
  env.window.CloudCrowdMediaViewer.close(); env.window.CloudCrowdMediaViewer.open({ src: "/file.bin" }); assert.deepEqual(env.opened[0], ["/file.bin", "_blank", "noopener,noreferrer"]);
});

test("real media Escape and backdrop paths remove mounted video exactly once", () => {
  const env = harness(); vm.runInContext(read("js/media-viewer.js"), env.context, { filename: "media-viewer.js" });
  const parent = overlay(env, "media-parent"); env.api.open("media-parent"); parent.last.focus();
  env.window.CloudCrowdMediaViewer.open({ src: "/movie.mp4" });
  const viewer = env.document.getElementById("cc-media-viewer"); const content = viewer.querySelector(".cc-media-viewer__content"); const stage = viewer.querySelector(".cc-media-viewer__stage");
  assert.equal(content.children.length, 1);
  let cleanupCount = content.innerHTMLSetCount;
  env.document.dispatchEvent(fakeEvent("keydown", viewer, { key: "Escape" }));
  assert.equal(env.api.isOpen("cc-media-viewer"), false); assert.equal(content.children.length, 0); assert.equal(env.api.isOpen("media-parent"), true); assert.equal(env.api.locks.size(), 1);
  assert.equal(content.innerHTMLSetCount - cleanupCount, 1);

  env.window.CloudCrowdMediaViewer.open({ src: "/movie.mp4" }); assert.equal(content.children.length, 1);
  cleanupCount = content.innerHTMLSetCount;
  env.document.dispatchEvent(fakeEvent("click", stage));
  assert.equal(env.api.isOpen("cc-media-viewer"), false); assert.equal(content.children.length, 0); assert.equal(env.api.isOpen("media-parent"), true); assert.equal(env.api.locks.size(), 1);
  assert.equal(content.innerHTMLSetCount - cleanupCount, 1);

  env.window.CloudCrowdMediaViewer.open({ src: "/movie.mp4" }); cleanupCount = content.innerHTMLSetCount;
  env.api.close("cc-media-viewer", { reason: "programmatic" });
  assert.equal(content.children.length, 0); assert.equal(content.innerHTMLSetCount - cleanupCount, 1); assert.equal(env.api.locks.size(), 1);
});

test("page adapters use the common lifecycle while retaining page business ownership", () => {
  const main = read("main.js");
  assert.match(main, /CloudCrowdOverlay\.register\(modal/); assert.match(main, /CloudCrowdOverlay\.open\(modal\.id/); assert.match(main, /function resetOperationalModal/);
  assert.match(main, /CloudCrowdOverlay\.register\(drawer/); assert.match(main, /openTicketDrawerByCase\(caseNumber, trigger\)/);
  for (const page of ["employee-deductions.html", "restaurant-ratings.html", "weekly-quality.html", "client-profiles.html", "free-order-requests.html"]) {
    const source = read(page); assert.match(source, /assets\/js\/components\/dialog\.js/); assert.match(source, /CloudCrowdOverlay\.(?:open|close)/);
  }
  assert.match(read("anati-admin.html"), /CloudCrowdConfirmation\.request/);
});

test("responsive geometry and actual cascade keep panels reachable at seven viewports", () => {
  const widths = [1440, 1280, 1024, 768, 390, 360, 320];
  const families = [
    ["Operations Add", "cctv.html", "ticket-modal", ["modal-content", "cc-dialog__panel", "cc-dialog__panel--600"], 600],
    ["History", "cctv.html", "history-modal", ["history-modal__panel", "cc-dialog__panel", "cc-dialog__panel--680"], 680],
    ["Workflow", "free-order-requests.html", "request-modal", ["modal-panel", "cc-dialog__panel"], 760],
    ["Ratings", "restaurant-ratings.html", "rating-modal", ["modal-panel", "cc-dialog__panel"], 820],
    ["Weekly", "weekly-quality.html", "details-modal", ["modal-panel", "cc-dialog__panel"], 820],
    ["Employee", "employee-profiles.html", "employee-modal", ["modal-panel", "cc-dialog__panel"], 920],
    ["Deductions", "employee-deductions.html", "deduction-modal", ["modal-panel", "cc-dialog__panel"], 940],
    ["Client", "client-profiles.html", "client-modal", ["modal-panel", "cc-dialog__panel"], 940]
  ];
  for (const viewportWidth of widths) {
    for (const [name, page, id, classes, expected] of families) {
      const cascade = createCascade(ROOT, page, { viewportWidth });
      const html = cssElement("html"); const body = cssElement("body", {}, html);
      const root = cssElement("div", { id, classes: [id === "history-modal" ? "history-modal" : "modal", "cc-dialog", "open"] }, body);
      const panel = cssElement("div", { classes }, root);
      const modalBody = cssElement("div", { classes: ["modal-body", "cc-dialog__body"] }, panel);
      const widthWinner = cascade.winner(panel, "width");
      assert.ok(widthWinner, `${name} has a production width winner at ${viewportWidth}px`);
      assert.match(widthWinner.value, new RegExp(`min\\(${expected}px,\\s*100%\\)`), `${name} width comes from its real cascade`);
      assert.equal(cascade.winner(modalBody, "overflow-y").value, "auto", `${name} body remains reachable`);
    }
    const drawerCascade = createCascade(ROOT, "cctv.html", { viewportWidth });
    const html = cssElement("html"); const body = cssElement("body", {}, html);
    const drawer = cssElement("div", { id: "ticket-drawer", classes: ["drawer", "cc-drawer", "open"] }, body);
    const drawerPanel = cssElement("aside", { classes: ["drawer-panel", "cc-drawer__panel"] }, drawer);
    const drawerBody = cssElement("div", { classes: ["drawer-body", "cc-drawer__body"] }, drawerPanel);
    assert.match(drawerCascade.winner(drawerPanel, "width").value, /min\(var\(--drawer-width-operations\),\s*100%\)/);
    assert.equal(drawerCascade.winner(drawerBody, "overflow-y").value, "auto");
  }
});

test("light/dark cascade, title role, layers, and close controls use shared foundations", () => {
  const css = read("assets/css/components/dialogs.css") + read("assets/css/components/drawers.css");
  assert.match(css, /\.cc-dialog__title[\s\S]*font-size:\s*var\(--font-size-modal-title\)[\s\S]*font-weight:\s*var\(--font-weight-semibold\)[\s\S]*line-height:\s*var\(--line-height-modal-title\)/);
  assert.doesNotMatch(css, /!important|font-weight:\s*(?:8|9)00/); assert.match(css, /var\(--layer-modal-backdrop\)/); assert.match(css, /var\(--layer-drawer-backdrop\)/);
  for (const theme of ["light", "dark"]) {
    const cascade = createCascade(ROOT, "employee-deductions.html");
    const html = cssElement("html", { attributes: { "data-theme": theme } }); const body = cssElement("body", {}, html); const root = cssElement("div", { classes: ["modal", "cc-dialog"] }, body); const panel = cssElement("div", { classes: ["modal-panel", "cc-dialog__panel"] }, root); const title = cssElement("h2", { classes: ["cc-modal-title", "cc-dialog__title"] }, panel);
    assert.equal(cascade.resolveValue(title, cascade.winner(title, "font-size").value), "18px"); assert.equal(cascade.resolveValue(title, cascade.winner(title, "font-weight").value), "600");
  }
  for (const page of ["cctv.html", "ce.html", "complaints.html", "free-orders.html"]) assert.match(read(page), /<button[^>]+type="button"[^>]+aria-label="Close"/);
});

test("runtime contains no business, reset, fetch, navigation, or later-sprint ownership", () => {
  const source = read("assets/js/components/dialog.js");
  assert.doesNotMatch(source, /fetch\(|\.reset\(|ticketId|requestId|payload|validation|cc-shell-nav-lock|kanban|profile workspace/i);
  assert.match(read("assets/css/components/dialogs.css"), /\.modal-body[^}]*overflow-y:\s*auto/s); assert.match(read("assets/css/components/tables.css"), /overflow-x:\s*auto/);
});

function compileActualArtifact(source, baseline, jsSources) {
  if (jsSources.has(baseline)) {
    new vm.Script(source);
    return;
  }
  if (/<(?:!doctype|html|script)\b/i.test(source)) {
    for (const match of source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (!/type=["']application\/json["']/i.test(match[0])) new vm.Script(match[1]);
    }
    return;
  }
  createCascade(ROOT, "client-profiles.html", { extraSources: [{ href: "in-memory-mutant.css", css: source }] });
}

test("twenty-five isolated executable mutations fail their intended dialog contracts", () => {
  const runtime = read("assets/js/components/dialog.js"); const dialogs = read("assets/css/components/dialogs.css"); const drawers = read("assets/css/components/drawers.css");
  const main = read("main.js"); const history = read("js/history.js"); const media = read("js/media-viewer.js"); const client = read("client-profiles.html"); const confirmation = read("assets/js/components/confirmation.js");
  const contracts = [
    ["history topmost", runtime, s => s.replaceAll("const entry = top();", "const entry = stack[0];"), s => assert.match(s, /const entry = top\(\);/)],
    ["parent lock retained", runtime, s => s.replace("lockOwners.delete(ownerId)", "lockOwners.clear()"), s => assert.match(s, /lockOwners\.delete\(ownerId\)/)],
    ["nav lock independent", runtime, s => s.replace('classList.toggle("cc-modal-lock"', 'className = "cc-modal-lock"; document.body.classList.toggle("cc-modal-lock"'), s => assert.doesNotMatch(s, /className = "cc-modal-lock"/)],
    ["panel not backdrop", runtime, s => s.replace("if (target === entry.element) return true;", "if (entry.element.contains(target)) return true;"), s => assert.match(s, /target === entry\.element/)],
    ["right trigger", runtime, s => s.replace("entry.trigger = settings.trigger || document.activeElement || entry.trigger", "entry.trigger = entry.trigger || settings.trigger"), s => assert.match(s, /entry\.trigger = settings\.trigger \|\| document\.activeElement/)],
    ["fresh trigger", runtime, s => s.replace("document.activeElement || entry.trigger", "entry.trigger || document.activeElement"), s => assert.match(s, /document\.activeElement \|\| entry\.trigger/)],
    ["child parent focus", runtime, s => s.replace("if (wasTopmost && settings.restoreFocus !== false)", "if (settings.restoreFocus !== false)"), s => assert.match(s, /if \(wasTopmost && settings\.restoreFocus !== false\)/)],
    ["accessible title", history, s => s.replace('aria-labelledby="history-modal-title"', ""), s => assert.match(s, /aria-labelledby="history-modal-title"/)],
    ["close name", media, s => s.replace('aria-label="Close media viewer"', ""), s => assert.match(s, /aria-label="Close media viewer"/)],
    ["client viewport", dialogs, s => s.replace(".cc-dialog__panel--1120 { width: min(1120px, 100%); }", ".cc-dialog__panel--1120 { width: 1120px; }") , s => assert.match(s, /panel--1120 \{ width: min\(1120px, 100%\)/)],
    ["table containment", client, s => s.replace("profile-table-wrap cc-table-wrap", "profile-table-wrap"), s => assert.equal((s.match(/profile-table-wrap cc-table-wrap/g) || []).length, 3)],
    ["drawer action reachable", drawers, s => s.replace("overflow-y: auto", "overflow-y: hidden"), s => assert.match(s, /overflow-y:\s*auto/)],
    ["form footer reachable", dialogs, s => s.replace(".cc-dialog__footer {\n  border-top: 1px solid var(--color-border);\n}", ".cc-dialog__footer { display: none; }"), s => assert.match(s, /\.cc-dialog__footer \{\s*border-top:/)],
    ["validation stays open", main, s => s.replace("if (!requireMutationPermission('create')) return;", "if (!requireMutationPermission('create')) closeModal();"), s => assert.match(s, /if \(!requireMutationPermission\('create'\)\) return;/)],
    ["preserve reset", runtime, s => s.replace("entry.element.classList.remove", "entry.element.querySelector('form')?.reset(); entry.element.classList.remove"), s => assert.doesNotMatch(s, /querySelector\('form'\).*reset/)],
    ["cancel retains parent", confirmation, s => s.replace("global.CloudCrowdOverlay.close(id", "global.CloudCrowdOverlay.close(global.CloudCrowdOverlay.top().id); global.CloudCrowdOverlay.close(id"), s => assert.doesNotMatch(s, /top\(\)\.id/)],
    ["media retains parent", media, s => s.replace("window.CloudCrowdOverlay.close(viewer.id", "window.CloudCrowdOverlay.close('parent'"), s => assert.match(s, /close\(viewer\.id/)],
    ["history identity", history, s => s.replaceAll("encodeURIComponent(ticketId)", "encodeURIComponent('wrong')"), s => assert.match(s, /encodeURIComponent\(ticketId\)/)],
    ["admin fresh user", read("anati-admin.html"), s => s.replace('document.getElementById("user-id").value = user.userId;', 'document.getElementById("user-id").value ||= user.userId;'), s => assert.match(s, /getElementById\("user-id"\)\.value = user\.userId/)],
    ["final unlock", runtime, s => s.replace("lockOwners.delete(ownerId);", "return;"), s => assert.match(s, /lockOwners\.delete\(ownerId\)/)],
    ["second owner retained", runtime, s => s.replace("lockOwners.delete(ownerId);", "lockOwners.clear();"), s => assert.match(s, /lockOwners\.delete\(ownerId\)/)],
    ["layer order", drawers, s => s.replace("z-index: 1;", "z-index: -1;"), s => assert.match(s, /z-index:\s*1;/)],
    ["feedback visible", read("assets/css/components/feedback.css"), s => s.replace("var(--layer-modal-backdrop)", "1"), s => assert.match(s, /var\(--layer-modal-backdrop\)/)],
    ["dark panel token", dialogs, s => s.replace("background: var(--modal-surface)", "background: white"), s => assert.match(s, /background:\s*var\(--modal-surface\)/)],
    ["title scale", dialogs, s => s.replace("font-size: var(--font-size-modal-title)", "font-size: 24px"), s => assert.match(s, /font-size:\s*var\(--font-size-modal-title\)/)]
  ];
  assert.equal(contracts.length, 25);
  const jsSources = new Set([runtime, main, history, media, confirmation]);
  for (const [name, baseline, mutate, validate] of contracts) {
    assert.doesNotThrow(() => validate(baseline), `${name} baseline`);
    const changed = mutate(baseline);
    assert.notEqual(changed, baseline, `${name} mutation applied`);
    assert.doesNotThrow(() => compileActualArtifact(changed, baseline, jsSources), `${name} actual mutant remains valid`);
    assert.throws(() => validate(changed), assert.AssertionError, `${name} detected`);
  }
});

test("six remediation behavior mutants execute valid artifacts and fail the intended assertions", () => {
  const runtime = read("assets/js/components/dialog.js");
  const media = read("js/media-viewer.js");
  const main = read("main.js");
  const tickets = read("js/tickets-render.js");

  function outOfOrderContract(source) {
    const env = harness({}, source); const page = env.document.createElement("button"); env.document.body.appendChild(page); page.focus();
    const a = overlay(env, "mutant-a"); env.api.open("mutant-a", { trigger: page }); a.last.focus();
    const b = overlay(env, "mutant-b"); env.api.open("mutant-b", { trigger: a.last }); b.first.focus();
    env.api.close("mutant-a"); assert.equal(env.document.activeElement, b.first);
    env.api.close("mutant-b"); assert.equal(env.document.activeElement, page);
  }
  assert.doesNotThrow(() => outOfOrderContract(runtime), "M1 clean contract");
  const m1 = runtime.replace("const wasTopmost = index === stack.length - 1;", "const wasTopmost = true;");
  assert.notEqual(m1, runtime, "M1 applied"); new vm.Script(m1);
  assert.throws(() => outOfOrderContract(m1), assert.AssertionError, "M1 unconditional restoration detected");

  const closedTargetGuard = `    for (const candidate of registry.values()) {\n      if (!isOpen(candidate.id) && candidate.element !== element && candidate.element.contains?.(element)) return false;\n    }\n`;
  const m2 = runtime.replace(closedTargetGuard, "").replace("    transferRestorationAncestry(entry, index);\n", "");
  assert.notEqual(m2, runtime, "M2 applied"); new vm.Script(m2);
  assert.throws(() => outOfOrderContract(m2), assert.AssertionError, "M2 isConnected-only restoration detected");

  function mediaContract(source) {
    const env = harness(); vm.runInContext(source, env.context, { filename: "media-mutant.js" });
    const parent = overlay(env, "mutant-media-parent"); env.api.open(parent.root.id); parent.last.focus();
    env.window.CloudCrowdMediaViewer.open({ src: "/mutant.mp4" });
    const viewer = env.document.getElementById("cc-media-viewer"); const content = viewer.querySelector(".cc-media-viewer__content");
    env.document.dispatchEvent(fakeEvent("keydown", viewer, { key: "Escape" }));
    assert.equal(content.children.length, 0);
  }
  assert.doesNotThrow(() => mediaContract(media), "M3 clean contract");
  const m3 = media.replace("      lockScroll: true,\n      onAfterClose: cleanupMedia", "      lockScroll: true");
  assert.notEqual(m3, media, "M3 applied"); new vm.Script(m3);
  assert.throws(() => mediaContract(m3), assert.AssertionError, "M3 missing lifecycle cleanup detected");

  function historyTriggerContract(source) {
    const env = harness({ fetch: async () => ({ ok: true, json: async () => ({ ok: true, history: [] }) }) });
    Object.assign(env.context, { fetch: env.window.fetch, getAuthHeaders: () => ({}), handleAuthFailure: () => false, escapeHtml: String, formatDT: String });
    vm.runInContext(read("js/history.js"), env.context);
    const drawer = overlay(env, "mutant-history-drawer", "drawer"); env.api.open(drawer.root.id);
    const context = vm.createContext({ document: env.document, viewTicketHistory: env.window.viewTicketHistory, showOperationalInline() {} });
    const helper = functionSource(source, "createDrawerHistoryTrigger"); new vm.Script(helper);
    vm.runInContext(`${helper}\nthis.createDrawerHistoryTrigger = createDrawerHistoryTrigger;`, context);
    const trigger = context.createDrawerHistoryTrigger({ _id: "exact-mutant-id" }); drawer.panel.appendChild(trigger); trigger.focus(); trigger.click();
    env.api.close("history-modal"); assert.equal(env.document.activeElement, trigger);
  }
  assert.doesNotThrow(() => historyTriggerContract(main), "M4 clean contract");
  const m4 = main.replace("document.createElement('button')", "document.createElement('a')");
  assert.notEqual(m4, main, "M4 applied"); new vm.Script(m4);
  assert.throws(() => historyTriggerContract(m4), assert.AssertionError, "M4 href-less anchor detected");

  function ticketTriggerContract(source) {
    const env = harness(); const context = vm.createContext({ document: env.document });
    const helper = functionSource(source, "makeTicketCardInteractive"); new vm.Script(helper);
    vm.runInContext(`${helper}\nthis.makeTicketCardInteractive = makeTicketCardInteractive;`, context);
    const card = env.document.createElement("div"); env.document.body.appendChild(card); let activations = 0;
    context.makeTicketCardInteractive(card, () => { activations += 1; }); card.focus();
    assert.equal(env.document.activeElement, card); card.dispatchEvent(fakeEvent("keydown", card, { key: "Enter" })); assert.equal(activations, 1);
  }
  assert.doesNotThrow(() => ticketTriggerContract(tickets), "M5 clean contract");
  const m5 = tickets.replace("card.tabIndex = 0;", "card.removeAttribute('tabindex');");
  assert.notEqual(m5, tickets, "M5 applied"); new vm.Script(m5);
  assert.throws(() => ticketTriggerContract(m5), assert.AssertionError, "M5 missing card focusability detected");

  function focusHarnessContract(candidate, stable) { candidate.focus(); assert.equal(candidate.ownerDocument.activeElement, stable); }
  const env = harness(); const stable = env.document.createElement("button"); const plain = env.document.createElement("div"); env.document.body.append(stable, plain); stable.focus();
  assert.doesNotThrow(() => focusHarnessContract(plain, stable), "M6 clean contract");
  const originalFocus = plain.focus; plain.focus = function mutantFocus() { this.ownerDocument.activeElement = this; };
  assert.notEqual(plain.focus, originalFocus, "M6 state mutation applied");
  assert.throws(() => focusHarnessContract(plain, stable), assert.AssertionError, "M6 permissive fake focus detected");
});
