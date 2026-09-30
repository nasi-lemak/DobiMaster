import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { dateTime, rm } from '../lib/format';
import { Button, Card, ErrorBox, PageLoader, Spinner } from '../components/ui';
import type { Cycle, Payment } from './types';

interface PaymentView {
  payment: Payment;
  machine: { code: string; qrToken: string; type: string };
  shopName: string;
  cycle: Cycle | null;
}

/** Return page after the gateway: follows payment → start confirmation → (auto-refund) live. */
export function PaymentPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ['payment', id],
    queryFn: () => api.get<PaymentView>(`/public/payments/${id}`, { guest: true }),
    refetchInterval: (query) => {
      const d = query.state.data;
      const settled = d && (['failed', 'expired', 'refunded'].includes(d.payment.status) || d.cycle?.sensorConfirmed || d.cycle?.status === 'finished' || d.cycle?.status === 'collected');
      return settled ? false : 2000;
    },
  });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox message={t('error')} onRetry={() => q.refetch()} retryLabel={t('retry')} />;
  const { payment: p, machine, shopName, cycle } = q.data!;
  const amount = rm(p.amountSen);

  let icon = '⏳';
  let msg = t('pay.waiting');
  if (p.status === 'failed') [icon, msg] = ['✕', t('pay.failed')];
  else if (p.status === 'expired') [icon, msg] = ['⌛', t('pay.expired')];
  else if (p.status === 'refund_pending') [icon, msg] = ['↩', t('pay.refunding', { amount })];
  else if (p.status === 'refunded') [icon, msg] = ['↩', t('pay.refunded', { amount: rm(p.refundedSen) })];
  else if (p.status === 'succeeded') [icon, msg] = cycle?.sensorConfirmed ? ['✅', t('pay.running')] : ['⏳', t('pay.startingMachine')];

  const spinning = icon === '⏳';
  return (
    <div className="space-y-4 py-4">
      <div className="text-center">
        <div className="mb-2 text-4xl">{spinning ? <Spinner className="h-10 w-10 text-brand" /> : icon}</div>
        <p className="text-lg font-semibold" aria-live="polite">
          {msg}
        </p>
      </div>
      <Card className="divide-y divide-line text-sm">
        <div className="flex justify-between p-3">
          <span className="text-muted">{t('pay.receipt')}</span>
          <span className="font-mono text-xs">{p.id.slice(0, 8).toUpperCase()}</span>
        </div>
        <div className="flex justify-between p-3">
          <span>
            {machine.code} · {shopName}
          </span>
          <span className="font-semibold tabular">{amount}</span>
        </div>
        <div className="flex justify-between p-3 text-muted">
          <span>{dateTime(p.createdAt)}</span>
          <span>{p.provider.toUpperCase()}</span>
        </div>
      </Card>
      <div className="flex justify-center gap-2">
        {cycle?.sensorConfirmed && (
          <Link to="/me">
            <Button>{t('myLaundry')}</Button>
          </Link>
        )}
        <Link to={`/m/${machine.qrToken}`}>
          <Button variant="secondary">{t('back')}</Button>
        </Link>
      </div>
    </div>
  );
}

/**
 * Stand-in for a real gateway's hosted page (CHIP / HitPay / Curlec DuitNow QR, FPX, cards).
 * Only exists while PAYMENT_PROVIDER=mock.
 */
export function MockGatewayPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['payment', id], queryFn: () => api.get<PaymentView>(`/public/payments/${id}`, { guest: true }) });
  const [busy, setBusy] = useState(false);
  const complete = async (outcome: 'succeeded' | 'failed') => {
    setBusy(true);
    await api.post(`/public/payments/${id}/mock-complete`, { outcome }, { guest: true }).catch(() => {});
    navigate(`/pay/${id}`, { replace: true });
  };
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
      <p className="text-center text-xs uppercase tracking-widest text-muted">Mock payment gateway (dev)</p>
      <Card className="space-y-3 p-5 text-center">
        <p className="text-sm text-muted">DuitNow QR · FPX · Card · E-wallet</p>
        <p className="text-3xl font-bold tabular">{q.data ? rm(q.data.payment.amountSen) : '…'}</p>
        <p className="text-sm">{q.data ? `${q.data.shopName} · ${q.data.machine.code}` : ''}</p>
        <Button block size="lg" disabled={busy || !q.data} onClick={() => complete('succeeded')}>
          Approve payment
        </Button>
        <Button block variant="secondary" disabled={busy || !q.data} onClick={() => complete('failed')}>
          Decline
        </Button>
      </Card>
    </div>
  );
}
