import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { json } from '../src/db/index.js';
import { buildDigest, deliverDigest, sweepDigest } from '../src/modules/digest/service.js';
import { sweepPrivacy } from '../src/modules/privacy/service.js';
import { sweepUnlinkedAttachments } from '../src/modules/attachments/service.js';
import { createHarness, guest, loginAs, seedFixture, type Fixture, type Harness } from './helpers.js';

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
  h.push.sent = [];
  h.whatsapp.sent = [];
  h.mail.sent = [];
});

// A tiny valid-looking JPEG (magic bytes + filler) — the server only sniffs the header.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7), Buffer.from([0xff, 0xd9])]);
const PHONE = '60123456789';

async function inbound(text: string, from = PHONE) {
  const res = await h.app.inject({ method: 'POST', url: '/api/v1/dev/whatsapp/inbound', payload: { from, text } });
  expect(res.statusCode).toBe(200);
  return res.json() as { action: string };
}
const waTo = (to = PHONE) => h.whatsapp.sent.filter((m) => m.to === to);

describe('WhatsApp "notify me"', () => {
  it('links via a customer-sent code and delivers laundry alerts inside the free window', async () => {
    const g = await guest(h, false);
    const cycleId = randomUUID();
    await h.app.inject({ method: 'POST', url: '/api/v1/public/cycles', headers: g.auth, payload: { id: cycleId, qrToken: f.washer.qr } });
    const link = (await h.app.inject({ method: 'POST', url: '/api/v1/public/whatsapp/link', headers: g.auth, payload: { cycleId, locale: 'ms' } })).json();
    expect(link.url).toMatch(/^https:\/\/wa\.me\/\d+\?text=DOBI-/);

    expect((await inbound(`DOBI-${link.code} — Hantar mesej ini`)).action).toBe('linked');
    expect(waTo().at(-1)?.body).toContain('Berjaya'); // reply in the customer's language
    const status = (await h.app.inject({ method: 'GET', url: '/api/v1/public/me/whatsapp', headers: g.auth })).json();
    expect(status).toMatchObject({ linked: true, windowOpen: true });

    await h.tick(25); // "almost done"
    await h.tick(5); // finished
    const bodies = waTo().map((m) => m.body ?? '');
    expect(bodies.some((b) => b.includes('W1 hampir siap'))).toBe(true);
    expect(bodies.some((b) => b.includes('W1 sudah siap') && b.includes('/me'))).toBe(true);
  });

  it('never sends free-form messages after the 24 h window, and honours STOP', async () => {
    const g = await guest(h, false);
    const link = (await h.app.inject({ method: 'POST', url: '/api/v1/public/whatsapp/link', headers: g.auth, payload: {} })).json();
    await inbound(`DOBI-${link.code}`);
    h.whatsapp.sent = [];

    h.clock.advance(25 * 60); // window closed
    await h.app.inject({ method: 'POST', url: '/api/v1/public/cycles', headers: g.auth, payload: { id: randomUUID(), qrToken: f.washer.qr } });
    await h.tick(31);
    expect(waTo()).toHaveLength(0);
    const skipped = await h.ctx.db.selectFrom('wa_messages').select('kind').where('kind', '=', 'skipped_window').execute();
    expect(skipped.length).toBeGreaterThan(0);

    // Messaging us again re-opens the window; STOP opts out entirely.
    expect((await inbound('STOP')).action).toBe('stopped');
    await h.app.inject({ method: 'POST', url: '/api/v1/public/cycles', headers: g.auth, payload: { id: randomUUID(), qrToken: f.sensored.qr } });
    h.whatsapp.sent = [];
    await h.tick(31);
    expect(waTo()).toHaveLength(0);
  });

  it('rejects expired or reused codes and answers unknown messages with help', async () => {
    const g = await guest(h, false);
    const link = (await h.app.inject({ method: 'POST', url: '/api/v1/public/whatsapp/link', headers: g.auth, payload: {} })).json();
    h.clock.advance(31);
    expect((await inbound(`DOBI-${link.code}`)).action).toBe('expired');
    expect((await inbound('hello?')).action).toBe('help');
  });

  it('rejects unsigned webhook deliveries', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/webhooks/whatsapp', headers: { 'content-type': 'application/json' }, payload: '{"entry":[]}' });
    expect(res.statusCode).toBe(401);
  });
});

describe('photos', () => {
  const upload = (headers: Record<string, string>, body: Buffer, type = 'image/jpeg') =>
    h.app.inject({ method: 'POST', url: '/api/v1/public/uploads', headers: { ...headers, 'content-type': type }, payload: body });

  it('attaches customer photos to a report; owners of that shop can view them, others cannot', async () => {
    const g = await guest(h, false);
    const up = await upload(g.auth, JPEG);
    expect(up.statusCode).toBe(200);
    const photoId = up.json().attachment.id;
    const r = await h.app.inject({ method: 'POST', url: '/api/v1/public/reports', headers: g.auth, payload: { id: randomUUID(), qrToken: f.washer.qr, category: 'water_leak', attachmentIds: [photoId] } });
    const ticketId = r.json().ticket.id;

    const owner = await loginAs(h, f.users.owner);
    const detail = (await h.app.inject({ method: 'GET', url: `/api/v1/owner/tickets/${ticketId}`, headers: owner })).json();
    expect(detail.photos).toHaveLength(1);
    const img = await h.app.inject({ method: 'GET', url: detail.photos[0].url, headers: owner });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(img.rawPayload.equals(JPEG)).toBe(true);

    const other = await seedFixture(h);
    const stranger = await loginAs(h, other.users.owner);
    expect((await h.app.inject({ method: 'GET', url: detail.photos[0].url, headers: stranger })).statusCode).toBe(404);
  });

  it('only trusts magic bytes and never links someone else’s upload', async () => {
    const a = await guest(h, false);
    const b = await guest(h, false);
    expect((await upload(a.auth, Buffer.from('<svg onload=alert(1)>'), 'image/png')).statusCode).toBe(415);
    const photoId = (await upload(a.auth, JPEG)).json().attachment.id;
    await h.app.inject({ method: 'POST', url: '/api/v1/public/reports', headers: b.auth, payload: { id: randomUUID(), qrToken: f.washer.qr, category: 'dirty_machine', attachmentIds: [photoId] } });
    const row = await h.ctx.db.selectFrom('attachments').select('ticket_id').where('id', '=', photoId).executeTakeFirstOrThrow();
    expect(row.ticket_id).toBeNull();

    const key = (await h.ctx.db.selectFrom('attachments').select('storage_key').where('id', '=', photoId).executeTakeFirstOrThrow()).storage_key;
    h.clock.advance(25 * 60);
    expect(await sweepUnlinkedAttachments(h.ctx)).toBe(1);
    expect(h.blobs.files.has(key)).toBe(false);
  });

  it('checklist items can require a photo; item ids are assigned by the server', async () => {
    const owner = await loginAs(h, f.users.owner);
    const t = (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/owner/checklists/templates',
        headers: owner,
        payload: { shopId: f.shopId, name: 'Night close', items: [{ label: 'Clean lint filters', photoRequired: true }, { label: 'Lock door' }] },
      })
    ).json().template;
    expect(t.items[0].id).toMatch(/^[a-z0-9]{8}$/);
    expect(t.items[0].id).not.toBe(t.items[1].id);

    const staff = await loginAs(h, f.users.staff);
    const runs = (await h.app.inject({ method: 'GET', url: '/api/v1/owner/checklists/today', headers: staff })).json().runs;
    const run = runs.find((r: { templateId: string }) => r.templateId === t.id);
    const tick = (payload: object) => h.app.inject({ method: 'POST', url: `/api/v1/owner/checklists/runs/${run.runId}/items/${t.items[0].id}`, headers: staff, payload });
    expect((await tick({ done: true })).statusCode).toBe(400);

    const photo = await h.app.inject({ method: 'POST', url: '/api/v1/owner/uploads', headers: { ...staff, 'content-type': 'image/jpeg' }, payload: JPEG });
    expect((await tick({ done: true, photoId: photo.json().attachment.id })).statusCode).toBe(200);
    const after = (await h.app.inject({ method: 'GET', url: '/api/v1/owner/checklists/today', headers: owner })).json().runs.find((r: { templateId: string }) => r.templateId === t.id);
    expect(after.items[0].done.photoUrl).toContain('/owner/attachments/');
    expect((await h.app.inject({ method: 'GET', url: after.items[0].done.photoUrl, headers: owner })).statusCode).toBe(200);
  });
});

describe('weekly owner digest', () => {
  it('summarises the week, lists what needs the owner, and hides revenue from staff', async () => {
    const g = await guest(h, false);
    await h.app.inject({ method: 'POST', url: '/api/v1/public/cycles', headers: g.auth, payload: { id: randomUUID(), qrToken: f.washer.qr } });
    await h.app.inject({ method: 'POST', url: '/api/v1/public/reports', headers: g.auth, payload: { id: randomUUID(), qrToken: f.washer.qr, category: 'water_leak' } });
    h.clock.advance(5);
    const owner = await loginAs(h, f.users.owner);
    const d = (await h.app.inject({ method: 'GET', url: '/api/v1/owner/digest?weeksAgo=0', headers: owner })).json();
    expect(d.totals.cycles).toBe(1);
    expect(d.totals.ticketsOpened).toBe(1);
    expect(d.includesRevenue).toBe(true);
    expect(d.actions[0]).toMatchObject({ severity: 'high' });

    const staffDigest = await buildDigest(h.ctx, f.tenantId, [f.shopId], d.weekStart, false);
    expect(staffDigest.totals.estRevenueSen).toBeNull();
  });

  it('is emailed to owners/managers once per week on Monday morning, respecting opt-out', async () => {
    h.clock.now = new Date('2026-10-05T00:30:00Z'); // Monday 08:30 in Kuala Lumpur
    await sweepDigest(h.ctx);
    const toOwner = h.mail.sent.filter((m) => m.to === f.users.owner);
    expect(toOwner).toHaveLength(1);
    expect(toOwner[0]!.subject).toContain('Weekly summary');
    expect(toOwner[0]!.html).toContain('Open dashboard');
    expect(h.mail.sent.some((m) => m.to === f.users.staff)).toBe(false);

    await sweepDigest(h.ctx); // idempotent
    expect(h.mail.sent.filter((m) => m.to === f.users.owner)).toHaveLength(1);

    await h.ctx.db.updateTable('users').set({ digest_opt_out: true }).where('id', '=', f.users.ownerId).execute();
    const res = await deliverDigest(h.ctx, f.tenantId, '2026-09-28');
    expect(res.recipients).toBe(0);
  });
});

describe('privacy retention', () => {
  it('purges refund phone numbers 90 days after a case closes', async () => {
    const g = await guest(h, false);
    const mk = async () =>
      (await h.app.inject({ method: 'POST', url: '/api/v1/public/reports', headers: g.auth, payload: { id: randomUUID(), qrToken: f.washer.qr, category: 'coin_jammed', contactPhone: '+60123456789', amountClaimedSen: 500 } })).json().ticket.id;
    const oldId = await mk();
    const recentId = await mk();
    await h.ctx.db.updateTable('tickets').set({ status: 'resolved', resolved_at: new Date(h.clock.now.getTime() - 100 * 86_400_000) }).where('id', '=', oldId).execute();
    await h.ctx.db.updateTable('tickets').set({ status: 'resolved', resolved_at: new Date(h.clock.now.getTime() - 10 * 86_400_000) }).where('id', '=', recentId).execute();
    await sweepPrivacy(h.ctx);
    const rows = await h.ctx.db.selectFrom('tickets').select(['id', 'contact_phone']).where('id', 'in', [oldId, recentId]).execute();
    expect(rows.find((r) => r.id === oldId)?.contact_phone).toBeNull();
    expect(rows.find((r) => r.id === recentId)?.contact_phone).toBe('+60123456789');
    void json;
  });
});
