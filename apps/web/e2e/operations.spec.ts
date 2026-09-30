import { expect, test } from './fixtures';
import { createMachine, navTo, openOwner, OWNER_STATE, SHOPS, shopBySlug, uniq } from './helpers';

test.use({ storageState: OWNER_STATE });

test('record a cash collection for a shop and find it in the history', async ({ page }) => {
  const shop = await shopBySlug(page.request, SHOPS.damansara.slug);
  const machine = await createMachine(page.request, shop.id);
  const note = `E2E weekly coins ${uniq()}`;

  await openOwner(page);
  await navTo(page, 'Collections');
  await page.getByRole('button', { name: 'Record collection' }).click();
  const form = page.getByRole('region', { name: 'Record collection' });
  await form.getByRole('combobox', { name: 'Shop' }).selectOption({ label: shop.name });
  await form.getByLabel('Note (optional)').fill(note);
  const when = form.getByLabel('Collected at');
  await expect(when).not.toHaveValue(''); // defaults to now

  const cash = form.getByLabel(`${machine.code} cash in RM`);
  await cash.fill('12,30');
  await expect(cash).toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByRole('button', { name: 'Save collection' })).toBeDisabled();
  await cash.fill('12.30');
  await form.getByLabel(`${machine.code} cycle counter reading`).fill('4455');
  await expect(form).toContainText('1 machine · RM 12.30');
  // A cleared date can't be saved (it used to throw "Invalid time value").
  const now = await when.inputValue();
  await when.fill('');
  await expect(form.getByRole('button', { name: 'Save collection' })).toBeDisabled();
  await when.fill(now);
  await form.getByRole('button', { name: 'Save collection' }).click();

  await expect(page.getByRole('status')).toContainText('Collection saved.');
  await expect(form).toBeHidden();

  const history = page.getByRole('region', { name: 'History' });
  const entry = history.getByRole('button').filter({ hasText: note });
  await expect(entry).toContainText(shop.name);
  await expect(entry).toContainText('1 machine ·');
  await expect(entry).toContainText('RM 12.30');
  await entry.click();
  await expect(entry).toHaveAttribute('aria-expanded', 'true');
  const line = history.getByRole('row').filter({ hasText: machine.code });
  await expect(line).toContainText('RM 12.30');
  await expect(line).toContainText('counter 4455');
});

test('maintenance: create a plan, log a due item as done, pause the plan', async ({ page }) => {
  const title = `E2E descale & check door seal ${uniq()}`;

  await openOwner(page);
  await navTo(page, 'Maintenance');
  const plans = page.getByRole('region', { name: 'Plans' });
  await plans.getByRole('button', { name: 'New plan' }).click();
  const form = page.getByRole('region', { name: 'New maintenance plan' });
  await form.getByRole('combobox', { name: 'Shop' }).selectOption({ label: SHOPS.damansara.name });
  // Demo machines were installed long ago, so a 1-day plan is due straight away.
  await form.getByLabel('Applies to').selectOption({ label: 'Only W3 (washer 10 kg)' });
  await form.getByLabel('What needs doing').fill(title);
  await form.getByLabel('Days').fill('1');
  await form.getByRole('button', { name: 'Create plan' }).click();
  await expect(form).toBeHidden();

  const plan = plans.getByRole('listitem').filter({ hasText: title });
  await expect(plan).toContainText('machine W3');
  await expect(plan).toContainText('every 1 days');
  await expect(plan.getByText('Active')).toBeVisible();

  const due = page.getByRole('region', { name: 'Due list' });
  const item = due.getByRole('article', { name: `W3: ${title}` });
  await expect(item.getByText('Due', { exact: true })).toBeVisible();
  await expect(item).toContainText('never (since install)');
  await item.getByRole('button', { name: 'Log done' }).click();

  const dialog = page.getByRole('dialog', { name: 'Log maintenance · W3' });
  await expect(dialog).toContainText(title);
  await dialog.getByLabel('Notes (optional)').fill('Descaled, seal OK');
  await dialog.getByLabel('Cost in RM (optional)').fill('45');
  await dialog.getByRole('button', { name: 'Log as done now' }).click();
  await expect(dialog).toBeHidden();

  // No longer due: gone from "Due & due soon", shown as OK under "All machines".
  await expect(item).toHaveCount(0);
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All machines' }).click();
  await expect(item.getByText('OK', { exact: true })).toBeVisible();
  await expect(item).not.toContainText('never');

  await plan.getByRole('button', { name: 'Pause' }).click();
  await expect(plan.getByText('Paused')).toBeVisible();
  await expect(plan.getByRole('button', { name: 'Resume' })).toBeVisible();
  // A paused plan produces no due items.
  await expect(item).toHaveCount(0);
});

test('maintenance plan form: switching shop drops a machine picked in the previous shop', async ({ page }) => {
  const title = `E2E clean soap drawer ${uniq()}`;
  await openOwner(page, '/owner/maintenance');
  const plans = page.getByRole('region', { name: 'Plans' });
  await plans.getByRole('button', { name: 'New plan' }).click();
  const form = page.getByRole('region', { name: 'New maintenance plan' });
  await form.getByRole('combobox', { name: 'Shop' }).selectOption({ label: SHOPS.ss2.name });
  await form.getByLabel('Applies to').selectOption({ label: 'Only W1 (washer 10 kg)' });
  await form.getByRole('combobox', { name: 'Shop' }).selectOption({ label: SHOPS.kepong.name });
  // The select can't show SS2's W1 any more, so it displays "All washers" — and that must be what is saved.
  await expect(form.getByLabel('Applies to')).toHaveValue('type:washer');
  await form.getByLabel('What needs doing').fill(title);
  await form.getByLabel('Cycles').fill('100000');
  await form.getByRole('button', { name: 'Create plan' }).click();
  await expect(form).toBeHidden();

  const plan = plans.getByRole('listitem').filter({ hasText: title });
  await expect(plan).toContainText(`${SHOPS.kepong.name} · all washers · every 100000 cycles`);
  await plan.getByRole('button', { name: 'Pause' }).click();
  await expect(plan.getByText('Paused')).toBeVisible();
});

test('announcement in three languages shows on the public shop page until it is ended', async ({ page }) => {
  const id = uniq();
  const msg = { en: `E2E dryer D2 under repair until Friday ${id}`, ms: `E2E pengering D2 dibaiki hingga Jumaat ${id}`, zh: `E2E 烘干机 D2 维修至周五 ${id}` };

  await openOwner(page);
  await navTo(page, 'Announcements');
  await page.getByRole('button', { name: 'New announcement' }).click();
  const form = page.getByRole('region', { name: 'New announcement' });
  await form.getByRole('combobox', { name: 'Shop' }).selectOption({ label: SHOPS.kepong.name });
  await form.getByRole('group', { name: 'Type' }).getByRole('button', { name: 'Warning' }).click();
  await form.getByLabel('English (required)').fill(msg.en);
  await form.getByLabel('Bahasa Melayu').fill(msg.ms);
  await form.getByLabel('中文').fill(msg.zh);
  // "Show until" can't be set before today (local date, not UTC).
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  await expect(form.getByLabel('Show until (optional)')).toHaveAttribute('min', today);
  await form.getByRole('button', { name: 'Publish' }).click();
  await expect(form).toBeHidden();

  const live = page.getByRole('region', { name: /^Live now/ });
  const card = live.getByRole('article').filter({ hasText: msg.en });
  await expect(card).toContainText(SHOPS.kepong.name);
  await expect(card).toContainText(`BM: ${msg.ms}`);
  await expect(card).toContainText(`中文: ${msg.zh}`);
  await expect(card).toContainText('no end date');

  // Customer view, in each language.
  const customer = await page.context().newPage();
  await customer.goto(`/s/${SHOPS.kepong.slug}`);
  await expect(customer.getByText(msg.en)).toBeVisible();
  await customer.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'BM' }).click();
  await expect(customer.getByText(msg.ms)).toBeVisible();
  await customer.getByRole('button', { name: '中文' }).click();
  await expect(customer.getByText(msg.zh)).toBeVisible();
  await customer.getByRole('button', { name: 'EN' }).click();

  await card.getByRole('button', { name: 'End now' }).click();
  const confirm = page.getByRole('dialog', { name: 'End this announcement?' });
  await confirm.getByRole('button', { name: 'End now' }).click();
  await expect(confirm).toBeHidden();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Ended or scheduled' })).toContainText(msg.en);

  await customer.reload();
  await expect(customer.getByRole('heading', { level: 1, name: SHOPS.kepong.name })).toBeVisible();
  await expect(customer.getByText(msg.en)).toHaveCount(0);
  await customer.close();
});

test('alerts: mark one seen, then resolve it', async ({ page }) => {
  await openOwner(page);
  await navTo(page, 'Alerts');
  const status = page.getByRole('group', { name: 'Status' });
  const list = page.getByRole('list', { name: 'Alerts' });

  const first = list.getByRole('listitem').first();
  await expect(first, 'the demo seed raises a few open alerts').toBeVisible();
  const message = (await first.getByTestId('alert-message').textContent())!.trim();
  const alert = list.getByRole('listitem').filter({ hasText: message });

  await alert.getByRole('button', { name: 'Mark seen' }).click();
  await expect(alert).toHaveCount(0); // leaves the "Open" filter

  await status.getByRole('button', { name: 'Seen' }).click();
  await expect(alert.getByText('Seen', { exact: true })).toBeVisible();
  await alert.getByRole('button', { name: 'Resolve' }).click();
  await expect(alert).toHaveCount(0);

  await status.getByRole('button', { name: 'Resolved' }).click();
  await expect(alert.getByText('Resolved', { exact: true })).toBeVisible();
  await expect(alert.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
});
