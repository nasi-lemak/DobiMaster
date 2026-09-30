import { useCallback, useRef, useState, type ReactNode } from 'react';

export interface TipRow {
  label: string;
  value: string;
  color?: string;
  kind?: 'line' | 'rect';
}

/** Tooltip body: values lead (strong), labels follow; series keyed with a short stroke, not a box. */
export function TipBody({ title, rows, note }: { title: string; rows: TipRow[]; note?: string }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-muted">{title}</div>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2 whitespace-nowrap text-xs">
            {r.color && <span aria-hidden className="inline-block h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.color }} />}
            <span className="font-semibold tabular text-ink">{r.value}</span>
            <span className="text-ink-2">{r.label}</span>
          </li>
        ))}
      </ul>
      {note && <div className="mt-1 text-[11px] text-muted">{note}</div>}
    </div>
  );
}

/**
 * One tooltip per chart, positioned inside a `relative` container. Content is React nodes, so data
 * labels are always escaped (never innerHTML). Call `showAt` from pointer and focus handlers.
 */
export function useChartTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; w: number; content: ReactNode } | null>(null);

  const showAt = useCallback((clientX: number, clientY: number, content: ReactNode) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: clientX - box.left, y: clientY - box.top, w: box.width, content });
  }, []);

  const showFor = useCallback(
    (el: Element, content: ReactNode) => {
      const r = el.getBoundingClientRect();
      showAt(r.left + r.width / 2, r.top, content);
    },
    [showAt],
  );

  const hide = useCallback(() => setTip(null), []);

  const node = tip ? (
    <div
      role="status"
      className="pointer-events-none absolute z-20 min-w-32 max-w-72 rounded-xl border border-line bg-surface px-3 py-2 shadow-lg"
      style={{
        left: Math.max(4, Math.min(tip.w - 4, tip.x)),
        top: tip.y - 10,
        transform: `translate(${tip.x < tip.w * 0.25 ? '-10%' : tip.x > tip.w * 0.75 ? '-90%' : '-50%'}, -100%)`,
      }}
    >
      {tip.content}
    </div>
  ) : null;

  return { ref, showAt, showFor, hide, node, active: !!tip };
}
