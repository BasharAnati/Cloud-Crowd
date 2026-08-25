const fs = require('node:fs');
const path = require('node:path');
const { test, expect, waitForSettledPage } = require('./fixtures');

const ROOT = path.resolve(__dirname, '..', '..');
const APPROVED_DARK_MODAL = 'rgb(27, 37, 48)';

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
  for (const width of [1440, 1280, 1024, 768, 390, 360, 320]) {
    test(`layout remains reachable at ${width}px`, async ({ populatedPage: page }) => {
      await openCctv(page, width, width <= 390 ? 'dark' : 'light');

      await expect(page.locator('body')).toHaveClass(/cctv-v2/);
      await expect(page.locator('.cctv-column')).toHaveCount(3);
      await expect(page.locator('.cctv-column .cc-kanban__title')).toHaveText([
        'Escalated', 'Under Review', 'Closed'
      ]);

      const geometry = await page.evaluate(() => {
        const rect = (selector) => {
          const element = document.querySelector(selector);
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        };
        const board = document.querySelector('#tickets');
        const kanban = document.querySelector('#tickets');
        const pageOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        return {
          header: rect('.cctv-hero'),
          filters: rect('.cctv-filters'),
          board: rect('#tickets'),
          kanbanScrollWidth: kanban.scrollWidth,
          boardClientWidth: board.clientWidth,
          boardScrollWidth: board.scrollWidth,
          pageOverflow
        };
      });

      expect(geometry.header.height).toBeLessThan(width <= 700 ? 230 : 210);
      expect(geometry.filters.height).toBeLessThan(width <= 420 ? 350 : 220);
      expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
      if (width <= 900) {
        expect(geometry.boardScrollWidth).toBeGreaterThan(geometry.boardClientWidth);
        await page.locator('#tickets').evaluate((element) => element.scrollTo({ left: element.scrollWidth, behavior: 'instant' }));
        await expect.poll(() => page.locator('#tickets').evaluate(
          (element) => element.scrollLeft + element.offsetWidth >= element.scrollWidth - 2
        )).toBe(true);
      }
    });
  }

  test('status identities use distinct local icons and readable metadata', async ({ populatedPage: page }) => {
    await openCctv(page);
    const reviewCard = page.locator('[data-cctv-status-identity="Under Review"]').locator('..').locator('..');
    await expect(page.locator('[data-cctv-status-identity="Under Review"] [data-cc-icon-rendered="refresh-cw"]')).toHaveCount(1);
    await expect(page.locator('.cctv-column').nth(0).locator('[data-cc-icon-rendered="triangle-alert"]')).toHaveCount(1);
    await expect(page.locator('.cctv-column').nth(2).locator('[data-cc-icon-rendered="badge-check"]')).toHaveCount(2);
    await expect(reviewCard.locator('.cctv-ticket-case')).toContainText('CCTV-S116-1');
    await expect(reviewCard.locator('.cctv-ticket-grid')).toBeVisible();
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
  });

  test('Edit Save retains the existing mutation envelope and returns to read-only Details', async ({ populatedPage: page }) => {
    const requests = [];
    await page.route('**/.netlify/functions/tickets', async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      requests.push(await route.request().postDataJSON());
      await new Promise((resolve) => setTimeout(resolve, 80));
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

      const metadata = document.querySelector('.cctv-ticket-grid');
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
