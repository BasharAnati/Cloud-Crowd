const { test, expect, waitForSettledPage } = require('./fixtures');

const widths = [1440, 1280, 1024, 768, 430, 390, 360, 320];
const pages = [
  ['public', 'index.html'],
  ['authentication', 'login.html'],
  ['dashboard', 'dashboard.html'],
  ['kanban/cctv', 'cctv.html'],
  ['kanban/customer-experience', 'ce.html'],
  ['kanban/complaints', 'complaints.html'],
  ['kanban/complimentary-orders', 'free-orders.html'],
  ['kanban/free-order-requests', 'free-order-requests.html'],
  ['kanban/free-order-share', 'free-order-share.html'],
  ['table/attendance', 'attendance.html'],
  ['table/deductions', 'employee-deductions.html'],
  ['table/training', 'agent-training.html'],
  ['table/weekly-quality', 'weekly-quality.html'],
  ['table/restaurant-ratings', 'restaurant-ratings.html'],
  ['master-detail/employees', 'employee-profiles.html'],
  ['master-detail/clients', 'client-profiles.html'],
  ['admin', 'anati-admin.html'],
  ['system-state', 'system-update.html']
];

for (const width of widths) {
  for (const [family, file] of pages) {
    test(`${family} at ${width}px has a reachable viewport`, async ({ appPage: page, browserName }) => {
      test.skip(browserName !== 'chromium', 'The exhaustive matrix is a Chromium contract.');
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${file}`);
      await waitForSettledPage(page);

      await expect(page.locator('body')).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1);
      const layout = await page.evaluate(() => ({
        bodyWidth: document.body.scrollWidth,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        overflowCandidates: Array.from(document.querySelectorAll('body *'))
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return { node: `${node.tagName.toLowerCase()}#${node.id}.${node.className}`, left: rect.left, right: rect.right, width: rect.width };
          })
          .filter((item) => item.left < innerWidth && item.right > innerWidth + 1)
          .sort((a, b) => b.right - a.right)
          .slice(0, 8)
      }));
      expect(layout.documentWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewportWidth + 1);

      const inaccessibleControls = await page.locator('button, a[href], input:not([type="hidden"]), select, textarea').evaluateAll((nodes) => nodes
        .filter((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        })
        .filter((node) => {
          if (node.closest('[aria-hidden="true"], [inert]')) return false;
          const rect = node.getBoundingClientRect();
          let ancestor = node.parentElement;
          while (ancestor) {
            const ancestorStyle = getComputedStyle(ancestor);
            const ancestorRect = ancestor.getBoundingClientRect();
            if (['auto', 'scroll'].includes(ancestorStyle.overflowX) && ancestor.scrollWidth > ancestor.clientWidth &&
                ancestorRect.right > 0 && ancestorRect.left < innerWidth) return false;
            ancestor = ancestor.parentElement;
          }
          return rect.right < 0 || rect.left > innerWidth || rect.bottom < 0;
        })
        .map((node) => `${node.tagName.toLowerCase()}#${node.id}.${node.className}`));
      expect(inaccessibleControls).toEqual([]);

      const unnamedControls = await page.locator('button, a[href], input:not([type="hidden"]), select, textarea').evaluateAll((nodes) => nodes
        .filter((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0 && !node.closest('[aria-hidden="true"], [inert]');
        })
        .filter((node) => {
          const labelledBy = (node.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
            .map((id) => document.getElementById(id)?.textContent || '').join(' ');
          const labels = Array.from(node.labels || []).map((label) => label.textContent || '').join(' ');
          const name = node.getAttribute('aria-label') || labelledBy || labels || node.getAttribute('alt') ||
            node.getAttribute('title') || node.textContent || '';
          return !name.trim();
        })
        .map((node) => `${node.tagName.toLowerCase()}#${node.id}.${node.className}`));
      expect(unnamedControls).toEqual([]);
    });
  }
}
