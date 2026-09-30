import { Link } from 'react-router';
import { Card, EmptyState } from '../../components/ui';
import { ago, pct, rm0 } from '../../lib/format';
import { PageHeader, QueryState, Section, SeverityTag, StatTile, StatusTag } from '../components/common';
import { Icon } from '../components/icons';
import { PushButton } from '../components/PushButton';
import { k, useApi } from '../lib/queries';
import { useCan, useMe } from '../lib/session';
import type { AttentionItem, Branch, Overview } from '../lib/types';

export function OverviewPage() {
  const me = useMe();
  const can = useCan();
  const q = useApi<Overview>(k.overview, '/owner/overview', { refetchInterval: 30_000 });
  const today = new Date().toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <>
      <PageHeader title={`Today · ${me.shops.length > 1 ? 'all branches' : (me.shops[0]?.name ?? '')}`} subtitle={today} actions={<PushButton />} />
      <QueryState q={q}>
        {() => {
          const d = q.data!;
          if (!d.totals) return <EmptyState title="No branches yet">Add a shop to get started.</EmptyState>;
          return (
            <>
              <Totals d={d} showRevenue={can('revenue.view')} />
              <Attention items={d.attention} />
              <Section title="Branches">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {d.branches.map((b) => (
                    <BranchCard key={b.id} b={b} />
                  ))}
                </div>
              </Section>
            </>
          );
        }}
      </QueryState>
    </>
  );
}

function Totals({ d, showRevenue }: { d: Overview; showRevenue: boolean }) {
  const t = d.totals!;
  const needs = d.attention.length;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {showRevenue && t.estRevenueTodaySen != null && (
        <StatTile label="Revenue today" value={rm0(t.estRevenueTodaySen)} hint={<>est. from recorded cycles · app {rm0(t.appRevenueTodaySen)}</>} />
      )}
      <StatTile label="Running now" value={`${t.running}/${t.machines}`} hint={`${t.cyclesToday} cycles today`} />
      <StatTile label="Utilisation today" value={pct(t.utilisationToday)} hint="of open hours busy" />
      <StatTile label="Sensors offline" value={t.offline} tone={t.offline ? 'warning' : 'good'} hint={t.offline ? 'check power / Wi-Fi · coins still work' : 'all sensors reporting'} />
      <StatTile label="Faults" value={t.fault} tone={t.fault ? 'critical' : 'good'} hint={`${t.openTickets} open ticket${t.openTickets === 1 ? '' : 's'}`} to="/owner/tickets" />
      <StatTile label="Need action" value={needs} tone={needs ? 'warning' : 'good'} hint={t.pendingRefunds ? `${t.pendingRefunds} refund${t.pendingRefunds === 1 ? '' : 's'} pending` : 'see list below'} />
    </div>
  );
}

function Attention({ items }: { items: AttentionItem[] }) {
  return (
    <Section title={`Needs attention${items.length ? ` (${items.length})` : ''}`}>
      {items.length === 0 ? (
        <Card className="flex items-center gap-2 p-4 text-sm">
          <StatusTag tone="good">All clear</StatusTag>
          Nothing needs you right now.
        </Card>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {items.map((a, i) => (
            <Link key={`${a.kind}-${a.link}-${i}`} to={a.link} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
              <div className="w-20 shrink-0 pt-0.5">
                <SeverityTag severity={a.severity} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{a.title}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {a.shopName ?? 'All shops'} · {ago(a.at)}
                </div>
              </div>
              <Icon name="chevron" className="mt-1 h-4 w-4 shrink-0 text-muted" />
            </Link>
          ))}
        </Card>
      )}
    </Section>
  );
}

function Count({ n, label, icon, cls }: { n: number; label: string; icon: string; cls: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-sm ${n ? cls : 'text-muted'}`}>
      <span aria-hidden className="text-[10px]">
        {icon}
      </span>
      <span className="font-semibold tabular">{n}</span> {label}
    </span>
  );
}

function BranchCard({ b }: { b: Branch }) {
  return (
    <Link to={`/owner/shops/${b.id}`} className="block rounded-2xl border border-line bg-surface p-4 hover:bg-surface-2">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{b.name}</h3>
        <Icon name="chevron" className="mt-1 h-4 w-4 shrink-0 text-muted" />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        <Count n={b.running} label="running" icon="◐" cls="text-info-ink" />
        <Count n={b.available} label="free" icon="●" cls="text-good-ink" />
        {b.finished > 0 && <Count n={b.finished} label="finished" icon="◉" cls="text-warning-ink" />}
        <Count n={b.fault} label="fault" icon="✕" cls="text-critical-ink" />
        <Count n={b.offline} label="sensor offline" icon="○" cls="text-ink-2" />
        {b.maintenance > 0 && <Count n={b.maintenance} label="out of service" icon="⚙" cls="text-serious-ink" />}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
        <div>
          <dt className="text-muted">Cycles today</dt>
          <dd className="mt-0.5 text-base font-semibold">{b.cyclesToday}</dd>
        </div>
        <div>
          <dt className="text-muted">Utilisation</dt>
          <dd className="mt-0.5 text-base font-semibold">{pct(b.utilisationToday)}</dd>
        </div>
        {b.estRevenueTodaySen != null ? (
          <div>
            <dt className="text-muted">Revenue (est.)</dt>
            <dd className="mt-0.5 text-base font-semibold">{rm0(b.estRevenueTodaySen)}</dd>
          </div>
        ) : (
          <div>
            <dt className="text-muted">Open tickets</dt>
            <dd className="mt-0.5 text-base font-semibold">{b.openTickets}</dd>
          </div>
        )}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        {b.sensorCoverage >= 1 ? (
          <StatusTag tone="good" icon="sensor">
            Live sensors on all {b.machines}
          </StatusTag>
        ) : b.sensorCoverage > 0 ? (
          <StatusTag tone="info" icon="sensor">
            Sensors on {pct(b.sensorCoverage)} of machines
          </StatusTag>
        ) : (
          <StatusTag tone="neutral" icon="sensor">
            No sensors · check-ins only
          </StatusTag>
        )}
        {b.estRevenueTodaySen != null && b.openTickets > 0 && <span>{b.openTickets} open tickets</span>}
      </div>
    </Link>
  );
}
