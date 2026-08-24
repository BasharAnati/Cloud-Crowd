const { test, expect, waitForSettledPage } = require('./fixtures');

async function tabToUsername(page) {
  for (let index = 0; index < 8; index += 1) {
    if (await page.locator('#username').evaluate((input) => document.activeElement === input)) return;
    await page.keyboard.press('Tab');
  }
}

async function loginVisual(page) {
  return page.locator('#username').evaluate((input) => {
    const wrapper = input.closest('.input');
    const inputStyle = getComputedStyle(input);
    const wrapperStyle = getComputedStyle(wrapper);
    return {
      activeId: document.activeElement?.id || '',
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

function visualSignature(state) {
  const { activeId, focusVisible, focusWithin, ...visual } = state;
  return visual;
}

test.describe('WebKit production-source behavioral fault injection', () => {
  test.use({ viewport: { width: 390, height: 900 } });

  test('M14 removing event.currentTarget forwarding breaks fresh pointer focus restoration', async ({ appPage: page }) => {
    await page.route('**/client-profiles.html', async (route) => {
      const response = await route.fetch();
      const production = await response.text();
      const mutant = production.replace(
        "openModal('client-modal', { trigger: event?.currentTarget });",
        "openModal('client-modal');"
      );
      expect(mutant).not.toBe(production);
      await route.fulfill({ response, body: mutant });
    });
    await page.goto('/client-profiles.html');
    await waitForSettledPage(page);
    await expect(page.locator('#client-grid')).not.toHaveAttribute('aria-busy', 'true');
    const trigger = page.locator('#add-client-btn');
    expect(await page.evaluate(() => document.activeElement === document.body)).toBeTruthy();
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Add Client' })).toBeVisible();
    await expect(page.locator('#brand-name')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).not.toBeFocused();
  });

  test('M15 neutralizing the production input focus-within rule removes the visual delta', async ({ appPage: page }) => {
    await page.route('**/login.html', async (route) => {
      const response = await route.fetch();
      const production = await response.text();
      const mutant = production.replace(
        /\.input:focus-within\{\s*border-bottom-color:var\(--ice\);\s*box-shadow:\s*0 1px 0 rgba\(167,235,242,\.72\),\s*0 10px 22px -20px rgba\(84,172,191,\.92\);\s*\}/,
        '.input:focus-within{}'
      );
      expect(mutant).not.toBe(production);
      await route.fulfill({ response, body: mutant });
    });
    await page.goto('/login.html');
    await waitForSettledPage(page);
    const baseline = await loginVisual(page);
    await tabToUsername(page);
    await expect(page.locator('#username')).toBeFocused();
    const focused = await loginVisual(page);
    expect(focused.activeId).toBe('username');
    expect(focused.focusVisible).toBeTruthy();
    expect(focused.focusWithin).toBeTruthy();
    expect(visualSignature(focused)).toEqual(visualSignature(baseline));
  });
});
