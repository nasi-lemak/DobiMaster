import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../../config.js';
import type { DB } from '../../db/index.js';
import { shortToken } from '../../lib/ids.js';

/**
 * WhatsApp "notify me" channel.
 *
 * Cost model: the *customer* starts the conversation (a wa.me link with a pre-filled code), which opens
 * WhatsApp's 24-hour customer-service window. Free-form replies inside that window are not billed as
 * templates, so laundry alerts (< 24 h after linking) cost ~nothing. Outside the window we only send
 * approved templates when one is configured (e.g. the owner digest) — otherwise we skip and log it.
 */

export const SERVICE_WINDOW_MS = 24 * 3600_000;
/** Don't cut it fine — WhatsApp rejects free-form messages even seconds after the window closes. */
const WINDOW_SAFETY_MS = 10 * 60_000;
const CODE_TTL_MS = 30 * 60_000;
const CODE_RE = /DOBI[-\s]?([A-Z0-9]{6})/i;

export interface WaSendResult {
  providerMessageId?: string;
}

export interface WhatsAppTransport {
  mode: 'cloud' | 'mock';
  sendText(to: string, body: string): Promise<WaSendResult>;
  sendTemplate(to: string, template: string, language: string, params: string[]): Promise<WaSendResult>;
}

/** Meta WhatsApp Cloud API. */
export class CloudApiTransport implements WhatsAppTransport {
  mode = 'cloud' as const;
  private base = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;

  private async post(payload: Record<string, unknown>): Promise<WaSendResult> {
    const res = await fetch(this.base, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.whatsapp.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string } };
    if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${data.error?.message ?? 'unknown error'}`);
    return { providerMessageId: data.messages?.[0]?.id };
  }

  sendText(to: string, body: string) {
    return this.post({ to, type: 'text', text: { body, preview_url: true } });
  }

  sendTemplate(to: string, template: string, language: string, params: string[]) {
    return this.post({
      to,
      type: 'template',
      template: { name: template, language: { code: language }, components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] },
    });
  }
}

export class MockWhatsAppTransport implements WhatsAppTransport {
  mode = 'mock' as const;
  sent: Array<{ to: string; body?: string; template?: string; params?: string[] }> = [];
  async sendText(to: string, body: string) {
    this.sent.push({ to, body });
    return { providerMessageId: `mock-${this.sent.length}` };
  }
  async sendTemplate(to: string, template: string, _language: string, params: string[]) {
    this.sent.push({ to, template, params });
    return { providerMessageId: `mock-${this.sent.length}` };
  }
}

export function createWhatsAppTransport(): WhatsAppTransport {
  return config.whatsapp.token && config.whatsapp.phoneNumberId ? new CloudApiTransport() : new MockWhatsAppTransport();
}

/** Verify Meta's X-Hub-Signature-256 over the raw body. */
export function verifyWebhookSignature(rawBody: string, header: string | undefined): boolean {
  if (!config.whatsapp.appSecret) return false;
  const expected = 'sha256=' + createHmac('sha256', config.whatsapp.appSecret).update(rawBody).digest('hex');
  // Compare bytes, not characters: a non-ASCII header has a different byte length and would make timingSafeEqual throw.
  const got = Buffer.from(header ?? '');
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}

type Loc = 'en' | 'ms' | 'zh';
const L = (locale: string): Loc => (locale === 'ms' || locale === 'zh' ? locale : 'en');

const replies = {
  linked: {
    en: (what: string) => `✅ Linked! We'll message you here ${what}. Reply STOP any time to stop.`,
    ms: (what: string) => `✅ Berjaya! Kami akan mesej anda di sini ${what}. Balas STOP bila-bila masa untuk berhenti.`,
    zh: (what: string) => `✅ 已绑定！我们会在这里通知你${what}。随时回复 STOP 即可停止。`,
  },
  linkedWhat: {
    en: (m: string, s: string) => `when ${m} at ${s} is almost done and when it's finished`,
    ms: (m: string, s: string) => `apabila ${m} di ${s} hampir siap dan bila sudah siap`,
    zh: (m: string, s: string) => `${s} 的 ${m} 快完成和完成时`,
  },
  linkedGeneric: { en: 'about your laundry', ms: 'tentang dobi anda', zh: '洗衣进度' },
  linkedOwner: { en: 'with shop alerts and your weekly summary', ms: 'dengan amaran kedai dan ringkasan mingguan', zh: '店铺提醒和每周摘要' },
  expired: {
    en: 'That code has expired. Open the DobiMaster page again and tap “Notify me on WhatsApp”.',
    ms: 'Kod itu sudah tamat tempoh. Buka semula halaman DobiMaster dan tekan “Beritahu saya di WhatsApp”.',
    zh: '该代码已过期。请重新打开 DobiMaster 页面，点击“通过 WhatsApp 通知我”。',
  },
  stopped: {
    en: 'You won’t get any more messages from us. Reply START to turn them back on.',
    ms: 'Anda tidak akan menerima mesej lagi. Balas START untuk hidupkan semula.',
    zh: '你将不再收到我们的消息。回复 START 可重新开启。',
  },
  started: { en: 'Messages are back on. 👍', ms: 'Mesej dihidupkan semula. 👍', zh: '已重新开启消息。👍' },
  help: {
    en: 'Hi! This number sends laundry alerts from DobiMaster. To get alerts, scan the QR on a machine and tap “Notify me on WhatsApp”. For problems with a machine, use “Report a problem” on the same page.',
    ms: 'Hai! Nombor ini menghantar notifikasi dobi daripada DobiMaster. Imbas QR pada mesin dan tekan “Beritahu saya di WhatsApp”. Untuk masalah mesin, guna “Lapor masalah” di halaman yang sama.',
    zh: '你好！此号码发送 DobiMaster 洗衣提醒。扫描机器上的二维码并点击“通过 WhatsApp 通知我”即可。机器有问题请在同一页面点击“报告问题”。',
  },
};

export class WhatsAppService {
  constructor(
    private db: DB,
    public transport: WhatsAppTransport,
    private log: FastifyBaseLogger,
    private now: () => Date,
  ) {}

  /**
   * cloud = real WhatsApp; mock = development (dev inbound endpoint + "simulate" button);
   * disabled = production without WhatsApp credentials — the feature is hidden, never faked.
   */
  get mode(): 'cloud' | 'mock' | 'disabled' {
    if (this.transport.mode === 'cloud') return 'cloud';
    return config.isProd ? 'disabled' : 'mock';
  }

  /** Create a one-time code and the wa.me link that pre-fills it. */
  async createLink(input: { customerId?: string; userId?: string; cycleId?: string | null; locale: string }) {
    const code = shortToken(6).toUpperCase();
    await this.db
      .insertInto('wa_link_codes')
      .values({
        code,
        customer_id: input.customerId ?? null,
        user_id: input.userId ?? null,
        cycle_id: input.cycleId ?? null,
        locale: L(input.locale),
        expires_at: new Date(this.now().getTime() + CODE_TTL_MS),
      })
      .execute();
    const prefill = { en: 'Send this message to get alerts', ms: 'Hantar mesej ini untuk dapat notifikasi', zh: '发送此消息以接收提醒' }[L(input.locale)];
    const text = `DOBI-${code} — ${prefill}`;
    return { code, url: `https://wa.me/${config.whatsapp.number}?text=${encodeURIComponent(text)}`, mode: this.mode };
  }

  async contactFor(owner: { customerId?: string; userId?: string }) {
    let q = this.db.selectFrom('wa_contacts').selectAll();
    q = owner.customerId ? q.where('customer_id', '=', owner.customerId) : q.where('user_id', '=', owner.userId ?? '');
    return q.orderBy('last_inbound_at', 'desc').executeTakeFirst();
  }

  windowOpen(lastInbound: Date) {
    return this.now().getTime() - lastInbound.getTime() < SERVICE_WINDOW_MS - WINDOW_SAFETY_MS;
  }

  /** Free-form message, only inside the service window. Never throws — alerts must not break callers. */
  async sendInWindow(owner: { customerId?: string; userId?: string }, body: string): Promise<'sent' | 'skipped' | 'none' | 'error'> {
    const c = await this.contactFor(owner);
    if (!c) return 'none';
    if (c.opted_out) return 'skipped';
    if (!this.windowOpen(c.last_inbound_at)) {
      await this.logMessage('out', c.wa_id, 'skipped_window', body);
      return 'skipped';
    }
    try {
      const r = await this.transport.sendText(c.wa_id, body);
      await this.logMessage('out', c.wa_id, 'text', body, r.providerMessageId);
      return 'sent';
    } catch (err) {
      this.log.warn({ err }, 'whatsapp send failed');
      await this.logMessage('out', c.wa_id, 'error', body, undefined, String((err as Error).message));
      return 'error';
    }
  }

  /** Billed template message (used for the weekly owner digest when a template is configured). */
  async sendTemplate(owner: { userId: string }, template: string, params: string[]): Promise<'sent' | 'none' | 'error'> {
    const c = await this.contactFor(owner);
    if (!c || c.opted_out) return 'none';
    try {
      const r = await this.transport.sendTemplate(c.wa_id, template, c.locale === 'zh' ? 'zh_CN' : c.locale, params);
      await this.logMessage('out', c.wa_id, 'template', params.join(' | '), r.providerMessageId, undefined, template);
      return 'sent';
    } catch (err) {
      this.log.warn({ err }, 'whatsapp template failed');
      await this.logMessage('out', c.wa_id, 'error', null, undefined, String((err as Error).message), template);
      return 'error';
    }
  }

  /** Handle an inbound message: link codes, STOP/START, otherwise a short help text. */
  async handleInbound(msg: { from: string; text: string; receivedAt?: Date }) {
    const now = msg.receivedAt ?? this.now();
    const text = msg.text.trim();
    await this.logMessage('in', msg.from, 'text', text.slice(0, 500));
    const existing = await this.db.selectFrom('wa_contacts').selectAll().where('wa_id', '=', msg.from).executeTakeFirst();
    if (existing) await this.db.updateTable('wa_contacts').set({ last_inbound_at: now }).where('id', '=', existing.id).execute();
    const locale = L(existing?.locale ?? 'en');

    if (/^(stop|berhenti|停止|unsubscribe)$/i.test(text)) {
      if (existing) await this.db.updateTable('wa_contacts').set({ opted_out: true }).where('id', '=', existing.id).execute();
      await this.reply(msg.from, replies.stopped[locale]);
      return { action: 'stopped' as const };
    }
    if (/^(start|mula|开始)$/i.test(text)) {
      if (existing) await this.db.updateTable('wa_contacts').set({ opted_out: false }).where('id', '=', existing.id).execute();
      await this.reply(msg.from, replies.started[locale]);
      return { action: 'started' as const };
    }

    const m = text.match(CODE_RE);
    if (!m) {
      await this.reply(msg.from, replies.help[locale]);
      return { action: 'help' as const };
    }
    const code = m[1]!.toUpperCase();
    const link = await this.db
      .updateTable('wa_link_codes')
      .set({ used_at: now })
      .where('code', '=', code)
      .where('used_at', 'is', null)
      .where('expires_at', '>', now)
      .returningAll()
      .executeTakeFirst();
    if (!link) {
      await this.reply(msg.from, replies.expired[locale]);
      return { action: 'expired' as const };
    }
    const lc = L(link.locale);
    await this.db
      .insertInto('wa_contacts')
      .values({ wa_id: msg.from, customer_id: link.customer_id, user_id: link.user_id, locale: lc, last_inbound_at: now, opted_out: false })
      .onConflict((oc) =>
        oc.column('wa_id').doUpdateSet({
          // A number can be linked to one guest device and one owner account at the same time.
          ...(link.customer_id ? { customer_id: link.customer_id } : {}),
          ...(link.user_id ? { user_id: link.user_id } : {}),
          locale: lc,
          last_inbound_at: now,
          opted_out: false,
        }),
      )
      .execute();

    let what = replies.linkedGeneric[lc];
    if (link.user_id) what = replies.linkedOwner[lc];
    else if (link.cycle_id) {
      const c = await this.db
        .selectFrom('cycles as c')
        .innerJoin('machines as m', 'm.id', 'c.machine_id')
        .innerJoin('shops as s', 's.id', 'c.shop_id')
        .select(['m.code', 's.name'])
        .where('c.id', '=', link.cycle_id)
        .executeTakeFirst();
      if (c) what = replies.linkedWhat[lc](c.code, c.name);
    }
    await this.reply(msg.from, replies.linked[lc](what));
    return { action: 'linked' as const, customerId: link.customer_id, userId: link.user_id };
  }

  private async reply(to: string, body: string) {
    try {
      const r = await this.transport.sendText(to, body);
      await this.logMessage('out', to, 'text', body, r.providerMessageId);
    } catch (err) {
      this.log.warn({ err }, 'whatsapp reply failed');
    }
  }

  private async logMessage(direction: 'in' | 'out', waId: string, kind: string, body: string | null, providerMessageId?: string, error?: string, template?: string) {
    await this.db
      .insertInto('wa_messages')
      .values({ direction, wa_id: waId, kind, body, provider_message_id: providerMessageId ?? null, error: error ?? null, template: template ?? null, created_at: this.now() })
      .execute();
  }
}

/** Extract text messages from a Cloud API webhook payload. */
export function parseCloudWebhook(payload: unknown): Array<{ from: string; text: string; receivedAt: Date }> {
  const out: Array<{ from: string; text: string; receivedAt: Date }> = [];
  const entries = (payload as { entry?: Array<{ changes?: Array<{ value?: { messages?: Array<Record<string, any>> } }> }> })?.entry ?? [];
  for (const e of entries) {
    for (const ch of e.changes ?? []) {
      for (const m of ch.value?.messages ?? []) {
        const text = m.type === 'text' ? m.text?.body : m.type === 'button' ? m.button?.text : m.type === 'interactive' ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title) : null;
        if (typeof m.from === 'string' && typeof text === 'string') {
          out.push({ from: m.from, text, receivedAt: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date() });
        }
      }
    }
  }
  return out;
}
