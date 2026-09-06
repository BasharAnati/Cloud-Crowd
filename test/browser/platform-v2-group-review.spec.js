const fs = require('node:fs');
const path = require('node:path');
const { test, expect, waitForSettledPage } = require('./fixtures');

const ROOT = path.resolve(__dirname, '..', '..');
const REVIEW_ROOT = path.join(ROOT, 'artifacts', 'platform-v2-group-review');

const canonicalPages = [
  { id: 'dashboard', route: '/dashboard.html', desktopSidebarWidth: 252 },
  { id: 'cctv', route: '/cctv.html', desktopSidebarWidth: 216 },
  { id: 'customer-experience', route: '/ce.html' },
  { id: 'daily-complaints', route: '/complaints.html' }
];

const migratedPages = [
  { id: 'complimentary-orders', route: '/free-orders.html', modalTrigger: '#modal .submit-btn', openTrigger: '.free-orders-actions .add-ticket-btn', modal: '#modal' },
  { id: 'free-order-requests', route: '/free-order-requests.html', openTrigger: '#new-request-btn', modal: '#request-modal' },
  { id: 'free-order-share', route: '/free-order-share.html', openTrigger: '[data-view-id]', modal: '#view-modal' },
  { id: 'employee-profiles', route: '/employee-profiles.html', openTrigger: '#add-employee-btn', modal: '#employee-modal' },
  { id: 'attendance', route: '/attendance.html' },
  { id: 'weekly-quality', route: '/weekly-quality.html', openTrigger: '[data-details-id]', modal: '#details-modal' },
  { id: 'agent-training', route: '/agent-training.html', openTrigger: '[data-view-id]', modal: '#details-modal' },
  { id: 'employee-deductions', route: '/employee-deductions.html', openTrigger: '#new-deduction-btn', modal: '#deduction-modal' },
  { id: 'client-profiles', route: '/client-profiles.html', openTrigger: '#add-client-btn', modal: '#client-modal' },
  { id: 'restaurant-ratings', route: '/restaurant-ratings.html', openTrigger: '#add-rating-btn', modal: '#rating-modal' },
  { id: 'anati-admin', route: '/anati-admin.html' }
];

const remediationPageIds = new Set([
  'complimentary-orders',
  'free-order-requests',
  'free-order-share',
  'employee-profiles',
  'weekly-quality',
  'employee-deductions',
  'client-profiles',
  'restaurant-ratings',
  'anati-admin'
]);

const remediationPages = migratedPages.filter((pageConfig) => remediationPageIds.has(pageConfig.id));

function capturePath(id, name) {
  const directory = path.join(REVIEW_ROOT, id);
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, name);
}

async function openPage(page, route, { width, height, theme }) {
  await page.setViewportSize({ width, height });
  await page.goto(route);
  await waitForSettledPage(page);
  await page.evaluate((value) => window.CloudCrowdTheme.setPreference(value), theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('.cc-shell-sidebar')).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
}

async function waitForPageData(page) {
  await page.waitForFunction(() => {
    const loading = [...document.querySelectorAll('[data-state="loading"], [aria-busy="true"]')];
    return loading.every((element) => element.hidden || getComputedStyle(element).display === 'none');
  }, null, { timeout: 3000 }).catch(() => {});
}

async function assertViewportIntegrity(page, width, desktopSidebarWidth = 224) {
  const geometry = await page.evaluate(() => {
    const sidebar = document.querySelector('.cc-shell-sidebar')?.getBoundingClientRect();
    const hero = document.querySelector('.platform-v2-hero')?.getBoundingClientRect();
    const topbar = document.querySelector('.cc-shell-topbar')?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sidebarWidth: sidebar?.width || 0,
      topbarTop: topbar?.top ?? 0,
      heroBackground: hero ? getComputedStyle(document.querySelector('.platform-v2-hero')).backgroundImage : ''
    };
  });
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  if (width === 1440) expect(geometry.sidebarWidth).toBe(desktopSidebarWidth);
  if (width <= 1024) expect(geometry.topbarTop).toBeLessThanOrEqual(1);
  if (geometry.heroBackground) expect(geometry.heroBackground).toContain('ce-hero-earth.png');
}

async function assertDesktopRemediation(page, id) {
  if (id === 'free-order-requests') {
    expect(await page.locator('.request-card-group').count()).toBeGreaterThanOrEqual(2);
    expect(await page.locator('.request-card-stage .cc-status').count()).toBeGreaterThanOrEqual(1);
  }
  if (id === 'free-order-share') {
    expect(await page.locator('.share-card-group').count()).toBeGreaterThanOrEqual(3);
    expect(await page.locator('.share-card-stage .cc-status').count()).toBeGreaterThanOrEqual(1);
  }
  if (id === 'restaurant-ratings') {
    await expect(page.locator('.rating-extreme-metric')).toHaveCount(2);
    await expect(page.locator('.rating-extreme-metric small')).toHaveCount(2);
  }
  if (id === 'anati-admin') {
    await expect(page.locator('#refresh-users-btn')).toBeEnabled();
    const state = await page.evaluate(() => {
      const button = document.getElementById('refresh-users-btn');
      const wrapper = document.querySelector('[aria-labelledby="users-table-title"].table-wrap');
      return {
        buttonOpacity: Number(getComputedStyle(button).opacity),
        tableOwnsOverflow: wrapper.scrollWidth > wrapper.clientWidth
      };
    });
    expect(state.buttonOpacity).toBeGreaterThanOrEqual(0.9);
    expect(state.tableOwnsOverflow).toBe(true);
  }
}

async function assertModalRemediation(page, id) {
  const expectations = {
    'complimentary-orders': [
      ['#dynamic-form > .cc-form-section', 5],
      ['#dynamic-form [data-cc-section-icon]', 5],
      ['#dynamic-form .form-group', 15]
    ],
    'free-order-requests': [
      ['#request-modal .request-form-section', 2],
      ['#request-modal .form-group', 6]
    ],
    'free-order-share': [
      ['#view-modal .share-detail-section', 4],
      ['#view-modal .detail-item', 22]
    ],
    'employee-profiles': [
      ['#employee-modal .form-section', 4],
      ['#employee-modal .phone-row', 1]
    ],
    'weekly-quality': [
      ['#details-modal .details-section', 3],
      ['#details-modal .score-breakdown .detail-item', 10]
    ],
    'employee-deductions': [
      ['#deduction-modal .calculation-band-header', 1],
      ['#deduction-modal .calculation-item', 3]
    ],
    'client-profiles': [
      ['#client-modal .cc-form-section', 5],
      ['#client-modal input[type="file"]', 1]
    ],
    'restaurant-ratings': [
      ['#rating-modal .field', 8]
    ]
  };
  for (const [selector, count] of expectations[id] || []) {
    await expect(page.locator(selector)).toHaveCount(count);
  }
}

test.describe.serial('Platform V2 group review capture', () => {
  for (const pageConfig of canonicalPages) {
    test(`${pageConfig.id} canonical 1440 dark regression`, async ({ populatedPage: page }) => {
      await openPage(page, pageConfig.route, { width: 1440, height: 900, theme: 'dark' });
      await waitForPageData(page);
      await assertViewportIntegrity(page, 1440, pageConfig.desktopSidebarWidth);
    });
  }

  for (const pageConfig of remediationPages) {
    test(`${pageConfig.id} 1440 dark`, async ({ populatedPage: page }) => {
      const runtimeErrors = [];
      page.on('pageerror', (error) => runtimeErrors.push(error.message));
      await openPage(page, pageConfig.route, { width: 1440, height: 900, theme: 'dark' });
      await waitForPageData(page);
      await expect(page.locator('body')).toHaveClass(/platform-v2-page/);
      await expect(page.locator('.cc-shell-nav-link.is-active')).toHaveCount(1);
      await assertViewportIntegrity(page, 1440);
      await assertDesktopRemediation(page, pageConfig.id);
      await page.screenshot({ path: capturePath(pageConfig.id, '1440-dark-main.png'), fullPage: false });
      expect(runtimeErrors).toEqual([]);
    });

    test(`${pageConfig.id} 390 light responsive`, async ({ populatedPage: page }) => {
      await openPage(page, pageConfig.route, { width: 390, height: 844, theme: 'light' });
      await waitForPageData(page);
      await expect(page.locator('body')).toHaveClass(/platform-v2-page/);
      const navTrigger = page.getByRole('button', { name: 'Open application navigation' });
      await expect(navTrigger).toBeVisible();
      await navTrigger.click();
      const shell = page.locator('.cc-shell-layout');
      const backdrop = page.locator('.cc-shell-nav-backdrop');
      await expect(shell).toHaveClass(/is-nav-open/);
      await expect(backdrop).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(shell).not.toHaveClass(/is-nav-open/);
      await expect(backdrop).toBeHidden();
      await expect(navTrigger).toBeFocused();
      await page.waitForFunction(() => document.querySelector('.cc-shell-sidebar').getBoundingClientRect().right <= 1);
      await assertViewportIntegrity(page, 390);
      await page.screenshot({ path: capturePath(pageConfig.id, '390-light-main.png'), fullPage: false });

      if (pageConfig.openTrigger && pageConfig.modal) {
        const trigger = page.locator(pageConfig.openTrigger).first();
        await expect(trigger).toBeVisible();
        await trigger.click();
        await expect(page.locator(pageConfig.modal)).toBeVisible();
        await assertModalRemediation(page, pageConfig.id);
        await page.screenshot({ path: capturePath(pageConfig.id, '390-light-modal.png'), fullPage: false });
        await page.keyboard.press('Escape');
      }
    });
  }

  test('all migrated pages remain reachable at 320px with System theme', async ({ populatedPage: page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    for (const pageConfig of migratedPages) {
      await page.goto(pageConfig.route);
      await waitForSettledPage(page);
      await page.evaluate(() => window.CloudCrowdTheme.setPreference('system'));
      await expect(page.locator('body')).toHaveClass(/platform-v2-page/);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open application navigation' })).toBeVisible();
      await expect(page.getByRole('button', { name: /Theme:/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        preference: window.CloudCrowdTheme.getPreference(),
        controls: [
          document.querySelector('.cc-shell-nav-trigger'),
          document.querySelector('.cc-theme-toggle'),
          document.querySelector('.cc-shell-logout')
        ].map((control) => control.getBoundingClientRect().height)
      }));
      expect(geometry.overflow, pageConfig.id).toBeLessThanOrEqual(1);
      expect(geometry.preference, pageConfig.id).toBe('system');
      geometry.controls.forEach((height) => expect(height, pageConfig.id).toBeGreaterThanOrEqual(44));
    }
  });
});
