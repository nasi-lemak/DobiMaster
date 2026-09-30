import { devices } from '@playwright/test';
import { expect, test } from './fixtures';
import { OWNER_STATE, SHOPS, shopBySlug, uniq } from './helpers';

// Owners mostly use the dashboard on a phone: bottom tabs + "More" instead of the sidebar.
test.use({ storageState: OWNER_STATE, viewport: devices['Pixel 7'].viewport, hasTouch: true, isMobile: true });

test('phone layout: tabs, More menu, a form above the tab bar, a bottom-sheet dialog', async ({ page }) => {
  await page.goto('/owner');
  const tabs = page.getByRole('navigation', { name: 'Main tabs' });
  await expect(tabs).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toBeHidden();

  await tabs.getByRole('link', { name: /^More/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'More' })).toBeVisible();
  await page.getByRole('link', { name: /^Shop settings/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Shop settings' })).toBeVisible();

  // The sticky save bar sits above the tab bar (a click on it would otherwise hit the tabs).
  const shop = await shopBySlug(page.request, SHOPS.ss2.slug);
  await page.getByRole('combobox', { name: 'Shop' }).selectOption(shop.id);
  const policy = `E2E phone policy ${uniq()}`;
  await page.getByLabel(/^Bahasa Melayu/).fill(policy);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  // Dialogs are bottom sheets; their footer buttons must be reachable.
  await tabs.getByRole('link', { name: /^Tickets/ }).click();
  await page.getByRole('button', { name: 'New ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'New ticket' });
  await expect(dialog.getByRole('button', { name: 'Create ticket' })).toBeInViewport();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  // Log out is reachable from More on a phone. (Not clicked: logout now revokes the session
  // server-side, and this spec shares the owner session with every other spec. Real logout is
  // covered by auth.spec.ts and security.spec.ts with their own sessions.)
  await tabs.getByRole('link', { name: /^More/ }).click();
  await page.getByRole('button', { name: 'Log out' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeInViewport();
});
