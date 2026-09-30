import { useActiveIndex, useWidth } from './hooks';
import { niceTicks } from './scale';
import { TipBody, useChartTooltip } from './tooltip';

const AXIS_W = 52;
const BOTTOM = 22;
const TOP = 16;

/**
 * Single-series line (2px, round joins) with a ~10% area wash, a crosshair that snaps to the nearest X,
 * and the last value as the one direct label. No legend: the chart title names the series.
 */
export function LineChart({
  points,
  color,
  seriesLabel,
  format,
  tickFormat,
  ariaLabel,
  height = 150,
}: {
  points: Array<{ key: string; label: string; value: number; extra?: string }>;
  color: string;
  seriesLabel: string;
  format: (v: number) => string;
  tickFormat: (v: number) => string;
  ariaLabel: string;
  height?: number;
}) {
  const { ref: wrapRef, width } = useWidth<HTMLDivElement>();
  const tip = useChartTooltip();
  const n = points.length;
  const ticks = niceTicks(Math.max(0, ...points.map((p) => p.value)), 3);
  const yMax = ticks[ticks.length - 1]!;
  const plotW = Math.max(0, width - AXIS_W - 8);
  const plotH = height - BOTTOM - TOP;
  const x = (i: number) => AXIS_W + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => TOP + plotH - (v / yMax) * plotH;
  const labelPx = Math.max(40, Math.max(0, ...points.map((p) => p.label.length)) * 6.5 + 14);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / labelPx))));

  const activate = (i: number, clientY?: number) => {
    setActive(i);
    const box = tip.ref.current?.getBoundingClientRect();
    if (!box) return;
    const p = points[i]!;
    tip.showAt(box.left + x(i), Math.min(clientY ?? Infinity, box.top + y(p.value)), <TipBody title={p.label} rows={[{ label: seriesLabel, value: format(p.value), color }]} note={p.extra} />);
  };
  const { active, setActive, onKeyDown } = useActiveIndex(n, (i) => (i == null ? tip.hide() : activate(i)));

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join('');
  const area = n ? `${line}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z` : '';
  const last = points[n - 1];

  return (
    <div ref={tip.ref} className="relative">
      <div ref={wrapRef} className="w-full">
        {width > 0 && n > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${ariaLabel}. Use left and right arrow keys to read values.`}
            tabIndex={0}
            className="block touch-pan-y outline-none focus-visible:outline-2 focus-visible:outline-brand"
            onKeyDown={onKeyDown}
            onBlur={() => (setActive(null), tip.hide())}
            onPointerLeave={() => (setActive(null), tip.hide())}
            onPointerMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const rel = (e.clientX - box.left - AXIS_W) / (plotW || 1);
              const i = Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1))));
              activate(i, e.clientY);
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
            <path d={area} fill={color} opacity={0.1} />
            <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p, i) =>
              i % labelEvery === 0 ? (
                <text key={p.key} x={x(i)} y={height - 6} textAnchor={x(i) > width - 28 ? 'end' : 'middle'} fontSize={11} fill="var(--muted)">
                  {p.label}
                </text>
              ) : null,
            )}
            {active != null && (
              <>
                <line x1={x(active)} x2={x(active)} y1={TOP} y2={y(0)} stroke="var(--axis)" strokeWidth={1} />
                <circle cx={x(active)} cy={y(points[active]!.value)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
              </>
            )}
            {last && active == null && (
              <>
                <circle cx={x(n - 1)} cy={y(last.value)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
                <text x={x(n - 1) - 8} y={y(last.value) - 10} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--ink)" stroke="var(--surface)" strokeWidth={4} paintOrder="stroke">
                  {format(last.value)}
                </text>
              </>
            )}
          </svg>
        )}
      </div>
      {tip.node}
    </div>
  );
}
