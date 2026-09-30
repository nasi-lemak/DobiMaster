import { expect, test } from './fixtures';
import { navTo, openOwner, OWNER_STATE, uniq } from './helpers';

test.use({ storageState: OWNER_STATE });

/**
 * Uses a dedicated manager (created here) — "sign out other devices" on the shared owner session
 * would log out every later spec.
 */
test('signed-in devices: sign out other devices ends those sessions, this one stays', async ({ page, browser }) => {
  const id = uniq().toLowerCase();
  const person = { name: `E2E Manager ${id}`, email: `e2e-mgr-${id}@example.test`, password: `pw-${id}-secret` };
  await openOwner(page);
  const created = await page.request.post('/api/v1/owner/staff', { data: { ...person, role: 'manager', shopIds: null } });
  expect(created.ok()).toBe(true);

  // Two devices: a "lost phone" and the laptop we keep.
  const signIn = async () => {
    const ctx = await browser.newContext({ storageState: undefined });
    const res = await ctx.request.post('/api/v1/owner/auth/login', { data: { email: person.email, password: person.password } });
    expect(res.ok()).toBe(true);
    return ctx;
  };
  const phone = await signIn();
  const laptop = await signIn();
  const laptopPage = await laptop.newPage();
  await openOwner(laptopPage);
  await navTo(laptopPage, 'Signed-in devices');

  const devices = laptopPage.getByRole('list', { name: 'Signed-in devices' }).getByRole('listitem');
  await expect(devices).toHaveCount(2);
  await expect(devices.filter({ hasText: 'This device' })).toHaveCount(1);

  await laptopPage.getByRole('button', { name: 'Sign out other devices' }).click();
  await laptopPage.getByRole('dialog').getByRole('button', { name: 'Sign out others' }).click();
  await expect(devices).toHaveCount(1);

  expect((await phone.request.get('/api/v1/owner/me')).status()).toBe(401);
  expect((await laptop.request.get('/api/v1/owner/me')).status()).toBe(200);

  // Logging out here ends this session server-side too.
  await devices.getByRole('button', { name: 'Log out' }).click();
  await laptopPage.getByRole('dialog').getByRole('button', { name: 'Log out' }).click();
  await expect(laptopPage.getByLabel('Password')).toBeVisible();
  expect((await laptop.request.get('/api/v1/owner/me')).status()).toBe(401);
  await phone.close();
  await laptop.close();
});
