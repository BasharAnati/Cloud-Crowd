const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const pageNames = ['attendance.html', 'employee-deductions.html', 'agent-training.html'];
const pages = Object.fromEntries(pageNames.map((name) => [
  name,
  fs.readFileSync(path.join(ROOT, name), 'utf8')
]));
const shellRuntime = fs.readFileSync(path.join(ROOT, 'js/internal-page-shell.js'), 'utf8');
const dashboardRuntime = fs.readFileSync(path.join(ROOT, 'js/dashboard.js'), 'utf8');
const maintenanceRuntime = fs.readFileSync(path.join(ROOT, 'js/maintenance.js'), 'utf8');
const pageTheme = fs.readFileSync(path.join(ROOT, 'assets/css/pages/people-management.css'), 'utf8');

function count(source, pattern) {
  return (source.match(pattern) || []).length;
}

test('All inline page scripts remain syntactically valid', () => {
  Object.entries(pages).forEach(([name, source]) => {
    const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
      .map((match) => match[1])
      .filter((script) => script.trim());
    scripts.forEach((script, index) => {
      assert.doesNotThrow(() => new Function(script), `${name} inline script ${index + 1} compiles`);
    });
  });
});

test('Sprint 1.3B pages load the shared theme and Internal CRM Shell', () => {
  Object.entries(pages).forEach(([name, source]) => {
    const themeIndex = source.indexOf('src="assets/js/theme.js"');
    const firstStylesheetIndex = source.indexOf('rel="stylesheet"');
    assert.ok(themeIndex > -1 && themeIndex < firstStylesheetIndex, `${name} initializes theme before stylesheets`);
    assert.match(source, /<html[^>]+data-theme="light"/);
    assert.match(source, /href="assets\/css\/design-tokens\.css"/);
    assert.match(source, /href="app-shell\.css"/);
    assert.match(source, /href="assets\/css\/theme-base\.css"/);
    assert.match(source, /href="assets\/css\/pages\/people-management\.css"/);
    assert.match(source, /src="js\/app-shell\.js" defer/);
    assert.match(source, /src="js\/maintenance\.js" defer/);
    assert.match(source, /src="js\/internal-page-shell\.js" defer/);
    assert.match(source, /class="cc-shell-layout has-responsive-navigation"/);
    assert.match(source, /<aside id="internal-app-sidebar" aria-label="Application navigation"><\/aside>/);
    assert.match(source, /<header id="internal-app-topbar" role="banner">/);
    assert.match(source, /id="internal-nav-backdrop" class="cc-shell-nav-backdrop"/);
  });

  assert.match(pageTheme, /background:\s*var\(--color-bg\)/);
  assert.match(pageTheme, /background:\s*var\(--color-surface\)/);
  assert.match(pageTheme, /background:\s*var\(--input-background\)/);
  assert.match(pageTheme, /background:\s*var\(--modal-surface\)/);
  assert.doesNotMatch(pageTheme, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
});

test('Sprint 1.3B pages have one shared Page Header and no local navigation shell', () => {
  Object.entries(pages).forEach(([name, source]) => {
    assert.equal(count(source, /<h1\b/g), 1, `${name} has one page-title h1`);
    assert.match(source, /<header class="cc-page-header">/);
    assert.match(source, /class="cc-page-header-content"/);
    assert.match(source, /class="cc-page-header-context"/);
    assert.match(source, /class="cc-page-header-title"/);
    assert.match(source, /class="cc-page-header-description"/);
    assert.doesNotMatch(source, /class="(?:sidebar|topbar|app-shell|attendance-shell|nav-item|breadcrumb|user-tools|logout|hero)\b/);
    assert.doesNotMatch(source, /\.(?:sidebar|topbar|app-shell|attendance-shell|nav-item|breadcrumb|user-tools|logout|hero)(?:[\s,{.:]|$)/m);
    assert.doesNotMatch(source, /<nav class="sidebar-nav"|onclick="logout\(\)"/);
  });
});

test('All three pages reuse initializeAppShell and the shared route registry', () => {
  assert.equal(count(shellRuntime, /CloudCrowdAppShell\.initializeAppShell/g), 1);
  assert.match(shellRuntime, /getModuleById\(page\.dataset\.shellModule\)/);
  assert.match(shellRuntime, /fallbackMode:\s*'legacy'/);
  assert.match(shellRuntime, /brandImage:\s*'assets\/images\/logo\.png'/);
  assert.match(shellRuntime, /onLogout:\s*window\.logout/);
  assert.match(shellRuntime, /CloudCrowdMaintenance\.createLifecycle/);
  assert.deepEqual(
    pageNames.map((name) => pages[name].match(/data-shell-module="([^"]+)"/)[1]),
    ['attendance', 'employee-deductions', 'agent-training']
  );
});

test('Authentication, permissions, idle logout, and maintenance contracts are preserved', () => {
  Object.entries(pages).forEach(([name, source]) => {
    assert.match(source, /src="js\/auth\.js"/);
    assert.match(source, /readSessionValue\('cc_auth'\) !== '1'/);
    assert.match(source, /readSessionValue\('cc_token'\)/);
    assert.match(source, /readSessionValue\('cc_role'\)/);
    assert.match(source, /src="idle-logout\.js"/);
  });
  assert.match(pages['attendance.html'], /await[^\n]*requirePageAccess\('attendance', \{ force: true \}\)/);
  assert.match(pages['employee-deductions.html'], /await[^\n]*requirePageAccess\('employee_deductions', \{ force: true \}\)/);
  assert.match(pages['agent-training.html'], /await[^\n]*requirePageAccess\('agent_training', \{ force: true \}\)/);
  assert.match(maintenanceRuntime, /const MAINTENANCE_ENDPOINT = '\/\.netlify\/functions\/maintenance'/);
  assert.match(maintenanceRuntime, /const POLL_INTERVAL = 3000/);
  assert.match(maintenanceRuntime, /const REQUEST_DEADLINE = 10 \* 1000/);
  assert.match(maintenanceRuntime, /window\.location\.href = 'system-update\.html'/);
  assert.match(maintenanceRuntime, /method:\s*'POST'/);
  assert.match(maintenanceRuntime, /JSON\.stringify\(\{ maintenance: requestedMaintenance \}\)/);
  assert.match(maintenanceRuntime, /startToggleUpdates\(\)[\s\S]*renderToggle\(\)/);
  assert.match(maintenanceRuntime, /CloudCrowdConfirmation\.request\(message/);
  assert.doesNotMatch(shellRuntime, /MAINTENANCE_ENDPOINT|fetchMaintenanceStatus|toggleMaintenanceMode/);
  assert.doesNotMatch(dashboardRuntime, /MAINTENANCE_ENDPOINT|fetchMaintenanceStatus|toggleMaintenanceMode/);
});

test('Attendance form, table, API fallback, import, and storage contracts remain intact', () => {
  const source = pages['attendance.html'];
  ['attendance-form', 'agent', 'record-date', 'login-status', 'logout-status', 'extra-time',
    'extra-duration', 'note', 'custom-note', 'from-time', 'to-time', 'records-table-body',
    'agent-search', 'date-filter', 'attendance-import-btn'].forEach((id) => {
    assert.match(source, new RegExp(`id="${id}"`));
  });
  assert.match(source, /const ATTENDANCE_STORAGE_KEY = 'cc_attendance_records_v1'/);
  assert.match(source, /const ATTENDANCE_MIGRATION_FLAG = 'cc_attendance_migration_v1_done'/);
  assert.match(source, /const ATTENDANCE_ENDPOINT = '\/\.netlify\/functions\/attendance'/);
  assert.match(source, /const EMPLOYEES_ENDPOINT = '\/\.netlify\/functions\/employees'/);
  assert.match(source, /\?action=bulk-import/);
  assert.match(source, /using local records/);
  assert.match(source, /document\.getElementById\('attendance-form'\).*addEventListener\('submit'/s);
  assert.doesNotMatch(source, /warning\.style\.(?:borderColor|color|background)/);
  assert.match(source, /classList\.toggle\('is-error', isError\)/);
  assert.match(source, /classList\.toggle\('is-warning', !isError\)/);
});

test('Employee Deductions CRUD, role restrictions, filters, table, modal, API, and 10% calculation remain intact', () => {
  const source = pages['employee-deductions.html'];
  ['new-deduction-btn', 'deduction-form', 'employee-search', 'restaurant-filter', 'type-filter',
    'month-filter', 'records-body', 'deduction-modal', 'details-modal', 'original-amount',
    'apply-discount', 'calculated-final'].forEach((id) => {
    assert.match(source, new RegExp(`id="${id}"`));
  });
  assert.match(source, /const DEDUCTIONS_ENDPOINT = '\/\.netlify\/functions\/deductions'/);
  assert.match(source, /const DISCOUNT_PERCENTAGE = 10/);
  assert.match(source, /const canManageDeductions = \['admin', 'manager'\]\.includes\(currentRole\)/);
  assert.match(source, /method:\s*deductionId \? 'PUT' : 'POST'/);
  assert.match(source, /method:\s*'DELETE'/);
  assert.match(source, /function calculateAmounts\(/);
  assert.match(source, /document\.getElementById\('deduction-form'\)\.addEventListener\('submit', saveDeduction\)/);
  assert.match(pageTheme, /#record-count\.role-pill[\s\S]*display:\s*inline-flex/);
});

test('Agent Training CRUD, statuses, guide, legacy restaurant compatibility, archive, and API remain intact', () => {
  const source = pages['agent-training.html'];
  ['new-training-btn', 'training-form', 'employee-search', 'restaurant-filter', 'training-filter',
    'assignment-filter', 'records-body', 'details-modal', 'guide-title'].forEach((id) => {
    assert.match(source, new RegExp(`id="${id}"`));
  });
  ['Trained', 'Not Trained', 'Coaching Needed', 'Unassigned', 'No training or assignment needed'].forEach((status) => {
    assert.match(source, new RegExp(status));
  });
  assert.match(source, /const TRAINING_ENDPOINT = '\/\.netlify\/functions\/training'/);
  assert.match(source, /const RESTAURANTS_ENDPOINT = '\/\.netlify\/functions\/restaurants'/);
  assert.match(source, /const canManageTraining = \['admin', 'manager'\]\.includes\(currentRole\)/);
  assert.match(source, /`legacy:\$\{extraName\}`/);
  assert.match(source, /Archive the training assignment/);
  assert.match(source, /method:\s*'DELETE'/);
  assert.match(source, /document\.getElementById\('training-form'\)\.addEventListener\('submit', saveTraining\)/);
});
