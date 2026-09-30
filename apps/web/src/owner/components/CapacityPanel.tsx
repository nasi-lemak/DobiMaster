import { Card, EmptyState } from '../../components/ui';
import { pct, rm0 } from '../../lib/format';
import { RECOMMENDATION_LABEL, typeLabel } from '../lib/labels';
import { k, qs, useApi } from '../lib/queries';
import type { CapacityClass, CapacityResp, Recommendation } from '../lib/types';
import { QueryState, StatusTag, type Tone } from './common';
import type { IconName } from './icons';

const REC: Record<Recommendation, { tone: Tone; icon: IconName }> = {
  consider_adding: { tone: 'info', icon: 'plus' },
  balanced: { tone: 'good', icon: 'checkCircle' },
  over_capacity: { tone: 'warning', icon: 'alert' },
  insufficient_data: { tone: 'neutral', icon: 'info' },
};

const payback = (m: number | null) => (m == null ? '—' : m > 120 ? 'over 10 years' : `${m} months`);

function explain(c: CapacityClass, days: number) {
  const name = `${typeLabel(c.type).toLowerCase()}s (${c.capacityKg} kg)`;
  switch (c.recommendation) {
    case 'consider_adding':
      return `All ${c.machines} ${name} were at least 80% busy for about ${c.saturatedHoursPerWeek} h a week — customers likely waited or left. One more could bring in about ${rm0(c.estExtraRevenuePerMonthSen)} a month${c.paybackMonths != null && c.paybackMonths <= 120 ? ` and pay for itself in ~${c.paybackMonths} months` : ''}.`;
    case 'balanced':
      return `Busy ${pct(c.utilisation)} of open hours and rarely all taken at once (${c.saturatedHoursPerWeek} h a week) — the number of ${name} matches demand.`;
    case 'over_capacity':
      return `Only ${pct(c.utilisation)} of open hours in use — more ${name} than demand. Consider an off-peak promotion or moving one to a busier branch.`;
    case 'insufficient_data':
      return `Only ${c.cycles} cycles recorded in the last ${days} days — at least 20 are needed to judge. Sensors or more customer check-ins will fill this in.`;
  }
}

/** Per capacity class: "should I add another washer/dryer?" — shown with its formula and assumptions. */
export function CapacityPanel({ shopId, days }: { shopId: string; days: number }) {
  const q = useApi<CapacityResp>(k.analytics('capacity', shopId, days), `/owner/analytics/capacity${qs({ shopId, days })}`, { keepPrevious: true });
  return (
    <QueryState q={q}>
      {() => {
        const d = q.data!;
        if (!d.classes.length) return <EmptyState title="No machines in this shop" />;
        const a = d.assumptions;
        return (
          <figure className={`rounded-2xl border border-line bg-surface p-4 transition-opacity sm:p-5 ${q.isFetching ? 'opacity-50' : ''}`}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {d.classes.map((c) => (
                <Card key={c.key} className="bg-surface-2/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="font-semibold">
                        {typeLabel(c.type)} {c.capacityKg} kg
                      </h4>
                      <div className="text-xs text-muted">
                        {c.machines} machine{c.machines === 1 ? '' : 's'} · {c.cycles.toLocaleString('en-MY')} cycles
                      </div>
                    </div>
                    <StatusTag tone={REC[c.recommendation].tone} icon={REC[c.recommendation].icon}>
                      {RECOMMENDATION_LABEL[c.recommendation]}
                    </StatusTag>
                  </div>
                  <p className="mt-2 text-sm">{explain(c, days)}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <Metric label="Utilisation" value={pct(c.utilisation)} />
                    <Metric label="Busiest hour" value={pct(c.peakHourUtilisation)} />
                    <Metric label="Saturated h / week" value={String(c.saturatedHoursPerWeek)} />
                    <Metric label="Est. revenue / machine / month" value={rm0(c.estRevenuePerMachineMonthSen)} />
                    <Metric label="Extra if one added / month" value={c.estExtraRevenuePerMonthSen ? rm0(c.estExtraRevenuePerMonthSen) : '—'} />
                    <Metric label="Payback" value={payback(c.paybackMonths)} hint={`machine ≈ ${rm0(c.assumedMachineCostSen)}`} />
                  </dl>
                </Card>
              ))}
            </div>
            <figcaption className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
              <span className="font-medium text-ink-2">Data sources &amp; assumptions: </span>
              recorded cycles over {d.openHours ?? '—'} open hours in the last {days} days. A “saturated” hour is one where the class was ≥ {pct(a?.saturationThreshold ?? 0.8)} busy.
              “Consider adding” needs ≥ {a?.saturatedHoursPerWeek ?? 4} saturated h/week and ≥ 40% utilisation; “over capacity” is below 20%. Extra revenue = saturated hours × cycles per hour ×
              average price × {pct(a?.captureRate ?? 0.6)} of waiting customers captured. Machine cost is your recorded purchase cost, or a typical price if none.
            </figcaption>
          </figure>
        );
      }}
    </QueryState>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold">
        {value} {hint && <span className="text-[11px] font-normal text-muted">({hint})</span>}
      </dd>
    </div>
  );
}
