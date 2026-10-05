import { afterEach, describe, expect, it } from 'vitest';
import { assertProductionConfig, config } from '../src/config.js';
import { DisabledGateway } from '../src/modules/payments/gateway.js';
import { createHarness, guest, seedFixture, type Harness } from './helpers.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const signup = (hh: Harness, email: string) =>
  hh.app.inject({ method: 'POST', url: '/api/v1/owner/auth/signup', payload: { businessName: 'Dobi Test', name: 'T', email, password: 'a-good-password-9', acceptTerms: true } });

describe('production settings', () => {
  const prod = { ...config, isProd: true, jwtSecret: 'x'.repeat(64), publicUrl: 'https://dobi.example.my', paymentProvider: 'none', allowMockPaymentsInProduction: false };

  it('accepts a sane production config', () => {
    expect(assertProductionConfig(prod)).toEqual([]);
  });

  it('refuses weak secrets, plain http and the free mock gateway', () => {
    const errors = assertProductionConfig({ ...prod, jwtSecret: 'change-me-to-a-long-random-string-change-me', publicUrl: 'http://dobi.example.my', paymentProvider: 'mock' });
    expect(errors).toHaveLength(3);
    expect(assertProductionConfig({ ...prod, jwtSecret: 'short' })[0]).toMatch(/32 characters/);
    expect(assertProductionConfig({ ...prod, paymentProvider: 'mock', allowMockPaymentsInProduction: true })).toEqual([]);
  });

  it('allows plain http only for localhost (trying the Docker image on your own computer)', () => {
    expect(assertProductionConfig({ ...prod, publicUrl: 'http://localhost:3000' })).toEqual([]);
    expect(assertProductionConfig({ ...prod, publicUrl: 'http://localhost.evil.my' })).toHaveLength(1);
  });

  it('never checks anything outside production', () => {
    expect(assertProductionConfig({ ...prod, isProd: false, jwtSecret: 'short' })).toEqual([]);
  });
});

describe('sign-up modes', () => {
  it('closed: nobody can sign up, and the sign-in page is told so', async () => {
    h = await createHarness({ signupMode: 'closed' });
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/owner/auth/signup' })).json()).toEqual({ allowed: false });
    const res = await signup(h, `closed-${Date.now()}@x.my`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('signup_closed');
  });

  it('first: only the very first business can sign up (a private install)', async () => {
    h = await createHarness({ signupMode: 'first' }); // starts with an empty database
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/owner/auth/signup' })).json()).toEqual({ allowed: true });
    expect((await signup(h, `first-${Date.now()}@x.my`)).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/owner/auth/signup' })).json()).toEqual({ allowed: false });
    expect((await signup(h, `second-${Date.now()}@x.my`)).statusCode).toBe(403);
  });
});

describe('payments switched off (PAYMENT_PROVIDER=none)', () => {
  it('never offers pay-in-app, even on a controllable machine, and refuses a payment', async () => {
    h = await createHarness({ gateway: new DisabledGateway() });
    const f = await seedFixture(h);
    const m = await h.app.inject({ method: 'GET', url: `/api/v1/public/machines/${f.paid.qr}` });
    expect(m.json().machine.payable).toBe(false);
    const g = await guest(h, false);
    const pay = await h.app.inject({ method: 'POST', url: '/api/v1/public/payments', headers: { ...g.auth, 'idempotency-key': 'key-12345678' }, payload: { qrToken: f.paid.qr } });
    expect(pay.statusCode).toBeGreaterThanOrEqual(400);
    expect(pay.statusCode).toBeLessThan(500);
    expect(await h.ctx.db.selectFrom('payments').select('id').execute()).toHaveLength(0);
  });
});
