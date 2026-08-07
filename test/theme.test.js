"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const themeApi = require("../assets/js/theme.js");
const {
  contrastRatio: cascadeContrastRatio,
  createCascade,
  effectiveColor,
  element: cssElement,
  extractPageSources,
  winnerDescription
} = require("./css-cascade.js");

const ROOT = path.resolve(__dirname, "..");
const SHARED_SHELL_PAGES = [
  "cctv.html",
  "ce.html",
  "complaints.html",
  "free-orders.html",
  "employee-profiles.html"
];
const DIRECT_COLOR = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;

function cssBlock(source, selectorPattern) {
  const match = source.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`, "i"));
  assert.ok(match, `missing CSS block: ${selectorPattern}`);
  return match[1];
}

function declarations(block) {
  return new Map(Array.from(block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi), (match) => [match[1], match[2].trim()]));
}

function embeddedStyle(source) {
  const match = source.match(/<style>([\s\S]*?)<\/style>/i);
  return match ? match[1] : "";
}

function propertyValue(block, property) {
  const match = block.match(new RegExp(`(?:^|;)\\s*${property.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*:\\s*([^;]+)`, "i"));
  assert.ok(match, `missing ${property} declaration in ${block.trim()}`);
  return match[1].trim();
}

function specificity(selector) {
  const score = [0, 0, 0];
  let source = selector;
  source = source.replace(/:is\(([^()]*)\)/g, (_match, alternatives) => {
    const highest = alternatives.split(",").map((part) => specificity(part.trim())).sort((a, b) => {
      return b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
    })[0];
    score[0] += highest[0];
    score[1] += highest[1];
    score[2] += highest[2];
    return "";
  });
  score[0] += (source.match(/#[a-z0-9_-]+/gi) || []).length;
  score[1] += (source.match(/\.[a-z0-9_-]+|\[[^\]]+\]|:(?!:)[a-z0-9_-]+/gi) || []).length;
  const withoutQualifiedParts = source
    .replace(/#[a-z0-9_-]+|\.[a-z0-9_-]+|\[[^\]]+\]|::?[a-z0-9_-]+/gi, " ")
    .replace(/[>+~,*]/g, " ");
  score[2] += (withoutQualifiedParts.match(/\b[a-z][a-z0-9-]*\b/gi) || []).length;
  return score;
}

function compareSpecificity(left, right) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function resolveToken(tokenMap, name, stack = []) {
  assert.ok(tokenMap.has(name), `missing token --${name}`);
  assert.equal(stack.includes(name), false, `recursive token --${name}`);
  const value = tokenMap.get(name);
  const reference = value.match(/^var\(--([a-z0-9-]+)\)$/i);
  return reference ? resolveToken(tokenMap, reference[1], [...stack, name]) : value;
}

function relativeLuminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `contrast color must be six-digit hex: ${hex}`);
  const channels = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255).map((value) => {
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function assertTokenContrast(tokenMap, foreground, background, label) {
  const ratio = contrastRatio(resolveToken(tokenMap, foreground), resolveToken(tokenMap, background));
  assert.ok(ratio >= 4.5, `${label}: ${ratio.toFixed(2)}:1 is below 4.5:1`);
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.className = "";
    this.classList = {
      add: (name) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.add(name);
        this.className = Array.from(classes).join(" ");
      }
    };
    this.textContent = "";
    this.title = "";
    this.type = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
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

  click() {
    (this.listeners.get("click") || []).forEach((listener) => listener({ type: "click" }));
  }
}

function createEnvironment(options = {}) {
  const stored = new Map();
  if (Object.prototype.hasOwnProperty.call(options, "storedPreference")) {
    stored.set(themeApi.STORAGE_KEY, options.storedPreference);
  }

  const storage = options.storage || {
    getItem(key) { return stored.has(key) ? stored.get(key) : null; },
    setItem(key, value) { stored.set(key, value); }
  };
  const mediaListeners = [];
  const windowListeners = new Map();
  const mediaQuery = {
    matches: options.systemDark === true,
    addEventListener(type, listener) {
      if (type === "change") mediaListeners.push(listener);
    }
  };
  const documentElement = new FakeElement("html");
  const body = new FakeElement("body");
  const document = {
    documentElement,
    body,
    createElement(tagName) { return new FakeElement(tagName); }
  };
  const environment = {
    document,
    localStorage: storage,
    matchMedia() { return mediaQuery; },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    dispatchEvent() {},
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    }
  };

  return {
    environment,
    stored,
    mediaQuery,
    mediaListeners,
    windowListeners,
    documentElement,
    fireSystemChange(dark) {
      mediaQuery.matches = dark;
      mediaListeners.forEach((listener) => listener({ matches: dark }));
    }
  };
}

const OPERATION_CONTRACTS = {
  ce: {
    page: "ce.html",
    pageClass: "ce-page",
    rootClass: "ce-ops-center",
    statuses: [["escalated", "danger"], ["under-review", "warning"], ["pending-call", "primary"], ["closed", "success"]]
  },
  cctv: {
    page: "cctv.html",
    pageClass: "cctv-page",
    rootClass: "cctv-ops-center",
    statuses: [["escalated", "danger"], ["under-review", "warning"], ["closed", "success"]]
  },
  complaints: {
    page: "complaints.html",
    pageClass: "complaints-page",
    rootClass: "complaints-ops-center",
    statuses: [["escalated", "danger"], ["under-review", "warning"], ["pending-call", "primary"], ["closed", "success"]]
  },
  "free-orders": {
    page: "free-orders.html",
    pageClass: "free-orders-page",
    rootClass: "free-orders-ops-center",
    statuses: [["not-active", "warning"], ["active", "primary"], ["taken", "success"]]
  }
};

function operationElements(key, theme) {
  const contract = OPERATION_CONTRACTS[key];
  const html = cssElement("html", { attributes: { "data-theme": theme } });
  const root = cssElement("body", { classes: [contract.pageClass, contract.rootClass] }, html);
  const shell = cssElement("div", { classes: [`${key}-module-shell`, "cc-shell-layout"] }, root);
  const sidebar = cssElement("aside", { id: `${key}-app-sidebar`, classes: ["cc-shell-sidebar"] }, shell);
  const main = cssElement("main", { classes: ["cc-shell-main"] }, shell);
  const topbar = cssElement("header", { id: `${key}-app-topbar`, classes: ["cc-shell-topbar"] }, main);
  const card = cssElement("article", { classes: [`${key}-ticket-card`] }, main);
  const modal = cssElement("div", { classes: ["modal"] }, root);
  const modalPanel = cssElement("section", { classes: ["modal-content"] }, modal);
  const formGroup = cssElement("div", { classes: ["form-group"] }, modalPanel);
  const modalInput = cssElement("input", {}, formGroup);
  const placeholder = cssElement("input", { pseudoElement: "placeholder" }, formGroup);
  const modalSelect = cssElement("select", {}, formGroup);
  const modalTextarea = cssElement("textarea", {}, formGroup);
  const multiSelect = cssElement("div", { classes: ["multi-select"] }, formGroup);
  const multiSelected = cssElement("div", { classes: ["selected"] }, multiSelect);
  const modalPrimary = cssElement("button", { classes: ["submit-btn"] }, modalPanel);
  const modalSecondary = cssElement("button", { classes: ["cancel-btn"] }, modalPanel);
  const drawer = cssElement("div", { classes: ["drawer"] }, root);
  const drawerPanel = cssElement("aside", { classes: ["drawer-panel"] }, drawer);
  const drawerHeader = cssElement("div", { classes: ["drawer-header"] }, drawerPanel);
  const close = cssElement("button", { classes: ["drawer-close"] }, drawerHeader);
  const drawerBody = cssElement("div", { classes: ["drawer-body"] }, drawerPanel);
  const drawerInput = cssElement("input", {}, drawerBody);
  const drawerSelect = cssElement("select", {}, drawerBody);
  const drawerTextarea = cssElement("textarea", {}, drawerBody);
  const divider = cssElement("div", { classes: ["kv"] }, drawerBody);
  const drawerActions = cssElement("div", { classes: ["drawer-actions"] }, drawerPanel);
  const drawerPrimary = cssElement("button", { classes: ["submit-btn"] }, drawerActions);
  const drawerSecondary = cssElement("button", { classes: ["cancel-btn"] }, drawerActions);
  const historyOverlay = cssElement("div", { id: "history-modal", classes: ["history-modal", "is-open"] }, root);
  const historyPanel = cssElement("div", { id: "history-panel", classes: ["history-modal__panel"] }, historyOverlay);
  const historyHeader = cssElement("div", { classes: ["history-modal__header"] }, historyPanel);
  const historyTitle = cssElement("h3", { classes: ["history-modal__title"] }, historyHeader);
  const historyClose = cssElement("button", { id: "history-close", classes: ["history-modal__close"] }, historyHeader);
  const historyBody = cssElement("div", { id: "history-body", classes: ["history-modal__body"] }, historyPanel);
  const historyItem = cssElement("div", { classes: ["history-grid", "history-grid--item"] }, historyBody);
  const historyMetadata = cssElement("div", { classes: ["history-grid__meta"] }, historyItem);
  const historyLoading = cssElement("div", { classes: ["history-state", "history-state--loading"] }, historyBody);
  const historyError = cssElement("div", { classes: ["history-state", "history-state--error"] }, historyBody);
  const historyEmpty = cssElement("div", { classes: ["history-state", "history-state--empty"] }, historyBody);
  const status = (name) => cssElement("div", { classes: ["card-band", `band-${name}`] }, card);
  return {
    html, root, sidebar, main, topbar, card, modalPanel, modalInput, placeholder, modalSelect,
    modalTextarea, multiSelected, modalPrimary, modalSecondary, drawerPanel, close, drawerInput,
    drawerSelect, drawerTextarea, divider, drawerPrimary, drawerSecondary, historyOverlay,
    historyPanel, historyHeader, historyTitle, historyClose, historyBody, historyItem,
    historyMetadata, historyLoading, historyError, historyEmpty, status
  };
}

function employeeElements(theme) {
  const html = cssElement("html", { attributes: { "data-theme": theme } });
  const root = cssElement("body", { classes: ["employee-profiles-ops-center"] }, html);
  const shell = cssElement("div", { classes: ["profiles-module-shell", "cc-shell-layout"] }, root);
  const sidebar = cssElement("aside", { id: "employee-profiles-app-sidebar", classes: ["cc-shell-sidebar"] }, shell);
  const main = cssElement("main", { classes: ["cc-shell-main"] }, shell);
  const topbar = cssElement("header", { id: "employee-profiles-app-topbar", classes: ["cc-shell-topbar"] }, main);
  const card = cssElement("section", { classes: ["content-card"] }, main);
  const contact = cssElement("div", { classes: ["workspace-contact-row"] }, card);
  const label = cssElement("span", {}, contact);
  const value = cssElement("strong", {}, contact);
  const metadata = cssElement("small", {}, contact);
  const dynamicRow = cssElement("div", { classes: ["dynamic-row"] }, main);
  const contactRow = cssElement("div", { classes: ["dynamic-row", "contact-row"] }, main);
  return { html, root, sidebar, main, topbar, card, contact, label, value, metadata, dynamicRow, contactRow };
}

function assertSemanticWinner(cascade, label, target, property, token) {
  const result = cascade.winner(target, property);
  const expected = `semantic ${token}`;
  assert.ok(result, winnerDescription(cascade, label, property, result, expected));
  assert.ok(result.value.includes(`var(${token})`), winnerDescription(cascade, label, property, result, expected));
  return result;
}

function actualContrast(cascade, label, foregroundTarget, backgroundTarget = foregroundTarget) {
  const foreground = effectiveColor(cascade, foregroundTarget, "color");
  const background = effectiveColor(cascade, backgroundTarget, "background-color");
  const ratio = cascadeContrastRatio(foreground.color, background.color);
  assert.ok(ratio >= 4.5,
    `${cascade.page} | ${label} | actual contrast ${ratio.toFixed(2)}:1 | ` +
    `foreground ${foreground.resolved} from ${foreground.declaration.selector} in ${foreground.declaration.sourceName} | ` +
    `background ${background.resolved} from ${background.declaration.selector} in ${background.declaration.sourceName} | expected >= 4.5:1`);
  return { ratio, foreground, background };
}

test("only light, dark, and system are accepted", () => {
  assert.deepEqual(themeApi.PREFERENCES, ["light", "dark", "system"]);
  assert.equal(themeApi.isValidPreference("light"), true);
  assert.equal(themeApi.isValidPreference("dark"), true);
  assert.equal(themeApi.isValidPreference("system"), true);
  assert.equal(themeApi.isValidPreference("auto"), false);
  assert.equal(themeApi.isValidPreference("LIGHT"), false);
  assert.equal(themeApi.isValidPreference(""), false);
});

test("invalid, missing, and inaccessible storage safely use system preference", () => {
  assert.equal(themeApi.safeReadPreference({ getItem: () => "invalid" }), "system");
  assert.equal(themeApi.safeReadPreference({ getItem: () => null }), "system");
  assert.equal(themeApi.safeReadPreference({ getItem: () => { throw new Error("blocked"); } }), "system");
});

test("system preference resolves initially and follows system changes", () => {
  const fixture = createEnvironment({ storedPreference: "system", systemDark: true });
  const manager = themeApi.createThemeManager(fixture.environment);

  assert.equal(manager.init(), "dark");
  assert.equal(fixture.documentElement.getAttribute("data-theme"), "dark");

  fixture.fireSystemChange(false);
  assert.equal(manager.getTheme(), "light");
  assert.equal(fixture.documentElement.getAttribute("data-theme"), "light");
});

test("explicit light and dark preferences ignore later system changes", () => {
  const lightFixture = createEnvironment({ storedPreference: "light", systemDark: true });
  const lightManager = themeApi.createThemeManager(lightFixture.environment);
  lightManager.init();
  lightFixture.fireSystemChange(false);
  lightFixture.fireSystemChange(true);
  assert.equal(lightManager.getTheme(), "light");

  const darkFixture = createEnvironment({ storedPreference: "dark", systemDark: false });
  const darkManager = themeApi.createThemeManager(darkFixture.environment);
  darkManager.init();
  darkFixture.fireSystemChange(true);
  darkFixture.fireSystemChange(false);
  assert.equal(darkManager.getTheme(), "dark");
});

test("valid preference changes persist while invalid changes are rejected", () => {
  const fixture = createEnvironment({ systemDark: false });
  const manager = themeApi.createThemeManager(fixture.environment);
  manager.init();

  assert.equal(manager.setPreference("dark"), true);
  assert.equal(fixture.stored.get(themeApi.STORAGE_KEY), "dark");
  assert.equal(manager.getTheme(), "dark");

  assert.equal(manager.setPreference("invalid"), false);
  assert.equal(fixture.stored.get(themeApi.STORAGE_KEY), "dark");
  assert.equal(manager.getTheme(), "dark");
});

test("storage write failure does not prevent an immediate theme update", () => {
  const storage = {
    getItem() { return null; },
    setItem() { throw new Error("blocked"); }
  };
  const fixture = createEnvironment({ storage, systemDark: false });
  const manager = themeApi.createThemeManager(fixture.environment);
  manager.init();

  assert.equal(manager.setPreference("dark"), true);
  assert.equal(manager.getTheme(), "dark");
  assert.equal(fixture.documentElement.getAttribute("data-theme"), "dark");
});

test("initialization is idempotent and installs no duplicate global listeners", () => {
  const fixture = createEnvironment({ storedPreference: "system" });
  const manager = themeApi.createThemeManager(fixture.environment);

  manager.init();
  manager.init();
  manager.init();

  assert.equal(fixture.mediaListeners.length, 1);
  assert.equal((fixture.windowListeners.get("storage") || []).length, 1);
});

test("theme toggle is a labeled native button and cycles all modes", () => {
  const fixture = createEnvironment({ storedPreference: "system", systemDark: false });
  const manager = themeApi.createThemeManager(fixture.environment);
  const toggle = manager.createToggle();

  assert.equal(toggle.tagName, "BUTTON");
  assert.equal(toggle.type, "button");
  assert.equal(toggle.getAttribute("data-theme-toggle"), "");
  assert.equal(toggle.getAttribute("aria-label"), "Theme: System, currently Light. Activate to switch to Light.");
  assert.equal(toggle.title, "Theme: System, currently Light. Switch to Light.");
  assert.equal((toggle.listeners.get("click") || []).length, 1);

  toggle.click();
  assert.equal(manager.getPreference(), "light");
  assert.equal(fixture.stored.get(themeApi.STORAGE_KEY), "light");
  assert.equal(toggle.getAttribute("aria-label"), "Theme: Light. Activate to switch to Dark.");
  toggle.click();
  assert.equal(manager.getPreference(), "dark");
  assert.equal(toggle.getAttribute("aria-label"), "Theme: Dark. Activate to switch to System.");
  toggle.click();
  assert.equal(manager.getPreference(), "system");
  assert.equal(toggle.getAttribute("aria-label"), "Theme: System, currently Light. Activate to switch to Light.");
});

test("theme runtime is import-safe and contains no network or unsafe DOM APIs", () => {
  const source = fs.readFileSync(path.join(ROOT, "assets/js/theme.js"), "utf8");
  assert.equal(typeof themeApi.createThemeManager, "function");
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(/);
  assert.doesNotMatch(source, /console\./);
  assert.doesNotMatch(source, /cc_auth|cc_token|cc_user|cc_role/);
});

test("both themes define all required semantic tokens and new CSS uses no undefined token", () => {
  const tokenCss = fs.readFileSync(path.join(ROOT, "assets/css/design-tokens.css"), "utf8");
  const baseCss = fs.readFileSync(path.join(ROOT, "assets/css/theme-base.css"), "utf8");
  const shellCss = fs.readFileSync(path.join(ROOT, "app-shell.css"), "utf8");
  const darkBlock = tokenCss.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*)\}\s*$/);
  assert.ok(darkBlock, "dark theme token block must exist");

  const requiredSemanticTokens = [
    "color-bg", "color-surface", "color-surface-raised", "color-surface-muted",
    "color-text", "color-text-muted", "color-border", "color-primary",
    "color-primary-hover", "color-primary-active", "color-primary-soft", "color-primary-on-solid",
    "color-secondary", "color-focus", "color-success", "color-success-hover",
    "color-success-soft", "color-success-text", "color-success-border", "color-success-on-solid",
    "color-warning", "color-warning-hover", "color-warning-soft",
    "color-warning-text", "color-warning-border", "color-warning-on-solid", "color-danger",
    "color-danger-hover", "color-danger-soft", "color-danger-text",
    "color-danger-border", "color-danger-on-solid", "color-info", "color-info-hover", "color-info-soft",
    "color-info-text", "color-info-border", "color-info-on-solid", "color-neutral", "color-neutral-hover",
    "color-neutral-soft", "color-neutral-text", "color-neutral-border",
    "shadow-sm", "shadow-md", "shadow-lg"
  ];

  requiredSemanticTokens.forEach((token) => {
    assert.match(tokenCss, new RegExp(`--${token}\\s*:`), `light token --${token}`);
    assert.match(darkBlock[1], new RegExp(`--${token}\\s*:`), `dark token --${token}`);
  });

  const definitions = new Set(Array.from(`${tokenCss}\n${shellCss}`.matchAll(/--([a-z0-9-]+)\s*:/g), (match) => match[1]));
  const usages = Array.from(`${tokenCss}\n${baseCss}\n${shellCss}`.matchAll(/var\(--([a-z0-9-]+)/g), (match) => match[1]);
  const undefinedTokens = Array.from(new Set(usages.filter((token) => !definitions.has(token))));
  assert.deepEqual(undefinedTokens, []);
  assert.match(baseCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test("shared-shell pages load the early runtime and shared theme assets without content migration", () => {
  SHARED_SHELL_PAGES.forEach((page) => {
    const source = fs.readFileSync(path.join(ROOT, page), "utf8");
    const themeScriptIndex = source.indexOf('src="assets/js/theme.js"');
    const firstStylesheetIndex = source.indexOf('rel="stylesheet"');
    assert.match(source, /<html[^>]+data-theme="light"/);
    assert.ok(themeScriptIndex > -1 && themeScriptIndex < firstStylesheetIndex, `${page} resolves theme before CSS`);
    assert.match(source, /href="assets\/css\/design-tokens\.css"/);
    assert.match(source, /href="assets\/css\/theme-base\.css"/);
    assert.match(source, /src="js\/app-shell\.js"/);
  });

  const shellSource = fs.readFileSync(path.join(ROOT, "js/app-shell.js"), "utf8");
  assert.match(shellSource, /CloudCrowdTheme\.createToggle\(\)/);
  assert.match(shellSource, /function buildSidebar/);
  assert.match(shellSource, /function buildTopbar/);
});

test("shared-shell navigation and topbar still build with the reusable theme toggle", async () => {
  const shellSource = fs.readFileSync(path.join(ROOT, "js/app-shell.js"), "utf8");
  const document = {
    createElement(tagName) { return new FakeElement(tagName); }
  };
  const themeToggle = new FakeElement("button");
  themeToggle.className = "cc-theme-toggle";
  const window = {
    document,
    location: { pathname: "/cctv.html" },
    sessionStorage: {
      getItem(key) {
        return {
          cc_user: "Test User",
          cc_role: "agent",
          cc_token: "test-token"
        }[key] || "";
      }
    },
    CCPermissions: {
      async getMyAccessModel() {
        return { legacyFallback: false, hasConfiguredAccess: true, fullAccess: true, access: [] };
      },
      getModuleAccess(_accessModel, moduleKey) {
        return { moduleKey, canView: true, canCreate: true, canEdit: true, canDelete: false };
      },
      async getMyAccess(moduleKey) {
        return { moduleKey, canView: true, canCreate: true, canEdit: true, canDelete: false };
      }
    },
    CloudCrowdTheme: {
      createToggle() { return themeToggle; }
    }
  };
  window.window = window;
  vm.runInNewContext(shellSource, { window, document, sessionStorage: window.sessionStorage, console });

  const sidebar = new FakeElement("aside");
  const visibleModules = await window.CloudCrowdAppShell.buildSidebar(sidebar);
  assert.ok(visibleModules.length >= 10);
  assert.equal(visibleModules.some((module) => module.id === "dashboard"), true);
  assert.equal(visibleModules.some((module) => module.id === "cctv"), true);

  const topbar = new FakeElement("header");
  const result = window.CloudCrowdAppShell.buildTopbar(topbar, { title: "CCTV Operations Center" });
  assert.equal(result.user.username, "Test User");
  const topbarActions = topbar.children.find((child) => child.className === "cc-shell-topbar-actions");
  assert.ok(topbarActions);
  assert.equal(topbarActions.children.includes(themeToggle), true);
});

test("light and dark effective visual tokens differ for every integrated page contract", () => {
  const tokenCss = fs.readFileSync(path.join(ROOT, "assets/css/design-tokens.css"), "utf8");
  const lightSource = tokenCss.slice(tokenCss.indexOf(":root {"), tokenCss.indexOf(':root[data-theme="dark"]'));
  const light = declarations(lightSource);
  const dark = declarations(cssBlock(tokenCss, ':root\\[data-theme="dark"\\]'));
  const effectiveRoles = ["color-bg", "color-surface-raised", "color-text", "color-border", "color-surface"];

  SHARED_SHELL_PAGES.forEach((page) => {
    effectiveRoles.forEach((role) => {
      assert.ok(light.has(role), `${page} light --${role}`);
      assert.ok(dark.has(role), `${page} dark --${role}`);
      assert.notEqual(light.get(role), dark.get(role), `${page} must visibly differentiate --${role}`);
    });
  });
});

test("integrated page roots and shared shell surfaces win the legacy cascade with semantic tokens", () => {
  const shellCss = fs.readFileSync(path.join(ROOT, "app-shell.css"), "utf8");
  const compatibilityIndex = shellCss.indexOf("Sprint 1.2 semantic compatibility layer");
  assert.ok(compatibilityIndex > shellCss.indexOf("Customer Experience operations-center pass"));
  assert.ok(compatibilityIndex > shellCss.indexOf("CCTV Operations Center"));
  assert.ok(compatibilityIndex > shellCss.indexOf("People Operations record directory"));

  ["ce-page.ce-ops-center", "cctv-page.cctv-ops-center", "complaints-page.complaints-ops-center", "free-orders-page.free-orders-ops-center", "employee-profiles-ops-center"].forEach((rootClass) => {
    assert.ok(shellCss.slice(compatibilityIndex).includes(rootClass), `compatibility root ${rootClass}`);
  });

  const compatibility = shellCss.slice(compatibilityIndex);
  [
    "--color-bg", "--color-surface", "--color-surface-raised", "--color-surface-muted",
    "--color-text", "--color-text-muted", "--color-border", "--color-divider",
    "--color-sidebar-bg", "--color-sidebar-text", "--color-sidebar-border",
    "--input-background", "--input-text", "--modal-surface", "--modal-overlay"
  ].forEach((token) => assert.ok(compatibility.includes(`var(${token})`), `compatibility uses ${token}`));

  assert.match(compatibility, /#employee-profiles-app-sidebar\.cc-shell-sidebar\s*\{/);
  assert.match(compatibility, /#employee-profiles-app-topbar\.cc-shell-topbar\s*\{/);
  assert.match(compatibility, /\.profile-table\s+:is\(th, td\)/);
});

test("focused linked stylesheet scan separates tokenized surfaces from effective legacy colors", () => {
  const shellCss = fs.readFileSync(path.join(ROOT, "app-shell.css"), "utf8");
  const baseCss = fs.readFileSync(path.join(ROOT, "assets/css/theme-base.css"), "utf8");
  const linkedCss = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  assert.doesNotMatch(shellCss, DIRECT_COLOR);
  assert.doesNotMatch(baseCss, DIRECT_COLOR);

  SHARED_SHELL_PAGES.forEach((page) => {
    const source = fs.readFileSync(path.join(ROOT, page), "utf8");
    const styles = embeddedStyle(source);
    assert.doesNotMatch(styles, DIRECT_COLOR, `${page} embedded styles use semantic tokens`);
  });

  for (const match of linkedCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/!important/i.test(match[2])) continue;
    assert.doesNotMatch(match[2], DIRECT_COLOR, `effective direct color in linked selector ${match[1].trim()}`);
  }

  ["free-orders", "ce", "complaints", "cctv"].forEach((page) => {
    const divider = cssBlock(linkedCss, `\\.${page}-page \\.drawer-body \\.kv`);
    assert.equal(propertyValue(divider, "border-bottom"), "1px solid var(--color-divider) !important");
  });
});

test("no high-specificity hard-coded theme override remains in migrated selectors", () => {
  const shellCss = fs.readFileSync(path.join(ROOT, "app-shell.css"), "utf8");
  const migratedRule = /([^{}]*(?:ops-center|cc-shell|history-panel)[^{}]*)\{([^{}]*)\}/gi;
  for (const match of shellCss.matchAll(migratedRule)) {
    assert.doesNotMatch(match[2], DIRECT_COLOR, `direct color in ${match[1].trim()}`);
  }

  const visualImportant = /(?:color|background|border-color|box-shadow)\s*:[^;]+!important/gi;
  assert.doesNotMatch(shellCss, visualImportant);
});

test("representative cascade contracts keep high-specificity controls and actions semantic", () => {
  const shellCss = fs.readFileSync(path.join(ROOT, "app-shell.css"), "utf8");
  const genericInput = specificity(":is(.ce-ops-center, .cctv-ops-center) :is(input, select, textarea)");
  const scopedInput = specificity(".ce-ops-center .modal input");
  const genericAction = specificity(":is(.ce-ops-center, .cctv-ops-center) :is(.submit-btn, .save-btn)");
  const scopedAction = specificity(".ce-ops-center .modal .submit-btn");
  assert.ok(compareSpecificity(scopedInput, genericInput) > 0, "fixture preserves the reviewed input specificity hazard");
  assert.ok(compareSpecificity(scopedAction, genericAction) > 0, "fixture preserves the reviewed action specificity hazard");

  ["ce", "cctv", "complaints", "free-orders"].forEach((page) => {
    const controlBlock = cssBlock(shellCss, `\\.${page}-ops-center \\.drawer-body textarea`);
    assert.equal(propertyValue(controlBlock, "background"), "var(--input-background)", `${page} modal/drawer input background`);
    assert.equal(propertyValue(controlBlock, "color"), "var(--input-text)", `${page} modal/drawer input text`);
    assert.equal(propertyValue(controlBlock, "border-color"), "var(--input-border)", `${page} modal/drawer input border`);

    const actionBlock = cssBlock(shellCss, `\\.${page}-ops-center \\.modal \\.submit-btn`);
    assert.equal(propertyValue(actionBlock, "color"), "var(--color-primary-on-solid)", `${page} primary modal action text`);
    assert.match(propertyValue(actionBlock, "background"), /var\(--color-primary\)/, `${page} primary modal action background`);

    const panelBlock = cssBlock(shellCss, `\\.${page}-ops-center \\.drawer-panel`);
    assert.equal(propertyValue(panelBlock, "background"), "var(--modal-surface)", `${page} modal/drawer surface`);

    const closeBlock = cssBlock(shellCss, `\\.${page}-ops-center \\.drawer-close`);
    const closeHoverBlock = cssBlock(shellCss, `\\.${page}-ops-center \\.drawer-close:hover`);
    assert.equal(propertyValue(closeBlock, "color"), "var(--color-primary)", `${page} drawer close text`);
    assert.equal(propertyValue(closeHoverBlock, "background"), "var(--color-primary-soft)", `${page} drawer close hover`);
  });

  const statusContracts = [
    ["ce", "escalated", "danger"], ["ce", "under-review", "warning"],
    ["ce", "pending-call", "primary"], ["ce", "closed", "success"],
    ["cctv", "escalated", "danger"], ["cctv", "under-review", "warning"],
    ["cctv", "closed", "success"],
    ["complaints", "escalated", "danger"], ["complaints", "under-review", "warning"],
    ["complaints", "pending-call", "primary"], ["complaints", "closed", "success"],
    ["free-orders", "not-active", "warning"], ["free-orders", "active", "primary"],
    ["free-orders", "taken", "success"]
  ];
  statusContracts.forEach(([page, status, state]) => {
    const statusBlock = cssBlock(shellCss, `\\.${page}-ops-center \\.card-band\\.band-${status}`);
    assert.equal(propertyValue(statusBlock, "color"), `var(--color-${state}-on-solid)`, `${page} ${status} foreground`);
  });

  const employeeContact = cssBlock(shellCss, "\\.employee-profiles-ops-center \\.workspace-contact-row");
  const employeeContactLabel = cssBlock(shellCss, "\\.employee-profiles-ops-center \\.workspace-contact-row > span");
  const employeeContactValue = cssBlock(shellCss, "\\.employee-profiles-ops-center \\.workspace-contact-row strong");
  const employeeContactMeta = cssBlock(shellCss, "\\.employee-profiles-ops-center \\.workspace-contact-row small");
  assert.equal(propertyValue(employeeContact, "background"), "var(--color-surface-muted)");
  assert.equal(propertyValue(employeeContactLabel, "color"), "var(--color-text-muted)");
  assert.equal(propertyValue(employeeContactValue, "color"), "var(--color-text)");
  assert.equal(propertyValue(employeeContactMeta, "color"), "var(--color-text-muted)");
  const employeeMobileContact = cssBlock(shellCss, "\\.employee-profiles-ops-center \\.contact-row");
  assert.equal(propertyValue(employeeMobileContact, "background"), "var(--color-surface-muted)");

  const compatibility = shellCss.slice(shellCss.indexOf("Sprint 1.2 semantic compatibility layer"));
  const secondaryAction = cssBlock(compatibility, ":is\\(\\.modal, \\.drawer-actions\\) \\.cancel-btn");
  const placeholder = cssBlock(compatibility, ":is\\(\\.modal, \\.drawer-body\\) input::placeholder");
  assert.equal(propertyValue(secondaryAction, "background"), "var(--color-surface-muted)");
  assert.equal(propertyValue(secondaryAction, "color"), "var(--color-text)");
  assert.equal(propertyValue(placeholder, "color"), "var(--input-placeholder)");
});

test("status, action, contact, and muted surface pairs meet normal-text contrast in both themes", () => {
  const tokenCss = fs.readFileSync(path.join(ROOT, "assets/css/design-tokens.css"), "utf8");
  const lightSource = tokenCss.slice(tokenCss.indexOf(":root {"), tokenCss.indexOf(':root[data-theme="dark"]'));
  const themes = {
    light: declarations(lightSource),
    dark: declarations(cssBlock(tokenCss, ':root\\[data-theme="dark"\\]'))
  };
  const pairs = [
    ["color-primary-on-solid", "color-primary", "primary status/action"],
    ["color-success-on-solid", "color-success", "success status"],
    ["color-warning-on-solid", "color-warning", "warning status"],
    ["color-danger-on-solid", "color-danger", "danger status"],
    ["color-info-on-solid", "color-info", "info status"],
    ["color-text", "color-surface-muted", "Employee contact primary text"],
    ["color-text-muted", "color-surface-muted", "Employee contact secondary text"],
    ["color-text-muted", "color-surface", "muted text on surface"]
  ];

  Object.entries(themes).forEach(([theme, tokenMap]) => {
    pairs.forEach(([foreground, background, label]) => {
      assertTokenContrast(tokenMap, foreground, background, `${theme} ${label}`);
    });
  });
});

test("integrated HTML determines the real linked and embedded stylesheet order", () => {
  const operationsOrder = [
    "assets/css/design-tokens.css",
    "styles.css",
    "app-shell.css",
    "assets/css/theme-base.css",
    "media-viewer.css"
  ];
  Object.values(OPERATION_CONTRACTS).forEach(({ page }) => {
    assert.deepEqual(extractPageSources(ROOT, page).map((source) => source.name), operationsOrder, `${page} stylesheet order`);
  });
  assert.deepEqual(extractPageSources(ROOT, "employee-profiles.html").map((source) => source.name), [
    "assets/css/design-tokens.css",
    "app-shell.css",
    "assets/css/theme-base.css",
    "employee-profiles.html#style-1"
  ]);
});

test("runtime history modal emits semantic classes without inline visual styling", () => {
  const source = fs.readFileSync(path.join(ROOT, "js/history.js"), "utf8");
  assert.doesNotMatch(source, /\bstyle\s*=|\.style\.|style\.cssText|setAttribute\(\s*["']style["']/i);
  assert.doesNotMatch(source, DIRECT_COLOR);
  [
    "history-modal", "history-modal__panel", "history-modal__header", "history-modal__title",
    "history-modal__close", "history-modal__body", "history-grid", "history-grid--header",
    "history-grid--item", "history-grid__meta", "history-state--loading",
    "history-state--error", "history-state--empty"
  ].forEach((className) => assert.ok(source.includes(className), `history runtime class ${className}`));

  const closeControl = { onclick: null };
  const historyBody = { innerHTML: "" };
  const classNames = new Set();
  const modal = {
    id: "",
    className: "",
    innerHTML: "",
    classList: {
      add(name) { classNames.add(name); },
      remove(name) { classNames.delete(name); }
    },
    querySelector(selector) {
      if (selector === "#history-close") return closeControl;
      if (selector === "#history-body") return historyBody;
      return null;
    },
    addEventListener() {}
  };
  let appended = null;
  const document = {
    getElementById(id) { return appended && appended.id === id ? appended : null; },
    createElement(tag) {
      assert.equal(tag, "div");
      return modal;
    },
    body: { appendChild(node) { appended = node; } }
  };
  const window = {};
  vm.runInNewContext(source, { window, document });
  const generated = window.ensureHistoryModal();
  assert.equal(generated.id, "history-modal");
  assert.equal(generated.className, "history-modal");
  assert.match(generated.innerHTML, /class="history-modal__panel"/);
  assert.match(generated.innerHTML, /class="history-modal__close"/);
  assert.equal(typeof closeControl.onclick, "function");
});

test("actual linked cascade winners satisfy operations-page semantic contracts", () => {
  Object.entries(OPERATION_CONTRACTS).forEach(([key, contract]) => {
    ["light", "dark"].forEach((theme) => {
      const cascade = createCascade(ROOT, contract.page);
      const targets = operationElements(key, theme);
      assertSemanticWinner(cascade, "page root", targets.root, "background-color", "--color-bg");
      assertSemanticWinner(cascade, "page root", targets.root, "color", "--color-text");
      assertSemanticWinner(cascade, "shared topbar", targets.topbar, "background-color", "--color-surface-raised");
      assertSemanticWinner(cascade, "shared sidebar", targets.sidebar, "background-color", "--color-sidebar-bg");
      assertSemanticWinner(cascade, "card surface", targets.card, "background-color", "--color-surface-raised");
      assertSemanticWinner(cascade, "modal panel", targets.modalPanel, "background-color", "--modal-surface");
      assertSemanticWinner(cascade, "drawer panel", targets.drawerPanel, "background-color", "--modal-surface");

      [
        ["modal input", targets.modalInput], ["modal select", targets.modalSelect],
        ["modal textarea", targets.modalTextarea], ["drawer input", targets.drawerInput],
        ["drawer select", targets.drawerSelect], ["drawer textarea", targets.drawerTextarea]
      ].forEach(([label, target]) => {
        assertSemanticWinner(cascade, label, target, "background-color", "--input-background");
        assertSemanticWinner(cascade, label, target, "color", "--input-text");
        assertSemanticWinner(cascade, label, target, "border-color", "--input-border");
      });
      assertSemanticWinner(cascade, "input placeholder", targets.placeholder, "color", "--input-placeholder");

      [
        ["primary modal action", targets.modalPrimary], ["primary drawer action", targets.drawerPrimary]
      ].forEach(([label, target]) => {
        assertSemanticWinner(cascade, label, target, "background-color", "--color-primary");
        assertSemanticWinner(cascade, label, target, "color", "--color-primary-on-solid");
        actualContrast(cascade, `${theme} ${label}`, target);
      });
      [
        ["secondary modal action", targets.modalSecondary], ["secondary drawer action", targets.drawerSecondary]
      ].forEach(([label, target]) => {
        assertSemanticWinner(cascade, label, target, "background-color", "--color-surface-muted");
        assertSemanticWinner(cascade, label, target, "color", "--color-text");
      });
      assertSemanticWinner(cascade, "drawer close control", targets.close, "color", "--color-primary");
      assertSemanticWinner(cascade, "drawer divider", targets.divider, "border-bottom-color", "--color-divider");

      if (key === "cctv") {
        assertSemanticWinner(cascade, "multi-select", targets.multiSelected, "background-color", "--input-background");
        assertSemanticWinner(cascade, "multi-select", targets.multiSelected, "color", "--input-text");
        assertSemanticWinner(cascade, "multi-select", targets.multiSelected, "border-color", "--input-border");
      }

      const inputBackground = effectiveColor(cascade, targets.modalInput, "background-color").color;
      const inputText = effectiveColor(cascade, targets.modalInput, "color").color;
      const panelBackground = effectiveColor(cascade, targets.modalPanel, "background-color").color;
      assert.equal(inputBackground, theme === "light" ? "#ffffff" : "#062947", `${contract.page} ${theme} input surface`);
      assert.equal(inputText, theme === "light" ? "#011c40" : "#eefcff", `${contract.page} ${theme} input text`);
      assert.equal(panelBackground, theme === "light" ? "#ffffff" : "#0b3554", `${contract.page} ${theme} modal surface`);
    });
  });
});

test("actual winning status declarations meet WCAG AA in both themes", () => {
  Object.entries(OPERATION_CONTRACTS).forEach(([key, contract]) => {
    ["light", "dark"].forEach((theme) => {
      const cascade = createCascade(ROOT, contract.page);
      const targets = operationElements(key, theme);
      contract.statuses.forEach(([status, state]) => {
        const target = targets.status(status);
        const foreground = assertSemanticWinner(cascade, `${status} status`, target, "color", `--color-${state}-on-solid`);
        const background = cascade.winner(target, "background-color");
        assert.ok(background, winnerDescription(cascade, `${status} status`, "background-color", background, `resolved --color-${state}`));
        const actualBackground = cascade.resolveValue(target, background.value);
        const stateBackground = cascade.resolveValue(target, `var(--color-${state})`);
        assert.equal(actualBackground, stateBackground,
          winnerDescription(cascade, `${status} status`, "background-color", background, `resolved --color-${state}: ${stateBackground}`));
        assert.equal(cascade.resolveValue(target, foreground.value), cascade.resolveValue(target, `var(--color-${state}-on-solid)`));
        actualContrast(cascade, `${theme} ${status} status`, target);
      });
    });
  });
});

test("actual history modal winners and contrast are semantic in all operations pages", () => {
  Object.entries(OPERATION_CONTRACTS).forEach(([key, contract]) => {
    ["light", "dark"].forEach((theme) => {
      const cascade = createCascade(ROOT, contract.page);
      const targets = operationElements(key, theme);
      assertSemanticWinner(cascade, "history overlay", targets.historyOverlay, "background-color", "--modal-overlay");
      assertSemanticWinner(cascade, "history panel", targets.historyPanel, "background-color", "--modal-surface");
      assertSemanticWinner(cascade, "history panel", targets.historyPanel, "color", "--color-text");
      assertSemanticWinner(cascade, "history panel", targets.historyPanel, "border-color", "--color-border");
      assertSemanticWinner(cascade, "history header", targets.historyHeader, "background-color", "--color-surface-raised");
      assertSemanticWinner(cascade, "history title", targets.historyTitle, "color", "--color-text");
      assertSemanticWinner(cascade, "history item", targets.historyItem, "background-color", "--color-surface");
      assertSemanticWinner(cascade, "history item", targets.historyItem, "color", "--color-text");
      assertSemanticWinner(cascade, "history item divider", targets.historyItem, "border-bottom-color", "--color-divider");
      assertSemanticWinner(cascade, "history metadata", targets.historyMetadata, "color", "--color-text-muted");
      assertSemanticWinner(cascade, "history loading", targets.historyLoading, "background-color", "--color-surface-muted");
      assertSemanticWinner(cascade, "history loading", targets.historyLoading, "color", "--color-text-muted");
      assertSemanticWinner(cascade, "history loading", targets.historyLoading, "border-color", "--color-border");
      assertSemanticWinner(cascade, "history empty", targets.historyEmpty, "background-color", "--color-surface-muted");
      assertSemanticWinner(cascade, "history error", targets.historyError, "background-color", "--color-danger-soft");
      assertSemanticWinner(cascade, "history error", targets.historyError, "color", "--color-danger-text");
      assertSemanticWinner(cascade, "history error", targets.historyError, "border-color", "--color-danger-border");
      assertSemanticWinner(cascade, "history close", targets.historyClose, "background-color", "--color-surface-muted");
      assertSemanticWinner(cascade, "history close", targets.historyClose, "color", "--color-text");
      assertSemanticWinner(cascade, "history close", targets.historyClose, "border-color", "--color-border");

      actualContrast(cascade, `${theme} history body`, targets.historyBody, targets.historyPanel);
      actualContrast(cascade, `${theme} history metadata`, targets.historyMetadata, targets.historyItem);
      actualContrast(cascade, `${theme} history loading`, targets.historyLoading);
      actualContrast(cascade, `${theme} history empty`, targets.historyEmpty);
      actualContrast(cascade, `${theme} history error`, targets.historyError);

      assert.equal(effectiveColor(cascade, targets.historyPanel, "background-color").color,
        theme === "light" ? "#ffffff" : "#0b3554", `${contract.page} ${theme} history panel`);
      assert.equal(effectiveColor(cascade, targets.historyItem, "background-color").color,
        theme === "light" ? "#ffffff" : "#062947", `${contract.page} ${theme} history item`);
      assert.equal(effectiveColor(cascade, targets.historyLoading, "background-color").color,
        theme === "light" ? "#eaf6f8" : "#082640", `${contract.page} ${theme} history loading`);
      assert.equal(effectiveColor(cascade, targets.historyError, "background-color").color,
        theme === "light" ? "#fdecef" : "#4a2430", `${contract.page} ${theme} history error`);
    });
  });
});

test("actual Employee contact and shell declarations meet semantic and contrast contracts", () => {
  ["light", "dark"].forEach((theme) => {
    const desktop = createCascade(ROOT, "employee-profiles.html", { viewportWidth: 1440 });
    const targets = employeeElements(theme);
    assertSemanticWinner(desktop, "page root", targets.root, "background-color", "--color-bg");
    assertSemanticWinner(desktop, "shared topbar", targets.topbar, "background-color", "--color-surface-raised");
    assertSemanticWinner(desktop, "shared sidebar", targets.sidebar, "background-color", "--color-sidebar-bg");
    assertSemanticWinner(desktop, "profile card", targets.card, "background-color", "--color-surface");
    assertSemanticWinner(desktop, "contact row", targets.contact, "background-color", "--color-surface-muted");
    assertSemanticWinner(desktop, "contact label", targets.label, "color", "--color-text-muted");
    assertSemanticWinner(desktop, "contact value", targets.value, "color", "--color-text");
    assertSemanticWinner(desktop, "contact metadata", targets.metadata, "color", "--color-text-muted");
    actualContrast(desktop, `${theme} Employee contact label`, targets.label, targets.contact);
    actualContrast(desktop, `${theme} Employee contact value`, targets.value, targets.contact);
    actualContrast(desktop, `${theme} Employee contact metadata`, targets.metadata, targets.contact);

    const mobile = createCascade(ROOT, "employee-profiles.html", { viewportWidth: 390 });
    const mobileTargets = employeeElements(theme);
    assertSemanticWinner(mobile, "mobile dynamic row", mobileTargets.dynamicRow, "background-color", "--color-surface-muted");
    assertSemanticWinner(mobile, "mobile contact row", mobileTargets.contactRow, "background-color", "--color-surface-muted");
    assertSemanticWinner(mobile, "mobile dynamic row", mobileTargets.dynamicRow, "color", "--color-text");
    assertSemanticWinner(mobile, "mobile contact row", mobileTargets.contactRow, "color", "--color-text");
    actualContrast(mobile, `${theme} mobile dynamic row`, mobileTargets.dynamicRow);
    actualContrast(mobile, `${theme} mobile contact row`, mobileTargets.contactRow);
  });
});

test("inline author declarations follow importance and precedence and fail closed", () => {
  const baseCascade = createCascade(ROOT, "ce.html");
  const darkTargets = operationElements("ce", "dark");
  const inlineDarkInput = cssElement("input", { inlineStyle: "background: #fff" }, darkTargets.modalInput.parent);
  assert.throws(() => assertSemanticWinner(
    baseCascade, "inline dark modal input", inlineDarkInput, "background-color", "--input-background"
  ), /ce\.html#inline/);

  const lightTargets = operationElements("ce", "light");
  const inlineWhiteText = cssElement("input", { inlineStyle: "color: #fff" }, lightTargets.modalInput.parent);
  assert.throws(() => actualContrast(baseCascade, "inline white text on light input", inlineWhiteText), /actual contrast 1\.00:1/);

  const inlineBorder = cssElement("input", { inlineStyle: "border-color: #011c40" }, lightTargets.modalInput.parent);
  assert.throws(() => assertSemanticWinner(
    baseCascade, "inline hard-coded border", inlineBorder, "border-color", "--input-border"
  ), /ce\.html#inline/);

  const importantCascade = createCascade(ROOT, "ce.html", { extraSources: [{
    name: "synthetic-inline-important-competition.css",
    css: ".ce-ops-center .modal input { background: var(--color-surface-muted) !important; }"
  }] });
  const inlineNormal = cssElement("input", { inlineStyle: "background: #fff" }, darkTargets.modalInput.parent);
  assertSemanticWinner(importantCascade, "stylesheet important over inline normal", inlineNormal,
    "background-color", "--color-surface-muted");

  const inlineImportant = cssElement("input", { inlineStyle: "background: #fff !important" }, darkTargets.modalInput.parent);
  assert.throws(() => assertSemanticWinner(
    importantCascade, "inline important override", inlineImportant, "background-color", "--color-surface-muted"
  ), /ce\.html#inline/);

  const runtimePanel = cssElement("div", {
    id: "history-panel",
    classes: ["history-modal__panel"],
    inlineStyle: "background: #fff"
  }, darkTargets.historyOverlay);
  assert.throws(() => assertSemanticWinner(
    baseCascade, "runtime history inline regression", runtimePanel, "background-color", "--modal-surface"
  ), /ce\.html#inline/);

  const malformedInline = cssElement("input", { inlineStyle: "background" }, darkTargets.modalInput.parent);
  assert.throws(() => baseCascade.winner(malformedInline, "background-color"), /unsupported inline declaration background/);
});

test("focused runtime and linked scans contain no unresolved migrated color contract", () => {
  const historySource = fs.readFileSync(path.join(ROOT, "js/history.js"), "utf8");
  const linkedCss = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  assert.doesNotMatch(historySource, DIRECT_COLOR);
  assert.doesNotMatch(historySource, /\bstyle\s*=|\.style\.|style\.cssText|setAttribute\(\s*["']style["']/i);
  assert.doesNotMatch(linkedCss, /var\(--c(?:\s*[,)]|\s+)/i, "legacy --c must not remain unresolved");

  const files = [
    "assets/css/design-tokens.css", "assets/css/theme-base.css", "app-shell.css",
    "styles.css", "employee-profiles.html"
  ];
  const combined = files.map((file) => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");
  const definitions = new Set(Array.from(combined.matchAll(/--([a-z0-9-]+)\s*:/gi), (match) => match[1]));
  const missing = Array.from(combined.matchAll(/var\(--([a-z0-9-]+)(\s*,)?/gi))
    .filter((match) => !definitions.has(match[1]) && !match[2])
    .map((match) => match[1]);
  assert.deepEqual(Array.from(new Set(missing)), []);
});

test("closed negative fixtures prove specificity, importance, source order, contrast, and token failures", () => {
  const ceTargets = operationElements("ce", "light");
  const expectSemanticFailure = (name, css, target, property, token, after) => {
    const cascade = createCascade(ROOT, "ce.html", { extraSources: [{ name, css, after }] });
    assert.throws(() => assertSemanticWinner(cascade, "modal input", target, property, token), new RegExp(name.replace(".", "\\.")));
  };

  expectSemanticFailure(
    "synthetic-specificity.css",
    ".ce-page.ce-ops-center .modal .form-group input { background: #011c40; }",
    ceTargets.modalInput, "background-color", "--input-background", "styles.css"
  );
  expectSemanticFailure(
    "synthetic-action-foreground.css",
    ".ce-page.ce-ops-center .modal .submit-btn { color: #26658c; }",
    ceTargets.modalPrimary, "color", "--color-primary-on-solid", "styles.css"
  );

  const lowStatusBackground = createCascade(ROOT, "ce.html", { extraSources: [{
    name: "synthetic-status-background.css", after: "styles.css",
    css: ".ce-page.ce-ops-center .card-band.band-escalated { background: #ffffff; }"
  }] });
  assert.throws(() => actualContrast(lowStatusBackground, "synthetic low status background", ceTargets.status("escalated")), /synthetic-status-background\.css/);

  const lowStatusForeground = createCascade(ROOT, "ce.html", { extraSources: [{
    name: "synthetic-status-foreground.css", after: "styles.css",
    css: ".ce-page.ce-ops-center .card-band.band-escalated { color: var(--color-danger); }"
  }] });
  assert.throws(() => actualContrast(lowStatusForeground, "synthetic low status foreground", ceTargets.status("escalated")), /synthetic-status-foreground\.css/);

  expectSemanticFailure(
    "synthetic-later-source.css",
    ".ce-ops-center .modal input { background: #011c40; }",
    ceTargets.modalInput, "background-color", "--input-background"
  );
  expectSemanticFailure(
    "synthetic-important.css",
    ".modal input { background: #011c40 !important; }",
    ceTargets.modalInput, "background-color", "--input-background", "styles.css"
  );

  const employeeTargets = employeeElements("light");
  const employeeCollision = createCascade(ROOT, "employee-profiles.html", { extraSources: [{
    name: "synthetic-employee-collision.css",
    css: ".employee-profiles-ops-center .workspace-contact-row strong { color: var(--color-surface-muted); }"
  }] });
  assert.throws(() => actualContrast(employeeCollision, "synthetic Employee collision", employeeTargets.value, employeeTargets.contact), /synthetic-employee-collision\.css/);

  const unresolved = createCascade(ROOT, "ce.html", { extraSources: [{
    name: "synthetic-unresolved.css",
    css: ".ce-page.ce-ops-center .modal input { background: var(--missing-semantic-token) !important; }"
  }] });
  assert.throws(() => effectiveColor(unresolved, ceTargets.modalInput, "background-color"), /unresolved semantic token --missing-semantic-token/);

  const recursive = createCascade(ROOT, "ce.html", { extraSources: [{
    name: "synthetic-recursive.css",
    css: ":root { --test-loop-a: var(--test-loop-b); --test-loop-b: var(--test-loop-a); } " +
      ".ce-page.ce-ops-center .modal input { background: var(--test-loop-a) !important; }"
  }] });
  assert.throws(() => effectiveColor(recursive, ceTargets.modalInput, "background-color"), /recursive semantic token/);

  const drawerDivider = createCascade(ROOT, "ce.html", { extraSources: [{
    name: "synthetic-divider.css",
    css: ".ce-page .drawer-body .kv { border-bottom-color: #26658c !important; }"
  }] });
  assert.throws(() => assertSemanticWinner(drawerDivider, "drawer divider", ceTargets.divider, "border-bottom-color", "--color-divider"), /synthetic-divider\.css/);

  const unsupported = createCascade(ROOT, "ce.html", { extraSources: [{
    name: "synthetic-unsupported.css",
    css: ".ce-page.ce-ops-center .modal input:has(.unsupported-contract) { background: #011c40 !important; }"
  }] });
  assert.throws(() => unsupported.winner(ceTargets.modalInput, "background-color"), /Unsupported applicable selector :has\(\)/);
});

test("navigation, permission, authentication, routes, and storage contracts remain present", () => {
  const shellSource = fs.readFileSync(path.join(ROOT, "js/app-shell.js"), "utf8");
  ["cctv.html", "ce.html", "complaints.html", "free-orders.html", "employee-profiles.html"].forEach((route) => {
    assert.ok(shellSource.includes(`route: '${route}'`), `navigation route ${route}`);
  });
  assert.match(shellSource, /CCPermissions\.getMyAccess/);

  SHARED_SHELL_PAGES.forEach((page) => {
    const source = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.match(source, /sessionStorage\.getItem\(['"]cc_auth['"]\)/, `${page} authentication gate`);
    assert.match(source, /sessionStorage\.getItem\(['"]cc_token['"]\)/, `${page} token gate`);
    assert.match(source, /src="js\/permissions\.js"/, `${page} permission runtime`);
  });

  const themeSource = fs.readFileSync(path.join(ROOT, "assets/js/theme.js"), "utf8");
  assert.match(themeSource, /const STORAGE_KEY = "cc_theme"/);
  assert.doesNotMatch(themeSource, /cc_auth|cc_token|cc_user|cc_role/);
});
