import { useState, type ReactNode } from 'react';
import { cx } from '../../components/ui';
import { Icon } from '../components/icons';

export interface LegendItem {
  label: string;
  color: string;
  kind?: 'rect' | 'line';
}

/** Legend keys mirror the mark: a rect for bars, a short stroke for lines. Text stays in ink tokens. */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          {i.kind === 'line' ? (
            <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: i.color }} />
          ) : (
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color }} />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Chart container: title, legend, the chart or its table twin (toggle), and a "data sources" footnote.
 * While refetching (`dim`), the previous render is held at reduced opacity — no skeleton flash.
 */
export function ChartFrame({
  title,
  subtitle,
  legend,
  table,
  sources,
  dim,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: LegendItem[];
  table: ReactNode;
  sources: ReactNode;
  dim?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className={cx('rounded-2xl border border-line bg-surface p-4 sm:p-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">{title}</h3>
          {subtitle && <div className="mt-0.5 text-xs text-muted">{subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-2 hover:bg-surface-2"
        >
          <Icon name={asTable ? 'chart' : 'table'} className="h-3.5 w-3.5" />
          {asTable ? 'Chart view' : 'Table view'}
        </button>
      </div>
      {legend && legend.length >= 2 && !asTable && (
        <div className="mt-3">
          <Legend items={legend} />
        </div>
      )}
      <div className={cx('mt-3 transition-opacity', dim && 'opacity-50')}>{asTable ? <div className="max-h-96 overflow-auto">{table}</div> : children}</div>
      <figcaption className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
        <span className="font-medium text-ink-2">Data sources: </span>
        {sources}
      </figcaption>
    </figure>
  );
}

/** Plain accessible table used as every chart's table view. */
export function DataTable({ head, rows, numeric = [] }: { head: string[]; rows: Array<Array<ReactNode>>; numeric?: number[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead className="sticky top-0 bg-surface">
        <tr>
          {head.map((h, i) => (
            <th key={h} scope="col" className={cx('border-b border-line px-2 py-1.5 text-xs font-medium text-muted', numeric.includes(i) ? 'text-right' : 'text-left')}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((c, ci) => (
              <td key={ci} className={cx('border-b border-line px-2 py-1.5', numeric.includes(ci) && 'tabular text-right')}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
