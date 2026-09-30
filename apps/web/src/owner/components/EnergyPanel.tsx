import { EmptyState } from '../../components/ui';
import { cx } from '../../components/ui';
import { rm } from '../../lib/format';
import { QueryState, StatusTag, TableWrap, td, th } from './common';
import { k, qs, useApi } from '../lib/queries';

interface EnergyRow {
  machineId: string;
  shopName: string;
  code: string;
  type: 'washer' | 'dryer';
  capacityKg: number;
  cycles: number;
  avgKwhPerCycle: number;
  avgPowerW: number;
  energyCostPerCycleSen: number;
  avgPriceSen: number;
  energyShareOfPrice: number | null;
  tariffSenPerKwh: number;
}

/** A program priced so that electricity eats a large share of it is worth a second look. */
const HIGH_SHARE = 0.25;

/** Electricity cost per cycle, measured by power sensors × the shop's tariff. */
export function EnergyPanel({ days, shopId }: { days: number; shopId: string }) {
  const q = useApi<{ machines: EnergyRow[]; note: string }>(k.analytics('energy', days, shopId), `/owner/analytics/energy${qs({ days, shopId })}`, { keepPrevious: true });
  return (
    <QueryState q={q}>
      {() =>
        q.data!.machines.length === 0 ? (
          <EmptyState title="No electricity data yet">Electricity per cycle needs a power sensor on the machine. Sensor-equipped machines appear here after their first measured cycle.</EmptyState>
        ) : (
          <div className={cx('transition-opacity', q.isFetching && 'opacity-50')}>
            <TableWrap>
              <thead>
                <tr>
                  <th scope="col" className={th}>
                    Machine
                  </th>
                  <th scope="col" className={cx(th, 'text-right')}>
                    Measured cycles
                  </th>
                  <th scope="col" className={cx(th, 'text-right')}>
                    kWh / cycle
                  </th>
                  <th scope="col" className={cx(th, 'text-right')}>
                    Electricity / cycle
                  </th>
                  <th scope="col" className={cx(th, 'text-right')}>
                    Avg price paid
                  </th>
                  <th scope="col" className={cx(th, 'text-right')}>
                    Electricity share
                  </th>
                </tr>
              </thead>
              <tbody className="tabular">
                {q.data!.machines.map((m) => (
                  <tr key={m.machineId}>
                    <td className={td}>
                      <span className="font-medium">{m.code}</span>{' '}
                      <span className="text-xs text-muted">
                        {m.type} {m.capacityKg} kg · {m.shopName}
                      </span>
                    </td>
                    <td className={cx(td, 'text-right')}>{m.cycles}</td>
                    <td className={cx(td, 'text-right')}>{m.avgKwhPerCycle.toFixed(2)}</td>
                    <td className={cx(td, 'text-right')}>{rm(m.energyCostPerCycleSen)}</td>
                    <td className={cx(td, 'text-right')}>{rm(m.avgPriceSen)}</td>
                    <td className={cx(td, 'text-right')}>
                      {m.energyShareOfPrice == null ? (
                        '—'
                      ) : m.energyShareOfPrice >= HIGH_SHARE ? (
                        <StatusTag tone="warning">{Math.round(m.energyShareOfPrice * 100)}% of price</StatusTag>
                      ) : (
                        `${Math.round(m.energyShareOfPrice * 100)}%`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <p className="mt-2 text-xs text-muted">
              <span className="font-medium">Data sources:</span> {q.data!.note} Tariff: RM {(q.data!.machines[0]!.tariffSenPerKwh / 100).toFixed(3)}/kWh. Flagged when electricity is ≥ {HIGH_SHARE * 100}% of what customers pay.
            </p>
          </div>
        )
      }
    </QueryState>
  );
}
