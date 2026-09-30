import { useState } from 'react';
import type { MachineState } from '@dobi/shared';
import { useI18n } from '../lib/i18n';
import { minutesLeft } from '../lib/format';
import { Pill, StateBadge, cx } from '../components/ui';
import type { Availability, Busyness, Confidence, PublicMachine } from './types';

export function ConfidenceTag({ confidence }: { confidence: Confidence }) {
  const { t } = useI18n();
  if (confidence === 'none') return null;
  const map = {
    live: { tone: 'good' as const, label: t('live'), hint: t('liveHint'), icon: '●' },
    mixed: { tone: 'info' as const, label: t('mixed'), hint: t('mixedHint'), icon: '◐' },
    checkins: { tone: 'neutral' as const, label: t('checkins'), hint: t('checkinsHint'), icon: '○' },
  }[confidence];
  return (
    <Pill tone={map.tone}>
      <span aria-hidden>{map.icon}</span>
      <span title={map.hint}>{map.label}</span>
    </Pill>
  );
}

/** "Washers 3 of 8 free" row. Counts are only shown with their confidence label. */
export function AvailabilityRow({ label, a, now }: { label: string; a: Availability; now: number }) {
  const { t } = useI18n();
  if (a.total === 0) return null;
  const next = minutesLeft(a.nextFreeAt, now);
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="text-sm text-ink-2">{label}</span>
      <span className="text-right text-sm">
        <strong className={cx('tabular text-base', a.available === 0 ? 'text-critical-ink' : 'text-ink')}>{t('freeOf', { free: a.available, total: a.total - a.outOfOrder })}</strong>
        {a.available === 0 && next != null && <span className="block text-xs text-muted">{t('nextFreeIn', { min: Math.max(1, next) })}</span>}
        {a.unknown > 0 && <span className="block text-xs text-muted">{t('unknownN', { n: a.unknown })}</span>}
      </span>
    </div>
  );
}

export function BusynessLabel({ b }: { b: Busyness }) {
  const { t } = useI18n();
  if (!b.enoughData || !b.nowLabel) return <p className="text-xs text-muted">{t('notEnoughData')}</p>;
  const tone = b.nowLabel === 'busy' ? 'text-serious-ink' : b.nowLabel === 'moderate' ? 'text-warning-ink' : 'text-good-ink';
  return <p className={cx('text-sm font-medium', tone)}>{t(`usually.${b.nowLabel}`)}</p>;
}

/** Today's typical busyness by hour — single series, so no legend; hover/tap shows the value. */
export function BusyChart({ b }: { b: Busyness }) {
  const { t } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  if (!b.enoughData || !b.today) return null;
  const hours = b.today.map((v, h) => ({ h, v }));
  const shown = hover ?? b.currentHour;
  const val = b.today[shown];
  const label = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
  return (
    <figure>
      <figcaption className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium">{t('busyToday')}</span>
        <span className="tabular text-xs text-muted">
          {label(shown)}: {val == null ? t('closed') : `${Math.round(val * 100)}%`}
        </span>
      </figcaption>
      <div className="flex h-20 items-end gap-[2px]" onMouseLeave={() => setHover(null)} role="img" aria-label={t('busyToday')}>
        {hours.map(({ h, v }) => (
          <button
            key={h}
            type="button"
            aria-label={`${label(h)} ${v == null ? t('closed') : `${Math.round(v * 100)}%`}`}
            onMouseEnter={() => setHover(h)}
            onFocus={() => setHover(h)}
            onClick={() => setHover(h)}
            className="flex h-full flex-1 items-end"
          >
            <span
              className={cx('block w-full rounded-t-[4px]', h === b.currentHour ? 'bg-series-1' : 'bg-series-1/35', hover === h && 'bg-series-1/70')}
              style={{ height: `${v == null ? 2 : Math.max(4, v * 100)}%` }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted tabular">
        <span>12am</span>
        <span>6am</span>
        <span>12pm</span>
        <span>6pm</span>
        <span>12am</span>
      </div>
    </figure>
  );
}

export function useStateLabel() {
  const { t } = useI18n();
  return (m: Pick<PublicMachine, 'state' | 'observed' | 'expectedEndAt'>, now: number) => {
    if (m.state === 'running') {
      const left = minutesLeft(m.expectedEndAt, now);
      return left != null ? (left <= 0 ? t('finishingSoon') : t('minLeft', { min: left })) : t('state.running');
    }
    if (m.state === 'available' && !m.observed) return t('state.available');
    return t(`state.${m.state}`);
  };
}

export function MachineStateBadge({ m, now }: { m: Pick<PublicMachine, 'state' | 'observed' | 'expectedEndAt'>; now: number }) {
  const label = useStateLabel()(m, now);
  return <StateBadge state={m.state as MachineState} label={label} />;
}
