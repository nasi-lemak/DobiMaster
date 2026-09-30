import type { ReactNode } from 'react';
import { TipBody, useChartTooltip, type TipRow } from './tooltip';

export interface HBar {
  key: string;
  label: string;
  value: number;
  valueLabel: string;
  /** Status marker (icon + label) shown after the value, e.g. a low-usage flag. */
  flag?: ReactNode;
  tip: TipRow[];
  tipTitle: string;
  tipNote?: string;
}

/**
 * Horizontal bars for one measure: one colour for every bar (single series — no value ramp on nominal
 * categories), ≤ 24px thick with a 4px rounded data-end and a square baseline, value at the tip in ink.
 */
export function HBarChart({ bars, max, color = 'var(--series-1)', thickness = 12, labelWidth = 'w-24', ariaLabel }: { bars: HBar[]; max: number; color?: string; thickness?: number; labelWidth?: string; ariaLabel: string }) {
  const tip = useChartTooltip();
  return (
    <div ref={tip.ref} className="relative">
      <ul aria-label={ariaLabel} className="space-y-1">
        {bars.map((b) => {
          const w = max > 0 ? Math.max(0, Math.min(1, b.value / max)) * 100 : 0;
          const show = (el: Element) => tip.showFor(el, <TipBody title={b.tipTitle} rows={b.tip} note={b.tipNote} />);
          return (
            <li
              key={b.key}
              tabIndex={0}
              aria-label={`${b.label}: ${b.valueLabel}`}
              onPointerEnter={(e) => show(e.currentTarget.querySelector('[data-bar]') ?? e.currentTarget)}
              onPointerLeave={tip.hide}
              onFocus={(e) => show(e.currentTarget.querySelector('[data-bar]') ?? e.currentTarget)}
              onBlur={tip.hide}
              className="group flex items-center gap-2 rounded-lg px-1 py-1 outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand"
            >
              <span className={`${labelWidth} shrink-0 text-xs text-ink-2`}>
                <span className="block truncate">{b.label}</span>
                {b.flag && <span className="mt-0.5 block">{b.flag}</span>}
              </span>
              <span className="relative flex min-w-0 flex-1 items-center gap-2">
                <span className="relative flex-1" style={{ height: thickness }}>
                  <span
                    data-bar
                    className="absolute left-0 top-0 h-full rounded-r-[4px]"
                    style={{ width: `${w}%`, minWidth: b.value > 0 ? 2 : 0, background: color }}
                  />
                </span>
                <span className="w-11 shrink-0 text-right text-xs font-semibold tabular text-ink">{b.valueLabel}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {tip.node}
    </div>
  );
}
