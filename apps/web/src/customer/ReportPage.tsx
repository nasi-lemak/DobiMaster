import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MONEY_CATEGORIES, TICKET_CATEGORIES, type TicketCategory } from '@dobi/shared';
import { api, ApiError, uuid } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Button, Card, Field, inputClass, cx } from '../components/ui';
import type { MachineResponse } from './types';

const ICONS: Record<TicketCategory, string> = {
  not_starting: '⏻',
  payment_no_start: '💳',
  coin_jammed: '🪙',
  dirty_machine: '🧽',
  water_leak: '💧',
  not_drying: '🌬️',
  damaged: '🔧',
  abandoned_clothing: '👕',
  cleanliness: '🧹',
  other: '❓',
};
const MACHINE_ONLY: TicketCategory[] = ['not_starting', 'payment_no_start', 'coin_jammed', 'dirty_machine', 'water_leak', 'not_drying', 'damaged', 'abandoned_clothing'];

export function ReportPage() {
  const { qr, slug } = useParams();
  const { t } = useI18n();
  const machine = useQuery({ queryKey: ['machine', qr], queryFn: () => api.get<MachineResponse>(`/public/machines/${qr}`), enabled: !!qr });
  const [category, setCategory] = useState<TicketCategory | null>(null);
  const [details, setDetails] = useState('');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ref: string } | null>(null);
  const [reportId] = useState(() => uuid()); // idempotent: resubmitting after a network error never duplicates

  const categories = TICKET_CATEGORIES.filter((c) => (qr ? true : !MACHINE_ONLY.includes(c)));
  const m = machine.data?.machine;
  const backTo = qr ? `/m/${qr}` : `/s/${slug}`;
  const money = category && MONEY_CATEGORIES.includes(category);

  async function submit() {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ ticket: { ref: string } }>(
        '/public/reports',
        {
          id: reportId,
          qrToken: qr,
          shopSlug: qr ? undefined : slug,
          category,
          details: details.trim() || null,
          amountClaimedSen: money && amount ? Math.round(Number(amount) * 100) : null,
          contactPhone: money && phone.trim() ? phone.trim() : null,
        },
        { guest: true },
      );
      setDone(res.ticket);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('offline'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4 py-6 text-center">
        <p className="text-4xl">✅</p>
        <h1 className="text-xl font-semibold">{t('reportSent')}</h1>
        <p className="text-sm text-ink-2">{t('reportRef', { ref: done.ref })}</p>
        <div className="flex justify-center gap-2">
          <Link to="/me">
            <Button variant="secondary">{t('myReports')}</Button>
          </Link>
          <Link to={backTo}>
            <Button variant="ghost">{t('back')}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link to={backTo} className="text-sm text-muted">
        ← {t('back')}
      </Link>
      <h1 className="text-xl font-semibold">
        {t('reportTitle')} {m && <span className="text-muted">· {m.code}</span>}
      </h1>
      <div className="grid grid-cols-2 gap-2">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            aria-pressed={category === c}
            className={cx('flex min-h-20 flex-col items-start justify-between rounded-2xl border p-3 text-left text-sm font-medium', category === c ? 'border-brand bg-brand-soft' : 'border-line bg-surface')}
          >
            <span aria-hidden className="text-xl">
              {ICONS[c]}
            </span>
            {t(`category.${c}`)}
          </button>
        ))}
      </div>
      {category && (
        <Card className="space-y-3 p-4">
          <Field label={t('details')}>
            <textarea className={inputClass} rows={3} maxLength={2000} placeholder={t('detailsPh')} value={details} onChange={(e) => setDetails(e.target.value)} />
          </Field>
          {money && (
            <>
              <Field label={t('amountLost')}>
                <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="5.00" />
              </Field>
              <Field label={t('refundPhone')} hint={t('refundPhoneHint')}>
                <input className={inputClass} type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="012-345 6789" />
              </Field>
            </>
          )}
          {error && <p className="text-sm text-critical-ink">{error}</p>}
          <Button block size="lg" disabled={busy} onClick={submit}>
            {busy ? t('sending') : t('send')}
          </Button>
        </Card>
      )}
    </div>
  );
}
