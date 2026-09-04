const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'complaints.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/css/pages/complaints-v2.css'), 'utf8');

test('Daily Complaints V2 is a final page-local stylesheet and shared shell opt-in', () => {
  assert.match(html, /<link rel="stylesheet" href="assets\/css\/components\/kanban\.css">\s*<link rel="stylesheet" href="assets\/css\/pages\/complaints-v2\.css">/);
  assert.match(html, /<body class="complaints-page complaints-ops-center complaints-v2">/);
  assert.match(html, /id="complaints-shell"/);
  assert.match(html, /class="complaints-module-shell cc-shell-layout has-responsive-navigation"/);
  assert.match(html, /id="complaints-nav-backdrop"/);
  assert.match(html, /CloudCrowdAppShell\.initializeAppShell/);
  assert.match(html, /getModuleById\('daily-complaints'\)/);
  assert.match(css, /body\.complaints-v2/);
  assert.doesNotMatch(css, /!important/);
});

test('production complaint labels, filters, lane ownership, and form container remain intact', () => {
  const metricLabels = [...html.matchAll(/<span class="complaints-stat-label">([^<]+)<\/span>/g)].map((match) => match[1]);
  assert.deepEqual(metricLabels, ['Total Complaints', 'Under Review', 'Pending Call Back', 'Escalated', 'Closed']);
  const filterLabels = [...html.matchAll(/<label for="complaints-[^"]+">([^<]+)<\/label>/g)].map((match) => match[1]);
  assert.deepEqual(filterLabels, ['Search', 'Status', 'Branch', 'Restaurant', 'Issue Category']);
  assert.match(html, /placeholder="Order, case, customer, or phone"/);
  assert.match(html, /<div id="tickets"><\/div>/);
  assert.match(html, /<div id="dynamic-form" class="cc-dialog__body"><\/div>/);
  assert.match(html, /onclick="openModal\('complaints'\)"/);
  assert.match(html, /onclick="closeModal\(\)"/);
  assert.match(html, /<button type="submit" class="submit-btn">Submit<\/button>/);
});

test('V2 markup and CSS do not introduce prohibited fake form affordances', () => {
  const source = `${html}\n${css}`;
  for (const prohibited of [
    'Document a new customer complaint case',
    'input type="file"',
    'character-counter',
    'country-code',
    'complaints-stepper'
  ]) {
    assert.equal(source.includes(prohibited), false, prohibited);
  }
});

test('Phase 3B remains page-local and preserves responsive, theme, and accessibility contracts', () => {
  assert.match(css, /:root\[data-theme="light"\] body\.complaints-v2/);
  assert.match(css, /@media \(max-width: 1024px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /scroll-snap-type:\s*x proximity/);
  assert.match(css, /max-height:\s*calc\(100dvh - 16px\)/);
  assert.match(css, /#tickets:has\(> \.complaints-empty-state\) > \.complaints-column\s*\{\s*display:\s*none/);
  assert.match(css, /\.cc-form-section:nth-child\(4\) \.cc-form-section__title::before/);
  assert.doesNotMatch(css, /(?:^|[\s,>+~])\.(?:ce|cctv|dashboard)-/m);
  assert.doesNotMatch(css, /body\.complaints-v2\s+canvas|parallax/i);
});
