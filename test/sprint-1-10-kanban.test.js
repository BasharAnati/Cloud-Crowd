"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createCascade, element } = require("./css-cascade.js");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const PAGES = ["cctv.html", "ce.html", "complaints.html", "free-orders.html", "free-order-requests.html", "free-order-share.html"];
const VIEWPORTS = [1440, 1280, 1024, 768, 390, 360, 320];
const SHARED = ["cc-kanban", "cc-kanban--operations", "cc-kanban--workflow", "cc-kanban__column", "cc-kanban__header", "cc-kanban__title", "cc-kanban__count", "cc-kanban__stack", "cc-kanban__empty"];

function bodyClasses(page) {
  return read(page).match(/<body\b[^>]*class="([^"]*)"/i)?.[1].split(/\s+/).filter(Boolean) || [];
}

function tree(page) {
  const workflow = page.startsWith("free-order-") && !page.startsWith("free-orders");
  const key = page.replace(".html", "");
  const html = element("html", { attributes: { "data-theme": "light" } });
  const body = element("body", { classes: bodyClasses(page) }, html);
  const shell = element("div", { classes: workflow
    ? ["cc-shell-layout", "has-responsive-navigation"]
    : [`${key}-module-shell`, "cc-shell-layout"] }, body);
  const main = element("main", { classes: workflow
    ? ["cc-shell-main"]
    : [`${key}-workspace`, `${key}-main-area`, "cc-page-container", "cc-page-container--workspace"] }, shell);
  const container = workflow
    ? element("div", { classes: ["workflow-container", "cc-page-container", "cc-page-container--workspace"] }, main)
    : main;
  const wrapper = workflow ? container : element("div", { classes: [`${key}-board`, "ticket-list"] }, container);
  const board = element("section", {
    id: workflow ? (page.includes("requests") ? "requests-board" : "share-board") : "tickets",
    classes: ["cc-kanban", workflow ? "cc-kanban--workflow" : "cc-kanban--operations", ...(workflow ? ["board"] : [])]
  }, wrapper);
  const column = element("section", { classes: ["cc-kanban__column", workflow
    ? (page.includes("requests") ? "stage-column" : "share-column")
    : "group", ...(!workflow ? [`${key}-column`] : [])] }, board);
  const legacyHeader = workflow ? column : element("div", { classes: ["col-header"] }, column);
  const header = element("div", { classes: ["cc-kanban__header", ...(!workflow ? ["col-header-inner"] : [page.includes("requests") ? "stage-head" : "column-head"])] }, legacyHeader);
  const title = element("h2", { classes: ["cc-kanban__title"] }, header);
  const count = element("span", { classes: ["cc-kanban__count"] }, header);
  const stack = element("div", { classes: ["cc-kanban__stack"] }, column);
  const card = element("article", { classes: ["cc-card", workflow
    ? (page.includes("requests") ? "request-card" : "share-card")
    : "ticket-card", ...(!workflow ? [`${key}-ticket-card`] : [])] }, stack);
  const empty = element("div", { classes: ["cc-kanban__empty", ...(workflow ? ["empty-state"] : ["kanban-empty-state", "cc-empty-state"])] }, stack);
  const ancestors = [...new Set([wrapper, container, main, shell, body, html])];
  return { html, body, shell, main, container, wrapper, ancestors, board, column, header, title, count, stack, card, empty };
}

function resolved(cascade, target, property) {
  const winner = cascade.winner(target, property);
  assert.ok(winner, `${property} has a winner`);
  return cascade.resolveValue(target, winner.value);
}

function resolvedOrInitial(cascade, target, property, initialValue) {
  const winner = cascade.winner(target, property);
  return winner ? cascade.resolveValue(target, winner.value) : initialValue;
}

function assertHorizontalContract(cascade, targets, label) {
  assert.equal(resolved(cascade, targets.board, "display"), "flex", `${label} board layout`);
  assert.equal(resolved(cascade, targets.board, "width"), "100%", `${label} board width`);
  assert.equal(resolved(cascade, targets.board, "max-width"), "100%", `${label} board containment`);
  assert.equal(resolved(cascade, targets.board, "overflow-x"), "auto", `${label} board owns horizontal scrolling`);
  const flex = resolved(cascade, targets.column, "flex");
  if (label.startsWith("cctv.html@")) {
    assert.equal(flex, "1 1 0", `${label} V2 columns balance available workspace`);
  } else {
    assert.match(flex, /^0 0 clamp\(/, `${label} columns do not wrap or shrink`);
  }
  targets.ancestors.forEach((ancestor, index) => {
    const overflow = resolvedOrInitial(cascade, ancestor, "overflow-x", "visible");
    assert.ok(!["hidden", "clip"].includes(overflow), `${label} ancestor ${index} does not clip (${overflow})`);
    assert.ok(!["auto", "scroll"].includes(overflow), `${label} ancestor ${index} does not steal scrolling (${overflow})`);
  });
}

test("shared Kanban CSS exists with the complete token-safe primitive inventory", () => {
  const css = read("assets/css/components/kanban.css");
  for (const name of SHARED) assert.match(css, new RegExp(`\\.${name}\\b`), name);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  assert.doesNotMatch(css, /!important/i);
  for (const match of css.matchAll(/font-weight\s*:\s*(\d+)/g)) assert.ok(Number(match[1]) <= 700, match[0]);
  assert.doesNotMatch(css, /position\s*:\s*sticky/);
});

test("all six real pages load the shared foundation once and no shared Kanban runtime exists", () => {
  for (const page of PAGES) {
    assert.equal((read(page).match(/assets\/css\/components\/kanban\.css/g) || []).length, 1, page);
  }
  assert.equal(fs.existsSync(path.join(ROOT, "assets/js/components/kanban.js")), false);
});

test("actual Operations and Workflow renderers emit every required shared hook", () => {
  const operations = read("js/tickets-render.js");
  for (const name of ["cc-kanban", "cc-kanban--operations", "cc-kanban__column", "cc-kanban__header", "cc-kanban__title", "cc-kanban__count", "cc-kanban__stack", "cc-kanban__empty"]) {
    assert.match(operations, new RegExp(name), `Operations ${name}`);
  }
  for (const page of ["free-order-requests.html", "free-order-share.html"]) {
    const source = read(page);
    for (const name of ["cc-kanban", "cc-kanban--workflow", "cc-kanban__column", "cc-kanban__header", "cc-kanban__title", "cc-kanban__count", "cc-kanban__stack", "cc-kanban__empty"]) {
      assert.match(source, new RegExp(name), `${page} ${name}`);
    }
  }
});

test("actual cascade keeps desktop Kanban horizontal and CCTV mobile purpose-built at all seven widths", () => {
  for (const page of PAGES) for (const width of VIEWPORTS) {
    const targets = tree(page);
    for (const theme of ["light", "dark"]) {
      targets.html.attributes["data-theme"] = theme;
      const cascade = createCascade(ROOT, page, { viewportWidth: width });
      if (page === "cctv.html" && width <= 768) {
        assert.equal(resolved(cascade, targets.board, "display"), "block", `${page}@${width}/${theme} mobile board layout`);
        assert.equal(resolved(cascade, targets.board, "width"), "100%", `${page}@${width}/${theme} mobile board width`);
        assert.equal(resolved(cascade, targets.board, "overflow"), "visible", `${page}@${width}/${theme} mobile board does not scroll horizontally`);
        assert.equal(resolved(cascade, targets.column, "display"), "none", `${page}@${width}/${theme} inactive lane is removed from composition`);
        assert.equal(resolved(cascade, targets.column, "min-width"), "0", `${page}@${width}/${theme} mobile lane shrinks to viewport`);
        assert.equal(resolved(cascade, targets.column, "max-width"), "none", `${page}@${width}/${theme} mobile lane has no desktop cap`);
        assert.equal(resolved(cascade, targets.stack, "display"), "flex");
        continue;
      }
      assertHorizontalContract(cascade, targets, `${page}@${width}/${theme}`);
      const cctvGap = width <= 1024 ? "8px" : "1px";
      const ceGap = page === "ce.html" && width > 1024 ? "10px" : "16px";
      assert.equal(resolved(cascade, targets.board, "gap"), page === "cctv.html" ? cctvGap : ceGap, `${page}@${width}`);
      const expectedMin = page === "cctv.html" ? (width <= 1024 ? "280px" : "260px") : page.startsWith("free-order-") && !page.startsWith("free-orders") ? "300px" : "280px";
      const expectedMax = page === "cctv.html" ? "none" : expectedMin === "300px" ? "340px" : "320px";
      assert.equal(resolved(cascade, targets.column, "min-width"), expectedMin, `${page}@${width}`);
      assert.equal(resolved(cascade, targets.column, "max-width"), expectedMax, `${page}@${width}`);
      assert.equal(resolved(cascade, targets.stack, "display"), "flex");
    }
  }
});

test("horizontal contract rejects clipping anywhere in the real chain and scrolling on the wrong wrapper", () => {
  let targets = tree("ce.html");
  let cascade = createCascade(ROOT, "ce.html", { viewportWidth: 390, extraSources: [{
    name: "irr-02-wrapper-clip.css",
    css: ".ce-page.ce-ops-center .ce-board { overflow-x: hidden; }"
  }] });
  assert.throws(() => assertHorizontalContract(cascade, targets, "clipped Operations wrapper"), assert.AssertionError);

  targets = tree("free-order-requests.html");
  cascade = createCascade(ROOT, "free-order-requests.html", { viewportWidth: 390, extraSources: [{
    name: "irr-02-moved-scroll.css",
    css: ".workflow-page .workflow-container { overflow-x: auto; } .workflow-page .cc-kanban { overflow-x: visible; }"
  }] });
  assert.throws(() => assertHorizontalContract(cascade, targets, "misowned Workflow scrolling"), assert.AssertionError);
});

test("shared headers, counts, empty states, and card placement retain semantic foundations", () => {
  for (const page of PAGES) {
    const targets = tree(page);
    const cascade = createCascade(ROOT, page, { viewportWidth: 390 });
    assert.equal(resolved(cascade, targets.header, "display"), "flex");
    assert.equal(resolved(cascade, targets.count, "display"), "inline-flex");
    assert.equal(resolved(cascade, targets.empty, "display"), "grid");
    assert.equal(targets.title.tag, "h2");
    assert.ok(targets.card.classes.has("cc-card"));
  }
  assert.match(read("js/tickets-render.js"), /aria-labelledby/);
  assert.match(read("js/tickets-render.js"), /makeTicketCardInteractive\(card, \(\) => openTicketDrawerByCase\(getCaseDisplay\(ticket\), card\)\)/);
});

test("business ownership, action triggers, and excluded interactions stay out of the foundation", () => {
  const css = read("assets/css/components/kanban.css");
  assert.doesNotMatch(css, /status|stage|endpoint|payload|requestId|caseNumber/i);
  const combined = [read("js/tickets-render.js"), read("free-order-requests.html"), read("free-order-share.html")].join("\n");
  assert.doesNotMatch(combined, /draggable|droppable|dragstart|collapsed|aria-expanded/i);
  assert.match(read("free-order-requests.html"), /data-complete-id=/);
  assert.match(read("free-order-share.html"), /data-response-id=/);
  assert.match(read("free-order-share.html"), /data-done-id=/);
  assert.doesNotMatch(read("assets/js/components/status-registry.js"), /STATUS_COLUMNS|STAGE_COLUMNS|SHARE_COLUMNS|allowedTransitions/);
});

test("legacy stacking and clipping declarations no longer remain in Kanban scopes", () => {
  assert.doesNotMatch(read("styles.css"), /#tickets\s*\{[^}]*overflow-x\s*:\s*hidden/s);
  assert.doesNotMatch(read("app-shell.css"), /cctv-ops-center #tickets\s*\{[^}]*!important/s);
  for (const page of ["free-order-requests.html", "free-order-share.html"]) {
    assert.doesNotMatch(read(page), /@media \(max-width: 1040px\)\s*\{[\s\S]*?\.board\s*\{\s*grid-template-columns:\s*1fr/s);
  }
});

test("twelve valid isolated mutations are rejected by behavioral Kanban contracts", () => {
  const css = read("assets/css/components/kanban.css");
  const operations = read("js/tickets-render.js");
  const requests = read("free-order-requests.html");
  const mutations = [
    ["M1 column order", read("js/config.js"), (s) => s.replace("ticketDomainStatuses.ESCALATED,\n    ticketDomainStatuses.UNDER_REVIEW", "ticketDomainStatuses.UNDER_REVIEW,\n    ticketDomainStatuses.ESCALATED"), (s) => assert.match(s, /cctv:\s*\[\s*ticketDomainStatuses\.ESCALATED/)],
    ["M2 wrong grouping", operations, (s) => s.replace("const st = t.status || 'Uncategorized'", "const st = t.stage || 'Uncategorized'"), (s) => assert.match(s, /const st = t\.status/)],
    ["M3 wrong filtered count", operations, (s) => s.replace("const count = (grouped[status]||[]).length", "const count = visibleTickets.length"), (s) => assert.match(s, /const count = \(grouped\[status\]\|\|\[\]\)\.length/)],
    ["M4 empty removed", operations, (s) => s.replace("stack.appendChild(empty);", "void empty;"), (s) => assert.match(s, /stack\.appendChild\(empty\)/)],
    ["M5 clipping", css, (s) => `${s}\n.cc-kanban{overflow-x:hidden;}`, (s) => assert.doesNotMatch(s, /\.cc-kanban\s*\{overflow-x:hidden/)],
    ["M6 shrink", css, (s) => s.replace("min-width: 280px;", "min-width: 0;"), (s) => assert.match(s, /min-width:\s*280px/)],
    ["M7 stacking", css, (s) => `${s}\n@media(max-width:390px){.cc-kanban{display:grid;grid-template-columns:1fr}}`, (s) => assert.doesNotMatch(s, /grid-template-columns:1fr/)],
    ["M8 wrong identity", operations, (s) => s.replace("openTicketDrawerByCase(getCaseDisplay(ticket), card)", "openTicketDrawerByCase(ticket.caseNumber, card)"), (s) => assert.match(s, /openTicketDrawerByCase\(getCaseDisplay\(ticket\), card\)/)],
    ["M9 renderer disconnect", operations, (s) => s.replace("cc-kanban__column", "cc-kanban-column"), (s) => assert.match(s, /cc-kanban__column/)],
    ["M10 registry order", operations, (s) => s.replace("STATUS_COLUMNS[window.currentSection]", "window.CloudCrowdStatusRegistry.domains"), (s) => assert.match(s, /STATUS_COLUMNS\[window\.currentSection\]/)],
    ["M11 action disconnect", requests, (s) => s.replace("data-complete-id=", "data-disconnected-complete-id="), (s) => assert.match(s, /data-complete-id=/)],
    ["M12 detached trigger", operations, (s) => s.replace("getCaseDisplay(ticket), card)", "getCaseDisplay(ticket), document.createElement('div'))"), (s) => assert.match(s, /getCaseDisplay\(ticket\), card\)/)]
  ];
  for (const [name, source, mutate, validate] of mutations) {
    assert.doesNotThrow(() => validate(source), `${name} clean`);
    const changed = mutate(source);
    assert.notEqual(changed, source, `${name} applied`);
    assert.doesNotThrow(() => {
      if (source === css) {
        createCascade(ROOT, "ce.html", { viewportWidth: 390, extraSources: [{ name: `${name}.css`, css: changed }] });
      } else if (source === requests) {
        for (const match of changed.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
      } else {
        new vm.Script(changed);
      }
    }, `${name} parses after mutation`);
    assert.throws(() => validate(changed), assert.AssertionError, name);
  }
});
