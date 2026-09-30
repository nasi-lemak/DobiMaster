import { expect, test } from '@playwright/test';
import { navLink, openOwner, SHOPS, STAFF_STATE } from './helpers';

test.use({ storageState: STAFF_STATE });

test('staff role: no revenue or analytics, only their branch', async ({ page }) => {
  await openOwner(page);
  await expect(page.getByRole('heading', { level: 1, name: `Today · ${SHOPS.ss2.name}` })).toBeVisible();
  await expect(page.getByText('Revenue today')).toHaveCount(0);

  for (const allowed of ['Overview', 'Machines', 'Tickets', 'Collections', 'Maintenance', 'Checklists', 'Alerts']) {
    await expect(navLink(page, allowed)).toBeVisible();
  }
  for (const hidden of ['Analytics', 'Refunds', 'Shop settings', 'Staff', 'Audit log']) {
    await expect(navLink(page, hidden)).toHaveCount(0);
  }

  // Typing the URL doesn't help either.
  await page.goto('/owner/analytics');
  await expect(page.getByText('Not available for your role')).toBeVisible();

  // Only SS2 is offered anywhere a shop is picked.
  await page.goto('/owner/machines');
  await expect(page.getByRole('heading', { level: 1, name: 'Machines & QR' })).toBeVisible();
  const shops = page.getByRole('combobox', { name: 'Shop' }).getByRole('option');
  await expect(shops).toHaveText([SHOPS.ss2.name]);
  await expect(page.getByRole('button', { name: 'Add machines' })).toHaveCount(0);
});
