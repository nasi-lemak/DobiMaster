import { expect, test } from './fixtures';
import { createShop, navLink, navTo, openOwner, OWNER_STATE, SHOPS, uniq } from './helpers';

test.use({ storageState: OWNER_STATE });

test('save shop settings (policy text, reminder, facility) and they persist after reload', async ({ page }) => {
  const policy = `E2E: laundry left over 30 minutes is moved to the basket (${uniq()})`;
  const reminder = String(10 + (Date.now() % 90)); // 10–99, within the 1–120 limit

  await openOwner(page);
  await navTo(page, 'Shop settings');
  await page.getByRole('combobox', { name: 'Shop' }).selectOption({ label: SHOPS.kepong.name });
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(SHOPS.kepong.name);
  await expect(page).toHaveURL(/[?&]shop=/);

  const wifi = page.getByRole('checkbox', { name: 'Wi-Fi' });
  const wifiBefore = await wifi.isChecked();

  await page.getByLabel(/^English/).fill(policy);
  await page.getByLabel(/Please collect” reminder after/).fill(reminder);
  await page.getByText('Wi-Fi', { exact: true }).click(); // the toggle's visible label
  await expect(wifi).toBeChecked({ checked: !wifiBefore });

  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(SHOPS.kepong.name);
  await expect(page.getByLabel(/^English/)).toHaveValue(policy);
  await expect(page.getByLabel(/Please collect” reminder after/)).toHaveValue(reminder);
  await expect(page.getByRole('checkbox', { name: 'Wi-Fi' })).toBeChecked({ checked: !wifiBefore });

  // Customers see the new policy on the shop page.
  await page.goto(`/s/${SHOPS.kepong.slug}`);
  await expect(page.getByText(policy)).toBeVisible();
});

test('renaming a shop updates the shop pickers straight away', async ({ page }) => {
  const shop = await createShop(page.request, `E2E Dobi ${uniq()}`);
  const renamed = `${shop.name} Baru`;

  await openOwner(page, `/owner/settings?shop=${shop.id}`);
  const picker = page.getByRole('combobox', { name: 'Shop' });
  await expect(picker.locator('option:checked')).toHaveText(shop.name);
  await page.getByLabel('Name', { exact: true }).fill(renamed);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  // No reload: the picker (fed by /owner/me) shows the new name.
  await expect(picker.locator('option:checked')).toHaveText(renamed);
  await navTo(page, 'Machines');
  await expect(page.getByRole('combobox', { name: 'Shop' }).getByRole('option', { name: renamed })).toHaveCount(1);
});

test('add a staff member, who can then sign in with their own (limited) access', async ({ page, browser }) => {
  const id = uniq().toLowerCase();
  const person = { name: `E2E Staff ${id}`, email: `e2e-staff-${id}@example.test`, password: `pw-${id}-secret` };

  await openOwner(page);
  await navTo(page, 'Staff');
  await page.getByRole('button', { name: 'Add person' }).click();
  const form = page.getByRole('region', { name: 'Add a team member' });
  const submit = form.getByRole('button', { name: 'Add person' });
  await form.getByLabel('Name').fill(person.name);
  await form.getByLabel('Email').fill(person.email);
  await form.getByLabel('Temporary password').fill(person.password);
  await form.getByLabel('Role').selectOption('staff');
  await expect(submit).toBeDisabled(); // no branch chosen yet
  await form.getByRole('checkbox', { name: SHOPS.damansara.name }).check();
  await submit.click();

  await expect(form).toBeHidden();
  const row = page.getByRole('listitem').filter({ hasText: person.email });
  await expect(row).toContainText(person.name);
  await expect(row).toContainText('staff');
  await expect(row).toContainText(SHOPS.damansara.name);

  // Sign in as the new person in a separate, cookie-less browser context.
  const ctx = await browser.newContext({ storageState: undefined });
  const p2 = await ctx.newPage();
  await p2.goto('/owner');
  await p2.getByLabel('Email').fill(person.email);
  await p2.getByLabel('Password').fill(person.password);
  await p2.getByRole('button', { name: 'Sign in' }).click();
  await expect(p2.getByRole('heading', { level: 1, name: `Today · ${SHOPS.damansara.name}` })).toBeVisible();
  await expect(p2.getByText(`${person.name} · staff`)).toBeVisible();
  await expect(navLink(p2, 'Tickets')).toBeVisible();
  await expect(navLink(p2, 'Analytics')).toHaveCount(0);
  await expect(navLink(p2, 'Staff')).toHaveCount(0);

  // Removing them ends their access straight away — even in the session they already have open.
  await row.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: person.email })).toHaveCount(0);
  await p2.reload();
  await expect(p2.getByLabel('Password')).toBeVisible();
  await ctx.close();
});
