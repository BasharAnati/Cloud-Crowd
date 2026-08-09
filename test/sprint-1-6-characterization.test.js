"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

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

function operationFields() {
  const context = { TICKET_DOMAIN_CONFIG: require("../shared/ticket-domain-config") };
  context.window = context;
  vm.runInNewContext(read("js/config.js"), context);
  return JSON.parse(JSON.stringify(context.formFields));
}

test("Operations field schemas freeze exact order, names, types, options, and file accepts", () => {
  const fields = operationFields();
  assert.deepEqual(Object.keys(fields), ["cctv", "ce", "free-orders", "complaints"]);
  assert.deepEqual(fields.cctv.map(({ name, type, accept = "" }) => [name, type, accept]), [
    ["status", "select", ""], ["branch", "select", ""], ["date", "text", ""], ["time", "text", ""],
    ["cameras", "multi-select", ""], ["sections", "multi-select", ""], ["staff", "multi-select", ""],
    ["reviewType", "select", ""], ["violations", "multi-select", ""], ["notes", "textarea", ""],
    ["cctvPdf", "file", "application/pdf"], ["actionTaken", "textarea", ""]
  ]);
  assert.deepEqual(fields.ce.map(({ name, type }) => [name, type]), [
    ["status", "select"], ["orderNumber", "text"], ["department", "select"], ["customerName", "text"],
    ["phone", "text"], ["creationDate", "datetime-local"], ["shift", "select"], ["orderType", "select"],
    ["branch", "select"], ["restaurant", "select"], ["channel", "select"], ["feedbackDate", "datetime-local"],
    ["issueCategory", "select"], ["customerNotes", "textarea"], ["actionTaken", "textarea"], ["satisfaction", "select"]
  ]);
  assert.deepEqual(fields["free-orders"].map(({ name, type, accept = "" }) => [name, type, accept]), [
    ["status", "select", ""], ["customerName", "text", ""], ["phone", "text", ""],
    ["orderDate", "datetime-local", ""], ["orderNumber", "text", ""], ["orderOnCirca", "file", "image/*"],
    ["discountAmount", "text", ""], ["reasonForDiscount", "textarea", ""], ["channel", "select", ""],
    ["decisionMaker", "text", ""], ["attached", "file", "image/*"], ["discountDate", "datetime-local", ""],
    ["newOrderNumber", "text", ""], ["deductionFrom", "text", ""], ["caseDescription", "textarea", ""]
  ]);
  assert.deepEqual(fields.complaints.map(({ name, type }) => [name, type]), [
    ["status", "select"], ["orderNumber", "text"], ["department", "select"], ["customerName", "text"],
    ["phone", "text"], ["creationDate", "text"], ["shift", "select"], ["orderType", "select"],
    ["branch", "select"], ["restaurant", "select"], ["channel", "select"], ["issueCategory", "select"],
    ["complaintDetails", "textarea"], ["actionTaken", "textarea"]
  ]);
  for (const section of Object.values(fields)) {
    for (const field of section.filter((item) => item.type === "select" || item.type === "multi-select")) {
      assert.ok(Array.isArray(field.options) && field.options.length > 0, `${field.name} keeps configured options`);
    }
  }
});

test("Operations create serialization and request envelope remain field-driven and exact", () => {
  const source = read("main.js");
  const bind = functionSource(source, "bindFormHandler");
  assert.match(bind, /for \(const field of formFields\[section\]\)/);
  assert.match(bind, /ticket\[field\.name\] = Array\.from\(multi\.querySelectorAll\('input:checked'\)\)\.map\(cb=>cb\.value\)/);
  assert.match(bind, /ticket\[field\.name\] = \{\s*name: 'pasted', type: 'image\/\*', dataUrl: input\.dataset\.pasted\s*\}/);
  assert.match(bind, /method: 'POST'/);
  assert.match(bind, /body: JSON\.stringify\(\{\s*section,\s*status: ticket\.status \|\| 'Under Review',\s*payload: ticket,\s*changedBy: CURRENT_USER/);
  assert.match(bind, /ticket\.caseNumber = nextCaseNumber\('cctv'\)/);
  assert.match(bind, /ticket\.caseNumber = ticket\.orderNumber \|\| ''/);
});

test("Operations filter predicates execute combined matching without reordering records", () => {
  const source = read("js/tickets-render.js");
  const names = ["normalizeFilterText", "arrayText", "ceTicketMatchesFilters", "complaintTicketMatchesFilters", "cctvTicketMatchesFilters", "freeOrderTicketMatchesFilters"];
  const context = {};
  vm.runInNewContext(`${names.map((name) => functionSource(source, name)).join("\n")}; Object.assign(this, { ${names.join(", ")} });`, context);
  const records = [
    { id: "a", status: "Under Review", branch: "North", restaurant: "R1", issueCategory: "Late", orderNumber: "100", customerName: "Aya", phone: "111" },
    { id: "b", status: "Closed", branch: "South", restaurant: "R2", issueCategory: "Wrong", orderNumber: "200", customerName: "Bash", phone: "222" },
    { id: "c", status: "Under Review", branch: "North", restaurant: "R1", issueCategory: "Late", orderNumber: "300", customerName: "Celine", phone: "333" }
  ];
  assert.deepEqual(Array.from(records.filter((item) => context.ceTicketMatchesFilters(item, { query: "3", status: "Under Review", branch: "North", restaurant: "R1" })).map(({ id }) => id)), ["c"]);
  assert.deepEqual(Array.from(records.filter((item) => context.complaintTicketMatchesFilters(item, { query: "", status: "Under Review", branch: "North", restaurant: "R1", issueCategory: "Late" })).map(({ id }) => id)), ["a", "c"]);
  const cctv = [
    { id: "x", status: "Escalated", branch: "A", reviewType: "Live", violations: ["Safety"], staff: ["Omar"], cameras: ["1"], sections: ["Kitchen"], notes: "spill" },
    { id: "y", status: "Closed", branch: "B", reviewType: "Review", violations: ["Uniform"], staff: ["Lina"], cameras: ["2"], sections: ["Front"], notes: "clear" }
  ];
  assert.deepEqual(Array.from(cctv.filter((item) => context.cctvTicketMatchesFilters(item, { query: "spill", status: "Escalated", branch: "A", reviewType: "Live", policy: "Safety", staff: "Omar" })).map(({ id }) => id)), ["x"]);
  const free = [
    { id: "f1", status: "New", channel: "Phone", decisionMaker: "Ali", orderNumber: "10", customerName: "Nour", phone: "1", newOrderNumber: "20" },
    { id: "f2", status: "New", channel: "Phone", decisionMaker: "Ali", orderNumber: "11", customerName: "Dana", phone: "2", newOrderNumber: "" }
  ];
  assert.deepEqual(Array.from(free.filter((item) => context.freeOrderTicketMatchesFilters(item, { query: "", status: "New", channel: "Phone", decisionMaker: "Ali", newOrderNumber: "yes" })).map(({ id }) => id)), ["f1"]);
});

test("all non-Operations filter families keep live input/change handlers and page-owned renderers", () => {
  const contracts = [
    ["attendance.html", "agent-search", "renderAttendanceRecords"],
    ["employee-deductions.html", "employee-search", "renderDeductions"],
    ["agent-training.html", "employee-search", "renderTraining"],
    ["restaurant-ratings.html", "record-search", "renderRatings"],
    ["weekly-quality.html", "record-search", "renderRecords"],
    ["employee-profiles.html", "employee-search", "renderEmployees"],
    ["client-profiles.html", "client-search", "renderRestaurants"],
    ["free-order-requests.html", "search-filter", "renderBoard"],
    ["free-order-share.html", "search-filter", "renderBoard"]
  ];
  for (const [file, id, renderer] of contracts) {
    const source = read(file);
    assert.match(source, new RegExp(`${id}[\\s\\S]{0,320}'input'[\\s\\S]{0,120}${renderer}`), file);
  }
});

test("native validation attributes and critical business wording are frozen", () => {
  const combined = ["main.js", "weekly-quality.html", "client-profiles.html", "free-order-requests.html", "free-order-share.html", "anati-admin.html"].map(read).join("\n");
  for (const wording of [
    "PDF only.", "PDF too large. Please upload under 8MB.", "Please select an MP3 recording.",
    "Logo upload must be an image file.", "Logo file must be 750 KB or smaller.",
    "Request could not be saved.", "Details could not be saved.", "Response note could not be saved.",
    "Anati admin access is required.", "Administrator access is required to delete tickets.", "Select a user first."
  ]) assert.ok(combined.includes(wording), wording);
  assert.match(read("weekly-quality.html"), /pattern="\\d\{4\}-\\d\{2\}-\\d\{2\} \\d\{2\}:\\d\{2\}:\\d\{2\}"/);
  assert.match(read("weekly-quality.html"), /accept="\.mp3,audio\/mpeg"/);
  assert.match(read("client-profiles.html"), /accept="image\/\*"/);
  assert.match(read("free-order-requests.html"), /type="number" min="0" step="0\.01" required/);
});

test("form action types and characterized multi-select removal intent stay non-submit", () => {
  for (const file of ["cctv.html", "ce.html", "complaints.html", "free-orders.html"]) {
    const source = read(file);
    assert.match(source, /<button type="submit" class="submit-btn">Submit<\/button>/, file);
    assert.match(source, /<button type="button" class="cancel-btn" onclick="closeModal\(\)">Cancel<\/button>/, file);
  }
  const update = functionSource(read("main.js"), "updateSelected");
  assert.match(update, /const x=document\.createElement\('button'\); x\.textContent='x'/);
  assert.match(update, /x\.type='button'/, "chip removal explicitly preserves its non-submit intent");
  assert.match(update, /x\.setAttribute\('aria-label', `Remove \$\{cb\.value\}`\)/);
  for (const file of ["attendance.html", "weekly-quality.html"]) assert.match(read(file), /type="reset"/, file);
  for (const file of ["employee-profiles.html", "client-profiles.html", "free-order-requests.html", "free-order-share.html"]) {
    assert.match(read(file), /type="button"/, `${file} helper controls stay non-submit`);
  }
});

test("dependent controls and Call Queue silent rejection remain behavior-owned", () => {
  for (const [file, id] of [
    ["attendance.html", "agent"], ["employee-deductions.html", "employee-id"],
    ["agent-training.html", "employee-id"], ["agent-training.html", "restaurant-id"],
    ["restaurant-ratings.html", "restaurant-id"], ["weekly-quality.html", "agent-name"]
  ]) assert.match(read(file), new RegExp(`id="${id}"[^>]*disabled`), `${file} ${id}`);
  const queue = read("call-queue.html");
  assert.match(functionSource(queue, "negativeResult"), /if \(!ticket \|\| !reason\) return;/);
  assert.match(functionSource(queue, "addNote"), /if \(!ticket \|\| !value\) return;/);
});
