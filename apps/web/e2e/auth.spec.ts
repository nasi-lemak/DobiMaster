import { expect, test } from '@playwright/test';
import { OWNER } from './helpers';

// No stored session: this spec exercises the real login form.
test('owner login: wrong password shows an error, right password lands on Overview, then log out', async ({ page }) => {
  await page.goto('/owner');
  await expect(page.getByRole('heading', { name: 'DobiMaster for owners' })).toBeVisible();

  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('alert')).not.toBeEmpty();
  await expect(page.getByRole('heading', { name: 'DobiMaster for owners' })).toBeVisible();

  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Today/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Needs attention/ })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'DobiMaster for owners' })).toBeVisible();
  // The session is really gone, not just hidden: a reload stays on the login screen.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'DobiMaster for owners' })).toBeVisible();
});
