import { Link } from 'react-router';
import { api } from '../../lib/api';
import { Button, Card, EmptyState } from '../../components/ui';
import { ago } from '../../lib/format';
import { MutationError, PageHeader, QueryState, Segmented, SeverityTag, StatusTag } from '../components/common';
import { ALERT_KIND_LABEL, titleCase } from '../lib/labels';
import { k, useApi, useApiMutation } from '../lib/queries';
import type { AlertRow } from '../lib/types';
import { useState } from 'react';

type Filter = 'open' | 'acknowledged' | 'resolved' | 'all';

export function AlertsPage() {
  const [status, setStatus] = useState<Filter>('open');
  const q = useApi<{ alerts: AlertRow[] }>(k.alerts(status), `/owner/alerts?status=${status}`, { refetchInterval: 30_000, keepPrevious: true });
  const ack = useApiMutation((v: { id: string; resolve: boolean }) => api.post(`/owner/alerts/${v.id}/ack`, { resolve: v.resolve }), [['owner', 'alerts'], ['owner', 'overview']]);

  return (
    <>
      <PageHeader title="Alerts" subtitle="Repeat faults, silent sensors, low usage and due maintenance" />
      <div className="mb-4">
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'acknowledged', label: 'Seen' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>
      <MutationError error={ack.error} />
      <QueryState q={q}>
        {() =>
          q.data!.alerts.length === 0 ? (
            <EmptyState title={status === 'open' ? 'No open alerts' : 'Nothing here'}>Alerts are raised automatically and can also be sent to your phone.</EmptyState>
          ) : (
            <Card className={`divide-y divide-line ${q.isPlaceholderData ? 'opacity-60' : ''}`} role="list" aria-label="Alerts">
              {q.data!.alerts.map((a) => (
                <div key={a.id} role="listitem" className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="w-20 shrink-0 pt-0.5">
                    <SeverityTag severity={a.severity} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-muted">{ALERT_KIND_LABEL[a.kind] ?? titleCase(a.kind)}</div>
                    <div className="text-sm" data-testid="alert-message">
                      {a.message}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {a.shop_name ?? 'All shops'}
                      {a.machine_id && (
                        <>
                          {' · '}
                          <Link to={`/owner/machines/${a.machine_id}`} className="font-medium text-brand">
                            {a.machine_code ?? 'machine'}
                          </Link>
                        </>
                      )}{' '}
                      · {ago(a.created_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.status === 'resolved' ? (
                      <StatusTag tone="good">Resolved</StatusTag>
                    ) : (
                      <>
                        {a.status === 'open' ? (
                          <Button size="sm" variant="ghost" disabled={ack.isPending} onClick={() => ack.mutate({ id: a.id, resolve: false })}>
                            Mark seen
                          </Button>
                        ) : (
                          <StatusTag tone="neutral" icon="check">
                            Seen
                          </StatusTag>
                        )}
                        <Button size="sm" variant="secondary" disabled={ack.isPending} onClick={() => ack.mutate({ id: a.id, resolve: true })}>
                          Resolve
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </Card>
          )
        }
      </QueryState>
    </>
  );
}
