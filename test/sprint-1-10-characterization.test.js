"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const domainConfig = require("../shared/ticket-domain-config.js");

class Classes {
  constructor(owner) { this.owner = owner; this.values = new Set(); }
  set(value) { this.values = new Set(String(value || "").split(/\s+/).filter(Boolean)); this.owner._className = [...this.values].join(" "); }
  add(...values) { values.forEach((value) => this.values.add(value)); this.set([...this.values].join(" ")); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); this.set([...this.values].join(" ")); }
  contains(value) { return this.values.has(value); }
}

class Element {
  constructor(tagName, document) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.style = { values: new Map(), setProperty: (name, value) => this.style.values.set(name, String(value)) };
    this.classList = new Classes(this);
    this._innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
  }
  set id(value) { this.setAttribute("id", value); }
  get id() { return this.getAttribute("id") || ""; }
  set className(value) { this.classList.set(value); }
  get className() { return this._className || ""; }
  set tabIndex(value) { this.setAttribute("tabindex", value); }
  get tabIndex() { return Number(this.getAttribute("tabindex") ?? -1); }
  set innerHTML(value) { this._innerHTML = String(value); this.children = []; }
  get innerHTML() { return this._innerHTML; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
  dispatchEvent(event) { event.target ||= this; for (const listener of this.listeners.get(event.type) || []) listener(event); }
  focus() { this.ownerDocument.activeElement = this; }
  closest(selector) {
    let node = this;
    while (node) {
      if (selector.split(",").some((part) => {
        const token = part.trim();
        if (token.startsWith(".")) return node.classList.contains(token.slice(1));
        if (token.startsWith("[")) return node.getAttribute(token.slice(1, -1).split("=")[0]) !== null;
        return node.tagName === token.toUpperCase();
      })) return node;
      node = node.parentNode;
    }
    return null;
  }
  querySelectorAll(selector) {
    const matches = (node) => selector.startsWith(".")
      ? node.classList.contains(selector.slice(1))
      : selector.startsWith("#") ? node.id === selector.slice(1) : node.tagName === selector.toUpperCase();
    return this.children.flatMap((child) => [child, ...child.querySelectorAll(selector)]).filter(matches);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  reset() { this.value = ""; }
}

class Document {
  constructor() { this.body = new Element("body", this); this.activeElement = this.body; this.listeners = new Map(); }
  createElement(tagName) { return new Element(tagName, this); }
  getElementById(id) {
    let element = this.body.querySelector(`#${id}`);
    if (!element) { element = this.createElement("div"); element.id = id; this.body.appendChild(element); }
    return element;
  }
  querySelector(selector) { return this.body.querySelector(selector); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
  dispatch(type, event) { for (const listener of this.listeners.get(type) || []) listener(event); }
}

class Storage {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function operationRuntime(section, records, filterValues = {}) {
  const document = new Document();
  const root = document.getElementById("tickets");
  Object.entries(filterValues).forEach(([id, value]) => { document.getElementById(id).value = value; });
  const activations = [];
  const context = {
    window: null, document, console, TICKET_DOMAIN_CONFIG: domainConfig,
    tickets: { cctv: [], ce: [], complaints: [], "free-orders": [], [section]: records },
    currentSection: section,
    openTicketDrawerByCase(identity, trigger) { activations.push({ identity, trigger }); },
    setTimeout, clearTimeout, Date, Map, Set, Array, Object, String, Math
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read("js/config.js"), context);
  vm.runInContext(read("js/utils.js"), context);
  vm.runInContext(read("assets/js/components/status-registry.js"), context);
  vm.runInContext(read("js/tickets-render.js"), context);
  context.renderTickets();
  return { context, document, root, activations };
}

function inlinePageScript(page) {
  const source = read(page);
  return [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1]).sort((a, b) => b.length - a.length)[0];
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function workflowRuntime(kind, role = "manager") {
  const page = kind === "requests" ? "free-order-requests.html" : "free-order-share.html";
  const document = new Document();
  const sessionStorage = new Storage({ cc_token: "token", cc_role: role, cc_user: "Reviewer" });
  const localStorage = new Storage();
  const calls = [];
  const context = {
    window: null, document, sessionStorage, localStorage, console,
    location: { href: "", pathname: `/${page}` },
    CCPermissions: { requirePageAccess() {} },
    CloudCrowdStatusRegistry: { get: (_domain, raw) => ({ label: raw }), getToneClass: () => "cc-status--neutral" },
    CloudCrowdConfirmation: { request: async () => true },
    CloudCrowdFeedback: { inline(element, message) { element.textContent = message; }, clear(element) { element.textContent = ""; } },
    CloudCrowdMediaViewer: { mediaTypeFromSource: () => "" },
    fetch: async (url, options = {}) => { calls.push({ url, options }); return response({ ok: true, requests: [] }); },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval
  };
  context.window = context;
  const marker = kind === "requests" ? "    renderBoard();\n    loadRequests();" : "    renderBoard();\n    loadShareItems();";
  const exposure = kind === "requests"
    ? `window.__api={STAGE_COLUMNS,requestDisplayStage,getFilteredRequests,updateStats,renderCard,renderBoard,saveDetails,archiveRequest,setRecords(v){requests=v;}};`
    : `window.__api={SHARE_COLUMNS,shareStage,getFilteredItems,updateStats,renderCard,renderBoard,saveResponse,markDone,setRecords(v){shareItems=v;}};`;
  const original = inlinePageScript(page);
  const authorized = original.replace(
    /const access = await[^;]+;\s*if \(!access[^\n]+return;/,
    "const access = { canView: true, unavailable: false };"
  );
  const script = authorized.replace(marker, exposure);
  assert.notEqual(script, authorized, `${kind} exposure installed`);
  vm.runInNewContext(script, context, { filename: page });
  return { api: context.__api, context, document, calls };
}

function renderedControl(document, markup, label) {
  const controlMarkup = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .find((match) => match[2].replace(/<[^>]+>/g, "").trim() === label);
  assert.ok(controlMarkup, `rendered ${label} control exists`);
  const button = document.createElement("button");
  for (const attribute of controlMarkup[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
    button.setAttribute(attribute[1], attribute[2]);
  }
  button.textContent = label;
  const visibleLabel = document.createElement("span");
  visibleLabel.textContent = label;
  button.appendChild(visibleLabel);
  document.body.appendChild(button);
  return { button, visibleLabel };
}

function clickRenderedControl(loaded, record, label) {
  const control = renderedControl(loaded.document, loaded.api.renderCard(record), label);
  loaded.document.dispatch("click", { target: control.visibleLabel });
  return control.button;
}

const flushAsyncAction = () => new Promise((resolve) => setImmediate(resolve));

const operationOrders = {
  cctv: ["Escalated", "Under Review", "Closed"],
  ce: ["Escalated", "Under Review", "Pending (Customer Call Required)", "Closed"],
  complaints: ["Escalated", "Under Review", "Pending (Customer Call Required)", "Closed"],
  "free-orders": ["New", "Active", "Taken"]
};

test("Operations raw statuses and business column order are exact and registry-independent", () => {
  assert.deepEqual(domainConfig.statusOptions, {
    cctv: ["Closed", "Under Review", "Escalated"],
    ce: ["Closed", "Under Review", "Escalated", "Pending (Customer Call Required)"],
    complaints: ["Closed", "Under Review", "Escalated", "Pending (Customer Call Required)"],
    "free-orders": ["New", "Active", "Taken"]
  });
  for (const [section, expected] of Object.entries(operationOrders)) {
    const runtime = operationRuntime(section, []);
    assert.deepEqual(Array.from(runtime.context.STATUS_COLUMNS[section]), expected, section);
  }
  assert.equal(read("assets/js/components/status-registry.js").includes("allowedTransitions"), false);
});

test("real renderTickets validates every Operations column title, count, placement, order, and empty state", () => {
  for (const [section, statuses] of Object.entries(operationOrders)) {
    const expectedIds = statuses.map(() => []);
    const records = [];
    statuses.forEach((status, index) => {
      const quantity = index === statuses.length - 1 ? 2 : index === 1 ? 1 : (statuses.length === 4 && index === 0 ? 2 : 0);
      for (let item = 0; item < quantity; item += 1) {
        const identity = `${section.toUpperCase()}-${index}-${item}`;
        expectedIds[index].push(identity);
        records.push(section === "cctv"
          ? { caseNumber: identity, status, branch: "North", reviewType: "Live", violations: ["Safety"], staff: ["A"] }
          : { orderNumber: identity, caseNumber: `legacy-${identity}`, status });
      }
    });

    const runtime = operationRuntime(section, records);
    const columns = runtime.root.querySelectorAll(".group");
    assert.equal(columns.length, statuses.length, `${section} renders every configured column`);
    columns.forEach((column, index) => {
      const headerMarkup = column.children[0].innerHTML;
      const title = headerMarkup.match(/class="col-title cc-kanban__title"[^>]*>([^<]+)/)?.[1];
      const count = Number(headerMarkup.match(/class="col-count cc-kanban__count">(\d+)</)?.[1]);
      const cards = column.querySelectorAll(".ticket-card");
      const emptyStates = column.querySelectorAll(".kanban-empty-state");
      const expectedTitle = statuses[index] === "Pending (Customer Call Required)" ? "Pending (Call Back)" : statuses[index];
      assert.equal(title, expectedTitle, `${section} column ${index} title/order`);
      assert.equal(count, expectedIds[index].length, `${section} ${statuses[index]} visible count`);
      assert.equal(cards.length, expectedIds[index].length, `${section} ${statuses[index]} card count`);
      expectedIds[index].forEach((identity) => {
        assert.ok(cards.some((card) => card.innerHTML.includes(identity)), `${identity} is inside ${statuses[index]}`);
      });
      assert.equal(emptyStates.length, expectedIds[index].length === 0 ? 1 : 0,
        `${section} ${statuses[index]} empty state matches content`);
    });
  }
});

test("Operations whole-board empty, unknown, missing, alias, and no interaction inventions remain exact", () => {
  for (const [section, expectedChildren] of [["cctv", 4], ["ce", 5], ["complaints", 5], ["free-orders", 1]]) {
    const runtime = operationRuntime(section, []);
    assert.equal(runtime.root.children.length, expectedChildren, `${section} empty behavior`);
  }
  const unknown = operationRuntime("cctv", [{ caseNumber: "U-1", status: "Future State" }, { caseNumber: "M-1" }]);
  assert.equal(unknown.root.querySelectorAll(".group").length, 3, "CCTV keeps exactly its configured lanes");
  assert.equal(unknown.root.querySelectorAll(".ticket-card").length, 0, "unsupported and missing CCTV statuses remain hidden");
  const ce = operationRuntime("ce", [{ orderNumber: "O-1", status: "Pending (Customer Call Required)" }]);
  assert.match(ce.root.children[2].children[0].innerHTML, /Pending \(Call Back\)/);
  assert.doesNotMatch(read("js/tickets-render.js"), /draggable|droppable|dragstart|collapsed|aria-expanded/i);
});

test("real Operations cards preserve domain identity and exact activation trigger", () => {
  const cases = [
    ["cctv", { caseNumber: "CCTV-9", status: "Closed" }, "CCTV-9"],
    ["ce", { orderNumber: "CE-9", caseNumber: "legacy", status: "Closed" }, "CE-9"],
    ["complaints", { orderNumber: "CMP-9", caseNumber: "legacy", status: "Closed" }, "CMP-9"],
    ["free-orders", { orderNumber: "FO-9", caseNumber: "legacy", status: "Taken" }, "FO-9"]
  ];
  for (const [section, record, identity] of cases) {
    const runtime = operationRuntime(section, [record]);
    const card = runtime.root.querySelector(".ticket-card");
    assert.equal(card.getAttribute("role"), "button");
    assert.equal(card.getAttribute("tabindex"), "0");
    card.dispatchEvent({ type: "click", target: card });
    assert.equal(runtime.activations[0].identity, identity);
    assert.equal(runtime.activations[0].trigger, card);
  }
});

test("Requests real projection, board, counts, identities, statistics, and role actions remain exact", () => {
  const loaded = workflowRuntime("requests", "manager");
  const records = [
    { requestId: "one", orderNumber: "A", customerName: "Alpha", internalStage: "pending_details", shareStage: "" },
    { requestId: "two", orderNumber: "B", customerName: "Beta", internalStage: "ready_to_share", shareStage: "received" },
    { requestId: "three", orderNumber: "C", customerName: "Gamma", internalStage: "ready_to_share", shareStage: "needs_response" },
    { requestId: "four", orderNumber: "D", customerName: "Delta", internalStage: "done", shareStage: "done" }
  ];
  assert.deepEqual(Array.from(loaded.api.STAGE_COLUMNS, ({ key }) => key), ["pending_details", "ready_to_share", "needs_response", "done"]);
  assert.equal(loaded.api.requestDisplayStage(records[2]), "needs_response");
  loaded.api.setRecords(records);
  loaded.document.getElementById("search-filter").value = "gamma";
  loaded.api.renderBoard();
  const markup = loaded.document.getElementById("requests-board").innerHTML;
  assert.equal((markup.match(/class="stage-column\s+cc-kanban__column"/g) || []).length, 4);
  assert.match(markup, /Needs Response[\s\S]*count-pill cc-kanban__count">1/);
  assert.equal((markup.match(/No requests in this stage/g) || []).length, 3);
  assert.match(loaded.api.renderCard(records[0]), /data-view-id="one"/);
  assert.match(loaded.api.renderCard(records[0]), /data-complete-id="one"/);
  assert.match(loaded.api.renderCard(records[0]), /data-delete-id="one"/);
  loaded.api.updateStats();
  assert.equal(loaded.document.getElementById("stat-total").textContent, 4);
});

test("Requests exact Complete Details and archive contracts remain page-owned", async () => {
  const loaded = workflowRuntime("requests", "manager");
  loaded.api.setRecords([{ requestId: "same-id", orderNumber: "ORD" }]);
  Object.entries({ "details-request-id": "same-id", "decision-maker": "Manager", attached: "proof", "deduction-from": "Brand", "case-description": "Case", notes: "Note" })
    .forEach(([id, value]) => { loaded.document.getElementById(id).value = value; });
  await loaded.api.saveDetails({ preventDefault() {} });
  assert.equal(loaded.calls[0].url, "/.netlify/functions/free-order-requests?id=same-id&action=complete-details");
  assert.equal(loaded.calls[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(loaded.calls[0].options.body), { decisionMaker: "Manager", attached: "proof", deductionFrom: "Brand", caseDescription: "Case", notes: "Note" });
  loaded.calls.length = 0;
  loaded.context.CloudCrowdConfirmation.request = async () => false;
  await loaded.api.archiveRequest("same-id");
  assert.equal(loaded.calls.length, 0);
  const agent = workflowRuntime("requests", "agent");
  assert.doesNotMatch(agent.api.renderCard({ requestId: "x", internalStage: "pending_details" }), /data-delete-id/);
  for (const required of ["decisionMaker", "deductionFrom", "caseDescription"]) {
    assert.match(read("netlify/functions/free-order-requests.js"), new RegExp(`${required}: requiredText\\([\\s\\S]*?body\\?\\.${required}`));
  }
});

test("Requests rendered controls dispatch View, Complete Details, and Archive through delegated wiring", async () => {
  const loaded = workflowRuntime("requests", "manager");
  const request = { requestId: "wired-request", orderNumber: "ORD-UI", customerName: "UI Customer", internalStage: "pending_details", shareStage: "" };
  const stages = [
    request,
    { requestId: "wired-ready", orderNumber: "ORD-READY", customerName: "Ready", internalStage: "ready_to_share", shareStage: "" },
    { requestId: "wired-response", orderNumber: "ORD-RESPONSE", customerName: "Response", internalStage: "ready_to_share", shareStage: "needs_response" },
    { requestId: "wired-done", orderNumber: "ORD-DONE", customerName: "Done", internalStage: "done", shareStage: "done" }
  ];
  loaded.api.setRecords(stages);

  stages.forEach((stageRecord) => {
    clickRenderedControl(loaded, stageRecord, "View Details");
    assert.equal(loaded.document.getElementById("view-modal").classList.contains("open"), true, "View Details opens its rendered modal");
    assert.equal(loaded.document.getElementById("view-modal-title").textContent, `Request ${stageRecord.orderNumber}`);
  });

  clickRenderedControl(loaded, request, "Complete Details");
  assert.equal(loaded.document.getElementById("details-request-id").value, "wired-request");
  assert.equal(loaded.document.getElementById("details-modal").classList.contains("open"), true, "Complete Details opens its rendered form");

  loaded.calls.length = 0;
  clickRenderedControl(loaded, request, "Archive");
  await flushAsyncAction();
  assert.equal(loaded.calls[0].url, "/.netlify/functions/free-order-requests?id=wired-request", "Archive dispatches the rendered request identity");
  assert.equal(loaded.calls[0].options.method, "DELETE");
});

test("Share real projection, board, counts, identity, and action visibility remain exact", () => {
  const loaded = workflowRuntime("share");
  const records = [
    { requestId: "one", orderNumber: "A", customerName: "Alpha", internalStage: "ready_to_share", shareStage: "received" },
    { requestId: "two", orderNumber: "B", customerName: "Beta", internalStage: "ready_to_share", shareStage: "needs_response" },
    { requestId: "three", orderNumber: "C", customerName: "Gamma", internalStage: "done", shareStage: "" }
  ];
  assert.deepEqual(Array.from(loaded.api.SHARE_COLUMNS, ({ key }) => key), ["received", "needs_response", "done"]);
  assert.equal(loaded.api.shareStage(records[2]), "done");
  loaded.api.setRecords(records);
  loaded.document.getElementById("stage-filter").value = "needs_response";
  loaded.api.renderBoard();
  const markup = loaded.document.getElementById("share-board").innerHTML;
  assert.equal((markup.match(/class="share-column\s+cc-kanban__column"/g) || []).length, 3);
  assert.equal((markup.match(/No share items in this stage/g) || []).length, 2);
  assert.match(loaded.api.renderCard(records[0]), /data-response-id="one"/);
  assert.match(loaded.api.renderCard(records[0]), /data-done-id="one"/);
  assert.doesNotMatch(loaded.api.renderCard(records[1]), /data-response-id/);
  assert.doesNotMatch(loaded.api.renderCard(records[2]), /data-done-id/);
});

test("Share exact Needs Response and Mark Done contracts and confirmations remain page-owned", async () => {
  const loaded = workflowRuntime("share");
  loaded.api.setRecords([{ requestId: "same-id", orderNumber: "ORD", shareStage: "received" }]);
  loaded.document.getElementById("response-request-id").value = "same-id";
  loaded.document.getElementById("share-note").value = "Clarify";
  await loaded.api.saveResponse({ preventDefault() {} });
  assert.equal(loaded.calls[0].url, "/.netlify/functions/free-order-requests?id=same-id&action=needs-response");
  assert.deepEqual(JSON.parse(loaded.calls[0].options.body), { shareNote: "Clarify" });
  loaded.calls.length = 0;
  loaded.api.setRecords([{ requestId: "same-id", orderNumber: "ORD", shareStage: "received" }]);
  loaded.context.CloudCrowdConfirmation.request = async () => false;
  await loaded.api.markDone("same-id");
  assert.equal(loaded.calls.length, 0);
  loaded.context.CloudCrowdConfirmation.request = async () => true;
  await loaded.api.markDone("same-id");
  assert.equal(loaded.calls[0].url, "/.netlify/functions/free-order-requests?id=same-id&action=share-done");
  assert.equal(loaded.calls[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(loaded.calls[0].options.body), {});
  assert.match(read("netlify/functions/free-order-requests.js"), /shareNote: requiredText\(body\?\.shareNote/);
});

test("Share rendered controls dispatch View, Needs Response, and Mark Done through delegated wiring", async () => {
  const loaded = workflowRuntime("share");
  const item = { requestId: "wired-share", orderNumber: "SHARE-UI", customerName: "UI Customer", internalStage: "ready_to_share", shareStage: "received" };
  const stages = [
    item,
    { requestId: "wired-needs", orderNumber: "SHARE-NEEDS", customerName: "Needs", internalStage: "ready_to_share", shareStage: "needs_response" },
    { requestId: "wired-done", orderNumber: "SHARE-DONE", customerName: "Done", internalStage: "done", shareStage: "done" }
  ];
  loaded.api.setRecords(stages);

  stages.forEach((stageRecord) => {
    clickRenderedControl(loaded, stageRecord, "View Details");
    assert.equal(loaded.document.getElementById("view-modal").classList.contains("open"), true, "View Details opens its rendered modal");
    assert.equal(loaded.document.getElementById("view-modal-title").textContent, `Share ${stageRecord.orderNumber}`);
  });

  clickRenderedControl(loaded, item, "Needs Response");
  assert.equal(loaded.document.getElementById("response-request-id").value, "wired-share");
  assert.equal(loaded.document.getElementById("response-modal").classList.contains("open"), true, "Needs Response opens its rendered form");

  loaded.calls.length = 0;
  clickRenderedControl(loaded, item, "Mark Done");
  await flushAsyncAction();
  assert.equal(loaded.calls[0].url, "/.netlify/functions/free-order-requests?id=wired-share&action=share-done");
  assert.equal(loaded.calls[0].options.method, "PUT");

  const needsResponse = workflowRuntime("share");
  needsResponse.api.setRecords([stages[1]]);
  clickRenderedControl(needsResponse, stages[1], "Mark Done");
  await flushAsyncAction();
  assert.equal(needsResponse.calls[0].url, "/.netlify/functions/free-order-requests?id=wired-needs&action=share-done",
    "Needs Response stage retains its rendered Mark Done transition");
});

test("workflow boards safely omit unsupported stages without changing configured columns or totals", () => {
  const cases = [
    ["requests", { requestId: "future-request", orderNumber: "FUTURE-R", internalStage: "future_stage", shareStage: "" }, "requests-board", "No requests in this stage", 4],
    ["share", { requestId: "future-share", orderNumber: "FUTURE-S", internalStage: "ready_to_share", shareStage: "future_stage" }, "share-board", "No share items in this stage", 3]
  ];
  for (const [kind, record, boardId, emptyText, columnCount] of cases) {
    const loaded = workflowRuntime(kind);
    loaded.api.setRecords([record]);
    loaded.api.renderBoard();
    const markup = loaded.document.getElementById(boardId).innerHTML;
    assert.equal((markup.match(/cc-kanban__column/g) || []).length, columnCount, `${kind} configured column inventory remains closed`);
    assert.equal((markup.match(new RegExp(emptyText, "g")) || []).length, columnCount, `${kind} unknown item enters no known column`);
    assert.doesNotMatch(markup, /FUTURE-[RS]/, `${kind} unsupported stage is not assigned to a fallback column`);
    assert.equal(loaded.document.getElementById("stat-total").textContent, 1, `${kind} total still reports the source record`);
  }
});

test("Kanban APIs, persistence, history, media, registry, drag, and collapse boundaries remain domain-owned", () => {
  const operations = read("main.js");
  assert.match(operations, /cloudCrowdTickets/);
  assert.match(operations, /setInterval\(poll, 15000\)/);
  assert.match(operations, /hydrateFromDB/);
  assert.match(operations, /hydrateFromSheets/);
  assert.match(read("js/history.js"), /history=1&id=/);
  assert.match(read("js/media-viewer.js"), /CloudCrowdMediaViewer/);
  for (const page of ["free-order-requests.html", "free-order-share.html"]) {
    const source = read(page);
    assert.match(source, /\.netlify\/functions\/free-order-requests/);
    assert.doesNotMatch(source, /draggable|droppable|dragstart|collapsed|aria-expanded/i);
  }
  const registry = read("assets/js/components/status-registry.js");
  assert.doesNotMatch(registry, /STAGE_COLUMNS|SHARE_COLUMNS|STATUS_COLUMNS|allowedTransitions|endpoint|payload/);
});
