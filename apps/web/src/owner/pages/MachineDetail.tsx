import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Button, Card, EmptyState, StateBadge } from '../../components/ui';
import { ago, dateTime, pct, rm, rm0 } from '../../lib/format';
import { CopyButton, PageHeader, QueryState, Section, SeverityTag, StatTile, StatusTag } from '../components/common';
import { DueItemRow } from '../components/DueItemRow';
import { Icon, type IconName } from '../components/icons';
import { LogMaintenanceModal } from '../components/LogMaintenance';
import { MachineActionsSheet } from '../components/MachineActions';
import { hours, since, useNow } from '../lib/fmt';
import { SOURCE_LABEL, STATE_LABEL, TICKET_STATUS_LABEL, typeLabel } from '../lib/labels';
import { k, useApi } from '../lib/queries';
import { useCan, useShopName } from '../lib/session';
import type { MachineDetail } from '../lib/types';

export function MachineDetailPage() {
  const { id = '' } = useParams();
  const can = useCan();
  const shopName = useShopName();
  const now = useNow();
  const q = useApi<MachineDetail>(k.machine(id), `/owner/machines/${id}`, { refetchInterval: 30_000 });
  const [actions, setActions] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  return (
    <QueryState q={q}>
      {() => {
        const d = q.data!;
        const m = d.machine;
        const downtime = Object.entries(d.stats30d.downtimeHours);
        const downTotal = downtime.reduce((s, [, h]) => s + h, 0);
        return (
          <>
            <PageHeader
              back={`/owner/shops/${m.shopId}`}
              title={
                <>
                  {m.code} · {typeLabel(m.type)} {m.capacityKg} kg
                </>
              }
              subtitle={
                <>
                  {shopName(m.shopId)}
                  {m.brand && ` · ${m.brand}${m.model ? ` ${m.model}` : ''}`}
                </>
              }
              actions={
                <>
                  <Button size="sm" onClick={() => setActions(true)}>
                    Change state
                  </Button>
                  {can('machines.manage') && (
                    <Link to={`/owner/machines/${m.id}/edit`} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">
                      <Icon name="edit" className="h-4 w-4" /> Edit
                    </Link>
                  )}
                </>
              }
            />

            <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
              <StateBadge state={m.state} label={STATE_LABEL[m.state]} className="text-sm" />
              <span className="text-sm text-ink-2">
                for {since(m.stateSince, now)} · source: {SOURCE_LABEL[m.stateSource]}
              </span>
              {m.adminReason && <span className="text-sm text-ink-2">Reason shown to customers: “{m.adminReason}”</span>}
              {m.state === 'offline' && <span className="text-sm text-muted">The sensor stopped reporting — check its power and Wi-Fi. The machine itself may still work on coins.</span>}
            </Card>

            <Section title="Last 30 days">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatTile label="Cycles" value={d.stats30d.cycles.toLocaleString('en-MY')} />
                <StatTile label="Utilisation" value={pct(d.stats30d.utilisation)} hint="of open hours busy" />
                {can('revenue.view') && <StatTile label="Revenue (est.)" value={rm0(d.stats30d.estimatedRevenueSen)} hint="recorded cycles × list price" />}
                <StatTile
                  label="Downtime"
                  value={downTotal ? hours(downTotal) : 'None'}
                  tone={downTotal > 24 ? 'serious' : downTotal > 0 ? 'warning' : 'good'}
                  hint={downtime.length ? downtime.map(([s, h]) => `${STATE_LABEL[s as keyof typeof STATE_LABEL] ?? s} ${hours(h)}`).join(' · ') : 'no fault, offline or maintenance time'}
                />
              </div>
            </Section>

            <div className="grid gap-x-6 lg:grid-cols-2">
              <Section
                title="Maintenance"
                action={
                  can('maintenance.log') && (
                    <Button size="sm" variant="secondary" onClick={() => setLogOpen(true)}>
                      Log other work
                    </Button>
                  )
                }
              >
                {d.due.length === 0 ? (
                  <EmptyState title="No maintenance plan covers this machine">
                    <Link to="/owner/maintenance" className="font-medium text-brand underline">
                      Set up plans
                    </Link>
                  </EmptyState>
                ) : (
                  <Card className="divide-y divide-line">
                    {d.due.map((x) => (
                      <DueItemRow key={x.planId} d={x} showMachine={false} />
                    ))}
                  </Card>
                )}
              </Section>

              <Section title="Sensor">
                <Card className="p-4 text-sm">
                  {d.device ? (
                    <dl className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="text-xs text-muted">Status</dt>
                        <dd className="mt-0.5">{d.device.online ? <StatusTag tone="good">Online</StatusTag> : <StatusTag tone="warning">Not reporting</StatusTag>}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Last seen</dt>
                        <dd className="mt-0.5 font-medium">{ago(d.device.last_seen_at)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Last power reading</dt>
                        <dd className="mt-0.5 font-medium">{d.device.last_power_w != null ? `${d.device.last_power_w} W` : '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Device</dt>
                        <dd className="mt-0.5 font-medium">
                          {d.device.label || d.device.kind} <span className="text-xs text-muted">· heartbeat {d.device.heartbeat_sec}s</span>
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="text-ink-2">
                      No sensor attached. State comes from customer check-ins and staff.{' '}
                      {can('machines.manage') && (
                        <Link to="/owner/devices" className="font-medium text-brand underline">
                          Register a sensor
                        </Link>
                      )}
                    </p>
                  )}
                </Card>
              </Section>
            </div>

            <div className="grid gap-x-6 lg:grid-cols-[1fr_280px]">
              <Section title="History">
                <Timeline d={d} showMoney={can('revenue.view')} />
              </Section>
              <Section title="QR sticker">
                <Card className="p-4">
                  <img src={`/api/v1/owner/machines/${m.id}/qr.svg`} alt={`QR code for ${m.code}`} className="mx-auto aspect-square w-40 rounded-lg bg-white p-1" />
                  <p className="mt-2 break-all text-center text-xs text-muted">{m.qrUrl}</p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    <CopyButton text={m.qrUrl} label="Copy link" />
                    <Link to={`/owner/shops/${m.shopId}/qr-sheet`} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">
                      <Icon name="print" className="h-4 w-4" /> Print sheet
                    </Link>
                  </div>
                </Card>
              </Section>
            </div>

            <MachineActionsSheet machine={m} open={actions} onClose={() => setActions(false)} />
            <LogMaintenanceModal open={logOpen} onClose={() => setLogOpen(false)} machineId={m.id} machineCode={m.code} />
          </>
        );
      }}
    </QueryState>
  );
}

interface TimelineEntry {
  at: string;
  icon: IconName;
  title: ReactNode;
  detail?: ReactNode;
  link?: string;
}

/** State changes, cycles, tickets and maintenance merged into one newest-first list. */
function Timeline({ d, showMoney }: { d: MachineDetail; showMoney: boolean }) {
  const [limit, setLimit] = useState(30);
  const entries: TimelineEntry[] = [
    ...d.stateLog.map((s) => ({
      at: s.started_at,
      icon: 'info' as IconName,
      title: (
        <>
          State → <StateBadge state={s.state} label={STATE_LABEL[s.state]} />
        </>
      ),
      detail: [SOURCE_LABEL[s.source], s.reason, s.ended_at ? `lasted ${hours((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 3600_000)}` : 'current'].filter(Boolean).join(' · '),
    })),
    ...d.cycles.map((c) => ({
      at: c.started_at,
      icon: 'play' as IconName,
      title: `Cycle ${c.program_name ?? ''} · ${c.duration_min} min`,
      detail: [
        `via ${SOURCE_LABEL[c.source as keyof typeof SOURCE_LABEL] ?? c.source}`,
        c.sensor_confirmed ? 'sensor-confirmed' : null,
        c.status,
        showMoney && c.price_sen != null ? rm(c.price_sen) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    })),
    ...d.tickets.map((t) => ({
      at: t.created_at,
      icon: 'ticket' as IconName,
      title: (
        <>
          Ticket #{t.ref} {t.title} <SeverityTag severity={t.severity} />
        </>
      ),
      detail: `${TICKET_STATUS_LABEL[t.status]} · from ${t.source}`,
      link: `/owner/tickets/${t.id}`,
    })),
    ...d.maintenance.map((x) => ({
      at: x.performed_at,
      icon: 'wrench' as IconName,
      title: `Maintenance: ${x.plan_title ?? 'ad-hoc work'}`,
      detail: [x.by_name, x.notes, x.cost_sen != null && showMoney ? rm(x.cost_sen) : null].filter(Boolean).join(' · '),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (!entries.length) return <EmptyState title="No history yet" />;
  return (
    <Card className="p-2">
      <ol>
        {entries.slice(0, limit).map((e, i) => {
          const body = (
            <>
              <span className="mt-0.5 rounded-full bg-surface-2 p-1.5 text-ink-2">
                <Icon name={e.icon} className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{e.title}</div>
                {e.detail && <div className="mt-0.5 text-xs text-muted">{e.detail}</div>}
              </div>
              <time className="shrink-0 text-xs text-muted" dateTime={e.at}>
                {dateTime(e.at)}
              </time>
            </>
          );
          return (
            <li key={i}>
              {e.link ? (
                <Link to={e.link} className="flex items-start gap-3 rounded-xl p-2 hover:bg-surface-2">
                  {body}
                </Link>
              ) : (
                <div className="flex items-start gap-3 p-2">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
      {entries.length > limit && (
        <Button variant="ghost" size="sm" block onClick={() => setLimit((l) => l + 30)}>
          Show more
        </Button>
      )}
    </Card>
  );
}
