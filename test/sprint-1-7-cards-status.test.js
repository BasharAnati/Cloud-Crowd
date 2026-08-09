"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { colorFromValue, contrastRatio, createCascade, effectiveColor, element, specificity } = require("./css-cascade.js");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const INTERNAL_PAGES = [
  "dashboard.html", "cctv.html", "ce.html", "complaints.html", "free-orders.html",
  "attendance.html", "employee-deductions.html", "agent-training.html", "restaurant-ratings.html",
  "weekly-quality.html", "employee-profiles.html", "client-profiles.html", "free-order-requests.html",
  "free-order-share.html", "anati-admin.html", "call-queue.html"
];

function loadRegistry(source = read("assets/js/components/status-registry.js")) {
  const context = {};
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "status-registry.js" });
  return context.CloudCrowdStatusRegistry;
}

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

function loadClientStatusBadge(source = read("client-profiles.html"), registrySource) {
  const registry = loadRegistry(registrySource);
  const context = {
    window: { CloudCrowdStatusRegistry: registry },
    escapeHtml: (value) => String(value)
  };
  vm.runInNewContext([
    functionSource(source, "statusLabel"),
    functionSource(source, "statusBadge")
  ].join("\n"), context, { filename: "client-profile-status.js" });
  return { registry, statusBadge: context.statusBadge };
}

function bodyClasses(page) {
  return read(page).match(/<body\b[^>]*class="([^"]*)"/i)?.[1].split(/\s+/).filter(Boolean) || [];
}

const EXPECTED = {
  "operations-cctv": ["Closed", "Under Review", "Escalated"],
  "operations-customer-experience": ["Closed", "Under Review", "Escalated", "Pending (Customer Call Required)"],
  "operations-complaints": ["Closed", "Under Review", "Escalated", "Pending (Customer Call Required)"],
  "complimentary-orders": ["New", "Active", "Taken"],
  attendance: ["On Time", "Left Early", "Late Logout"],
  "training-assignment": ["Assigned", "Unassigned"],
  "training-outcome": ["Trained", "Not Trained", "Coaching Needed", "No training or assignment needed"],
  employee: ["active", "inactive"],
  client: ["active", "inactive"],
  "free-order-requests": ["pending_details", "ready_to_share", "needs_response", "done"],
  "free-order-share": ["received", "needs_response", "done"],
  "admin-user": ["active", "disabled"],
  "call-queue": ["Need Call", "In Call", "Called", "Pending", "Done"]
};

test("registry exposes every exact domain value with immutable presentation-only metadata", () => {
  const registry = loadRegistry();
  assert.deepEqual(Array.from(registry.domains), Object.keys(EXPECTED));
  assert.ok(Object.isFrozen(registry));
  assert.ok(Object.isFrozen(registry.domains));
  for (const [domain, values] of Object.entries(EXPECTED)) {
    for (const raw of values) {
      const result = registry.get(domain, raw);
      assert.equal(result.rawValue, raw, `${domain}/${raw} raw`);
      assert.equal(result.known, true, `${domain}/${raw} known`);
      assert.ok(["neutral", "info", "success", "warning", "danger"].includes(result.tone));
      assert.ok(result.label);
      assert.ok(Object.isFrozen(result));
      for (const forbidden of ["nextStatus", "allowedTransitions", "endpoint", "permission", "filterValue", "storageValue", "APIValue"]) {
        assert.equal(forbidden in result, false, `${domain}/${raw} excludes ${forbidden}`);
      }
    }
  }
});

test("exact lookup preserves aliases, case, punctuation, and cross-domain meaning", () => {
  const registry = loadRegistry();
  const pending = registry.get("operations-customer-experience", "Pending (Customer Call Required)");
  assert.equal(pending.rawValue, "Pending (Customer Call Required)");
  assert.equal(pending.label, "Pending (Call Back)");
  assert.equal(registry.get("employee", "inactive").label, "Archived");
  assert.equal(registry.get("client", "inactive").label, "Inactive");
  assert.equal(registry.get("employee", "Active").known, false);
  assert.equal(registry.get("call-queue", "done").known, false);
  assert.equal(registry.get("free-order-requests", "Done").known, false);
  assert.equal(registry.get("operations-customer-experience", "Pending Customer Call Required").known, false);
});

test("unknown and missing values follow the safe fallback contract", () => {
  const registry = loadRegistry();
  const raw = "  Future Review State  ";
  const unknown = registry.get("operations-cctv", raw);
  assert.deepEqual(JSON.parse(JSON.stringify(unknown)), { rawValue: raw, label: raw, tone: "neutral", known: false });
  assert.equal(registry.get("missing-domain", "active").known, false);
  assert.equal(registry.get("employee", "ACTIVE").label, "ACTIVE");
  assert.equal(registry.get("employee", "").label, "Unknown");
  assert.equal(registry.get("employee", null).label, "Unknown");
  assert.doesNotThrow(() => registry.get("employee", Symbol("future")));
});

test("Client Profiles executes exact known and unknown status presentation through the registry", () => {
  const { registry, statusBadge } = loadClientStatusBadge();
  const cases = [
    ["active", "Active", "success", true],
    ["inactive", "Inactive", "neutral", true],
    ["suspended", "suspended", "neutral", false],
    ["Active", "Active", "neutral", false],
    ["ACTIVE", "ACTIVE", "neutral", false],
    [" active ", " active ", "neutral", false],
    [" ACTIVE ", " ACTIVE ", "neutral", false],
    ["active!", "active!", "neutral", false],
    ["", "Unknown", "neutral", false],
    ["   ", "   ", "neutral", false]
  ];

  for (const [raw, label, tone, known] of cases) {
    const presentation = registry.get("client", raw);
    assert.equal(presentation.rawValue, raw, `${JSON.stringify(raw)} raw`);
    assert.equal(presentation.label, label, `${JSON.stringify(raw)} label`);
    assert.equal(presentation.tone, tone, `${JSON.stringify(raw)} tone`);
    assert.equal(presentation.known, known, `${JSON.stringify(raw)} known`);
    assert.doesNotThrow(() => statusBadge(raw), `${JSON.stringify(raw)} renders`);
    const markup = statusBadge(raw);
    assert.match(markup, new RegExp(`cc-status--${tone}`), `${JSON.stringify(raw)} tone class`);
    assert.ok(markup.includes(`>${label}</span>`), `${JSON.stringify(raw)} exact visible label`);
    if (!known) {
      assert.notEqual(markup, '<span class="status-badge cc-status cc-status--success">Active</span>');
      assert.notEqual(markup, '<span class="status-badge cc-status cc-status--neutral">Inactive</span>');
    }
  }
});

test("Client Profiles rejected normalization mutation fails executable unknown-status behavior", () => {
  const source = read("client-profiles.html");
  const validate = (candidate) => {
    const { statusBadge } = loadClientStatusBadge(candidate);
    const suspended = statusBadge("suspended");
    const changedCase = statusBadge(" ACTIVE ");
    assert.match(suspended, /cc-status--neutral/);
    assert.ok(suspended.includes(">suspended</span>"));
    assert.match(changedCase, /cc-status--neutral/);
    assert.ok(changedCase.includes("> ACTIVE </span>"));
  };

  assert.doesNotThrow(() => validate(source), "clean production behavior");
  const rejectedHelper = `function statusBadge(status) {
      const safeStatus = status === 'inactive' ? 'inactive' : 'active';
      const registry = window.CloudCrowdStatusRegistry;
      const presentation = registry ? registry.get('client', safeStatus) : { label: statusLabel(safeStatus) };
      const toneClass = registry ? registry.getToneClass('client', safeStatus) : 'cc-status--neutral';
      return \`<span class="status-badge cc-status \${toneClass}">\${escapeHtml(presentation.label)}</span>\`;
    }`;
  const mutated = source.replace(functionSource(source, "statusBadge"), rejectedHelper);
  assert.notEqual(mutated, source, "rejected normalization mutation applied");
  assert.doesNotThrow(() => loadClientStatusBadge(mutated), "mutant compiles and loads");
  assert.match(loadClientStatusBadge(mutated).statusBadge("suspended"), />Active<\/span>/, "mutant reproduces rejected Active label");
  assert.throws(() => validate(mutated), /cc-status--neutral|suspended|ACTIVE/, "behavior contract detects mutant");
});

test("Operations compatibility inventory is source-supported and unsupported values stay unknown", () => {
  const registry = loadRegistry();
  const ticketRenderer = read("js/tickets-render.js");
  const supported = [
    "Open", "Follow-Up Needed", "No Response", "Call Back Scheduled",
    "In Progress", "Resolved", "Perfect Feedback"
  ];
  const unsupported = ["Called Customer Refused Return", "Scheduled for Pickup"];
  const domains = [
    "operations-cctv", "operations-customer-experience",
    "operations-complaints", "complimentary-orders"
  ];

  for (const raw of supported) {
    assert.ok(ticketRenderer.includes(`case '${raw}':`), `${raw} has current production support`);
    for (const domain of domains) assert.equal(registry.get(domain, raw).known, true, `${domain}/${raw}`);
  }
  for (const raw of unsupported) {
    assert.equal(ticketRenderer.includes(raw), false, `${raw} lacks production support`);
    for (const domain of domains) {
      const result = registry.get(domain, raw);
      assert.deepEqual(JSON.parse(JSON.stringify(result)), {
        rawValue: raw, label: raw, tone: "neutral", known: false
      }, `${domain}/${raw} unknown fallback`);
    }
  }
});

test("unsupported Operations compatibility mutation fails the behavioral inventory contract", () => {
  const source = read("assets/js/components/status-registry.js");
  const unsupported = "Scheduled for Pickup";
  const validate = (candidate) => {
    const registry = loadRegistry(candidate);
    for (const domain of ["operations-cctv", "operations-customer-experience", "operations-complaints", "complimentary-orders"]) {
      const result = registry.get(domain, unsupported);
      assert.equal(result.known, false, `${domain} known`);
      assert.equal(result.tone, "neutral", `${domain} tone`);
      assert.equal(result.label, unsupported, `${domain} exact label`);
    }
  };

  assert.doesNotThrow(() => validate(source), "clean production contract");
  const mutated = source.replace(
    "'Perfect Feedback': entry('Perfect Feedback', 'success', { compatibility: true })",
    "'Perfect Feedback': entry('Perfect Feedback', 'success', { compatibility: true }),\n    'Scheduled for Pickup': entry('Scheduled for Pickup', 'info', { compatibility: true })"
  );
  assert.notEqual(mutated, source, "unsupported compatibility mutation applied");
  assert.doesNotThrow(() => new vm.Script(mutated), "mutant syntax remains valid");
  assert.equal(loadRegistry(mutated).get("operations-cctv", unsupported).known, true, "mutant becomes known");
  assert.throws(() => validate(mutated), /known/, "source-of-truth contract detects mutant");
});

test("role, count, platform, and selection badges remain outside business-status domains", () => {
  const registry = loadRegistry();
  for (const value of ["admin", "manager", "Talabat", "Careem", "Yes", "No", "Selected", "12"]) {
    assert.equal(registry.get("employee", value).known, false, value);
  }
  assert.equal(registry.domains.includes("role"), false);
  assert.equal(registry.domains.includes("selection"), false);
  assert.equal(registry.domains.includes("platform"), false);
});

test("shared card and status CSS obey semantic-token and typography policy", () => {
  const cards = read("assets/css/components/cards.css");
  const status = read("assets/css/components/status.css");
  const combined = `${cards}\n${status}`;
  assert.doesNotMatch(combined, /!important/i);
  assert.doesNotMatch(combined, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  for (const match of combined.matchAll(/font-weight\s*:\s*(\d+)/gi)) {
    assert.ok(Number(match[1]) <= 700, match[0]);
  }
  for (const required of [".cc-card", ".cc-metric-card", ".cc-metric-grid", ".cc-empty-state", ".cc-planned-card"]) {
    assert.ok(cards.includes(required), required);
  }
  for (const tone of ["neutral", "info", "success", "warning", "danger"]) assert.ok(status.includes(`.cc-status--${tone}`));
  assert.match(cards, /min-width:\s*0/);
  assert.doesNotMatch(cards, /cursor\s*:\s*pointer|role\s*=|:hover/);
});

test("all internal pages load one deterministic Sprint 1.7 foundation", () => {
  for (const page of INTERNAL_PAGES) {
    const source = read(page);
    assert.equal((source.match(/assets\/css\/components\/cards\.css/g) || []).length, 1, `${page} cards`);
    assert.equal((source.match(/assets\/css\/components\/status\.css/g) || []).length, 1, `${page} status CSS`);
    assert.equal((source.match(/assets\/js\/components\/status-registry\.js/g) || []).length, 1, `${page} registry`);
    assert.ok(source.indexOf("design-tokens.css") < source.indexOf("components/cards.css"), `${page} token order`);
  }
});

test("Dashboard launchers remain semantic registry-owned anchors", () => {
  const source = read("js/app-shell.js");
  assert.match(source, /document\.createElement\('a'\)/);
  assert.match(source, /link\.className = 'cc-shell-module-card cc-card'/);
  assert.match(source, /link\.href = module\.route/);
  assert.match(source, /module\.showInDashboard !== false/);
  assert.match(source, /filterPermittedModules/);
  assert.doesNotMatch(source, /cc-shell-module-card[^\n]*(?:role|tabIndex)\s*=/);
});

test("metric, planned, empty, and complex record surfaces adopt presentation without behavior ownership", () => {
  for (const page of ["cctv.html", "ce.html", "complaints.html", "free-orders.html", "employee-deductions.html", "agent-training.html", "restaurant-ratings.html", "weekly-quality.html", "employee-profiles.html", "client-profiles.html", "free-order-requests.html", "free-order-share.html", "anati-admin.html"]) {
    assert.match(read(page), /cc-metric-card/, `${page} metric cards`);
  }
  assert.match(read("anati-admin.html"), /placeholder cc-planned-card/);
  assert.match(read("employee-profiles.html"), /future-card cc-planned-card/);
  assert.match(read("client-profiles.html"), /future-card cc-planned-card/);
  assert.match(read("js/tickets-render.js"), /ticket-card ce-ticket-card cc-card/);
  assert.match(read("call-queue.html"), /ticket cc-card/);
  assert.doesNotMatch(read("assets/css/components/cards.css"), /addEventListener|onclick|href|tabindex/i);
});

test("status consumers use domain-qualified presentation while raw business paths remain exact", () => {
  const sources = ["js/tickets-render.js", "attendance.html", "agent-training.html", "employee-profiles.html", "client-profiles.html", "free-order-requests.html", "free-order-share.html", "anati-admin.html", "call-queue.html"].map(read).join("\n");
  for (const domain of Object.keys(EXPECTED)) assert.ok(sources.includes(domain) || domain === "operations-customer-experience" || domain === "operations-complaints" || domain === "complimentary-orders", domain);
  assert.match(read("js/tickets-render.js"), /ticket\.status !== filters\.status/);
  assert.match(read("main.js"), /status: ticket\.status \|\| 'Under Review'/);
  assert.match(read("call-queue.html"), /const STORAGE_KEY = 'cc_call_queue_tickets_v1'/);
  assert.match(read("call-queue.html"), /updateTicket\(\{ status: 'Called' \}\)/);
  assert.match(read("free-order-requests.html"), /action=complete-details/);
  assert.match(read("free-order-share.html"), /action=share-done/);
});

test("actual shared card and status cascade resolves semantically in Light and Dark", () => {
  for (const theme of ["light", "dark"]) {
    const html = element("html", { attributes: { "data-theme": theme } });
    const body = element("body", { classes: ["dashboard-page"] }, html);
    const card = element("article", { classes: ["cc-metric-card"] }, body);
    const badge = element("span", { classes: ["cc-status", "cc-status--warning"] }, card);
    const cascade = createCascade(ROOT, "dashboard.html", { viewportWidth: 1440 });
    const cardBackground = cascade.winner(card, "background");
    assert.match(cardBackground.value, /var\(--card-background\)/);
    assert.ok(/^#/.test(cascade.resolveValue(card, cardBackground.value)));
    const foreground = effectiveColor(cascade, badge, "color").color;
    const background = effectiveColor(cascade, badge, "background").color;
    assert.ok(contrastRatio(foreground, background) >= 4.5, `${theme} warning contrast`);
  }
});

test("metric grid remains shrinkable at every required width", () => {
  for (const width of [1440, 1280, 1024, 768, 390, 360, 320]) {
    const html = element("html", { attributes: { "data-theme": "light" } });
    const body = element("body", { classes: ["dashboard-page"] }, html);
    const grid = element("section", { classes: ["cc-metric-grid"] }, body);
    const card = element("article", { classes: ["cc-metric-card"] }, grid);
    const cascade = createCascade(ROOT, "dashboard.html", { viewportWidth: width });
    assert.equal(cascade.resolveValue(card, cascade.winner(card, "min-width").value), "0", `${width} card shrink`);
    const columns = cascade.resolveValue(grid, cascade.winner(grid, "grid-template-columns").value);
    if (width <= 620) assert.equal(columns, "minmax(0, 1fr)", `${width} single column`);
    else assert.match(columns, /auto-fit/, `${width} fluid columns`);
  }
});

test("migrated metric descendants resolve to supported weights in actual page cascades", () => {
  const targets = [
    ["cctv.html", "cctv-stats", "cctv-stat-card", "cctv-stat-label"],
    ["ce.html", "ce-stats", "ce-stat-card", "ce-stat-label"],
    ["complaints.html", "complaints-stats", "complaints-stat-card", "complaints-stat-label"],
    ["free-orders.html", "free-orders-stats", "free-orders-stat-card", "free-orders-stat-label"],
    ...["employee-deductions.html", "agent-training.html", "restaurant-ratings.html", "weekly-quality.html", "client-profiles.html", "free-order-requests.html", "free-order-share.html"].map((page) => [page, "stats-grid", "stat-card", ""]),
    ["anati-admin.html", "stats", "stat", ""]
  ];
  for (const [page, gridClass, cardClass, labelClass] of targets) {
    const html = element("html", { attributes: { "data-theme": "light" } });
    const body = element("body", { classes: bodyClasses(page) }, html);
    const grid = element("section", { classes: [gridClass, "cc-metric-grid"] }, body);
    const card = element("article", { classes: [cardClass, "cc-metric-card"] }, grid);
    const label = element("span", { classes: labelClass ? [labelClass] : [] }, card);
    const value = element("strong", {}, card);
    const cascade = createCascade(ROOT, page, { viewportWidth: 1440 });
    for (const [name, target] of [["label", label], ["value", value]]) {
      const winner = cascade.winner(target, "font-weight");
      const resolved = cascade.resolveValue(target, winner.value);
      assert.ok(Number(resolved) <= 700, `${page} ${name} weight ${resolved} from ${winner.selector} in ${winner.sourceName}`);
    }
  }
});

test("twenty isolated in-memory mutations fail their intended Sprint 1.7 contracts", () => {
  const registrySource = read("assets/js/components/status-registry.js");
  const cards = read("assets/css/components/cards.css");
  const dashboard = read("js/app-shell.js");
  const requests = read("free-order-requests.html");
  const ratings = read("restaurant-ratings.html");
  const weekly = read("weekly-quality.html");
  const client = read("client-profiles.html");
  const queue = read("call-queue.html");
  const cases = [
    ["raw rename", registrySource, (s) => s.replace("Closed: entry('Closed'", "ClosedCase: entry('Closed'"), (s) => assert.equal(loadRegistry(s).get("operations-cctv", "Closed").known, true)],
    ["capitalization", registrySource, (s) => s.replace("active: entry('Active'", "Active: entry('Active'"), (s) => assert.equal(loadRegistry(s).get("employee", "active").known, true)],
    ["alias persistence", read("main.js"), (s) => s.replaceAll("status: ticket.status || 'Under Review'", "status: displayStatusName(ticket.status)"), (s) => assert.match(s, /status: ticket\.status \|\| 'Under Review'/)],
    ["alias filter", read("js/tickets-render.js"), (s) => s.replaceAll("ticket.status !== filters.status", "displayStatusName(ticket.status) !== filters.status"), (s) => assert.match(s, /ticket\.status !== filters\.status/)],
    ["cross-domain merge", registrySource, (s) => s.replace("inactive: entry('Archived', 'neutral')", "inactive: entry('Inactive', 'neutral')"), (s) => assert.equal(loadRegistry(s).get("employee", "inactive").label, "Archived")],
    ["unknown hidden", registrySource, (s) => s.replace("missing ? 'Unknown' : String(rawValue)", "'Unknown'"), (s) => assert.equal(loadRegistry(s).get("employee", "Future").label, "Future")],
    ["unknown normalized", registrySource, (s) => s.replace("registry[domain]?.[rawValue]", "registry[domain]?.[String(rawValue).toLowerCase()]"), (s) => assert.equal(loadRegistry(s).get("employee", "ACTIVE").known, false)],
    ["unknown throw", registrySource, (s) => s.replace("const missing =", "if (!metadata) throw new Error('unknown');\n    const missing ="), (s) => assert.doesNotThrow(() => loadRegistry(s).get("employee", "Future"))],
    ["transition ownership", registrySource, (s) => s.replace("entry('Done', 'success')", "entry('Done', 'success', { nextStatus: 'Closed' })"), (s) => assert.doesNotMatch(s, /nextStatus/)],
    ["transition target", queue, (s) => s.replace("status: 'Called'", "status: 'Done'"), (s) => assert.match(s, /updateTicket\(\{ status: 'Called' \}\)/)],
    ["metric scope", requests, (s) => s.replace("requests.length", "getFilteredRequests().length"), (s) => assert.match(s, /stat-total'\)\.textContent = requests\.length/)],
    ["rounding", weekly, (s) => s.replaceAll("Math.round", "Math.floor"), (s) => assert.match(s, /Math\.round/)],
    ["latest selection", ratings, (s) => s.replace("recordTime >= currentTime", "recordTime <= currentTime"), (s) => assert.match(s, /recordTime >= currentTime/)],
    ["tie breaking", ratings, (s) => s.replaceAll("a.name.localeCompare(b.name)", "b.name.localeCompare(a.name)"), (s) => assert.match(s, /a\.name\.localeCompare\(b\.name\)/)],
    ["intentional fallback", client, (s) => s.replace("textContent = '0'", "textContent = restaurants.length"), (s) => assert.match(s, /stat-agents'\)\.textContent = '0'/)],
    ["planned interaction", client, (s) => s.replace("<div class=\"future-card cc-planned-card\">", "<a href=\"#\" class=\"future-card cc-planned-card\">"), (s) => assert.doesNotMatch(s.match(/const futureModules[\s\S]*?\.join\(''\)/)?.[0] || "", /<a\b/)],
    ["launcher semantics", dashboard, (s) => s.replace("function createModuleCard(module) {\n    const link = document.createElement('a');", "function createModuleCard(module) {\n    const link = document.createElement('div');"), (s) => assert.match(s, /function createModuleCard\(module\) \{\s*const link = document\.createElement\('a'\)/)],
    ["dynamic handler", read("js/tickets-render.js"), (s) => s.replace("card.addEventListener('click'", "card.removeEventListener('click'"), (s) => assert.match(s, /card\.addEventListener\('click'/)],
    ["font weight", cards, (s) => `${s}\n.cc-card { font-weight: 800; }`, (s) => { for (const m of s.matchAll(/font-weight\s*:\s*(\d+)/g)) assert.ok(Number(m[1]) <= 700); }],
    ["specificity defeat", ".cc-status.cc-status--danger", (s) => `body .legacy-panel ${s}`, (s) => assert.ok(specificity(s).join("") <= specificity(".cc-status.cc-status--danger").join(""))]
  ];
  for (const [name, baseline, mutate, validate] of cases) {
    assert.doesNotThrow(() => validate(baseline), `${name} baseline`);
    const mutated = mutate(baseline);
    assert.notEqual(mutated, baseline, `${name} applied`);
    assert.throws(() => validate(mutated), `${name} detected`);
  }
});
