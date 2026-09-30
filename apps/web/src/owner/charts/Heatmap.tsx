import { useState, type KeyboardEvent } from 'react';
import { cx } from '../../components/ui';
import { WEEKDAYS } from '../lib/labels';
import { TipBody, useChartTooltip } from './tooltip';

/** Fixed utilisation bins on the sequential blue ramp (one hue, light → dark). */
export const HEAT_BINS = [
  { min: 0, max: 0.1, color: 'var(--seq-100)', label: '< 10%' },
  { min: 0.1, max: 0.25, color: 'var(--seq-250)', label: '10–25%' },
  { min: 0.25, max: 0.4, color: 'var(--seq-400)', label: '25–40%' },
  { min: 0.4, max: 0.6, color: 'var(--seq-550)', label: '40–60%' },
  { min: 0.6, max: Infinity, color: 'var(--seq-700)', label: '≥ 60%' },
];

const binOf = (v: number) => HEAT_BINS.find((b) => v >= b.min && v < b.max) ?? HEAT_BINS[HEAT_BINS.length - 1]!;

/** Closed hours: hatched at 45°, never a ramp colour — "no data" must not read as "zero". */
const CLOSED_BG = 'repeating-linear-gradient(45deg, var(--grid) 0 1.5px, transparent 1.5px 5px)';

const hourLabel = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);

/**
 * Day-of-week × hour heatmap of average machine utilisation. Each cell is a hover/focus target; keyboard
 * users focus the grid and move with arrow keys.
 */
export function Heatmap({ matrix }: { matrix: Array<Array<number | null>> }) {
  const tip = useChartTooltip();
  const [active, setActive] = useState<[number, number] | null>(null);

  const show = (d: number, h: number, el: Element | null) => {
    setActive([d, h]);
    if (!el) return;
    const v = matrix[d]?.[h] ?? null;
    tip.showFor(
      el,
      <TipBody
        title={`${WEEKDAYS[d]} ${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00`}
        rows={[{ label: v == null ? '' : 'of machines busy on average', value: v == null ? 'Closed' : `${Math.round(v * 100)}%`, color: v == null ? undefined : binOf(v).color }]}
      />,
    );
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const [d, h] = active ?? [0, -1];
    const moves: Record<string, [number, number]> = {
      ArrowRight: [d, Math.min(23, h + 1)],
      ArrowLeft: [d, Math.max(0, h - 1)],
      ArrowDown: [Math.min(6, d + 1), Math.max(0, h)],
      ArrowUp: [Math.max(0, d - 1), Math.max(0, h)],
    };
    const next = moves[e.key];
    if (!next) return;
    e.preventDefault();
    show(next[0], next[1], e.currentTarget.querySelector(`[data-cell="${next[0]}-${next[1]}"]`));
  };

  return (
    <div>
      <div ref={tip.ref} className="relative">
        <div
          role="img"
          aria-label="Peak hours heatmap: average share of machines busy by weekday and hour. Use arrow keys to read cells, or switch to the table view."
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => (setActive(null), tip.hide())}
          onPointerLeave={() => (setActive(null), tip.hide())}
          className="rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-brand"
        >
          <div className="grid gap-[2px]" style={{ gridTemplateColumns: '2.25rem repeat(24, minmax(0, 1fr))' }}>
            {matrix.map((row, d) => (
              <div key={d} className="contents">
                <div className="flex items-center text-[11px] text-muted">{WEEKDAYS[d]}</div>
                {row.map((v, h) => {
                  const isActive = active?.[0] === d && active?.[1] === h;
                  return (
                    <div
                      key={h}
                      data-cell={`${d}-${h}`}
                      onPointerEnter={(e) => show(d, h, e.currentTarget)}
                      className={cx('aspect-square min-h-3 rounded-[3px] sm:aspect-auto sm:h-6', isActive && 'ring-2 ring-ink ring-offset-1 ring-offset-surface')}
                      style={{ background: v == null ? CLOSED_BG : binOf(v).color }}
                    />
                  );
                })}
              </div>
            ))}
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="text-center text-[10px] text-muted">
                {h % 3 === 0 ? hourLabel(h) : ''}
              </div>
            ))}
          </div>
        </div>
        {tip.node}
      </div>
      <ul className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-2" aria-label="Colour scale">
        <li className="text-muted">Machines busy:</li>
        {HEAT_BINS.map((b) => (
          <li key={b.label} className="inline-flex items-center gap-1">
            <span aria-hidden className="inline-block h-3 w-3 rounded-[3px]" style={{ background: b.color }} />
            {b.label}
          </li>
        ))}
        <li className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block h-3 w-3 rounded-[3px] ring-1 ring-line" style={{ background: CLOSED_BG }} />
          Closed
        </li>
      </ul>
    </div>
  );
}
