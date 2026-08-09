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

test("exact Operations status domains and display alias are frozen", () => {
  const config = require("../shared/ticket-domain-config");
  assert.deepEqual(config.statusOptions, {
    cctv: ["Closed", "Under Review", "Escalated"],
    ce: ["Closed", "Under Review", "Escalated", "Pending (Customer Call Required)"],
    complaints: ["Closed", "Under Review", "Escalated", "Pending (Customer Call Required)"],
    "free-orders": ["New", "Active", "Taken"]
  });
  const context = { TICKET_DOMAIN_CONFIG: config };
  context.window = context;
  vm.runInNewContext(read("js/config.js"), context);
  assert.equal(context.window.STATUS_DISPLAY_MAP["Pending (Customer Call Required)"], "Pending (Call Back)");
});

test("HR and profile domains preserve exact case, punctuation, and labels", () => {
  const attendance = read("attendance.html");
  for (const value of ["On Time", "Left Early", "Late Logout"]) assert.match(attendance, new RegExp(`<option>${value}<\\/option>`));
  const training = read("agent-training.html");
  for (const value of ["Assigned", "Unassigned", "Trained", "Not Trained", "Coaching Needed", "No training or assignment needed"]) {
    assert.ok(training.includes(value), value);
  }
  assert.match(read("employee-profiles.html"), /employee\.status === 'active'[\s\S]*employee\.status === 'inactive'/);
  assert.match(read("client-profiles.html"), /restaurant\.status === 'active'[\s\S]*restaurant\.status === 'inactive'/);
});

test("workflow, Admin, and Call Queue domain values and order are frozen", () => {
  const requests = read("free-order-requests.html");
  for (const value of ["pending_details", "ready_to_share", "needs_response", "done"]) assert.ok(requests.includes(value), value);
  const share = read("free-order-share.html");
  for (const value of ["received", "needs_response", "done"]) assert.ok(share.includes(value), value);
  assert.match(read("anati-admin.html"), /<option value="active">Active<\/option><option value="disabled">Disabled<\/option>/);
  assert.match(read("call-queue.html"), /const STATUSES = \['Need Call', 'In Call', 'Called', 'Pending', 'Done'\]/);
});

test("filters, payloads, storage, and transition targets continue to use raw values", () => {
  const tickets = read("js/tickets-render.js");
  assert.match(functionSource(tickets, "ceTicketMatchesFilters"), /ticket\.status !== filters\.status/);
  assert.match(functionSource(tickets, "updateCeStatsAndFilters"), /t\.status === 'Pending \(Customer Call Required\)'/);
  assert.match(read("main.js"), /status: ticket\.status \|\| 'Under Review'/);
  const queue = read("call-queue.html");
  assert.match(queue, /const STORAGE_KEY = 'cc_call_queue_tickets_v1'/);
  for (const transition of ["status: 'In Call'", "status: 'Called'", "status: 'Pending'", "status: 'Done'"]) {
    assert.ok(queue.includes(transition), transition);
  }
  assert.match(read("free-order-requests.html"), /complete-details/);
  assert.match(read("free-order-share.html"), /share-done/);
});

test("dashboard launcher registry, permission filtering, and anchor semantics are frozen", () => {
  const shell = read("js/app-shell.js");
  const card = functionSource(shell, "createModuleCard");
  assert.match(card, /document\.createElement\('a'\)/);
  assert.match(card, /link\.href = module\.route/);
  assert.match(card, /Open Section/);
  assert.match(shell, /showInDashboard !== false/);
  assert.match(shell, /filterPermittedModules/);
});

test("page-owned metric formulas and formatting remain characterized", () => {
  const deductions = read("employee-deductions.html");
  assert.match(deductions, /toFixed\(2\)/);
  assert.match(deductions, /localeCompare/);
  const ratings = read("restaurant-ratings.html");
  assert.match(ratings, /toFixed\(2\)/);
  assert.match(ratings, /reviewsCount/);
  const weekly = read("weekly-quality.html");
  assert.match(weekly, /Math\.round/);
  assert.match(weekly, /Math\.max/);
  assert.match(weekly, /Math\.min/);
  const client = read("client-profiles.html");
  assert.match(client, /getElementById\('stat-agents'\)\.textContent = '0'/);
});

test("dynamic record handlers and profile selection/archive ownership are frozen", () => {
  assert.match(read("js/tickets-render.js"), /card\.addEventListener\('click'/);
  assert.match(read("employee-profiles.html"), /data-view-id=/);
  assert.match(read("employee-profiles.html"), /employee-select/);
  assert.match(read("employee-profiles.html"), /method: 'DELETE'/);
  assert.match(read("client-profiles.html"), /data-view-id=/);
  assert.match(read("free-order-requests.html"), /data-complete-id=/);
  assert.match(read("free-order-share.html"), /data-done-id=/);
});

test("planned content remains visible, incomplete, and noninteractive", () => {
  const employee = read("employee-profiles.html");
  const client = read("client-profiles.html");
  const admin = read("anati-admin.html");
  for (const label of ["Call Queue", "Free Orders", "Coming soon"]) assert.ok(employee.includes(label), label);
  for (const label of ["Complaints", "Free Orders", "Call Queue", "Coming soon"]) assert.ok(client.includes(label), label);
  for (const label of ["Workflow Permissions", "Maintenance Control", "Audit Logs"]) assert.ok(admin.includes(label), label);
  assert.doesNotMatch(admin.match(/<section class="placeholder-grid"[\s\S]*?<\/section>/)?.[0] || "", /<(?:a|button)\b/);
});
