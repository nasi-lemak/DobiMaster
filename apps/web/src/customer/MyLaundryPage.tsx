import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, getGuestToken } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { dateTime, rm } from '../lib/format';
import { enableCustomerPush, pushSupport } from '../lib/push';
import { useChannels } from '../lib/realtime';
import { Button, Card, EmptyState, PageLoader, Pill } from '../components/ui';
import { useMyCycles } from './Layout';
import { NotificationNotice } from './MachinePage';
import { WhatsAppCard } from './WhatsAppCard';
import { useNow } from './useNow';
import type { MyCycle } from './types';

function Countdown({ c, now }: { c: MyCycle; now: number }) {
  const ms = Math.max(0, new Date(c.expectedEndAt).getTime() - now);
  const total = c.durationMin * 60_000;
  const progress = Math.min(1, 1 - ms / total);
  const mm = Math.floor(ms / 60_000);
  const ss = Math.floor((ms % 60_000) / 1000);
  return (
    <div>
      <p className="text-5xl font-bold tabular tracking-tight" aria-live="polite">
        {mm}:{String(ss).padStart(2, '0')}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-series-1 transition-[width]" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}

export function MyLaundryPage() {
  const { t, tx, locale } = useI18n();
  const qc = useQueryClient();
  const now = useNow(1000);
  const my = useMyCycles();
  const reports = useQuery({
    queryKey: ['me', 'reports'],
    queryFn: () => api.get<{ reports: Array<{ id: string; ref: string; title: string; status: string; category: string; shopName: string; createdAt: string }> }>('/public/me/reports', { guest: true }),
    enabled: !!getGuestToken(),
  });
  const [customerId] = useState(() => {
    try {
      return JSON.parse(atob((getGuestToken() ?? '').split('.')[1] ?? '')).sub as string;
    } catch {
      return null;
    }
  });
  useChannels([customerId ? `customer:${customerId}` : null], () => qc.invalidateQueries({ queryKey: ['me'] }), () => qc.invalidateQueries({ queryKey: ['me'] }));
  const [notifOn, setNotifOn] = useState(() => pushSupport() === 'supported' && typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(c: MyCycle, action: 'collected' | 'cancel') {
    setBusyId(c.id);
    setError(null);
    try {
      await api.post(`/public/cycles/${c.id}/${action}`, {}, { guest: true });
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('offline'));
    } finally {
      setBusyId(null);
    }
  }

  if (!getGuestToken()) return <EmptyState title={t('noActive')} />;
  if (my.isLoading) return <PageLoader />;
  const cycles = my.data?.cycles ?? [];
  const active = cycles.filter((c) => c.status === 'running' || c.status === 'finished');
  const past = cycles.filter((c) => !active.includes(c)).slice(0, 10);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('myLaundry')}</h1>

      {active.length === 0 && <EmptyState title={t('noActive')} />}
      {active.map((c) => {
        const finished = c.status === 'finished' || new Date(c.expectedEndAt).getTime() <= now;
        return (
          <Card key={c.id} className={finished ? 'border-warning p-5' : 'p-5'}>
            <div className="mb-3 flex items-baseline justify-between">
              <Link to={`/m/${c.qrToken}`} className="font-semibold">
                {c.machineCode} <span className="font-normal text-muted">· {c.shopName}</span>
              </Link>
              <span className="text-xs text-muted">{c.programLabel ? tx(c.programLabel) : c.programName}</span>
            </div>
            {finished ? (
              <div>
                <p className="text-3xl font-bold">✅ {t('done')}</p>
                <p className="mt-1 text-sm text-ink-2">{t('doneBody')}</p>
              </div>
            ) : (
              <Countdown c={c} now={now} />
            )}
            {c.sensorConfirmed && <p className="mt-2 text-xs text-good-ink">● {t('source.sensor')}</p>}
            <div className="mt-4 grid gap-2">
              {(finished || !c.sensorConfirmed) && (
                <Button block size="lg" variant={finished ? 'primary' : 'secondary'} disabled={busyId === c.id} onClick={() => act(c, 'collected')}>
                  🧺 {t('collected')}
                </Button>
              )}
              <div className="flex gap-2">
                <Link to={`/m/${c.qrToken}/report`} className="flex-1">
                  <Button variant="ghost" block size="sm">
                    ⚠ {t('reportProblem')}
                  </Button>
                </Link>
                {!finished && (
                  <Button variant="ghost" size="sm" className="flex-1" disabled={busyId === c.id} onClick={() => act(c, 'cancel')}>
                    {t('cancelTimer')}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        );
      })}
      {error && <p className="text-sm text-critical-ink">{error}</p>}

      {active.length > 0 && (
        <Card className="p-4">
          <p className="font-medium">🔔 {t('notifTitle')}</p>
          {notifOn ? (
            <p className="mt-1 text-sm text-good-ink">{t('notifOn')}</p>
          ) : pushSupport() === 'supported' ? (
            <Button className="mt-2" size="sm" onClick={async () => setNotifOn(await enableCustomerPush(locale).catch(() => false))}>
              {t('enableNotif')}
            </Button>
          ) : (
            <div className="mt-2">
              <NotificationNotice />
            </div>
          )}
          <div className="mt-4 border-t border-line pt-4">
            <WhatsAppCard cycleId={active.find((c) => c.status === 'running')?.id} />
          </div>
        </Card>
      )}

      {(reports.data?.reports.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">{t('myReports')}</h2>
          <ul className="space-y-2">
            {reports.data!.reports.map((r) => (
              <li key={r.id}>
                <Card className="flex items-center justify-between gap-2 p-3 text-sm">
                  <div>
                    <p className="font-medium">
                      #{r.ref} · {t(`category.${r.category}`)}
                    </p>
                    <p className="text-xs text-muted">
                      {r.shopName} · {dateTime(r.createdAt)}
                    </p>
                  </div>
                  <Pill tone={r.status === 'resolved' ? 'good' : r.status === 'in_progress' ? 'info' : 'neutral'}>{t(`status.${r.status}`)}</Pill>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">{t('history')}</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {past.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>
                  {c.machineCode} · {c.shopName}
                  <span className="block text-xs text-muted">{dateTime(c.startedAt)}</span>
                </span>
                <span className="text-right">
                  {c.paymentId && c.priceSen != null && <span className="block tabular">{rm(c.priceSen)}</span>}
                  {c.paymentId && (
                    <Link to={`/pay/${c.paymentId}`} className="text-xs text-info-ink underline">
                      {t('pay.receipt')}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
