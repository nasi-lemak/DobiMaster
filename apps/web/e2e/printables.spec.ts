import { expect, test } from './fixtures';
import { OWNER_STATE, SHOPS, shopBySlug } from './helpers';

test.use({ storageState: OWNER_STATE });

test('customer poster and staff guide print on one A4 page each, in BM / EN / 中文', async ({ page, playwright, baseURL }) => {
  const owner = await playwright.request.newContext({ baseURL, storageState: OWNER_STATE });
  const shop = await shopBySlug(owner, SHOPS.damansara.slug);

  // Poster: reached from Machines, shows the shop QR and the app's real button names in all three languages.
  await page.goto(`/owner/machines?shop=${shop.id}`);
  await page.getByRole('link', { name: 'Print customer poster' }).click();
  await expect(page.getByRole('heading', { level: 1, name: shop.name })).toBeVisible();
  await expect(page.locator('.qr-fit svg')).toBeVisible();
  for (const label of ['“Saya dah mula — beritahu saya”', '“I’ve started it — notify me”', '“我已开始——完成时提醒我”']) {
    await expect(page.getByText(label)).toBeVisible();
  }
  await page.emulateMedia({ media: 'print' });
  const pages = (pdf: Buffer) => Math.max(...[...pdf.toString('latin1').matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1])));
  expect(pages(await page.pdf({ format: 'A4', printBackground: true }))).toBe(1);
  await page.emulateMedia({ media: 'screen' });

  // Staff guide: from the Staff page, one page per language.
  await page.goto('/owner/staff');
  await page.getByRole('link', { name: 'Staff guide' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Panduan pekerja/ })).toBeVisible();
  for (const [label, title] of [
    ['EN', /^Staff guide/],
    ['中文', /^员工指南/],
  ] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  }
  await page.emulateMedia({ media: 'print' });
  expect(pages(await page.pdf({ format: 'A4', printBackground: true }))).toBe(1);
});
