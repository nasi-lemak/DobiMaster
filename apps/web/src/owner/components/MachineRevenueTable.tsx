import { useState } from 'react';
import { Link } from 'react-router';
import { cx } from '../../components/ui';
import { pct } from '../../lib/format';
import { rmc as rm } from '../lib/fmt';
import { k, qs, useApi } from '../lib/queries';
import type { RevenueResp, UtilResp } from '../lib/types';
import { QueryState, TableWrap, td, th } from './common';
import { Icon } from './icons';

type SortKey = 'label' | 'cycles' | 'utilisation' | 'estimatedSen' | 'cashSen' | 'appSen' | 'recordedSen';

const COLS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: 'label', label: 'Machine' },
  { key: 'cycles', label: 'Cycles', numeric: true },
  { key: 'utilisation', label: 'Utilisation', numeric: true },
  { key: 'estimatedSen', label: 'Estimated', numeric: true },
  { key: 'cashSen', label: 'Cash', numeric: true },
  { key: 'appSen', label: 'App', numeric: true },
  { key: 'recordedSen', label: 'Recorded', numeric: true },
];

/** Sortable per-machine revenue: recorded (cash + app) next to estimated (cycles × price) and utilisation. */
export function MachineRevenueTable({ days, shopId, util }: { days: number; shopId: string; util?: UtilResp }) {
  const q = useApi<RevenueResp>(k.analytics('revenue', 'machine', days, shopId), `/owner/analytics/revenue${qs({ days, shopId, groupBy: 'machine' })}`, { keepPrevious: true });
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'recordedSen', dir: -1 });

  return (
    <QueryState q={q}>
      {() => {
        const utilById = new Map(util?.machines.map((m) => [m.machineId, m]) ?? []);
        const rows = q.data!.rows.map((r) => ({ ...r, utilisation: utilById.get(r.key)?.utilisation ?? null }));
        rows.sort((a, b) => {
          const av = a[sort.key];
          const bv = b[sort.key];
          if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * sort.dir;
          return ((Number(av ?? -1) || 0) - (Number(bv ?? -1) || 0)) * sort.dir;
        });
        return (
          <div className={cx('transition-opacity', q.isFetching && 'opacity-50')}>
            <TableWrap>
              <thead>
                <tr>
                  {COLS.map((c) => {
                    const active = sort.key === c.key;
                    return (
                      <th key={c.key} scope="col" className={cx(th, c.numeric && 'text-right')} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                        <button
                          type="button"
                          className={cx('inline-flex items-center gap-1 hover:text-ink', active && 'text-ink')}
                          onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? ((-s.dir) as 1 | -1) : c.numeric ? -1 : 1 }))}
                        >
                          {c.label}
                          <Icon name="sort" className={cx('h-3 w-3', !active && 'opacity-40')} />
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="tabular">
                {rows.map((r) => (
                  <tr key={r.key} className="hover:bg-surface-2">
                    <td className={td}>
                      <Link to={`/owner/machines/${r.key}`} className="font-medium hover:underline">
                        {r.label}
                      </Link>
                    </td>
                    <td className={cx(td, 'text-right')}>{r.cycles.toLocaleString('en-MY')}</td>
                    <td className={cx(td, 'text-right')}>{pct(r.utilisation)}</td>
                    <td className={cx(td, 'text-right')}>{rm(r.estimatedSen)}</td>
                    <td className={cx(td, 'text-right')}>{rm(r.cashSen)}</td>
                    <td className={cx(td, 'text-right')}>{rm(r.appSen)}</td>
                    <td className={cx(td, 'text-right font-semibold')}>{rm(r.recordedSen)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <p className="mt-2 text-[11px] text-muted">
              <span className="font-medium text-ink-2">Data sources: </span>
              {q.data!.note} A big gap between estimated and recorded on a coin machine is worth a look (jammed coin box, skimming, or missing check-ins).
            </p>
          </div>
        );
      }}
    </QueryState>
  );
}
