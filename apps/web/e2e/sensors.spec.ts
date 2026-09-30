import { expect, test } from './fixtures';
import { createMachine, navTo, openOwner, OWNER_STATE, SHOPS, shopBySlug, uniq } from './helpers';

test.use({ storageState: OWNER_STATE, permissions: ['clipboard-read', 'clipboard-write'] });

test('register a sensor for a machine, copy the one-time token, ingest a sample → device online', async ({ page, request }) => {
  const shop = await shopBySlug(page.request, SHOPS.damansara.slug);
  const machine = await createMachine(page.request, shop.id);
  const label = `E2E clamp ${uniq()}`;

  await openOwner(page);
  await navTo(page, 'Sensors');
  await page.getByRole('button', { name: 'Register sensor' }).click();

  const form = page.getByRole('region', { name: 'Register a sensor' });
  await form.getByRole('combobox', { name: 'Shop' }).selectOption({ label: shop.name });
  await form.getByLabel('Machine it measures').selectOption({ label: `${machine.code} · washer 10 kg` });
  await form.getByLabel('Kind').selectOption('generic_power');
  await form.getByLabel('Label (optional)').fill(label);
  await form.getByLabel('Reports every (seconds)').fill('60');
  await form.getByRole('button', { name: 'Register & get token' }).click();

  const dialog = page.getByRole('dialog', { name: 'Sensor registered' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('It is shown only once')).toBeVisible();
  // A stray Escape or tap outside must not lose the one-time token.
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  const tokenInput = dialog.getByLabel('Device token');
  const token = await tokenInput.inputValue();
  expect(token.length).toBeGreaterThan(16);

  await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token);

  await dialog.getByRole('button', { name: "I've saved the token" }).click();
  await expect(dialog).toBeHidden();

  // Freshly registered and never heard from: not reporting yet.
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: machine.code, exact: true }) });
  await expect(row).toContainText('Not reporting');
  await expect(row).toContainText(label);

  // The sensor posts a reading with its token (no owner cookie involved).
  const res = await request.post('/api/v1/device/telemetry', {
    headers: { authorization: `Bearer ${token}` },
    data: { samples: [{ powerW: 3 }] },
  });
  expect(res.status(), await res.text()).toBe(200);

  await page.reload();
  await expect(row).toContainText('Online');
  await expect(row).toContainText('3 W');

  // The machine page shows the same sensor.
  await row.getByRole('link', { name: machine.code, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(machine.code);
  const sensor = page.getByRole('region', { name: 'Sensor' });
  await expect(sensor.getByText('Online')).toBeVisible();

  // A wrong token is rejected.
  const bad = await request.post('/api/v1/device/telemetry', { headers: { authorization: 'Bearer nope' }, data: { samples: [{ powerW: 1 }] } });
  expect(bad.status()).toBe(401);
});

test('registering a Shelly shows a ready-to-paste script with this sensor’s token and channel filled in', async ({ page }) => {
  const shop = await shopBySlug(page.request, SHOPS.damansara.slug);
  const machine = await createMachine(page.request, shop.id);
  await openOwner(page);
  await navTo(page, 'Sensors');
  await page.getByRole('button', { name: 'Register sensor' }).click();
  const form = page.getByRole('region', { name: 'Register a sensor' });
  await form.getByRole('combobox', { name: 'Shop' }).selectOption({ label: shop.name });
  await form.getByLabel('Machine it measures').selectOption({ label: `${machine.code} · washer 10 kg` });
  await expect(form.getByLabel('Kind')).toHaveValue('shelly'); // the recommended default
  await form.getByRole('button', { name: 'Register & get token' }).click();

  const dialog = page.getByRole('dialog', { name: 'Sensor registered' });
  const token = await dialog.getByLabel('Device token').inputValue();
  const script = dialog.getByLabel('Shelly script');
  await expect(script).toHaveValue(new RegExp(`token: "${token}"`));
  await expect(script).toHaveValue(/component: "em1:0"/);
  await expect(script).toHaveValue(/url: "http[^"]+\/api\/v1\/device\/telemetry"/);
  await expect(script).not.toHaveValue(/__TOKEN__|__COMPONENT__|__INGEST_URL__/);

  await dialog.getByLabel(/Which Shelly/).selectOption({ label: 'Shelly PM Mini Gen3 (inline, max 16 A)' });
  await expect(script).toHaveValue(/component: "pm1:0"/);
  await dialog.getByRole('button', { name: "I've saved the token" }).click();
});
