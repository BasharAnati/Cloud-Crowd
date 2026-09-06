const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const registry = fs.readFileSync(path.join(ROOT, 'js', 'app-shell.js'), 'utf8');
const sharedCss = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'pages', 'internal-platform-v2.css'), 'utf8');

const pages = [
  ['complimentary-orders', 'free-orders.html', 'free-orders-v2', 'Complimentary Orders Operations Center', 5],
  ['free-order-requests', 'free-order-requests.html', 'free-order-requests-v2', 'Free Order Requests', 5],
  ['free-order-share', 'free-order-share.html', 'free-order-share-v2', 'Free Order Share', 4],
  ['employee-profiles', 'employee-profiles.html', 'employee-profiles-v2', 'Employee Profiles', 4],
  ['attendance', 'attendance.html', 'attendance-v2', 'Attendance & Shift Tracking', 0],
  ['weekly-quality', 'weekly-quality.html', 'weekly-quality-v2', 'Weekly Quality Sheet', 4],
  ['agent-training', 'agent-training.html', 'agent-training-v2', 'Agent Training', 5],
  ['employee-deductions', 'employee-deductions.html', 'employee-deductions-v2', 'Employee Deductions', 4],
  ['client-profiles', 'client-profiles.html', 'client-profiles-v2', 'Client Profiles', 4],
  ['restaurant-ratings', 'restaurant-ratings.html', 'restaurant-ratings-v2', 'Restaurant Ratings', 5],
  ['anati-admin', 'anati-admin.html', 'anati-admin-v2', 'Anati Admin Center', 4]
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function stylesheetHrefs(html) {
  return [...html.matchAll(/<link\s+rel=["']?stylesheet["']?\s+href=["']?([^"'\s>]+)["']?/gi)].map((match) => match[1]);
}

test('the authoritative registry exposes the eleven migrated modules and keeps Call Queue hidden', () => {
  pages.forEach(([id]) => {
    assert.match(registry, new RegExp(`id: '${id}'[\\s\\S]*?hidden: true|id: '${id}'`), `${id} registry entry`);
  });
  const callQueue = registry.match(/\{\s*id: 'call-queue',[\s\S]*?\n\s*\}/)[0];
  assert.match(callQueue, /hidden: true/);
  assert.doesNotMatch(read('call-queue.html'), /platform-v2-page|call-queue-v2\.css/);
});

test('every migrated page has exact identity, responsive shell hooks, and final page-local V2 ownership', () => {
  const harmonizedTicketPages = new Set(['free-orders.html', 'free-order-requests.html', 'free-order-share.html']);
  pages.forEach(([id, file, bodyClass, h1]) => {
    const html = read(file);
    const localStylesheet = `assets/css/pages/${bodyClass}.css`;
    const stylesheets = stylesheetHrefs(html);
    assert.match(html, new RegExp(`<body[^>]+class="[^"]*\\b${bodyClass}\\b[^"]*\\bplatform-v2-page\\b`), `${file} V2 body`);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, `${file} one H1`);
    assert.match(html, new RegExp(`<h1[^>]*>${h1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h1>`), `${file} H1`);
    assert.match(html, /platform-v2-hero/);
    assert.match(html, /has-responsive-navigation/);
    assert.match(html, /cc-shell-nav-backdrop/);
    assert.ok(stylesheets.includes('assets/css/pages/internal-platform-v2.css'), `${file} shared V2 foundation`);
    const expectedFinalStylesheet = harmonizedTicketPages.has(file)
      ? 'assets/css/pages/ticket-harmonization.css'
      : localStylesheet;
    assert.equal(stylesheets.at(-1), expectedFinalStylesheet, `${file} final stylesheet`);
    const css = read(localStylesheet);
    assert.match(css, new RegExp(`body\\.${bodyClass}`));
    assert.doesNotMatch(css, /!important/);
  });
});

test('real metric inventories use the local Lucide system and no metrics are invented for Attendance', () => {
  pages.forEach(([, file,, , metricCount]) => {
    const html = read(file);
    const renderedMetrics = (html.match(/class="[^"]*\bcc-metric-card\b[^"]*"/g) || []).length;
    assert.equal(renderedMetrics, metricCount, `${file} metric count`);
    if (metricCount > 0) {
      const metricIcons = file === 'free-orders.html'
        ? (html.match(/class="free-orders-stat-icon"\s+data-cc-icon=/g) || []).length
        : (html.match(/class="[^"]*platform-v2-metric-icon[^"]*"\s+data-cc-icon=/g) || []).length;
      assert.equal(metricIcons, metricCount, `${file} metric icon count`);
    }
  });
});

test('the V2 foundation covers theme, responsive, modal, table, Kanban, focus, and reduced-motion contracts', () => {
  assert.match(sharedCss, /body\.platform-v2-page\s*\{/);
  assert.match(sharedCss, /:root\[data-theme="dark"\] body\.platform-v2-page/);
  assert.match(sharedCss, /ce-hero-earth\.png/);
  assert.match(sharedCss, /\.platform-v2-metric-icon/);
  assert.match(sharedCss, /\.cc-table-wrap/);
  assert.match(sharedCss, /\.cc-kanban/);
  assert.match(sharedCss, /max-height:\s*calc\(100dvh - 32px\)/);
  assert.match(sharedCss, /@media \(max-width: 1024px\)/);
  assert.match(sharedCss, /@media \(max-width: 700px\)/);
  assert.match(sharedCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(sharedCss, /https?:\/\//);
  assert.doesNotMatch(sharedCss, /!important/);
});

test('all pages retain existing auth, permission, maintenance, idle, and shell runtime paths', () => {
  pages.forEach(([, file]) => {
    const html = read(file);
    assert.match(html, /js\/permissions\.js/);
    assert.match(html, /js\/maintenance\.js/);
    assert.match(html, /js\/app-shell\.js/);
    assert.match(html, /idle-logout\.js/);
    assert.match(html, /requirePageAccess\(/);
    assert.match(html, /initializeAppShell|js\/internal-page-shell\.js/);
  });
});
