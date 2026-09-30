import { config } from '../../config.js';
import type { PushPayload, PushService } from '../push/service.js';
import { renderPush, type PushTemplate } from '../push/messages.js';
import type { WhatsAppService } from '../whatsapp/service.js';

/**
 * One place that decides how to reach people. Customers get web push on every subscribed device and,
 * if they linked WhatsApp, a WhatsApp message (inside the free 24 h window only). Owners get web push;
 * their weekly summary goes by email/WhatsApp through the digest module.
 */
export class Notifier {
  constructor(
    public push: PushService,
    public whatsapp: WhatsAppService,
  ) {}

  async toCustomer(customerId: string, template: PushTemplate, vars: Record<string, string | number>, extra: Omit<PushPayload, 'title' | 'body'> = {}) {
    const pushed = await this.push.toCustomer(customerId, template, vars, extra);
    const contact = await this.whatsapp.contactFor({ customerId });
    let whatsapp: string = 'none';
    if (contact) {
      const msg = renderPush(template, contact.locale, vars);
      const link = extra.url ? `\n${config.publicUrl.replace(/\/$/, '')}${extra.url}` : '';
      whatsapp = await this.whatsapp.sendInWindow({ customerId }, `*${msg.title}*\n${msg.body}${link}`);
    }
    return { pushed, whatsapp };
  }

  toTenant(tenantId: string, payload: PushPayload, shopId?: string) {
    return this.push.toTenant(tenantId, payload, shopId);
  }
}
