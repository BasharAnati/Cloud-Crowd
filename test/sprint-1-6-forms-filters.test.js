"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createCascade, element } = require("./css-cascade.js");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const FORM_PAGES = [
  "cctv.html", "ce.html", "complaints.html", "free-orders.html", "attendance.html",
  "employee-deductions.html", "agent-training.html", "restaurant-ratings.html", "weekly-quality.html",
  "employee-profiles.html", "client-profiles.html", "free-order-requests.html", "free-order-share.html",
  "anati-admin.html", "call-queue.html"
];
const FILTER_PAGES = FORM_PAGES.filter((page) => !["anati-admin.html", "call-queue.html"].includes(page));

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

function bodyClasses(page) {
  return read(page).match(/<body\b[^>]*class="([^"]*)"/i)?.[1].split(/\s+/).filter(Boolean) || [];
}

function formControl(page, theme = "light", options = {}) {
  const html = element("html", { attributes: { "data-theme": theme } });
  const body = element("body", { classes: bodyClasses(page) }, html);
  const form = element("form", { classes: ["cc-form", ...(options.large ? ["cc-form--lg"] : [])] }, body);
  const field = element("div", { classes: ["field", "cc-field"] }, form);
  const control = element(options.tag || "input", {
    classes: options.classes || ["control", "cc-control"],
    attributes: options.attributes || { type: "text" },
    states: options.states || []
  }, field);
  return { cascade: createCascade(ROOT, page, { viewportWidth: options.viewportWidth || 1440 }), control };
}

function resolved(cascade, target, property) {
  const winner = cascade.winner(target, property);
  assert.ok(winner, `${cascade.page} ${property} winner`);
  return cascade.resolveValue(target, winner.value);
}

class TestClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    if (force !== undefined) {
      if (force) this.values.add(value);
      else this.values.delete(value);
      return force;
    }
    if (this.values.has(value)) {
      this.values.delete(value);
      return false;
    }
    this.values.add(value);
    return true;
  }
}

class TestDomElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.classList = new TestClassList();
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = new Map();
    this.id = "";
    this.name = "";
    this.type = "";
    this.value = "";
    this.checked = false;
    this.hidden = false;
    this._textContent = "";
    this._innerHTML = "";
  }

  set className(value) {
    this.classList = new TestClassList();
    String(value).split(/\s+/).filter(Boolean).forEach((item) => this.classList.add(item));
  }
  get className() { return [...this.classList.values].join(" "); }
  set textContent(value) {
    this._textContent = String(value);
    this._innerHTML = "";
    this.children = [];
  }
  get textContent() { return this._textContent + this.children.map((child) => child.textContent).join(""); }
  set innerHTML(value) {
    this._innerHTML = String(value);
    if (value === "") {
      this._textContent = "";
      this.children = [];
    }
  }
  get innerHTML() { return this.children.length ? "[children]" : this._innerHTML; }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "id") this.id = String(value);
  }
  getAttribute(name) {
    if (name === "id") return this.id || null;
    return this.attributes[name] ?? null;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type, event = {}) {
    const completeEvent = {
      target: this,
      preventDefault() {},
      stopPropagation() {},
      ...event
    };
    (this.listeners.get(type) || []).forEach((listener) => listener(completeEvent));
  }
  contains(target) {
    for (let current = target; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelectorAll(selector) {
    const descendants = this.descendants();
    if (selector === "input") return descendants.filter((item) => item.tagName === "INPUT");
    if (selector === "input:checked") return descendants.filter((item) => item.tagName === "INPUT" && item.checked);
    if (selector.startsWith(".")) return descendants.filter((item) => item.classList.contains(selector.slice(1)));
    return [];
  }
  querySelector(selector) {
    if (selector === "h2") return this.descendants().find((item) => item.tagName === "H2") || null;
    if (selector === '[name="ticketIndex"]') return this.descendants().find((item) => item.name === "ticketIndex") || null;
    return this.querySelectorAll(selector)[0] || null;
  }
  reset() { this.resetCount = (this.resetCount || 0) + 1; }
}

class TestDocument {
  constructor() {
    this.roots = [];
    this.listeners = new Map();
  }
  createElement(tagName) { return new TestDomElement(tagName, this); }
  createTextNode(value) {
    const node = new TestDomElement("#text", this);
    node.textContent = value;
    return node;
  }
  allElements() { return this.roots.flatMap((root) => [root, ...root.descendants()]); }
  getElementById(id) { return this.allElements().find((item) => item.id === id) || null; }
  querySelectorAll(selector) {
    if (!selector.startsWith(".")) return [];
    return this.allElements().filter((item) => item.classList.contains(selector.slice(1)));
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type, target) { (this.listeners.get(type) || []).forEach((listener) => listener({ target })); }
}

function createOperationsRenderer(mainSource = read("main.js")) {
  const document = new TestDocument();
  const modal = document.createElement("div");
  modal.id = "modal";
  const title = document.createElement("h2");
  modal.appendChild(title);
  const form = document.createElement("form");
  form.id = "ticket-form";
  const dynamicForm = document.createElement("div");
  dynamicForm.id = "dynamic-form";
  form.appendChild(dynamicForm);
  modal.appendChild(form);
  document.roots.push(modal);

  const configContext = { TICKET_DOMAIN_CONFIG: require("../shared/ticket-domain-config") };
  configContext.window = configContext;
  vm.runInNewContext(read("js/config.js"), configContext);
  const sectionDeclaration = mainSource.slice(mainSource.indexOf("const OPERATION_FORM_SECTIONS"), mainSource.indexOf("function operationControlId"));
  const context = {
    document,
    formFields: configContext.formFields,
    requireMutationPermission: () => true,
    CURRENT_USER: "review-user",
    FileReader: class FileReader {}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(`
    let _currentSection = '';
    Object.defineProperty(window, 'currentSection', { get() { return _currentSection; }, set(value) { _currentSection = value; } });
    ${sectionDeclaration}
    ${functionSource(mainSource, "operationControlId")}
    ${functionSource(mainSource, "openModal")}
    ${functionSource(mainSource, "updateSelected")}
    ${functionSource(mainSource, "closeModal")}
    this.renderer = { openModal, closeModal };
  `, context);
  return { context, document, dynamicForm, form };
}

function assertOperationsRender(renderer, section, renderNumber) {
  renderer.context.renderer.openModal(section);
  const elements = renderer.dynamicForm.descendants();
  const ids = elements.map((item) => item.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, `${section} render ${renderNumber} unique IDs`);

  for (const label of elements.filter((item) => item.tagName === "LABEL" && item.htmlFor)) {
    assert.ok(renderer.document.getElementById(label.htmlFor), `${section} render ${renderNumber} label target ${label.htmlFor}`);
  }
  for (const item of elements.filter((element) => element.getAttribute("aria-labelledby"))) {
    assert.ok(renderer.document.getElementById(item.getAttribute("aria-labelledby")), `${section} render ${renderNumber} aria-labelledby`);
  }
  for (const item of elements.filter((element) => element.getAttribute("aria-controls"))) {
    assert.ok(renderer.document.getElementById(item.getAttribute("aria-controls")), `${section} render ${renderNumber} aria-controls`);
  }
  for (const button of elements.filter((item) => item.tagName === "BUTTON")) {
    assert.equal(button.descendants().some((item) => item.tagName === "BUTTON"), false, `${section} render ${renderNumber} nested button`);
  }

  for (const multi of elements.filter((item) => item.classList.contains("multi-select"))) {
    const trigger = multi.querySelector(".cc-multi-select__trigger");
    const values = multi.querySelector(".cc-multi-select__values");
    const dropdown = multi.querySelector(".dropdown");
    assert.ok(trigger && values && dropdown, `${section} render ${renderNumber} multi-select structure`);
    assert.equal(trigger.tagName, "BUTTON");
    assert.equal(trigger.type, "button");
    assert.equal(trigger.getAttribute("aria-controls"), dropdown.id);
    const fieldLabel = elements.find((item) => item.tagName === "LABEL" && item.htmlFor === trigger.id);
    assert.ok(fieldLabel, `${section} render ${renderNumber} label points to trigger`);
    dropdown.children.forEach((label) => {
      assert.ok(label.htmlFor, `${section} render ${renderNumber} option label target`);
      const checkbox = renderer.document.getElementById(label.htmlFor);
      assert.ok(checkbox && checkbox.tagName === "INPUT" && checkbox.type === "checkbox");
    });

    trigger.dispatch("click");
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    const checkbox = multi.querySelectorAll("input")[0];
    checkbox.checked = true;
    checkbox.dispatch("change");
    assert.deepEqual(multi.querySelectorAll("input:checked").map((item) => item.value), [checkbox.value]);
    const removal = values.descendants().find((item) => item.classList.contains("cc-multi-select__remove"));
    assert.ok(removal, `${section} render ${renderNumber} removal exists`);
    assert.equal(removal.type, "button");
    assert.match(removal.getAttribute("aria-label"), /^Remove /);
    assert.equal(trigger.contains(removal), false, `${section} render ${renderNumber} removal outside trigger`);
    removal.dispatch("click");
    assert.equal(checkbox.checked, false);
    assert.deepEqual(multi.querySelectorAll("input:checked"), []);
    renderer.document.dispatch("click", renderer.document.createElement("div"));
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
  }
}

const REQUIRED_CONTROL_INVENTORY = {
  "attendance.html": { "attendance-form": ["agent", "record-date"] },
  "employee-deductions.html": { "deduction-form": ["employee-id", "deduction-type", "original-amount"] },
  "agent-training.html": { "training-form": ["employee-id", "restaurant-id", "assignment-status", "training-status"] },
  "restaurant-ratings.html": { "rating-form": ["restaurant-id", "platform", "month-name", "week-name", "rating", "reviews-count", "rating-date"] },
  "weekly-quality.html": { "quality-form": ["call-date-time", "auditor-name", "agent-name", "campaign", "phone-number"] },
  "employee-profiles.html": { "employee-form": ["full-name"] },
  "client-profiles.html": { "client-form": ["brand-name", "status"] },
  "free-order-requests.html": {
    "request-form": ["order-number", "customer-name", "creation-time", "discount-amount", "reason-for-discount"],
    "details-form": ["decision-maker", "deduction-from", "case-description"]
  },
  "free-order-share.html": { "response-form": ["share-note"] },
  "anati-admin.html": { "user-form": ["username"] }
};

function requiredControlInventory(source) {
  const inventory = {};
  for (const form of source.matchAll(/<form\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/form>/gi)) {
    inventory[form[1]] = [...form[2].matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"[^>]*\brequired\b[^>]*>/gi)]
      .map((match) => match[1]);
  }
  return inventory;
}

function assertDenseFilterReachable(cascade, filterGrid, width) {
  const columns = resolved(cascade, filterGrid, "grid-template-columns");
  assert.equal(columns, width <= 360 ? "1fr" : "minmax(0, 1fr) auto", `dense mobile search/disclosure columns at ${width}`);
  const overflow = cascade.winner(filterGrid, "overflow")?.value || "visible";
  const maxHeight = cascade.winner(filterGrid, "max-height")?.value || "none";
  assert.doesNotMatch(overflow, /hidden|clip/, `dense filter overflow at ${width}`);
  if (/^[0-9.]+px$/.test(maxHeight)) {
    const requiredHeight = (4 * 44) + (3 * 10);
    assert.ok(Number.parseFloat(maxHeight) >= requiredHeight, `dense filter max-height at ${width}`);
  }
}

function assertDynamicRowReachable(cascade, row, kind, width) {
  const columns = resolved(cascade, row, "grid-template-columns");
  const expected = kind === "restaurant" ? "1fr auto" : "1fr";
  assert.equal(columns, expected, `${kind} row columns at ${width}`);
  const availableWidth = width - 56;
  const minimumWidth = columns === "1fr auto" ? 36 + 10 : 0;
  assert.ok(minimumWidth <= availableWidth, `${kind} row containment at ${width}`);
}

test("all consuming pages load one deterministic shared form/filter foundation", () => {
  for (const page of FORM_PAGES) {
    const source = read(page);
    assert.match(source, /assets\/css\/components\/forms\.css/, page);
    const feedback = source.indexOf("assets/css/components/feedback.css");
    const forms = source.indexOf("assets/css/components/forms.css");
    assert.ok(forms > feedback, `${page} forms load after feedback/legacy compatibility`);
  }
  for (const page of FILTER_PAGES) {
    const source = read(page);
    assert.match(source, /assets\/css\/components\/filters\.css/, page);
    assert.ok(source.indexOf("assets/css/components/filters.css") > source.indexOf("assets/css/components/forms.css"), `${page} filter order`);
    assert.match(source, /cc-filter-bar--(?:compact|inline|dense|dense-six)/, `${page} variant`);
  }
  assert.doesNotMatch(read("dashboard.html"), /components\/(?:forms|filters)\.css/);
});

test("shared fields use only semantic tokens and the documented size/state contract", () => {
  const tokens = read("assets/css/design-tokens.css");
  const forms = read("assets/css/components/forms.css");
  const filters = read("assets/css/components/filters.css");
  assert.match(tokens, /--input-height:\s*40px/);
  assert.match(tokens, /--input-height-lg:\s*48px/);
  assert.match(forms, /min-height:\s*96px/);
  assert.match(forms, /border-radius:\s*var\(--input-radius\)/);
  for (const css of [forms, filters]) {
    assert.doesNotMatch(css, /!important/);
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i, "shared Sprint 1.6 CSS adds no palette values");
    const numericWeights = [...css.matchAll(/font-weight\s*:\s*(\d+)/gi)].map((match) => Number(match[1]));
    assert.ok(numericWeights.every((weight) => weight <= 700), `shared font weights stay within architecture: ${numericWeights.join(", ")}`);
  }
  for (const contract of ["hover", "focus-visible", "disabled", "aria-invalid", "cc-dependent-field"]) assert.ok(forms.includes(contract), contract);
  assert.doesNotMatch(forms, /cc-field--(?:filled|valid|success|warning|loading)/);
});

test("actual linked cascade wins legacy field surfaces in Light/Dark and preserves the 48px exception", () => {
  for (const page of ["cctv.html", "employee-deductions.html", "weekly-quality.html", "employee-profiles.html", "anati-admin.html", "call-queue.html"]) {
    for (const theme of ["light", "dark"]) {
      const { cascade, control } = formControl(page, theme);
      assert.equal(resolved(cascade, control, "min-height"), "40px", `${page} ${theme} default height`);
      assert.equal(resolved(cascade, control, "border-radius"), "10px", `${page} ${theme} radius`);
      assert.ok(resolved(cascade, control, "background").length > 0);
      assert.ok(resolved(cascade, control, "color").length > 0);
      assert.ok(resolved(cascade, control, "border-color").length > 0);
    }
  }
  for (const theme of ["light", "dark"]) {
    const { cascade, control } = formControl("attendance.html", theme, { large: true });
    assert.equal(resolved(cascade, control, "min-height"), "48px");
  }
  for (const theme of ["light", "dark"]) {
    const html = element("html", { attributes: { "data-theme": theme } });
    const body = element("body", { classes: bodyClasses("cctv.html") }, html);
    const filters = element("section", { classes: ["cctv-filters", "cc-filter-bar", "cc-filter-bar--dense-six"] }, body);
    const field = element("div", { classes: ["cctv-filter-field"] }, filters);
    const input = element("input", { attributes: { type: "search" } }, field);
    const cascade = createCascade(ROOT, "cctv.html");
    assert.equal(resolved(cascade, input, "min-height"), "44px");
    assert.ok(resolved(cascade, input, "background").length > 0);
  }
});

test("focus, disabled, invalid, placeholder, and responsive grid winners are semantic", () => {
  const focus = formControl("client-profiles.html", "light", { states: ["focus", "focus-visible"] });
  assert.equal(resolved(focus.cascade, focus.control, "border-color"), "#26658c");
  assert.equal(resolved(focus.cascade, focus.control, "box-shadow"), "0 0 0 3px rgba(38, 101, 140, 0.22)");
  const disabled = formControl("weekly-quality.html", "dark", { states: ["disabled"] });
  assert.equal(resolved(disabled.cascade, disabled.control, "background"), "#082640");
  const invalid = formControl("free-order-requests.html", "light", { attributes: { type: "text", "aria-invalid": "true" } });
  assert.equal(resolved(invalid.cascade, invalid.control, "border-color"), "#b42334");

  const html = element("html", { attributes: { "data-theme": "light" } });
  const body = element("body", { classes: bodyClasses("client-profiles.html") }, html);
  const grid = element("div", { classes: ["form-grid", "cc-form-grid"] }, body);
  assert.equal(resolved(createCascade(ROOT, "client-profiles.html", { viewportWidth: 768 }), grid, "grid-template-columns"), "1fr");
  assert.equal(resolved(createCascade(ROOT, "client-profiles.html", { viewportWidth: 320 }), grid, "grid-template-columns"), "1fr");
});

test("form and dense-filter geometry resolves at every required viewport", () => {
  const widths = [1440, 1280, 1024, 768, 390, 360, 320];
  for (const width of widths) {
    const html = element("html", { attributes: { "data-theme": "light" } });
    const body = element("body", { classes: bodyClasses("weekly-quality.html") }, html);
    const formGrid = element("div", { classes: ["form-grid", "cc-form-grid", "cc-form-grid--four"] }, body);
    const formColumns = resolved(createCascade(ROOT, "weekly-quality.html", { viewportWidth: width }), formGrid, "grid-template-columns");
    assert.equal(formColumns, width > 1024 ? "repeat(4, minmax(0, 1fr))" : width > 768 ? "repeat(2, minmax(0, 1fr))" : "1fr", `form ${width}`);

    const filterBody = element("body", { classes: bodyClasses("cctv.html") }, html);
    const filterGrid = element("section", { classes: ["cctv-filters", "cc-filter-bar", "cc-filter-bar--dense-six"] }, filterBody);
    const filterColumns = resolved(createCascade(ROOT, "cctv.html", { viewportWidth: width }), filterGrid, "grid-template-columns");
    const expected = width > 1180
      ? "minmax(280px, 2.15fr) repeat(5, minmax(116px, 1fr))"
      : width > 1024
        ? "minmax(240px, 2fr) repeat(5, minmax(106px, 1fr))"
        : width > 768
          ? "minmax(240px, 1.6fr) minmax(0, 3fr)"
          : width <= 360 ? "1fr" : "minmax(0, 1fr) auto";
    assert.equal(filterColumns, expected, `dense filter ${width}`);
  }
  assert.match(read("assets/css/components/forms.css"), /input\[type="file"\][\s\S]*overflow:\s*hidden/);
  assert.match(read("employee-profiles.html"), /@media \(max-width:620px\)[\s\S]*\.dynamic-row,[\s\S]*grid-template-columns:1fr/);
});

test("dense Operations filters remain fully reachable at narrow widths", () => {
  for (const width of [390, 360, 320]) {
    const html = element("html", { attributes: { "data-theme": "light" } });
    const body = element("body", { classes: bodyClasses("cctv.html") }, html);
    const filterGrid = element("section", { classes: ["cctv-filters", "cc-filter-bar", "cc-filter-bar--dense-six"] }, body);
    const secondaryFilters = element("div", { classes: ["cctv-secondary-filters"] }, filterGrid);
    const cascade = createCascade(ROOT, "cctv.html", { viewportWidth: width });
    assertDenseFilterReachable(cascade, filterGrid, width);
    assert.equal(resolved(cascade, secondaryFilters, "display"), "grid", `secondary filters layout at ${width}`);
    assert.equal(resolved(cascade, secondaryFilters, "grid-template-columns"), width <= 360 ? "1fr" : "repeat(2, minmax(0, 1fr))", `secondary filter columns at ${width}`);
  }

  for (const [width, css] of [
    [360, "@media (max-width: 360px) { body.cctv-v2 .cctv-filters.cc-filter-bar--dense-six { max-height: 40px; overflow: hidden; } }"],
    [320, "@media (max-width: 320px) { body.cctv-v2 .cctv-filters.cc-filter-bar--dense-six { max-height: 40px; overflow: clip; } }"]
  ]) {
    const html = element("html", { attributes: { "data-theme": "light" } });
    const body = element("body", { classes: bodyClasses("cctv.html") }, html);
    const filterGrid = element("section", { classes: ["cctv-filters", "cc-filter-bar", "cc-filter-bar--dense-six"] }, body);
    const mutated = createCascade(ROOT, "cctv.html", {
      viewportWidth: width,
      extraSources: [{ name: `dense-clipping-${width}.css`, css }]
    });
    assert.match(mutated.winner(filterGrid, "overflow").value, /hidden|clip/, `mutation wins at ${width}`);
    assert.throws(() => assertDenseFilterReachable(mutated, filterGrid, width), /dense filter overflow/);
  }
});

test("Employee Profile dynamic rows remain contained and operable on mobile", () => {
  for (const width of [390, 360, 320]) {
    for (const [kind, classes] of [
      ["phone", ["dynamic-row", "phone-row"]],
      ["contact", ["dynamic-row", "contact-row"]],
      ["restaurant", ["dynamic-row", "restaurant-row"]]
    ]) {
      const html = element("html", { attributes: { "data-theme": "light" } });
      const body = element("body", { classes: bodyClasses("employee-profiles.html") }, html);
      const row = element("div", { classes }, body);
      const cascade = createCascade(ROOT, "employee-profiles.html", { viewportWidth: width });
      assertDynamicRowReachable(cascade, row, kind, width);
    }
  }

  const width = 320;
  const html = element("html", { attributes: { "data-theme": "light" } });
  const body = element("body", { classes: bodyClasses("employee-profiles.html") }, html);
  const row = element("div", { classes: ["dynamic-row", "phone-row"] }, body);
  const mutated = createCascade(ROOT, "employee-profiles.html", {
    viewportWidth: width,
    extraSources: [{
      name: "dynamic-row-overflow.css",
      css: "@media (max-width: 320px) { body.employee-profiles-ops-center .dynamic-row.phone-row { grid-template-columns: repeat(4, 200px); } }"
    }]
  });
  assert.equal(resolved(mutated, row, "grid-template-columns"), "repeat(4, 200px)", "overflow mutation wins cascade");
  assert.throws(() => assertDynamicRowReachable(mutated, row, "phone", width), /phone row columns/);
});

test("static and dynamic visible fields have accessible names", () => {
  for (const page of FORM_PAGES) {
    const source = read(page);
    for (const match of source.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
      const tag = match[0];
      if (/type="(?:hidden|checkbox|radio)"/i.test(tag)) continue;
      const id = tag.match(/\bid="([^"]+)"/i)?.[1];
      const explicit = /\baria-label(?:ledby)?="[^"]+"/i.test(tag) || (id && new RegExp(`<label[^>]*for="${id}"`, "i").test(source));
      const before = source.slice(0, match.index);
      const wrapped = before.lastIndexOf("<label") > before.lastIndexOf("</label>");
      assert.ok(explicit || wrapped, `${page}: ${tag}`);
    }
  }
  const main = read("main.js");
  assert.match(main, /label\.htmlFor = controlId/);
  assert.match(main, /selected\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(main, /multi\.setAttribute\('aria-labelledby', label\.id\)/);
});

test("required indicators and explanations preserve the exact approved required-control inventory", () => {
  for (const [page, expectedForms] of Object.entries(REQUIRED_CONTROL_INVENTORY)) {
    const source = read(page);
    assert.match(source, /cc-form__required-note/, `${page} explanation`);
    assert.deepEqual(requiredControlInventory(source), expectedForms, `${page} exact required controls`);
    for (const id of Object.values(expectedForms).flat()) {
      const controlPattern = new RegExp(`<(?:input|select|textarea)\\b[^>]*\\bid="${id}"[^>]*\\brequired\\b[^>]*>`, "i");
      const match = source.match(controlPattern);
      assert.ok(match, `${page} ${id} remains required`);
      const index = source.indexOf(match[0]);
      if (page === "anati-admin.html") {
        assert.match(source.slice(Math.max(0, index - 180), index), /cc-field__label--required/);
      } else {
        assert.match(source, new RegExp(`<label[^>]*cc-field__label--required[^>]*for="${id}"`, "i"), `${page} ${id} marker`);
      }
    }
  }
  for (const page of ["cctv.html", "ce.html", "complaints.html", "free-orders.html"]) {
    assert.doesNotMatch(read(page), /cc-form__required-note/, `${page} must not imply required Operations fields`);
  }
});

test("required-control inventory rejects missing and unexpected required fields", () => {
  const weekly = read("weekly-quality.html");
  const missingPhone = weekly.replace('id="phone-number" name="phoneNumber" type="tel" autocomplete="tel" required', 'id="phone-number" name="phoneNumber" type="tel" autocomplete="tel"');
  assert.notEqual(missingPhone, weekly, "missing-required mutation applied");
  assert.notDeepEqual(requiredControlInventory(missingPhone), REQUIRED_CONTROL_INVENTORY["weekly-quality.html"]);

  const unexpectedNotes = weekly.replace('id="notes" name="notes"', 'id="notes" name="notes" required');
  assert.notEqual(unexpectedNotes, weekly, "unexpected-required mutation applied");
  assert.notDeepEqual(requiredControlInventory(unexpectedNotes), REQUIRED_CONTROL_INVENTORY["weekly-quality.html"]);
});

test("Operations renderer uses deterministic IDs, static semantic sections, and non-submit multi-select actions", () => {
  const source = read("main.js");
  const idContext = {};
  vm.runInNewContext(`${functionSource(source, "operationControlId")}; this.operationControlId = operationControlId;`, idContext);
  assert.equal(idContext.operationControlId("free-orders", "orderDate"), "cc-free-orders-orderdate");
  const sectionContext = {};
  const sectionDeclaration = source.slice(source.indexOf("const OPERATION_FORM_SECTIONS"), source.indexOf("function operationControlId"));
  vm.runInNewContext(sectionDeclaration.replace("const OPERATION_FORM_SECTIONS", "this.sections"), sectionContext);
  for (const [section, count] of [["cctv", 5], ["ce", 4], ["complaints", 4], ["free-orders", 5]]) {
    assert.equal(sectionContext.sections[section].length, count, `${section} section count`);
  }
  const configContext = { TICKET_DOMAIN_CONFIG: require("../shared/ticket-domain-config") };
  configContext.window = configContext;
  vm.runInNewContext(read("js/config.js"), configContext);
  for (const [section, definitions] of Object.entries(sectionContext.sections)) {
    const grouped = Array.from(definitions).flatMap((definition) => Array.from(definition.fields));
    assert.deepEqual(grouped, Array.from(configContext.formFields[section], (field) => field.name), `${section} section wrappers preserve exact field order`);
  }
  assert.match(source, /selected\.type = 'button'/);
  assert.match(source, /selected\.setAttribute\('aria-labelledby', label\.id\)/);
  assert.match(source, /x\.type='button'/);
  assert.match(source, /x\.setAttribute\('aria-label', `Remove \$\{cb\.value\}`\)/);
  assert.match(source, /e\.preventDefault\(\); e\.stopPropagation\(\); cb\.checked=false; updateSelected\(multi\)/);
  assert.match(source, /ticket\[field\.name\] = Array\.from\(multi\.querySelectorAll\('input:checked'\)\)\.map\(cb=>cb\.value\)/);
});

test("actual Operations renderer preserves valid multi-select semantics across two lifecycles", () => {
  for (const section of ["cctv", "ce", "complaints", "free-orders"]) {
    const renderer = createOperationsRenderer();
    assertOperationsRender(renderer, section, 1);
    renderer.context.renderer.closeModal();
    assertOperationsRender(renderer, section, 2);
    renderer.context.renderer.closeModal();
  }
});

test("Operations renderer rejects nested controls, invalid label targets, stale second-render ARIA, and duplicate IDs", () => {
  const source = read("main.js");
  const mutations = [
    {
      name: "removal button inserted inside trigger",
      breakOn: 1,
      apply: (value) => value.replace("values.appendChild(span);", "selected.appendChild(span);")
    },
    {
      name: "label for points to wrapper div",
      breakOn: 1,
      apply: (value) => value.replace("selected.id = controlId;", "label.htmlFor = multi.id; selected.id = controlId;")
    },
    {
      name: "second render label target becomes stale",
      breakOn: 2,
      apply: (value) => value
        .replace("function openModal(section){", "function openModal(section){ window.__reviewRenderCount = (window.__reviewRenderCount || 0) + 1;")
        .replace("label.htmlFor = controlId;", "label.htmlFor = window.__reviewRenderCount > 1 ? `${controlId}-stale` : controlId;")
    },
    {
      name: "second render retains duplicate IDs",
      breakOn: 2,
      apply: (value) => value.replace("dynamicForm.innerHTML = '';", "if (!window.__reviewRendered) dynamicForm.innerHTML = ''; window.__reviewRendered = true;")
    }
  ];

  for (const mutation of mutations) {
    const changed = mutation.apply(source);
    assert.notEqual(changed, source, `${mutation.name} applied`);
    const renderer = createOperationsRenderer(changed);
    if (mutation.breakOn === 1) {
      assert.throws(() => assertOperationsRender(renderer, "cctv", 1), undefined, mutation.name);
      continue;
    }
    assertOperationsRender(renderer, "cctv", 1);
    renderer.context.renderer.closeModal();
    assert.throws(() => assertOperationsRender(renderer, "cctv", 2), undefined, mutation.name);
  }
});

test("long-form sections exist without accordions, steppers, or tabs", () => {
  for (const page of ["weekly-quality.html", "employee-profiles.html", "client-profiles.html", "anati-admin.html"]) {
    const source = read(page);
    assert.match(source, /cc-form-section/, page);
    assert.doesNotMatch(source, /cc-form-(?:accordion|stepper|tabs?)/i);
  }
  const main = read("main.js");
  assert.match(main, /OPERATION_FORM_SECTIONS/);
  assert.doesNotMatch(main, /form-(?:accordion|stepper|tabs?)/i);
});

test("search and filter presentation stays native, immediate, and page-owned", () => {
  for (const page of FILTER_PAGES) {
    const source = read(page);
    assert.match(source, /type="search"/, page);
    assert.doesNotMatch(source, /type="submit"[^>]*>\s*Apply|>\s*Apply\s*<|data-filter-reset/i, `${page} no deferred Apply/guessed Reset`);
  }
  for (const page of ["employee-deductions.html", "agent-training.html", "restaurant-ratings.html", "employee-profiles.html", "client-profiles.html", "free-order-requests.html", "free-order-share.html"]) {
    assert.match(read(page), /type="search"[^>]*aria-label="[^"]+"/, `${page} named search`);
  }
  assert.match(read("js/tickets-render.js"), /control\.addEventListener\(eventName, \(\) => renderTickets\(\)\)/);
});

test("checkbox, file, dependent, and silent Call Queue contracts remain intact", () => {
  assert.match(read("employee-deductions.html"), /checkbox-field cc-checkbox/);
  assert.match(read("employee-profiles.html"), /primary-check cc-checkbox/);
  assert.match(read("anati-admin.html"), /check-row cc-checkbox/);
  assert.match(read("main.js"), /accept="application\/pdf"|input\.accept = field\.accept/);
  assert.match(read("weekly-quality.html"), /accept="\.mp3,audio\/mpeg"/);
  assert.match(read("client-profiles.html"), /accept="image\/\*"/);
  for (const [file, id] of [["attendance.html", "agent"], ["employee-deductions.html", "employee-id"], ["agent-training.html", "restaurant-id"], ["weekly-quality.html", "campaign"]]) {
    assert.match(read(file), new RegExp(`id="${id}"[^>]*disabled`));
  }
  assert.match(functionSource(read("call-queue.html"), "negativeResult"), /if \(!ticket \|\| !reason\) return;/);
  assert.match(functionSource(read("call-queue.html"), "addNote"), /if \(!ticket \|\| !value\) return;/);
});

test("twenty isolated in-memory mutations fail their intended Sprint 1.6 contracts", () => {
  const sources = {
    forms: read("assets/css/components/forms.css"), filters: read("assets/css/components/filters.css"), main: read("main.js"), tickets: read("js/tickets-render.js"),
    attendance: read("attendance.html"), employee: read("employee-profiles.html"), requests: read("free-order-requests.html"),
    weekly: read("weekly-quality.html"), client: read("client-profiles.html"), buttons: read("assets/js/components/buttons.js")
  };
  const cases = [
    ["dark input surface", "forms", /background:\s*var\(--input-background\)/, (s) => s.replaceAll("background: var(--input-background);", "background: #011c40;")],
    ["focus border", "forms", /border-color:\s*var\(--input-focus-border\)/, (s) => s.replaceAll("border-color: var(--input-focus-border);", "border-color: inherit;")],
    ["required label", "employee", /cc-field__label--required[^>]*for="full-name"/, (s) => s.replace("cc-field__label--required", "")],
    ["error linkage style", "forms", /\[aria-invalid="true"\]/, (s) => s.replace('[aria-invalid="true"]', '[data-invalid="true"]')],
    ["dependent disabled", "attendance", /id="agent"[^>]*disabled/, (s) => s.replace(/(id="agent"[^>]*?)\sdisabled/, "$1")],
    ["mobile collapse", "forms", /@media \(max-width:\s*768px\)[\s\S]*grid-template-columns:\s*1fr/, (s) => s.replace("@media (max-width: 768px)", "@media (max-width: 100px)")],
    ["dense reachability", "filters", /cc-filter-bar--dense-six \{ grid-template-columns:\s*1fr;/, (s) => s.replace(/cc-filter-bar--dense-six \{ grid-template-columns:\s*1fr;/, "cc-filter-bar--dense-six { overflow: hidden;")],
    ["filter identity/order", "tickets", /return haystack\.includes\(filters\.query\);/, (s) => s.replaceAll("return haystack.includes(filters.query);", "return false;")],
    ["helper button type", "main", /x\.type='button'/, (s) => s.replace("x.type='button';", "")],
    ["multi-select removal", "main", /cb\.checked=false; updateSelected\(multi\)/, (s) => s.replace("cb.checked=false; updateSelected(multi);", "updateSelected(multi);")],
    ["PDF validation", "main", /PDF only\./, (s) => s.replace("PDF only.", "Invalid file.")],
    ["MP3 wording", "weekly", /Please select an MP3 recording\./, (s) => s.replace("Please select an MP3 recording.", "Invalid recording.")],
    ["logo wording", "client", /Logo file must be 750 KB or smaller\./, (s) => s.replace("Logo file must be 750 KB or smaller.", "Logo too large.")],
    ["loading restoration", "buttons", /ccLoadingDisabled/, (s) => s.replaceAll("ccLoadingDisabled", "removedDisabledState")],
    ["shared field padding", "forms", /padding:\s*8px 12px/, (s) => s.replaceAll("padding: 8px 12px;", "padding: 15px;")],
    ["no guessed Reset", "requests", /aria-label="Request filters">/, (s) => s.replace('aria-label="Request filters">', 'aria-label="Request filters" data-filter-reset-behavior="records">')],
    ["Operations serialization", "main", /ticket\[field\.name\]\s*=\s*input\.value/, (s) => s.replace("ticket[field.name] = input.value", "ticket.changed = input.value")],
    ["required explanation", "attendance", /cc-form__required-note/, (s) => s.replace("cc-form__required-note", "removed-required-note")],
    ["search accessible name", "requests", /type="search"[^>]*aria-label="Search free order requests"/, (s) => s.replace(' aria-label="Search free order requests"', "")],
    ["dynamic remove type", "employee", /class="remove-row" type="button"/, (s) => s.replaceAll('class="remove-row" type="button"', 'class="remove-row"')]
  ];
  assert.equal(cases.length, 20);
  for (const [name, key, pattern, mutate] of cases) {
    const baseline = sources[key];
    assert.match(baseline, pattern, `${name} baseline`);
    const changed = mutate(baseline);
    assert.notEqual(changed, baseline, `${name} mutation applied`);
    assert.doesNotMatch(changed, pattern, `${name} mutation detected by intended contract`);
  }
});
