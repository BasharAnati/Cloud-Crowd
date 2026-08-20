"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createCascade, element, winnerDescription } = require("./css-cascade.js");

const root = path.resolve(__dirname, "..");
const viewports = [1440, 1280, 1024, 768, 390, 360, 320];
const pages = [
  "dashboard.html", "cctv.html", "ce.html", "complaints.html", "free-orders.html",
  "employee-profiles.html", "attendance.html", "employee-deductions.html",
  "agent-training.html", "restaurant-ratings.html", "weekly-quality.html",
  "client-profiles.html", "free-order-requests.html", "free-order-share.html",
  "anati-admin.html", "call-queue.html"
];
const standardPages = new Set([
  "dashboard.html", "attendance.html", "employee-deductions.html", "agent-training.html",
  "restaurant-ratings.html", "weekly-quality.html"
]);
const exceptionPages = new Set(pages.filter((page) => !standardPages.has(page)));
const titles = {
  "dashboard.html": "Operations Dashboard",
  "cctv.html": "CCTV Operations Center",
  "ce.html": "Customer Experience Operations Center",
  "complaints.html": "Daily Complaints Operations Center",
  "free-orders.html": "Complimentary Orders Operations Center",
  "employee-profiles.html": "Employee Profiles",
  "attendance.html": "Attendance & Shift Tracking",
  "employee-deductions.html": "Employee Deductions",
  "agent-training.html": "Agent Training",
  "restaurant-ratings.html": "Restaurant Ratings",
  "weekly-quality.html": "Weekly Quality Sheet",
  "client-profiles.html": "Client Profiles",
  "free-order-requests.html": "Free Order Requests",
  "free-order-share.html": "Free Order Share",
  "anati-admin.html": "Anati Admin Center",
  "call-queue.html": "Call Queue"
};
const preservedHeaderText = {
  "dashboard.html": ["Service Management Platform", "Operations Dashboard", "Monitor service workflows, document operational cases, and move quickly into the sections your team uses every day."],
  "cctv.html": ["CCTV Operations Center", "Monitor escalations, active reviews, policy observations, and closure progress across camera zones.", "Add New Ticket"],
  "ce.html": ["Customer Experience Operations Center", "Track customer feedback, order issues, callbacks, and resolution progress.", "Add New Ticket"],
  "complaints.html": ["Daily Complaints Operations Center", "Track complaint cases, responsible departments, customer impact, and resolution progress.", "Add New Ticket"],
  "free-orders.html": ["Complimentary Orders Operations Center", "Track complimentary orders, approvals, usage status, and case resolution progress.", "Add New Ticket"],
  "employee-profiles.html": ["People Operations", "Employee Profiles", "Maintain employee records, contact details, restaurant assignments, and operational history.", "+ Add Employee"],
  "attendance.html": ["HR Operations", "Attendance & Shift Tracking", "Track employee attendance, shift schedules, and extra hours.", "+ Add New Record"],
  "employee-deductions.html": ["People Operations", "Employee Deductions", "Track employee deductions, personal orders, discounts, and financial adjustments.", "+ New Deduction"],
  "agent-training.html": ["People Operations", "Agent Training", "Manage assignments, training progress, and coaching needs.", "+ New Training Assignment"],
  "restaurant-ratings.html": ["Client Profiles Module", "Restaurant Ratings", "Track weekly Talabat and Careem ratings across all active brands.", "+ Add Rating"],
  "weekly-quality.html": ["Weekly Quality Sheet", "Evaluate call quality consistently, review coaching opportunities, and keep weekly performance records clear and accessible.", "100", "Quality Points"],
  "client-profiles.html": ["Client Operations", "Client Profiles", "Manage restaurants, brands, ownership information and operational details.", "+ Add Client"],
  "free-order-requests.html": ["Free Order Workflow", "Free Order Requests", "Manage immediate free order compensation requests from entry to sharing readiness.", "Track immediate compensation orders through Pending Details, Ready to Share, and Done without touching the existing Complimentary Orders workflow.", "+ New Request"],
  "free-order-share.html": ["Free Order Workflow", "Free Order Share", "Review ready free order requests, request clarifications, and mark completed shares.", "Work from the same Free Order Requests records. Items completed here immediately become Done in the requests workflow.", "Requests"],
  "anati-admin.html": ["Administration", "Anati Admin Center", "Manage user accounts and enforced module access."],
  "call-queue.html": ["Call Operations", "Call Queue", "Dedicated customer follow-up workspace for moving calls from Need Call through In Call, Called, Pending, and Done."]
};
const headerSlots = {
  "dashboard.html": { context: true, descriptions: 1 },
  "cctv.html": { descriptions: 1, actions: true },
  "ce.html": { descriptions: 1, actions: true },
  "complaints.html": { descriptions: 1, actions: true },
  "free-orders.html": { descriptions: 1, actions: true },
  "employee-profiles.html": { context: true, descriptions: 1, actions: true },
  "attendance.html": { context: true, descriptions: 1, actions: true },
  "employee-deductions.html": { context: true, descriptions: 1, actions: true },
  "agent-training.html": { context: true, descriptions: 1, actions: true },
  "restaurant-ratings.html": { context: true, descriptions: 1, actions: true },
  "weekly-quality.html": { descriptions: 1, companion: true },
  "client-profiles.html": { context: true, descriptions: 1, actions: true },
  "free-order-requests.html": { context: true, descriptions: 2, actions: true },
  "free-order-share.html": { context: true, descriptions: 2, actions: true },
  "anati-admin.html": { context: true, descriptions: 1 },
  "call-queue.html": { context: true, descriptions: 1 }
};
const staticTitleInventory = [
  { page: "employee-deductions.html", id: "deduction-modal-title", role: "modal" },
  { page: "employee-deductions.html", id: "details-modal-title", role: "modal" },
  { page: "agent-training.html", id: "details-modal-title", role: "modal" },
  { page: "restaurant-ratings.html", id: "rating-modal-title", role: "modal" },
  { page: "restaurant-ratings.html", id: "details-modal-title", role: "modal" },
  { page: "client-profiles.html", id: "client-modal-title", role: "modal" },
  { page: "free-order-requests.html", id: "request-modal-title", role: "modal" },
  { page: "free-order-requests.html", id: "details-modal-title", role: "modal" },
  { page: "free-order-requests.html", id: "view-modal-title", role: "modal" },
  { page: "free-order-share.html", id: "response-modal-title", role: "modal" },
  { page: "free-order-share.html", id: "view-modal-title", role: "modal" },
  { page: "weekly-quality.html", id: "details-modal-title", role: "modal" },
  { page: "employee-profiles.html", id: "employee-modal-title", role: "modal" },
  ...["cctv.html", "ce.html", "complaints.html", "free-orders.html"].flatMap((page) => [
    { page, text: "Add New Ticket", parentClass: "cc-dialog__header", role: "operational modal" },
    { page, id: "drawer-title", role: "operational drawer" }
  ])
];
const operationalPages = ["cctv.html", "ce.html", "complaints.html", "free-orders.html"];

function html(page) { return fs.readFileSync(path.join(root, page), "utf8"); }
function parseDocument(source) {
  const documentNode = { tag: "#document", attributes: {}, children: [], parent: null };
  const stack = [documentNode];
  const voidElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const clean = source.replace(/<!--[^]*?-->/g, "").replace(/<(script|style)\b[^>]*>[^]*?<\/\1>/gi, "");
  for (const token of clean.match(/<[^>]+>|[^<]+/g) || []) {
    if (!token.startsWith("<")) {
      stack[stack.length - 1].children.push({ tag: "#text", text: token, parent: stack[stack.length - 1] });
      continue;
    }
    const close = token.match(/^<\/\s*([a-z][a-z0-9-]*)/i);
    if (close) {
      const tag = close[1].toLowerCase();
      while (stack.length > 1 && stack[stack.length - 1].tag !== tag) stack.pop();
      if (stack.length > 1) stack.pop();
      continue;
    }
    const open = token.match(/^<\s*([a-z][a-z0-9-]*)/i);
    if (!open || /^<!/.test(token)) continue;
    const tag = open[1].toLowerCase();
    const attributes = {};
    for (const match of token.matchAll(/([a-z_:][a-z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi)) {
      if (match[1].toLowerCase() !== tag) attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
    }
    const node = { tag, attributes, children: [], parent: stack[stack.length - 1] };
    stack[stack.length - 1].children.push(node);
    if (!voidElements.has(tag) && !/\/>$/.test(token)) stack.push(node);
  }
  return documentNode;
}
function descendants(node) { return node.children.flatMap((child) => child.tag === "#text" ? [] : [child, ...descendants(child)]); }
function hasClass(node, className) { return (node.attributes.class || "").split(/\s+/).includes(className); }
function nodeText(node) {
  return node.children.map((child) => child.tag === "#text" ? child.text : nodeText(child)).join(" ")
    .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
function headingList(source) {
  return descendants(parseDocument(source)).filter((node) => /^h[1-6]$/.test(node.tag))
    .map((node) => ({ level: Number(node.tag[1]), text: nodeText(node) }));
}
function cascadeElementFromDom(node, cache = new Map()) {
  if (!node || node.tag === "#document") return null;
  if (cache.has(node)) return cache.get(node);
  const target = element(node.tag, {
    id: node.attributes.id || "",
    classes: (node.attributes.class || "").split(/\s+/).filter(Boolean),
    attributes: node.attributes,
    inlineStyle: node.attributes.style || ""
  }, cascadeElementFromDom(node.parent, cache));
  cache.set(node, target);
  return target;
}

function actualTargetsByClass(page, className) {
  const nodes = descendants(parseDocument(html(page))).filter((node) => hasClass(node, className));
  const cache = new Map();
  return nodes.map((node) => cascadeElementFromDom(node, cache));
}

function actualTargetById(page, id) {
  const node = descendants(parseDocument(html(page))).find((candidate) => candidate.attributes.id === id);
  return node ? cascadeElementFromDom(node) : null;
}

function titleNodeFromSource(source, contract) {
  const nodes = descendants(parseDocument(source));
  if (contract.id) return nodes.find((node) => node.attributes.id === contract.id);
  return nodes.find((node) => nodeText(node) === contract.text && hasClass(node.parent, contract.parentClass));
}

function titleTarget(page, contract, source = html(page)) {
  const node = titleNodeFromSource(source, contract);
  return node ? cascadeElementFromDom(node) : null;
}

function actualBody(page) {
  const node = descendants(parseDocument(html(page))).find((candidate) => candidate.tag === "body");
  return node ? cascadeElementFromDom(node) : null;
}

function historyTitleTarget(page) {
  const body = actualBody(page);
  const modal = element("div", { classes: ["history-modal"] }, body);
  const panel = element("div", { classes: ["history-modal__panel"] }, modal);
  const header = element("div", { classes: ["history-modal__header"] }, panel);
  return element("h3", { classes: ["history-modal__title", "cc-modal-title"] }, header);
}

function actualTableWithinClass(page, wrapperClass) {
  const documentNode = parseDocument(html(page));
  const wrapper = descendants(documentNode).find((node) => hasClass(node, wrapperClass));
  const table = wrapper && descendants(wrapper).find((node) => node.tag === "table");
  return table ? cascadeElementFromDom(table) : null;
}

function actualPageTree(page) {
  const documentNode = parseDocument(html(page));
  const nodes = descendants(documentNode);
  const cache = new Map();
  const byClass = (className) => nodes.find((node) => hasClass(node, className));
  const allByClass = (className) => nodes.filter((node) => hasClass(node, className));
  const convert = (node) => node ? cascadeElementFromDom(node, cache) : null;
  return {
    documentNode,
    container: convert(byClass("cc-page-container")),
    header: convert(byClass("cc-page-header")),
    content: convert(byClass("cc-page-header-content")),
    title: convert(byClass("cc-page-header-title")),
    sectionTitle: convert(byClass("cc-section-title")),
    actions: convert(byClass("cc-page-header-actions")),
    companion: convert(byClass("cc-page-header-companion")),
    context: convert(byClass("cc-page-header-context")),
    descriptions: allByClass("cc-page-header-description").map(convert),
    modalTitles: allByClass("cc-modal-title").map(convert)
  };
}

function withTheme(target, theme) {
  let rootElement = target;
  while (rootElement.parent) rootElement = rootElement.parent;
  rootElement.attributes["data-theme"] = theme;
  return target;
}
function resolved(cascade, target, property) {
  assert.ok(target, `${cascade.page}: missing real production target for ${property}`);
  const result = cascade.winner(target, property);
  assert.ok(result, winnerDescription(cascade, property, property, result, "a winning declaration"));
  return cascade.resolveValue(target, result.value);
}

function expectContractFailure(label, callback) {
  assert.throws(callback, (error) => error?.code === "ERR_ASSERTION" && error.message.includes(label), `${label}: mutation must fail its named contract`);
}

test("all 16 internal documents use one shared Page Header, exactly one h1, and frozen content", () => {
  pages.forEach((page) => {
    const source = html(page);
    const tree = actualPageTree(page);
    const slots = headerSlots[page];
    const headings = headingList(source);
    assert.deepEqual(headings.filter(({ level }) => level === 1).map(({ text }) => text), [titles[page]], `${page}: one preserved h1`);
    const header = descendants(parseDocument(source)).find((node) => node.tag === "header" && hasClass(node, "cc-page-header"));
    assert.ok(header, `${page}: shared Page Header structure`);
    assert.ok(descendants(header).some((node) => hasClass(node, "cc-page-header-content")), `${page}: header content slot`);
    assert.ok(descendants(header).some((node) => node.tag === "h1" && hasClass(node, "cc-page-header-title")), `${page}: semantic title slot`);
    assert.equal(Boolean(tree.context), Boolean(slots.context), `${page}: context slot contract`);
    assert.equal(tree.descriptions.length, slots.descriptions, `${page}: description slot contract`);
    assert.equal(Boolean(tree.actions), Boolean(slots.actions), `${page}: actions slot contract`);
    assert.equal(Boolean(tree.companion), Boolean(slots.companion), `${page}: companion slot contract`);
    preservedHeaderText[page].forEach((value) => assert.ok(nodeText(header).includes(value), `${page}: preserve ${value}`));
  });
});

test("static major regions use h2 without a malformed page-title hierarchy jump", () => {
  const required = {
    "attendance.html": ["New Attendance Record", "Attendance Records"],
    "employee-deductions.html": ["Deduction Records"],
    "agent-training.html": ["New Training Assignment", "Training Status Guide", "Training Assignments"],
    "restaurant-ratings.html": ["Rating Records"],
    "client-profiles.html": ["Client Directory"],
    "anati-admin.html": ["User Management", "Create User Profile", "Module Access", "Workflow Permissions", "Maintenance Control", "Audit Logs"]
  };
  Object.entries(required).forEach(([page, labels]) => {
    const headings = headingList(html(page));
    labels.forEach((label) => assert.ok(headings.some((heading) => heading.level === 2 && heading.text === label), `${page}: ${label} is h2`));
  });
});

test("real production cascade winners enforce titles, gutters, rhythm, widths, and wrapping", () => {
  pages.forEach((page) => viewports.forEach((viewportWidth) => {
    const cascade = createCascade(root, page, { viewportWidth });
    const tree = actualPageTree(page);
    assert.equal(resolved(cascade, tree.title, "font-size"), "28px", `${page}@${viewportWidth}: title size`);
    assert.equal(resolved(cascade, tree.title, "font-weight"), "700", `${page}@${viewportWidth}: title weight`);
    assert.equal(resolved(cascade, tree.title, "line-height"), "1.25", `${page}@${viewportWidth}: title line height`);
    if (tree.sectionTitle) {
      assert.equal(resolved(cascade, tree.sectionTitle, "font-size"), "22px", `${page}@${viewportWidth}: section size`);
      assert.equal(resolved(cascade, tree.sectionTitle, "font-weight"), "700", `${page}@${viewportWidth}: section weight`);
      assert.equal(resolved(cascade, tree.sectionTitle, "line-height"), "1.3", `${page}@${viewportWidth}: section line height`);
    }
    assert.equal(resolved(cascade, tree.header, "margin-bottom"), viewportWidth <= 620 ? "24px" : "32px", `${page}@${viewportWidth}: header rhythm`);
    const expectedGutter = viewportWidth <= 620 ? "12px" : viewportWidth <= 1024 ? "16px" : "24px";
    assert.equal(resolved(cascade, tree.container, "padding-left"), expectedGutter, `${page}@${viewportWidth}: left gutter`);
    assert.equal(resolved(cascade, tree.container, "padding-right"), expectedGutter, `${page}@${viewportWidth}: right gutter`);
    assert.equal(resolved(cascade, tree.container, "min-width"), "0", `${page}@${viewportWidth}: shrinkable`);
    assert.equal(resolved(cascade, tree.header, "flex-wrap"), "wrap", `${page}@${viewportWidth}: header wraps`);
    if (tree.actions) assert.equal(resolved(cascade, tree.actions, "flex-wrap"), "wrap", `${page}@${viewportWidth}: actions wrap`);
    assert.equal(resolved(cascade, tree.container, "max-width"), standardPages.has(page) ? "1440px" : "none", `${page}@${viewportWidth}: registered width`);
  }));
});

test("workflow, Admin, and Call Queue real containers remain effectively full width", () => {
  ["free-order-requests.html", "free-order-share.html", "anati-admin.html", "call-queue.html"].forEach((page) => {
    viewports.forEach((viewportWidth) => {
      const cascade = createCascade(root, page, { viewportWidth });
      const container = actualPageTree(page).container;
      assert.equal(resolved(cascade, container, "width"), "100%", `${page}@${viewportWidth}: effective workspace width`);
      assert.equal(resolved(cascade, container, "max-width"), "none", `${page}@${viewportWidth}: effective workspace max width`);
      assert.equal(resolved(cascade, container, "min-width"), "0", `${page}@${viewportWidth}: effective workspace shrinkability`);
    });
  });
});

test("the complete static modal and drawer title inventory is frozen in Light and Dark", () => {
  assert.equal(staticTitleInventory.length, 21, "static title inventory count");
  const inventoryPages = [...new Set(staticTitleInventory.map(({ page }) => page))];
  inventoryPages.forEach((page) => {
    const expectedCount = staticTitleInventory.filter((contract) => contract.page === page).length;
    const actualCount = descendants(parseDocument(html(page))).filter((node) => hasClass(node, "cc-modal-title")).length;
    assert.equal(actualCount, expectedCount, `${page}: exact semantic title inventory count`);
  });
  staticTitleInventory.forEach((contract) => ["light", "dark"].forEach((theme) => {
    const label = `${contract.page} ${contract.id || contract.text} ${contract.role}`;
    const target = titleTarget(contract.page, contract);
    assert.ok(target, `${label}: expected title exists`);
    assert.ok(target.classes.has("cc-modal-title"), `${label}: semantic title role exists`);
    withTheme(target, theme);
    const cascade = createCascade(root, contract.page, { viewportWidth: 1440 });
    assert.equal(resolved(cascade, target, "font-size"), "18px", `${label} ${theme}: title size`);
    assert.equal(resolved(cascade, target, "font-weight"), "600", `${label} ${theme}: title weight`);
    assert.equal(resolved(cascade, target, "line-height"), "1.35", `${label} ${theme}: title line height`);
  }));
});

test("the shared Change History renderer has one semantic title contract across all operational pages", () => {
  const historySource = fs.readFileSync(path.join(root, "js", "history.js"), "utf8");
  const titleMarkup = [...historySource.matchAll(/<h3\b([^>]*)>Change History<\/h3>/g)];
  assert.equal(titleMarkup.length, 1, "Change History renderer title count");
  assert.match(titleMarkup[0][1], /class=["'][^"']*\bhistory-modal__title\b[^"']*\bcc-modal-title\b[^"']*["']/, "Change History renderer semantic title classes");
  operationalPages.forEach((page) => {
    assert.equal((html(page).match(/<script\b[^>]*src=["']js\/history\.js["'][^>]*>/g) || []).length, 1, `${page}: one shared Change History renderer`);
    ["light", "dark"].forEach((theme) => {
      const target = historyTitleTarget(page);
      withTheme(target, theme);
      const cascade = createCascade(root, page, { viewportWidth: 1440 });
      assert.equal(resolved(cascade, target, "font-size"), "18px", `${page} ${theme}: Change History title size`);
      assert.equal(resolved(cascade, target, "font-weight"), "600", `${page} ${theme}: Change History title weight`);
      assert.equal(resolved(cascade, target, "line-height"), "1.35", `${page} ${theme}: Change History title line height`);
    });
  });
});

test("representative dynamic renderers preserve the remediated heading hierarchy", () => {
  assert.match(html("employee-profiles.html"), /workspace-profile-header[\s\S]*?<h2 class="cc-section-title">\$\{escapeHtml\(employee\.fullName\)\}<\/h2>/, "Employee Profiles renderer uses an h2 profile heading");
  assert.match(html("employee-profiles.html"), /workspace-card-heading[\s\S]*?<h3>Overview<\/h3>/, "Employee Profiles renderer uses h3 card headings");
  assert.match(html("free-order-requests.html"), /<h2 class="cc-section-title cc-kanban__title">\$\{escapeHtml\(column\.label\)\}<\/h2>/, "Requests renderer uses h2 stage headings");
  assert.match(html("free-order-requests.html"), /<h3>\$\{escapeHtml\(request\.orderNumber\)\}<\/h3>/, "Requests renderer uses h3 card headings");
  assert.match(html("free-order-share.html"), /<h2 class="cc-section-title cc-kanban__title">\$\{escapeHtml\(column\.label\)\}<\/h2>/, "Share renderer uses h2 column headings");
  assert.match(html("call-queue.html"), /<h2 class="cc-section-title">\$\{escapeHtml\(ticket\.customerName\)\}<\/h2>/, "Call Queue renderer uses an h2 customer heading");
  assert.match(html("call-queue.html"), /<h3>Latest Note<\/h3>[\s\S]*?<h3>Call Actions<\/h3>/, "Call Queue renderer uses h3 subheadings");
});

test("cascade evaluator resolves the Sprint 1.4 box shorthand and logical longhands", () => {
  const css = `.cctv-page.cctv-ops-center .cctv-workspace {
    padding: 1px 2px 3px 4px;
    padding-inline: 5px 6px;
    padding-inline-start: 7px;
    margin: 8px 9px 10px;
    margin-block: 11px 12px;
    margin-block-end: 13px;
  }`;
  const cascade = createCascade(root, "cctv.html", { viewportWidth: 1440, extraSources: [{ name: "box-model-contract.css", css }] });
  const tree = actualPageTree("cctv.html");
  assert.equal(resolved(cascade, tree.container, "padding-left"), "7px", "padding-inline-start overrides padding-inline and padding");
  assert.equal(resolved(cascade, tree.container, "padding-right"), "6px", "padding-inline-end resolves from two-value padding-inline");
  assert.equal(resolved(cascade, tree.container, "padding-inline-start"), "7px", "logical padding start resolves directly");
  assert.equal(resolved(cascade, tree.container, "padding-inline-end"), "6px", "logical padding end resolves directly");
  assert.equal(resolved(cascade, tree.header, "margin-bottom"), "32px", "unrelated container margin does not affect header rhythm");
  assert.equal(resolved(cascade, tree.container, "margin-bottom"), "13px", "margin-block-end overrides margin-block and margin");
  assert.equal(resolved(cascade, tree.container, "margin-block-end"), "13px", "logical margin block end resolves directly");
});

test("wide child contracts retain their minimum widths and reachable overflow", () => {
  const contracts = {
    "attendance.html": ["records-table", "980px"],
    "employee-deductions.html": ["records-table", "1180px"],
    "agent-training.html": ["records-table", "1120px"],
    "restaurant-ratings.html": ["records-table", "1080px"],
    "weekly-quality.html": [null, "980px"],
    "client-profiles.html": ["profile-table", "680px"],
    "anati-admin.html": ["access-table", "760px"]
  };
  Object.entries(contracts).forEach(([page, [tableClass, width]]) => viewports.forEach((viewportWidth) => {
    const cascade = createCascade(root, page, { viewportWidth });
    const container = actualPageTree(page).container;
    let wrap = actualTargetsByClass(page, tableClass === "profile-table" ? "profile-table-wrap" : "table-wrap")[0];
    let table = tableClass ? actualTargetsByClass(page, tableClass)[0] : actualTableWithinClass(page, "table-wrap");
    if (page === "client-profiles.html") {
      const workspace = actualTargetById(page, "client-workspace");
      wrap = element("div", { classes: ["profile-table-wrap"] }, workspace);
      table = element("table", { classes: ["profile-table"] }, wrap);
    }
    assert.equal(resolved(cascade, table, "min-width"), width, `${page}@${viewportWidth}: table width`);
    assert.match(resolved(cascade, wrap, "overflow-x"), /^(auto|scroll)$/, `${page}@${viewportWidth}: horizontal access`);
    assert.notEqual(resolved(cascade, container, "overflow-x"), "hidden", `${page}@${viewportWidth}: ancestor access`);
  }));
});

test("isolated negative fixtures detect all nine material regression classes", () => {
  const dashboard = html("dashboard.html");
  expectContractFailure("second h1 contract", () => {
    assert.equal(headingList(dashboard.replace("</main>", "<h1>Unexpected</h1></main>")).filter((h) => h.level === 1).length, 1, "second h1 contract");
  });
  const malformedHierarchy = html("attendance.html")
    .replace(/<h2\b([^>]*id="records-title"[^>]*)>/, "<h3$1>")
    .replace("Attendance Records</h2>", "Attendance Records</h3>");
  expectContractFailure("major heading hierarchy contract", () => {
    assert.ok(headingList(malformedHierarchy).some((h) => h.level === 2 && h.text === "Attendance Records"), "major heading hierarchy contract");
  });

  const mutations = [
    ["wrong title size contract", "dashboard.html", 1440, ".dashboard-page .cc-page-header-title{font-size:31px}", "title", "font-size", "28px"],
    ["wrong mobile gutter contract", "attendance.html", 390, ".attendance-page .cc-page-container{padding:20px}", "container", "padding-left", "12px"],
    ["standard width contract", "dashboard.html", 1440, ".dashboard-page .cc-page-container{max-width:none}", "container", "max-width", "1440px"],
    ["workspace max width contract", "call-queue.html", 1440, ".call-queue-page .cc-page-container{max-width:1440px}", "container", "max-width", "none"],
    ["horizontal overflow contract", "attendance.html", 390, ".attendance-page .cc-page-container{overflow-x:hidden}", "container", "overflow-x", "visible"],
    ["header action wrapping contract", "attendance.html", 390, ".attendance-page .cc-page-header-actions{flex-wrap:nowrap}", "actions", "flex-wrap", "wrap"],
    ["shared main shrinkability contract", "employee-profiles.html", 768, ".employee-profiles-ops-center .cc-page-container{min-width:auto}", "container", "min-width", "0"]
  ];
  mutations.forEach(([label, page, viewportWidth, css, target, property, expected], index) => {
    const cascade = createCascade(root, page, { viewportWidth, extraSources: [{ name: `negative-${index}.css`, css }] });
    expectContractFailure(label, () => {
      assert.equal(resolved(cascade, actualPageTree(page)[target], property), expected, label);
    });
  });
});

test("in-memory remediation mutations expose the original production false-positive paths", () => {
  const mutations = [
    ["operational desktop legacy gutter", "cctv.html", 1440, ".cctv-ops-center .cctv-workspace{padding:0 18px 24px}", "container", "padding-left", "24px"],
    ["operational tablet legacy gutter", "cctv.html", 768, ".cctv-ops-center .cctv-workspace{padding:0 14px 24px}", "container", "padding-left", "16px"],
    ["operational mobile legacy gutter", "cctv.html", 390, ".cctv-ops-center .cctv-workspace{padding:0 14px 24px}", "container", "padding-left", "12px"],
    ["Employee Profiles clamp gutter", "employee-profiles.html", 1440, ".employee-profiles-ops-center .main-area{padding:24px clamp(18px,3vw,38px) 42px}", "container", "padding-left", "24px"],
    ["operational legacy header rhythm", "cctv.html", 1440, ".cctv-ops-center .cctv-hero{margin:14px 0 12px}", "header", "margin-bottom", "32px"],
    ["operational mobile legacy header rhythm", "cctv.html", 390, ".cctv-ops-center .cctv-hero{margin:14px 0 12px}", "header", "margin-bottom", "24px"],
    ["Employee Profiles legacy header rhythm", "employee-profiles.html", 1440, ".employee-profiles-ops-center .hero{margin-bottom:16px}", "header", "margin-bottom", "32px"],
    ["workspace effective width cap", "free-order-requests.html", 1440, ".workflow-page .workflow-container{max-width:none;width:min(1440px,100%)}", "container", "width", "100%"],
    ["modal title legacy size", "employee-deductions.html", 1440, ".people-management-page .modal-header .cc-modal-title{font-size:24px}", "modalTitles.0", "font-size", "18px"],
    ["modal title legacy weight", "employee-deductions.html", 1440, ".people-management-page .modal-header .cc-modal-title{font-weight:950}", "modalTitles.0", "font-weight", "600"],
    ["modal title legacy line height", "free-order-requests.html", 1440, ".workflow-page .modal-header .cc-modal-title{line-height:1.15}", "modalTitles.0", "line-height", "1.35"],
    ["higher-specificity shorthand gutter", "cctv.html", 1024, ".cctv-page.cctv-ops-center .cctv-workspace{padding:0 14px 24px}", "container", "padding-inline-start", "16px"]
  ];
  mutations.forEach(([label, page, viewportWidth, css, targetPath, property, expected], index) => {
    const cascade = createCascade(root, page, { viewportWidth, extraSources: [{ name: `remediation-negative-${index}.css`, css }] });
    const tree = actualPageTree(page);
    const target = targetPath === "modalTitles.0" ? tree.modalTitles[0] : tree[targetPath];
    expectContractFailure(label, () => assert.equal(resolved(cascade, target, property), expected, label));
  });
});

test("missing title-role fixtures detect one removed role without relying on inventory discovery", () => {
  const cases = [
    {
      label: "operational Add Ticket semantic role",
      page: "cctv.html",
      contract: staticTitleInventory.find((item) => item.page === "cctv.html" && item.text === "Add New Ticket"),
      mutate: (source) => source.replace('<h2 class="cc-modal-title cc-dialog__title" id="operations-modal-title">Add New Ticket</h2>', '<h2 id="operations-modal-title">Add New Ticket</h2>')
    },
    {
      label: "operational Details drawer semantic role",
      page: "cctv.html",
      contract: staticTitleInventory.find((item) => item.page === "cctv.html" && item.id === "drawer-title"),
      mutate: (source) => source.replace('<h2 class="cc-modal-title" id="drawer-title">Details</h2>', '<h2 id="drawer-title">Details</h2>')
    },
    {
      label: "one-of-many modal semantic role",
      page: "employee-deductions.html",
      contract: staticTitleInventory.find((item) => item.page === "employee-deductions.html" && item.id === "details-modal-title"),
      mutate: (source) => source.replace('<h3 class="cc-modal-title" id="details-modal-title">Deduction Details</h3>', '<h3 id="details-modal-title">Deduction Details</h3>')
    }
  ];
  cases.forEach(({ label, page, contract, mutate }) => {
    const source = html(page);
    const mutated = mutate(source);
    assert.notEqual(mutated, source, `${label}: fixture mutation applied`);
    expectContractFailure(label, () => {
      const target = titleTarget(page, contract, mutated);
      assert.ok(target, `${label}: expected title remains parseable`);
      assert.ok(target.classes.has("cc-modal-title"), label);
    });
  });

  const historySource = fs.readFileSync(path.join(root, "js", "history.js"), "utf8");
  const mutatedHistory = historySource.replace('class="history-modal__title cc-modal-title cc-dialog__title"', 'class="history-modal__title cc-dialog__title"');
  assert.notEqual(mutatedHistory, historySource, "Change History semantic role: fixture mutation applied");
  expectContractFailure("Change History semantic role", () => {
    assert.match(mutatedHistory, /<h3\b[^>]*class=["'][^"']*\bcc-modal-title\b[^"']*["'][^>]*>Change History<\/h3>/, "Change History semantic role");
  });
});

test("operational title typography fixtures reject restored legacy winners", () => {
  const cases = [
    {
      label: "operational Add Ticket legacy size",
      page: "cctv.html",
      target: () => titleTarget("cctv.html", staticTitleInventory.find((item) => item.page === "cctv.html" && item.text === "Add New Ticket")),
      css: ".cctv-page.cctv-ops-center .modal-content .cc-modal-title{font-size:22px}",
      property: "font-size",
      expected: "18px"
    },
    {
      label: "operational Details drawer legacy weight",
      page: "cctv.html",
      target: () => titleTarget("cctv.html", staticTitleInventory.find((item) => item.page === "cctv.html" && item.id === "drawer-title")),
      css: ".cctv-page.cctv-ops-center .drawer-header .cc-modal-title{font-weight:800}",
      property: "font-weight",
      expected: "600"
    },
    {
      label: "Change History legacy line height",
      page: "cctv.html",
      target: () => historyTitleTarget("cctv.html"),
      css: ".cctv-page.cctv-ops-center .history-modal__header .cc-modal-title{line-height:normal}",
      property: "line-height",
      expected: "1.35"
    }
  ];
  cases.forEach(({ label, page, target, css, property, expected }, index) => {
    const cascade = createCascade(root, page, { viewportWidth: 1440, extraSources: [{ name: `title-inventory-negative-${index}.css`, css }] });
    expectContractFailure(label, () => assert.equal(resolved(cascade, target(), property), expected, label));
  });
});

test("inventory, protected scope, and explicit exception registry remain closed", () => {
  assert.equal(pages.length, 16);
  assert.equal(exceptionPages.size, 10);
  pages.forEach((page) => assert.match(html(page), /assets\/css\/layouts\/page-layout\.css/));
  ["index.html", "login.html", "system-update.html"].forEach((page) => assert.doesNotMatch(html(page), /page-layout\.css/));
});
