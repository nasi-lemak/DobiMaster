import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Button, Card, ErrorBox, PageLoader, Pill } from '../components/ui';
import { AvailabilityRow, BusynessLabel, ConfidenceTag } from './components';
import { useNow } from './useNow';
import type { ShopSummary } from './types';
import { useChannels } from '../lib/realtime';

function worstConfidence(s: ShopSummary) {
  const c = [s.availability.washers.confidence, s.availability.dryers.confidence];
  return c.includes('checkins') ? (c.includes('live') || c.includes('mixed') ? 'mixed' : 'checkins') : c.includes('mixed') ? 'mixed' : 'live';
}

export function HomePage() {
  const { t, tx } = useI18n();
  const now = useNow();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const q = useQuery({
    queryKey: ['shops', coords],
    queryFn: () => api.get<{ shops: ShopSummary[] }>(`/public/shops${coords ? `?lat=${coords.lat}&lng=${coords.lng}` : ''}`),
    refetchInterval: 60_000,
  });
  useChannels(
    (q.data?.shops ?? []).map((s) => `shop:${s.id}`),
    () => q.refetch(),
    () => q.refetch(),
  );

  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCoords({ lat: p.coords.latitude, lng: p.coords.longitude });
        setLocating(false);
      },
      () => setLocating(false),
      { timeout: 8000, maximumAge: 300_000 },
    );
  };

  return (
    <div className="space-y-4">
      <section>
        <h1 className="text-xl font-semibold">{t('nearby')}</h1>
        <p className="text-sm text-muted">{t('tagline')}</p>
      </section>
      <div className="flex items-center justify-between gap-2">
        {coords ? (
          <Pill tone="info">📍 {t('usingLocation')}</Pill>
        ) : (
          <Button variant="secondary" size="sm" onClick={locate} disabled={locating}>
            📍 {locating ? t('locating') : t('useLocation')}
          </Button>
        )}
      </div>

      {q.isLoading && <PageLoader />}
      {q.error && <ErrorBox message={t('error')} onRetry={() => q.refetch()} retryLabel={t('retry')} />}
      <ul className="space-y-3">
        {q.data?.shops.map((s) => (
          <li key={s.id}>
            <Link to={`/s/${s.slug}`} className="block">
              <Card className="p-4 transition hover:border-brand/40">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{s.name}</h2>
                    <p className="text-xs">
                      <span className={s.openNow ? 'text-good-ink' : 'text-critical-ink'}>● {s.openNow ? (s.open24h ? t('open24h') : t('openNow')) : t('closed')}</span>
                      {s.openNow && s.closesAt && <span className="text-muted"> · {t('closesAt', { time: s.closesAt })}</span>}
                    </p>
                  </div>
                  {s.distanceKm != null && <span className="shrink-0 text-sm tabular text-muted">{s.distanceKm} km</span>}
                </div>
                <div className="mt-3 border-t border-line pt-2">
                  <AvailabilityRow label={t('washers')} a={s.availability.washers} now={now} />
                  <AvailabilityRow label={t('dryers')} a={s.availability.dryers} now={now} />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <BusynessLabel b={s.busyness} />
                  <ConfidenceTag confidence={worstConfidence(s)} />
                </div>
                {s.availability.washers.outOfOrder + s.availability.dryers.outOfOrder > 0 && (
                  <p className="mt-2 text-xs text-serious-ink">⚠ {t('outOfOrder', { n: s.availability.washers.outOfOrder + s.availability.dryers.outOfOrder })}</p>
                )}
                {s.warning && <p className="mt-1 text-xs text-warning-ink">📢 {tx(s.warning)}</p>}
              </Card>
            </Link>
          </li>
        ))}
      </ul>

      <Card className="p-4">
        <p className="font-medium">📷 {t('scanQr')}</p>
        <p className="mt-1 text-sm text-muted">{t('scanQrHint')}</p>
      </Card>
    </div>
  );
}
