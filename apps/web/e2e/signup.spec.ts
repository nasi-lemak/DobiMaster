import { expect, test } from './fixtures';

// No stored session: a brand-new owner signs up and walks the setup wizard end to end.
test('new owner: sign up, set up shop and machines, print stickers, go live', async ({ page }) => {
  const email = `e2e-${Date.now()}@newdobi.my`;
  await page.goto('/owner');
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your laundromat' })).toBeVisible();

  await page.getByLabel(/^Business name/).fill('Dobi Wangi');
  await page.getByLabel('Your name').fill('Siti');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Password/).fill('wangi-wangi-2026');
  await page.getByRole('checkbox', { name: /I agree to the Terms/ }).check();
  await page.getByRole('button', { name: 'Create account' }).click();

  // Step 1: shop.
  await expect(page.getByRole('heading', { level: 1, name: 'Set up your laundromat' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Machines/ })).toBeDisabled();
  await page.getByLabel(/^Shop name/).fill('Dobi Wangi Setapak');
  await page.getByLabel('Address').fill('12 Jalan Genting Klang, Setapak');
  await page.getByRole('button', { name: 'Same hours every day' }).click();
  await page.getByLabel('Opens at').selectOption('07:00');
  await page.getByLabel('Closes at').selectOption('23:00');
  await page.getByText('Parking', { exact: true }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  // Step 2: machines from presets, with an edited price and a code preview.
  await expect(page.getByText('How many of each machine do you have?')).toBeVisible();
  const more = (label: string, n: number) => Array.from({ length: n }).reduce<Promise<void>>((p) => p.then(() => page.getByRole('button', { name: `More ${label}` }).click()), Promise.resolve());
  await more('Washer 10 kg', 3);
  await more('Dryer 15 kg', 2);
  await page.getByLabel('Washer 10 kg Cold price (RM)').fill('4.5');
  await expect(page.getByText('Will be numbered W1–W3 and D1–D2.')).toBeVisible();
  await page.getByText('Washers add detergent automatically').click();
  await page.getByRole('button', { name: 'Add 5 machines' }).click();
  await expect(page.getByText('5 machines added')).toBeVisible();
  await expect(page.getByText('W3 · 10 kg')).toBeVisible();
  await page.getByRole('button', { name: 'Next: QR stickers' }).click();

  // Step 3: the sticker sheet opens with one QR per machine; coming back marks the step done.
  await page.getByRole('link', { name: 'Open sticker sheet' }).click();
  await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
  await expect(page.getByText('D2', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: /QR stickers/ }).click();
  await page.getByRole('button', { name: 'Next: go live' }).click();

  // Step 4: publish, and the shop is visible to customers.
  await page.getByRole('button', { name: 'Go live', exact: true }).click();
  await expect(page.getByText('You’re live!')).toBeVisible();
  const url = await page.getByRole('link', { name: /\/s\/dobi-wangi-setapak$/ }).getAttribute('href');
  expect(url).toMatch(/\/s\/dobi-wangi-setapak$/);

  // The dashboard no longer nags.
  await page.getByRole('link', { name: /Dashboard/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Today/ })).toBeVisible();
  await expect(page.getByText(/Finish setting up/)).toHaveCount(0);

  await page.goto('/s/dobi-wangi-setapak');
  await expect(page.getByRole('heading', { name: 'Dobi Wangi Setapak' })).toBeVisible();
  await expect(page.getByText('RM 4.50').first()).toBeVisible();
});

test('sign-up refuses an email that already has an account', async ({ page }) => {
  await page.goto('/owner/signup');
  await page.getByLabel(/^Business name/).fill('Copycat Dobi');
  await page.getByLabel('Your name').fill('X');
  await page.getByLabel('Email').fill('owner@dobiceria.my');
  await page.getByLabel(/^Password/).fill('another-password-1');
  await page.getByRole('checkbox', { name: /I agree to the Terms/ }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toContainText('already exists');
});

test('a half-finished setup shows a banner on Overview', async ({ page }) => {
  await page.goto('/owner/signup');
  await page.getByLabel(/^Business name/).fill('Dobi Separuh');
  await page.getByLabel('Your name').fill('Ah Kow');
  await page.getByLabel('Email').fill(`half-${Date.now()}@newdobi.my`);
  await page.getByLabel(/^Password/).fill('separuh-jalan-9');
  await page.getByRole('checkbox', { name: /I agree to the Terms/ }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel(/^Shop name/).fill('Dobi Separuh Cheras');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('How many of each machine do you have?')).toBeVisible();

  await page.goto('/owner');
  await expect(page.getByRole('link', { name: /Finish setting up \(1 of 4\)/ })).toBeVisible();
  // Hidden from customers until go-live.
  const res = await page.request.get('/api/v1/public/shops/dobi-separuh-cheras');
  expect(res.status()).toBe(404);
});
