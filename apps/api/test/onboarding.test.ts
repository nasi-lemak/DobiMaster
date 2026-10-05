import { LEGAL_VERSION } from '@dobi/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/owner.js';
import { createHarness, loginAs, seedFixture, type Fixture, type Harness } from './helpers.js';

let h: Harness;
let f: Fixture;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  f = await seedFixture(h);
});

const signup = (payload: Record<string, unknown>) => h.app.inject({ method: 'POST', url: '/api/v1/owner/auth/signup', payload });
const cookieOf = (res: { headers: Record<string, unknown> }) => {
  const raw = res.headers['set-cookie'];
  const first = (Array.isArray(raw) ? raw[0] : String(raw)) as string;
  return { cookie: first.split(';')[0]! };
};

describe('owner sign-up and setup wizard', () => {
  it('signs up a new business, walks the four steps and goes live', async () => {
    const email = `new-${Date.now()}@dobi.my`;
    expect((await signup({ businessName: 'Dobi Baru', name: 'Aminah', email, password: 'short', acceptTerms: true })).statusCode).toBe(400);
    // The terms and privacy notice must be accepted explicitly.
    expect((await signup({ businessName: 'Dobi Baru', name: 'Aminah', email, password: 'a-good-password-9' })).statusCode).toBe(400);
    const res = await signup({ businessName: 'Dobi Baru', name: 'Aminah', email, password: 'a-good-password-9', acceptTerms: true });
    expect(res.statusCode).toBe(200);
    const tenant = await h.ctx.db.selectFrom('tenants').select('onboarding').where('name', '=', 'Dobi Baru').orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    expect(tenant.onboarding?.termsVersion).toBe(LEGAL_VERSION);
    const auth = cookieOf(res);

    const me = await h.app.inject({ method: 'GET', url: '/api/v1/owner/me', headers: auth });
    expect(me.statusCode).toBe(200);

    // Same email again → 409, whatever the case.
    const dup = await signup({ businessName: 'Other', name: 'X', email: email.toUpperCase(), password: 'a-good-password-9', acceptTerms: true });
    expect(dup.statusCode).toBe(409);

    const state = async () => (await h.app.inject({ method: 'GET', url: '/api/v1/owner/onboarding', headers: auth })).json();
    let s = await state();
    expect(s.steps).toEqual({ shop: false, machines: false, stickers: false, live: false });
    expect(s.complete).toBe(false);
    expect(s.presets.length).toBeGreaterThan(3);

    const shop = await h.app.inject({
      method: 'POST',
      url: '/api/v1/owner/onboarding/shop',
      headers: auth,
      payload: { name: 'Dobi Baru Bangsar', address: 'Jalan Telawi', hours: { mode: 'daily', open: '07:00', close: '23:00' }, facilities: { parking: true } },
    });
    expect(shop.statusCode).toBe(200);
    const { shopId } = shop.json();

    // Starter checklist + maintenance plans come with the shop; it is not public yet.
    const row = await h.ctx.db.selectFrom('shops').selectAll().where('id', '=', shopId).executeTakeFirstOrThrow();
    expect(row.is_published).toBe(false);
    expect(row.slug).toBe('dobi-baru-bangsar');
    expect((row.opening_hours as Record<string, { open: string; close: string }>)['1']).toEqual({ open: '07:00', close: '23:00' });
    const checklists = await h.ctx.db.selectFrom('checklist_templates').select('items').where('shop_id', '=', shopId).execute();
    expect(checklists).toHaveLength(1);
    expect((checklists[0]!.items as unknown[]).length).toBeGreaterThan(3);
    const plans = await h.ctx.db.selectFrom('maintenance_plans').select('machine_type').where('shop_id', '=', shopId).execute();
    expect(plans.map((p) => p.machine_type).sort()).toEqual(['dryer', 'washer']);

    // Going live before there are machines is refused.
    const early = await h.app.inject({ method: 'POST', url: '/api/v1/owner/onboarding/go-live', headers: auth, payload: { shopId } });
    expect(early.statusCode).toBe(400);

    const add = (groups: unknown[]) => h.app.inject({ method: 'POST', url: '/api/v1/owner/onboarding/machines', headers: auth, payload: { shopId, detergentAuto: true, groups } });
    const m1 = await add([
      { presetId: 'washer-10', quantity: 3 },
      { presetId: 'dryer-15', quantity: 2 },
    ]);
    expect(m1.statusCode).toBe(200);
    expect(m1.json().machines.map((m: { code: string }) => m.code)).toEqual(['W1', 'W2', 'W3', 'D1', 'D2']);
    // A second batch continues the numbering instead of clashing.
    const m2 = await add([{ presetId: 'washer-20', quantity: 1, programs: [{ id: 'hot', name: { en: 'Hot' }, durationMin: 45, priceSen: 1200 }] }]);
    expect(m2.json().machines.map((m: { code: string }) => m.code)).toEqual(['W4']);
    const w4 = await h.ctx.db.selectFrom('machines').selectAll().where('shop_id', '=', shopId).where('code', '=', 'W4').executeTakeFirstOrThrow();
    expect(Number(w4.capacity_kg)).toBe(20);
    expect(w4.detergent_auto).toBe(true);
    expect((w4.programs as Array<{ priceSen: number }>)[0]!.priceSen).toBe(1200);
    expect(w4.state).toBe('available');
    expect((await add([{ presetId: 'washer-99', quantity: 1 }])).statusCode).toBe(404);

    expect((await h.app.inject({ method: 'POST', url: '/api/v1/owner/onboarding/stickers-printed', headers: auth })).statusCode).toBe(200);
    const live = await h.app.inject({ method: 'POST', url: '/api/v1/owner/onboarding/go-live', headers: auth, payload: { shopId } });
    expect(live.statusCode).toBe(200);

    s = await state();
    expect(s.steps).toEqual({ shop: true, machines: true, stickers: true, live: true });
    expect(s.complete).toBe(true);
    expect(s.shop.publicUrl).toMatch(/\/s\/dobi-baru-bangsar$/);
    expect(s.machines).toHaveLength(6);

    // Now customers can see it.
    const pub = await h.app.inject({ method: 'GET', url: `/api/v1/public/shops/dobi-baru-bangsar` });
    expect(pub.statusCode).toBe(200);
  });

  it('gives a second shop with the same name its own slug', async () => {
    const res = await signup({ businessName: 'Dobi Baru', name: 'Ali', email: `dup-${Date.now()}@dobi.my`, password: 'a-good-password-9', acceptTerms: true });
    const auth = cookieOf(res);
    const mk = async () =>
      (await h.app.inject({ method: 'POST', url: '/api/v1/owner/onboarding/shop', headers: auth, payload: { name: 'Same Name', hours: { mode: '24h' } } })).json().shopId as string;
    const a = await mk();
    const b = await mk();
    const slugs = await h.ctx.db.selectFrom('shops').select('slug').where('id', 'in', [a, b]).orderBy('created_at').execute();
    expect(slugs[0]!.slug).not.toBe(slugs[1]!.slug);
    const tenants = await h.ctx.db.selectFrom('tenants').select('slug').where('name', '=', 'Dobi Baru').execute();
    expect(new Set(tenants.map((t) => t.slug)).size).toBe(tenants.length);
  });

  it('keeps staff and other businesses out of the setup steps', async () => {
    const staff = await loginAs(h, f.users.staff);
    const shop = await h.app.inject({ method: 'POST', url: '/api/v1/owner/onboarding/shop', headers: staff, payload: { name: 'Sneaky', hours: { mode: '24h' } } });
    expect(shop.statusCode).toBe(403);
    const live = await h.app.inject({ method: 'POST', url: '/api/v1/owner/onboarding/go-live', headers: staff, payload: { shopId: f.shopId } });
    expect(live.statusCode).toBe(403);

    // An owner of another business can't add machines to (or publish) this one's shop.
    // (Created directly: sign-up is rate-limited to 5 per hour and the tests above use them up.)
    const t = await h.ctx.db.insertInto('tenants').values({ name: 'Rival Dobi', slug: `rival-${Date.now()}` }).returning('id').executeTakeFirstOrThrow();
    const u = await h.ctx.db.insertInto('users').values({ email: `rival-${Date.now()}@dobi.my`, name: 'R', password_hash: await hashPassword('password123') }).returning(['id', 'email']).executeTakeFirstOrThrow();
    await h.ctx.db.insertInto('memberships').values({ tenant_id: t.id, user_id: u.id, role: 'owner', shop_ids: null }).execute();
    const rival = await loginAs(h, u.email);
    const add = await h.app.inject({ method: 'POST', url: '/api/v1/owner/onboarding/machines', headers: rival, payload: { shopId: f.shopId, groups: [{ presetId: 'washer-10', quantity: 1 }] } });
    expect([403, 404]).toContain(add.statusCode);
    const pub = await h.app.inject({ method: 'POST', url: '/api/v1/owner/onboarding/go-live', headers: rival, payload: { shopId: f.shopId } });
    expect([403, 404]).toContain(pub.statusCode);
  });
});
