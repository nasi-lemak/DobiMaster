import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, uuid } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { ago, clock, rm } from '../lib/format';
import { enableCustomerPush, pushSupport } from '../lib/push';
import { useChannels } from '../lib/realtime';
import { Button, Card, ErrorBox, PageLoader, cx } from '../components/ui';
import { MachineStateBadge } from './components';
import { useMyCycles } from './Layout';
import { useNow } from './useNow';
import type { Cycle, MachineResponse, Payment } from './types';

type Sheet = null | 'timer' | 'pay';

export function MachinePage() {
  const { qr } = useParams();
  const { t, tx, locale } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const now = useNow(10_000);
  const q = useQuery({ queryKey: ['machine', qr], queryFn: () => api.get<MachineResponse>(`/public/machines/${qr}`), refetchInterval: 30_000 });
  const my = useMyCycles();
  useChannels([q.data ? `shop:${q.data.shop.id}` : null], (e) => e.data?.machineId === q.data?.machine.id && q.refetch(), () => q.refetch());

  const [sheet, setSheet] = useState<Sheet>(null);
  const [programId, setProgramId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inUse, setInUse] = useState<{ expectedEndAt: string; sensorConfirmed: boolean } | null>(null);
  // One id per attempt: retries after a network blip are idempotent on the server.
  const [attemptId, setAttemptId] = useState(() => uuid());

  if (q.isLoading) return <PageLoader />;
  if (q.error) {
    const nf = q.error instanceof ApiError && q.error.status === 404;
    return <ErrorBox message={nf ? t('machineNotFound') : t('error')} onRetry={nf ? undefined : () => q.refetch()} retryLabel={t('retry')} />;
  }
  const { machine: m, shop } = q.data!;
  const mine = my.data?.cycles.find((c) => c.machineId === m.id && (c.status === 'running' || c.status === 'finished'));
  const program = m.programs.find((p) => p.id === programId) ?? m.programs[0]!;
  const unusable = ['fault', 'maintenance', 'disabled'].includes(m.state);
  const typeLabel = m.type === 'washer' ? t('washer') : t('dryer');

  async function startTimer(force = false) {
    setBusy(true);
    setError(null);
    try {
      // Ask for notification permission now — the user can see why.
      await enableCustomerPush(locale).catch(() => false);
      await api.post<{ cycle: Cycle }>('/public/cycles', { id: attemptId, qrToken: m.qrToken, programId: program.id, force }, { guest: true });
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/me');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'machine_in_use') {
        setInUse(e.details as { expectedEndAt: string; sensorConfirmed: boolean });
        setAttemptId(uuid());
      } else setError(e instanceof ApiError ? e.message : t('offline'));
    } finally {
      setBusy(false);
    }
  }

  async function payAndStart() {
    setBusy(true);
    setError(null);
    try {
      await enableCustomerPush(locale).catch(() => false);
      const res = await api.post<{ payment: Payment; redirectUrl: string }>('/public/payments', { qrToken: m.qrToken, programId: program.id }, { guest: true, headers: { 'Idempotency-Key': attemptId } });
      const url = new URL(res.redirectUrl, location.origin);
      if (url.origin === location.origin) navigate(url.pathname);
      else location.assign(res.redirectUrl);
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 409 ? t('pay.unavailable') : e.message) : t('offline'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pb-48">
      <Link to={`/s/${shop.slug}`} className="text-sm text-muted">
        ← {shop.name}
      </Link>

      <section className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            {typeLabel} · {t('capacity', { kg: m.capacityKg })}
          </p>
          <h1 className="text-3xl font-bold tracking-tight">{m.code}</h1>
        </div>
        <div className="text-right">
          <MachineStateBadge m={m} now={now} />
          <p className="mt-1 text-[11px] text-muted">{t(`source.${m.stateSource}`)}</p>
        </div>
      </section>

      {mine && (
        <Link to="/me" className="block rounded-2xl bg-brand-soft p-4 text-info-ink">
          <p className="font-semibold">{mine.status === 'finished' ? `✅ ${t('done')}` : `⏱ ${t('activeNow')}`}</p>
          <p className="text-sm">{mine.status === 'finished' ? t('doneBody') : t('minLeft', { min: Math.max(0, Math.ceil((new Date(mine.expectedEndAt).getTime() - now) / 60_000)) })}</p>
        </Link>
      )}

      {unusable && (
        <div role="alert" className="rounded-2xl bg-critical/10 p-4 text-sm text-critical-ink">
          <p className="font-semibold">{t(`state.${m.state}`)}</p>
          {m.stateReason && <p>{t('maintenanceReason', { reason: m.stateReason })}</p>}
        </div>
      )}
      {m.state === 'finished' && (
        <div className="rounded-2xl bg-warning/15 p-4 text-sm text-warning-ink">
          <p>{t('finishedPolicy', { ago: ago(m.stateSince, now) })}</p>
          {tx(shop.policy) && <p className="mt-1">{tx(shop.policy)}</p>}
        </div>
      )}
      {m.openIssues > 0 && m.state !== 'fault' && (
        <p className="rounded-xl bg-serious/10 px-3 py-2 text-sm text-serious-ink">⚠ {t(m.openIssues === 1 ? 'reportedIssue' : 'reportedIssues', { n: m.openIssues })}</p>
      )}

      <Card className="divide-y divide-line">
        {tx(m.recommendedLoad) && (
          <div className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('recommendedLoad')}</p>
            <p className="mt-1">{tx(m.recommendedLoad)}</p>
          </div>
        )}
        {m.type === 'washer' && (
          <div className="space-y-1 p-4 text-sm">
            <p className={m.detergentAuto ? 'text-good-ink' : 'text-ink-2'}>🧴 {m.detergentAuto ? t('detergentAuto') : t('detergentOwn')}</p>
            {m.softenerAuto && <p className="text-good-ink">🌸 {t('softenerAuto')}</p>}
          </div>
        )}
        <div className="p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{t('programs')}</p>
          <ul className="space-y-1">
            {m.programs.map((p) => (
              <li key={p.id} className="flex justify-between text-sm">
                <span>
                  {tx(p.name)} <span className="text-muted">· {t('minutes', { min: p.durationMin })}</span>
                </span>
                <span className="font-medium tabular">{rm(p.priceSen)}</span>
              </li>
            ))}
          </ul>
        </div>
        {tx(m.instructions) && (
          <div className="p-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{t('howToUse')}</p>
            <p className="whitespace-pre-line text-sm leading-relaxed">{tx(m.instructions)}</p>
          </div>
        )}
      </Card>

      <Link to={`/m/${m.qrToken}/report`} className="block">
        <Button variant="secondary" block>
          ⚠ {t('reportProblem')}
        </Button>
      </Link>

      {/* Primary actions, thumb-reachable */}
      {!unusable && !mine && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 p-4 backdrop-blur">
          <div className="mx-auto max-w-xl space-y-2">
            {m.payable && m.state === 'available' && (
              <Button variant="secondary" block size="lg" onClick={() => setSheet('pay')}>
                💳 {t('payStart')}
              </Button>
            )}
            <Button block size="lg" onClick={() => setSheet('timer')}>
              ⏱ {t('startTimer')}
            </Button>
            <p className="text-center text-xs text-muted">{t('startTimerHint')}</p>
          </div>
        </div>
      )}

      {sheet && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={() => !busy && setSheet(null)}>
          <div className="mx-auto w-full max-w-xl rounded-t-3xl bg-surface p-5 pb-8" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            {inUse ? (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold">{t('inUseTitle')}</h2>
                {inUse.sensorConfirmed ? (
                  <p className="text-sm text-ink-2">{t('sensorBusy')}</p>
                ) : (
                  <>
                    <p className="text-sm text-ink-2">{t('inUseBody', { time: clock(inUse.expectedEndAt) })}</p>
                    <Button block disabled={busy} onClick={() => startTimer(true)}>
                      {t('inUseForce')}
                    </Button>
                  </>
                )}
                <Button variant="ghost" block onClick={() => { setInUse(null); setSheet(null); }}>
                  {t('back')}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">{sheet === 'pay' ? t('pay.title') : t('chooseProgram')}</h2>
                <div className="grid gap-2">
                  {m.programs.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setProgramId(p.id)}
                      aria-pressed={program.id === p.id}
                      className={cx('flex items-center justify-between rounded-xl border px-4 py-3 text-left', program.id === p.id ? 'border-brand bg-brand-soft' : 'border-line')}
                    >
                      <span className="font-medium">
                        {tx(p.name)} <span className="text-sm font-normal text-muted">· {t('minutes', { min: p.durationMin })}</span>
                      </span>
                      <span className="tabular">{rm(p.priceSen)}</span>
                    </button>
                  ))}
                </div>
                <NotificationNotice />
                {sheet === 'pay' && <p className="text-xs text-muted">{t('pay.method')}</p>}
                {error && <p className="text-sm text-critical-ink">{error}</p>}
                <Button block size="lg" disabled={busy} onClick={() => (sheet === 'pay' ? payAndStart() : startTimer())}>
                  {busy ? t('starting') : sheet === 'pay' ? t('pay.payNow', { amount: rm(program.priceSen) }) : t('confirmStart')}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function NotificationNotice() {
  const { t } = useI18n();
  const support = pushSupport();
  if (support === 'supported') return null;
  const msg = support === 'needs-install' ? t('notifIos') : support === 'denied' ? t('notifDenied') : t('notifUnsupported');
  return <p className="rounded-xl bg-surface-2 p-3 text-xs text-ink-2">🔔 {msg}</p>;
}
