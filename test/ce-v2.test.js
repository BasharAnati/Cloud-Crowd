const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const html = read('ce.html');
const css = read('assets/css/pages/ce-v2.css');
const config = read('js/config.js');
const renderer = read('js/tickets-render.js');
const main = read('main.js');

test('CE V2 owns exact production copy, metrics, and filters', () => {
  assert.match(html, /<h1[^>]*>Customer Experience Operations Center<\/h1>/);
  assert.match(html, /Track customer feedback, order issues, callbacks, and resolution progress\./);
  assert.match(html, />Add New Ticket</);
  assert.deepEqual([...html.matchAll(/class="ce-stat-label">([^<]+)/g)].map((m) => m[1]),
    ['Total Cases', 'Under Review', 'Pending Call Back', 'Closed']);
  assert.deepEqual([...html.matchAll(/<label for="ce-[^"]+">([^<]+)/g)].map((m) => m[1]),
    ['Search', 'Status', 'Branch', 'Restaurant']);
  assert.match(html, /placeholder="Order, customer, or phone"/);
  assert.match(renderer, /sectionTickets\.filter\(t => t\.status === 'Under Review'\)\.length/);
  assert.match(renderer, /sectionTickets\.filter\(t => t\.status === 'Pending \(Customer Call Required\)'\)\.length/);
  assert.match(renderer, /sectionTickets\.filter\(t => t\.status === 'Closed'\)\.length/);
});

test('CE statuses and cards retain the real data contract', () => {
  const ceStatusBlock = config.match(/ce:\s*\[\s*ticketDomainStatuses\.ESCALATED,[\s\S]*?ticketDomainStatuses\.CLOSED\s*\]/)?.[0] || '';
  assert.match(ceStatusBlock, /ESCALATED[\s\S]*UNDER_REVIEW[\s\S]*PENDING_CUSTOMER_CALL[\s\S]*CLOSED/);
  assert.match(config, /PENDING_CUSTOMER_CALL\]: 'Pending \(Call Back\)'/);
  assert.match(renderer, /feedbackDate \|\| ticket\.creationDate \|\| ticket\.dateTime \|\| ticket\.orderDate/);
  assert.match(renderer, /getCaseDisplay\(ticket\)/);
  assert.match(renderer, /ticket\.customerName \|\| 'Customer not specified'/);
  ['Branch', 'Restaurant', 'Issue', 'Phone'].forEach((label) => assert.match(renderer, new RegExp(`field\\('${label}'`)));
  assert.match(renderer, /card\.setAttribute\('role', 'button'\)/);
  assert.match(renderer, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.doesNotMatch(renderer, /dragstart|draggable/i);
});

test('CE loads the target-only harmonization layer and removes the Earth hero presentation', () => {
  assert.ok(html.indexOf('assets/css/pages/ce-v2.css') > html.indexOf('assets/css/components/kanban.css'));
  assert.match(html, /assets\/css\/pages\/ticket-harmonization\.css/);
  assert.match(html, /js\/ticket-harmonization\.js/);
  assert.equal((html.match(/ce-hero-earth\.png/g) || []).length, 0);
  assert.ok(fs.statSync(path.join(ROOT, 'assets/images/customer-experience/ce-hero-earth.png')).size > 0);
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleOpeners = withoutComments.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line.endsWith('{') && !line.startsWith('@'));
  ruleOpeners.forEach((selector) =>
    assert.match(selector, /^(?::root\[data-theme="dark"\]\s+)?\.ce-page\.ce-ops-center\b/, `unscoped selector: ${selector}`));
  assert.match(css, /\.ce-hero-earth[\s\S]*?pointer-events:\s*none/);
  assert.doesNotMatch(css, /animation\s*:/);
});

test('CE V2 uses fixed scoped lanes and non-interactive corner effects', () => {
  assert.match(css, /clamp\(280px,[^;]+320px\)/);
  assert.match(css, /#tickets\.cc-kanban[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /\.ce-ticket-card::before,[\s\S]*?\.ce-ticket-card::after[\s\S]*?pointer-events:\s*none/);
  assert.match(css, /\.ce-ticket-card > \*[\s\S]*?z-index:\s*1/);
  const cardBlock = css.match(/\.ce-page\.ce-ops-center \.ce-ticket-card \{([\s\S]*?)\}/)?.[1] || '';
  assert.doesNotMatch(cardBlock, /border-left|filter:\s*blur/);
  assert.match(renderer, /No cases in this status/);
  assert.match(renderer, /No Customer Experience cases yet/);
  assert.match(renderer, /New tickets will appear here as soon as they are created or synced\./);
  assert.match(renderer, /No matching cases/);
  assert.match(renderer, /Adjust the search or filters to bring tickets back into view\./);
});

test('create modal retains exact fields, groups, and behavior without mock widgets', () => {
  const expected = ['Status', 'Order Number', 'Department Responsible', 'Customer Name', 'Phone Number', 'Creation Date',
    'Shift', 'Order Type', 'Branch Name', 'Restaurant', 'Order Channel', 'Feedback Date', 'Issue Category', 'Case Details',
    'Action Taken', 'Customer Satisfaction Level'];
  const ceFields = config.slice(config.indexOf('\n  ce: [', config.indexOf('const formFields')), config.indexOf("\n  'free-orders':", config.indexOf('const formFields')));
  assert.deepEqual([...ceFields.matchAll(/label: '([^']+)'/g)].map((m) => m[1]), expected);
  const sectionsStart = main.indexOf('const OPERATION_FORM_SECTIONS');
  const ceSections = main.slice(main.indexOf('  ce: [', sectionsStart), main.indexOf('  complaints:', sectionsStart));
  ['Customer and Order', 'Source and Context', 'Experience Classification', 'Resolution'].forEach((title) =>
    assert.match(ceSections, new RegExp(`title: '${title}'`)));
  assert.doesNotMatch(html + config + main, /required(?:\s*=|\s*>)/i);
  assert.doesNotMatch(html + css, /country-picker|country-code|character-counter|Clear Filters|Updated \d|three-dot/);
  assert.match(main, /loadingLabel: 'Submitting\.\.\.'/);
  assert.match(main, /control\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(main, /successMessage: 'Ticket created\.'/);
  assert.match(main, /failureMessage: 'Failed to create ticket'/);
});

test('CE opts into the existing drawer controller without business-runtime edits', () => {
  assert.match(html, /cc-shell-layout has-responsive-navigation/);
  assert.match(html, /id="ce-nav-backdrop"/);
  assert.match(html, /CloudCrowdAppShell\.initializeAppShell\(\{/);
  assert.match(html, /activeModule: CloudCrowdAppShell\.getModuleById\('customer-experience'\)/);
  assert.match(css, /@media \(max-width: 1024px\)/);
});
