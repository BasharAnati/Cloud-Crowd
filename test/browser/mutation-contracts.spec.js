const { test, expect, waitForSettledPage } = require('./fixtures');

test.describe('behavioral fault injection proves acceptance detectors reject regressions', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Mutation evidence executes in the primary Chromium engine.');
  test.use({ viewport: { width: 390, height: 900 } });

  test('M01 removed focus visibility is observable', async ({ appPage: page }) => {
    await page.goto('/login.html');
    await page.addStyleTag({ content: '*:focus, *:focus-visible { outline: 0 !important; box-shadow: none !important; }' });
    await page.keyboard.press('Tab');
    const visible = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement);
      return style.outlineStyle !== 'none' && style.outlineWidth !== '0px' || style.boxShadow !== 'none';
    });
    expect(visible).toBeFalsy();
  });

  test('M02 disabled sidebar Escape leaves the injected broken state open', async ({ appPage: page }) => {
    await page.goto('/attendance.html');
    const trigger = page.getByRole('button', { name: 'Open application navigation' });
    await trigger.click();
    await page.evaluate(() => addEventListener('keydown', (event) => {
      if (event.key === 'Escape') event.stopImmediatePropagation();
    }, true));
    await page.keyboard.press('Escape');
    await expect(page.locator('#internal-app-sidebar')).toHaveAttribute('aria-hidden', 'false');
  });

  test('M03 broken sidebar focus restoration is observable', async ({ appPage: page }) => {
    await page.goto('/attendance.html');
    const trigger = page.getByRole('button', { name: 'Open application navigation' });
    await trigger.click();
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const main = document.querySelector('#main-content');
      main.tabIndex = -1;
      main.focus();
    });
    await expect(trigger).not.toBeFocused();
  });

  test('M04 broken dialog Tab containment can move focus outside', async ({ appPage: page }) => {
    await page.goto('/client-profiles.html');
    await page.getByRole('button', { name: 'Add Client' }).click();
    await page.evaluate(() => addEventListener('keydown', (event) => {
      if (event.key === 'Tab') event.stopImmediatePropagation();
    }, true));
    await page.locator('#client-modal button, #client-modal input, #client-modal select, #client-modal textarea').last().focus();
    await page.keyboard.press('Tab');
    expect(await page.locator('#client-modal').evaluate((dialog) => !dialog.contains(document.activeElement))).toBeTruthy();
  });

  test('M05 a dialog without its accessible name is rejected by role/name lookup', async ({ appPage: page }) => {
    await page.goto('/client-profiles.html');
    await page.getByRole('button', { name: 'Add Client' }).click();
    await page.getByRole('dialog', { name: 'Add Client' }).evaluate((dialog) => {
      dialog.removeAttribute('aria-labelledby');
      dialog.removeAttribute('aria-label');
      dialog.querySelector('.cc-modal-title')?.setAttribute('aria-hidden', 'true');
    });
    await expect(page.getByRole('dialog', { name: 'Add Client' })).toHaveCount(0);
  });

  test('M06 reintroduced table overflow clipping is observable', async ({ appPage: page }) => {
    await page.goto('/attendance.html');
    await page.addStyleTag({ content: '.cc-table-wrap { overflow-x: hidden !important; }' });
    const fault = await page.locator('.cc-table-wrap').evaluate((node) => ({
      clipped: getComputedStyle(node).overflowX === 'hidden',
      hasOverflow: node.scrollWidth > node.clientWidth
    }));
    expect(fault).toEqual({ clipped: true, hasOverflow: true });
  });

  test('M07 reduced shell touch targets are measured below 44px', async ({ appPage: page }) => {
    await page.goto('/attendance.html');
    await page.addStyleTag({ content: '.cc-shell-nav-trigger { min-height: 32px !important; height: 32px !important; }' });
    const box = await page.getByRole('button', { name: 'Open application navigation' }).boundingBox();
    expect(box.height).toBeLessThan(44);
  });

  test('M08 a color-only status loses its perceivable text state', async ({ seededPage: page }) => {
    await page.goto('/employee-profiles.html');
    await waitForSettledPage(page);
    const status = page.locator('.cc-status').first();
    await status.evaluate((node) => { node.textContent = ''; node.removeAttribute('aria-label'); });
    expect(await status.evaluate((node) => !(node.textContent || '').trim() && !node.getAttribute('aria-label'))).toBeTruthy();
  });

  test('M09 broken mobile master-detail Back leaves the detail route active', async ({ seededPage: page }) => {
    await page.goto('/client-profiles.html');
    await page.getByRole('button', { name: 'Open Browser Bistro workspace' }).click();
    await page.evaluate(() => { history.back = () => {}; });
    await page.locator('[data-back-to-directory]').click();
    await expect(page).toHaveURL(/restaurantId=/);
  });

  test('M10 disabled reduced-motion handling exposes a material transition', async ({ appPage: page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/attendance.html');
    await page.addStyleTag({ content: '#internal-app-sidebar { transition-duration: 2s !important; }' });
    expect(await page.locator('#internal-app-sidebar').evaluate((node) => Number.parseFloat(getComputedStyle(node).transitionDuration))).toBeGreaterThan(0.001);
  });

  test('M11 a hidden active route is unreachable in narrow navigation', async ({ appPage: page }) => {
    await page.goto('/attendance.html');
    await page.getByRole('button', { name: 'Open application navigation' }).click();
    const route = page.locator('.cc-shell-nav-link[href="attendance.html"]');
    await route.evaluate((node) => { node.style.display = 'none'; });
    await expect(route).toBeHidden();
  });

  test('M12 disabled populated Kanban scrolling leaves the final action unreachable', async ({ populatedPage: page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto('/free-order-requests.html');
    await waitForSettledPage(page);
    const board = page.locator('#requests-board');
    const finalAction = board.locator('.cc-kanban__column:last-child [data-view-id]').first();
    await expect(finalAction).toBeVisible();
    expect(await board.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeGreaterThan(1);
    await page.addStyleTag({ content: '#requests-board { overflow-x: hidden !important; }' });
    await board.evaluate((node) => { node.scrollLeft = 0; });
    const box = await board.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(2_000, 0);
    const fault = await finalAction.evaluate((node) => {
      const board = node.closest('#requests-board');
      const target = node.getBoundingClientRect();
      const viewport = board.getBoundingClientRect();
      return {
        overflowX: getComputedStyle(board).overflowX,
        scrollLeft: board.scrollLeft,
        finalActionOutside: target.left >= viewport.right || target.right > viewport.right + 1
      };
    });
    expect(fault).toEqual({ overflowX: 'hidden', scrollLeft: 0, finalActionOutside: true });
  });

  test('M13 superseded permission consumers expose the broken sentinel outcome', async ({ appPage: page }) => {
    await page.route('**/js/permissions.js', async (route) => {
      const response = await route.fetch();
      const production = await response.text();
      const mutant = production.replace(
        "if (generation !== requestGeneration) return adoptCurrentAuthority();",
        "if (generation !== requestGeneration) return unavailableModel('superseded-permission-response');"
      );
      expect(mutant).not.toBe(production);
      await route.fulfill({ response, body: mutant });
    });
    await page.goto('/login.html');
    await page.addScriptTag({ url: '/js/permissions.js' });
    const result = await page.evaluate(async () => {
      const pending = [];
      const originalFetch = window.fetch;
      const response = (canView) => ({
        ok: true, status: 200,
        async json() {
          return { ok: true, unavailable: false, legacyFallback: false, hasConfiguredAccess: true,
            access: [{ moduleKey: 'attendance', canView, canCreate: false, canEdit: false, canDelete: false }] };
        }
      });
      window.fetch = () => new Promise((resolve) => pending.push(resolve));
      try {
        const older = window.CCPermissions.getMyAccessModel({ force: true });
        const newer = window.CCPermissions.getMyAccessModel({ force: true });
        pending[0](response(true));
        await Promise.resolve();
        pending[1](response(false));
        const [olderModel] = await Promise.all([older, newer]);
        return olderModel.reason;
      } finally {
        window.fetch = originalFetch;
      }
    });
    expect(result).toBe('superseded-permission-response');
  });
});
