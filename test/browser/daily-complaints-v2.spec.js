const fs = require('node:fs');
const path = require('node:path');
const { test, expect, waitForSettledPage } = require('./fixtures');

const ROOT = path.resolve(__dirname, '..', '..');
const CAPTURE_DIR = path.join(ROOT, 'artifacts', 'daily-complaints-v2-visual-review');
const COMPLAINT_DETAIL_LABELS = ['Branch', 'Restaurant', 'Issue', 'Department', 'Phone'];
fs.mkdirSync(CAPTURE_DIR, { recursive: true });

async function openComplaints(page, width, theme) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((value) => localStorage.setItem('cc_theme', value), theme);
  await page.goto('/complaints.html');
  await waitForSettledPage(page);
  await expect(page.locator('.complaints-column')).toHaveCount(4);
}

async function capture(page, name, fullPage = true) {
  await page.screenshot({ path: path.join(CAPTURE_DIR, name), fullPage });
}

async function expectFullComplaintProjection(card) {
  await expect(card.locator('.complaints-ticket-grid strong')).toHaveText(COMPLAINT_DETAIL_LABELS);
  for (const label of COMPLAINT_DETAIL_LABELS) {
    await expect(card.getByText(label, { exact: true })).toBeVisible();
  }
}

test.describe('Daily Complaints V2 Phase 3B', () => {
  const frames = [
    [1440, 'dark', '1440-dark-main.png'], [1440, 'light', '1440-light-main.png'],
    [1024, 'light', '1024-light-main.png'], [768, 'light', '768-light-main.png'],
    [430, 'light', '430-light-main.png'], [390, 'dark', '390-dark-main.png'],
    [390, 'light', '390-light-main.png'], [360, 'light', '360-light-main.png'],
    [320, 'light', '320-light-main.png']
  ];

  for (const [width, theme, filename] of frames) {
    test(`${width}px ${theme} main composition is contained and board-owned`, async ({ populatedPage: page }) => {
      await openComplaints(page, width, theme);
      await expect(page.locator('.complaints-column .cc-kanban__title')).toHaveText(['Escalated', 'Under Review', 'Pending (Call Back)', 'Closed']);
      await expect(page.locator('.complaints-stat-card strong')).toHaveText(['2', '1', '0', '0', '1']);
      await expect(page.locator('.complaints-filter-field label')).toHaveText(['Search', 'Status', 'Branch', 'Restaurant', 'Issue Category']);
      const underReviewCard = page.locator('.complaints-ticket-card').filter({ hasText: 'CMP-1001' });
      const closedCard = page.locator('.complaints-ticket-card').filter({ hasText: 'CMP-1002' });
      await expect(underReviewCard).toHaveCount(1);
      await expect(closedCard).toHaveCount(1);
      await expectFullComplaintProjection(underReviewCard);
      await expectFullComplaintProjection(closedCard);
      const result = await page.evaluate(() => {
        const board = document.getElementById('tickets');
        const columns = [...document.querySelectorAll('.complaints-column')];
        const sidebar = document.getElementById('complaints-app-sidebar');
        const sidebarBox = sidebar.getBoundingClientRect();
        const hero = document.querySelector('.complaints-hero');
        const heroBox = hero.getBoundingClientRect();
        const actionBox = hero.querySelector('.complaints-actions').getBoundingClientRect();
        const boardBox = board.getBoundingClientRect();
        const secondColumnBox = columns[1].getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          boardOverflowX: getComputedStyle(board).overflowX,
          boardScrollable: board.scrollWidth > board.clientWidth,
          widths: columns.map((column) => column.getBoundingClientRect().width),
          heights: columns.map((column) => column.getBoundingClientRect().height),
          laneCue: Math.max(0, boardBox.right - secondColumnBox.left),
          hero: { height: heroBox.height, top: heroBox.top, bottom: heroBox.bottom, actionTop: actionBox.top, actionBottom: actionBox.bottom },
          sidebar: { right: sidebarBox.right, width: sidebarBox.width },
          laneTitleColors: columns.map((column) => getComputedStyle(column.querySelector('.col-title')).color),
          metricHeights: [...document.querySelectorAll('.complaints-stat-card')].map((card) => card.getBoundingClientRect().height),
          metricIcons: [...document.querySelectorAll('.complaints-stat-icon')].map((icon) => ({ width: icon.getBoundingClientRect().width, height: icon.getBoundingClientRect().height })),
          filterHeights: [...document.querySelectorAll('.complaints-filter-field input, .complaints-filter-field select')].map((control) => control.getBoundingClientRect().height),
          glows: [...document.querySelectorAll('.complaints-ticket-card')].map((card) => {
            const left = getComputedStyle(card, '::before');
            const right = getComputedStyle(card, '::after');
            return { leftWidth: parseFloat(left.width), leftHeight: parseFloat(left.height), rightWidth: parseFloat(right.width), rightHeight: parseFloat(right.height), leftPointer: left.pointerEvents, rightPointer: right.pointerEvents };
          })
        };
      });
      expect(result.overflow).toBeLessThanOrEqual(1);
      expect(result.boardOverflowX).toBe('auto');
      result.widths.forEach((value) => expect(value).toBeGreaterThanOrEqual(279));
      result.widths.forEach((value) => expect(value).toBeLessThanOrEqual(321));
      if (width <= 1024) {
        expect(result.boardScrollable).toBe(true);
        expect(result.sidebar.right, JSON.stringify(result.sidebar)).toBeLessThanOrEqual(0);
        expect(result.hero.height).toBeLessThanOrEqual(width <= 620 ? 230 : width <= 768 ? 170 : 150);
        expect(result.hero.actionTop).toBeGreaterThanOrEqual(result.hero.top);
        expect(result.hero.actionBottom).toBeLessThanOrEqual(result.hero.bottom);
      }
      if (width === 1440 && theme === 'dark') {
        expect(result.sidebar.width).toBe(224);
        expect(result.hero.height).toBeLessThanOrEqual(118);
        result.heights.forEach((height) => { expect(height).toBeGreaterThanOrEqual(400); expect(height).toBeLessThanOrEqual(450); });
        result.metricHeights.forEach((height) => expect(height).toBeGreaterThanOrEqual(104));
        result.metricIcons.forEach((icon) => expect(icon).toMatchObject({ width: 56, height: 56 }));
        expect(result.laneTitleColors).toEqual(['rgb(255, 89, 108)', 'rgb(243, 163, 27)', 'rgb(25, 167, 255)', 'rgb(32, 207, 122)']);
      }
      if (width === 390) { expect(result.laneCue).toBeGreaterThanOrEqual(12); expect(result.laneCue).toBeLessThanOrEqual(29); }
      result.filterHeights.forEach((height) => expect(height).toBeGreaterThanOrEqual(44));
      result.glows.forEach((glow) => {
        expect(glow.leftWidth).toBeLessThanOrEqual(34); expect(glow.leftHeight).toBeLessThanOrEqual(24);
        expect(glow.rightWidth).toBeLessThan(glow.leftWidth); expect(glow.rightHeight).toBeLessThan(glow.leftHeight);
        expect(glow.leftPointer).toBe('none'); expect(glow.rightPointer).toBe('none');
      });
      await capture(page, filename);
    });
  }

  test('390px dark exposes a populated ticket with the full canonical projection', async ({ populatedPage: page }) => {
    await openComplaints(page, 390, 'dark');
    const underReviewColumn = page.locator('.complaints-column').filter({ hasText: 'Under Review' });
    await expect(underReviewColumn).toHaveCount(1);
    await underReviewColumn.evaluate((column) => { column.parentElement.scrollLeft = column.offsetLeft; });
    const card = underReviewColumn.locator('.complaints-ticket-card');
    await expectFullComplaintProjection(card);
    await capture(page, '390-dark-populated-ticket.png');
  });

  test('shared mobile drawer opens, locks, closes, and restores focus', async ({ populatedPage: page }) => {
    await openComplaints(page, 390, 'dark');
    const trigger = page.getByRole('button', { name: 'Open application navigation' });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.locator('#complaints-shell')).toHaveClass(/is-nav-open/);
    await expect(page.locator('#complaints-nav-backdrop')).toBeVisible();
    await expect(page.locator('#complaints-app-sidebar .cc-shell-mobile-close')).toBeVisible();
    await expect(page.locator('#complaints-app-sidebar .cc-shell-nav-link.is-active')).toHaveAttribute('href', 'complaints.html');
    await expect(page.locator('body')).toHaveClass(/cc-shell-nav-lock/);
    await capture(page, '390-drawer-open.png', false);
    await page.keyboard.press('Escape');
    await expect(page.locator('#complaints-shell')).not.toHaveClass(/is-nav-open/);
    await expect(trigger).toBeFocused();
  });

  for (const width of [1024, 768, 430, 390, 360, 320]) {
    test(`${width}px visible topbar controls stay inside the viewport`, async ({ populatedPage: page }) => {
      await openComplaints(page, width, 'light');
      const result = await page.locator('#complaints-app-topbar').evaluate((topbar) => {
        const controls = [...topbar.querySelectorAll('button, .cc-shell-user-badge, .cc-shell-role-badge')].filter((control) => {
          const style = getComputedStyle(control); const box = control.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
        }).map((control) => {
          const box = control.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, width: box.width, height: box.height, textFits: control.scrollWidth <= control.clientWidth + 1 };
        });
        return { controls, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, viewportWidth: innerWidth };
      });
      expect(result.controls.length).toBeGreaterThanOrEqual(4);
      result.controls.forEach((control) => {
        expect(control.left).toBeGreaterThanOrEqual(0); expect(control.right).toBeLessThanOrEqual(result.viewportWidth);
        expect(control.top).toBeGreaterThanOrEqual(0); expect(control.width).toBeGreaterThan(0); expect(control.height).toBeGreaterThan(0);
        expect(control.textFits).toBe(true); if (width <= 390) expect(control.height).toBeGreaterThanOrEqual(43);
      });
      expect(result.overflow).toBeLessThanOrEqual(1);
    });
  }

  for (const [width, theme, filename] of [
    [1440, 'dark', '1440-create-modal-dark.png'], [1440, 'light', '1440-create-modal-light.png'],
    [390, 'dark', '390-create-modal-dark.png'], [390, 'light', '390-create-modal-light.png'], [320, 'light', '320-create-modal-light.png']
  ]) {
    test(`${width}px ${theme} create modal preserves fields, icons, and viewport`, async ({ populatedPage: page }) => {
      await openComplaints(page, width, theme);
      const origin = page.getByRole('button', { name: 'Add New Ticket', exact: true });
      await origin.click();
      await expect(page.locator('#modal')).toHaveClass(/open/);
      await expect(page.locator('#modal .cc-field__label')).toHaveText([
        'Status', 'Order Number', 'Department Responsible', 'Customer Name', 'Phone Number', 'Creation Date',
        'Shift', 'Order Type', 'Branch Name', 'Restaurant', 'Order Channel', 'Issue Category', 'Case Details', 'Action Taken'
      ]);
      await expect(page.locator('#modal .cc-form-section__title')).toHaveText(['Complaint and Order', 'Responsibility and Context', 'Issue', 'Resolution']);
      const geometry = await page.locator('#modal .cc-dialog__panel').evaluate((panel) => {
        const box = panel.getBoundingClientRect(); const body = panel.querySelector('#dynamic-form');
        return {
          left: box.left, right: box.right, top: box.top, bottom: box.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight,
          columns: getComputedStyle(panel.querySelector('.cc-form-grid')).gridTemplateColumns.split(' ').length,
          bodyOverflow: getComputedStyle(body).overflowY,
          controls: [...panel.querySelectorAll('input, select, textarea, button')].map((node) => node.getBoundingClientRect().height),
          icons: [...panel.querySelectorAll('.cc-form-section__title')].map((title) => { const icon = getComputedStyle(title, '::before'); return { width: parseFloat(icon.width), height: parseFloat(icon.height), image: icon.backgroundImage }; })
        };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.top).toBeGreaterThanOrEqual(0); expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
      expect(geometry.bodyOverflow).toBe('auto'); geometry.controls.forEach((height) => expect(height).toBeGreaterThanOrEqual(43));
      expect(geometry.icons).toHaveLength(4);
      geometry.icons.forEach((icon) => { expect(icon).toMatchObject({ width: 24, height: 24 }); expect(icon.image).not.toBe('none'); });
      expect(new Set(geometry.icons.map((icon) => icon.image)).size).toBe(4);
      if (width <= 390) expect(geometry.columns).toBe(1);
      await capture(page, filename, false);
      if (width <= 390) {
        const sections = page.locator('#modal .cc-form-section');
        await expect(sections).toHaveCount(4);
        await sections.last().scrollIntoViewIfNeeded();
        await expect(sections.last()).toBeVisible();
        await expect(page.locator('#modal .cc-dialog__footer')).toBeVisible();
      }
      await page.keyboard.press('Escape'); await expect(page.locator('#modal')).not.toHaveClass(/open/); await expect(origin).toBeFocused();
    });
  }

  for (const width of [1440, 1024, 768, 390, 320]) {
    test(`${width}px empty board renders one coherent state without ghost lanes`, async ({ appPage: page }) => {
      await openComplaints(page, width, 'light');
      await expect(page.locator('#tickets > .complaints-empty-state')).toHaveCount(1);
      await expect(page.locator('#tickets > .complaints-column:visible')).toHaveCount(0);
      const geometry = await page.locator('#tickets').evaluate((board) => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, ghost: board.scrollWidth - board.clientWidth }));
      expect(geometry.overflow).toBeLessThanOrEqual(1); expect(geometry.ghost).toBeLessThanOrEqual(1);
    });
  }

  test('cards preserve click, Enter, and Space activation', async ({ populatedPage: page }) => {
    await openComplaints(page, 1440, 'system');
    for (const activation of ['click', 'Enter', 'Space']) {
      const card = page.locator('.complaints-ticket-card').first();
      if (activation === 'click') await card.click(); else { await card.focus(); await card.press(activation); }
      await expect(page.locator('#ticket-drawer')).toHaveClass(/open/); await page.keyboard.press('Escape'); await expect(card).toBeFocused();
    }
  });

  test('system preference and reduced motion remain shared-runtime owned', async ({ populatedPage: page }) => {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await openComplaints(page, 768, 'system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const duration = await page.locator('.complaints-ticket-card').first().evaluate((card) => parseFloat(getComputedStyle(card).transitionDuration));
    expect(duration).toBeLessThanOrEqual(0.001);
  });
});
