import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { navTo, openOwner, OWNER_STATE, SHOPS, uniq } from './helpers';

test.use({ storageState: OWNER_STATE });

const machineRow = (page: Page, code: string) => page.getByRole('row').filter({ has: page.getByRole('link', { name: code, exact: true }) });

test('bulk-add machines, edit one price, remove the other', async ({ page }) => {
  const p = `X${uniq()}`.slice(0, 9);
  const [a, b] = [`${p}1`, `${p}2`];

  await openOwner(page);
  await navTo(page, 'Machines');
  const pagePicker = page.getByRole('combobox', { name: 'Shop' });
  await pagePicker.selectOption({ label: SHOPS.damansara.name });
  await expect(page).toHaveURL(/[?&]shop=/);

  await page.getByRole('button', { name: 'Add machines' }).click();
  const form = page.getByRole('region', { name: 'Add machines' });
  const formPicker = form.getByRole('combobox', { name: 'Shop' });
  await expect(formPicker).toHaveValue(await pagePicker.first().inputValue()); // defaults to the shop being viewed
  // …but machines can be added to another shop from the form.
  await formPicker.selectOption({ label: SHOPS.kepong.name });
  await form.getByLabel('Machine codes').fill(`${a.toLowerCase()}, ${b}`);
  await expect(form.getByText('2 machines will be added')).toBeVisible();
  await form.getByLabel('Capacity (kg)').fill('12');
  await form.getByRole('button', { name: 'Add 2 machines' }).click();

  await expect(page.getByRole('status')).toContainText(`Added ${a}, ${b}`);
  // The list switches to the shop they were added to.
  await expect(page.getByRole('combobox', { name: 'Shop' }).locator('option:checked')).toHaveText(SHOPS.kepong.name);
  await expect(machineRow(page, a)).toContainText('Washer 12 kg');
  await expect(machineRow(page, a)).toContainText('RM 5.00–RM 7.00');
  await expect(machineRow(page, b)).toBeVisible();

  // Edit the first program's price of A.
  await machineRow(page, a).getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Edit ${a}` })).toBeVisible();
  await expect(page.getByLabel('Machine code')).toHaveValue(a);
  await page.getByLabel('Price RM').first().fill('9.90');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${a} · Washer 12 kg`);
  await expect(page).toHaveURL(/\/owner\/machines\/[0-9a-f-]{36}$/);

  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Price RM').first()).toHaveValue('9.90');

  // Remove B.
  await navTo(page, 'Machines');
  await page.getByRole('combobox', { name: 'Shop' }).selectOption({ label: SHOPS.kepong.name });
  await expect(machineRow(page, a)).toContainText('RM 6.00–RM 9.90');
  await machineRow(page, b).getByRole('link', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Remove machine' }).click();
  const confirm = page.getByRole('dialog', { name: `Remove ${b}?` });
  await confirm.getByRole('button', { name: 'Remove machine' }).click();

  // Back on the machine list of the same shop: B is gone, A is still there.
  await expect(page.getByRole('heading', { level: 1, name: 'Machines & QR' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Shop' }).locator('option:checked')).toHaveText(SHOPS.kepong.name);
  await expect(machineRow(page, a)).toBeVisible();
  await expect(machineRow(page, b)).toHaveCount(0);
});
