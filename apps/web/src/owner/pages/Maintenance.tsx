import { useState } from 'react';
import type { MachineType } from '@dobi/shared';
import { api } from '../../lib/api';
import { Button, Card, EmptyState, Field, inputClass } from '../../components/ui';
import { MutationError, PageHeader, QueryState, Section, Segmented, ShopSelect, StatusTag } from '../components/common';
import { DueItemRow } from '../components/DueItemRow';
import { Icon } from '../components/icons';
import { typeLabel } from '../lib/labels';
import { k, qs, useApi, useApiMutation } from '../lib/queries';
import { useCan, useMe } from '../lib/session';
import type { DueItem, OwnerMachine, PlanRow } from '../lib/types';

export function MaintenancePage() {
  const me = useMe();
  const can = useCan();
  const [shopId, setShopId] = useState('');
  const [filter, setFilter] = useState<'attention' | 'all'>('attention');
  const due = useApi<{ items: DueItem[] }>(k.due(shopId || undefined), `/owner/maintenance/due${qs({ shopId })}`);
  const shortName = (id: string) => me.shops.find((s) => s.id === id)?.name ?? '';

  return (
    <>
      <PageHeader title="Maintenance" subtitle="Preventive work by calendar, cycles or run-hours" />
      <div className="mb-4 flex flex-wrap gap-2">
        {me.shops.length > 1 && <ShopSelect value={shopId} onChange={setShopId} className="min-w-48" />}
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'attention', label: 'Due & due soon' },
            { value: 'all', label: 'All machines' },
          ]}
        />
      </div>
      <Section title="Due list" className="mt-0">
        <QueryState q={due}>
          {() => {
            const items = due.data!.items.filter((d) => filter === 'all' || d.status !== 'ok');
            if (!items.length)
              return (
                <Card className="flex items-center gap-2 p-4 text-sm">
                  <StatusTag tone="good">All caught up</StatusTag> Nothing is due.
                </Card>
              );
            const byShop = new Map<string, DueItem[]>();
            for (const d of items) byShop.set(d.shopId, [...(byShop.get(d.shopId) ?? []), d]);
            return (
              <div className="space-y-4">
                {[...byShop].map(([sid, list]) => (
                  <div key={sid}>
                    {me.shops.length > 1 && <h3 className="mb-1.5 text-sm font-medium text-ink-2">{shortName(sid)}</h3>}
                    <Card className="divide-y divide-line">
                      {list.map((d) => (
                        <DueItemRow key={`${d.planId}-${d.machineId}`} d={d} />
                      ))}
                    </Card>
                  </div>
                ))}
              </div>
            );
          }}
        </QueryState>
      </Section>
      <Plans canManage={can('maintenance.manage')} shopId={shopId} />
    </>
  );
}

function intervals(p: PlanRow) {
  return [p.interval_days && `every ${p.interval_days} days`, p.interval_cycles && `every ${p.interval_cycles} cycles`, p.interval_run_hours && `every ${p.interval_run_hours} run-hours`]
    .filter(Boolean)
    .join(' or ');
}

function Plans({ canManage, shopId }: { canManage: boolean; shopId: string }) {
  const q = useApi<{ plans: PlanRow[] }>(k.plans, '/owner/maintenance/plans');
  const [adding, setAdding] = useState(false);
  const toggle = useApiMutation((p: PlanRow) => api.patch(`/owner/maintenance/plans/${p.id}`, { active: !p.active }), [['owner', 'maintenance'], ['owner', 'machine']]);
  return (
    <Section
      title="Plans"
      action={
        canManage &&
        !adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Icon name="plus" className="h-4 w-4" /> New plan
          </Button>
        )
      }
    >
      {adding && <PlanForm onDone={() => setAdding(false)} defaultShopId={shopId} />}
      <QueryState q={q}>
        {() => {
          const plans = q.data!.plans.filter((p) => !shopId || p.shop_id === shopId);
          if (!plans.length) return <EmptyState title="No maintenance plans yet">Start with “Clean dryer lint duct every 30 days”.</EmptyState>;
          return (
            <Card className="divide-y divide-line" role="list" aria-label="Maintenance plans">
              {plans.map((p) => (
                <div key={p.id} role="listitem" className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{p.title}</div>
                    <div className="text-xs text-muted">
                      {p.shop_name} · {p.machine_code ? `machine ${p.machine_code}` : `all ${typeLabel(p.machine_type ?? '').toLowerCase()}s`} · {intervals(p)}
                    </div>
                  </div>
                  {p.active ? <StatusTag tone="good">Active</StatusTag> : <StatusTag tone="neutral" icon="pause">Paused</StatusTag>}
                  {canManage && (
                    <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(p)}>
                      {p.active ? 'Pause' : 'Resume'}
                    </Button>
                  )}
                </div>
              ))}
            </Card>
          );
        }}
      </QueryState>
      <MutationError error={toggle.error} />
    </Section>
  );
}

function PlanForm({ onDone, defaultShopId }: { onDone: () => void; defaultShopId: string }) {
  const me = useMe();
  const [shopId, setShopId] = useState(defaultShopId || me.shops[0]?.id || '');
  const [scope, setScope] = useState<string>('type:dryer');
  const [title, setTitle] = useState('');
  const [days, setDays] = useState('');
  const [cycles, setCycles] = useState('');
  const [runHours, setRunHours] = useState('');
  const machines = useApi<{ machines: OwnerMachine[] }>(k.machines(shopId), `/owner/machines${qs({ shopId })}`, { enabled: !!shopId });
  const num = (v: string) => (v.trim() ? Number(v) : null);
  const create = useApiMutation(
    () => {
      const [kind, val] = scope.split(':') as ['type' | 'machine', string];
      return api.post('/owner/maintenance/plans', {
        shopId,
        machineId: kind === 'machine' ? val : null,
        machineType: kind === 'type' ? (val as MachineType) : null,
        title: title.trim(),
        intervalDays: num(days),
        intervalCycles: num(cycles),
        intervalRunHours: num(runHours),
      });
    },
    [['owner', 'maintenance'], ['owner', 'machine']],
    () => onDone(),
  );
  const anyInterval = [days, cycles, runHours].some((v) => v.trim());
  const badNumber = [days, cycles, runHours].some((v) => v.trim() && !/^\d+$/.test(v.trim()));

  return (
    <Card className="mb-3 space-y-3 p-4" role="region" aria-labelledby="new-plan-title">
      <h3 id="new-plan-title" className="font-semibold">
        New maintenance plan
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-sm font-medium">Shop</span>
          <ShopSelect
            value={shopId}
            onChange={(id) => {
              setShopId(id);
              // "Only W1" referred to a machine in the previous shop: fall back to its machine type there.
              if (scope.startsWith('machine:')) setScope(`type:${machines.data?.machines.find((m) => `machine:${m.id}` === scope)?.type ?? 'dryer'}`);
            }}
            allowAll={false}
          />
        </div>
        <Field label="Applies to">
          <select className={inputClass} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="type:washer">All washers</option>
            <option value="type:dryer">All dryers</option>
            {machines.data?.machines.map((m) => (
              <option key={m.id} value={`machine:${m.id}`}>
                Only {m.code} ({m.type} {m.capacityKg} kg)
              </option>
            ))}
          </select>
        </Field>
        <Field label="What needs doing">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Clean lint duct & check burner" />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Due every… (whichever comes first)</legend>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Days">
            <input className={inputClass} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="30" />
          </Field>
          <Field label="Cycles">
            <input className={inputClass} inputMode="numeric" value={cycles} onChange={(e) => setCycles(e.target.value)} placeholder="500" />
          </Field>
          <Field label="Run-hours">
            <input className={inputClass} inputMode="numeric" value={runHours} onChange={(e) => setRunHours(e.target.value)} placeholder="200" />
          </Field>
        </div>
      </fieldset>
      {badNumber && <p className="text-sm text-critical-ink">Intervals must be whole numbers.</p>}
      <MutationError error={create.error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={create.isPending || title.trim().length < 2 || !anyInterval || badNumber || !shopId} onClick={() => create.mutate(undefined)}>
          {create.isPending ? 'Saving…' : 'Create plan'}
        </Button>
      </div>
    </Card>
  );
}
