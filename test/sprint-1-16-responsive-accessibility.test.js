"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("Sprint 1.16 browser harness declares the required engines and local server", () => {
  const config = read("playwright.config.js");
  assert.match(config, /name: 'chromium'/);
  assert.match(config, /name: 'firefox'/);
  assert.match(config, /name: 'webkit'/);
  assert.match(config, /globalSetup/);
  assert.match(read("test/browser/static-server.js"), /path\.resolve\(root, relativePath\)/);
});

test("the Chromium matrix names every required width and active surface", () => {
  const source = read("test/browser/active-page-matrix.spec.js");
  for (const width of [1440, 1280, 1024, 768, 390, 360, 320]) assert.match(source, new RegExp(`\\b${width}\\b`));
  for (const file of [
    "index.html", "login.html", "dashboard.html", "cctv.html", "ce.html", "complaints.html",
    "free-orders.html", "free-order-requests.html", "free-order-share.html", "attendance.html",
    "employee-deductions.html", "agent-training.html", "weekly-quality.html", "restaurant-ratings.html",
    "employee-profiles.html", "client-profiles.html", "anati-admin.html", "system-update.html"
  ]) assert.match(source, new RegExp(file.replaceAll(".", "\\.")));
});

test("test state is injected at browser transport and storage boundaries", () => {
  const fixtures = read("test/browser/fixtures.js");
  assert.match(fixtures, /page\.addInitScript/);
  assert.match(fixtures, /page\.route\('\*\*\/\.netlify\/functions\/\*\*'/);
  assert.match(fixtures, /hasConfiguredAccess: true/);
  assert.match(fixtures, /legacyFallback: false/);
  assert.match(fixtures, /unavailable: false/);
});

test("shared full-width components use border-box geometry", () => {
  assert.match(read("assets/css/layouts/page-layout.css"), /\.cc-page-container\s*\{[^}]*box-sizing:\s*border-box/s);
  assert.match(read("assets/css/components/feedback.css"), /\.cc-feedback\s*\{[^}]*box-sizing:\s*border-box/s);
  assert.match(read("assets/css/components/tables.css"), /\.cc-table-wrap\.cc-table-wrap\s*\{[^}]*box-sizing:\s*border-box/s);
});

test("closed responsive navigation cannot intercept pointer input", () => {
  const shell = read("app-shell.css");
  assert.match(shell, /\.has-responsive-navigation \.cc-shell-nav-backdrop\[hidden\]\s*\{\s*display:\s*none;/s);
});

test("mobile shell targets and wrapping retain reachability", () => {
  const shell = read("app-shell.css");
  assert.match(shell, /body \.cc-shell-nav-trigger\.cc-button,[\s\S]*min-height:\s*44px/);
  assert.match(shell, /@media \(max-width:\s*620px\)[\s\S]*\.has-responsive-navigation \.cc-shell-topbar\s*\{[^}]*flex-wrap:\s*wrap/s);
});

test("Admin grid items may shrink inside the narrow viewport", () => {
  assert.match(read("assets/css/pages/admin-call-queue.css"), /\.admin-center-page \.grid > \*\s*\{\s*min-width:\s*0;/s);
});

test("Client Profiles restores detail focus after async render replacement", () => {
  const source = read("client-profiles.html");
  assert.match(source, /details updated\.`\);\s*if \(options\.focusWorkspace !== false\) clientMasterDetail\?\.focusDetail\?\.\(\);/s);
});

test("all fifteen applicable behavioral faults execute against production contracts", () => {
  const mutations = read("test/browser/mutation-contracts.spec.js") + read("test/browser/cross-engine-mutation-contracts.spec.js");
  for (let index = 1; index <= 15; index += 1) {
    assert.match(mutations, new RegExp(`M${String(index).padStart(2, "0")}\\b`));
  }
  assert.match(mutations, /page\.keyboard\.press/);
  assert.match(mutations, /getComputedStyle/);
  assert.match(mutations, /boundingBox/);
});

test("Call Queue browser acceptance remains shutdown-only", () => {
  const source = read("test/browser/critical-paths.spec.js");
  assert.match(source, /page\.goto\('\/call-queue\.html'\)/);
  assert.match(source, /toHaveURL\(\/\\\/dashboard\\\.html\$\//);
  assert.doesNotMatch(read("call-queue.html"), /<script\s+src="js\/app-shell\.js"/);
});

function permissionsHarness(source = read("js/permissions.js")) {
  let clock = 1_000;
  const requests = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  const protectedControl = { hidden: false, disabled: false };
  const document = {
    visibilityState: "visible",
    documentElement: {},
    body: { dataset: {}, insertBefore() {} },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    querySelectorAll() { return [protectedControl]; },
    querySelector() { return this.body; },
    getElementById() { return null; },
    createElement() { return { setAttribute() {}, textContent: "" }; }
  };
  const context = {
    console: { warn() {} },
    document,
    sessionStorage: { getItem(key) { return key === "cc_token" ? "token" : ""; } },
    MutationObserver: class { observe() {} },
    Date: class extends Date { static now() { return clock; } },
    fetch() { return new Promise((resolve) => requests.push({ resolve })); },
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    location: { href: "" }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: "js/permissions.js" });
  const valid = (canView) => ({
    ok: true,
    status: 200,
    async json() {
      return {
        ok: true, unavailable: false, legacyFallback: false, hasConfiguredAccess: true,
        access: [{ moduleKey: "attendance", canView, canCreate: false, canEdit: false, canDelete: false }]
      };
    }
  });
  const unavailable = (status = 503) => ({ ok: false, status, async json() { return {}; } });
  return {
    context, requests, valid, unavailable, protectedControl, windowListeners, documentListeners,
    advance(ms) { clock += ms; }
  };
}

async function settleMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test("forced permission consumers adopt newest authority in both network orders", async () => {
  for (const newestResolvesFirst of [false, true]) {
    const harness = permissionsHarness();
    const older = harness.context.CCPermissions.getMyAccessModel({ force: true });
    const newer = harness.context.CCPermissions.getMyAccessModel({ force: true });
    assert.equal(harness.requests.length, 2);
    if (newestResolvesFirst) {
      harness.requests[1].resolve(harness.valid(false));
      const newestModel = await newer;
      harness.requests[0].resolve(harness.valid(true));
      assert.equal((await older).access[0].canView, false);
      assert.equal(newestModel.access[0].canView, false);
    } else {
      harness.requests[0].resolve(harness.valid(true));
      await settleMicrotasks();
      harness.requests[1].resolve(harness.valid(false));
      const [olderModel, newerModel] = await Promise.all([older, newer]);
      assert.equal(olderModel.access[0].canView, false);
      assert.equal(newerModel.access[0].canView, false);
    }
    assert.equal((await harness.context.CCPermissions.getMyAccessModel()).access[0].canView, false);
  }
});

test("three forced consumers converge and current failure stays fail-closed", async () => {
  const three = permissionsHarness();
  const consumers = [0, 1, 2].map(() => three.context.CCPermissions.getMyAccessModel({ force: true }));
  three.requests[0].resolve(three.valid(true));
  three.requests[1].resolve(three.valid(true));
  await settleMicrotasks();
  three.requests[2].resolve(three.valid(false));
  const models = await Promise.all(consumers);
  assert.deepEqual(models.map((model) => model.access[0].canView), [false, false, false]);
  assert.equal(three.requests.length, 3, "adoption does not retry");

  const failed = permissionsHarness();
  const older = failed.context.CCPermissions.getMyAccessModel({ force: true });
  const current = failed.context.CCPermissions.getMyAccessModel({ force: true });
  failed.requests[0].resolve(failed.valid(true));
  await settleMicrotasks();
  failed.requests[1].resolve(failed.unavailable());
  const [olderModel, currentModel] = await Promise.all([older, current]);
  assert.equal(olderModel.available, false);
  assert.equal(currentModel.available, false);
  assert.equal(olderModel.reason, "permission-service-unavailable");
});

test("permission cache and lifecycle refresh semantics remain coherent", async () => {
  const harness = permissionsHarness();
  const first = harness.context.CCPermissions.getMyAccessModel();
  harness.requests[0].resolve(harness.valid(true));
  const firstModel = await first;
  assert.equal(await harness.context.CCPermissions.getMyAccessModel(), firstModel);
  assert.equal(harness.requests.length, 1, "fresh non-forced access uses the cache");

  harness.advance(harness.context.CCPermissions.cacheTtlMs + 1);
  const expired = harness.context.CCPermissions.getMyAccessModel();
  harness.requests[1].resolve(harness.valid(true));
  await expired;

  harness.context.CC_PAGE_MODULE_KEY = "attendance";
  harness.context.CC_PAGE_ACCESS = { moduleKey: "attendance", canView: true };
  harness.windowListeners.get("focus")();
  harness.documentListeners.get("visibilitychange")();
  await settleMicrotasks();
  assert.equal(harness.requests.length, 3, "focus and visibility coalesce");
  assert.equal(harness.protectedControl.hidden, true, "stale allow is disabled during refresh");
  harness.requests[2].resolve(harness.valid(true));
  await settleMicrotasks();
});

test("I09 behavioral mutant exposes the superseded consumer regression", async () => {
  const production = read("js/permissions.js");
  const mutant = production.replace(
    "if (generation !== requestGeneration) return adoptCurrentAuthority();",
    "if (generation !== requestGeneration) return unavailableModel('superseded-permission-response');"
  );
  assert.notEqual(mutant, production, "mutant must alter the real permission runtime");
  await assert.rejects(async () => {
    const harness = permissionsHarness(mutant);
    const older = harness.context.CCPermissions.getMyAccessModel({ force: true });
    const newer = harness.context.CCPermissions.getMyAccessModel({ force: true });
    harness.requests[0].resolve(harness.valid(true));
    await settleMicrotasks();
    harness.requests[1].resolve(harness.valid(false));
    const [olderModel] = await Promise.all([older, newer]);
    assert.equal(olderModel.available, true, "every consumer must receive usable current authority");
    assert.equal(olderModel.access[0].canView, false, "every consumer must receive current authority");
  }, { name: "AssertionError" });
});
