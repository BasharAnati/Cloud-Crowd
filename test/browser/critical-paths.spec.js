const { test, expect, waitForSettledPage } = require('./fixtures');

async function readLoginFocusVisual(page) {
  return page.locator('#username').evaluate((input) => {
    const wrapper = input.closest('.input');
    const inputStyle = getComputedStyle(input);
    const wrapperStyle = getComputedStyle(wrapper);
    return {
      activeId: document.activeElement?.id || '',
      focus: input.matches(':focus'),
      focusVisible: input.matches(':focus-visible'),
      focusWithin: wrapper.matches(':focus-within'),
      borderColor: wrapperStyle.borderBottomColor,
      borderWidth: wrapperStyle.borderBottomWidth,
      borderStyle: wrapperStyle.borderBottomStyle,
      boxShadow: wrapperStyle.boxShadow,
      outlineColor: wrapperStyle.outlineColor,
      outlineStyle: wrapperStyle.outlineStyle,
      outlineWidth: wrapperStyle.outlineWidth,
      inputOutlineColor: inputStyle.outlineColor,
      inputOutlineStyle: inputStyle.outlineStyle,
      inputOutlineWidth: inputStyle.outlineWidth
    };
  });
}

function hasMaterialFocusDelta(baseline, focused) {
  return ['borderColor', 'borderWidth', 'borderStyle', 'boxShadow', 'outlineColor', 'outlineStyle', 'outlineWidth',
    'inputOutlineColor', 'inputOutlineStyle', 'inputOutlineWidth']
    .some((property) => focused[property] !== baseline[property]);
}

async function tabToUsername(page) {
  for (let index = 0; index < 8; index += 1) {
    if (await page.locator('#username').evaluate((input) => document.activeElement === input)) return;
    await page.keyboard.press('Tab');
  }
}

test.describe('critical browser paths', () => {
  test.use({ viewport: { width: 390, height: 900 } });

  test('shared navigation supports keyboard open, Escape, and focus restoration', async ({ appPage: page }) => {
    await page.goto('/attendance.html');
    await waitForSettledPage(page);
    const trigger = page.getByRole('button', { name: 'Open application navigation' });
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const sidebar = page.locator('#internal-app-sidebar');
    await expect(sidebar).toHaveAttribute('aria-hidden', 'false');
    await page.keyboard.press('Escape');
    await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
    await expect(trigger).toBeFocused();
    await expect(page.locator('body')).not.toHaveClass(/cc-shell-nav-lock/);
  });

  test('client dialog is named, traps Tab, closes on Escape and Cancel, and restores keyboard focus', async ({ appPage: page }) => {
    const diagnostics = [];
    page.on('console', (message) => {
      if (['warning', 'error'].includes(message.type())) diagnostics.push(`${message.type()}: ${message.text()}`);
    });
    page.on('requestfailed', (request) => diagnostics.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || ''}`));
    page.on('request', (request) => {
      if (request.url().includes('/.netlify/functions/')) diagnostics.push(`request: ${request.url()}`);
    });
    page.on('response', (response) => {
      if (response.url().includes('/.netlify/functions/')) diagnostics.push(`response: ${response.status()} ${response.url()}`);
    });
    await page.goto('/client-profiles.html');
    await waitForSettledPage(page);
    await expect(page.locator('#client-grid')).not.toHaveAttribute('aria-busy', 'true').catch(() => {
      throw new Error(`Client bootstrap did not settle. ${diagnostics.join(' | ')}`);
    });
    const trigger = page.getByRole('button', { name: 'Add Client' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Add Client' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('#brand-name')).toBeFocused();
    const dialogControls = dialog.locator('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    await dialogControls.last().focus();
    await page.keyboard.press('Tab');
    await expect(dialog.locator(':focus')).toHaveCount(1);
    await dialogControls.first().focus();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('fresh BODY-focused pointer dialog open restores Add Client focus on Escape', async ({ appPage: page }) => {
    await page.goto('/client-profiles.html');
    await waitForSettledPage(page);
    await expect(page.locator('#client-grid')).not.toHaveAttribute('aria-busy', 'true');
    const trigger = page.locator('#add-client-btn');
    await expect(trigger).toBeVisible();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBeTruthy();

    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Add Client' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('#brand-name')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Login username keyboard focus produces a material browser-computed visual delta', async ({ appPage: page }) => {
    await page.goto('/login.html');
    await waitForSettledPage(page);
    const baseline = await readLoginFocusVisual(page);
    expect(baseline.focusWithin).toBeFalsy();

    await tabToUsername(page);
    await expect(page.locator('#username')).toBeFocused();
    await expect.poll(async () => hasMaterialFocusDelta(baseline, await readLoginFocusVisual(page))).toBeTruthy();
    const focused = await readLoginFocusVisual(page);
    expect(focused.activeId).toBe('username');
    expect(focused.focus).toBeTruthy();
    expect(focused.focusVisible).toBeTruthy();
    expect(focused.focusWithin).toBeTruthy();
    expect(hasMaterialFocusDelta(baseline, focused), JSON.stringify({ baseline, focused })).toBeTruthy();
  });

  test('concurrent forced permission consumers adopt the newest authority', async ({ appPage: page }) => {
    await page.goto('/attendance.html');
    await waitForSettledPage(page);
    const result = await page.evaluate(async () => {
      const originalFetch = window.fetch;
      const pending = [];
      const response = (canView) => ({
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true, unavailable: false, legacyFallback: false, hasConfiguredAccess: true,
            access: [{ moduleKey: 'attendance', canView, canCreate: false, canEdit: false, canDelete: false }]
          };
        }
      });
      window.fetch = () => new Promise((resolve) => pending.push(resolve));
      try {
        const older = window.CCPermissions.getMyAccessModel({ force: true });
        const newer = window.CCPermissions.getMyAccessModel({ force: true });
        pending[0](response(true));
        await Promise.resolve();
        pending[1](response(false));
        const [olderModel, newerModel] = await Promise.all([older, newer]);
        return {
          older: olderModel.access[0]?.canView,
          newer: newerModel.access[0]?.canView,
          olderReason: olderModel.reason,
          cached: (await window.CCPermissions.getMyAccessModel()).access[0]?.canView,
          requests: pending.length
        };
      } finally {
        window.fetch = originalFetch;
      }
    });
    expect(result).toEqual({ older: false, newer: false, olderReason: '', cached: false, requests: 2 });
  });

  test('reduced motion suppresses material shell transitions', async ({ appPage: page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/attendance.html');
    await waitForSettledPage(page);
    const durations = await page.locator('#internal-app-sidebar, #internal-nav-backdrop').evaluateAll((nodes) => nodes.map((node) => ({
      animation: getComputedStyle(node).animationDuration,
      transition: getComputedStyle(node).transitionDuration
    })));
    for (const duration of durations) {
      expect(Number.parseFloat(duration.animation)).toBeLessThanOrEqual(0.001);
      expect(Number.parseFloat(duration.transition)).toBeLessThanOrEqual(0.001);
    }
  });

  test('Call Queue direct route paints no dormant UI and replaces to Dashboard', async ({ appPage: page }) => {
    const callQueueRequests = [];
    page.on('request', (request) => {
      if (request.frame().url().includes('/call-queue.html') && request.url().includes('/.netlify/functions/')) {
        callQueueRequests.push(request.url());
      }
    });
    await page.goto('/call-queue.html');
    await expect(page).toHaveURL(/\/dashboard\.html$/);
    await expect(page.locator('#call-list')).toHaveCount(0);
    expect(callQueueRequests).toEqual([]);
  });

  test('important light and dark text retains computed contrast', async ({ appPage: page }) => {
    await page.goto('/login.html');
    await waitForSettledPage(page);
    for (const theme of ['light', 'dark']) {
      await page.locator('html').evaluate((node, value) => node.dataset.theme = value, theme);
      const ratio = await page.locator('h1').evaluate((node) => {
        const rgb = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const luminance = (color) => {
          const channels = rgb(color).map((value) => {
            const normalized = value / 255;
            return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        };
        let backgroundNode = node;
        let background = 'rgba(0, 0, 0, 0)';
        while (backgroundNode && /rgba?\([^)]*,\s*0\s*\)$/.test(background)) {
          background = getComputedStyle(backgroundNode).backgroundColor;
          backgroundNode = backgroundNode.parentElement;
        }
        const foregroundLuminance = luminance(getComputedStyle(node).color);
        const backgroundLuminance = luminance(background);
        return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
          (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
      });
      expect(ratio).toBeGreaterThanOrEqual(3);
    }
  });
});
