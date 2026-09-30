import { expect, test } from './fixtures';
import { openOwner, OWNER_STATE, SHOPS, shopBySlug, STAFF_STATE } from './helpers';

// Console errors / uncaught exceptions fail the test via the auto fixture in fixtures.ts.

const OWNER_PAGES: Array<[path: string, heading: string | RegExp]> = [
  ['/owner', /^Today/],
  ['/owner/machines', 'Machines & QR'],
  ['/owner/tickets', 'Tickets'],
  ['/owner/refunds', 'Refunds'],
  ['/owner/analytics', /Analytics|Revenue/],
  ['/owner/collections', 'Cash collections'],
  ['/owner/maintenance', 'Maintenance'],
  ['/owner/checklists', /Checklist/],
  ['/owner/alerts', 'Alerts'],
  ['/owner/announcements', 'Announcements'],
  ['/owner/devices', 'Sensors'],
  ['/owner/settings', 'Shop settings'],
  ['/owner/staff', 'Staff'],
  ['/owner/audit', /Audit/],
  ['/owner/more', 'More'],
];

test.describe('every owner page renders without errors', () => {
  test.use({ storageState: OWNER_STATE });

  test('owner', async ({ page }) => {
    await openOwner(page);
    const shop = await shopBySlug(page.request, SHOPS.ss2.slug);
    for (const [path, heading] of [...OWNER_PAGES, [`/owner/shops/${shop.id}`, SHOPS.ss2.name] as [string, string]]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading }), path).toBeVisible();
      await expect(page.getByLabel('Loading')).toHaveCount(0);
      await expect(page.getByText('Something went wrong'), path).toHaveCount(0);
    }
  });
});

test.describe('staff pages render without errors', () => {
  test.use({ storageState: STAFF_STATE });

  test('staff', async ({ page }) => {
    for (const path of ['/owner', '/owner/machines', '/owner/tickets', '/owner/collections', '/owner/maintenance', '/owner/alerts', '/owner/announcements', '/owner/devices', '/owner/more']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }), path).toBeVisible();
      await expect(page.getByLabel('Loading')).toHaveCount(0);
      await expect(page.getByText('Something went wrong'), path).toHaveCount(0);
      await expect(page.getByText("You don't have permission"), path).toHaveCount(0);
    }
  });
});
