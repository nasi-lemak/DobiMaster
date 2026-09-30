import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { Button, Card, cx, EmptyState, Field, inputClass } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { MutationError, PageHeader, QueryState, Section, ShopSelect, StatusTag, TableWrap, td, th } from '../components/common';
import { Icon } from '../components/icons';
import { parseRm, rmc, shortDate } from '../lib/fmt';
import { k, qs, useApi, useApiMutation } from '../lib/queries';
import { useCan, useMe } from '../lib/session';
import type { CollectionRow, OwnerMachine, ReconRow } from '../lib/types';

export function CollectionsPage() {
  const me = useMe();
  const can = useCan();
  const [shopId, setShopId] = useState(me.shops.length === 1 ? me.shops[0]!.id : '');
  const [recording, setRecording] = useState(!can('revenue.view'));
  const [saved, setSaved] = useState(false);

  return (
    <>
      <PageHeader
        title="Cash collections"
        subtitle="Per-machine cash counts, checked against counters and sensors"
        actions={
          can('collections.create') &&
          !recording && (
            <Button size="sm" onClick={() => (setRecording(true), setSaved(false))}>
              <Icon name="plus" className="h-4 w-4" /> Record collection
            </Button>
          )
        }
      />
      {me.shops.length > 1 && (
        <div className="mb-4">
          <ShopSelect value={shopId} onChange={setShopId} className="max-w-xs" />
        </div>
      )}
      {saved && (
        <div role="status" className="mb-4 flex items-center gap-2 rounded-2xl bg-good/10 p-3 text-sm text-good-ink">
          <Icon name="checkCircle" className="h-4 w-4" /> Collection saved.
        </div>
      )}
      {recording && can('collections.create') && (
        <RecordForm
          defaultShopId={shopId || me.shops[0]?.id || ''}
          onDone={() => (setRecording(false), setSaved(true))}
          onCancel={can('revenue.view') ? () => setRecording(false) : undefined}
        />
      )}
      {can('revenue.view') && <Reconciliation shopId={shopId} />}
      <History shopId={shopId} />
    </>
  );
}

function localNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function RecordForm({ defaultShopId, onDone, onCancel }: { defaultShopId: string; onDone: () => void; onCancel?: () => void }) {
  const [shopId, setShopId] = useState(defaultShopId);
  const [at, setAt] = useState(localNow);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Record<string, { amount: string; counter: string }>>({});
  const machines = useApi<{ machines: OwnerMachine[] }>(k.machines(shopId), `/owner/machines${qs({ shopId })}`, { enabled: !!shopId });
  const entered = Object.entries(lines).filter(([, l]) => l.amount.trim() !== '');
  const invalid = entered.some(([, l]) => parseRm(l.amount) == null || (l.counter.trim() !== '' && !/^\d+$/.test(l.counter.trim())));
  const total = entered.reduce((s, [, l]) => s + (parseRm(l.amount) ?? 0), 0);
  const atValid = !!at && !Number.isNaN(new Date(at).getTime());

  const save = useApiMutation(
    () =>
      api.post('/owner/collections', {
        shopId,
        collectedAt: new Date(at).toISOString(),
        note: note.trim() || null,
        lines: entered.map(([machineId, l]) => ({ machineId, amountSen: parseRm(l.amount)!, counterReading: l.counter.trim() ? Number(l.counter.trim()) : null })),
      }),
    [['owner', 'collections'], ['owner', 'recon'], ['owner', 'analytics'], ['owner', 'maintenance']],
    () => onDone(),
  );
  const set = (id: string, patch: Partial<{ amount: string; counter: string }>) => setLines((ls) => ({ ...ls, [id]: { amount: '', counter: '', ...ls[id], ...patch } }));

  return (
    <Card className="mb-6 p-4 sm:p-5" role="region" aria-labelledby="record-collection-title">
      <h2 id="record-collection-title" className="mb-3 text-lg font-semibold">
        Record collection
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <span className="mb-1 block text-sm font-medium">Shop</span>
          <ShopSelect value={shopId} onChange={(id) => (setShopId(id), setLines({}))} allowAll={false} />
        </div>
        <Field label="Collected at" error={atValid ? null : 'Enter the date and time of the collection'}>
          <input className={inputClass} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} max={localNow()} required aria-invalid={!atValid} />
        </Field>
        <Field label="Note (optional)">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Weekly coin collection" />
        </Field>
      </div>
      <div className="mt-4">
        <QueryState q={machines}>
          {() => (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[20rem] text-sm">
                <thead>
                  <tr>
                    <th className={th}>Machine</th>
                    <th className={th}>Cash (RM)</th>
                    <th className={th}>Counter reading (optional)</th>
                  </tr>
                </thead>
                <tbody>
                  {machines.data!.machines.map((m) => {
                    const l = lines[m.id] ?? { amount: '', counter: '' };
                    const bad = l.amount.trim() !== '' && parseRm(l.amount) == null;
                    return (
                      <tr key={m.id}>
                        <td className={cx(td, 'font-bold')}>
                          {m.code} <span className="text-xs font-normal text-muted">{m.type}</span>
                        </td>
                        <td className={td}>
                          <input
                            aria-label={`${m.code} cash in RM`}
                            aria-invalid={bad}
                            className={cx(inputClass, 'py-2', bad && 'border-critical')}
                            inputMode="decimal"
                            value={l.amount}
                            onChange={(e) => set(m.id, { amount: e.target.value })}
                            placeholder="0.00"
                          />
                        </td>
                        <td className={td}>
                          <input aria-label={`${m.code} cycle counter reading`} className={cx(inputClass, 'py-2')} inputMode="numeric" value={l.counter} onChange={(e) => set(m.id, { counter: e.target.value })} placeholder="e.g. 4455" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </div>
      <p className="mt-2 text-xs text-muted">Leave a machine blank to skip it. Counter readings let us compare cash with what the machine should have taken.</p>
      <MutationError error={save.error} />
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-sm">
          {entered.length} machine{entered.length === 1 ? '' : 's'} · <span className="font-semibold">{rmc(total)}</span>
        </span>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button disabled={save.isPending || !entered.length || invalid || !shopId || !atValid} onClick={() => save.mutate(undefined)}>
          {save.isPending ? 'Saving…' : 'Save collection'}
        </Button>
      </div>
    </Card>
  );
}

function Reconciliation({ shopId }: { shopId: string }) {
  const q = useApi<{ rows: ReconRow[] }>(k.recon(shopId || undefined), `/owner/collections/reconciliation${qs({ shopId })}`);
  const [showAll, setShowAll] = useState(false);
  return (
    <Section title="Reconciliation: expected vs collected" className="mt-0">
      <QueryState q={q}>
        {() => {
          // Shortfalls first, then newest; the full list is one tap away.
          const all = [...q.data!.rows].sort((x, y) => Number(y.flag) - Number(x.flag) || y.periodEnd.localeCompare(x.periodEnd));
          const rows = showAll ? all : all.slice(0, 15);
          if (!all.length) return <EmptyState title="Nothing to compare yet">Needs two collections of the same machine with counter readings (or a sensor).</EmptyState>;
          const short = all.filter((r) => r.flag).length;
          return (
            <>
              <p className="mb-2 text-sm">
                {short ? (
                  <StatusTag tone="critical">
                    {short} shortfall{short === 1 ? '' : 's'}
                  </StatusTag>
                ) : (
                  <StatusTag tone="good">No material shortfalls</StatusTag>
                )}
              </p>
              <TableWrap>
                <thead>
                  <tr>
                    <th className={th}>Machine</th>
                    <th className={th}>Period</th>
                    <th className={th}>Basis</th>
                    <th className={cx(th, 'text-right')}>Expected cycles</th>
                    <th className={cx(th, 'text-right')}>Expected</th>
                    <th className={cx(th, 'text-right')}>Collected</th>
                    <th className={cx(th, 'text-right')}>Variance</th>
                    <th className={th}>Status</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {rows.map((r) => (
                    <tr key={`${r.collectionId}-${r.machineId}`} className={r.flag ? 'bg-critical/5' : undefined}>
                      <td className={td}>
                        <Link to={`/owner/machines/${r.machineId}`} className="font-bold hover:underline">
                          {r.code}
                        </Link>
                        <div className="text-xs text-muted">{r.shopName}</div>
                      </td>
                      <td className={td}>
                        {shortDate(r.periodStart)} – {shortDate(r.periodEnd)}
                      </td>
                      <td className={td}>{r.basis === 'counter' ? 'Counter' : r.basis === 'sensor' ? 'Sensor' : '—'}</td>
                      <td className={cx(td, 'text-right')}>{r.expectedCycles ?? '—'}</td>
                      <td className={cx(td, 'text-right')}>{rmc(r.expectedSen)}</td>
                      <td className={cx(td, 'text-right')}>{rmc(r.collectedSen)}</td>
                      <td className={cx(td, 'text-right font-semibold')}>{r.varianceSen == null ? '—' : `${r.varianceSen > 0 ? '+' : ''}${rmc(r.varianceSen)}`}</td>
                      <td className={td}>
                        {r.basis == null ? (
                          <StatusTag tone="neutral">No basis</StatusTag>
                        ) : r.flag ? (
                          <StatusTag tone="critical">Shortfall</StatusTag>
                        ) : (
                          <StatusTag tone="good">OK</StatusTag>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              {all.length > 15 && (
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Show fewer' : `Show all ${all.length} rows`}
                </Button>
              )}
              <p className="mt-2 text-[11px] text-muted">
                <span className="font-medium text-ink-2">Data sources: </span>
                expected = counter-reading difference (or sensor-confirmed coin cycles) × the machine's average program price over 90 days. Shortfalls more than 12% below expected are flagged — check for a jammed coin mechanism, free runs or skimming.
              </p>
            </>
          );
        }}
      </QueryState>
    </Section>
  );
}

function History({ shopId }: { shopId: string }) {
  const q = useApi<{ collections: CollectionRow[] }>(k.collections(shopId || undefined), `/owner/collections${qs({ shopId })}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Section title="History">
      <QueryState q={q}>
        {() =>
          q.data!.collections.length === 0 ? (
            <EmptyState title="No collections recorded yet" />
          ) : (
            <Card className="divide-y divide-line">
              {q.data!.collections.map((c) => (
                <div key={c.id}>
                  <button type="button" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {dateTime(c.collected_at)} · {c.shop_name}
                      </div>
                      <div className="text-xs text-muted">
                        {c.lines.length} machine{c.lines.length === 1 ? '' : 's'}
                        {c.collected_by_name && ` · by ${c.collected_by_name}`}
                        {c.note && ` · ${c.note}`}
                      </div>
                    </div>
                    {c.totalSen != null && <span className="font-semibold tabular">{rmc(c.totalSen)}</span>}
                    <Icon name="chevron" className={cx('h-4 w-4 text-muted transition', open === c.id && 'rotate-90')} />
                  </button>
                  {open === c.id && (
                    <div className="px-4 pb-3">
                      <table className="w-full text-sm tabular">
                        <tbody>
                          {c.lines.map((l) => (
                            <tr key={l.machine_id} className="border-t border-line">
                              <td className="py-1 font-medium">{l.code}</td>
                              <td className="py-1 text-right">{l.amount_sen == null ? 'hidden' : rmc(l.amount_sen)}</td>
                              <td className="py-1 text-right text-muted">{l.counter_reading != null ? `counter ${l.counter_reading}` : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </Card>
          )
        }
      </QueryState>
    </Section>
  );
}
