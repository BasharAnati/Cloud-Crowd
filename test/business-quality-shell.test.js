"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { contrastRatio, createCascade, effectiveColor, element: cssElement } = require("./css-cascade");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const pageNames = ["restaurant-ratings.html", "weekly-quality.html", "client-profiles.html"];
const pages = Object.fromEntries(pageNames.map((name) => [name, read(name)]));
const permissionsRuntime = read("js/permissions.js");
const shellRuntime = read("js/internal-page-shell.js");
const appShellRuntime = read("js/app-shell.js");
const maintenanceRuntime = read("js/maintenance.js");

class MemoryStorage {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.textContent = "";
    this.innerHTML = "";
    this.className = "";
    this.classList = new FakeClassList();
    this.dataset = {};
    this.style = {};
    this.options = [];
    this.selectedIndex = 0;
    this.files = [];
    this.listeners = new Map();
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute(name, value) { this[name] = String(value); }
  removeAttribute(name) { delete this[name]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  reset() {}
  reportValidity() { return true; }
  focus() {}
  scrollIntoView() {}
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.body = new FakeElement("body");
    this.body.dataset = {};
    this.documentElement = new FakeElement("html");
  }
  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new FakeElement(id));
    return this.elements.get(id);
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  createElement() { return new FakeElement(); }
}

function inlineScripts(source) {
  return [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .filter((script) => script.trim());
}

function businessScript(source) {
  return inlineScripts(source).sort((a, b) => b.length - a.length)[0];
}

function loadBusiness(source, marker, exposure, options = {}) {
  const script = businessScript(source).replace(
    /const access = await[^;]+;\s*if \(!access[^\n]+return;/,
    "const access = { canView: true, unavailable: false };"
  );
  const markerIndex = script.indexOf(marker);
  assert.ok(markerIndex > -1, `missing initialization marker: ${marker}`);
  const document = new FakeDocument();
  const sessionStorage = new MemoryStorage({
    cc_auth: "1", cc_token: "token", cc_role: options.role || "admin", cc_user: "Reviewer"
  });
  const localStorage = new MemoryStorage(options.localStorage);
  const fetchCalls = [];
  const context = {
    document,
    sessionStorage,
    localStorage,
    URL,
    console: { warn() {}, error() {}, log() {} },
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
    confirm: () => true,
    alert() {},
    CCPermissions: {
      requirePageAccess: async () => ({ canView: true }),
      canAccessModule: async () => true,
      getMyAccess: async () => ({ canView: true, legacyFallback: false }),
      applyPermissionVisibility() {}
    },
    fetch: async (url, requestOptions = {}) => {
      fetchCalls.push({ url, options: requestOptions });
      if (!context.fetchHandler) throw new Error("No fetch handler configured");
      return context.fetchHandler(url, requestOptions, fetchCalls.length - 1);
    }
  };
  context.window = context;
  context.globalThis = context;
  context.CloudCrowdConfirmation = { request: async (message) => context.confirm(message) };
  context.CloudCrowdFeedback = {
    inline(element, message) { element.textContent = message || ""; element.hidden = !message; return element; },
    banner(element, message) { element.textContent = message || ""; element.hidden = !message; return element; },
    clear(element) { element.textContent = ""; element.hidden = true; }
  };
  context.CloudCrowdMasterDetail = {
    create() {
      return {
        announce(message) { document.getElementById("client-detail-announcement").textContent = message || ""; },
        renderState({ title = "", message = "", action = "" } = {}) {
          document.getElementById("client-workspace").innerHTML = `${title}${message}${action}`;
        },
        showDetail() {},
        backToList() {},
        setSelectionHidden() {},
        syncInitial() {},
        getFocusOriginId() { return ""; },
        isMobile() { return false; }
      };
    }
  };
  vm.runInNewContext(`${script.slice(0, markerIndex)}\n${exposure}\n})();`, context);
  return { context, document, localStorage, fetchCalls, api: context.__api };
}

function count(source, pattern) { return (source.match(pattern) || []).length; }

function jsonResponse(data, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || (options.ok === false ? 500 : 200),
    async json() { return data; }
  };
}

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
    fetch: async (url, requestOptions) => {
      fetchCalls.push({ url, options: requestOptions });
      return jsonResponse({
        ok: true,
        legacyFallback: false,
        hasConfiguredAccess: true,
        access: [{ moduleKey, canView: true, canCreate: false, canEdit: false, canDelete: false }]
      });
    }
  };
  context.window = context;
  context.location = { href: `${moduleKey}.html`, pathname: `/${moduleKey}.html` };
  vm.runInNewContext(permissionsRuntime, context);
  vm.runInNewContext(appShellRuntime, context);
  return { context, fetchCalls };
}

test("Sprint 1.3C pages use the shared theme, shell, Page Header, and one h1", () => {
  Object.entries(pages).forEach(([name, source]) => {
    const themeIndex = source.indexOf('src="assets/js/theme.js"');
    const firstStylesheetIndex = source.indexOf('rel="stylesheet"');
    assert.ok(themeIndex > -1 && themeIndex < firstStylesheetIndex, `${name} resolves theme before CSS`);
    assert.match(source, /<html[^>]+data-theme="light"/);
    assert.match(source, /href="assets\/css\/design-tokens\.css"/);
    assert.match(source, /href="app-shell\.css"/);
    assert.match(source, /href="assets\/css\/theme-base\.css"/);
    assert.match(source, /href="assets\/css\/pages\/business-quality\.css"/);
    assert.match(source, /src="js\/auth\.js"/);
    assert.match(source, /src="js\/maintenance\.js" defer/);
    assert.match(source, /src="js\/app-shell\.js" defer/);
    assert.match(source, /src="js\/internal-page-shell\.js" defer/);
    assert.match(source, /class="cc-shell-layout has-responsive-navigation"/);
    assert.match(source, /<aside id="internal-app-sidebar" aria-label="Application navigation"><\/aside>/);
    assert.match(source, /<header id="internal-app-topbar" role="banner">/);
    assert.match(source, /id="internal-nav-backdrop" class="cc-shell-nav-backdrop"/);
    assert.match(source, /<header class="[^"]*\bcc-page-header\b[^"]*">/);
    assert.equal(count(source, /<h1\b/g), 1, `${name} has one h1`);
    assert.doesNotMatch(source, /class="(?:sidebar|topbar|app-shell|quality-shell|clients-shell|nav-item|breadcrumb|user-tools|logout|hero)\b/);
    assert.doesNotMatch(source, /<nav class="sidebar-nav"|onclick="logout\(\)"/);
  });
  assert.match(shellRuntime, /CloudCrowdAppShell\.initializeAppShell/);
});

test("Sprint 1.3C pages use registry IDs, permission keys, and only shared maintenance", () => {
  assert.match(pages["restaurant-ratings.html"], /data-shell-module="restaurant-ratings"/);
  assert.match(pages["weekly-quality.html"], /data-shell-module="weekly-quality"/);
  assert.match(pages["client-profiles.html"], /data-shell-module="client-profiles"/);
  assert.match(pages["restaurant-ratings.html"], /await[^\n]*requirePageAccess\('restaurant_ratings', \{ force: true \}\)/);
  assert.match(pages["weekly-quality.html"], /await[^\n]*requirePageAccess\('weekly_quality', \{ force: true \}\)/);
  assert.match(pages["client-profiles.html"], /await[^\n]*requirePageAccess\('client_profiles', \{ force: true \}\)/);
  assert.doesNotMatch(pages["weekly-quality.html"], /WEEKLY_QUALITY_MAINTENANCE_ENDPOINT|enforceWeeklyQualityMaintenanceMode/);
  assert.match(maintenanceRuntime, /const POLL_INTERVAL = 3000/);
  assert.match(shellRuntime, /CloudCrowdMaintenance\.createLifecycle/);
  pageNames.forEach((name) => assert.equal(count(pages[name], /admin-users\?my-access=1/g), 0));
});

test("one resolved permission model drives route access and shell filtering for every 1.3C page", async () => {
  const contracts = [
    ["restaurant-ratings", "restaurant_ratings", "restaurant-ratings.html"],
    ["weekly-quality", "weekly_quality", "weekly-quality.html"],
    ["client-profiles", "client_profiles", "client-profiles.html"]
  ];
  for (const [id, permissionKey, route] of contracts) {
    const loaded = loadPermissions(permissionKey);
    const modules = [{ id, permissionKey, route, order: 1, title: id, group: "Business", showInSidebar: true }];
    const [access, permitted] = await Promise.all([
      loaded.context.CCPermissions.requirePageAccess(permissionKey),
      loaded.context.CloudCrowdAppShell.filterPermittedModules(modules, { fallbackMode: "legacy" })
    ]);
    assert.equal(loaded.fetchCalls.length, 1);
    assert.equal(loaded.fetchCalls[0].url, "/.netlify/functions/admin-users?my-access=1");
    assert.equal(loaded.fetchCalls[0].options.headers.Authorization, "Bearer permission-token");
    assert.equal(access.canView, true);
    assert.equal(permitted.length, 1);
  }
});

test("Restaurant Ratings preserves calculations, filters, endpoints, and table contract", async () => {
  const loaded = loadBusiness(
    pages["restaurant-ratings.html"],
    "populateStaticSelects();",
    `window.__api = { setRatings(value) { ratings = value; }, setRestaurantsAvailable(value) { restaurantsAvailable = value; },
      latestRecordsByRestaurantPlatform, average, restaurantAverages, getFilteredRatings, collectRatingData,
      renderStats, saveRating, archiveRating, openModal, closeModal };`
  );
  const records = [
    { restaurantId: "r1", restaurantNameSnapshot: "Zulu", platform: "Talabat", rating: 4, reviewsCount: 100, ratingDate: "2026-01-01" },
    { restaurantId: "r1", restaurantNameSnapshot: "Zulu", platform: "Talabat", rating: 5, reviewsCount: 3, ratingDate: "2026-02-01" },
    { restaurantId: "r1", restaurantNameSnapshot: "Zulu", platform: "Careem", rating: 3, reviewsCount: 5, ratingDate: "2026-02-01" },
    { restaurantId: "r2", restaurantNameSnapshot: "Alpha", platform: "Talabat", rating: 4, reviewsCount: 20, ratingDate: "2026-02-01" },
    { restaurantId: "r2", restaurantNameSnapshot: "Alpha", platform: "Careem", rating: 4, reviewsCount: 20, ratingDate: "2026-02-01" }
  ];
  loaded.api.setRatings(records);
  const latest = loaded.api.latestRecordsByRestaurantPlatform();
  assert.equal(latest.length, 4);
  assert.equal(loaded.api.average(latest.filter((record) => record.platform === "Talabat")), 4.5);
  const ranked = loaded.api.restaurantAverages(latest)
    .sort((a, b) => b.average - a.average || b.reviews - a.reviews || a.name.localeCompare(b.name));
  assert.equal(ranked[0].name, "Alpha");
  loaded.api.renderStats();
  assert.equal(loaded.document.getElementById("stat-best").textContent, "Alpha", "production ranking uses review-count tie breaker");
  assert.equal(loaded.document.getElementById("stat-lowest").textContent, "Alpha");
  loaded.api.setRatings([
    { restaurantId: "z", restaurantNameSnapshot: "Zulu", platform: "Talabat", rating: 4, reviewsCount: 10, ratingDate: "2026-02-01" },
    { restaurantId: "a", restaurantNameSnapshot: "Alpha", platform: "Talabat", rating: 4, reviewsCount: 10, ratingDate: "2026-02-01" }
  ]);
  loaded.api.renderStats();
  assert.equal(loaded.document.getElementById("stat-best").textContent, "Alpha", "production ranking uses restaurant-name tie breaker");
  assert.equal(loaded.document.getElementById("stat-lowest").textContent, "Alpha");
  loaded.api.setRatings(records);
  loaded.document.getElementById("platform-filter").value = "Careem";
  loaded.document.getElementById("record-search").value = "zulu";
  assert.equal(loaded.api.getFilteredRatings().length, 1);

  loaded.api.setRestaurantsAvailable(true);
  Object.entries({
    "restaurant-id": "r1", platform: "Talabat", "month-name": "January", "week-name": "Week 1",
    rating: "4.75", "reviews-count": "31", "rating-date": "2026-01-08", notes: "Stable"
  }).forEach(([id, value]) => { loaded.document.getElementById(id).value = value; });
  loaded.context.fetchHandler = async () => jsonResponse({ ok: true, ratings: [] });
  await loaded.api.saveRating({ preventDefault() {}, currentTarget: { reportValidity: () => true } });
  assert.equal(loaded.fetchCalls[0].url, "/.netlify/functions/restaurant-ratings");
  assert.equal(loaded.fetchCalls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(loaded.fetchCalls[0].options.body), {
    restaurantId: "r1", platform: "Talabat", monthName: "January", weekName: "Week 1",
    rating: "4.75", reviewsCount: "31", ratingDate: "2026-01-08", notes: "Stable"
  });
  loaded.document.getElementById("rating-id").value = "rating-7";
  await loaded.api.saveRating({ preventDefault() {}, currentTarget: { reportValidity: () => true } });
  assert.equal(loaded.fetchCalls[2].url, "/.netlify/functions/restaurant-ratings?id=rating-7");
  assert.equal(loaded.fetchCalls[2].options.method, "PUT");
  loaded.api.setRatings([{ ratingId: "rating-7", platform: "Talabat", restaurantNameSnapshot: "Zulu" }]);
  loaded.fetchCalls.length = 0;
  await loaded.api.archiveRating("rating-7");
  assert.equal(loaded.fetchCalls[0].url, "/.netlify/functions/restaurant-ratings?id=rating-7");
  assert.equal(loaded.fetchCalls[0].options.method, "DELETE");

  const degraded = loadBusiness(
    pages["restaurant-ratings.html"], "populateStaticSelects();",
    "window.__api = { loadRestaurants, loadRatings };"
  );
  degraded.context.fetchHandler = async () => { throw new Error("offline"); };
  await degraded.api.loadRestaurants();
  assert.equal(degraded.document.getElementById("add-rating-btn").disabled, true);
  assert.match(degraded.document.getElementById("page-message").textContent, /Existing rating records remain available/);
  await degraded.api.loadRatings();
  assert.equal(degraded.document.getElementById("records-empty").textContent, "offline");

  const source = pages["restaurant-ratings.html"];
  assert.match(source, /const RESTAURANTS_ENDPOINT = '\/\.netlify\/functions\/restaurants'/);
  assert.match(source, /const RATINGS_ENDPOINT = '\/\.netlify\/functions\/restaurant-ratings'/);
  assert.match(source, /method: ratingId \? 'PUT' : 'POST'/);
  assert.match(source, /method: 'DELETE'/);
  assert.match(source, /\.records-table\{width:100%;min-width:1080px/);
  ["Restaurant", "Platform", "Month", "Week", "Rating", "Reviews Count", "Rating Date", "Updated By", "Actions"]
    .forEach((heading) => assert.match(source, new RegExp(`<th scope="col">${heading}</th>`)));
});

test("Weekly Quality preserves scoring, ordering, fallback, storage, and table contracts", async () => {
  const loaded = loadBusiness(
    pages["weekly-quality.html"],
    "populateScoreSelects();",
    `window.__api = { normalizeRecord, updateStats, getFilteredRecords, loadQualityRecords,
      importLocalQualityRecords, createQualityRecord, deleteQualityRecord, deleteRecord,
      loadActiveEmployees, loadActiveRestaurants,
      setRecords(value) { qualityRecords = value; }, setSource(value) { qualityRecordsSource = value; }, state() {
        return { qualityRecords, qualityRecordsSource, qualityApiAvailable };
      } };`,
    { localStorage: { cc_weekly_quality_records_v1: JSON.stringify([{ id: "local", totalScore: 70, createdAt: "2026-01-01" }]) } }
  );
  const normalized = loaded.api.normalizeRecord({ scores: {
    greetings: 10, knowledge: 10, upselling: 10, closure: 10, repeatingOrders: 10,
    phoneEtiquette: 10, clarity: 10, environment: 10, equipment: 10, aat: 10
  } });
  assert.equal(normalized.totalScore, 100);
  loaded.api.setRecords([
    { id: "older", totalScore: 73, createdAt: "2026-01-01", scores: {} },
    { id: "newer", totalScore: 88, createdAt: "2026-02-01", scores: {} }
  ]);
  assert.deepEqual(Array.from(loaded.api.getFilteredRecords(loaded.api.state().qualityRecords), (record) => record.id), ["newer", "older"]);
  loaded.api.updateStats(loaded.api.state().qualityRecords);
  assert.equal(loaded.document.getElementById("stat-average").textContent, "81%");
  assert.equal(loaded.document.getElementById("stat-highest").textContent, "88%");
  assert.equal(loaded.document.getElementById("stat-lowest").textContent, "73%");
  loaded.context.fetchHandler = async () => jsonResponse({
    ok: true,
    records: [{ id: "api-record", qualityId: "database-record", totalScore: 91, createdAt: "2026-03-01", scores: {} }]
  });
  await loaded.api.loadQualityRecords();
  assert.equal(loaded.api.state().qualityRecordsSource, "api");
  assert.equal(loaded.api.state().qualityApiAvailable, true);
  assert.equal(loaded.api.state().qualityRecords[0].id, "api-record");
  loaded.context.fetchHandler = async () => { throw new Error("offline"); };
  await loaded.api.loadQualityRecords();
  assert.equal(loaded.api.state().qualityRecordsSource, "local");
  assert.equal(loaded.api.state().qualityApiAvailable, false);
  assert.equal(loaded.api.state().qualityRecords[0].id, "local");

  loaded.fetchCalls.length = 0;
  loaded.context.fetchHandler = async (_url, options) => jsonResponse({ ok: true, record: JSON.parse(options.body || "{}") });
  const qualityRecord = {
    id: "legacy-1", callDateTime: "2026-01-08T10:00", auditorEmployeeId: "a1", auditorNameSnapshot: "Auditor",
    agentEmployeeId: "e1", agentNameSnapshot: "Agent", restaurantId: "r1", restaurantNameSnapshot: "Brand",
    phoneNumber: "123", notes: "Coaching", recording: { kind: "none" }, scores: normalized.scores, totalScore: 100
  };
  await loaded.api.createQualityRecord(qualityRecord);
  assert.equal(loaded.fetchCalls[0].url, "/.netlify/functions/weekly-quality");
  assert.equal(loaded.fetchCalls[0].options.method, "POST");
  assert.equal(JSON.parse(loaded.fetchCalls[0].options.body).legacyId, "legacy-1");
  loaded.api.setRecords([{ ...qualityRecord, id: "local-id", qualityId: "database-id" }]);
  loaded.api.setSource("api");
  await loaded.api.deleteQualityRecord("local-id");
  assert.equal(loaded.fetchCalls[1].url, "/.netlify/functions/weekly-quality?id=database-id");
  assert.equal(loaded.fetchCalls[1].options.method, "DELETE");

  loaded.api.setRecords([{ ...qualityRecord, id: "local-only" }]);
  loaded.api.setSource("local");
  await loaded.api.deleteRecord("local-only");
  assert.deepEqual(JSON.parse(loaded.localStorage.getItem("cc_weekly_quality_records_v1")), []);

  loaded.localStorage.setItem("cc_weekly_quality_records_v1", JSON.stringify([qualityRecord]));
  loaded.localStorage.removeItem("cc_weekly_quality_migration_v1_done");
  loaded.fetchCalls.length = 0;
  loaded.context.fetchHandler = async (_url, options) => jsonResponse(
    options.method === "POST" ? { ok: true, inserted: 1, skippedDuplicates: 0, failed: 0 } : { ok: true, records: [] }
  );
  await loaded.api.importLocalQualityRecords();
  assert.equal(loaded.fetchCalls[0].url, "/.netlify/functions/weekly-quality?action=bulk-import");
  assert.equal(loaded.fetchCalls[0].options.method, "POST");
  assert.equal(JSON.parse(loaded.fetchCalls[0].options.body).records.length, 1);
  assert.equal(loaded.localStorage.getItem("cc_weekly_quality_migration_v1_done"), "true");

  const qualityDegraded = loadBusiness(
    pages["weekly-quality.html"], "populateScoreSelects();",
    "window.__api = { loadActiveEmployees, loadActiveRestaurants, importLocalQualityRecords };",
    { localStorage: { cc_weekly_quality_records_v1: JSON.stringify([qualityRecord]) } }
  );
  qualityDegraded.context.fetchHandler = async () => { throw new Error("offline"); };
  await qualityDegraded.api.loadActiveEmployees();
  await qualityDegraded.api.loadActiveRestaurants();
  assert.equal(qualityDegraded.document.getElementById("employee-load-warning").classList.contains("show"), true);
  assert.equal(qualityDegraded.document.getElementById("restaurant-load-warning").classList.contains("show"), true);
  await qualityDegraded.api.importLocalQualityRecords();
  assert.equal(qualityDegraded.localStorage.getItem("cc_weekly_quality_migration_v1_done"), null);

  const source = pages["weekly-quality.html"];
  assert.match(source, /const SCORE_OPTIONS = \[0, 3, 5, 7, 10\]/);
  assert.equal(count(source, /class="score-select"/g), 10);
  assert.match(source, /Number\(record\.scores\[field\]\) < 7/);
  assert.match(source, /cc_weekly_quality_records_v1/);
  assert.match(source, /cc_weekly_quality_migration_v1_done/);
  assert.match(source, /\?action=bulk-import/);
  assert.match(source, /\.table-wrap[\s\S]*?table\s*\{[\s\S]*?min-width:\s*980px/);
  ["Date &amp; Time", "Auditor", "Agent", "Restaurant", "Phone Number", "Total Score", "Recording", "Actions"]
    .forEach((heading) => assert.match(source, new RegExp(`<th scope="col">${heading}</th>`)));
  assert.match(source, /accept="\.mp3,audio\/mpeg"/);
  assert.match(source, /\['http:', 'https:'\]/);
});

test("Client Profiles preserves role gates, fallback matching, integrations, calculations, and planned content", async () => {
  const loaded = loadBusiness(
    pages["client-profiles.html"],
    "document.querySelectorAll('.management-control')",
    `window.__api = { getClientQualityRecords, renderTrainingSection, renderQualityPerformanceSection,
      renderWeakAreasSection, renderDeliveryRatingsSection, getFilteredRestaurants,
      setRestaurants(value) { restaurants = value; }, saveClient, archiveRestaurant, readLogoFile,
      viewRestaurant, openModal, closeModal, canManageClients };`,
    { role: "manager", localStorage: { cc_weekly_quality_records_v1: JSON.stringify([
      { id: "id-match", restaurantId: "r1", restaurantNameSnapshot: "Different" },
      { id: "name-match", restaurantNameSnapshot: " Legacy Brand " },
      { id: "other", restaurantId: "r2", restaurantNameSnapshot: "Legacy Brand" }
    ]) } }
  );
  assert.equal(loaded.api.canManageClients, true);
  assert.deepEqual(Array.from(loaded.api.getClientQualityRecords({ restaurantId: "r1", brandName: "Legacy Brand" }), (record) => record.id), ["id-match", "name-match"]);
  const training = loaded.api.renderTrainingSection([
    { assignmentStatus: "Assigned", trainingStatus: "Trained", employeeNameSnapshot: "A" },
    { assignmentStatus: "Assigned", trainingStatus: "Not Trained", employeeNameSnapshot: "B" }
  ], "");
  assert.match(training, /Training Completion<\/span><strong>50%/);
  assert.match(training, /Assigned Agents<\/span><strong>2<\/strong>/);
  assert.match(training, /Trained<\/span><strong>1<\/strong>/);
  assert.match(training, /Not Trained<\/span><strong>1<\/strong>/);
  assert.match(training, /Coaching Needed<\/span><strong>0<\/strong>/);
  assert.match(training, /No Training Needed<\/span><strong>0<\/strong>/);
  const quality = loaded.api.renderQualityPerformanceSection([
    { agentNameSnapshot: "A", totalScore: 80, scores: {}, callDateTime: "2026-01-01 00:00:00" },
    { agentNameSnapshot: "B", totalScore: 60, scores: {}, callDateTime: "2026-01-02 00:00:00" }
  ]);
  assert.match(quality, /Average Quality Score<\/span><strong>70%/);
  assert.match(quality, /Top Agent<\/span><strong>A/);
  const weakAreas = loaded.api.renderWeakAreasSection([{ scores: {
    greetings: 2, knowledge: 4, upselling: 6, closure: 10, repeatingOrders: 10,
    phoneEtiquette: 10, clarity: 10, environment: 10, equipment: 10, aat: 10
  } }]);
  assert.ok(weakAreas.indexOf("Greetings") < weakAreas.indexOf("Knowledge"));
  assert.ok(weakAreas.indexOf("Knowledge") < weakAreas.indexOf("Upselling"));
  assert.doesNotMatch(weakAreas, /Closure/);
  const ratings = loaded.api.renderDeliveryRatingsSection([
    { platform: "Talabat", rating: 4, ratingDate: "2026-01-01", monthName: "January", weekName: "Week 1" },
    { platform: "Careem", rating: 5, ratingDate: "2026-01-02", monthName: "January", weekName: "Week 1" }
  ], "");
  assert.match(ratings, /Average Latest Rating<\/span><strong><span class="rating-value">4\.50/);

  Object.entries({
    "brand-name": "Cloud Kitchen", "logo-url": "https://example.test/logo.png", status: "Active",
    "call-center-number": "111", "original-restaurant-number": "222", "forwarded-number": "333",
    "brand-owner-name": "Owner", "brand-owner-phone": "444", "account-manager-name": "Account",
    "restaurant-manager-name": "Manager", notes: "Profile note"
  }).forEach(([id, value]) => { loaded.document.getElementById(id).value = value; });
  loaded.context.fetchHandler = async () => jsonResponse({ ok: true, restaurants: [] });
  await loaded.api.saveClient({ preventDefault() {}, currentTarget: { reportValidity: () => true } });
  assert.equal(loaded.fetchCalls[0].url, "/.netlify/functions/restaurants");
  assert.equal(loaded.fetchCalls[0].options.method, "POST");
  assert.equal(JSON.parse(loaded.fetchCalls[0].options.body).brandName, "Cloud Kitchen");
  loaded.document.getElementById("restaurant-id").value = "restaurant-4";
  await loaded.api.saveClient({ preventDefault() {}, currentTarget: { reportValidity: () => true } });
  const updateCall = loaded.fetchCalls.find((call) => call.options.method === "PUT");
  assert.equal(updateCall.url, "/.netlify/functions/restaurants?id=restaurant-4");
  assert.equal(updateCall.options.method, "PUT");

  loaded.api.setRestaurants([
    { restaurantId: "r1", brandName: "Cloud Kitchen", status: "active", accountManagerName: "Alice" },
    { restaurantId: "r2", brandName: "Old Kitchen", status: "inactive", accountManagerName: "Bob" }
  ]);
  loaded.document.getElementById("client-search").value = "alice";
  loaded.document.getElementById("status-filter").value = "active";
  assert.deepEqual(Array.from(loaded.api.getFilteredRestaurants(), (item) => item.restaurantId), ["r1"]);
  loaded.fetchCalls.length = 0;
  await loaded.api.archiveRestaurant("r1");
  assert.equal(loaded.fetchCalls[0].url, "/.netlify/functions/restaurants?id=r1");
  assert.equal(loaded.fetchCalls[0].options.method, "DELETE");

  await assert.rejects(() => loaded.api.readLogoFile({ type: "text/plain", size: 1 }), /must be an image/);
  await assert.rejects(() => loaded.api.readLogoFile({ type: "image/png", size: 750 * 1024 + 1 }), /750 KB or smaller/);
  loaded.context.FileReader = class {
    readAsDataURL() { this.result = "data:image/png;base64,AAAA"; this.onload(); }
  };
  assert.equal(await loaded.api.readLogoFile({ type: "image/png", size: 4 }), "data:image/png;base64,AAAA");

  loaded.fetchCalls.length = 0;
  loaded.context.fetchHandler = async (url) => {
    if (url === "/.netlify/functions/restaurants?id=r1") return jsonResponse({ ok: true, restaurant: { restaurantId: "r1", brandName: "Cloud Kitchen", status: "active" } });
    if (url === "/.netlify/functions/training?restaurantId=r1") return jsonResponse({ ok: true, training: [] });
    if (url === "./.netlify/functions/restaurant-ratings?restaurantId=r1") return jsonResponse({ ok: true, ratings: [] });
    if (url === "./.netlify/functions/weekly-quality?restaurantId=r1") return jsonResponse({ ok: true, records: [] });
    throw new Error(`unexpected URL ${url}`);
  };
  await loaded.api.viewRestaurant("r1");
  assert.deepEqual(loaded.fetchCalls.map((call) => call.url), [
    "/.netlify/functions/restaurants?id=r1",
    "/.netlify/functions/training?restaurantId=r1",
    "./.netlify/functions/restaurant-ratings?restaurantId=r1",
    "./.netlify/functions/weekly-quality?restaurantId=r1"
  ]);
  assert.match(loaded.document.getElementById("client-workspace").innerHTML, /Cloud Kitchen/);
  assert.equal(loaded.document.getElementById("profile-modal").classList.contains("open"), false);

  const source = pages["client-profiles.html"];
  assert.match(source, /const canManageClients = \['admin', 'manager'\]\.includes\(currentRole\)/);
  assert.match(source, /const MAX_LOGO_BYTES = 750 \* 1024/);
  assert.match(source, /readAsDataURL\(file\)/);
  assert.match(source, /TRAINING_ENDPOINT.*restaurantId/);
  assert.match(source, /RESTAURANT_RATINGS_ENDPOINT.*restaurantId/);
  assert.match(source, /WEEKLY_QUALITY_ENDPOINT.*restaurantId/);
  ["Complaints", "Free Orders", "Call Queue"].forEach((label) => assert.match(source, new RegExp(`'${label}'`)));
  assert.match(source, /id="stat-agents">0<\/strong>/);
  assert.match(source, /id="client-master-detail"/);
  assert.match(source, /id="client-workspace"/);
  assert.match(source, /\.profile-table\{width:100%;min-width:680px/);
});

test("Sprint 1.3C authentication, idle logout, scroll locks, and protected scope remain explicit", () => {
  Object.values(pages).forEach((source) => {
    assert.match(source, /readSessionValue\('cc_auth'\) !== '1'/);
    assert.match(source, /readSessionValue\('cc_token'\)/);
    assert.match(source, /readSessionValue\('cc_role'\)/);
    assert.match(source, /src="idle-logout\.js"/);
    assert.match(source, /function (?:openModal|openDetails)\(/);
    assert.match(source, /function (?:closeModal|closeDetails)\(/);
    assert.match(source, /cc-modal-lock/);
    assert.doesNotMatch(source, /document\.body\.style\.overflow/);
  });
});

function themedTargets(page, theme, viewportWidth = 1440) {
  const cascade = createCascade(ROOT, page, { viewportWidth });
  const html = cssElement("html", { attributes: { "data-theme": theme } });
  const body = cssElement("body", { classes: ["business-quality-page"] }, html);
  const shell = cssElement("div", { classes: ["cc-shell-layout", "has-responsive-navigation"] }, body);
  const main = cssElement("main", { classes: ["cc-shell-main"] }, shell);
  const container = cssElement("div", { classes: ["business-quality-container"] }, main);
  const card = cssElement("section", { classes: ["content-card"] }, container);
  const summaryCard = cssElement("article", { classes: ["stat-card"] }, container);
  const input = cssElement("input", { classes: ["control"] }, card);
  const tableWrapClass = page === "client-profiles.html" ? "profile-table-wrap" : "table-wrap";
  const tableWrap = cssElement("div", { classes: [tableWrapClass] }, card);
  const table = cssElement("table", { classes: ["records-table"] }, tableWrap);
  const thead = cssElement("thead", {}, table);
  const row = cssElement("tr", {}, thead);
  const tableHeader = cssElement("th", {}, row);
  const modal = cssElement("div", { classes: ["modal"] }, body);
  const modalPanel = cssElement("section", { classes: ["modal-panel"] }, modal);
  const profileSurface = cssElement("section", { classes: ["detail-section"] }, modalPanel);
  const error = cssElement("div", { classes: ["message", "error", "show"] }, container);
  return { cascade, body, card, summaryCard, input, tableWrap, tableHeader, modalPanel, profileSurface, error };
}

test("actual Light and Dark cascade winners cover migrated business content", () => {
  pageNames.forEach((page) => {
    const resolved = {};
    ["light", "dark"].forEach((theme) => {
      const targets = themedTargets(page, theme);
      resolved[theme] = {
        body: effectiveColor(targets.cascade, targets.body, "background-color").color,
        card: effectiveColor(targets.cascade, targets.card, "background-color").color,
        summary: effectiveColor(targets.cascade, targets.summaryCard, "background-color").color,
        input: effectiveColor(targets.cascade, targets.input, "background-color").color,
        table: effectiveColor(targets.cascade, targets.tableHeader, "background-color").color,
        modal: effectiveColor(targets.cascade, targets.modalPanel, "background-color").color,
        profile: effectiveColor(targets.cascade, targets.profileSurface, "background-color").color
      };
      assert.equal(targets.cascade.winner(targets.error, "background-color").value, "var(--color-danger-soft)");
      assert.equal(targets.cascade.winner(targets.error, "color").value, "var(--color-danger-text)");
      const text = effectiveColor(targets.cascade, targets.card, "color").color;
      assert.ok(contrastRatio(text, resolved[theme].card) >= 4.5, `${page} ${theme} card text contrast`);
    });
    ["body", "card", "summary", "input", "table", "modal", "profile"].forEach((surface) => {
      assert.notEqual(resolved.light[surface], resolved.dark[surface], `${page} ${surface} changes with theme`);
    });
  });
});

function weeklyQualityThemeTargets(theme, extraSources = []) {
  const cascade = createCascade(ROOT, "weekly-quality.html", { viewportWidth: 1440, extraSources });
  const html = cssElement("html", { attributes: { "data-theme": theme } });
  const body = cssElement("body", { classes: ["business-quality-page", "weekly-quality-page"] }, html);
  const container = cssElement("div", { classes: ["business-quality-container"] }, body);
  const card = cssElement("section", { classes: ["content-card"] }, container);
  const scoreField = cssElement("div", { classes: ["field", "score-field"] }, card);
  const scoreLabel = cssElement("label", {}, scoreField);
  const scoreControl = cssElement("select", { classes: ["score-select"] }, scoreField);
  const scoreSummary = cssElement("div", { classes: ["score-summary"] }, card);
  const scoreTotal = cssElement("strong", {}, scoreSummary);
  const tableWrap = cssElement("div", { classes: ["table-wrap"] }, card);
  const table = cssElement("table", {}, tableWrap);
  const tbody = cssElement("tbody", {}, table);
  const row = cssElement("tr", {}, tbody);
  const tableCell = cssElement("td", {}, row);
  const modal = cssElement("div", { classes: ["modal"] }, body);
  const panel = cssElement("section", { classes: ["modal-panel"] }, modal);
  const improvementList = cssElement("ul", { classes: ["improvement-list"] }, panel);
  const improvementItem = cssElement("li", {}, improvementList);
  return {
    cascade, scoreField, scoreLabel, scoreControl, scoreSummary, scoreTotal,
    table, tbody, tableCell, improvementItem
  };
}

function clientProfileThemeTargets(theme, extraSources = []) {
  const cascade = createCascade(ROOT, "client-profiles.html", { viewportWidth: 1440, extraSources });
  const html = cssElement("html", { attributes: { "data-theme": theme } });
  const body = cssElement("body", { classes: ["business-quality-page", "client-profiles-page"] }, html);
  const modal = cssElement("div", { classes: ["modal"] }, body);
  const panel = cssElement("section", { classes: ["modal-panel"] }, modal);
  const detail = cssElement("section", { classes: ["detail-section"] }, panel);
  const grid = cssElement("div", { classes: ["future-grid"] }, detail);
  const futureCard = cssElement("div", { classes: ["future-card"] }, grid);
  const futureLabel = cssElement("strong", {}, futureCard);
  return { cascade, futureCard, futureLabel };
}

function assertActualContrast(cascade, label, foregroundTarget, backgroundTarget = foregroundTarget) {
  const foreground = effectiveColor(cascade, foregroundTarget, "color");
  const background = effectiveColor(cascade, backgroundTarget, "background-color");
  const ratio = contrastRatio(foreground.color, background.color);
  assert.ok(ratio >= 4.5,
    `${label} actual contrast ${ratio.toFixed(2)}:1 from ${foreground.declaration.sourceName} / ${background.declaration.sourceName}`);
  return { foreground, background, ratio };
}

test("actual Weekly Quality descendants use readable semantic Light and Dark cascade winners", () => {
  const tbodyColors = { light: "#ffffff", dark: "#062947" };
  ["light", "dark"].forEach((theme) => {
    const targets = weeklyQualityThemeTargets(theme);
    assert.equal(targets.cascade.winner(targets.scoreField, "background-color").value, "var(--color-surface-muted)");
    assert.equal(targets.cascade.winner(targets.scoreLabel, "color").value, "var(--color-text)");
    assert.equal(targets.cascade.winner(targets.scoreControl, "background-color").value, "var(--input-background)");
    assert.equal(targets.cascade.winner(targets.scoreControl, "color").value, "var(--input-text)");
    assert.equal(targets.cascade.winner(targets.scoreSummary, "background-color").value, "var(--color-surface)");
    assert.equal(targets.cascade.winner(targets.scoreSummary, "color").value, "var(--color-text-muted)");
    assert.equal(targets.cascade.winner(targets.scoreTotal, "background-color").value, "var(--color-surface-muted)");
    assert.equal(targets.cascade.winner(targets.scoreTotal, "color").value, "var(--color-text)");
    const tbodyBackground = targets.cascade.winner(targets.tbody, "background-color");
    assert.equal(tbodyBackground.selector, ".weekly-quality-page table tbody");
    assert.equal(tbodyBackground.value, "var(--color-surface)");
    assert.equal(effectiveColor(targets.cascade, targets.tbody, "background-color").color, tbodyColors[theme]);
    assert.equal(targets.cascade.winner(targets.tableCell, "color").value, "var(--color-text)");
    assert.equal(targets.cascade.winner(targets.improvementItem, "background-color").value, "var(--color-warning-soft)");
    assert.equal(targets.cascade.winner(targets.improvementItem, "color").value, "var(--color-warning-text)");
    assertActualContrast(targets.cascade, `${theme} score label`, targets.scoreLabel, targets.scoreField);
    assertActualContrast(targets.cascade, `${theme} score control`, targets.scoreControl);
    assertActualContrast(targets.cascade, `${theme} score supporting text`, targets.scoreSummary);
    assertActualContrast(targets.cascade, `${theme} score total`, targets.scoreTotal);
    assertActualContrast(targets.cascade, `${theme} table cell`, targets.tableCell, targets.tbody);
    assertActualContrast(targets.cascade, `${theme} improvement item`, targets.improvementItem);
  });
});

test("actual Client Profiles planned-module labels remain readable in Light and Dark themes", () => {
  ["light", "dark"].forEach((theme) => {
    const targets = clientProfileThemeTargets(theme);
    assert.equal(targets.cascade.winner(targets.futureCard, "background-color").value, "var(--color-surface-muted)");
    assert.equal(targets.cascade.winner(targets.futureLabel, "color").value, "var(--color-text)");
    assertActualContrast(targets.cascade, `${theme} planned-module label`, targets.futureLabel, targets.futureCard);
  });
  ["Complaints", "Free Orders", "Call Queue"].forEach((label) => {
    assert.match(pages["client-profiles.html"], new RegExp(`'${label}'`));
  });
});

test("negative fixtures detect descendant specificity and contrast regressions", () => {
  const expectContrastFailure = (targets, label, foreground, background = foreground) => {
    assert.throws(() => assertActualContrast(targets.cascade, label, foreground, background), /actual contrast/);
  };

  let targets = weeklyQualityThemeTargets("dark", [{
    name: "fixture-weekly-score-total.css",
    css: ".weekly-quality-page .score-summary strong { background: #effbfc; color: #eefcff; }"
  }]);
  expectContrastFailure(targets, "fixture weekly score total", targets.scoreTotal);

  targets = weeklyQualityThemeTargets("dark", [{
    name: "fixture-weekly-table-cell.css",
    css: ".weekly-quality-page table tbody td { color: #244b60; }"
  }]);
  expectContrastFailure(targets, "fixture weekly table cell", targets.tableCell, targets.tbody);

  targets = weeklyQualityThemeTargets("dark", [{
    name: "fixture-weekly-tbody-background.css",
    css: ".weekly-quality-page table tbody { background: var(--color-text); }"
  }]);
  const tbodyBackground = targets.cascade.winner(targets.tbody, "background-color");
  const tableCellForeground = targets.cascade.winner(targets.tableCell, "color");
  assert.equal(tbodyBackground.sourceName, "fixture-weekly-tbody-background.css");
  assert.equal(tbodyBackground.value, "var(--color-text)");
  assert.equal(tableCellForeground.value, "var(--color-text)");
  const injectedTbodyColor = effectiveColor(targets.cascade, targets.tbody, "background-color").color;
  const resolvedTableCellColor = effectiveColor(targets.cascade, targets.tableCell, "color").color;
  assert.equal(injectedTbodyColor, resolvedTableCellColor);
  assert.equal(contrastRatio(resolvedTableCellColor, injectedTbodyColor), 1);
  expectContrastFailure(targets, "fixture weekly tbody background", targets.tableCell, targets.tbody);

  targets = weeklyQualityThemeTargets("dark", [{
    name: "fixture-weekly-improvement.css",
    css: ".weekly-quality-page .improvement-list li { color: var(--color-warning-soft); }"
  }]);
  expectContrastFailure(targets, "fixture weekly improvement", targets.improvementItem);

  const clientTargets = clientProfileThemeTargets("dark", [{
    name: "fixture-client-planned-label.css",
    css: ".client-profiles-page .future-card strong { color: #47677a; }"
  }]);
  expectContrastFailure(clientTargets, "fixture planned-module label", clientTargets.futureLabel, clientTargets.futureCard);

  targets = weeklyQualityThemeTargets("dark", [{
    name: "fixture-higher-specificity.css",
    css: ".business-quality-page.weekly-quality-page .score-field label { color: var(--color-surface-muted); }"
  }]);
  assert.equal(targets.cascade.winner(targets.scoreLabel, "color").sourceName, "fixture-higher-specificity.css");
  expectContrastFailure(targets, "fixture higher specificity", targets.scoreLabel, targets.scoreField);

  const semanticPairing = clientProfileThemeTargets("dark", [{
    name: "fixture-low-semantic-pair.css",
    css: ".client-profiles-page .future-card strong { color: var(--color-surface-muted); }"
  }]);
  expectContrastFailure(semanticPairing, "fixture low semantic pairing", semanticPairing.futureLabel, semanticPairing.futureCard);
});

test("wide tables retain horizontal access at desktop and narrow viewports", () => {
  const contracts = [
    ["restaurant-ratings.html", "1080px"],
    ["weekly-quality.html", "980px"],
    ["client-profiles.html", "680px"]
  ];
  contracts.forEach(([page, width]) => {
    [1440, 1280, 1024, 768, 390, 360, 320].forEach((viewportWidth) => {
      const targets = themedTargets(page, "light", viewportWidth);
      assert.equal(targets.cascade.winner(targets.tableWrap, "overflow-x").value, "auto");
      assert.equal(targets.cascade.winner(targets.tableHeader, "background-color").value, "var(--color-surface-muted)");
    });
    assert.match(pages[page], new RegExp(`min-width:\\s*${width}`));
  });
  assert.match(read("app-shell.css"), /\.cc-shell-main\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(pages["client-profiles.html"], /id="client-workspace"/);
  assert.doesNotMatch(pages["client-profiles.html"], /id="profile-modal"/);
  pageNames.forEach((page) => {
    assert.match(pages[page], /\.modal-panel\s*\{[\s\S]*?max-height:\s*[^;]+;[\s\S]*?overflow(?:-y)?:\s*auto/);
  });
});

test("modal and responsive-navigation locks remain independently owned", () => {
  Object.entries(pages).forEach(([name, source]) => {
    assert.match(source, /document\.body\.classList\.add\('cc-modal-lock'\)/, `${name} modal owns its lock`);
    assert.match(source, /document\.body\.classList\.remove\('cc-modal-lock'\)/, `${name} modal releases only its lock`);
    assert.doesNotMatch(source, /classList\.(?:add|remove|toggle)\('cc-shell-nav-lock'/, `${name} does not own navigation lock`);
  });
  assert.match(appShellRuntime, /classList\.toggle\('cc-shell-nav-lock', compact && isOpen\)/);
  assert.doesNotMatch(appShellRuntime, /cc-modal-lock/);
  assert.match(read("assets/css/pages/business-quality.css"), /body\.cc-modal-lock\s*\{\s*overflow:\s*hidden/);

  const modal = loadBusiness(
    pages["restaurant-ratings.html"],
    "populateStaticSelects();",
    "window.__api = { openModal, closeModal };"
  );
  modal.context.matchMedia = () => ({ matches: true, addEventListener() {} });
  vm.runInNewContext(appShellRuntime, modal.context);
  const navigation = modal.context.CloudCrowdAppShell.setupResponsiveNavigation({
    shell: new FakeElement("shell"),
    sidebar: new FakeElement("sidebar"),
    trigger: new FakeElement("trigger"),
    backdrop: new FakeElement("backdrop")
  });
  const bodyClasses = modal.document.body.classList;

  navigation.open();
  assert.equal(bodyClasses.contains("cc-shell-nav-lock"), true);
  navigation.close();
  assert.equal(bodyClasses.contains("cc-shell-nav-lock"), false);

  modal.api.openModal("rating-modal");
  assert.equal(bodyClasses.contains("cc-modal-lock"), true);
  modal.api.closeModal("rating-modal");
  assert.equal(bodyClasses.contains("cc-modal-lock"), false);

  navigation.open();
  navigation.close();
  modal.api.openModal("rating-modal");
  assert.equal(bodyClasses.contains("cc-modal-lock"), true);
  modal.api.closeModal("rating-modal");

  modal.api.openModal("rating-modal");
  modal.api.closeModal("rating-modal");
  navigation.open();
  assert.equal(bodyClasses.contains("cc-shell-nav-lock"), true);
  navigation.close();

  modal.api.openModal("rating-modal");
  navigation.open();
  modal.api.closeModal("rating-modal");
  assert.equal(bodyClasses.contains("cc-shell-nav-lock"), true);
  assert.equal(bodyClasses.contains("cc-modal-lock"), false);
  navigation.close();
  assert.equal(bodyClasses.contains("cc-shell-nav-lock"), false);
  assert.equal(bodyClasses.contains("cc-modal-lock"), false);
});
