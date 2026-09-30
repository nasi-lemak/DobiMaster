import { useId, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { TICKET_CATEGORIES, TICKET_SEVERITIES, type TicketCategory, type TicketSeverity, type TicketStatus } from '@dobi/shared';
import { api, uuid } from '../../lib/api';
import { Button, Card, EmptyState, Field, inputClass } from '../../components/ui';
import { ago, rm } from '../../lib/format';
import { Modal, MutationError, PageHeader, QueryState, SeverityTag, ShopSelect, StatusTag, type Tone } from '../components/common';
import { Icon } from '../components/icons';
import { CATEGORY_LABEL, SEVERITY_LABEL, TICKET_STATUS_LABEL } from '../lib/labels';
import { k, qs, useApi, useApiMutation } from '../lib/queries';
import { useCan, useMe } from '../lib/session';
import type { OwnerMachine, TicketListRow } from '../lib/types';

export const TICKET_STATUS_TONE: Record<TicketStatus, Tone> = { open: 'warning', in_progress: 'info', resolved: 'good', rejected: 'neutral' };

const STATUS_FILTERS = [
  { value: 'active', label: 'Active (open + in progress)' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

export function TicketsPage() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'active';
  const shopId = params.get('shopId') ?? '';
  const machineId = params.get('machineId') ?? '';
  const [creating, setCreating] = useState(false);
  const statusId = useId();
  const q = useApi<{ tickets: TicketListRow[] }>(k.tickets(status, shopId || undefined, machineId || undefined), `/owner/tickets${qs({ status, shopId, machineId })}`, {
    refetchInterval: 30_000,
    keepPrevious: true,
  });
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, v] of Object.entries(patch)) v ? next.set(key, v) : next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Tickets"
        subtitle="Customer reports and staff issues"
        actions={
          can('tickets.manage') && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Icon name="plus" className="h-4 w-4" /> New ticket
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <label htmlFor={statusId} className="sr-only">
          Status
        </label>
        <select id={statusId} className={`${inputClass} w-auto py-2`} value={status} onChange={(e) => set({ status: e.target.value })}>
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <ShopSelect value={shopId} onChange={(id) => set({ shopId: id, machineId: '' })} className="min-w-48" />
        {machineId && (
          <Button variant="secondary" size="sm" onClick={() => set({ machineId: '' })}>
            One machine only <Icon name="x" className="h-4 w-4" />
          </Button>
        )}
      </div>
      <QueryState q={q}>
        {() =>
          q.data!.tickets.length === 0 ? (
            <EmptyState title="No tickets match">Customer reports arrive here as soon as they are sent.</EmptyState>
          ) : (
            <Card className={`divide-y divide-line overflow-hidden transition-opacity ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
              {q.data!.tickets.map((t) => (
                <Link key={t.id} to={`/owner/tickets/${t.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                  <div className="w-20 shrink-0 pt-0.5">
                    <SeverityTag severity={t.severity} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      <span className="text-muted">#{t.ref}</span> {t.title}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {t.shop_name}
                      {t.machine_code && ` · ${t.machine_code}`} · {CATEGORY_LABEL[t.category as TicketCategory] ?? t.category} · {t.source} · {ago(t.created_at)}
                      {t.amount_claimed_sen != null && ` · claims ${rm(t.amount_claimed_sen)}`}
                      {t.assignee_name && ` · → ${t.assignee_name}`}
                    </div>
                  </div>
                  <StatusTag tone={TICKET_STATUS_TONE[t.status]}>{TICKET_STATUS_LABEL[t.status]}</StatusTag>
                </Link>
              ))}
            </Card>
          )
        }
      </QueryState>
      <NewTicketModal open={creating} onClose={() => setCreating(false)} defaultShopId={shopId} />
    </>
  );
}

function NewTicketModal({ open, onClose, defaultShopId }: { open: boolean; onClose: () => void; defaultShopId: string }) {
  const me = useMe();
  const navigate = useNavigate();
  const [shopId, setShopId] = useState(defaultShopId || me.shops[0]?.id || '');
  const [machineId, setMachineId] = useState('');
  const [category, setCategory] = useState<TicketCategory>('other');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [severity, setSeverity] = useState<TicketSeverity | ''>('');
  const machines = useApi<{ machines: OwnerMachine[] }>(k.machines(shopId), `/owner/machines${qs({ shopId })}`, { enabled: open && !!shopId });
  const create = useApiMutation(
    () =>
      api.post<{ ticket: { id: string } }>('/owner/tickets', {
        id: uuid(),
        shopId,
        machineId: machineId || null,
        category,
        title: title.trim() || undefined,
        details: details.trim() || null,
        severity: severity || undefined,
      }),
    [['owner', 'tickets'], ['owner', 'overview']],
    (r) => {
      onClose();
      navigate(`/owner/tickets/${r.ticket.id}`);
    },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New ticket"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate(undefined)} disabled={create.isPending || !shopId}>
            {create.isPending ? 'Creating…' : 'Create ticket'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <span className="mb-1 block text-sm font-medium">Shop</span>
          <ShopSelect value={shopId} onChange={(id) => (setShopId(id), setMachineId(''))} allowAll={false} />
        </div>
        <Field label="Machine (optional)">
          <select className={inputClass} value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            <option value="">Whole shop / not machine-specific</option>
            {machines.data?.machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} · {m.type} {m.capacityKg} kg
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)}>
            {TICKET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title (optional)" hint="Defaults to the machine and category">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Details (optional)">
          <textarea className={inputClass} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={4000} />
        </Field>
        <Field label="Priority">
          <select className={inputClass} value={severity} onChange={(e) => setSeverity(e.target.value as TicketSeverity | '')}>
            <option value="">Automatic (from category)</option>
            {TICKET_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <MutationError error={create.error} />
      </div>
    </Modal>
  );
}
