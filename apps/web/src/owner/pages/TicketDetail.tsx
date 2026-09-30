import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { REFUND_METHODS, TICKET_SEVERITIES, TICKET_STATUSES, type RefundMethod, type TicketCategory, type TicketSeverity, type TicketStatus } from '@dobi/shared';
import { api } from '../../lib/api';
import { Button, Card, Field, inputClass, StateBadge } from '../../components/ui';
import { ago, clock, dateTime, rm } from '../../lib/format';
import { MutationError, PageHeader, QueryState, Section, Segmented, SeverityTag, StatusTag } from '../components/common';
import { Icon, type IconName } from '../components/icons';
import { parseRm, senToRmInput } from '../lib/fmt';
import { CATEGORY_LABEL, REFUND_METHOD_LABEL, REFUND_STATUS_LABEL, SEVERITY_LABEL, STATE_LABEL, TICKET_STATUS_LABEL } from '../lib/labels';
import { k, useApi, useApiMutation } from '../lib/queries';
import { useCan } from '../lib/session';
import type { StaffRow, TicketDetail, TicketEvent } from '../lib/types';
import { TICKET_STATUS_TONE } from './Tickets';
import { REFUND_TONE } from './Refunds';

export function TicketDetailPage() {
  const { id = '' } = useParams();
  const can = useCan();
  const q = useApi<TicketDetail>(k.ticket(id), `/owner/tickets/${id}`, { refetchInterval: 30_000 });
  const staff = useApi<{ staff: StaffRow[] }>(k.staff, '/owner/staff');
  const staffName = (uid: unknown) => staff.data?.staff.find((s) => s.id === uid)?.name ?? 'someone';

  return (
    <QueryState q={q}>
      {() => {
        const d = q.data!;
        const t = d.ticket;
        return (
          <>
            <PageHeader
              back="/owner/tickets"
              title={
                <>
                  <span className="text-muted">#{t.ref}</span> {t.title}
                </>
              }
              subtitle={
                <>
                  {d.shop.name}
                  {d.machine && (
                    <>
                      {' · '}
                      <Link className="font-medium text-brand" to={`/owner/machines/${d.machine.id}`}>
                        {d.machine.code}
                      </Link>
                    </>
                  )}{' '}
                  · {CATEGORY_LABEL[t.category as TicketCategory] ?? t.category} · from {t.source} · {dateTime(t.created_at)}
                </>
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              <StatusTag tone={TICKET_STATUS_TONE[t.status]}>{TICKET_STATUS_LABEL[t.status]}</StatusTag>
              <SeverityTag severity={t.severity} withWord />
              {d.machine && <StateBadge state={d.machine.state} label={`${d.machine.code}: ${STATE_LABEL[d.machine.state]}`} />}
            </div>

            <div className="grid gap-x-6 lg:grid-cols-[1fr_360px]">
              <div>
                {can('tickets.manage') && <TicketControls d={d} staff={staff.data?.staff ?? []} />}
                {d.photos.length > 0 && (
                  <Section title={`Photos from the customer (${d.photos.length})`}>
                    <div className="flex flex-wrap gap-2">
                      {d.photos.map((p) => (
                        <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block">
                          <img src={p.url} alt="Customer photo" loading="lazy" className="h-28 w-28 rounded-xl border border-line object-cover sm:h-36 sm:w-36" />
                        </a>
                      ))}
                    </div>
                  </Section>
                )}
                <Section title="Timeline">
                  <Card className="p-2">
                    <ol>
                      {d.events.map((e) => (
                        <EventRow key={e.id} e={e} staffName={staffName} />
                      ))}
                    </ol>
                  </Card>
                </Section>
              </div>
              <div>
                <Section title="Customer claim">
                  <Card className="space-y-2 p-4 text-sm">
                    <Row label="Amount claimed">{t.amount_claimed_sen != null ? rm(t.amount_claimed_sen) : '—'}</Row>
                    <Row label="Contact phone">
                      {t.contact_phone ? (
                        can('refunds.decide') ? (
                          <a className="font-medium text-brand" href={`https://wa.me/${t.contact_phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
                            {t.contact_phone}
                          </a>
                        ) : (
                          t.contact_phone
                        )
                      ) : (
                        '—'
                      )}
                    </Row>
                    {d.payment && (
                      <Row label="App payment">
                        {rm(d.payment.amount_sen)} · {d.payment.status}
                        {d.payment.refunded_sen > 0 && ` · ${rm(d.payment.refunded_sen)} refunded`}
                      </Row>
                    )}
                    {d.cycle && (
                      <Row label="Linked cycle">
                        {d.cycle.program_name ?? 'Cycle'} · {d.cycle.status} · started {clock(d.cycle.started_at)} · via {d.cycle.source}
                        {d.cycle.sensor_confirmed ? ' · sensor-confirmed' : ' · not sensor-confirmed'}
                      </Row>
                    )}
                  </Card>
                </Section>
                <Refunds d={d} />
              </div>
            </div>
          </>
        );
      }}
    </QueryState>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

function TicketControls({ d, staff }: { d: TicketDetail; staff: StaffRow[] }) {
  const t = d.ticket;
  const [comment, setComment] = useState('');
  const inv = [['owner', 'ticket', t.id], ['owner', 'tickets'], ['owner', 'overview'], ['owner', 'shop'], ['owner', 'machine']];
  const patch = useApiMutation((b: { status?: TicketStatus; severity?: TicketSeverity; assignedTo?: string | null; comment?: string }) => api.patch(`/owner/tickets/${t.id}`, b), inv, (_r, v) => {
    if (v.comment) setComment('');
  });
  const eligible = staff.filter((s) => !s.shop_ids || s.shop_ids.includes(t.shop_id));

  return (
    <Section title="Update">
      <Card className="space-y-4 p-4">
        <div>
          <div className="mb-1.5 text-sm font-medium">Status</div>
          <div className="flex flex-wrap gap-2">
            {TICKET_STATUSES.map((s) => (
              <Button key={s} size="sm" variant={t.status === s ? 'primary' : 'secondary'} aria-pressed={t.status === s} disabled={patch.isPending} onClick={() => t.status !== s && patch.mutate({ status: s })}>
                {TICKET_STATUS_LABEL[s]}
              </Button>
            ))}
          </div>
          {d.machine?.state === 'fault' && t.status !== 'resolved' && <p className="mt-1.5 text-xs text-muted">Resolving customer fault reports also clears the machine's reported fault.</p>}
        </div>
        <div className="flex flex-wrap gap-4">
          <div>
            <div className="mb-1.5 text-sm font-medium">Priority</div>
            <Segmented label="Priority" value={t.severity} onChange={(s) => patch.mutate({ severity: s })} options={TICKET_SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))} />
          </div>
          <Field label="Assigned to">
            <select className={`${inputClass} py-2`} value={t.assigned_to ?? ''} disabled={patch.isPending} onChange={(e) => patch.mutate({ assignedTo: e.target.value || null })}>
              <option value="">Unassigned</option>
              {eligible.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (comment.trim()) patch.mutate({ comment: comment.trim() });
          }}
        >
          <Field label="Internal note">
            <textarea className={inputClass} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} placeholder="Visible to your team only" />
          </Field>
          <div className="mt-2 flex justify-end">
            <Button type="submit" size="sm" variant="secondary" disabled={patch.isPending || !comment.trim()}>
              Add note
            </Button>
          </div>
        </form>
        <MutationError error={patch.error} />
      </Card>
    </Section>
  );
}

const EVENT_ICON: Record<string, IconName> = { created: 'ticket', evidence: 'sensor', status: 'check', severity: 'alert', assign: 'users', comment: 'edit', refund: 'refund' };

function EventRow({ e, staffName }: { e: TicketEvent; staffName: (id: unknown) => string }) {
  const data = e.data ?? {};
  let body: ReactNode = e.body;
  let title: ReactNode = e.kind;
  switch (e.kind) {
    case 'created':
      title = 'Reported';
      break;
    case 'evidence':
      title = 'Sensor evidence at the time of the report';
      body = <Evidence data={data} />;
      break;
    case 'status':
      title = `Status: ${TICKET_STATUS_LABEL[data.from as TicketStatus] ?? data.from} → ${TICKET_STATUS_LABEL[data.to as TicketStatus] ?? data.to}`;
      break;
    case 'severity':
      title = `Priority: ${SEVERITY_LABEL[data.from as TicketSeverity] ?? data.from} → ${SEVERITY_LABEL[data.to as TicketSeverity] ?? data.to}`;
      break;
    case 'assign':
      title = data.to ? `Assigned to ${staffName(data.to)}` : 'Unassigned';
      break;
    case 'comment':
      title = 'Note';
      break;
    case 'refund':
      title = e.body ?? 'Refund updated';
      body = null;
      break;
  }
  return (
    <li className="flex items-start gap-3 p-2">
      <span className="mt-0.5 rounded-full bg-surface-2 p-1.5 text-ink-2">
        <Icon name={EVENT_ICON[e.kind] ?? 'info'} className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {body && <div className="mt-0.5 whitespace-pre-wrap text-sm text-ink-2">{body}</div>}
        <div className="mt-0.5 text-xs text-muted">
          {e.actor_name ?? (e.kind === 'evidence' ? 'System' : e.kind === 'created' ? 'Customer' : 'System')} · {dateTime(e.created_at)}
        </div>
      </div>
    </li>
  );
}

/** Renders `machineEvidence()` from the telemetry module in plain words. */
function Evidence({ data }: { data: Record<string, unknown> }) {
  const online = !!data.deviceOnline;
  const power = typeof data.lastPowerW === 'number' ? data.lastPowerW : null;
  const cycles = (Array.isArray(data.sensorCyclesLastHour) ? data.sensorCyclesLastHour : []) as Array<{ startedAt: string; endedAt: string | null; status: string }>;
  const sentence = [
    online ? 'Sensor online' : 'Sensor offline',
    power != null ? `last reading ${power} W` : 'no recent reading',
    cycles.length === 0 ? 'no cycle detected in the last hour' : `${cycles.length} cycle${cycles.length > 1 ? 's' : ''} detected in the last hour`,
  ].join(', ');
  return (
    <div className="mt-1 rounded-xl bg-surface-2 p-3 not-italic">
      <div className="flex items-start gap-2">
        {cycles.length === 0 && online ? <StatusTag tone="warning">No run detected</StatusTag> : cycles.length > 0 ? <StatusTag tone="info">Machine ran</StatusTag> : <StatusTag tone="neutral">Inconclusive</StatusTag>}
      </div>
      <p className="mt-1.5 text-ink">{sentence}.</p>
      {data.lastSeenAt ? <p className="text-xs text-muted">Last heard from {ago(String(data.lastSeenAt))}</p> : null}
      {cycles.length > 0 && (
        <ul className="mt-1 text-xs text-ink-2">
          {cycles.map((c, i) => (
            <li key={i}>
              {clock(c.startedAt)}–{c.endedAt ? clock(c.endedAt) : 'running'} ({c.status})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Refunds({ d }: { d: TicketDetail }) {
  const can = useCan();
  const t = d.ticket;
  const [open, setOpen] = useState(false);
  const refundable = d.payment ? d.payment.amount_sen - d.payment.refunded_sen : null;
  const [amount, setAmount] = useState(senToRmInput(t.amount_claimed_sen ?? refundable ?? null));
  const [method, setMethod] = useState<RefundMethod>(d.payment ? 'original' : 'duitnow');
  const [phone, setPhone] = useState(t.contact_phone && !t.contact_phone.startsWith('•') ? t.contact_phone : '');
  const [note, setNote] = useState('');
  const defaults = () => {
    setAmount(senToRmInput(t.amount_claimed_sen ?? refundable ?? null));
    setMethod(d.payment ? 'original' : 'duitnow');
    setPhone(t.contact_phone && !t.contact_phone.startsWith('•') ? t.contact_phone : '');
    setNote('');
  };
  const create = useApiMutation(
    () => api.post('/owner/refunds', { ticketId: t.id, amountSen: parseRm(amount), method, payoutPhone: phone.trim() || null, note: note.trim() || null }),
    [['owner', 'ticket', t.id], ['owner', 'refunds'], ['owner', 'overview']],
    () => {
      // Reset so reopening the form doesn't invite a duplicate refund with the same values.
      defaults();
      setOpen(false);
    },
  );
  const amountSen = parseRm(amount);
  const methods = REFUND_METHODS.filter((m) => m !== 'original' || d.payment);

  if (!can('refunds.decide') && d.refunds.length === 0) return null;
  return (
    <Section
      title="Refunds"
      action={
        can('refunds.decide') &&
        !open && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Create refund
          </Button>
        )
      }
    >
      {d.refunds.length > 0 && (
        <Card className="mb-3 divide-y divide-line">
          {d.refunds.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 p-3 text-sm">
              <div>
                <div className="font-medium">
                  {rm(r.amount_sen)} · {REFUND_METHOD_LABEL[r.method]}
                </div>
                <div className="text-xs text-muted">
                  {r.automatic ? 'Automatic · ' : ''}
                  {r.reference ? `ref ${r.reference} · ` : ''}
                  {ago(r.created_at)}
                </div>
              </div>
              <StatusTag tone={REFUND_TONE[r.status]}>{REFUND_STATUS_LABEL[r.status]}</StatusTag>
            </div>
          ))}
          <Link to="/owner/refunds" className="block p-3 text-sm font-medium text-brand">
            Decide in the refund queue
          </Link>
        </Card>
      )}
      {open && (
        <Card className="space-y-3 p-4">
          <Field label="Amount (RM)" hint={refundable != null ? `Up to ${rm(refundable)} of the app payment` : undefined} error={amount && amountSen == null ? 'Enter an amount like 5 or 5.50' : null}>
            <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Pay back by">
            <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value as RefundMethod)}>
              {methods.map((m) => (
                <option key={m} value={m}>
                  {REFUND_METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
          {(method === 'duitnow' || method === 'cash' || method === 'other') && (
            <Field label={method === 'duitnow' ? 'DuitNow phone number' : 'Customer phone (optional)'}>
              <input className={inputClass} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} required={method === 'duitnow'} />
            </Field>
          )}
          <Field label="Note (optional)">
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
          <MutationError error={create.error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={create.isPending || !amountSen || (method === 'duitnow' && !phone.trim())} onClick={() => create.mutate(undefined)}>
              {create.isPending ? 'Creating…' : 'Create refund request'}
            </Button>
          </div>
          <p className="text-xs text-muted">It goes to the refund queue for approval. “Original app payment” is paid back automatically through the gateway once approved.</p>
        </Card>
      )}
    </Section>
  );
}
