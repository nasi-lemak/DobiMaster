import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button, EmptyState } from '../../components/ui';
import { pct, rm0 } from '../../lib/format';
import { rmc as rm } from '../lib/fmt';
import { ChartFrame, DataTable } from '../charts/ChartFrame';
import { ColumnChart } from '../charts/ColumnChart';
import { HBarChart, type HBar } from '../charts/HBarChart';
import { Heatmap } from '../charts/Heatmap';
import { LineChart } from '../charts/LineChart';
import { periodLabel, rmTick } from '../charts/scale';
import { PageHeader, QueryState, Section, Segmented, ShopSelect, StatusTag } from '../components/common';
import { CapacityPanel } from '../components/CapacityPanel';
import { MachineRevenueTable } from '../components/MachineRevenueTable';
import { EnergyPanel } from '../components/EnergyPanel';
import { SOURCE_LABEL, WEEKDAYS, typeLabel } from '../lib/labels';
import { k, qs, useApi } from '../lib/queries';
import { useMe, useShortShopName } from '../lib/session';
import type { LowUsageResp, PeakResp, RevenueResp, UtilResp } from '../lib/types';

type Group = 'day' | 'week' | 'month';

export function AnalyticsPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const days = Number(params.get('days') ?? 30) as 7 | 30 | 90;
  const shopId = params.get('shopId') ?? '';
  const [group, setGroup] = useState<Group>(days === 7 ? 'day' : 'week');
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, v] of Object.entries(patch)) v ? next.set(key, v) : next.delete(key);
    setParams(next, { replace: true });
  };

  const scope = { days, shopId: shopId || undefined };
  const revenue = useApi<RevenueResp>(k.analytics('revenue', group, days, shopId), `/owner/analytics/revenue${qs({ ...scope, groupBy: group })}`, { keepPrevious: true });
  const util = useApi<UtilResp>(k.analytics('util', days, shopId), `/owner/analytics/utilisation${qs(scope)}`, { keepPrevious: true });
  const low = useApi<LowUsageResp>(k.analytics('low', Math.min(days, 60), shopId), `/owner/analytics/low-usage${qs({ days: Math.min(days, 60), shopId })}`, { keepPrevious: true });
  const peak = useApi<PeakResp>(k.analytics('peak', days, shopId), `/owner/analytics/peak-hours${qs(scope)}`, { keepPrevious: true });

  return (
    <>
      <PageHeader title="Analytics" subtitle="Revenue, utilisation and capacity — every panel says what it's based on" />
      {/* One filter row scopes every panel below. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 lg:sticky lg:top-0 lg:z-10 lg:rounded-2xl lg:border lg:border-line lg:bg-bg/95 lg:px-3 lg:py-2 lg:backdrop-blur">
        <Segmented
          label="Period"
          value={days}
          onChange={(d) => {
            set({ days: String(d) });
            setGroup(d === 7 ? 'day' : 'week');
          }}
          options={[
            { value: 7, label: '7 days' },
            { value: 30, label: '30 days' },
            { value: 90, label: '90 days' },
          ]}
        />
        {me.shops.length > 1 && <ShopSelect value={shopId} onChange={(id) => set({ shopId: id })} className="min-w-44" />}
        <Segmented
          label="Revenue grouped by"
          value={group}
          onChange={setGroup}
          options={[
            { value: 'day', label: 'By day' },
            { value: 'week', label: 'By week' },
            { value: 'month', label: 'By month' },
          ]}
        />
      </div>

      <Section title="Revenue" className="mt-0">
        <QueryState q={revenue}>{() => <RevenuePanels r={revenue.data!} group={group} dim={revenue.isFetching} />}</QueryState>
      </Section>

      <Section title="Utilisation">
        <QueryState q={util}>{() => <UtilisationPanel u={util.data!} low={low.data} dim={util.isFetching} allShops={!shopId && me.shops.length > 1} />}</QueryState>
      </Section>

      <Section title="Peak hours">
        <QueryState q={peak}>
          {() => (
            <ChartFrame
              title="When machines are busy"
              subtitle={`Average share of machines running, by weekday and hour · last ${days} days`}
              dim={peak.isFetching}
              table={
                <DataTable
                  head={['Day', ...Array.from({ length: 24 }, (_, h) => `${h}:00`)]}
                  numeric={Array.from({ length: 24 }, (_, h) => h + 1)}
                  rows={peak.data!.matrix.map((row, d) => [WEEKDAYS[d], ...row.map((v) => (v == null ? 'closed' : pct(v)))])}
                />
              }
              sources={<>{peak.data!.cycles.toLocaleString('en-MY')} recorded cycles (sensor, check-ins, staff and app payments) over open hours only. Hatched cells are hours the shop is closed.</>}
            >
              <Heatmap matrix={peak.data!.matrix} />
            </ChartFrame>
          )}
        </QueryState>
      </Section>

      <Section title="Capacity: add or remove a machine?">
        {shopId || me.shops.length === 1 ? (
          <CapacityPanel shopId={shopId || me.shops[0]!.id} days={days} />
        ) : (
          <EmptyState title="Capacity is worked out per shop">
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {me.shops.map((s) => (
                <Button key={s.id} size="sm" variant="secondary" onClick={() => set({ shopId: s.id })}>
                  {s.name}
                </Button>
              ))}
            </div>
          </EmptyState>
        )}
      </Section>

      <Section title="Electricity per cycle">
        <EnergyPanel days={days} shopId={shopId} />
      </Section>

      <Section title="Revenue by machine">
        <MachineRevenueTable days={days} shopId={shopId} util={util.data} />
      </Section>
    </>
  );
}

function RevenuePanels({ r, group, dim }: { r: RevenueResp; group: Group; dim: boolean }) {
  const data = r.rows.map((x) => ({ key: x.key, label: periodLabel(x.key, group), values: { cash: x.cashSen, app: x.appSen } }));
  const series = [
    { key: 'cash', label: 'Cash collected', color: 'var(--series-1)' },
    { key: 'app', label: 'App payments', color: 'var(--series-2)' },
  ];
  if (!r.rows.length) return <EmptyState title="No revenue recorded in this period" />;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartFrame
        title="Recorded revenue"
        subtitle={
          <>
            {rm0(r.totals.recordedSen)} total · cash {rm0(r.totals.cashSen)} · app {rm0(r.totals.appSen)}
          </>
        }
        legend={series.map((s) => ({ label: s.label, color: s.color }))}
        dim={dim}
        table={
          <DataTable
            head={['Period', 'Cash', 'App', 'Recorded', 'Estimated', 'Cycles']}
            numeric={[1, 2, 3, 4, 5]}
            rows={r.rows.map((x) => [periodLabel(x.key, group), rm(x.cashSen), rm(x.appSen), rm(x.recordedSen), rm(x.estimatedSen), x.cycles])}
          />
        }
        sources={
          <>
            {r.note} Cash is counted on the day it is collected from the machines, so it arrives in lumps — compare over weeks, not days.
          </>
        }
      >
        <ColumnChart
          data={data}
          series={series}
          format={rm}
          tickFormat={rmTick}
          ariaLabel={`Recorded revenue by ${group}, cash and app payments stacked`}
          tipNote={(d) => {
            const row = r.rows.find((x) => x.key === d.key);
            return row ? `Estimated from cycles: ${rm(row.estimatedSen)}` : undefined;
          }}
        />
      </ChartFrame>
      <ChartFrame
        title="Estimated from recorded cycles"
        subtitle={
          <>
            {rm0(r.totals.estimatedSen)} over {r.totals.cycles.toLocaleString('en-MY')} cycles — a steadier view of activity than lumpy cash counts
          </>
        }
        dim={dim}
        table={<DataTable head={['Period', 'Estimated', 'Cycles']} numeric={[1, 2]} rows={r.rows.map((x) => [periodLabel(x.key, group), rm(x.estimatedSen), x.cycles])} />}
        sources={<>Every recorded cycle (sensor, customer check-in, staff, app payment) × its program's list price. Machines without sensors are only as complete as check-ins.</>}
      >
        <LineChart
          points={r.rows.map((x, i) => ({ key: x.key, label: periodLabel(x.key, group), value: x.estimatedSen, extra: `${x.cycles} cycles${i === r.rows.length - 1 ? ' · period still in progress' : ''}` }))}
          color="var(--ink-2)"
          seriesLabel="estimated"
          format={rm}
          tickFormat={rmTick}
          ariaLabel={`Estimated revenue from cycles by ${group}`}
        />
      </ChartFrame>
    </div>
  );
}

function UtilisationPanel({ u, low, dim, allShops }: { u: UtilResp; low?: LowUsageResp; dim: boolean; allShops: boolean }) {
  const short = useShortShopName();
  const flagged = new Map(low?.flagged.map((f) => [f.machineId, f]) ?? []);
  const typeBars: HBar[] = u.byType
    .sort((a, b) => b.key.localeCompare(a.key))
    .map((g) => ({
      key: g.key,
      label: `${typeLabel(g.key)}s`,
      value: g.utilisation,
      valueLabel: pct(g.utilisation),
      tipTitle: `${typeLabel(g.key)}s · ${g.machines} machines`,
      tip: [
        { label: 'of open hours busy', value: pct(g.utilisation) },
        { label: 'cycles', value: g.cycles.toLocaleString('en-MY') },
      ],
    }));
  const machines = [...u.machines].sort((a, b) => b.utilisation - a.utilisation);
  const machineBars: HBar[] = machines.map((m) => {
    const f = flagged.get(m.machineId);
    return {
      key: m.machineId,
      label: allShops ? `${m.code} · ${short(m.shopName)}` : `${m.code} · ${m.capacityKg} kg`,
      value: m.utilisation,
      valueLabel: pct(m.utilisation),
      flag: f ? (
        <StatusTag tone="warning" icon="alert">
          Low usage
        </StatusTag>
      ) : undefined,
      tipTitle: `${m.shopName} · ${m.code} (${typeLabel(m.type)} ${m.capacityKg} kg)`,
      tip: [
        { label: 'utilisation', value: pct(m.utilisation) },
        { label: 'cycles', value: m.cycles.toLocaleString('en-MY') },
      ],
      tipNote: f ? (f.reason === 'silent_24h' ? `No cycles in 24 h while similar machines averaged ${f.peerAvgCycles}` : `Far below similar machines (avg ${f.peerAvgCycles} cycles)`) : m.observed ? 'Sensor-observed' : 'Check-ins only',
    };
  });
  const maxU = Math.max(0.5, ...u.machines.map((m) => m.utilisation), ...u.byType.map((g) => g.utilisation));
  const sources = Object.entries(u.sources)
    .map(([s, n]) => `${n.toLocaleString('en-MY')} ${SOURCE_LABEL[s as keyof typeof SOURCE_LABEL] ?? s}`)
    .join(', ');

  return (
    <ChartFrame
      title="Share of open hours machines were running"
      subtitle={`${machines.length} machines · ${low?.flagged.length ? `${low.flagged.length} flagged for low usage` : 'none flagged for low usage'}`}
      dim={dim}
      table={
        <DataTable
          head={['Machine', 'Shop', 'Type', 'Cycles', 'Utilisation', 'Flag']}
          numeric={[3, 4]}
          rows={machines.map((m) => [m.code, m.shopName, `${typeLabel(m.type)} ${m.capacityKg} kg`, m.cycles, pct(m.utilisation), flagged.has(m.machineId) ? 'Low usage' : ''])}
        />
      }
      sources={<>Recorded cycles{sources ? ` (${sources})` : ''}, measured against each shop's opening hours. Low-usage flags compare each machine with similar machines in the same shop.</>}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div>
          <h4 className="mb-2 text-xs font-medium text-muted">Washers vs dryers</h4>
          <HBarChart bars={typeBars} max={maxU} thickness={20} ariaLabel="Utilisation by machine type" />
        </div>
        <div>
          <h4 className="mb-2 text-xs font-medium text-muted">Per machine, busiest first</h4>
          <HBarChart bars={machineBars} max={maxU} labelWidth={allShops ? 'w-32' : 'w-24'} ariaLabel="Utilisation per machine" />
        </div>
      </div>
    </ChartFrame>
  );
}
