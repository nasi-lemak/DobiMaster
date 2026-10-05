import { expect, test } from './fixtures';
import { createMachine, OWNER_STATE, SHOPS, shopBySlug } from './helpers';

test('privacy notice and terms: linked from every customer page, in BM / EN / 中文, with real retention periods', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy notice' })).toBeVisible();
  await expect(page.getByText('Personal Data Protection Act 2010')).toBeVisible();
  await expect(page.getByText(/Refund phone numbers: deleted 90 days after the report is closed/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '6. Storage outside Malaysia' })).toBeVisible();

  // PDPA: the notice must be available in Bahasa Malaysia as well as English.
  await page.getByRole('button', { name: 'BM' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Notis privasi' })).toBeVisible();
  await page.getByRole('button', { name: '中文' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '隐私声明' })).toBeVisible();
  await page.getByRole('button', { name: 'EN' }).click();

  await page.getByRole('link', { name: 'Terms →' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'For customers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'For shop owners' })).toBeVisible();
});

test('customer deletes their data: timer gone, a fresh anonymous start afterwards', async ({ page, playwright, baseURL }) => {
  const owner = await playwright.request.newContext({ baseURL, storageState: OWNER_STATE });
  const shop = await shopBySlug(owner, SHOPS.damansara.slug);
  const machine = await createMachine(owner, shop.id);

  await page.goto(`/m/${machine.qrToken}`);
  await page.getByRole('button', { name: /I’ve started it/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start my timer' }).click();
  await expect(page).toHaveURL(/\/me$/);
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: new RegExp(`^${machine.code}`) })).toBeVisible();
  const before = await page.evaluate(() => localStorage.getItem('dobi.guest'));
  expect(before).toBeTruthy();

  await main.getByRole('button', { name: 'Delete my data on this phone' }).click();
  await expect(main.getByText('Delete everything now? This can’t be undone.')).toBeVisible();
  await main.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(main.getByRole('status')).toContainText('Your data has been deleted');
  expect(await page.evaluate(() => localStorage.getItem('dobi.guest'))).toBeNull();

  // The old ID no longer works on the server.
  const res = await page.request.get('/api/v1/public/me/cycles', { headers: { authorization: `Bearer ${before}` } });
  expect(res.status()).toBe(401);

  // Coming back later: an empty, brand-new anonymous profile.
  await page.goto('/me');
  await expect(page.getByText(machine.code)).toHaveCount(0);
});
