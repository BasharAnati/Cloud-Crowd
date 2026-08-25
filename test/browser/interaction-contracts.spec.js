const { test, expect, waitForSettledPage } = require('./fixtures');

const activePages = [
  'index.html', 'login.html', 'dashboard.html', 'cctv.html', 'ce.html', 'complaints.html',
  'free-orders.html', 'free-order-requests.html', 'free-order-share.html', 'attendance.html',
  'employee-deductions.html', 'agent-training.html', 'weekly-quality.html', 'restaurant-ratings.html',
  'employee-profiles.html', 'client-profiles.html', 'anati-admin.html', 'system-update.html'
];

for (const file of activePages) {
  test(`${file} priority mobile actions provide effective touch targets`, async ({ appPage: page, browserName }) => {
    test.skip(browserName !== 'chromium', 'The exhaustive mobile interaction matrix is a Chromium contract.');
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/${file}`);
    await waitForSettledPage(page);
    const undersized = await page.locator([
      '.cc-shell-nav-trigger', '.cc-shell-mobile-close', '.icon-btn', '.remove-row',
      'button[data-close-modal]', 'button[data-edit-id]', 'button[data-archive-id]',
      '.cc-master-detail__back', '.cc-master-detail__notice-action'
    ].join(',')).evaluateAll((nodes) => nodes
      .filter((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width < 44 || rect.height < 44;
      })
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return `${node.tagName.toLowerCase()}#${node.id}.${node.className}=${Math.round(rect.width)}x${Math.round(rect.height)}`;
      }));
    expect(undersized).toEqual([]);
  });
}

test('open Client dialog keeps close, Cancel, and Save actions at effective touch size', async ({ appPage: page, browserName }) => {
  test.skip(browserName !== 'chromium', 'The exhaustive mobile interaction matrix is a Chromium contract.');
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/client-profiles.html');
  await waitForSettledPage(page);
  await expect(page.locator('#client-grid')).not.toHaveAttribute('aria-busy', 'true');
  await page.locator('#add-client-btn').click();
  const dialog = page.getByRole('dialog', { name: 'Add Client' });
  await expect(dialog).toBeVisible();
  const actions = dialog.locator('[data-close-modal="client-modal"], #save-client-btn');
  await expect(actions).toHaveCount(3);
  const undersized = await actions.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { label: node.getAttribute('aria-label') || node.textContent.trim(), width: rect.width, height: rect.height };
  }).filter(({ width, height }) => width < 44 || height < 44));
  expect(undersized).toEqual([]);
});

const kanbanCases = [
  ['cctv.html', '.cc-kanban__column:last-child .cc-card'],
  ['ce.html', '.cc-kanban__column:last-child .cc-card'],
  ['complaints.html', '.cc-kanban__column:last-child .cc-card'],
  ['free-orders.html', '.cc-kanban__column:last-child .cc-card'],
  ['free-order-requests.html', '.cc-kanban__column:last-child .cc-card [data-view-id]'],
  ['free-order-share.html', '.cc-kanban__column:last-child .cc-card [data-view-id]']
];

for (const [file, finalControlSelector] of kanbanCases) {
  test(`${file} keeps populated multi-column Kanban cards and controls horizontally reachable`, async ({ populatedPage: page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Kanban family coverage is exhaustive in Chromium.');
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/${file}`);
    await waitForSettledPage(page);
    const board = page.locator('.cc-kanban').first();
    await expect(board).toBeVisible();
    await expect(board.locator('.cc-kanban__column')).toHaveCount(file === 'free-order-share.html' ? 3 : file === 'cctv.html' || file === 'free-orders.html' ? 3 : 4);
    await expect.poll(() => board.locator('.cc-card').count()).toBeGreaterThanOrEqual(2);
    if (file === 'cctv.html') {
      await expect(page.locator('#cctv-status-switcher [role="tab"]')).toHaveCount(3);
      await page.locator('[data-cctv-lane="Closed"]').click();
      await expect(board.locator('.cc-kanban__column:visible')).toHaveCount(1);
    }
    const finalControl = board.locator(finalControlSelector).first();
    await expect(finalControl).toBeVisible();

    const overflow = await board.evaluate((node) => ({
      max: node.scrollWidth - node.clientWidth,
      overflowX: getComputedStyle(node).overflowX
    }));
    if (file === 'cctv.html') {
      expect(overflow.max).toBeLessThanOrEqual(1);
      expect(['visible', 'hidden']).toContain(overflow.overflowX);
    } else {
      expect(overflow.max).toBeGreaterThan(1);
      expect(['auto', 'scroll']).toContain(overflow.overflowX);
      await board.evaluate((node) => node.scrollTo({ left: node.scrollWidth, behavior: 'instant' }));
      await expect.poll(() => board.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    }
    const visibleRegion = await finalControl.evaluate((node) => {
      const board = node.closest('.cc-kanban');
      const target = node.getBoundingClientRect();
      const viewport = board.getBoundingClientRect();
      return {
        left: target.left >= viewport.left - 1,
        right: target.right <= viewport.right + 1,
        nonFirstColumn: board.querySelector('.cc-kanban__column') !== node.closest('.cc-kanban__column')
      };
    });
    expect(visibleRegion).toEqual({ left: true, right: true, nonFirstColumn: true });

    await finalControl.focus();
    await expect(finalControl).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[role="dialog"]:visible').first()).toBeVisible();
    await page.keyboard.press('Escape');

    await finalControl.click();
    await expect(page.locator('[role="dialog"]:visible').first()).toBeVisible();
  });
}

const tableCases = [
  ['attendance.html', [{ wrapper: 0, cell: 'tbody tr td:last-child', focus: 'wrapper' }]],
  ['employee-deductions.html', [{ wrapper: 0, cell: 'tbody tr td:last-child', focus: 'tbody tr td:last-child button:last-child' }]],
  ['agent-training.html', [{ wrapper: 0, cell: 'tbody tr td:last-child', focus: 'tbody tr td:last-child button:last-child' }]],
  ['weekly-quality.html', [{ wrapper: 0, cell: 'tbody tr td:last-child', focus: 'tbody tr td:last-child button:last-child' }]],
  ['restaurant-ratings.html', [{ wrapper: 0, cell: 'tbody tr td:last-child', focus: 'tbody tr td:last-child button:last-child' }]],
  ['anati-admin.html', [
    { wrapper: 0, cell: '#users-body tr td:last-child', focus: '#users-body tr td:last-child button:last-child' },
    { wrapper: 1, cell: '#modules-body tr td:last-child', focus: '#modules-body tr td:last-child input' }
  ]]
];

for (const [file, contracts] of tableCases) {
  test(`${file} keeps populated final table cells and controls keyboard reachable`, async ({ populatedPage: page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Table family coverage is exhaustive in Chromium.');
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/${file}`);
    await waitForSettledPage(page);
    const wrappers = page.locator('.cc-table-wrap');
    await expect(wrappers.first()).toBeVisible();
    for (const contract of contracts) {
      const wrapper = wrappers.nth(contract.wrapper);
      await expect(wrapper).toBeVisible();
      const finalCell = wrapper.locator(contract.cell).first();
      await expect(finalCell).toBeVisible();
      await finalCell.scrollIntoViewIfNeeded();
      const overflow = await wrapper.evaluate((node) => ({
        max: node.scrollWidth - node.clientWidth,
        overflowX: getComputedStyle(node).overflowX,
        focusable: node.tabIndex >= 0
      }));
      expect(overflow.max).toBeGreaterThan(1);
      expect(['auto', 'scroll']).toContain(overflow.overflowX);
      expect(overflow.focusable).toBeTruthy();

      await wrapper.evaluate((node) => node.scrollTo({ left: node.scrollWidth, behavior: 'instant' }));
      await expect.poll(() => wrapper.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
      const focusTarget = contract.focus === 'wrapper' ? wrapper : wrapper.locator(contract.focus).first();
      await expect(focusTarget).toBeVisible();
      await focusTarget.focus();
      await expect(focusTarget).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(focusTarget).toBeFocused();
      const geometryTarget = contract.focus === 'wrapper' ? finalCell : focusTarget;
      const reachability = await geometryTarget.evaluate((node) => {
        const wrapper = node.closest('.cc-table-wrap') || node;
        const target = node.getBoundingClientRect();
        const viewport = wrapper.getBoundingClientRect();
        const x = Math.min(target.right - 2, viewport.right - 2);
        const y = Math.min(Math.max(target.top + 2, viewport.top + 2), viewport.bottom - 2);
        const topmost = document.elementFromPoint(x, y);
        return {
          left: target.left >= viewport.left - 1,
          right: target.right <= viewport.right + 1,
          unobscured: Boolean(topmost && (node.contains(topmost) || topmost.contains(node)))
        };
      });
      expect(reachability).toEqual({ left: true, right: true, unobscured: true });
    }
  });
}

for (const [file, itemName, param, detailSelector] of [
  ['employee-profiles.html', 'Open Sprint Browser Employee workspace', 'employeeId', '#employee-workspace'],
  ['client-profiles.html', 'Open Browser Bistro workspace', 'restaurantId', '#client-workspace']
]) {
  test(`${file} mobile list-detail navigation preserves URL, Back, and focus origin`, async ({ seededPage: page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Master/detail family coverage is exhaustive in Chromium.');
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/${file}`);
    await waitForSettledPage(page);
    const origin = page.getByRole('button', { name: itemName });
    await origin.click();
    await expect(page).toHaveURL(new RegExp(`${param}=`));
    await expect(page.locator(detailSelector)).not.toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator(`${detailSelector} [data-cc-detail-focus]`)).toBeFocused();
    await page.goBack();
    await expect(page).not.toHaveURL(new RegExp(`${param}=`));
    await expect(origin).toBeFocused();
  });
}
