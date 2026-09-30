import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../../config.js';
import { unauthorized } from '../../lib/errors.js';

export interface CreateChargeInput {
  paymentId: string;
  amountSen: number;
  description: string;
  /** Where the gateway sends the customer back after paying. */
  returnUrl: string;
}

export interface GatewayEvent {
  eventId: string;
  type: 'payment.succeeded' | 'payment.failed' | 'refund.succeeded' | 'refund.failed';
  paymentId: string;
  providerRef: string;
  raw: unknown;
}

/**
 * One adapter per gateway (CHIP, HitPay, Curlec, Fiuu…). Real adapters must verify signatures in
 * parseWebhook and pass an idempotency key to refunds. Funds settle directly to the shop owner's
 * merchant account — the platform never holds customer money.
 */
export interface PaymentGateway {
  name: string;
  createCharge(input: CreateChargeInput): Promise<{ providerRef: string; redirectUrl: string }>;
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): GatewayEvent;
  refund(input: { paymentId: string; providerRef: string; amountSen: number; idempotencyKey: string }): Promise<{ status: 'succeeded' | 'pending'; refundRef: string }>;
  getStatus(providerRef: string): Promise<'pending' | 'succeeded' | 'failed'>;
}

/**
 * Mock gateway for development and demos. The "hosted payment page" is our own /pay/mock/:id screen,
 * which asks the API to emit a signed webhook — exercising the same verification path as a real gateway.
 */
export class MockGateway implements PaymentGateway {
  name = 'mock';
  private secret = createHmac('sha256', config.jwtSecret).update('mock-gateway').digest('hex');
  /** Stored outcomes so getStatus() can answer reconciliation queries. */
  private outcomes = new Map<string, 'pending' | 'succeeded' | 'failed'>();
  refunds: Array<{ paymentId: string; amountSen: number; idempotencyKey: string }> = [];
  failRefunds = false;

  async createCharge(input: CreateChargeInput) {
    const providerRef = `mock_${input.paymentId.slice(0, 8)}_${Date.now().toString(36)}`;
    this.outcomes.set(providerRef, 'pending');
    return { providerRef, redirectUrl: `${config.publicUrl}/pay/mock/${input.paymentId}` };
  }

  sign(body: string) {
    return createHmac('sha256', this.secret).update(body).digest('hex');
  }

  /** Build the webhook a real gateway would send. */
  buildWebhook(paymentId: string, providerRef: string, outcome: 'succeeded' | 'failed') {
    this.outcomes.set(providerRef, outcome);
    const body = JSON.stringify({ id: `evt_${randomUUID()}`, type: `payment.${outcome}`, paymentId, providerRef });
    return { body, signature: this.sign(body) };
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): GatewayEvent {
    const sig = String(headers['x-mock-signature'] ?? '');
    const expected = this.sign(rawBody);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      throw unauthorized('Invalid webhook signature');
    }
    const b = JSON.parse(rawBody) as { id: string; type: GatewayEvent['type']; paymentId: string; providerRef: string };
    return { eventId: b.id, type: b.type, paymentId: b.paymentId, providerRef: b.providerRef, raw: b };
  }

  async refund(input: { paymentId: string; providerRef: string; amountSen: number; idempotencyKey: string }) {
    if (this.failRefunds) throw new Error('mock gateway refund failure');
    if (!this.refunds.some((r) => r.idempotencyKey === input.idempotencyKey)) this.refunds.push(input);
    return { status: 'succeeded' as const, refundRef: `mockrf_${input.idempotencyKey.slice(-8)}` };
  }

  async getStatus(providerRef: string) {
    return this.outcomes.get(providerRef) ?? 'pending';
  }
}

export function createGateway(name = config.paymentProvider): PaymentGateway {
  switch (name) {
    case 'mock':
      return new MockGateway();
    default:
      throw new Error(`Payment provider "${name}" is not implemented yet — see docs/03-architecture.md §11`);
  }
}
