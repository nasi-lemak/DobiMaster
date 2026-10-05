import { expect, test } from './fixtures';
import { createMachine, OWNER_STATE, SHOPS, shopBySlug } from './helpers';

// A plain customer: no owner cookie, fresh guest.
test('customer: home → shop → machine → start timer → countdown; report a problem → reference', async ({ page, playwright, baseURL }) => {
  const owner = await playwright.request.newContext({ baseURL, storageState: OWNER_STATE });
  const shop = await shopBySlug(owner, SHOPS.damansara.slug);
  const machine = await createMachine(owner, shop.id);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Nearby dobi' })).toBeVisible();
  await page.getByRole('link').filter({ has: page.getByRole('heading', { name: shop.name }) }).click();
  await expect(page.getByRole('heading', { level: 1, name: shop.name })).toBeVisible();

  // The shop page shows every machine's status but no QR tokens: timers need the sticker on the machine.
  await expect(page.getByRole('main').getByText(machine.code, { exact: true })).toBeVisible();
  await expect(page.getByRole('link').filter({ hasText: machine.code })).toHaveCount(0);
  await expect(page.getByText(/scan the QR sticker on the machine/)).toBeVisible();
  await page.goto(`/m/${machine.qrToken}`); // = scanning the sticker
  await expect(page.getByRole('heading', { level: 1, name: machine.code })).toBeVisible();

  await page.getByRole('button', { name: /I’ve started it/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Which program did you choose?' })).toBeVisible();
  await sheet.getByRole('button', { name: /^Hot/ }).click();
  await expect(sheet.getByRole('button', { name: /^Hot/ })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Start my timer' }).click();

  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole('heading', { level: 1, name: 'My laundry' })).toBeVisible();
  // A fresh guest has exactly one running timer: this one.
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: new RegExp(`^${machine.code}`) })).toContainText(shop.name);
  const clock = main.getByText(/^\d{1,2}:\d{2}$/);
  await expect(clock).toBeVisible();
  const first = await clock.textContent();
  // A 40-minute program: somewhere in the high 30s, and ticking down.
  expect(Number(first!.split(':')[0])).toBeGreaterThanOrEqual(38);
  await expect.poll(() => clock.textContent(), { timeout: 5_000 }).not.toBe(first);

  // Report a problem from the running timer.
  await main.getByRole('link', { name: /Report a problem/ }).click();
  await expect(page).toHaveURL(new RegExp(`/m/${machine.qrToken}/report$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText(machine.code);
  await page.getByRole('button', { name: /Water leaking/ }).click();
  await page.getByLabel('Details (optional)').fill('Water on the floor in front of the door');
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByRole('heading', { name: 'Report sent' })).toBeVisible();
  const refText = await page.getByText(/^Reference #/).textContent();
  const ref = refText!.match(/#(\S+?)\./)?.[1];
  expect(ref, refText!).toBeTruthy();

  // The owner gets it as a ticket on that machine.
  const tickets = await (await owner.get(`/api/v1/owner/tickets?machineId=${machine.id}`)).json();
  expect(tickets.tickets.map((t: { ref: string }) => t.ref)).toContain(ref);
  await owner.dispose();
});
