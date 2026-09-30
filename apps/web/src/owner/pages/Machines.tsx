import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../lib/api';
import { Button, Card, EmptyState, StateBadge } from '../../components/ui';
import { rm } from '../../lib/format';
import { PageHeader, QueryState, ShopSelect, StatusTag, TableWrap, td, th } from '../components/common';
import { Icon } from '../components/icons';
import { MachineForm, type MachinePayload } from '../components/MachineForm';
import { STATE_LABEL, typeLabel } from '../lib/labels';
import { k, qs, useApi, useApiMutation } from '../lib/queries';
import { useCan, useMe } from '../lib/session';
import type { OwnerMachine } from '../lib/types';

const linkBtn = 'inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2';

export function MachinesPage() {
  const me = useMe();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const shopId = params.get('shop') ?? me.shops[0]?.id ?? '';
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string[] | null>(null);
  const q = useApi<{ machines: OwnerMachine[] }>(k.machines(shopId), `/owner/machines${qs({ shopId })}`, { enabled: !!shopId, refetchInterval: 30_000 });
  const add = useApiMutation(
    (b: MachinePayload) => api.post<{ machines: OwnerMachine[] }>('/owner/machines', b),
    [['owner', 'machines'], ['owner', 'shop'], ['owner', 'overview']],
    (r) => {
      setAdding(false);
      setAdded(r.machines.map((m) => m.code));
    },
  );

  if (!me.shops.length) return <EmptyState title="No shops yet" />;

  return (
    <>
      <PageHeader
        title="Machines & QR"
        actions={
          can('machines.manage') &&
          !adding && (
            <Button size="sm" onClick={() => (setAdding(true), setAdded(null))}>
              <Icon name="plus" className="h-4 w-4" /> Add machines
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ShopSelect value={shopId} onChange={(id) => setParams({ shop: id })} allowAll={false} className="min-w-56" />
        <Link to={`/owner/shops/${shopId}`} className={linkBtn}>
          <Icon name="home" className="h-4 w-4" /> Live view
        </Link>
        <Link to={`/owner/shops/${shopId}/qr-sheet`} className={linkBtn}>
          <Icon name="print" className="h-4 w-4" /> Print QR sticker sheet
        </Link>
      </div>

      {added && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl bg-good/10 p-3 text-sm text-good-ink">
          <Icon name="checkCircle" className="h-4 w-4" /> Added {added.join(', ')}. Print their stickers from the QR sheet.
        </div>
      )}

      {adding && (
        <Card className="mb-6 p-4 sm:p-6" role="region" aria-labelledby="add-machines-title">
          <h2 id="add-machines-title" className="mb-4 text-lg font-semibold">
            Add machines
          </h2>
          <MachineForm key={shopId} mode="add" defaultShopId={shopId} onSubmit={(b) => add.mutate(b)} pending={add.isPending} error={add.error} onCancel={() => setAdding(false)} />
        </Card>
      )}

      <QueryState q={q}>
        {() =>
          q.data!.machines.length === 0 ? (
            <EmptyState title="No machines in this shop yet">Use “Add machines” to register them — you can add several codes at once.</EmptyState>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className={th}>Code</th>
                  <th className={th}>Type</th>
                  <th className={th}>State</th>
                  <th className={`${th} hidden sm:table-cell`}>Programs</th>
                  <th className={`${th} hidden sm:table-cell`}>Sensor</th>
                  <th className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data!.machines.map((m) => {
                  const prices = m.programs.map((p) => p.priceSen);
                  return (
                    <tr key={m.id} className="hover:bg-surface-2">
                      <td className={td}>
                        <Link to={`/owner/machines/${m.id}`} className="text-base font-bold underline-offset-2 hover:underline">
                          {m.code}
                        </Link>
                      </td>
                      <td className={td}>
                        {typeLabel(m.type)} {m.capacityKg} kg
                        {m.observation !== 'none' && <span className="block text-xs text-muted sm:hidden">sensor</span>}
                      </td>
                      <td className={td}>
                        <StateBadge state={m.state} label={STATE_LABEL[m.state]} />
                      </td>
                      <td className={`${td} tabular hidden sm:table-cell`}>
                        {m.programs.length} · {prices.length ? (Math.min(...prices) === Math.max(...prices) ? rm(prices[0]) : `${rm(Math.min(...prices))}–${rm(Math.max(...prices))}`) : '—'}
                      </td>
                      <td className={`${td} hidden sm:table-cell`}>{m.observation !== 'none' ? <StatusTag tone="good" icon="sensor">Sensor</StatusTag> : <span className="text-xs text-muted">Check-ins</span>}</td>
                      <td className={`${td} text-right`}>
                        {can('machines.manage') && (
                          <Link to={`/owner/machines/${m.id}/edit`} className="text-sm font-medium text-brand">
                            Edit
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )
        }
      </QueryState>
    </>
  );
}
