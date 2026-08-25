const fs = require('node:fs');
const path = require('node:path');
const { test, expect, waitForSettledPage } = require('./fixtures');

const ROOT = path.resolve(__dirname, '..', '..');
const APPROVED_DARK_MODAL = 'rgb(27, 37, 48)';
const VISUAL_CAPTURE_DIR = path.join(ROOT, 'artifacts', 'cctv-v2-visual-review');
const EVIDENCE_CAPTURE_NAMES = new Set([
  '1440-light-evidence-cards.png',
  '1440-dark-evidence-cards.png',
  '768-light-evidence-card.png',
  '390-light-evidence-card.png',
  '390-dark-evidence-card.png',
  '320-light-evidence-card.png'
]);

async function captureVisualReview(page, filename, fullPage = true) {
  if (process.env.CCTV_EVIDENCE_CAPTURE_ONLY === '1' && !EVIDENCE_CAPTURE_NAMES.has(filename)) return;
  fs.mkdirSync(VISUAL_CAPTURE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(VISUAL_CAPTURE_DIR, filename), fullPage });
}

async function captureEvidenceReview(page, filename, desktop = false) {
  fs.mkdirSync(VISUAL_CAPTURE_DIR, { recursive: true });
  const target = desktop
    ? page.locator('#tickets')
    : page.locator('.cctv-column:visible .cctv-ticket-card').first();
  await target.screenshot({ path: path.join(VISUAL_CAPTURE_DIR, filename) });
}

async function visualMetrics(page) {
  return page.evaluate(() => {
    const size = (selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box ? { width: Math.round(box.width), height: Math.round(box.height) } : null;
    };
    return {
      sidebar: size('#cctv-app-sidebar'),
      hero: size('.cctv-hero'),
      summary: size('.cctv-stats'),
      filters: size('.cctv-filters'),
      card: size('.cctv-ticket-card'),
      modal: size('.cctv-ticket-modal__panel'),
      details: size('#drawer-body'),
      status: {
        text: document.querySelector('#drawer-meta')?.textContent.trim() || '',
        display: getComputedStyle(document.querySelector('#drawer-meta')).display,
        badge: size('#drawer-meta .meta-badge')
      }
    };
  });
}

async function openCctv(page, width = 1440, theme = 'light', expectedCards = 2) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((nextTheme) => localStorage.setItem('cc_theme', nextTheme), theme);
  await page.goto('/cctv.html');
  await waitForSettledPage(page);
  await expect(page.locator('.cctv-ticket-card')).toHaveCount(expectedCards);
}

async function openFirstTicket(page, activation = 'pointer') {
  const cards = page.locator('.cctv-ticket-card');
  expect(await cards.count()).toBeGreaterThan(0);
  const card = cards.nth(0);
  if (activation === 'pointer') await card.click();
  else {
    await card.focus();
    await card.press(activation === 'space' ? 'Space' : 'Enter');
  }
  await expect(page.locator('#ticket-drawer')).toHaveClass(/open/);
  return card;
}

async function routeCctvTickets(page, tickets) {
  await page.route('**/.netlify/functions/tickets?section=cctv', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        tickets: tickets.map((payload, index) => ({
          id: index + 101,
          section: 'cctv',
          status: payload.status,
          payload,
          created_at: payload.dateTime || null,
          updated_at: payload.dateTime || null
        }))
      })
    });
  });
  await page.route('**/.netlify/functions/sheets?section=cctv', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, values: [] }) });
  });
}

async function routeCctvAccess(page, access, options = {}) {
  await page.route('**/.netlify/functions/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('my-access') !== '1' && !url.pathname.endsWith('/permissions') && !url.pathname.endsWith('/module-access')) {
      return route.fallback();
    }
    const body = options.unavailable
      ? { ok: false, modules: [], access: [], hasConfiguredAccess: false, legacyFallback: false, unavailable: true }
      : {
          ok: true,
          modules: [{ moduleKey: 'cctv', moduleName: 'CCTV Requests', label: 'CCTV Requests' }],
          access: [{ moduleKey: 'cctv', ...access }],
          hasConfiguredAccess: true,
          legacyFallback: false,
          unavailable: false
        };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function routeMutatedAsset(page, relativePath, mutate) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  const mutated = mutate(source);
  expect(mutated).not.toBe(source);
  await page.route(`**/${relativePath.replaceAll('\\', '/')}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: relativePath.endsWith('.css') ? 'text/css' : 'text/javascript',
      body: mutated
    });
  });
}

async function expectExactCctvLanes(page) {
  await expect(page.locator('.cctv-column')).toHaveCount(3);
  await expect(page.locator('.cctv-column .cc-kanban__title')).toHaveText(['Escalated', 'Under Review', 'Closed']);
  await expect(page.locator('#cctv-status-filter option')).toHaveText(['All statuses', 'Escalated', 'Under Review', 'Closed']);
  await expect(page.getByText('Legacy Review', { exact: true })).toHaveCount(0);
}

async function expectNoDeferredAttachmentPresentation(page) {
  const details = page.locator('#drawer-body');
  await expect(details.locator('.cctv-pdf-link, .cctv-attachments-list, [data-field="attachments"]')).toHaveCount(0);
  await expect(details).not.toContainText('deferred-cctv.pdf');
  await expect(details).not.toContainText('Attached');
  await expect(details).not.toContainText('View Attachment');
}

async function expectNeutralDarkModal(page) {
  await expect(page.locator('.cctv-ticket-modal__panel')).toHaveCSS('background-color', APPROVED_DARK_MODAL);
  await expect(page.locator('.cctv-ticket-modal__panel')).not.toHaveCSS('background-color', 'rgb(11, 53, 84)');
  const contrast = await page.locator('.cctv-ticket-modal__panel').evaluate((panel) => {
    const parse = (value) => value.match(/\d+/g).slice(0, 3).map(Number);
    const luminance = (rgb) => rgb.map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const style = getComputedStyle(panel);
    const foreground = luminance(parse(style.color));
    const background = luminance(parse(style.backgroundColor));
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
}

async function expectBackdropDismissal(page) {
  await page.locator('.drawer-backdrop').click({ position: { x: 2, y: 2 } });
  await expect(page.locator('#ticket-drawer')).not.toHaveClass(/open/);
}

async function expectInsidePanelOwnership(page) {
  await page.locator('.cctv-ticket-modal__panel').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('#ticket-drawer')).toHaveClass(/open/);
}

async function expectExactFocusRestoration(page, origin) {
  await page.keyboard.press('Escape');
  await expect(origin).toBeFocused();
}

async function expectOracleKilled(oracle) {
  let killed = false;
  try {
    await oracle();
  } catch {
    killed = true;
  }
  expect(killed).toBe(true);
}

test.describe('CCTV Precision Operations V2', () => {
  for (const width of [1440, 1280, 1024, 768, 430, 390, 360, 320]) {
    test(`layout remains reachable at ${width}px`, async ({ populatedPage: page }) => {
      await openCctv(page, width, width < 390 ? 'dark' : 'light');

      await expect(page.locator('body')).toHaveClass(/cctv-v2/);
      await expect(page.locator('.cctv-column')).toHaveCount(3);
      await expect(page.locator('.cctv-column .cc-kanban__title')).toHaveText([
        'Escalated', 'Under Review', 'Closed'
      ]);

      const geometry = await page.evaluate(() => {
        const rect = (selector) => {
          const element = document.querySelector(selector);
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
        };
        const board = document.querySelector('#tickets');
        const kanban = document.querySelector('#tickets');
        const sidebar = document.querySelector('#cctv-app-sidebar');
        const topbar = document.querySelector('#cctv-app-topbar');
        const firstCard = document.querySelector('.cctv-ticket-card');
        const metricAlignment = [...document.querySelectorAll('.cctv-stat-card')].map((metric) => {
          const card = metric.getBoundingClientRect();
          const icon = metric.querySelector('.cctv-stat-icon').getBoundingClientRect();
          const label = metric.querySelector('.cctv-stat-label').getBoundingClientRect();
          const count = metric.querySelector('strong').getBoundingClientRect();
          return {
            headingCenterDelta: Math.abs((icon.top + icon.height / 2) - (label.top + label.height / 2)),
            headingGap: label.left - icon.right,
            countCenterDelta: Math.abs((count.left + count.width / 2) - (card.left + card.width / 2)),
            clips: metric.scrollWidth - metric.clientWidth
          };
        });
        const pageOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        return {
          header: rect('.cctv-hero'),
          filters: rect('.cctv-filters'),
          board: rect('#tickets'),
          sidebar: rect('#cctv-app-sidebar'),
          sidebarPosition: getComputedStyle(sidebar).position,
          topbarBottom: topbar.getBoundingClientRect().bottom,
          firstCardTop: firstCard?.getBoundingClientRect().top ?? null,
          visibleLanes: [...document.querySelectorAll('.cctv-column')].filter((lane) => getComputedStyle(lane).display !== 'none').length,
          switcherVisible: getComputedStyle(document.querySelector('#cctv-status-switcher')).display !== 'none',
          secondaryFiltersHidden: document.querySelector('#cctv-secondary-filters').hidden,
          cardClips: firstCard ? firstCard.scrollWidth - firstCard.clientWidth : 0,
          metricAlignment,
          kanbanScrollWidth: kanban.scrollWidth,
          boardClientWidth: board.clientWidth,
          boardScrollWidth: board.scrollWidth,
          pageOverflow
        };
      });

      expect(geometry.header.height).toBeLessThan(width <= 700 ? 230 : 210);
      expect(geometry.filters.height).toBeLessThan(width <= 420 ? 350 : 220);
      expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
      for (const metric of geometry.metricAlignment) {
        expect(metric.headingCenterDelta).toBeLessThanOrEqual(1);
        expect(metric.headingGap).toBeGreaterThanOrEqual(3);
        expect(metric.headingGap).toBeLessThanOrEqual(9);
        expect(metric.countCenterDelta).toBeLessThanOrEqual(1);
        expect(metric.clips).toBeLessThanOrEqual(1);
      }
      if (width <= 768) {
        expect(geometry.sidebarPosition).toBe('fixed');
        expect(geometry.sidebar.right).toBeLessThanOrEqual(0);
        expect(geometry.header.y - geometry.topbarBottom).toBeLessThanOrEqual(1);
        expect(geometry.secondaryFiltersHidden).toBe(true);
        expect(geometry.switcherVisible).toBe(true);
        expect(geometry.visibleLanes).toBe(1);
        expect(geometry.boardScrollWidth).toBeLessThanOrEqual(geometry.boardClientWidth + 1);
        expect(geometry.cardClips).toBeLessThanOrEqual(1);
        expect(geometry.firstCardTop).toBeLessThan(844);
      } else if (width >= 1025) {
        expect(geometry.visibleLanes).toBe(3);
        expect(geometry.switcherVisible).toBe(false);
      }
      if (width === 1440) {
        const metrics = await visualMetrics(page);
        console.log('CCTV_VISUAL_MAIN_1440', JSON.stringify(metrics));
        expect(metrics.sidebar.width).toBeGreaterThanOrEqual(200);
        expect(metrics.sidebar.width).toBeLessThanOrEqual(220);
        expect(metrics.hero.height).toBeLessThanOrEqual(100);
        expect(metrics.summary.height).toBeLessThanOrEqual(76);
        expect(metrics.filters.height).toBeLessThanOrEqual(86);
        expect(metrics.card.height).toBeLessThanOrEqual(360);
        await captureVisualReview(page, '1440-light-main.png');
      }
      if (width === 390) {
        await captureVisualReview(page, '390-light-main.png', false);
      }
      if (width === 768) await captureVisualReview(page, '768-light-main.png', false);
    });
  }

  test('mobile navigation overlays content, contains focus, dismisses, and restores its trigger', async ({ populatedPage: page }) => {
    await openCctv(page, 390, 'light');
    const trigger = page.getByRole('button', { name: 'Open application navigation' });
    await trigger.click();
    await expect(page.locator('.cctv-module-shell')).toHaveClass(/is-nav-open/);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#cctv-nav-backdrop')).toBeVisible();
    await expect(page.locator('#cctv-app-sidebar .cc-shell-nav-link.is-active')).toHaveAttribute('href', 'cctv.html');
    await expect.poll(() => page.locator('#cctv-app-sidebar').evaluate(
      (sidebar) => Math.abs(sidebar.getBoundingClientRect().left)
    )).toBeLessThan(1);
    const drawerGeometry = await page.locator('#cctv-app-sidebar').evaluate((sidebar) => {
      const box = sidebar.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width, viewport: innerWidth };
    });
    expect(Math.abs(drawerGeometry.left)).toBeLessThan(1);
    expect(drawerGeometry.width).toBeLessThanOrEqual(300);
    expect(drawerGeometry.right).toBeLessThan(drawerGeometry.viewport);
    await page.locator('#cctv-app-sidebar .cc-shell-nav-heading').first().click();
    await expect(page.locator('.cctv-module-shell')).toHaveClass(/is-nav-open/);
    for (let index = 0; index < 20; index += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.getElementById('cctv-app-sidebar').contains(document.activeElement))).toBe(true);
    }
    await captureVisualReview(page, '390-light-navigation-drawer-open.png', false);
    await page.keyboard.press('Escape');
    await expect(page.locator('.cctv-module-shell')).not.toHaveClass(/is-nav-open/);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.locator('#cctv-nav-backdrop').click({ position: { x: 385, y: 400 } });
    await expect(page.locator('.cctv-module-shell')).not.toHaveClass(/is-nav-open/);
    await expect(trigger).toBeFocused();
  });

  test('mobile secondary filters disclose on demand and preserve immediate filter state', async ({ populatedPage: page }) => {
    await openCctv(page, 390, 'light');
    const toggle = page.locator('#cctv-filter-toggle');
    const panel = page.locator('#cctv-secondary-filters');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
    await toggle.click();
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await captureVisualReview(page, '390-light-filters-open.png', false);
    await page.locator('#cctv-branch-filter').selectOption('Swefieh');
    await expect(page.locator('.cctv-ticket-card')).toHaveCount(1);
    await expect(page.locator('.cctv-ticket-card')).toContainText('CCTV-S116-1');
    await expect(toggle).toContainText('Filters · 1');
    await toggle.click();
    await expect(panel).toBeHidden();
    await expect(page.locator('#cctv-branch-filter')).toHaveValue('Swefieh');
  });

  test('mobile status switcher exposes exactly one existing lane with matching counts and cards', async ({ populatedPage: page }) => {
    await openCctv(page, 390, 'light');
    const tabs = page.locator('#cctv-status-switcher [role="tab"]');
    await expect(tabs).toHaveCount(3);
    await expect(tabs).toContainText(['Escalated 0', 'Under Review 1', 'Closed 1']);
    await expect(page.locator('[data-cctv-lane="Under Review"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cctv-column:visible')).toHaveCount(1);
    await expect(page.locator('.cctv-column:visible .cctv-ticket-card')).toContainText('CCTV-S116-1');
    await captureVisualReview(page, '390-light-status-under-review-selected.png', false);

    await page.locator('[data-cctv-lane="Closed"]').click();
    await expect(page.locator('[data-cctv-lane="Closed"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cctv-column:visible')).toHaveCount(1);
    await expect(page.locator('.cctv-column:visible .cctv-ticket-card')).toContainText('CCTV-S116-2');
    await page.locator('[data-cctv-lane="Escalated"]').click();
    await expect(page.locator('.cctv-column:visible')).toContainText('No cases in this status');
  });

  test('navigation and ticket modal never own the viewport simultaneously', async ({ populatedPage: page }) => {
    await openCctv(page, 390, 'light');
    await openFirstTicket(page);
    await page.getByRole('button', { name: 'Open application navigation' }).evaluate((button) => button.click());
    await expect(page.locator('#ticket-drawer')).not.toHaveClass(/open/);
    await expect(page.locator('.cctv-module-shell')).toHaveClass(/is-nav-open/);
    await page.evaluate(() => window.openTicketDrawer(0));
    await expect(page.locator('.cctv-module-shell')).not.toHaveClass(/is-nav-open/);
    await expect(page.locator('#ticket-drawer')).toHaveClass(/open/);
  });

  test('desktop and mobile preserve identical summary, lane counts, cards, and filter outcomes', async ({ populatedPage: page }) => {
    await openCctv(page, 1440, 'light');
    const desktop = await page.evaluate(() => ({
      summary: [...document.querySelectorAll('.cctv-stat-card strong')].map((node) => node.textContent.trim()),
      lanes: [...document.querySelectorAll('.cctv-column .cc-kanban__count')].map((node) => node.textContent.trim()),
      cards: [...document.querySelectorAll('.cctv-ticket-case')].map((node) => node.textContent.trim()).sort()
    }));
    await page.setViewportSize({ width: 390, height: 900 });
    const mobile = await page.evaluate(() => ({
      summary: [...document.querySelectorAll('.cctv-stat-card strong')].map((node) => node.textContent.trim()),
      lanes: [...document.querySelectorAll('[data-cctv-lane-count]')].map((node) => node.textContent.trim()),
      cards: [...document.querySelectorAll('.cctv-ticket-case')].map((node) => node.textContent.trim()).sort()
    }));
    expect(mobile).toEqual(desktop);

    await page.locator('#cctv-filter-toggle').click();
    await page.locator('#cctv-status-filter').selectOption('Closed');
    await expect(page.locator('.cctv-ticket-card')).toHaveCount(1);
    await expect(page.locator('[data-cctv-lane="Closed"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cctv-column:visible .cctv-ticket-card')).toContainText('CCTV-S116-2');
  });

  test('required dark, tablet, and narrow visual evidence is captured from real viewports', async ({ populatedPage: page }) => {
    await openCctv(page, 1440, 'dark');
    await captureVisualReview(page, '1440-dark-main.png', false);

    await openCctv(page, 768, 'dark');
    await openFirstTicket(page);
    await captureVisualReview(page, '768-dark-ticket-modal.png', false);
    await page.keyboard.press('Escape');

    await openCctv(page, 390, 'dark');
    await captureVisualReview(page, '390-dark-main.png', false);

    await openCctv(page, 320, 'light');
    await captureVisualReview(page, '320-light-main.png', false);

    await openCctv(page, 320, 'dark');
    await openFirstTicket(page);
    await captureVisualReview(page, '320-dark-ticket-modal.png', false);
  });

  test('status identities use distinct local icons and readable metadata', async ({ populatedPage: page }) => {
    await openCctv(page);
    const reviewCard = page.locator('[data-cctv-status-identity="Under Review"]').locator('..').locator('..');
    await expect(page.locator('[data-cctv-status-identity="Under Review"] [data-cc-icon-rendered="refresh-cw"]')).toHaveCount(1);
    await expect(page.locator('.cctv-column').nth(0).locator('[data-cc-icon-rendered="triangle-alert"]')).toHaveCount(1);
    await expect(page.locator('.cctv-column').nth(2).locator('[data-cc-icon-rendered="badge-check"]')).toHaveCount(2);
    await expect(reviewCard.locator('.cctv-ticket-case')).toContainText('CCTV-S116-1');
    await expect(reviewCard.locator('.cctv-evidence-snapshot')).toBeVisible();
    expect(await reviewCard.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });

  test('modal pointer dismissal respects inside ownership and restores exact card focus', async ({ populatedPage: page }) => {
    await openCctv(page);
    const origin = await openFirstTicket(page);
    const modal = page.locator('#ticket-drawer');
    const panel = page.locator('.cctv-ticket-modal__panel');

    const geometry = await panel.boundingBox();
    expect(Math.abs((geometry.x + geometry.width / 2) - 720)).toBeLessThan(2);
    expect(Math.abs((geometry.y + geometry.height / 2) - 450)).toBeLessThan(2);
    await expect(page.locator('.drawer-backdrop')).toHaveCSS('backdrop-filter', 'blur(3px)');
    await expect(page.locator('body')).toHaveClass(/cc-modal-lock/);
    const metrics = await visualMetrics(page);
    console.log('CCTV_VISUAL_MODAL_1440', JSON.stringify(metrics));
    expect(metrics.modal.width).toBeGreaterThanOrEqual(720);
    expect(metrics.modal.width).toBeLessThanOrEqual(820);
    expect(metrics.modal.height).toBeLessThanOrEqual(700);
    expect(metrics.details.width).toBeGreaterThanOrEqual(metrics.modal.width - 4);
    await expect(page.locator('#drawer-meta .meta-badge')).toBeVisible();
    await expect(page.locator('#drawer-meta .meta-badge')).toContainText('Under Review');
    await expect(page.locator('.cctv-ticket-tabs')).toHaveCount(1);
    await expect(page.locator('.cctv-ticket-tab')).toHaveCount(2);
    await expect(page.getByRole('tab', { name: 'Details', exact: true })).toHaveCount(1);
    await expect(page.getByRole('tab', { name: 'History', exact: true })).toHaveCount(1);
    const detailColumns = await page.locator('.cctv-detail-layout').evaluate((layout) => getComputedStyle(layout).gridTemplateColumns.split(' ').length);
    expect(detailColumns).toBe(2);
    await captureVisualReview(page, '1440-light-ticket-modal.png', false);

    await panel.click({ position: { x: 20, y: 20 } });
    await expect(modal).toHaveClass(/open/);
    await page.locator('.drawer-backdrop').click({ position: { x: 2, y: 2 } });
    await expect(modal).not.toHaveClass(/open/);
    await expect(origin).toBeFocused();
  });

  test('X, Escape, Enter, and Space retain dialog and focus contracts', async ({ populatedPage: page }) => {
    await openCctv(page);
    const enterOrigin = await openFirstTicket(page, 'enter');
    await expect(page.locator('.cctv-ticket-modal__panel')).toHaveAttribute('role', 'dialog');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(enterOrigin).toBeFocused();

    const spaceOrigin = await openFirstTicket(page, 'space');
    await page.keyboard.press('Escape');
    await expect(page.locator('#ticket-drawer')).not.toHaveClass(/open/);
    await expect(spaceOrigin).toBeFocused();
  });

  test('History is on-demand and renders populated, empty, and backend-error states', async ({ populatedPage: page }) => {
    let historyCalls = 0;
    let state = 'populated';
    await page.route('**/.netlify/functions/tickets?history=1*', async (route) => {
      historyCalls += 1;
      if (state === 'error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'History unavailable' }) });
        return;
      }
      const history = state === 'empty' ? [] : [{
        changed_at: '2026-08-21T12:00:00Z', changed_by: 'Reviewer',
        prev_status: 'Escalated', new_status: 'Under Review',
        prev_action: 'Escalated', new_action: 'Reviewing'
      }];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, history }) });
    });
    await openCctv(page);

    await openFirstTicket(page);
    expect(historyCalls).toBe(0);
    await page.locator('#drawer-history-tab').click();
    await expect(page.locator('#drawer-history')).toContainText('Reviewer');
    await expect(page.locator('#drawer-history')).toContainText('Escalated');
    expect(historyCalls).toBe(1);

    await page.keyboard.press('Escape');
    state = 'empty';
    await openFirstTicket(page);
    await page.locator('#drawer-history-tab').click();
    await expect(page.locator('#drawer-history')).toContainText('No changes logged yet.');

    await page.keyboard.press('Escape');
    state = 'error';
    await openFirstTicket(page);
    await page.locator('#drawer-history-tab').click();
    await expect(page.locator('#drawer-history')).toContainText('History unavailable');
  });

  test('edit mode exposes only existing fields and backdrop cannot discard it', async ({ populatedPage: page }) => {
    await openCctv(page);
    await openFirstTicket(page);
    await page.locator('#drawer-edit-btn').click();
    await expect(page.locator('#drawer-edit-form [name="status"]')).toBeVisible();
    await expect(page.locator('#drawer-edit-form [name="actionTaken"]')).toBeVisible();
    await expect(page.locator('#drawer-edit-form [name="cctvPdf"]')).toBeVisible();
    await expect(page.locator('#drawer-edit-form :is([name="branch"], [name="cameras"], [name="staff"])')).toHaveCount(0);
    await expect(page.locator('.cctv-ticket-tabs')).toBeHidden();

    await page.locator('.drawer-backdrop').click({ position: { x: 2, y: 2 } });
    await expect(page.locator('#drawer-edit-form')).toBeVisible();
    await page.locator('#drawer-cancel-btn').click();
    await expect(page.locator('#drawer-edit-form')).toHaveCount(0);
    await expect(page.locator('.cctv-ticket-tabs')).toBeVisible();
  });

  test('permission-gated actions and delete confirmation retain current authority', async ({ populatedPage: page }) => {
    await openCctv(page);
    await page.evaluate((origin) => {
      window.CC_PAGE_ACCESS = { moduleKey: 'cctv', canView: true, canCreate: true, canEdit: false, canDelete: false };
    });
    await openFirstTicket(page);
    await expect(page.locator('#drawer-edit-btn')).toHaveCount(0);
    await expect(page.locator('#drawer-delete-btn')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.evaluate(() => {
      window.CC_PAGE_ACCESS = { moduleKey: 'cctv', canView: true, canCreate: true, canEdit: true, canDelete: true };
    });
    await openFirstTicket(page);
    await page.locator('#drawer-delete-btn').click();
    await expect(page.getByRole('heading', { name: 'Delete ticket' })).toBeVisible();
    await expect(page.getByText('Delete ticket CCTV-S116-1?')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  });

  test('create dialog preserves sections, defaults, and 44px priority targets', async ({ populatedPage: page }) => {
    await openCctv(page, 390, 'dark');
    await page.getByRole('button', { name: 'Add New Ticket' }).click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#dynamic-form')).toContainText('Case Context');
    await expect(page.locator('#dynamic-form')).toContainText('Footage and Location');
    await expect(page.locator('#dynamic-form')).toContainText('People and Policy');
    await expect(page.locator('#dynamic-form')).toContainText('Case Details');
    await expect(page.locator('#dynamic-form')).toContainText('Attachment and Action');
    await expect(page.locator('#dynamic-form [name="status"]')).toHaveValue('Closed');
    await expect(page.locator('#dynamic-form [name="branch"]')).toHaveValue('Wadi Saqra');
    await expect(page.locator('#dynamic-form [name="reviewType"]')).toHaveValue('Recorded');
    const targetHeight = await page.getByRole('button', { name: 'Add New Ticket', exact: true }).evaluate((element) => element.getBoundingClientRect().height);
    expect(targetHeight).toBeGreaterThanOrEqual(44);
  });

  test('mobile modal stays centered, contained, and free of horizontal overflow', async ({ populatedPage: page }) => {
    await openCctv(page, 320, 'dark');
    await openFirstTicket(page);
    const dimensions = await page.locator('.cctv-ticket-modal__panel').evaluate((panel) => {
      const box = panel.getBoundingClientRect();
      return {
        left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        width: box.width, viewportWidth: innerWidth, viewportHeight: innerHeight,
        horizontalOverflow: panel.scrollWidth - panel.clientWidth
      };
    });
    expect(dimensions.left).toBeGreaterThanOrEqual(0);
    expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewportWidth);
    expect(dimensions.top).toBeGreaterThanOrEqual(0);
    expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.viewportHeight);
    expect(dimensions.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(dimensions.width).toBeGreaterThanOrEqual(300);
    const mobileDetailColumns = await page.locator('.cctv-detail-layout').evaluate((layout) => getComputedStyle(layout).gridTemplateColumns.split(' ').length);
    expect(mobileDetailColumns).toBe(1);
    const mobileGroupColumns = await page.locator('.cctv-detail-group__grid').evaluateAll((groups) => groups.map(
      (group) => getComputedStyle(group).gridTemplateColumns.split(' ').length
    ));
    expect(mobileGroupColumns.every((count) => count === 1)).toBe(true);
  });

  test('Edit Save retains the existing mutation envelope and returns to read-only Details', async ({ populatedPage: page }) => {
    const requests = [];
    await page.route('**/.netlify/functions/tickets', async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      requests.push(await route.request().postDataJSON());
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.route('**/.netlify/functions/sheets', async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await openCctv(page);
    await openFirstTicket(page);
    await page.locator('#drawer-edit-btn').click();
    await page.locator('#drawer-edit-form [name="status"]').selectOption('Closed');
    await page.locator('#drawer-edit-form [name="actionTaken"]').fill('Reviewed and closed');
    const save = page.locator('#drawer-save-btn');
    await save.click();
    await expect(save).toContainText('Saving');
    await expect(page.locator('#drawer-edit-form')).toHaveCount(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ section: 'cctv', status: 'Closed', actionTaken: 'Reviewed and closed' });
    await expect(page.locator('#drawer-details-tab')).toHaveAttribute('aria-selected', 'true');
  });

  test('Create submit failure stays open and uses existing inline error ownership', async ({ populatedPage: page }) => {
    await page.route('**/.netlify/functions/tickets', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Create rejected' }) });
    });
    await openCctv(page);
    await page.getByRole('button', { name: 'Add New Ticket', exact: true }).click();
    await page.locator('#ticket-form [type="submit"]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.getByText('Failed to create ticket: Create rejected')).toBeVisible();
  });

  test('unexpected CCTV status data never becomes a lane, filter option, or valid status badge', async ({ populatedPage: page }) => {
    await routeCctvTickets(page, [
      { caseNumber: 'CCTV-VALID-1', status: 'Escalated', branch: 'Swefieh', dateTime: '2026-08-20T09:00:00Z' },
      { caseNumber: 'CCTV-VALID-2', status: 'Closed', branch: 'Manara', dateTime: '2026-08-21T09:00:00Z' },
      { caseNumber: 'CCTV-LEGACY-1', status: 'Legacy Review', branch: 'Wadi Saqra', dateTime: '2026-08-22T09:00:00Z' }
    ]);
    await openCctv(page, 1440, 'light', 2);
    await expectExactCctvLanes(page);
    await expect(page.locator('#cctv-stat-total')).toHaveText('3');
  });

  test('Evidence Snapshot preserves every approved field, status accent, and observation date semantic', async ({ populatedPage: page }) => {
    await routeCctvTickets(page, [
      {
        caseNumber: 'CCTV-EVIDENCE-1', status: 'Escalated', branch: 'Swefieh Village Operations Annex',
        date: '2026-08-20', time: '09:15 AM', cameras: ['Back of Kitchen', 'Prep Back Area'],
        staff: ['Olorunsola oluwafemi bk', 'Mohammed Abu Abdullah'], reviewType: 'Recorded',
        sections: ['Kitchen', 'Prep Main Stove'], violations: ['Kitchen Tools Compliance', 'Safety/Compliance']
      },
      { caseNumber: 'CCTV-EVIDENCE-2', status: 'Under Review', branch: 'Wadi Saqra', dateTime: '2026-08-21T10:30:00Z' },
      { caseNumber: 'CCTV-EVIDENCE-3', status: 'Closed', branch: 'Manara', dateTime: '2026-08-22' }
    ]);
    await openCctv(page, 1440, 'light', 3);

    const card = page.locator('.cctv-ticket-card').filter({ hasText: 'CCTV-EVIDENCE-1' });
    await expect(card).toHaveCount(1);
    await expect(card.locator('.cctv-status-pill')).toContainText('Escalated');
    await expect(card.locator('.cctv-ticket-date')).toHaveText('8/20/2026');
    await expect(card.locator('.cctv-ticket-case')).toHaveText('CCTV-EVIDENCE-1');
    await expect(card.locator('.cctv-ticket-branch')).toHaveText('Swefieh Village Operations Annex');
    await expect(card.locator('.cctv-evidence-snapshot')).toContainText('Evidence Snapshot');
    await expect(card.locator('.cctv-evidence-snapshot')).toContainText('Back of Kitchen, Prep Back Area');
    await expect(card.locator('.cctv-evidence-snapshot')).toContainText('8/20/2026 09:15 AM');
    await expect(card.locator('.cctv-evidence-snapshot')).toContainText('Olorunsola oluwafemi bk, Mohammed Abu Abdullah');
    await expect(card.locator('.cctv-supporting-rows')).toContainText('Recorded');
    await expect(card.locator('.cctv-supporting-rows')).toContainText('Kitchen, Prep Main Stove');
    await expect(card.locator('.cctv-supporting-rows')).toContainText('Kitchen Tools Compliance, Safety/Compliance');
    await expect(card.locator('[data-cc-icon-rendered="video"]')).toHaveCount(1);
    await expect(card.locator('[data-cc-icon-rendered="calendar-check"]')).toHaveCount(1);
    await expect(card.locator('[data-cc-icon-rendered="users"]')).toHaveCount(1);
    await expect(card.locator('[data-cc-icon-rendered="clipboard-list"]')).toHaveCount(1);
    await expect(card.locator('[data-cc-icon-rendered="layout-dashboard"]')).toHaveCount(1);
    await expect(card.locator('[data-cc-icon-rendered="shield-check"]')).toHaveCount(1);

    const structure = await card.evaluate((element) => {
      const branch = element.querySelector('.cctv-ticket-branch');
      const accent = element.querySelector('.cctv-ticket-accent');
      const snapshot = element.querySelector('.cctv-evidence-snapshot');
      return {
        accents: element.querySelectorAll('.cctv-ticket-accent').length,
        accentAfterBranch: Boolean(branch.compareDocumentPosition(accent) & Node.DOCUMENT_POSITION_FOLLOWING),
        snapshotAfterAccent: Boolean(accent.compareDocumentPosition(snapshot) & Node.DOCUMENT_POSITION_FOLLOWING),
        accentHorizontal: accent.getBoundingClientRect().width > accent.getBoundingClientRect().height * 20,
        oldVerticalAccent: !['none', 'normal'].includes(getComputedStyle(element, '::before').content)
      };
    });
    expect(structure).toEqual({
      accents: 1,
      accentAfterBranch: true,
      snapshotAfterAccent: true,
      accentHorizontal: true,
      oldVerticalAccent: false
    });

    const accents = await page.locator('.cctv-ticket-accent').evaluateAll((nodes) => nodes.map((node) => ({
      status: node.dataset.cctvStatusAccent,
      color: getComputedStyle(node).backgroundColor
    })));
    expect(accents).toEqual([
      { status: 'Escalated', color: 'rgb(199, 68, 68)' },
      { status: 'Under Review', color: 'rgb(168, 103, 15)' },
      { status: 'Closed', color: 'rgb(40, 122, 87)' }
    ]);
  });

  test('Evidence Snapshot keeps fixed missing fields and never invents an observation time', async ({ populatedPage: page }) => {
    await routeCctvTickets(page, [{
      caseNumber: 'CCTV-MISSING-1', status: 'Closed', branch: '', date: '2026-08-23',
      cameras: [], staff: [], sections: [], violations: [], reviewType: ''
    }]);
    await openCctv(page, 1440, 'light', 1);
    const card = page.locator('.cctv-ticket-card');
    await expect(card.locator('.cctv-ticket-branch')).toHaveText('Branch not specified');
    await expect(card.locator('.cctv-ticket-date')).toHaveText('8/23/2026');
    await expect(card.locator('.cctv-evidence-value')).toHaveText(['\u2014', '8/23/2026', '\u2014']);
    await expect(card.locator('.cctv-supporting-value')).toHaveText(['\u2014', '\u2014', '\u2014']);
    await expect(card).not.toContainText('12:00');
  });

  test('Evidence Snapshot reflows by card width and stacks at every required mobile width', async ({ populatedPage: page }) => {
    for (const width of [1440, 1280, 1024, 768, 430, 390, 360, 320]) {
      await openCctv(page, width, 'light');
      const layout = await page.locator('.cctv-column:visible .cctv-ticket-card').first().evaluate((card) => ({
        cardWidth: card.getBoundingClientRect().width,
        columns: getComputedStyle(card.querySelector('.cctv-evidence-grid')).gridTemplateColumns.split(' ').length,
        clipped: card.scrollWidth > card.clientWidth + 1
      }));
      expect(layout.clipped).toBe(false);
      if (width >= 1280) expect(layout.columns).toBe(3);
      if (width <= 768) expect(layout.columns).toBe(1);
      if (width === 1024) expect(layout.columns).toBeLessThanOrEqual(2);
    }
  });

  test('captures the six approved Evidence Snapshot card review images', async ({ populatedPage: page }) => {
    const evidenceTickets = [
      {
        caseNumber: 'CCTV-494', status: 'Escalated', branch: 'Wadi Saqra', date: '2026-05-07', time: '09:15 AM',
        cameras: ['3rd Pepsi Kitchen', 'Back of Kitchen'], staff: ['Amer Abu Laila', 'Mohammed Abu Abdullah'],
        reviewType: 'Recorded', sections: ['Kitchen', 'Prep Main Stove'], violations: ['Cleanliness', 'Safety/Compliance']
      },
      {
        caseNumber: 'CCTV-491', status: 'Under Review', branch: 'Wadi Saqra', dateTime: '2026-05-06T10:30:00Z',
        cameras: ['3rd Pepsi Kitchen'], staff: ['Abdul Qadir'], reviewType: 'Live', sections: ['Kitchen'], violations: ['Cleanliness']
      },
      {
        caseNumber: 'CCTV-467', status: 'Closed', branch: 'Wadi Saqra', date: '2026-05-01',
        cameras: ['3rd Pepsi Kitchen'], staff: ['Unknown'], reviewType: 'Recorded', sections: ['Kitchen'], violations: ['Gloves']
      }
    ];
    await routeCctvTickets(page, evidenceTickets);

    await openCctv(page, 1440, 'light', 3);
    await captureEvidenceReview(page, '1440-light-evidence-cards.png', true);
    await openCctv(page, 1440, 'dark', 3);
    await captureEvidenceReview(page, '1440-dark-evidence-cards.png', true);
    await openCctv(page, 768, 'light', 3);
    await captureEvidenceReview(page, '768-light-evidence-card.png');
    await openCctv(page, 390, 'light', 3);
    await captureEvidenceReview(page, '390-light-evidence-card.png');
    await openCctv(page, 390, 'dark', 3);
    await captureEvidenceReview(page, '390-dark-evidence-card.png');
    await openCctv(page, 320, 'light', 3);
    await captureEvidenceReview(page, '320-light-evidence-card.png');
  });

  test('read-only Details hides deferred PDF metadata while existing edit upload remains available', async ({ populatedPage: page }) => {
    await routeCctvTickets(page, [{
      caseNumber: 'CCTV-PDF-DEFERRED', status: 'Escalated', branch: 'Swefieh', dateTime: '2026-08-20T09:00:00Z',
      pdfName: 'deferred-cctv.pdf', pdfUrl: 'https://example.test/deferred-cctv.pdf', cctvPdf: 'deferred-cctv.pdf'
    }]);
    await openCctv(page, 1440, 'light', 1);
    await openFirstTicket(page);
    await expectNoDeferredAttachmentPresentation(page);
    await page.locator('#drawer-edit-btn').click();
    await expect(page.locator('#drawer-edit-form [name="cctvPdf"]')).toBeVisible();
  });

  for (const width of [1440, 390]) {
    test(`dark modal uses the neutral V2 surface with readable controls at ${width}px`, async ({ populatedPage: page }) => {
      await openCctv(page, width, 'dark');
      await openFirstTicket(page);
      await expectNeutralDarkModal(page);
      await expect(page.locator('.drawer-backdrop')).toHaveCSS('backdrop-filter', 'blur(3px)');
      await expect(page.locator('#drawer-details-tab')).toBeVisible();
      await expect(page.locator('#drawer-history-tab')).toBeVisible();
      await expect(page.locator('.cctv-detail-group')).not.toHaveCount(0);
      await expect(page.locator('#drawer-edit-btn')).toBeVisible();
      const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(pageOverflow).toBeLessThanOrEqual(1);
      await captureVisualReview(page, `${width}-dark-ticket-modal.png`, false);
    });
  }

  test('summary counts remain complete and unchanged after a restrictive filter', async ({ populatedPage: page }) => {
    await openCctv(page);
    const summary = page.locator('.cctv-stat-card strong');
    await expect(summary).toHaveText(['2', '0', '1', '1']);
    const before = await summary.allTextContents();
    await page.locator('#cctv-search').fill('no-ticket-can-match-this');
    await expect(page.locator('.cctv-ticket-card')).toHaveCount(0);
    await expect(page.locator('#tickets')).toContainText('No matching CCTV cases');
    await expect(summary).toHaveText(before);
  });

  test('CCTV dialog traps Tab and Shift+Tab with initial focus inside', async ({ populatedPage: page }) => {
    await openCctv(page);
    await openFirstTicket(page);
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    for (let index = 0; index < 10; index += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.querySelector('#ticket-drawer').contains(document.activeElement))).toBe(true);
    }
    for (let index = 0; index < 10; index += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => document.querySelector('#ticket-drawer').contains(document.activeElement))).toBe(true);
    }
    expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement === document.querySelector('main'))).toBe(false);
  });

  test('canCreate false hides only the create action', async ({ populatedPage: page }) => {
    await routeCctvAccess(page, { canView: true, canCreate: false, canEdit: true, canDelete: true });
    await openCctv(page);
    await expect(page.getByRole('button', { name: 'Add New Ticket', exact: true })).toBeHidden();
    await openFirstTicket(page);
    await expect(page.locator('#drawer-edit-btn')).toBeVisible();
    await expect(page.locator('#drawer-delete-btn')).toBeVisible();
  });

  test('canEdit false hides only the edit action', async ({ populatedPage: page }) => {
    await routeCctvAccess(page, { canView: true, canCreate: true, canEdit: false, canDelete: true });
    await openCctv(page);
    await openFirstTicket(page);
    await expect(page.locator('#drawer-edit-btn')).toHaveCount(0);
    await expect(page.locator('#drawer-delete-btn')).toBeVisible();
  });

  test('canDelete false hides only the delete action', async ({ populatedPage: page }) => {
    await routeCctvAccess(page, { canView: true, canCreate: true, canEdit: true, canDelete: false });
    await openCctv(page);
    await openFirstTicket(page);
    await expect(page.locator('#drawer-edit-btn')).toBeVisible();
    await expect(page.locator('#drawer-delete-btn')).toHaveCount(0);
  });

  test('all mutation permissions false hides create, edit, and delete', async ({ populatedPage: page }) => {
    await routeCctvAccess(page, { canView: true, canCreate: false, canEdit: false, canDelete: false });
    await openCctv(page);
    await expect(page.getByRole('button', { name: 'Add New Ticket', exact: true })).toBeHidden();
    await openFirstTicket(page);
    await expect(page.locator('#drawer-edit-btn')).toHaveCount(0);
    await expect(page.locator('#drawer-delete-btn')).toHaveCount(0);
  });

  test('canView false prevents CCTV runtime initialization', async ({ populatedPage: page }) => {
    await routeCctvAccess(page, { canView: false, canCreate: true, canEdit: true, canDelete: true });
    await page.goto('/cctv.html');
    await waitForSettledPage(page);
    await expect(page).toHaveURL(/dashboard\.html\?access=denied$/);
  });

  test('permissions unavailable prevents CCTV runtime initialization', async ({ populatedPage: page }) => {
    await routeCctvAccess(page, {}, { unavailable: true });
    await page.goto('/cctv.html');
    await waitForSettledPage(page);
    expect(await page.evaluate(async () => await window.CC_PROTECTED_PAGE_READY)).toBe(false);
    expect(await page.evaluate(() => typeof window.openTicketDrawer)).toBe('undefined');
  });

  test('mutant kill R01: the normal lane oracle rejects restored CCTV extras behavior', async ({ populatedPage: page }) => {
    await routeMutatedAsset(page, 'js/tickets-render.js', (source) => source.replace(
      'const columns = (isCctv ? desired : [...desired, ...extras]).filter(s => !HIDDEN.has(s));',
      'const columns = [...desired, ...extras].filter(s => !HIDDEN.has(s));'
    ));
    await routeCctvTickets(page, [
      { caseNumber: 'CCTV-VALID-1', status: 'Escalated' },
      { caseNumber: 'CCTV-LEGACY-1', status: 'Legacy Review' }
    ]);
    await openCctv(page, 1440, 'light', 2);
    await expectOracleKilled(() => expectExactCctvLanes(page));
  });

  test('mutant kill R02: the normal forbidden-data oracle rejects restored attachment presentation', async ({ populatedPage: page }) => {
    await routeMutatedAsset(page, 'main.js', (source) => source.replace(
      "    ], 'cctv-detail-group--wide')\n  ].filter(Boolean).join('');",
      "    ], 'cctv-detail-group--wide'),\n    buildCctvAttachmentsRow(ticket)\n  ].filter(Boolean).join('');"
    ));
    await routeCctvTickets(page, [{
      caseNumber: 'CCTV-PDF-MUTANT', status: 'Escalated', pdfName: 'deferred-cctv.pdf',
      pdfUrl: 'https://example.test/deferred-cctv.pdf', cctvPdf: 'deferred-cctv.pdf'
    }]);
    await openCctv(page, 1440, 'light', 1);
    await openFirstTicket(page);
    await expectOracleKilled(() => expectNoDeferredAttachmentPresentation(page));
  });

  test('mutant kill R03: the normal dark-surface oracle rejects restored weak selector ownership', async ({ populatedPage: page }) => {
    await routeMutatedAsset(page, 'assets/css/pages/cctv-v2.css', (source) => source.replace(
      'body.cctv-v2 #ticket-drawer .cctv-ticket-modal__panel.drawer-panel {',
      'body.cctv-v2 .cctv-ticket-modal__panel.drawer-panel {'
    ));
    await openCctv(page, 1440, 'dark');
    await openFirstTicket(page);
    await expectOracleKilled(() => expectNeutralDarkModal(page));
  });

  test('mutant kill: the normal backdrop oracle rejects disabled backdrop dismissal', async ({ populatedPage: page }) => {
    await routeMutatedAsset(page, 'main.js', (source) => source.replace(
      "      dismissOnBackdrop: true,\n      initialFocus: '.drawer-close',",
      "      dismissOnBackdrop: false,\n      initialFocus: '.drawer-close',"
    ));
    await openCctv(page);
    await openFirstTicket(page);
    await expectOracleKilled(() => expectBackdropDismissal(page));
  });

  test('mutant kill: the normal inside-panel oracle rejects ownership removal', async ({ populatedPage: page }) => {
    await routeMutatedAsset(page, 'assets/js/components/dialog.js', (source) => source.replace(
      'if (!entry || !backdropMatches(entry, event.target)) return;',
      'if (!entry) return;'
    ));
    await openCctv(page);
    await openFirstTicket(page);
    await expectOracleKilled(() => expectInsidePanelOwnership(page));
  });

  test('mutant kill: the normal focus oracle rejects disabled origin restoration', async ({ populatedPage: page }) => {
    await routeMutatedAsset(page, 'assets/js/components/dialog.js', (source) => source.replace(
      'if (wasTopmost && settings.restoreFocus !== false) {',
      'if (false && wasTopmost && settings.restoreFocus !== false) {'
    ));
    await openCctv(page);
    const origin = await openFirstTicket(page);
    await expectOracleKilled(() => expectExactFocusRestoration(page, origin));
  });

  test('fault probe: non-dismissible backdrop violates the close contract', async ({ populatedPage: page }) => {
    await openCctv(page);
    const origin = await openFirstTicket(page);
    await page.evaluate((origin) => {
      const drawer = document.getElementById('ticket-drawer');
      window.CloudCrowdOverlay.unregister(drawer.id);
      window.CloudCrowdOverlay.register(drawer, {
        type: 'dialog', panel: '.drawer-panel', backdrop: '.drawer-backdrop',
        dismissOnEscape: true, dismissOnBackdrop: false, initialFocus: '.drawer-close', lockScroll: true
      });
      window.CloudCrowdOverlay.open(drawer.id, { trigger: origin });
    }, await origin.elementHandle());
    await page.locator('.drawer-backdrop').click({ position: { x: 2, y: 2 } });
    const backdropCloseContract = await page.locator('#ticket-drawer').evaluate((drawer) => !drawer.classList.contains('open'));
    expect(backdropCloseContract).toBe(false);
  });

  test('fault probes: inside-close and broken focus restoration violate their oracles', async ({ populatedPage: page }) => {
    await openCctv(page);
    const origin = await openFirstTicket(page);
    await page.locator('.cctv-ticket-modal__panel').evaluate((panel) => {
      panel.addEventListener('click', () => window.closeTicketDrawer(), { once: true });
    });
    await page.locator('.cctv-ticket-modal__panel').click({ position: { x: 20, y: 20 } });
    expect(await page.locator('#ticket-drawer').evaluate((drawer) => drawer.classList.contains('open'))).toBe(false);

    await origin.evaluate((card) => {
      document.body.tabIndex = -1;
      card.focus = () => document.body.focus();
    });
    await origin.click();
    await page.keyboard.press('Escape');
    expect(await origin.evaluate((card) => document.activeElement === card)).toBe(false);
  });

  test('fault probes: structural, icon, clipping, reachability, viewport, and permission mutations are rejected', async ({ populatedPage: page }) => {
    await openCctv(page, 320, 'dark');
    await openFirstTicket(page);
    const killed = await page.evaluate(() => {
      const extra = document.createElement('section');
      extra.className = 'group cctv-column';
      extra.innerHTML = '<h2 class="cc-kanban__title">Fourth Status</h2>';
      document.getElementById('tickets').appendChild(extra);

      const reviewIcon = document.querySelector('[data-cctv-status-identity="Under Review"] [data-cc-icon-rendered]');
      reviewIcon.dataset.ccIconRendered = 'triangle-alert';

      const metadata = document.querySelector('.cctv-evidence-snapshot');
      metadata.style.maxHeight = '8px';
      metadata.style.overflow = 'hidden';
      const board = document.querySelector('#tickets');
      board.style.overflowX = 'hidden';
      const panel = document.querySelector('.cctv-ticket-modal__panel');
      panel.style.width = '400px';
      panel.style.maxWidth = 'none';

      window.CC_PAGE_ACCESS = { moduleKey: 'cctv', canView: true, canCreate: true, canEdit: false, canDelete: false };
      const exposed = document.createElement('button');
      exposed.id = 'mutant-permission-action';
      exposed.textContent = 'Edit';
      document.querySelector('.drawer-actions').appendChild(exposed);

      const statuses = [...document.querySelectorAll('.cctv-column .cc-kanban__title')].map((node) => node.textContent.trim());
      const box = panel.getBoundingClientRect();
      return {
        exactStatuses: JSON.stringify(statuses) === JSON.stringify(['Escalated', 'Under Review', 'Closed']),
        distinctReviewIcon: reviewIcon.dataset.ccIconRendered === 'refresh-cw',
        metadataReachable: metadata.scrollHeight <= metadata.clientHeight,
        horizontalReachable: ['auto', 'scroll'].includes(getComputedStyle(board).overflowX),
        modalContained: box.left >= 0 && box.right <= innerWidth,
        permissionHidden: !document.getElementById('mutant-permission-action')
      };
    });
    expect(killed).toEqual({
      exactStatuses: false,
      distinctReviewIcon: false,
      metadataReachable: false,
      horizontalReachable: false,
      modalContained: false,
      permissionHidden: false
    });
  });
});
