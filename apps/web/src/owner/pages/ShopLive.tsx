import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Card, EmptyState } from '../../components/ui';
import { ago } from '../../lib/format';
import { Meter, PageHeader, QueryState, Section, SeverityTag, StatusTag } from '../components/common';
import { Icon } from '../components/icons';
import { MachineActionsSheet } from '../components/MachineActions';
import { MachineTile } from '../components/MachineTile';
import { useNow } from '../lib/fmt';
import { k, qs, useApi } from '../lib/queries';
import { useCan } from '../lib/session';
import type { ChecklistRun, LiveMachine, ShopLive, TicketListRow } from '../lib/types';

export function ShopLivePage() {
  const { id = '' } = useParams();
  const can = useCan();
  const now = useNow(30_000);
  const q = useApi<ShopLive>(k.shop(id), `/owner/shops/${id}`, { refetchInterval: 30_000 });
  const [active, setActive] = useState<string | null>(null);

  return (
    <QueryState q={q}>
      {() => {
        const { shop, machines } = q.data!;
        const washers = machines.filter((m) => m.type === 'washer');
        const dryers = machines.filter((m) => m.type === 'dryer');
        const activeMachine = machines.find((m) => m.id === active);
        const count = (s: string) => machines.filter((m) => m.state === s).length;
        return (
          <>
            <PageHeader
              back="/owner"
              title={shop.name}
              subtitle={
                <>
                  {count('running')} running · {count('available')} free · {count('finished')} finished
                  {count('fault') > 0 && ` · ${count('fault')} fault`}
                  {count('offline') > 0 && ` · ${count('offline')} sensor offline`}
                </>
              }
              actions={
                <>
                  <Link to={`/owner/shops/${id}/qr-sheet`} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">
                    <Icon name="qr" className="h-4 w-4" /> QR stickers
                  </Link>
                  {can('shops.manage') && (
                    <Link to={`/owner/settings?shop=${id}`} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">
                      <Icon name="settings" className="h-4 w-4" /> Settings
                    </Link>
                  )}
                </>
              }
            />
            {machines.length === 0 ? (
              <EmptyState title="No machines yet">
                {can('machines.manage') ? (
                  <Link className="font-medium text-brand underline" to={`/owner/machines?shop=${id}`}>
                    Add machines
                  </Link>
                ) : (
                  'Ask the owner to add machines.'
                )}
              </EmptyState>
            ) : (
              <>
                <MachineGroup title="Washers" list={washers} now={now} onActions={setActive} />
                <MachineGroup title="Dryers" list={dryers} now={now} onActions={setActive} />
              </>
            )}
            <div className="grid gap-x-6 lg:grid-cols-2">
              <ShopChecklists shopId={id} />
              <ShopTickets shopId={id} />
            </div>
            {activeMachine && <MachineActionsSheet machine={activeMachine} open onClose={() => setActive(null)} />}
          </>
        );
      }}
    </QueryState>
  );
}

function MachineGroup({ title, list, now, onActions }: { title: string; list: LiveMachine[]; now: number; onActions: (id: string) => void }) {
  if (!list.length) return null;
  return (
    <Section title={`${title} (${list.length})`} className="first-of-type:mt-0">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {list.map((m) => (
          <MachineTile key={m.id} m={m} now={now} onActions={() => onActions(m.id)} />
        ))}
      </div>
    </Section>
  );
}

function ShopChecklists({ shopId }: { shopId: string }) {
  const q = useApi<{ runs: ChecklistRun[] }>(k.checklistsToday(shopId), `/owner/checklists/today${qs({ shopId })}`);
  return (
    <Section title="Today's checklist" action={<Link className="text-sm font-medium text-brand" to="/owner/checklists">Open</Link>}>
      <QueryState q={q}>
        {() =>
          q.data!.runs.length === 0 ? (
            <EmptyState title="No checklist for this shop" />
          ) : (
            <Card className="divide-y divide-line">
              {q.data!.runs.map((r) => (
                <Link key={r.runId} to="/owner/checklists" className="block p-4 hover:bg-surface-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{r.name}</span>
                    {r.completedAt ? (
                      <StatusTag tone="good">Done</StatusTag>
                    ) : (
                      <span className="tabular text-muted">
                        {r.done}/{r.total} done
                      </span>
                    )}
                  </div>
                  <Meter className="mt-2" value={r.total ? r.done / r.total : 0} tone={r.completedAt ? 'good' : 'info'} label={`${r.name} progress`} />
                </Link>
              ))}
            </Card>
          )
        }
      </QueryState>
    </Section>
  );
}

function ShopTickets({ shopId }: { shopId: string }) {
  const q = useApi<{ tickets: TicketListRow[] }>(k.tickets('active', shopId), `/owner/tickets${qs({ status: 'active', shopId })}`);
  return (
    <Section title="Open tickets" action={<Link className="text-sm font-medium text-brand" to={`/owner/tickets?shopId=${shopId}`}>All</Link>}>
      <QueryState q={q}>
        {() =>
          q.data!.tickets.length === 0 ? (
            <Card className="flex items-center gap-2 p-4 text-sm">
              <StatusTag tone="good">None</StatusTag> No open tickets.
            </Card>
          ) : (
            <Card className="divide-y divide-line">
              {q.data!.tickets.slice(0, 8).map((t) => (
                <Link key={t.id} to={`/owner/tickets/${t.id}`} className="flex items-start gap-3 p-3.5 hover:bg-surface-2">
                  <div className="w-20 shrink-0">
                    <SeverityTag severity={t.severity} />
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-medium">
                      #{t.ref} {t.title}
                    </div>
                    <div className="text-xs text-muted">{ago(t.created_at)}</div>
                  </div>
                </Link>
              ))}
            </Card>
          )
        }
      </QueryState>
    </Section>
  );
}
