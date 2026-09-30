import { expect, test } from './fixtures';
import { createMachine, openOwner, OWNER_STATE, SHOPS, shopBySlug, uniq } from './helpers';

test.use({ storageState: OWNER_STATE });

test('branch live view: mark maintenance with a reason → customer sees it → return to service', async ({ page }) => {
  const shop = await shopBySlug(page.request, SHOPS.damansara.slug);
  const machine = await createMachine(page.request, shop.id);
  const reason = `Technician coming Friday ${uniq()}`;

  await openOwner(page);
  await page.getByRole('link', { name: new RegExp(`^${shop.name}`) }).click();
  await expect(page.getByRole('heading', { level: 1, name: shop.name })).toBeVisible();
  const tile = page.getByRole('link').filter({ hasText: machine.code });
  await expect(tile).toContainText('Available');

  await page.getByRole('button', { name: `Actions for ${machine.code}` }).click();
  const sheet = page.getByRole('dialog', { name: `${machine.code} · Washer 10 kg` });
  await sheet.getByRole('button', { name: 'Mark maintenance…' }).click();
  const submit = sheet.getByRole('button', { name: 'Mark maintenance', exact: true });
  await expect(submit).toBeDisabled(); // the reason is required
  await sheet.getByLabel('Reason — customers will see this').fill(reason);
  await submit.click();
  await expect(sheet).toBeHidden();
  await expect(tile).toContainText('Maintenance');
  await expect(tile).toContainText(reason);

  // The customer machine page explains why it can't be used.
  const customer = await page.context().newPage();
  await customer.goto(`/m/${machine.qrToken}`);
  await expect(customer.getByRole('heading', { level: 1, name: machine.code })).toBeVisible();
  const notice = customer.getByRole('alert');
  await expect(notice).toContainText('Under maintenance');
  await expect(notice).toContainText(`Reason: ${reason}`);
  await expect(customer.getByRole('button', { name: /I’ve started it/ })).toHaveCount(0);

  // Back in service.
  await page.getByRole('button', { name: `Actions for ${machine.code}` }).click();
  await sheet.getByRole('button', { name: 'Return to service' }).click();
  await expect(sheet).toBeHidden();
  await expect(tile).toContainText('Available');
  await expect(tile).not.toContainText(reason);

  await customer.reload();
  await expect(customer.getByRole('heading', { level: 1, name: machine.code })).toBeVisible();
  await expect(customer.getByRole('alert')).toHaveCount(0);
  await expect(customer.getByRole('button', { name: /I’ve started it/ })).toBeVisible();
  await customer.close();

  // Staff-reported fault (reason optional) and clearing it.
  await page.getByRole('button', { name: `Actions for ${machine.code}` }).click();
  await sheet.getByRole('button', { name: 'Mark faulty…' }).click();
  await sheet.getByLabel('What is wrong? (optional)').fill('Door lock broken');
  await sheet.getByRole('button', { name: 'Mark faulty', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(tile).toContainText('Fault');
  await expect(tile).toContainText('Door lock broken');
  await page.getByRole('button', { name: `Actions for ${machine.code}` }).click();
  await sheet.getByRole('button', { name: 'Clear fault' }).click();
  await expect(sheet).toBeHidden();
  await expect(tile).toContainText('Available');
  await expect(tile).not.toContainText('Door lock broken');

  // The machine's history records both changes with the reason.
  await tile.click();
  await expect(page.getByRole('region', { name: 'History' })).toContainText(reason);
});
