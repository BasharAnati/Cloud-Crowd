const { test, expect, waitForSettledPage } = require('./fixtures');

const fullModules = [
  ['cctv', 'CCTV Operator Observations', 'Track CCTV operator notes and document observed violations to support stronger security and discipline.', 'video', 'cctv.html'],
  ['customer-experience', 'Customer Experience', 'Collect customer feedback through calls and record complaints or comments that require follow-up.', 'messages-square', 'ce.html'],
  ['daily-complaints', 'Daily Complaints', 'Document all complaints received by the call center and keep daily operational follow-up visible.', 'clipboard-list', 'complaints.html'],
  ['complimentary-orders', 'Complimentary Orders', 'Record order and customer details for discounts or compensations, including approval details.', 'shopping-bag', 'free-orders.html'],
  ['free-order-requests', 'Free Order Requests', 'Manage immediate free order compensation requests from entry to sharing readiness.', 'file-text', 'free-order-requests.html'],
  ['free-order-share', 'Free Order Share', 'Review ready free order requests, request clarifications, and mark completed shares.', 'truck', 'free-order-share.html'],
  ['employee-profiles', 'Employee Profiles', 'Maintain central employee records, contact details, emergency contacts, and restaurant assignments.', 'users', 'employee-profiles.html'],
  ['attendance', 'Attendance & Shift Tracking', 'Track employee attendance, shift schedules, and extra hours.', 'calendar-check', 'attendance.html'],
  ['weekly-quality', 'Weekly Quality Sheet', 'Evaluate weekly call quality, calculate performance scores, and track pending or reviewed calls.', 'badge-check', 'weekly-quality.html'],
  ['agent-training', 'Agent Training', 'Manage brand assignments, training status, coaching needs, and employee training progress.', 'graduation-cap', 'agent-training.html'],
  ['employee-deductions', 'Employee Deductions', 'Track employee deductions, personal orders, discounts, and financial adjustments.', 'receipt', 'employee-deductions.html'],
  ['client-profiles', 'Client Profiles', 'Maintain restaurant and brand profiles, ownership contacts, numbers, logos, and operational notes.', 'briefcase-business', 'client-profiles.html'],
  ['restaurant-ratings', 'Restaurant Ratings', 'Track weekly Talabat and Careem ratings across active restaurant and brand profiles.', 'star', 'restaurant-ratings.html'],
  ['anati-admin', 'Anati Admin Center', 'Manage user accounts, roles, temporary-password lifecycle, and enforced module access.', 'shield-check', 'anati-admin.html']
];

const permissionKeyById = new Map([
  ['cctv', 'cctv'], ['customer-experience', 'customer_experience'], ['daily-complaints', 'daily_complaints'],
  ['complimentary-orders', 'complimentary_orders'], ['free-order-requests', 'free_order_requests'],
  ['free-order-share', 'free_order_share'], ['employee-profiles', 'employee_profiles'], ['attendance', 'attendance'],
  ['weekly-quality', 'weekly_quality'], ['agent-training', 'agent_training'], ['employee-deductions', 'employee_deductions'],
  ['client-profiles', 'client_profiles'], ['restaurant-ratings', 'restaurant_ratings'], ['anati-admin', 'anati_admin']
]);

async function useDashboardAccess(page, ids, options = {}) {
  const access = ids.map((id) => ({
    moduleKey: permissionKeyById.get(id),
    canView: true,
    canCreate: true,
    canEdit: true,
    canDelete: true
  }));
  await page.unroute('**/.netlify/functions/**');
  await page.route('**/.netlify/functions/**', async (route) => {
    const url = route.request().url();
    const body = url.includes('/maintenance')
      ? { maintenance: false, admin: options.maintenanceAdmin === true }
      : { ok: true, access, hasConfiguredAccess: access.length > 0, legacyFallback: false, unavailable: false };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('Dashboard V2 preserves the exact full-authority launcher and decorative hero contract', async ({ appPage: page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Dashboard visual geometry is characterized in Chromium.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/dashboard.html');
  await waitForSettledPage(page);
  await expect(page.locator('#dashboard-modules')).toBeVisible();

  await expect(page.locator('h1')).toHaveText('Operations Dashboard');
  await expect(page.locator('.cc-page-header-context')).toHaveText('Service Management Platform');
  await expect(page.locator('.cc-page-header-description')).toHaveText('Monitor service workflows, document operational cases, and move quickly into the sections your team uses every day.');

  const hero = page.locator('.dashboard-hero-earth');
  await expect(hero).toHaveAttribute('src', 'assets/images/dashboard/dashboard-hero-earth.png');
  await expect(hero).toHaveAttribute('alt', '');
  await expect(hero).toHaveAttribute('aria-hidden', 'true');
  await expect(hero).toHaveAttribute('width', '1772');
  await expect(hero).toHaveAttribute('height', '887');
  await expect(hero).toHaveAttribute('decoding', 'async');
  await expect(hero).toHaveCSS('pointer-events', 'none');
  await expect(hero).toHaveCSS('animation-name', 'none');

  const cards = page.locator('.cc-shell-module-card');
  await expect(cards).toHaveCount(14);
  const rendered = await cards.evaluateAll((nodes) => nodes.map((card) => ({
    id: card.dataset.moduleId,
    tag: card.tagName,
    title: card.querySelector('.cc-shell-module-card-title')?.textContent,
    description: card.querySelector('.cc-shell-module-card-description')?.textContent,
    icon: card.querySelector('.cc-shell-module-icon')?.dataset.icon,
    route: card.getAttribute('href'),
    action: card.querySelector('.cc-shell-module-card-action')?.textContent
  })));
  expect(rendered).toEqual(fullModules.map(([id, title, description, icon, route]) => ({
    id, tag: 'A', title, description, icon, route, action: 'Open Section'
  })));
  expect(rendered.some((module) => module.id === 'call-queue')).toBeFalsy();
  await expect(page.locator('.cc-dashboard-module-group-title')).toHaveText(['Operations', 'HR', 'Business', 'Administration']);
});

test('Dashboard V2 permission subsets collapse groups without placeholders or ghost cards', async ({ appPage: page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Dashboard visual geometry is characterized in Chromium.');
  const scenarios = [
    { ids: ['cctv', 'customer-experience'], groups: ['Operations'] },
    { ids: ['attendance'], groups: ['HR'] },
    { ids: ['client-profiles', 'restaurant-ratings'], groups: ['Business'] },
    { ids: [], groups: [] }
  ];

  for (const scenario of scenarios) {
    await useDashboardAccess(page, scenario.ids);
    await page.goto('/dashboard.html');
    await waitForSettledPage(page);
    if (scenario.ids.length === 0) {
      await expect(page.locator('#dashboard-launcher-state')).toHaveAttribute('data-state', 'empty');
      await expect(page.locator('.cc-shell-module-card')).toHaveCount(0);
      await expect(page.locator('.cc-dashboard-module-group')).toHaveCount(0);
    } else {
      await expect(page.locator('#dashboard-modules')).toBeVisible();
      await expect(page.locator('.cc-shell-module-card')).toHaveCount(scenario.ids.length);
      await expect(page.locator('.cc-dashboard-module-group-title')).toHaveText(scenario.groups);
      expect(await page.locator('.cc-shell-module-card').evaluateAll((cards) => cards.map((card) => card.dataset.moduleId))).toEqual(scenario.ids);
    }
  }
});

test('Dashboard V2 grids meet every locked breakpoint without clipping or description truncation', async ({ appPage: page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Dashboard visual geometry is characterized in Chromium.');
  for (const [width, expectedOperationsColumns] of [[1672, 6], [1600, 6], [1440, 6], [1280, 4], [1024, 4], [768, 2], [430, 1], [390, 1], [360, 1], [320, 1]]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/dashboard.html');
    await waitForSettledPage(page);
    await expect(page.locator('#dashboard-modules')).toBeVisible();
    const geometry = await page.evaluate(() => {
      const grid = document.querySelector('.cc-dashboard-module-group[data-group="Operations"] .cc-shell-dashboard-grid');
      const descriptions = Array.from(document.querySelectorAll('.cc-shell-module-card-description'));
      return {
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        scrollX,
        sidebarRight: document.querySelector('#dashboard-app-sidebar')?.getBoundingClientRect().right,
        columns: getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
        clippedDescriptions: descriptions.filter((node) => node.scrollHeight > node.clientHeight + 1).length
      };
    });
    expect(geometry.documentWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(geometry.scrollX, JSON.stringify(geometry)).toBe(0);
    if (width <= 1024) expect(geometry.sidebarRight, JSON.stringify(geometry)).toBeLessThanOrEqual(0);
    expect(geometry.columns).toBe(expectedOperationsColumns);
    expect(geometry.clippedDescriptions).toBe(0);
  }
});

test('Dashboard V2 preserves Light, Dark, and System while maintenance remains authority-gated', async ({ appPage: page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Dashboard visual behavior is characterized in Chromium.');
  await useDashboardAccess(page, ['cctv']);
  await page.goto('/dashboard.html');
  await waitForSettledPage(page);
  await expect(page.locator('#maintenance-toggle-btn')).toBeHidden();

  const toggle = page.locator('[data-theme-toggle]');
  await expect(toggle).toHaveAttribute('data-theme-preference', 'light');
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-theme-preference', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-theme-preference', 'system');

  await useDashboardAccess(page, ['cctv', 'anati-admin'], { maintenanceAdmin: true });
  await page.goto('/dashboard.html');
  await waitForSettledPage(page);
  await expect(page.locator('#maintenance-toggle-btn')).toBeVisible();
  await expect(page.locator('#maintenance-toggle-btn')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#maintenance-toggle-btn')).toHaveText('OFF');
});

const sharedShellPages = [
  'dashboard.html', 'cctv.html', 'ce.html', 'complaints.html', 'free-orders.html',
  'free-order-requests.html', 'free-order-share.html', 'attendance.html',
  'employee-profiles.html', 'client-profiles.html', 'anati-admin.html'
];

const responsiveShellPages = new Set([
  'dashboard.html', 'cctv.html', 'free-order-requests.html', 'free-order-share.html',
  'attendance.html', 'client-profiles.html', 'anati-admin.html'
]);

test('shared Menu and Close visibility is corrected across active shell pages', async ({ appPage: page, browserName }) => {
  test.skip(browserName !== 'chromium', 'The shared visibility matrix is exhaustive in Chromium.');
  test.setTimeout(60_000);
  for (const file of sharedShellPages) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${file}`);
    await waitForSettledPage(page);
    const trigger = page.locator('.cc-shell-nav-trigger');
    const close = page.locator('.cc-shell-mobile-close');
    if (!responsiveShellPages.has(file)) {
      await expect(trigger).toHaveCount(0);
      await expect(close).toHaveCount(0);
      continue;
    }
    await expect(trigger).toBeHidden();
    await expect(close).toBeHidden();

    await page.setViewportSize({ width: 390, height: 900 });
    await expect(trigger).toBeVisible();
    const menu = page.getByRole('button', { name: 'Open application navigation' });
    await menu.click();
    await expect(page.locator('.cc-shell-sidebar')).toHaveAttribute('aria-hidden', 'false');
    await expect(close).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/cc-shell-nav-lock/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.cc-shell-sidebar')).toHaveAttribute('aria-hidden', 'true');
    await expect(menu).toBeFocused();
    await expect(page.locator('body')).not.toHaveClass(/cc-shell-nav-lock/);
  }
});

test('Dashboard V2 keeps every visible topbar control complete at 320px and nearby responsive widths', async ({ appPage: page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Dashboard responsive geometry is characterized in Chromium.');
  await page.addInitScript(() => localStorage.setItem('cc_theme', 'light'));
  for (const width of [320, 360, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/dashboard.html');
    await waitForSettledPage(page);

    const geometry = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      controls: Array.from(document.querySelectorAll('#dashboard-app-topbar :is(.cc-shell-topbar-title, .cc-shell-nav-trigger, .cc-theme-toggle, .cc-shell-user-badge, .cc-shell-role-badge, .cc-shell-maintenance-toggle, .cc-shell-logout)')).map((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          className: node.className,
          interactive: node.matches('button, a, [role="button"]'),
          visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth
        };
      })
    }));

    expect(geometry.documentWidth, `${width}px document width`).toBeLessThanOrEqual(width + 1);
    const visibleControls = geometry.controls.filter((control) => control.visible);
    expect(visibleControls, `${width}px visible controls`).toHaveLength(width <= 620 ? 4 : 7);
    for (const control of visibleControls) {
      expect(control.left, `${width}px ${control.className}`).toBeGreaterThanOrEqual(0);
      expect(control.right, `${width}px ${control.className}`).toBeLessThanOrEqual(width);
      expect(control.top, `${width}px ${control.className}`).toBeGreaterThanOrEqual(0);
      expect(control.bottom, `${width}px ${control.className}`).toBeLessThanOrEqual(1000);
      expect(control.width, `${width}px ${control.className}`).toBeGreaterThan(0);
      expect(control.height, `${width}px ${control.className}`).toBeGreaterThan(0);
      expect(control.scrollWidth, `${width}px ${control.className}`).toBeLessThanOrEqual(control.clientWidth + 1);
      if (width <= 390 && control.interactive) {
        expect(control.width, `${width}px ${control.className}`).toBeGreaterThanOrEqual(44);
        expect(control.height, `${width}px ${control.className}`).toBeGreaterThanOrEqual(44);
      }
    }

    await expect(page.locator('.cc-shell-nav-trigger')).toBeVisible();
    await expect(page.locator('.cc-theme-toggle')).toBeVisible();
    await expect(page.locator('.cc-shell-maintenance-toggle')).toBeVisible();
    await expect(page.locator('.cc-shell-logout')).toBeVisible();
  }
});

test('Dashboard V2 1440 Dark first review evidence', async ({ appPage: page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Dashboard review evidence is captured in Chromium.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => localStorage.setItem('cc_theme', 'dark'));
  await page.goto('/dashboard.html');
  await waitForSettledPage(page);
  await expect(page.locator('#dashboard-modules')).toBeVisible();
  await page.screenshot({
    path: 'artifacts/dashboard-v2-visual-review/1440-dark-main.png',
    fullPage: true
  });
});

test('Dashboard V2 visual review evidence', async ({ appPage: page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Dashboard review evidence is captured in Chromium.');
  test.setTimeout(60_000);
  const output = 'artifacts/dashboard-v2-visual-review';
  const captures = [
    [1672, 'dark', '1672-dark-main.png'],
    [1440, 'light', '1440-light-main.png'],
    [1440, 'dark', '1440-dark-main.png'],
    [1024, 'light', '1024-light-main.png'],
    [768, 'light', '768-light-main.png'],
    [390, 'light', '390-light-main.png'],
    [390, 'dark', '390-dark-main.png'],
    [320, 'light', '320-light-main.png']
  ];

  for (const [width, theme, filename] of captures) {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript((preference) => localStorage.setItem('cc_theme', preference), theme);
    await page.goto('/dashboard.html');
    await waitForSettledPage(page);
    await expect(page.locator('#dashboard-modules')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${output}/${filename}`, fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 1000 });
  await page.addInitScript(() => localStorage.setItem('cc_theme', 'light'));
  await page.goto('/dashboard.html');
  await waitForSettledPage(page);
  await page.getByRole('button', { name: 'Open application navigation' }).click();
  const sidebar = page.locator('.cc-shell-sidebar');
  await expect(sidebar).toHaveAttribute('aria-hidden', 'false');
  await expect.poll(() => sidebar.evaluate((node) => Math.round(node.getBoundingClientRect().left))).toBe(0);
  await page.screenshot({ path: `${output}/390-light-drawer-open.png` });
});
