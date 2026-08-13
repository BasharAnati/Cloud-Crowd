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

function visibleText(markup) {
  return markup
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tableHeaders(source) {
  return Array.from(source.matchAll(/<table\b[\s\S]*?<\/table>/gi), (match) =>
    Array.from(match[0].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi), (header) => visibleText(header[1]))
  );
}

const COLUMN_CONTRACTS = {
  "attendance.html": [["Date", "Agent", "Supposed Shift Time", "Login Status", "Logout Status", "Extra Time", "Extra Time Duration", "Note", "Filled By"]],
  "employee-deductions.html": [["Employee", "Deduction Type", "Restaurant", "Order Number", "Original Amount", "Employee Discount", "Final Deduction", "Order Date", "Approved By", "Actions"]],
  "agent-training.html": [["Employee", "Restaurant / Brand", "Assignment Status", "Training Status", "Training Date", "Updated By", "Notes", "Actions"]],
  "restaurant-ratings.html": [["Restaurant", "Platform", "Month", "Week", "Rating", "Reviews Count", "Rating Date", "Updated By", "Actions"]],
  "weekly-quality.html": [["Date & Time", "Auditor", "Agent", "Restaurant", "Phone Number", "Total Score", "Recording", "Actions"]],
  "employee-profiles.html": [
    ["Date", "Type", "Restaurant", "Order Number", "Final Amount"],
    ["Date", "Restaurant / Brand", "Assignment", "Training Status", "Updated By"],
    ["Date", "Shift Time", "Login Status", "Logout Status", "Extra Time", "Note"]
  ],
  "client-profiles.html": [
    ["Employee", "Assignment Status", "Training Status", "Training Date", "Notes"],
    ["Date & Time", "Agent", "Auditor", "Total Score", "Details"],
    ["Platform", "Month", "Week", "Rating", "Reviews Count", "Rating Date", "Notes"]
  ],
  "anati-admin.html": [
    ["Username", "Display Name", "Email", "Account Type", "Link Status", "Linked Employee", "Role", "Status", "Actions"],
    ["Module", "View", "Create", "Edit", "Delete"]
  ]
};

test("all thirteen approved tables preserve exact visible columns and order", () => {
  let count = 0;
  for (const [page, expected] of Object.entries(COLUMN_CONTRACTS)) {
    const actual = tableHeaders(read(page)).filter((headers) => headers.length);
    assert.deepEqual(actual, expected, page);
    count += actual.length;
  }
  assert.equal(count, 13);
});

test("every table family preserves its behaviorally important minimum width", () => {
  const contracts = [
    ["attendance.html", /\.records-table\s*\{[\s\S]*?min-width\s*:\s*980px/i],
    ["employee-deductions.html", /\.records-table\s*\{[^}]*min-width\s*:\s*1180px/i],
    ["agent-training.html", /\.records-table\s*\{[^}]*min-width\s*:\s*1120px/i],
    ["restaurant-ratings.html", /\.records-table\s*\{[^}]*min-width\s*:\s*1080px/i],
    ["weekly-quality.html", /table\s*\{[^}]*min-width\s*:\s*980px/i],
    ["employee-profiles.html", /\.profile-table\s*\{[^}]*min-width\s*:\s*760px/i],
    ["client-profiles.html", /\.profile-table\s*\{[^}]*min-width\s*:\s*680px/i],
    ["anati-admin.html", /table\s*\{[^}]*min-width\s*:\s*760px/i]
  ];
  for (const [page, pattern] of contracts) assert.match(read(page), pattern, page);
});

function executeFiltered(page, functionName, globals, values, helpers = []) {
  const source = read(page);
  const elements = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, {
    value,
    options: [{ text: "" }],
    selectedIndex: 0
  }]));
  const context = {
    ...globals,
    document: { getElementById: (id) => elements[id] || { value: "", options: [{ text: "" }], selectedIndex: 0 } }
  };
  vm.runInNewContext([...helpers, functionName].map((name) => functionSource(source, name)).join("\n"), context, { filename: page });
  return Array.from(context[functionName]());
}

test("record-list filters preserve page-owned ordering behavior", () => {
  const attendance = executeFiltered("attendance.html", "getFilteredAttendanceRecords", {
    attendanceRecords: [
      { id: "old", date: "2026-01-01", createdAt: "2026-01-01T10:00:00Z", employeeName: "A" },
      { id: "new", date: "2026-01-02", createdAt: "2026-01-02T10:00:00Z", employeeName: "B" }
    ]
  }, { "records-search": "", "records-date-filter": "" }, ["getRecordEmployeeName"]);
  assert.deepEqual(attendance.map((record) => record.id), ["new", "old"]);

  const deductions = executeFiltered("employee-deductions.html", "getFilteredDeductions", {
    deductions: [{ deductionId: "second" }, { deductionId: "first" }]
  }, { search: "", "restaurant-filter": "", "type-filter": "", "month-filter": "" });
  assert.deepEqual(deductions.map((record) => record.deductionId), ["second", "first"]);

  const training = executeFiltered("agent-training.html", "getFilteredTraining", {
    trainingRecords: [{ trainingId: "two" }, { trainingId: "one" }]
  }, { search: "", "restaurant-filter": "", "training-filter": "", "assignment-filter": "" }, ["getRecordRestaurantName"]);
  assert.deepEqual(training.map((record) => record.trainingId), ["two", "one"]);

  const ratings = executeFiltered("restaurant-ratings.html", "getFilteredRatings", {
    ratings: [{ ratingId: "later-in-source" }, { ratingId: "earlier-in-source" }]
  }, { "restaurant-filter": "", "platform-filter": "", "month-filter": "", "week-filter": "" });
  assert.deepEqual(ratings.map((record) => record.ratingId), ["later-in-source", "earlier-in-source"]);
});

test("Weekly Quality filter executes its current newest-first contract", () => {
  const source = read("weekly-quality.html");
  const context = {
    document: { getElementById: (id) => ({ value: "", options: [{ text: "" }], selectedIndex: 0 }) }
  };
  vm.runInNewContext(["getAuditorName", "getAgentName", "getRecordRestaurantName", "getFilteredRecords"]
    .map((name) => functionSource(source, name)).join("\n"), context);
  const ordered = Array.from(context.getFilteredRecords([
    { id: "old", callDateTime: "2026-01-01 10:00:00" },
    { id: "new", callDateTime: "2026-01-02 10:00:00" }
  ]));
  assert.deepEqual(ordered.map((record) => record.id), ["new", "old"]);
});

test("profile table ordering, limits, and containment remain page-owned", () => {
  const employee = read("employee-profiles.html");
  assert.match(employee, /sortedDeductions\.slice\(0, 5\)/);
  assert.match(employee, /sortedTraining\.slice\(0, 5\)/);
  assert.match(employee, /attendance\.records\.slice\(0, 5\)/);
  assert.match(employee, /id="employee-workspace"[\s\S]*profile-table-wrap/);

  const client = read("client-profiles.html");
  assert.match(client, /latestAssignedRows[\s\S]*\.slice\(0, 6\)/);
  assert.match(client, /qualitySortTime\(b\) - qualitySortTime\(a\)[\s\S]*\.slice\(0, 5\)/);
  assert.match(client, /ratingSortTime\(b\) - ratingSortTime\(a\)[\s\S]*\.slice\(0, 5\)/);
  assert.match(client, /id="client-workspace"[\s\S]*<details class="quality-details">[\s\S]*<summary>View Details<\/summary>/);
});

test("row action order, button type, identifiers, and confirmation paths are frozen", () => {
  const cases = [
    ["employee-deductions.html", "renderDeductions", ["View Details", "Edit", "Delete"], ["data-view-id", "data-edit-id", "data-delete-id"]],
    ["agent-training.html", "renderTraining", ["View Details", "Edit", "Delete"], ["data-view-id", "data-edit-id", "data-delete-id"]],
    ["restaurant-ratings.html", "renderRatings", ["View", "Edit", "Archive"], ["data-view-id", "data-edit-id", "data-archive-id"]],
    ["weekly-quality.html", "renderRecords", ["View Details", "Delete"], ["data-details-id", "data-delete-id"]],
    ["anati-admin.html", "renderUsers", ["Edit", "Disable"], ["data-edit-user", "data-disable-user"]]
  ];
  for (const [page, renderer, labels, attributes] of cases) {
    const fn = functionSource(read(page), renderer);
    const visibleOrder = page === "employee-deductions.html" || page === "agent-training.html"
      ? [labels[0], ...labels.slice(1)]
      : labels;
    if (page === "employee-deductions.html" || page === "agent-training.html") {
      assert.match(fn, new RegExp(`>${labels[1]}<\\/button>[\\s\\S]*>${labels[2]}<\\/button>`), `${page} management action order`);
      assert.match(fn, new RegExp(`>${labels[0]}<\\/button>[\\s\\S]*\\$\\{managementActions\\}`), `${page} runtime insertion order`);
    } else {
      let cursor = -1;
      for (const label of visibleOrder) {
        const next = fn.indexOf(`>${label}</button>`);
        assert.ok(next > cursor, `${page} ${label} order`);
        cursor = next;
      }
    }
    for (const attribute of attributes) assert.ok(fn.includes(attribute), `${page} ${attribute}`);
    for (const button of fn.matchAll(/<button\b([^>]*)>/g)) assert.match(button[1], /type=["']button["']/i, `${page} button type`);
  }
  for (const page of ["employee-deductions.html", "agent-training.html", "restaurant-ratings.html", "weekly-quality.html", "anati-admin.html"]) {
    assert.match(read(page), /CloudCrowdConfirmation\.request/);
  }
});

test("status renderers pass exact raw values to the Sprint 1.7 registry", () => {
  const contracts = [
    ["agent-training.html", "statusBadge", "training-assignment", "Assigned"],
    ["client-profiles.html", "trainingStatusBadge", "training-assignment", "Assigned"],
    ["anati-admin.html", "adminStatusBadge", "admin-user", " Exact Raw Value "]
  ];
  for (const [page, name, expectedDomain, raw] of contracts) {
    const calls = [];
    const registry = {
      get(domain, raw) { calls.push(["get", domain, raw]); return { label: raw }; },
      getToneClass(domain, raw) { calls.push(["tone", domain, raw]); return "cc-status--neutral"; }
    };
    const context = { window: { CloudCrowdStatusRegistry: registry }, escapeHtml: String };
    vm.runInNewContext(functionSource(read(page), name), context);
    context[name](raw);
    assert.deepEqual(calls.map((call) => Array.from(call)), [
      ["get", expectedDomain, raw],
      ["tone", expectedDomain, raw]
    ], page);
  }
  const attendanceStatus = functionSource(read("attendance.html"), "createStatusCell");
  assert.match(attendanceStatus, /registry\.get\('attendance', status\)/);
  assert.match(attendanceStatus, /registry\.getToneClass\('attendance', status\)/);
  assert.match(functionSource(read("agent-training.html"), "renderTraining"), /statusBadge\(record\.assignmentStatus\)[\s\S]*statusBadge\(record\.trainingStatus\)/);
});

test("Admin matrix controls and payload serialization remain business controls", () => {
  const admin = read("anati-admin.html");
  const renderer = functionSource(admin, "renderModules");
  assert.match(renderer, /data-module-key=/);
  for (const field of ["canView", "canCreate", "canEdit", "canDelete"]) {
    assert.match(renderer, new RegExp(`data-access-field=["']${field}["']`));
  }
  const collector = functionSource(admin, "collectAccessPayload");
  assert.match(collector, /#modules-body tr\[data-module-key\]/);
  assert.match(collector, /record\[checkbox\.dataset\.accessField\] = checkbox\.checked/);
  assert.doesNotMatch(renderer, /select all|row selection/i);
});

test("loading, empty, error, and degraded meanings are separately characterized", () => {
  const attendance = read("attendance.html");
  assert.match(attendance, /Showing local browser records only/);
  assert.match(attendance, /attendanceSource = 'local'/);
  const weekly = read("weekly-quality.html");
  assert.match(weekly, /qualityRecordsSource = 'local'/);
  assert.match(weekly, /qualityApiAvailable = false/);
  for (const page of ["employee-deductions.html", "agent-training.html", "restaurant-ratings.html"]) {
    const source = read(page);
    assert.match(source, /Loading [^<]+\.\.\./);
    assert.match(source, /catch \(error\)[\s\S]*records-empty/);
    assert.match(source, /No [^']+ match this view\./);
  }
  const admin = read("anati-admin.html");
  assert.match(admin, /<tr><td[^>]*colspan="9"[^>]*>Loading users\.\.\.<\/td><\/tr>/);
  assert.match(admin, /<tr><td[^>]*colspan="5"[^>]*>Loading modules\.\.\.<\/td><\/tr>/);
  assert.match(admin, /No user profiles found/);
  assert.match(admin, /No modules found/);
});
