import { Link, useParams } from 'react-router';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, getGuestToken } from '../lib/api';
import { enableCustomerPush } from '../lib/push';
import { useI18n } from '../lib/i18n';
import { rm } from '../lib/format';
import { useChannels } from '../lib/realtime';
import { Card, ErrorBox, PageLoader, Pill, cx } from '../components/ui';
import { BusyChart, BusynessLabel, ConfidenceTag, MachineStateBadge } from './components';
import { useNow } from './useNow';
import type { PublicMachine, ShopDetail } from './types';

const DAY_KEYS = ['1', '2', '3', '4', '5', '6', '7'];
const DAY_NAMES: Record<string, string[]> = {
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  ms: ['Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab', 'Ahd'],
  zh: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
};

/** Group machines into classes customers actually choose between: "Washer 10 kg", "Washer 20 kg"… */
function classes(machines: PublicMachine[]) {
  const map = new Map<string, PublicMachine[]>();
  for (const m of machines) map.set(`${m.type}:${m.capacityKg}`, [...(map.get(`${m.type}:${m.capacityKg}`) ?? []), m]);
  return [...map.entries()].map(([key, ms]) => {
    const prices = ms.flatMap((m) => m.programs.map((p) => p.priceSen));
    const running = ms.filter((m) => m.state === 'running' && m.expectedEndAt).map((m) => new Date(m.expectedEndAt!).getTime());
    return {
      key,
      type: ms[0]!.type,
      kg: ms[0]!.capacityKg,
      total: ms.filter((m) => !['fault', 'maintenance', 'disabled'].includes(m.state)).length,
      free: ms.filter((m) => m.state === 'available').length,
      live: ms.every((m) => m.observed),
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      nextFree: running.length ? Math.min(...running) : null,
    };
  });
}

export function ShopPage() {
  const { slug } = useParams();
  const { t, tx, locale } = useI18n();
  const now = useNow();
  const q = useQuery({ queryKey: ['shop', slug], queryFn: () => api.get<ShopDetail>(`/public/shops/${slug}`), refetchInterval: 30_000 });
  useChannels([q.data ? `shop:${q.data.id}` : null], () => q.refetch(), () => q.refetch());

  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox message={q.error instanceof ApiError && q.error.status === 404 ? t('notFound') : t('error')} onRetry={() => q.refetch()} retryLabel={t('retry')} />;
  const s = q.data!;
  const confidence = s.availability.washers.confidence === s.availability.dryers.confidence ? s.availability.washers.confidence : 'mixed';
  const mapsUrl = s.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`;
  const wazeUrl = s.lat != null ? `https://waze.com/ul?ll=${s.lat},${s.lng}&navigate=yes` : null;
  const days = DAY_NAMES[locale] ?? DAY_NAMES.en!;

  return (
    <div className="space-y-4">
      <section>
        <h1 className="text-xl font-semibold">{s.name}</h1>
        <p className="text-sm text-muted">{s.address}</p>
        <p className="mt-1 text-sm">
          <span className={s.openNow ? 'text-good-ink' : 'text-critical-ink'}>● {s.openNow ? (s.open24h ? t('open24h') : t('openNow')) : t('closed')}</span>
          {s.openNow && s.closesAt && <span className="text-muted"> · {t('closesAt', { time: s.closesAt })}</span>}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={mapsUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium">
            🧭 {t('directions')}
          </a>
          {wazeUrl && (
            <a href={wazeUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium">
              Waze
            </a>
          )}
          {s.whatsapp && (
            <a href={`https://wa.me/${s.whatsapp.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer" className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium">
              💬 {t('whatsapp')}
            </a>
          )}
        </div>
      </section>

      {s.announcements.map((a) => (
        <div key={a.id} className={cx('rounded-2xl px-4 py-3 text-sm', a.level === 'warning' ? 'bg-warning/15 text-warning-ink' : 'bg-brand-soft text-info-ink')}>
          📢 {tx(a.message)}
        </div>
      ))}

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">{t('machines')}</h2>
          <ConfidenceTag confidence={confidence} />
        </div>
        <ul className="divide-y divide-line">
          {classes(s.machines).map((c) => (
            <li key={c.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <div>
                <p className="text-sm font-medium">
                  {c.type === 'washer' ? t('washer') : t('dryer')} · {t('capacity', { kg: c.kg })}
                </p>
                <p className="text-xs text-muted tabular">{c.minPrice === c.maxPrice ? rm(c.minPrice) : `${rm(c.minPrice)} – ${rm(c.maxPrice)}`}</p>
              </div>
              <div className="text-right">
                <p className={cx('text-sm font-semibold tabular', c.free === 0 ? 'text-critical-ink' : 'text-good-ink')}>{t('freeOf', { free: c.free, total: c.total })}</p>
                {c.free === 0 && c.nextFree && <p className="text-xs text-muted">{t('nextFreeIn', { min: Math.max(1, Math.ceil((c.nextFree - now) / 60_000)) })}</p>}
              </div>
              {c.free === 0 && c.live && <WatchButton shopSlug={s.slug} type={c.type} kg={c.kg} />}
            </li>
          ))}
        </ul>
        {confidence === 'checkins' && <p className="mt-2 text-xs text-muted">{t('checkinsHint')}</p>}
      </Card>

      <Card className="space-y-3 p-4">
        <BusynessLabel b={s.busyness} />
        <BusyChart b={s.busyness} />
      </Card>

      <section>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {s.machines.map((m) => (
            <li key={m.id}>
              <Link to={`/m/${m.qrToken}`} className="block h-full">
                <Card className="h-full p-3 transition hover:border-brand/40">
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg font-bold">{m.code}</span>
                    <span className="text-xs text-muted">{t('capacity', { kg: m.capacityKg })}</span>
                  </div>
                  <p className="mb-2 text-xs text-muted">{m.type === 'washer' ? t('washer') : t('dryer')}</p>
                  <MachineStateBadge m={m} now={now} />
                  {m.openIssues > 0 && m.state !== 'fault' && <p className="mt-1 text-[11px] text-serious-ink">⚠ {t('reportedIssue', { n: m.openIssues })}</p>}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {tx(s.policy) && (
        <Card className="p-4 text-sm">
          <p className="font-medium">{t('shopPolicy')}</p>
          <p className="mt-1 text-ink-2">{tx(s.policy)}</p>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="mb-2 font-semibold">{t('facilities')}</h2>
        <div className="flex flex-wrap gap-2">
          {s.machines.some((m) => m.detergentAuto) && <Pill tone="good">🧴 {t('detergentAuto').split('—')[0]}</Pill>}
          {Object.entries(s.facilities)
            .filter(([, v]) => v)
            .map(([k]) => (
              <Pill key={k}>{t(`facility.${k}`)}</Pill>
            ))}
        </div>
        {!s.open24h && (
          <table className="mt-3 w-full text-sm">
            <tbody>
              {DAY_KEYS.map((d, i) => {
                const h = s.openingHours[d];
                return (
                  <tr key={d}>
                    <td className="py-0.5 text-muted">{days[i]}</td>
                    <td className="py-0.5 text-right tabular">{h ? `${h.open} – ${h.close}` : t('closed')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Link to={`/s/${s.slug}/report`} className="block text-center text-sm text-muted underline underline-offset-2">
        ⚠ {t('reportProblem')}
      </Link>
    </div>
  );
}

interface Watch {
  id: string;
  type: 'washer' | 'dryer';
  capacityKg: number;
  shopSlug: string;
}

/** Waiting list for a machine class — only offered where sensors can tell us when one frees up. */
function WatchButton({ shopSlug, type, kg }: { shopSlug: string; type: 'washer' | 'dryer'; kg: number }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const watches = useQuery({
    queryKey: ['me', 'watches'],
    queryFn: () => api.get<{ watches: Watch[] }>('/public/me/watches', { guest: true }),
    enabled: !!getGuestToken(),
  });
  const mine = watches.data?.watches.find((w) => w.shopSlug === shopSlug && w.type === type && w.capacityKg === kg);

  async function start() {
    setBusy(true);
    try {
      await enableCustomerPush(locale).catch(() => false);
      await api.post('/public/watches', { shopSlug, type, capacityKg: kg }, { guest: true });
      await qc.invalidateQueries({ queryKey: ['me', 'watches'] });
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!mine) return;
    setBusy(true);
    try {
      await api.del(`/public/watches/${mine.id}`, { guest: true });
    } catch {
      /* already notified or expired */
    }
    await qc.invalidateQueries({ queryKey: ['me', 'watches'] });
    setBusy(false);
  }

  return (
    <div className="w-full text-right">
      {mine ? (
        <p className="text-xs text-info-ink">
          🔔 {t('watch.active')} ·{' '}
          <button type="button" className="underline" disabled={busy} onClick={cancel}>
            {t('watch.cancel')}
          </button>
        </p>
      ) : (
        <button type="button" disabled={busy} onClick={start} className="rounded-lg bg-brand-soft px-2.5 py-1 text-xs font-medium text-info-ink">
          🔔 {t('watch.button')}
        </button>
      )}
      <p className="mt-0.5 text-[11px] text-muted">{t('watch.hint')}</p>
    </div>
  );
}
