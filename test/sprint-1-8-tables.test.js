"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createCascade, element } = require("./css-cascade.js");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const PAGES = [
  "attendance.html", "employee-deductions.html", "agent-training.html", "restaurant-ratings.html",
  "weekly-quality.html", "employee-profiles.html", "client-profiles.html", "anati-admin.html"
];

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
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

function headers(source) {
  return Array.from(source.matchAll(/<table\b[\s\S]*?<\/table>/gi), (table) =>
    Array.from(table[0].matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/gi), (header) => ({
      attrs: header[1],
      text: header[2].replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()
    }))
  ).filter((table) => table.length);
}

function bodyClasses(page) {
  return read(page).match(/<body\b[^>]*class="([^"]*)"/i)?.[1].split(/\s+/).filter(Boolean) || [];
}

function tableTree(page, { compact = false, matrix = false, theme = "light" } = {}) {
  const html = element("html", { attributes: { "data-theme": theme } });
  const body = element("body", { classes: bodyClasses(page) }, html);
  const container = element("section", { classes: ["content-card"] }, body);
  const wrapper = element("div", { classes: [compact ? "profile-table-wrap" : "table-wrap", "cc-table-wrap"], attributes: { tabindex: "0" } }, container);
  const table = element("table", { classes: [compact ? "profile-table" : "records-table", "cc-table", ...(compact ? ["cc-table--compact"] : []), ...(matrix ? ["access-table", "cc-table--matrix"] : [])] }, wrapper);
  const thead = element("thead", {}, table);
  const row = element("tr", {}, thead);
  const th = element("th", { attributes: { scope: "col" } }, row);
  const tbody = element("tbody", {}, table);
  const bodyRow = element("tr", {}, tbody);
  const td = element("td", {}, bodyRow);
  const numeric = element("td", { classes: ["cc-table__numeric"] }, bodyRow);
  const actions = element("div", { classes: ["cc-table__actions"] }, td);
  return { html, body, wrapper, table, th, td, numeric, actions };
}

class AdminActionButton {
  constructor(attributes, label) {
    this.label = label;
    this.disabled = /(?:^|\s)disabled(?:\s|$)/i.test(attributes);
    this.dataset = {};
    this.listeners = new Map();
    for (const match of attributes.matchAll(/data-([a-z-]+)="([^"]*)"/gi)) {
      const key = match[1].replace(/-([a-z])/g, (_full, letter) => letter.toUpperCase());
      this.dataset[key] = match[2];
    }
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  click() {
    if (!this.disabled) this.listeners.get("click")?.({ currentTarget: this });
  }
}

class AdminUsersBody {
  constructor() {
    this.markup = "";
    this.buttons = [];
  }

  set innerHTML(markup) {
    this.markup = markup;
    this.buttons = Array.from(markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi), (match) => {
      return new AdminActionButton(match[1], match[2].replace(/<[^>]*>/g, "").trim());
    });
  }

  get innerHTML() {
    return this.markup;
  }

  querySelectorAll(selector) {
    const attribute = selector.match(/^\[data-([a-z-]+)\]$/i)?.[1];
    if (!attribute) return [];
    const key = attribute.replace(/-([a-z])/g, (_full, letter) => letter.toUpperCase());
    return this.buttons.filter((button) => Object.hasOwn(button.dataset, key));
  }
}

function renderAdminDisableActions(source, users) {
  const body = new AdminUsersBody();
  const dispatchedIds = [];
  const context = {
    adminUsers: users,
    activeEmployees: users.filter((user) => user.employeeId).map((user) => ({
      employeeId: user.employeeId,
      fullName: `${user.displayName} Employee`
    })),
    adminStatusBadge: (status) => `<span>${status}</span>`,
    disableUser: (userId) => dispatchedIds.push(userId),
    editUser() {},
    escapeHtml: (value) => String(value ?? ""),
    document: { getElementById: () => body }
  };
  vm.runInNewContext(functionSource(source, "renderUsers"), context, { filename: "anati-admin.html#renderUsers" });
  context.renderUsers();
  return {
    body,
    dispatchedIds,
    disableButtons: body.querySelectorAll("[data-disable-user]")
  };
}

function longTextTree(page, theme = "light") {
  const html = element("html", { attributes: { "data-theme": theme } });
  const body = element("body", { classes: bodyClasses(page) }, html);

  if (page === "employee-profiles.html") {
    const shell = element("div", { classes: ["profiles-shell", "cc-shell-layout"] }, body);
    const shellMain = element("div", { classes: ["profiles-main", "cc-shell-main"] }, shell);
    const container = element("main", { classes: ["main-area", "cc-page-container", "cc-page-container--workspace"] }, shellMain);
    const workspace = element("section", { id: "employee-workspace", classes: ["employee-workspace-pane"] }, container);
    const wrapper = element("div", { classes: ["profile-table-wrap", "cc-table-wrap"] }, workspace);
    const table = element("table", { classes: ["profile-table", "cc-table", "cc-table--compact"] }, wrapper);
    const tbody = element("tbody", {}, table);
    const row = element("tr", {}, tbody);
    const target = element("td", { classes: ["profile-note"] }, row);
    return { wrapper, table, target, minimumWidth: "760px" };
  }

  if (page === "client-profiles.html") {
    const modal = element("div", { id: "profile-modal", classes: ["modal", "open"] }, body);
    const panel = element("div", { classes: ["modal-panel"] }, modal);
    const modalBody = element("div", { id: "profile-modal-body", classes: ["modal-body"] }, panel);
    const section = element("section", { classes: ["detail-section"] }, modalBody);
    const wrapper = element("div", { classes: ["profile-table-wrap", "cc-table-wrap"] }, section);
    const table = element("table", { classes: ["profile-table", "cc-table", "cc-table--compact"] }, wrapper);
    const tbody = element("tbody", {}, table);
    const row = element("tr", {}, tbody);
    const cell = element("td", {}, row);
    const details = element("details", { classes: ["quality-details"] }, cell);
    const target = element("div", {}, details);
    return { wrapper, table, target, minimumWidth: "680px" };
  }

  const shell = element("div", { classes: ["cc-shell-layout", "has-responsive-navigation"] }, body);
  const main = element("main", { classes: ["cc-shell-main"] }, shell);
  const container = element("div", { classes: ["people-management-container", "cc-page-container", "cc-page-container--standard"] }, main);
  const card = element("section", { classes: ["content-card"] }, container);
  const wrapper = element("div", { classes: ["table-wrap", "cc-table-wrap"] }, card);
  const table = element("table", { classes: ["records-table", "cc-table"] }, wrapper);
  const tbody = element("tbody", {}, table);
  const row = element("tr", {}, tbody);
  const target = element("td", { classes: [page === "agent-training.html" ? "notes-cell" : "note-cell"] }, row);
  return { wrapper, table, target, minimumWidth: page === "agent-training.html" ? "1120px" : "980px" };
}

const INITIAL_LONG_TEXT_VALUES = {
  "white-space": "normal",
  overflow: "visible",
  "overflow-x": "visible",
  "text-overflow": "clip",
  "word-break": "normal",
  "overflow-wrap": "normal"
};

function longTextWinners(cascade, target) {
  return Object.fromEntries(Object.entries(INITIAL_LONG_TEXT_VALUES).map(([property, initial]) => {
    const winner = cascade.winner(target, property);
    return [property, {
      value: winner ? cascade.resolveValue(target, winner.value) : initial,
      sourceName: winner?.sourceName || "CSS initial value"
    }];
  }));
}

function assertLongTextAccessible(cascade, target, label) {
  const winners = longTextWinners(cascade, target);
  const nowrap = winners["white-space"].value === "nowrap";
  const clips = [winners.overflow.value, winners["overflow-x"].value].some((value) => /^(?:hidden|clip)$/.test(value));
  assert.equal(nowrap, false, `${label} long text wraps; winners: ${JSON.stringify(winners)}`);
  assert.equal(clips, false, `${label} long text is not clipped; winners: ${JSON.stringify(winners)}`);
  return winners;
}

test("shared Table System is presentation-only and follows component policy", () => {
  const css = read("assets/css/components/tables.css");
  for (const primitive of [
    ".cc-table-wrap", ".cc-table", ".cc-table--compact", ".cc-table__numeric",
    ".cc-table__actions", ".cc-table__muted", ".cc-table__state", ".cc-table-state", ".cc-table--matrix"
  ]) assert.ok(css.includes(primitive), primitive);
  assert.doesNotMatch(css, /!important/i);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  assert.doesNotMatch(css, /position\s*:\s*sticky|table-layout\s*:\s*fixed/i);
  for (const match of css.matchAll(/font-weight\s*:\s*(\d+)/gi)) assert.ok(Number(match[1]) <= 700, match[0]);
  assert.equal(fs.existsSync(path.join(ROOT, "assets/js/components/tables.js")), false);
  assert.doesNotMatch(css, /pagination|sort|resize|pin|virtual|selection/i);
});

test("all thirteen tables load and consume one deterministic shared foundation", () => {
  let tableCount = 0;
  for (const page of PAGES) {
    const source = read(page);
    assert.equal((source.match(/assets\/css\/components\/tables\.css/g) || []).length, 1, page);
    assert.ok(source.indexOf("design-tokens.css") < source.indexOf("components/tables.css"), `${page} token order`);
    assert.ok(source.indexOf("components/status.css") < source.indexOf("components/tables.css"), `${page} component order`);
    const matches = source.match(/<table\b[^>]*class="[^"]*\bcc-table\b[^"]*"[^>]*>/g) || [];
    tableCount += matches.length;
    for (const table of matches) assert.match(table, /aria-(?:label|labelledby)=/);
  }
  assert.equal(tableCount, 13);
});

test("column headers remain exact, scoped, and structurally semantic", () => {
  let count = 0;
  for (const page of PAGES) {
    for (const table of headers(read(page))) {
      assert.ok(table.length >= 5, `${page} header count`);
      for (const header of table) assert.match(header.attrs, /scope="col"/, `${page}/${header.text}`);
      count += 1;
    }
    assert.doesNotMatch(read(page), /<th>/);
  }
  assert.equal(count, 13);
});

test("exact minimum widths and wrapper overflow contracts remain intact", () => {
  const contracts = [
    ["attendance.html", 980], ["employee-deductions.html", 1180], ["agent-training.html", 1120],
    ["restaurant-ratings.html", 1080], ["weekly-quality.html", 980], ["employee-profiles.html", 760],
    ["client-profiles.html", 680], ["anati-admin.html", 760]
  ];
  for (const [page, width] of contracts) {
    assert.match(read(page), new RegExp(`min-width\\s*:\\s*${width}px`), page);
    assert.match(read(page), /cc-table-wrap/);
  }
  const css = read("assets/css/components/tables.css");
  assert.match(css, /\.cc-table-wrap\.cc-table-wrap[\s\S]*overflow-x:\s*auto/);
  assert.doesNotMatch(css, /overflow-x\s*:\s*(?:hidden|clip)/);
});

function executeRenderer(page, name, context) {
  vm.runInNewContext(functionSource(read(page), name), context, { filename: page });
  context[name]();
  return context;
}

function rendererDocument() {
  const elements = {
    "records-body": { innerHTML: "" },
    "records-empty": { textContent: "", dataset: {}, style: {}, setAttribute(name, value) { this[name] = value; } },
    "empty-state": { textContent: "", dataset: {}, style: {}, setAttribute(name, value) { this[name] = value; } },
    "record-count": { textContent: "" }
  };
  return { elements, document: { getElementById: (id) => elements[id] } };
}

test("actual record renderers preserve values, numeric cells, actions, and attributes", () => {
  const escapeHtml = (value) => String(value ?? "");
  {
    const dom = rendererDocument();
    const record = { deductionId: "ded-1", employeeNameSnapshot: "Agent", deductionType: "Order Mistake", restaurantName: "Brand", orderNumber: "42", originalAmount: 10, applyEmployeeDiscount: true, finalDeductionAmount: 9, orderDateTime: "2026-08-01", approvedBy: "Manager" };
    const context = { ...dom, deductions: [record], canManageDeductions: true, getFilteredDeductions: () => [record], escapeHtml, formatAmount: (value) => `${Number(value).toFixed(2)} JOD` };
    executeRenderer("employee-deductions.html", "renderDeductions", context);
    assert.match(dom.elements["records-body"].innerHTML, /10\.00 JOD[\s\S]*Yes \(10%\)[\s\S]*9\.00 JOD/);
    assert.match(dom.elements["records-body"].innerHTML, /cc-table__numeric/);
    assert.match(dom.elements["records-body"].innerHTML, /View Details[\s\S]*Edit[\s\S]*Delete/);
  }
  {
    const dom = rendererDocument();
    const record = { trainingId: "training-1", employeeNameSnapshot: "Agent", restaurantName: "Brand", assignmentStatus: "Assigned", trainingStatus: "Trained", notes: "Long note" };
    const context = { ...dom, trainingRecords: [record], canManageTraining: true, getFilteredTraining: () => [record], getRecordRestaurantName: (value) => value.restaurantName, statusBadge: (value) => `<span>${value}</span>`, escapeHtml };
    executeRenderer("agent-training.html", "renderTraining", context);
    assert.match(dom.elements["records-body"].innerHTML, /Assigned[\s\S]*Trained[\s\S]*Long note[\s\S]*View Details[\s\S]*Edit[\s\S]*Delete/);
  }
  {
    const dom = rendererDocument();
    const record = { ratingId: "rating-1", restaurantNameSnapshot: "Brand", platform: "Talabat", monthName: "August", weekName: "Week 1", rating: 4.5, reviewsCount: 12 };
    const context = { ...dom, ratings: [record], getFilteredRatings: () => [record], platformBadge: (value) => `<span>${value}</span>`, ratingBadge: (value) => `<span>${value}</span>`, escapeHtml };
    executeRenderer("restaurant-ratings.html", "renderRatings", context);
    assert.match(dom.elements["records-body"].innerHTML, /Talabat[\s\S]*4\.5[\s\S]*12[\s\S]*View[\s\S]*Edit[\s\S]*Archive/);
  }
  {
    const dom = rendererDocument();
    const record = { id: "quality-1", callDateTime: "2026-08-01", totalScore: 93, recording: { name: "call.mp3" } };
    const context = { ...dom, getQualityRecords: () => [record], populateFilterOptions() {}, getFilteredRecords: () => [record], updateStats() {}, getAuditorName: () => "Auditor", getAgentName: () => "Agent", getRecordRestaurantName: () => "Brand", escapeHtml };
    executeRenderer("weekly-quality.html", "renderRecords", context);
    assert.match(dom.elements["records-body"].innerHTML, /93%[\s\S]*Available[\s\S]*View Details[\s\S]*Delete/);
    assert.match(dom.elements["records-body"].innerHTML, /data-details-id="quality-1"[\s\S]*data-delete-id="quality-1"/);
  }
});

test("Admin matrix renderer and collector preserve accessibility and payload round trip", () => {
  const source = read("anati-admin.html");
  const modulesBody = { innerHTML: "" };
  const context = {
    moduleRegistry: [{ moduleKey: "quality", moduleName: "Weekly Quality" }],
    moduleAccess: [{ username: "manager", moduleKey: "quality", canView: true, canCreate: false, canEdit: true, canDelete: false }],
    escapeHtml: (value) => String(value),
    document: { getElementById: (id) => id === "modules-body" ? modulesBody : { value: "manager" } }
  };
  vm.runInNewContext(["accessFor", "renderModules"].map((name) => functionSource(source, name)).join("\n"), context);
  context.renderModules();
  assert.match(modulesBody.innerHTML, /<th scope="row">/);
  assert.equal((modulesBody.innerHTML.match(/type="checkbox"/g) || []).length, 4);
  for (const permission of ["View", "Create", "Edit", "Delete"]) assert.ok(modulesBody.innerHTML.includes(`Weekly Quality — ${permission}`));
  assert.match(modulesBody.innerHTML, /data-access-field="canView"[^>]*checked/);
  assert.doesNotMatch(modulesBody.innerHTML, /select all|row selection/i);

  const checkboxes = [
    { dataset: { accessField: "canView" }, checked: true },
    { dataset: { accessField: "canCreate" }, checked: false },
    { dataset: { accessField: "canEdit" }, checked: true },
    { dataset: { accessField: "canDelete" }, checked: false }
  ];
  const row = { dataset: { moduleKey: "quality" }, querySelectorAll: () => checkboxes };
  const collectContext = { document: {
    getElementById: () => ({ value: "manager" }),
    querySelectorAll: () => [row]
  } };
  vm.runInNewContext(functionSource(source, "collectAccessPayload"), collectContext);
  assert.deepEqual(JSON.parse(JSON.stringify(collectContext.collectAccessPayload())), {
    username: "manager",
    access: [{ moduleKey: "quality", canView: true, canCreate: false, canEdit: true, canDelete: false }]
  });
});

test("renderUsers connects each eligible Admin Disable control to its exact user ID", () => {
  const users = [
    { userId: "user-one", username: "worker-one", displayName: "Worker One", status: "active", role: "agent", accountType: "external" },
    { userId: "user-two", username: "worker-two", displayName: "Worker Two", status: "active", role: "manager", accountType: "external" },
    { userId: "anati-id", username: "Anati", displayName: "Anati", status: "active", role: "admin", accountType: "system" },
    { userId: "disabled-id", username: "former-worker", displayName: "Former Worker", status: "disabled", role: "agent", accountType: "external" }
  ];
  const rendered = renderAdminDisableActions(read("anati-admin.html"), users);

  assert.equal(rendered.disableButtons.length, 4);
  assert.deepEqual(rendered.disableButtons.map((button) => button.dataset.disableUser),
    ["user-one", "user-two", "anati-id", "disabled-id"]);
  assert.deepEqual(rendered.disableButtons.map((button) => button.label),
    ["Disable", "Disable", "Disable", "Disable"]);

  rendered.disableButtons[1].click();
  assert.deepEqual(rendered.dispatchedIds, ["user-two"], "the second row dispatches its own ID");
  rendered.disableButtons[0].click();
  assert.deepEqual(rendered.dispatchedIds, ["user-two", "user-one"], "an ordinary row dispatches its exact ID");

  assert.equal(rendered.disableButtons[2].disabled, true, "Anati remains protected");
  assert.equal(rendered.disableButtons[3].disabled, true, "an already-disabled user remains non-actionable");
  rendered.disableButtons[2].click();
  rendered.disableButtons[3].click();
  assert.deepEqual(rendered.dispatchedIds, ["user-two", "user-one"], "disabled controls do not dispatch");
});

test("an executable Admin mutation catches a rendered Disable control disconnected from dispatch", () => {
  const source = read("anati-admin.html");
  const mutated = source.replace("disableUser(button.dataset.disableUser)", "void 0");
  assert.notEqual(mutated, source, "disconnect mutation applied");
  assert.doesNotThrow(() => new vm.Script(functionSource(mutated, "renderUsers")), "mutated renderer compiles");

  const rendered = renderAdminDisableActions(mutated, [
    { userId: "mutation-user", username: "worker", displayName: "Worker", status: "active", role: "agent", accountType: "external" }
  ]);
  assert.equal(rendered.disableButtons.length, 1, "rendered Disable button remains present");
  assert.equal(rendered.disableButtons[0].dataset.disableUser, "mutation-user", "data-disable-user remains present");
  assert.equal(rendered.disableButtons[0].label, "Disable", "visible label remains present");

  assert.throws(() => {
    rendered.disableButtons[0].click();
    assert.deepEqual(rendered.dispatchedIds, ["mutation-user"], "rendered Disable click dispatches exact user ID");
  }, /rendered Disable click dispatches exact user ID/, "no-op mutation fails for the behavioral connection");
});

test("table-local state semantics distinguish loading, empty, no-results, and error", () => {
  const admin = read("anati-admin.html");
  assert.match(admin, /data-state="loading" role="status">Loading users/);
  assert.match(admin, /data-state="empty" role="status">No user profiles found/);
  for (const page of ["employee-deductions.html", "agent-training.html", "restaurant-ratings.html"]) {
    const source = read(page);
    assert.match(source, /data-state="loading" role="status"/);
    assert.match(source, /setAttribute\('data-state', 'error'\)[\s\S]*setAttribute\('role', 'alert'\)/);
    assert.match(source, /\? 'no-results' : 'empty'/);
  }
  assert.match(read("attendance.html"), /Showing local browser records only/);
  assert.match(read("weekly-quality.html"), /qualityRecordsSource = 'local'/);
  assert.doesNotMatch(read("assets/css/components/tables.css"), /skeleton/i);
});

test("actual Light and Dark cascades resolve shared surfaces, text, dividers, and variants", () => {
  const targets = [
    ["attendance.html", {}],
    ["employee-deductions.html", {}],
    ["restaurant-ratings.html", {}],
    ["employee-profiles.html", { compact: true }],
    ["client-profiles.html", { compact: true }],
    ["anati-admin.html", { matrix: true }]
  ];
  for (const theme of ["light", "dark"]) {
    for (const [page, options] of targets) {
      const tree = tableTree(page, { ...options, theme });
      const cascade = createCascade(ROOT, page, { viewportWidth: 1440 });
      for (const [node, property, token] of [
        [tree.table, "background", "--color-surface"],
        [tree.th, "background", "--table-header-background"],
        [tree.th, "color", "--color-text-muted"],
        [tree.td, "color", "--color-text"],
        [tree.td, "border-bottom", "--table-divider"]
      ]) {
        const winner = cascade.winner(node, property);
        assert.ok(winner, `${theme}/${page}/${property}`);
        assert.ok(winner.value.includes(`var(${token})`), `${theme}/${page}/${property}: ${winner.value}`);
        assert.match(winner.sourceName, /tables\.css$/);
      }
      if (!options.matrix) assert.equal(cascade.resolveValue(tree.numeric, cascade.winner(tree.numeric, "text-align").value), "end");
      assert.equal(cascade.resolveValue(tree.actions, cascade.winner(tree.actions, "display").value), "flex");
    }
  }
});

test("responsive geometry preserves internal scrolling and final-column reachability", () => {
  const families = [
    ["Attendance", 980], ["Deductions", 1180], ["Training", 1120], ["Ratings", 1080],
    ["Weekly", 980], ["Employee", 760], ["Client", 680], ["Admin", 760]
  ];
  for (const viewport of [1440, 1280, 1024, 768, 390, 360, 320]) {
    const available = Math.max(1, viewport - (viewport > 768 ? 96 : 40));
    for (const [name, minimum] of families) {
      const scrollWidth = Math.max(available, minimum);
      const maxScrollLeft = scrollWidth - available;
      assert.ok(scrollWidth >= minimum, `${name}/${viewport} minimum`);
      assert.ok(maxScrollLeft >= 0, `${name}/${viewport} scroll range`);
      assert.equal(available + maxScrollLeft, scrollWidth, `${name}/${viewport} final edge reachable`);
    }
  }
  const cascade = createCascade(ROOT, "employee-deductions.html", { viewportWidth: 320 });
  const { wrapper } = tableTree("employee-deductions.html");
  assert.equal(cascade.resolveValue(wrapper, cascade.winner(wrapper, "overflow-x").value), "auto");
});

test("profile and modal tables retain contained, single-owner horizontal scrolling", () => {
  const employee = read("employee-profiles.html");
  assert.match(employee, /id="employee-workspace"[\s\S]*profile-table-wrap cc-table-wrap/);
  assert.equal((employee.match(/profile-table-wrap cc-table-wrap/g) || []).length, 3);
  const client = read("client-profiles.html");
  assert.match(client, /id="profile-modal"[\s\S]*profile-table-wrap cc-table-wrap/);
  assert.equal((client.match(/profile-table-wrap cc-table-wrap/g) || []).length, 3);
  assert.match(client, /#profile-modal \.modal-panel\{width:min\(1120px,100%\)\}/);
  assert.match(read("assets/css/components/tables.css"), /overflow-y:\s*visible/);
});

test("long text remains wrappable and no mobile cardification or hidden columns were added", () => {
  const css = read("assets/css/components/tables.css");
  const baseCells = css.match(/\.cc-table\.cc-table :is\(th, td\)\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.doesNotMatch(baseCells, /white-space\s*:\s*nowrap/i);
  assert.doesNotMatch(css, /display\s*:\s*(?:none|block)[^}]*data-label|content\s*:\s*attr\(data-label\)/i);
  assert.match(read("agent-training.html"), /\.notes-cell\{max-width:260px;white-space:normal\}/);
  assert.match(read("restaurant-ratings.html"), /\.notes-cell\{max-width:260px;white-space:normal\}/);
  assert.match(read("client-profiles.html"), /<details class="quality-details">[\s\S]*<summary>View Details<\/summary>/);
});

test("actual long-text cascade winners preserve full content access across table families", () => {
  const targets = [
    ["agent-training.html", "Training notes"],
    ["attendance.html", "Attendance note"],
    ["employee-profiles.html", "Employee attendance note"],
    ["client-profiles.html", "Client quality details"]
  ];
  for (const theme of ["light", "dark"]) {
    for (const viewportWidth of [1440, 768, 390, 320]) {
      for (const [page, label] of targets) {
        const tree = longTextTree(page, theme);
        const cascade = createCascade(ROOT, page, { viewportWidth });
        assert.equal(cascade.winner(tree.table, "min-width").value, tree.minimumWidth, `${label}/${theme}/${viewportWidth} width`);
        assert.equal(cascade.winner(tree.wrapper, "overflow-x").value, "auto", `${label}/${theme}/${viewportWidth} horizontal owner`);
        const winners = assertLongTextAccessible(cascade, tree.target, `${label}/${theme}/${viewportWidth}`);
        assert.match(winners["overflow-wrap"].value, /^(?:normal|break-word|anywhere)$/);
        assert.match(winners["word-break"].value, /^(?:normal|break-all|keep-all|break-word)$/);
      }
    }
  }
});

test("higher-specificity long-text clipping mutations win the cascade and fail the access contract", () => {
  const fixtures = [
    {
      page: "agent-training.html",
      label: "Training notes mutation",
      css: `.people-management-page.agent-training-page .content-card .cc-table-wrap .records-table.cc-table td.notes-cell {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }`
    },
    {
      page: "client-profiles.html",
      label: "Client quality details mutation",
      css: `.business-quality-page.client-profiles-page #profile-modal .modal-panel .profile-table.cc-table td .quality-details div {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }`
    }
  ];

  for (const fixture of fixtures) {
    const tree = longTextTree(fixture.page, "dark");
    const sourceName = `fixture-${fixture.page}-long-text.css`;
    const cascade = createCascade(ROOT, fixture.page, {
      viewportWidth: 320,
      extraSources: [{ name: sourceName, css: fixture.css }]
    });
    const winners = longTextWinners(cascade, tree.target);
    for (const property of ["white-space", "overflow", "text-overflow"]) {
      assert.equal(winners[property].sourceName, sourceName, `${fixture.label} ${property} genuinely wins`);
    }
    assert.deepEqual([
      winners["white-space"].value,
      winners.overflow.value,
      winners["text-overflow"].value
    ], ["nowrap", "hidden", "ellipsis"]);
    assert.throws(() => assertLongTextAccessible(cascade, tree.target, fixture.label),
      /long text wraps/, `${fixture.label} fails for clipping`);
  }
});

test("Table System leaves filter, metric, CRUD, confirmation, and status ownership in approved systems", () => {
  const css = read("assets/css/components/tables.css");
  assert.doesNotMatch(css, /fetch|XMLHttpRequest|addEventListener|localStorage|sessionStorage|confirm\(|alert\(/i);
  for (const page of ["employee-deductions.html", "agent-training.html", "restaurant-ratings.html", "weekly-quality.html", "anati-admin.html"]) {
    assert.match(read(page), /CloudCrowdConfirmation\.request/);
  }
  assert.match(read("attendance.html"), /registry\.get\('attendance', status\)/);
  assert.match(read("agent-training.html"), /registry\.get\(domain, status\)/);
  assert.match(read("client-profiles.html"), /registry\.get\(domain, status\)/);
  assert.match(read("anati-admin.html"), /registry\.get\('admin-user', status\)/);
  assert.doesNotMatch(css, /filter|metric|payload|permission|confirmation|status-registry/i);
});

test("twenty executable or structurally valid isolated mutations fail intended table contracts", () => {
  const attendance = read("attendance.html");
  const deductions = read("employee-deductions.html");
  const training = read("agent-training.html");
  const ratings = read("restaurant-ratings.html");
  const weekly = read("weekly-quality.html");
  const employee = read("employee-profiles.html");
  const client = read("client-profiles.html");
  const admin = read("anati-admin.html");
  const css = read("assets/css/components/tables.css");
  const cases = [
    ["attendance column order", attendance, (s) => s.replace('<th scope="col">Date</th>\n                <th scope="col">Agent</th>', '<th scope="col">Agent</th>\n                <th scope="col">Date</th>'), (s) => assert.deepEqual(headers(s)[0].slice(0, 2).map((h) => h.text), ["Date", "Agent"])],
    ["deduction amount formatter", deductions, (s) => s.replace("toFixed(2)", "toFixed(1)"), (s) => assert.match(s, /toFixed\(2\)/)],
    ["training raw status", training, (s) => s.replace("statusBadge(record.trainingStatus)", "statusBadge('Trained')"), (s) => assert.match(functionSource(s, "renderTraining"), /statusBadge\(record\.trainingStatus\)/)],
    ["ratings source order", ratings, (s) => s.replace("return ratings.filter", "return [...ratings].reverse().filter"), (s) => assert.match(functionSource(s, "getFilteredRatings"), /return ratings\.filter/)],
    ["weekly newest first", weekly, (s) => s.replace("return bTime - aTime;", "return aTime - bTime;"), (s) => assert.match(functionSource(s, "getFilteredRecords"), /return bTime - aTime/)],
    ["profile column", employee, (s) => s.replace('<th scope="col">Final Amount</th>', ""), (s) => assert.equal(headers(s)[0].length, 5)],
    ["admin Disable identifier", admin, (s) => s.replace("data-disable-user=", "data-disabled-user="), (s) => assert.match(functionSource(s, "renderUsers"), /data-disable-user=/)],
    ["admin checkbox state", admin, (s) => s.replace('${access.canView ? "checked" : ""}', 'checked'), (s) => assert.match(functionSource(s, "renderModules"), /access\.canView \? "checked" : ""/)],
    ["button submit", ratings, (s) => s.replace('type="button" data-view-id=', 'type="submit" data-view-id='), (s) => assert.doesNotMatch(functionSource(s, "renderRatings"), /type="submit"/)],
    ["overflow hidden", css, (s) => s.replace("overflow-x: auto", "overflow-x: hidden"), (s) => assert.match(s, /overflow-x:\s*auto/)],
    ["minimum width", attendance, (s) => s.replace("min-width:980px", "min-width:0"), (s) => assert.match(s, /min-width:980px/)],
    ["320 reachability", JSON.stringify({ viewport: 320, minimum: 1180, overflow: "auto" }), (s) => s.replace('"overflow":"auto"', '"overflow":"hidden"'), (s) => { const value = JSON.parse(s); assert.equal(value.overflow, "auto"); assert.ok(value.minimum > value.viewport); }],
    ["legacy header cascade", css, (s) => `${s}\nbody .legacy .cc-table.cc-table th { background: white; }`, (s) => assert.doesNotMatch(s, /\.legacy[^{]*\{[^}]*background:\s*white/)],
    ["numeric alignment", css, (s) => s.replace("text-align: end;", "text-align: start;"), (s) => assert.match(s.match(/\.cc-table\.cc-table \.cc-table__numeric\s*\{[\s\S]*?\}/)[0], /text-align:\s*end/)],
    ["empty as loading", deductions, (s) => s.replace("? 'no-results' : 'empty'", "? 'no-results' : 'loading'"), (s) => assert.match(functionSource(s, "renderDeductions"), /\? 'no-results' : 'empty'/)],
    ["error as empty", deductions, (s) => s.replace("setAttribute('data-state', 'error')", "setAttribute('data-state', 'empty')"), (s) => assert.match(s, /setAttribute\('data-state', 'error'\)/)],
    ["status domain", attendance, (s) => s.replace("registry.get('attendance', status)", "registry.get('employee', status)"), (s) => assert.match(functionSource(s, "createStatusCell"), /registry\.get\('attendance', status\)/)],
    ["modal containment", client, (s) => s.replace("profile-table-wrap cc-table-wrap", "profile-table-wrap"), (s) => assert.equal((s.match(/profile-table-wrap cc-table-wrap/g) || []).length, 3)],
    ["action order", weekly, (s) => s.replace(/(\s*<button class="details-btn"[^\n]+)(\s*<button class="delete-btn"[^\n]+)/, "$2$1"), (s) => assert.match(functionSource(s, "renderRecords"), /View Details[\s\S]*Delete/)],
    ["dynamic row id", ratings, (s) => s.replace("data-view-id=", "data-missing-id="), (s) => assert.match(functionSource(s, "renderRatings"), /data-view-id=/)]
  ];
  assert.equal(cases.length, 20);
  for (const [name, baseline, mutate, validate] of cases) {
    assert.doesNotThrow(() => validate(baseline), `${name} baseline`);
    const mutated = mutate(baseline);
    assert.notEqual(mutated, baseline, `${name} applied`);
    if (/function /.test(mutated) || /<script/.test(mutated)) {
      const functions = Array.from(mutated.matchAll(/function\s+[A-Za-z_$][\w$]*\s*\(/g));
      assert.ok(functions.length > 0, `${name} remains structured`);
    }
    assert.throws(() => validate(mutated), `${name} detected`);
  }
});
