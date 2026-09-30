import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const OWNER = { email: 'owner@dobiceria.my', password: 'demo1234' };
export const STAFF = { email: 'staff@dobiceria.my', password: 'demo1234' };

/** storageState files written by auth.setup.ts (one API login per role per run — login is rate-limited). */
export const OWNER_STATE = 'e2e/.auth/owner.json';
export const STAFF_STATE = 'e2e/.auth/staff.json';

/** Demo shops (seeded by apps/api/src/cli/seed.ts). */
export const SHOPS = {
  ss2: { slug: 'dobi-ceria-ss2', name: 'Dobi Ceria SS2' },
  damansara: { slug: 'dobi-ceria-damansara-uptown', name: 'Dobi Ceria Damansara Uptown' },
  kepong: { slug: 'dobi-ceria-kepong', name: 'Dobi Ceria Kepong' },
} as const;

let counter = 0;
/** Short unique suffix (base-36 time + counter) so tests can be re-run against the same database. */
export function uniq() {
  counter += 1;
  return `${Date.now().toString(36).slice(-5)}${counter.toString(36)}`.toUpperCase();
}

/** A machine code (API max 12 chars) that won't collide with demo or earlier-run machines. */
export const machineCode = (prefix = 'E') => `${prefix}${uniq()}`.slice(0, 11);

async function ok<T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  if (!res.ok()) throw new Error(`${res.url()} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

export interface MeShop {
  id: string;
  name: string;
  slug: string;
}

export async function shopBySlug(request: APIRequestContext, slug: string): Promise<MeShop> {
  const me = await ok<{ shops: MeShop[] }>(await request.get('/api/v1/owner/me'));
  const shop = me.shops.find((s) => s.slug === slug);
  if (!shop) throw new Error(`shop ${slug} not visible to this user`);
  return shop;
}

export interface CreatedMachine {
  id: string;
  code: string;
  qrToken: string;
  shopId: string;
}

/** Arrange step: create a plain washer via the API (the UI flow itself is covered in machines.spec.ts). */
export async function createMachine(request: APIRequestContext, shopId: string, code = machineCode()): Promise<CreatedMachine> {
  const body = {
    shopId,
    code,
    type: 'washer',
    capacityKg: 10,
    programs: [
      { id: 'cold', name: { en: 'Cold' }, durationMin: 30, priceSen: 500 },
      { id: 'hot', name: { en: 'Hot' }, durationMin: 40, priceSen: 700 },
    ],
  };
  const r = await ok<{ machines: CreatedMachine[] }>(await request.post('/api/v1/owner/machines', { data: body }));
  return r.machines[0]!;
}

export async function createTicket(request: APIRequestContext, shopId: string, title: string, extra: Record<string, unknown> = {}) {
  const r = await ok<{ ticket: { id: string; ref: string } }>(
    await request.post('/api/v1/owner/tickets', { data: { id: crypto.randomUUID(), shopId, category: 'other', title, ...extra } }),
  );
  return r.ticket;
}

/** The owner dashboard is lazy-loaded; wait until the chrome (sidebar) is there. */
export async function openOwner(page: Page, path = '/owner') {
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toBeVisible();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A sidebar link by its label; tolerates a trailing count badge ("Tickets 3 pending"). */
export function navLink(page: Page, label: string) {
  return page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: new RegExp(`^${escapeRe(label)}(\\s*\\d.*)?$`) });
}

/** Sidebar navigation (desktop viewport). */
export async function navTo(page: Page, label: string) {
  await navLink(page, label).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
