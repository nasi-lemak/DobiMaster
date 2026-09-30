import { expect, test as setup } from '@playwright/test';
import { OWNER, OWNER_STATE, STAFF, STAFF_STATE } from './helpers';

// Log in once per role through the API and share the session cookie with every spec.
// (POST /owner/auth/login allows 10 attempts per 5 minutes, so specs must not each log in.)
for (const [who, creds, path] of [
  ['owner', OWNER, OWNER_STATE],
  ['staff', STAFF, STAFF_STATE],
] as const) {
  setup(`sign in as ${who}`, async ({ request }) => {
    const res = await request.post('/api/v1/owner/auth/login', { data: creds });
    expect(res.status(), await res.text()).toBe(200);
    const me = await request.get('/api/v1/owner/me');
    expect(me.ok()).toBeTruthy();
    await request.storageState({ path });
  });
}
