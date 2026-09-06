const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'free-orders.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/css/pages/free-orders-v2.css'), 'utf8');
const config = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'js/tickets-render.js'), 'utf8');
const domain = fs.readFileSync(path.join(root, 'shared/ticket-domain-config.js'), 'utf8');

test('Complimentary Orders V2 is the final page-local stylesheet and shared shell opt-in', () => {
  assert.match(html, /<link rel="stylesheet" href="assets\/css\/components\/kanban\.css">\s*<link rel="stylesheet" href="assets\/css\/pages\/internal-platform-v2\.css">\s*<link rel="stylesheet" href="assets\/css\/pages\/free-orders-v2\.css">/);
  assert.match(html, /<body class="free-orders-page free-orders-ops-center free-orders-v2 platform-v2-page">/);
  assert.match(html, /id="free-orders-shell"/);
  assert.match(html, /class="free-orders-module-shell cc-shell-layout has-responsive-navigation"/);
  assert.match(html, /class="free-orders-nav-backdrop cc-shell-nav-backdrop"/);
  assert.match(html, /CloudCrowdAppShell\.initializeAppShell/);
  assert.match(html, /getModuleById\('complimentary-orders'\)/);
  assert.match(css, /body\.free-orders-v2/);
  assert.doesNotMatch(css, /!important/);
});

test('approved metric and filter content remains exact and in order', () => {
  const metricLabels = [...html.matchAll(/<span class="free-orders-stat-label">([^<]+)<\/span>/g)].map((match) => match[1]);
  const filterLabels = [...html.matchAll(/<label for="free-orders-[^"]+">([^<]+)<\/label>/g)].map((match) => match[1]);
  assert.deepEqual(metricLabels, ['Total Orders', 'New', 'Active', 'Taken', 'Total Discount Value']);
  assert.deepEqual(filterLabels, ['Search', 'Status', 'Channel', 'Decision Maker', 'New Order Number']);
  assert.match(html, /placeholder="Order, customer, phone, new order"/);
  assert.equal((html.match(/class="free-orders-stat-icon"/g) || []).length, 5);
  assert.match(html, /onclick="openModal\('free-orders'\)"/);
});

test('hero copy, CTA, metric IDs, and core statuses remain exact', () => {
  assert.match(html, /<h1[^>]*>Complimentary Orders Operations Center<\/h1>/);
  assert.match(html, /<p[^>]*>Track complimentary orders, approvals, usage status, and case resolution progress\.<\/p>/);
  assert.match(html, /<button[^>]*>Add New Ticket<\/button>/);
  const metricIds = [...html.matchAll(/<strong id="(free-orders-stat-[^"]+)">/g)].map((match) => match[1]);
  assert.deepEqual(metricIds, [
    'free-orders-stat-total', 'free-orders-stat-new', 'free-orders-stat-active',
    'free-orders-stat-taken', 'free-orders-stat-discount'
  ]);
  assert.match(domain, /'free-orders': \['New', 'Active', 'Taken'\]/);
  assert.match(css, /\.free-orders-stat-new[\s\S]*?--free-orders-metric-accent:\s*var\(--free-orders-v2-red\)/);
  assert.match(css, /\.free-orders-column:nth-child\(1\)[\s\S]*?--free-orders-lane-accent:\s*var\(--free-orders-v2-red\)/);
});

test('the approved Earth hero and dark 1440 board treatment are page-local', () => {
  assert.match(css, /:root\[data-theme="dark"\] body\.free-orders-v2/);
  assert.match(css, /url\("\.\.\/\.\.\/images\/customer-experience\/ce-hero-earth\.png"\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /clamp\(315px, calc\(\(100% - 32px\) \/ 3\), 410px\)/);
  assert.match(css, /\.free-orders-column:nth-child\(1\)/);
  assert.match(css, /\.free-orders-column:nth-child\(2\)/);
  assert.match(css, /\.free-orders-column:nth-child\(3\)/);
  assert.match(css, /> \.free-orders-column \{[\s\S]*?--free-orders-lane-accent:\s*#8a9cab/);
  assert.doesNotMatch(css, /(?:^|[\s,>+~])\.(?:ce|cctv|complaints|dashboard)-/m);
});

test('production lane, card, drawer, and interaction ownership stays intact', () => {
  assert.match(html, /<div id="tickets"><\/div>/);
  assert.match(html, /id="ticket-drawer"/);
  assert.match(css, /\.free-orders-ticket-card:focus-visible/);
  assert.match(css, /#tickets\.cc-kanban\.cc-kanban--operations > \.free-orders-column/);
  assert.doesNotMatch(css, /#ticket-drawer|\.cc-drawer__panel|\.drawer-body/);
});

test('create form preserves all 15 production fields and five groups', () => {
  const freeOrdersConfig = config.match(/'free-orders': \[\s*\{ label: 'Status', type: 'select', name: 'status'[\s\S]*?\n  \],\n  complaints:/)[0];
  const labels = [...freeOrdersConfig.matchAll(/label: '([^']+)'/g)].map((match) => match[1]);
  const types = [...freeOrdersConfig.matchAll(/type: '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(labels, [
    'Status', 'Customer Name', 'Phone Number', 'Order Date', 'Order Number',
    'Order on Circa', 'Discount Amount', 'Reason for Discount', 'Order Channel',
    'Decision Maker', 'Attached', 'The date of using the discount',
    'New order number', 'Deduction from', 'Case description'
  ]);
  assert.deepEqual(types, [
    'select', 'text', 'text', 'datetime-local', 'text', 'file', 'text', 'textarea',
    'select', 'text', 'file', 'datetime-local', 'text', 'text', 'textarea'
  ]);
  assert.equal(types.filter((type) => type === 'file').length, 2);
  assert.equal((freeOrdersConfig.match(/accept: 'image\/\*'/g) || []).length, 2);
  assert.match(runtime, /'free-orders': \[[\s\S]*?Customer and Order[\s\S]*?Order and Compensation[\s\S]*?Approval and Attachment[\s\S]*?Usage and Deduction[\s\S]*?Case Details/);
  assert.match(html, /<div id="dynamic-form" class="cc-dialog__body"><\/div>/);
});

test('edit, optional-field, empty-state, and value semantics remain runtime owned', () => {
  const editForm = runtime.match(/function buildDrawerEditForm\(ticket\)\s*\{([\s\S]*?)\n\}\s*\n\s*function createDrawerHistoryTrigger/)[1];
  assert.match(editForm, /<label>Status<\/label>[\s\S]*?<label>Action Taken<\/label>/);
  assert.equal((editForm.match(/<label>/g) || []).length, 3);
  assert.match(editForm, /const pdfField = allowPdf \?/);
  assert.match(renderer, /\$\{ticket\.phone \? `<div class="free-orders-ticket-phone">/);
  assert.match(renderer, /\$\{reason \? `<p class="free-orders-ticket-reason">/);
  assert.match(renderer, /detail\('Decision Maker', ticket\.decisionMaker\)/);
  assert.match(renderer, /detail\('New Order Number', ticket\.newOrderNumber\)/);
  assert.match(renderer, /detail\('Channel', ticket\.channel\)/);
  assert.match(renderer, /No complimentary orders yet\./);
  assert.match(renderer, /No matching complimentary orders/);
  assert.match(renderer, /No orders in this status/);
  assert.doesNotMatch(`${html}\n${css}`, />\s*(?:JD|JOD|[$€£%])\s*</);
});

test('modal has a single scroll owner with a fixed header and footer contract', () => {
  assert.match(css, /#modal \.modal-content\.cc-dialog__panel[\s\S]*?max-height:\s*calc\(100dvh - 32px\)[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /#modal #ticket-form[\s\S]*?min-height:\s*0[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /#modal #dynamic-form\.cc-form-sections[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /width:\s*min\(860px, 100%\)/);
  assert.match(css, /#modal \.form-actions\.cc-dialog__footer[\s\S]*?flex:\s*0 0 auto/);
});

test('Complimentary Orders delegates shared responsive and light-theme foundations cleanly', () => {
  assert.match(css, /@media \(max-width: 1024px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /:root\[data-theme="light"\] body\.free-orders-v2/);
});
