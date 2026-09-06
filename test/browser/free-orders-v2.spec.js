const fs = require('node:fs');
const path = require('node:path');
const { test, expect, waitForSettledPage } = require('./fixtures');

const ROOT = path.resolve(__dirname, '..', '..');
const CAPTURE_DIR = path.join(ROOT, 'artifacts', 'complimentary-orders-v2-visual-review');
const FIELD_LABELS = [
  'Status', 'Customer Name', 'Phone Number', 'Order Date', 'Order Number',
  'Order on Circa', 'Discount Amount', 'Reason for Discount', 'Order Channel',
  'Decision Maker', 'Attached', 'The date of using the discount',
  'New order number', 'Deduction from', 'Case description'
];
fs.mkdirSync(CAPTURE_DIR, { recursive: true });

async function openFreeOrders(page, width = 1440, theme = 'dark') {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((value) => localStorage.setItem('cc_theme', value), theme);
  await page.goto('/free-orders.html');
  await waitForSettledPage(page);
  await expect(page.locator('.free-orders-column')).toHaveCount(3);
}

async function seedVisualBoard(page) {
  await page.evaluate(() => {
    tickets['free-orders'] = [
      { caseNumber: 'BH-48291', orderNumber: 'BH-48291', status: 'New', customerName: 'Rana Haddad', phone: '0798 245 610', discountAmount: '18.00', reasonForDiscount: 'Missing item', decisionMaker: 'Maya Saleh', channel: 'Circa', orderDate: '2026-09-05T09:00:00Z' },
      { caseNumber: 'BH-48276', orderNumber: 'BH-48276', status: 'New', customerName: 'Omar Nassar', phone: '0798 245 610', discountAmount: '15.00', reasonForDiscount: 'Late delivery', decisionMaker: 'Samer Khalil', channel: 'Talabat', orderDate: '2026-09-04T09:00:00Z' },
      { caseNumber: 'BH-48190', orderNumber: 'BH-48190', status: 'Active', customerName: 'Lina Qudah', phone: '0798 245 610', discountAmount: '22.50', reasonForDiscount: 'Order quality', decisionMaker: 'Dana Ahmad', channel: 'Careem', orderDate: '2026-09-03T09:00:00Z' },
      { caseNumber: 'BH-48144', orderNumber: 'BH-48144', status: 'Active', customerName: 'Yazan Abu Sara', phone: '0798 245 610', discountAmount: '12.00', reasonForDiscount: 'Service recovery', decisionMaker: 'Maya Saleh', channel: 'Circa', orderDate: '2026-09-02T09:00:00Z' },
      { caseNumber: 'BH-47982', orderNumber: 'BH-47982', status: 'Taken', customerName: 'Ahmad Mansour', phone: '0798 245 610', discountAmount: '25.00', reasonForDiscount: 'Incorrect order', decisionMaker: 'Samer Khalil', newOrderNumber: 'BH-48305', channel: 'Circa', orderDate: '2026-08-30T09:00:00Z' },
      { caseNumber: 'BH-47861', orderNumber: 'BH-47861', status: 'Taken', customerName: 'Malak Ayoub', phone: '0798 245 610', discountAmount: '10.00', reasonForDiscount: 'Missing item', decisionMaker: 'Dana Ahmad', newOrderNumber: 'BH-48240', channel: 'Talabat', orderDate: '2026-08-28T09:00:00Z' }
    ];
    renderTickets();
  });
}

test.describe.serial('Complimentary Orders V2 Phase 3A', () => {
  test('1440 dark board matches the approved production composition', async ({ populatedPage: page }) => {
    const consoleErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    await openFreeOrders(page);
    await seedVisualBoard(page);
    await expect(page.locator('.free-orders-column .cc-kanban__title')).toHaveText(['New', 'Active', 'Taken']);
    await expect(page.locator('.free-orders-stat-card strong')).toHaveText(['6', '2', '2', '2', '102.5']);
    await expect(page.locator('.free-orders-stat-label')).toHaveText(['Total Orders', 'New', 'Active', 'Taken', 'Total Discount Value']);
    await expect(page.locator('.free-orders-filter-field label')).toHaveText(['Search', 'Status', 'Channel', 'Decision Maker', 'New Order Number']);
    await expect(page.locator('.free-orders-stat-icon svg')).toHaveCount(5);

    const geometry = await page.evaluate(() => {
      const hero = document.querySelector('.free-orders-hero').getBoundingClientRect();
      const sidebar = document.getElementById('free-orders-app-sidebar').getBoundingClientRect();
      const lanes = [...document.querySelectorAll('.free-orders-column')];
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sidebarWidth: sidebar.width,
        hero: hero.toJSON(),
        heroHeight: hero.height,
        laneWidths: lanes.map((lane) => lane.getBoundingClientRect().width),
        laneColors: lanes.map((lane) => getComputedStyle(lane.querySelector('.col-title')).color),
        filterHeights: [...document.querySelectorAll('.free-orders-filter-field input, .free-orders-filter-field select')].map((control) => control.getBoundingClientRect().height),
        heroBackground: getComputedStyle(document.querySelector('.free-orders-hero')).backgroundImage,
        cta: document.querySelector('.free-orders-actions .add-ticket-btn').getBoundingClientRect().toJSON(),
        metricIconLayout: [...document.querySelectorAll('.free-orders-stat-card')].map((card) => ({
          iconRight: card.querySelector('.free-orders-stat-icon').getBoundingClientRect().right,
          labelLeft: card.querySelector('.free-orders-stat-label').getBoundingClientRect().left
        }))
      };
    });
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(geometry.sidebarWidth).toBe(224);
    expect(geometry.heroHeight).toBeLessThanOrEqual(110);
    expect(geometry.heroBackground).toContain('ce-hero-earth.png');
    expect(geometry.cta.left).toBeGreaterThanOrEqual(geometry.hero.left);
    expect(geometry.cta.right).toBeLessThanOrEqual(geometry.hero.right);
    expect(geometry.cta.top).toBeGreaterThanOrEqual(geometry.hero.top);
    expect(geometry.cta.bottom).toBeLessThanOrEqual(geometry.hero.bottom);
    geometry.laneWidths.forEach((width) => { expect(width).toBeGreaterThanOrEqual(360); expect(width).toBeLessThanOrEqual(400); });
    expect(geometry.laneColors).toEqual(['rgb(255, 77, 61)', 'rgb(60, 156, 255)', 'rgb(56, 207, 120)']);
    geometry.filterHeights.forEach((height) => expect(height).toBeGreaterThanOrEqual(44));
    geometry.metricIconLayout.forEach(({ iconRight, labelLeft }) => expect(iconRight).toBeLessThanOrEqual(labelLeft));

    const activeCard = page.locator('.free-orders-ticket-card').filter({ hasText: 'BH-48190' });
    const takenCard = page.locator('.free-orders-ticket-card').filter({ hasText: 'BH-47982' });
    await expect(activeCard).toHaveCount(1);
    await expect(takenCard).toHaveCount(1);
    await expect(activeCard.first().getByText('Discount Amount', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(CAPTURE_DIR, '1440-dark-main.png'), fullPage: false });
    expect(consoleErrors).toEqual([]);
  });

  test('1440 dark create modal keeps all fields and scroll ownership in the viewport', async ({ populatedPage: page }) => {
    await openFreeOrders(page);
    const origin = page.getByRole('button', { name: 'Add New Ticket', exact: true });
    await origin.click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#modal .cc-form-section__title')).toHaveText([
      'Customer and Order', 'Order and Compensation', 'Approval and Attachment', 'Usage and Deduction', 'Case Details'
    ]);
    await expect(page.locator('#modal .cc-field__label')).toHaveText(FIELD_LABELS);
    await expect(page.locator('#modal :is(input, select, textarea)')).toHaveCount(15);
    await expect(page.locator('#modal input[type="file"]')).toHaveCount(2);
    await expect(page.locator('#cc-free-orders-status')).toHaveValue('New');
    await expect(page.locator('#cc-free-orders-channel')).toHaveValue('Circa');

    const geometry = await page.locator('#modal .cc-dialog__panel').evaluate((panel) => {
      const box = panel.getBoundingClientRect();
      const form = panel.querySelector('#ticket-form');
      const body = panel.querySelector('#dynamic-form');
      const header = panel.querySelector('.cc-dialog__header').getBoundingClientRect();
      const footer = panel.querySelector('.cc-dialog__footer').getBoundingClientRect();
      return {
        width: box.width,
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        panelOverflow: getComputedStyle(panel).overflow,
        formOverflow: getComputedStyle(form).overflow,
        bodyOverflowY: getComputedStyle(body).overflowY,
        headerTop: header.top,
        footerBottom: footer.bottom,
        columns: getComputedStyle(panel.querySelector('.cc-form-grid')).gridTemplateColumns.split(' ').length
      };
    });
    expect(geometry.width).toBeGreaterThanOrEqual(820);
    expect(geometry.width).toBeLessThanOrEqual(900);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.panelOverflow).toBe('hidden');
    expect(geometry.formOverflow).toBe('hidden');
    expect(geometry.bodyOverflowY).toBe('auto');
    expect(geometry.headerTop).toBeGreaterThanOrEqual(0);
    expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.columns).toBe(3);

    await page.locator('#modal .cc-form-section').last().scrollIntoViewIfNeeded();
    await expect(page.locator('#modal .cc-form-section').last()).toBeVisible();
    await expect(page.locator('#modal .cc-dialog__footer')).toBeVisible();
    await page.screenshot({ path: path.join(CAPTURE_DIR, '1440-create-modal-dark.png'), fullPage: false });
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
    await expect(origin).toBeFocused();
  });

  test('unknown statuses append after the three core lanes with neutral styling', async ({ populatedPage: page }) => {
    await openFreeOrders(page);
    await page.evaluate(() => {
      tickets['free-orders'].push({
        caseNumber: 'FO-UNKNOWN-1', orderNumber: 'FO-UNKNOWN-1', status: 'Awaiting Review',
        customerName: 'Unknown Lane Customer', discountAmount: '3.00', orderDate: '2026-09-05T09:00:00Z'
      });
      renderTickets();
    });
    await expect(page.locator('.free-orders-column .cc-kanban__title')).toHaveText(['New', 'Active', 'Taken', 'Awaiting Review']);
    const neutral = await page.locator('.free-orders-column').nth(3).locator('.col-title').evaluate((title) => getComputedStyle(title).color);
    expect(neutral).toBe('rgb(138, 156, 171)');
    const boardReach = await page.locator('#tickets').evaluate((board) => ({ clientWidth: board.clientWidth, scrollWidth: board.scrollWidth }));
    expect(boardReach.scrollWidth).toBeGreaterThan(boardReach.clientWidth);
    await page.locator('.free-orders-column').nth(3).evaluate((lane) => { lane.parentElement.scrollLeft = lane.offsetLeft; });
    await expect(page.locator('.free-orders-column').nth(3)).toBeInViewport();
  });

  test('a sparse optional-field card remains intentional and operable', async ({ populatedPage: page }) => {
    await openFreeOrders(page);
    await page.evaluate(() => {
      tickets['free-orders'] = [{ caseNumber: 'SPARSE-1', orderNumber: 'SPARSE-1', status: 'New', customerName: 'Sparse Customer', discountAmount: '5' }];
      renderTickets();
    });
    const card = page.locator('.free-orders-ticket-card');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('SPARSE-1');
    await expect(card.locator('.free-orders-ticket-phone')).toHaveCount(0);
    await expect(card.locator('.free-orders-ticket-reason')).toHaveCount(0);
    await expect(card.locator('.free-orders-ticket-grid span')).toHaveCount(0);
    const box = await card.boundingBox();
    expect(box.width).toBeGreaterThan(250);
    expect(box.height).toBeGreaterThan(70);
    await card.press('Enter');
    await expect(page.locator('#ticket-drawer')).toHaveClass(/open/);
  });

  test('cards preserve click, Enter, and Space activation', async ({ populatedPage: page }) => {
    await openFreeOrders(page);
    for (const activation of ['click', 'Enter', 'Space']) {
      const card = page.locator('.free-orders-ticket-card').first();
      if (activation === 'click') await card.click();
      else { await card.focus(); await card.press(activation); }
      await expect(page.locator('#ticket-drawer')).toHaveClass(/open/);
      await page.keyboard.press('Escape');
      await expect(card).toBeFocused();
    }
  });

  test('shared responsive navigation opens and restores focus', async ({ populatedPage: page }) => {
    await openFreeOrders(page, 1024, 'dark');
    const trigger = page.getByRole('button', { name: 'Open application navigation' });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.locator('#free-orders-shell')).toHaveClass(/is-nav-open/);
    await expect(page.locator('#free-orders-nav-backdrop')).toBeVisible();
    await expect(page.locator('#free-orders-app-sidebar .cc-shell-nav-link.is-active')).toHaveAttribute('href', 'free-orders.html');
    await expect(page.locator('body')).toHaveClass(/cc-shell-nav-lock/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#free-orders-shell')).not.toHaveClass(/is-nav-open/);
    await expect(trigger).toBeFocused();
  });
});
