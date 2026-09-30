import type { ReactNode } from 'react';
import { useActiveIndex, useWidth, roundedTop } from './hooks';
import { niceTicks } from './scale';
import { TipBody, useChartTooltip, type TipRow } from './tooltip';

export interface ColumnSeries {
  key: string;
  label: string;
  color: string;
}

export interface ColumnDatum {
  key: string;
  label: string;
  values: Record<string, number>;
}

const H = 190;
const AXIS_W = 52;
const BOTTOM = 22;
const TOP = 16;
const GAP = 2;

/**
 * Stacked columns on one y-axis. Bars ≤ 24px, 4px rounded top on the topmost segment only (square at
 * the baseline), a 2px surface gap between stacked segments, hairline recessive grid, and the column's
 * total as the one direct label on the tallest column.
 */
export function ColumnChart({
  data,
  series,
  format,
  tickFormat,
  ariaLabel,
  tipNote,
}: {
  data: ColumnDatum[];
  series: ColumnSeries[];
  format: (v: number) => string;
  tickFormat: (v: number) => string;
  ariaLabel: string;
  tipNote?: (d: ColumnDatum) => string | undefined;
}) {
  const { ref: wrapRef, width } = useWidth<HTMLDivElement>();
  const tip = useChartTooltip();
  const { active, setActive, onKeyDown } = useActiveIndex(data.length, (i) => (i == null ? tip.hide() : activate(i)));
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.key] ?? 0), 0));
  const ticks = niceTicks(Math.max(0, ...totals));
  const yMax = ticks[ticks.length - 1]!;
  const plotW = Math.max(0, width - AXIS_W);
  const plotH = H - BOTTOM - TOP;
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.max(1, Math.min(24, band * 0.62, band - GAP));
  const y = (v: number) => TOP + plotH - (v / yMax) * plotH;
  const labelPx = Math.max(40, Math.max(0, ...data.map((d) => d.label.length)) * 6.5 + 14);
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / labelPx))));
  const maxIdx = totals.indexOf(Math.max(...totals));

  const tipFor = (i: number): ReactNode => {
    const d = data[i]!;
    const rows: TipRow[] = [...series].reverse().map((s) => ({ label: s.label, value: format(d.values[s.key] ?? 0), color: s.color }));
    rows.push({ label: 'Total', value: format(totals[i]!) });
    return <TipBody title={d.label} rows={rows} note={tipNote?.(d)} />;
  };

  const activate = (i: number, clientX?: number, clientY?: number) => {
    setActive(i);
    const box = tip.ref.current?.getBoundingClientRect();
    if (!box) return;
    const cx = clientX ?? box.left + AXIS_W + band * i + band / 2;
    const cy = clientY ?? box.top + y(totals[i]!);
    tip.showAt(cx, Math.min(cy, box.top + y(totals[i]!)), tipFor(i));
  };

  return (
    <div ref={tip.ref} className="relative">
      <div ref={wrapRef} className="w-full">
        {width > 0 && (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={`${ariaLabel}. Use left and right arrow keys to read values.`}
            tabIndex={0}
            className="block touch-pan-y outline-none focus-visible:outline-2 focus-visible:outline-brand"
            onKeyDown={onKeyDown}
            onBlur={() => (setActive(null), tip.hide())}
            onPointerLeave={() => (setActive(null), tip.hide())}
            onPointerMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const i = Math.floor((e.clientX - box.left - AXIS_W) / band);
              if (i >= 0 && i < data.length) activate(i, e.clientX, e.clientY);
            }}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={AXIS_W} x2={width} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} shapeRendering="crispEdges" />
                <text x={AXIS_W - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular">
                  {tickFormat(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = AXIS_W + band * i + (band - barW) / 2;
              let acc = 0;
              const segs = series
                .map((s) => ({ s, v: d.values[s.key] ?? 0 }))
                .filter((x2) => x2.v > 0);
              return (
                <g key={d.key} opacity={active != null && active !== i ? 0.45 : 1}>
                  {segs.map(({ s, v }, si) => {
                    const y0 = y(acc);
                    acc += v;
                    const y1 = y(acc);
                    const isTop = si === segs.length - 1;
                    const h = Math.max(0, y0 - y1 - (si > 0 ? GAP : 0));
                    const top = y1;
                    return isTop ? (
                      <path key={s.key} d={roundedTop(x, top, barW, h)} fill={s.color} />
                    ) : (
                      <rect key={s.key} x={x} y={top} width={barW} height={h} fill={s.color} />
                    );
                  })}
                  {i % labelEvery === 0 && (
                    <text x={AXIS_W + band * i + band / 2} y={H - 6} textAnchor={AXIS_W + band * i + band / 2 > width - 28 ? 'end' : 'middle'} fontSize={11} fill="var(--muted)">
                      {d.label}
                    </text>
                  )}
                </g>
              );
            })}
            {maxIdx >= 0 && totals[maxIdx]! > 0 && active == null && (
              <text x={AXIS_W + band * maxIdx + band / 2} y={y(totals[maxIdx]!) - 5} textAnchor={maxIdx > data.length * 0.8 ? 'end' : maxIdx < data.length * 0.2 ? 'start' : 'middle'} fontSize={11} fontWeight={600} fill="var(--ink)" stroke="var(--surface)" strokeWidth={4} paintOrder="stroke">
                {format(totals[maxIdx]!)}
              </text>
            )}
          </svg>
        )}
      </div>
      {tip.node}
    </div>
  );
}
