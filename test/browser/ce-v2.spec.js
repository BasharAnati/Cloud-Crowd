const fs = require('node:fs');
const path = require('node:path');
const { test, expect, waitForSettledPage } = require('./fixtures');

const ROOT = path.resolve(__dirname, '..', '..');
const CAPTURE_DIR = path.join(ROOT, 'artifacts', 'customer-experience-v2-visual-review');
fs.mkdirSync(CAPTURE_DIR, { recursive: true });

async function openCe(page, width, theme) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((value) => localStorage.setItem('cc_theme', value), theme);
  await page.goto('/ce.html');
  await waitForSettledPage(page);
  await expect(page.locator('.ce-column')).toHaveCount(4);
  await page.locator('.ce-hero-earth').evaluate((image) => {
    if (image.complete && image.naturalWidth > 0) return;
    return new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', reject, { once: true });
    });
  });
}

async function capture(page, name, fullPage = true) {
  await page.screenshot({ path: path.join(CAPTURE_DIR, name), fullPage });
}

test.describe('Customer Experience V2', () => {
  const frames = [
    [1440, 'dark', '1440-dark-main.png'], [1440, 'light', '1440-light-main.png'],
    [1024, 'light', '1024-light-main.png'], [768, 'light', '768-light-main.png'],
    [390, 'dark', '390-dark-main.png'], [390, 'light', '390-light-main.png'],
    [320, 'light', '320-light-main.png']
  ];

  for (const [width, theme, filename] of frames) {
    test(`${width}px ${theme} main composition is contained and board-owned`, async ({ populatedPage: page }) => {
      await openCe(page, width, theme);
      await expect(page.locator('.ce-column .cc-kanban__title')).toHaveText([
        'Escalated', 'Under Review', 'Pending (Call Back)', 'Closed'
      ]);
      await expect(page.locator('.ce-stat-card strong')).toHaveText(['2', '1', '0', '1']);
      const result = await page.evaluate(() => {
        const board = document.getElementById('tickets');
        const columns = [...document.querySelectorAll('.ce-column')];
        const sidebar = document.getElementById('ce-app-sidebar');
        const sidebarBox = sidebar.getBoundingClientRect();
        const hero = document.querySelector('.ce-hero');
        const heroBox = hero.getBoundingClientRect();
        const actionBox = hero.querySelector('.ce-actions').getBoundingClientRect();
        const boardBox = board.getBoundingClientRect();
        const secondColumnBox = columns[1].getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          boardOverflowX: getComputedStyle(board).overflowX,
          boardScrollable: board.scrollWidth > board.clientWidth,
          widths: columns.map((column) => column.getBoundingClientRect().width),
          heights: columns.map((column) => column.getBoundingClientRect().height),
          laneCue: Math.max(0, boardBox.right - secondColumnBox.left),
          hero: {
            height: heroBox.height,
            actionTop: actionBox.top,
            actionBottom: actionBox.bottom,
            top: heroBox.top,
            bottom: heroBox.bottom
          },
          columnBackground: getComputedStyle(columns[0]).backgroundColor,
          laneTitleColors: columns.map((column) => getComputedStyle(column.querySelector('.col-title')).color),
          metricCards: [...document.querySelectorAll('.ce-stat-card')].map((card) => card.getBoundingClientRect().height),
          metricIcons: [...document.querySelectorAll('.ce-stat-icon')].map((icon) => {
            const box = icon.getBoundingClientRect();
            return { width: box.width, height: box.height, mask: getComputedStyle(icon, '::before').webkitMaskImage };
          }),
          filterControls: [...document.querySelectorAll('.ce-filter-field input, .ce-filter-field select')].map((control) => control.getBoundingClientRect().height),
          sidebar: { left: sidebarBox.left, right: sidebarBox.right, width: sidebarBox.width, position: getComputedStyle(sidebar).position },
          earth: (() => {
            const image = document.querySelector('.ce-hero-earth');
            const box = image.getBoundingClientRect();
            const style = getComputedStyle(image);
            return { count: 1, loaded: image.naturalWidth > 0, display: style.display, visibility: style.visibility, opacity: style.opacity, width: box.width, height: box.height, pointer: style.pointerEvents };
          })(),
          pseudo: ['::before', '::after'].map((pseudo) => getComputedStyle(document.querySelector('.ce-ticket-card'), pseudo).pointerEvents)
        };
      });
      expect(result.overflow).toBeLessThanOrEqual(1);
      expect(result.boardOverflowX).toBe('auto');
      result.widths.forEach((widthValue) => expect(widthValue).toBeGreaterThanOrEqual(279));
      result.widths.forEach((widthValue) => expect(widthValue).toBeLessThanOrEqual(321));
      if (width <= 1024) expect(result.boardScrollable).toBe(true);
      if (width <= 1024) expect(result.sidebar.right, JSON.stringify(result.sidebar)).toBeLessThanOrEqual(0);
      if (width === 1024) {
        expect(result.hero.height).toBeLessThanOrEqual(150);
        expect(result.hero.actionTop).toBeGreaterThanOrEqual(result.hero.top);
        expect(result.hero.actionBottom).toBeLessThanOrEqual(result.hero.bottom);
      }
      if (width === 1440 && theme === 'dark') {
        expect(result.sidebar.width).toBeGreaterThanOrEqual(223);
        expect(result.sidebar.width).toBeLessThanOrEqual(225);
        expect(result.hero.height).toBeLessThanOrEqual(104);
        result.heights.forEach((height) => expect(height).toBeGreaterThanOrEqual(423));
        result.metricCards.forEach((height) => expect(height).toBeGreaterThanOrEqual(103));
        result.metricIcons.forEach((icon) => expect(icon).toMatchObject({ width: 50, height: 50 }));
        expect(new Set(result.metricIcons.map((icon) => icon.mask)).size).toBe(4);
        result.filterControls.forEach((height) => expect(height).toBeGreaterThanOrEqual(43));
        expect(result.laneTitleColors).toEqual([
          'rgb(160, 107, 255)', 'rgb(25, 167, 255)', 'rgb(245, 158, 11)', 'rgb(32, 207, 122)'
        ]);
      }
      if (width === 390) {
        expect(result.laneCue).toBeGreaterThanOrEqual(12);
        expect(result.laneCue).toBeLessThanOrEqual(29);
      }
      if (theme === 'dark') {
        const expectedDarkLane = width > 1024 ? 'rgb(6, 17, 26)' : 'rgb(7, 21, 34)';
        expect(result.columnBackground).toBe(expectedDarkLane);
      }
      expect(result.earth.loaded).toBe(true);
      expect(result.earth.pointer).toBe('none');
      if (width === 1440 && theme === 'dark') {
        expect(result.earth.opacity).toBe('0');
        expect(result.earth.display).toBe('block');
        expect(result.earth.visibility).toBe('visible');
        expect(result.earth.width).toBeGreaterThan(700);
        expect(result.earth.height).toBeGreaterThanOrEqual(101);
      }
      expect(result.pseudo).toEqual(['none', 'none']);
      await capture(page, filename);
    });
  }

  test('shared mobile drawer opens, locks, closes, and restores focus', async ({ populatedPage: page }) => {
    await openCe(page, 390, 'dark');
    const trigger = page.getByRole('button', { name: 'Open application navigation' });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.locator('#ce-shell')).toHaveClass(/is-nav-open/);
    await expect(page.locator('#ce-nav-backdrop')).toBeVisible();
    await expect(page.locator('#ce-app-sidebar .cc-shell-mobile-close')).toBeVisible();
    await expect(page.locator('#ce-app-sidebar .cc-shell-nav-link.is-active')).toHaveAttribute('href', 'ce.html');
    await expect(page.locator('body')).toHaveClass(/cc-shell-nav-lock/);
    await capture(page, '390-drawer-open.png', false);
    await page.keyboard.press('Escape');
    await expect(page.locator('#ce-shell')).not.toHaveClass(/is-nav-open/);
    await expect(trigger).toBeFocused();
  });

  for (const width of [1024, 768, 390, 360, 320]) {
    test(`${width}px visible topbar controls stay inside the viewport`, async ({ populatedPage: page }) => {
      await openCe(page, width, 'light');
      const result = await page.locator('#ce-app-topbar').evaluate((topbar) => {
        const controls = [...topbar.querySelectorAll('button, .cc-shell-user-badge, .cc-shell-role-badge')]
          .filter((control) => {
            const style = getComputedStyle(control);
            const box = control.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
          })
          .map((control) => {
            const box = control.getBoundingClientRect();
            return {
              left: box.left,
              right: box.right,
              top: box.top,
              width: box.width,
              height: box.height,
              textFits: control.scrollWidth <= control.clientWidth + 1
            };
          });
        return {
          controls,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          viewportWidth: innerWidth
        };
      });
      expect(result.controls.length).toBeGreaterThanOrEqual(4);
      result.controls.forEach((control) => {
        expect(control.left).toBeGreaterThanOrEqual(0);
        expect(control.right).toBeLessThanOrEqual(result.viewportWidth);
        expect(control.top).toBeGreaterThanOrEqual(0);
        expect(control.width).toBeGreaterThan(0);
        expect(control.height).toBeGreaterThan(0);
        expect(control.textFits).toBe(true);
        if (width <= 390) expect(control.height).toBeGreaterThanOrEqual(43);
      });
      expect(result.overflow).toBeLessThanOrEqual(1);
    });
  }

  for (const [width, theme, filename] of [
    [1440, 'dark', '1440-create-modal-dark.png'], [1440, 'light', '1440-create-modal-light.png'],
    [390, 'dark', '390-create-modal-dark.png'], [390, 'light', '390-create-modal-light.png'],
    [320, 'light', '320-create-modal-light.png']
  ]) {
    test(`${width}px ${theme} create modal preserves fields and viewport`, async ({ populatedPage: page }) => {
      await openCe(page, width, theme);
      const origin = page.getByRole('button', { name: 'Add New Ticket', exact: true });
      await origin.click();
      await expect(page.locator('#modal')).toHaveClass(/open/);
      await expect(page.locator('#modal .cc-field__label')).toHaveText([
        'Status', 'Order Number', 'Department Responsible', 'Customer Name', 'Phone Number', 'Creation Date',
        'Shift', 'Order Type', 'Branch Name', 'Restaurant', 'Order Channel', 'Feedback Date', 'Issue Category',
        'Case Details', 'Action Taken', 'Customer Satisfaction Level'
      ]);
      await expect(page.locator('#modal .cc-form-section__title')).toHaveText([
        'Customer and Order', 'Source and Context', 'Experience Classification', 'Resolution'
      ]);
      await expect(page.locator('#modal [required]')).toHaveCount(0);
      await expect(page.locator('#modal input[type="file"], #modal [class*="counter"], #modal [class*="country"]')).toHaveCount(0);
      await expect(page.locator('#modal .cc-dialog__footer')).toBeVisible();
      const geometry = await page.locator('#modal .cc-dialog__panel').evaluate((panel) => {
        const box = panel.getBoundingClientRect();
        const controls = [...panel.querySelectorAll('input, select, textarea, button')].map((node) => node.getBoundingClientRect().height);
        return { left: box.left, right: box.right, bottom: box.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, controls };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
      geometry.controls.forEach((height) => expect(height).toBeGreaterThanOrEqual(43));
      await capture(page, filename, false);
      await page.keyboard.press('Escape');
      await expect(page.locator('#modal')).not.toHaveClass(/open/);
      await expect(origin).toBeFocused();
    });
  }

  test('cards preserve click, Enter, and Space activation', async ({ populatedPage: page }) => {
    await openCe(page, 1440, 'system');
    for (const activation of ['click', 'Enter', 'Space']) {
      const card = page.locator('.ce-ticket-card').first();
      if (activation === 'click') await card.click();
      else { await card.focus(); await card.press(activation); }
      await expect(page.locator('#ticket-drawer')).toHaveClass(/open/);
      await page.keyboard.press('Escape');
      await expect(card).toBeFocused();
    }
  });
});
