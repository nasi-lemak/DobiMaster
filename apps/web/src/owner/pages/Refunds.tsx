import { useState } from 'react';
import { Link } from 'react-router';
import type { RefundStatus } from '@dobi/shared';
import { api } from '../../lib/api';
import { Button, Card, EmptyState, Field, inputClass } from '../../components/ui';
import { ago, dateTime, rm } from '../../lib/format';
import { ConfirmButton, MutationError, PageHeader, QueryState, Section, StatusTag, type Tone } from '../components/common';
import { REFUND_METHOD_LABEL, REFUND_STATUS_LABEL } from '../lib/labels';
import { k, useApi, useApiMutation } from '../lib/queries';
import type { RefundRow } from '../lib/types';

export const REFUND_TONE: Record<RefundStatus, Tone> = { requested: 'warning', approved: 'info', rejected: 'neutral', paid: 'good', failed: 'critical' };
const PENDING: RefundStatus[] = ['requested', 'approved', 'failed'];

export function RefundsPage() {
  const q = useApi<{ refunds: RefundRow[] }>(k.refunds('all'), '/owner/refunds?status=all', { refetchInterval: 30_000 });
  return (
    <>
      <PageHeader title="Refunds" subtitle="Approve or reject, then record how it was paid" />
      <QueryState q={q}>
        {() => {
          const pending = q.data!.refunds.filter((r) => PENDING.includes(r.status));
          const done = q.data!.refunds.filter((r) => !PENDING.includes(r.status));
          return (
            <>
              <Section title={`Waiting on you (${pending.length})`} className="mt-0">
                {pending.length === 0 ? (
                  <EmptyState title="No refunds waiting">Refund requests from tickets appear here.</EmptyState>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {pending.map((r) => (
                      <RefundCard key={r.id} r={r} />
                    ))}
                  </div>
                )}
              </Section>
              <Section title="History">
                {done.length === 0 ? (
                  <EmptyState title="No decided refunds yet" />
                ) : (
                  <Card className="divide-y divide-line" role="list">
                    {done.map((r) => (
                      <div key={r.id} role="listitem" className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                        <div className="min-w-0">
                          <div className="font-medium">
                            {rm(r.amount_sen)} · {REFUND_METHOD_LABEL[r.method]} {r.automatic && <AutoTag />}
                          </div>
                          <div className="text-xs text-muted">
                            {r.shop_name}
                            {r.ticket_ref && (
                              <>
                                {' · '}
                                <Link className="text-brand" to={`/owner/tickets/${r.ticket_id}`}>
                                  #{r.ticket_ref}
                                </Link>
                              </>
                            )}
                            {r.reference && ` · ref ${r.reference}`}
                            {r.decided_by_name && ` · by ${r.decided_by_name}`} · {dateTime(r.paid_at ?? r.decided_at ?? r.created_at)}
                          </div>
                        </div>
                        <StatusTag tone={REFUND_TONE[r.status]}>{REFUND_STATUS_LABEL[r.status]}</StatusTag>
                      </div>
                    ))}
                  </Card>
                )}
              </Section>
            </>
          );
        }}
      </QueryState>
    </>
  );
}

function AutoTag() {
  return (
    <StatusTag tone="info" icon="refund" className="ml-1 align-middle">
      Automatic
    </StatusTag>
  );
}

function RefundCard({ r }: { r: RefundRow }) {
  const [reference, setReference] = useState('');
  const inv = [['owner', 'refunds'], ['owner', 'overview'], ['owner', 'ticket']];
  const decide = useApiMutation((b: { action: 'approve' | 'reject' | 'mark_paid' | 'retry'; reference?: string; note?: string }) => api.post(`/owner/refunds/${r.id}/decision`, b), inv);
  const manual = r.method !== 'original';

  return (
    <Card className="p-4" role="article" aria-label={`Refund ${rm(r.amount_sen)}${r.ticket_ref ? ` for ticket #${r.ticket_ref}` : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-2xl font-semibold">{rm(r.amount_sen)}</div>
          <div className="text-sm text-ink-2">
            {REFUND_METHOD_LABEL[r.method]}
            {r.payout_phone && ` · ${r.payout_phone}`}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusTag tone={REFUND_TONE[r.status]}>{REFUND_STATUS_LABEL[r.status]}</StatusTag>
          {r.automatic && <AutoTag />}
        </div>
      </div>
      <div className="mt-2 text-xs text-muted">
        {r.shop_name} · requested {ago(r.created_at)}
        {r.ticket_ref && (
          <>
            {' · '}
            <Link className="font-medium text-brand" to={`/owner/tickets/${r.ticket_id}`}>
              #{r.ticket_ref} {r.ticket_title}
            </Link>
          </>
        )}
      </div>
      {r.note && <p className="mt-2 rounded-xl bg-surface-2 p-2.5 text-sm">{r.note}</p>}
      {r.automatic && <p className="mt-2 text-xs text-muted">Raised automatically because the machine didn't confirm the start after an app payment.</p>}

      <div className="mt-3 border-t border-line pt-3">
        {r.status === 'requested' && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ action: 'approve' })}>
              Approve
            </Button>
            <ConfirmButton
              title="Reject this refund?"
              message={<>The customer won't be refunded {rm(r.amount_sen)}. Add a note on the ticket explaining why.</>}
              confirmLabel="Reject refund"
              onConfirm={() => decide.mutateAsync({ action: 'reject' })}
              pending={decide.isPending}
              error={decide.error}
            >
              Reject
            </ConfirmButton>
          </div>
        )}
        {r.status === 'failed' && (
          <div className="space-y-2">
            <p className="text-sm text-critical-ink">The gateway refund failed. Try the gateway again, or pay the customer another way (e.g. DuitNow) and record it below.</p>
            <Button size="sm" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate({ action: 'retry' })}>
              Retry through the gateway
            </Button>
          </div>
        )}
        {((r.status === 'approved' || r.status === 'requested') && manual) || r.status === 'failed' ? (
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              decide.mutate({ action: 'mark_paid', reference: reference.trim() });
            }}
          >
            <div className="min-w-0 flex-1">
              <Field label={r.method === 'duitnow' ? 'DuitNow transfer reference' : 'How it was paid (reference or note)'}>
                <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} placeholder={r.method === 'cash' ? 'e.g. Paid by Mei Ling at SS2' : 'e.g. 2410M1234567'} />
              </Field>
            </div>
            <Button type="submit" size="md" variant="secondary" disabled={decide.isPending || !reference.trim()}>
              Mark paid
            </Button>
          </form>
        ) : null}
        {r.status === 'approved' && !manual && <p className="text-sm text-ink-2">Approved — being paid back to the original payment by the gateway.</p>}
        <MutationError error={decide.error} />
      </div>
    </Card>
  );
}
