import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, uploadPhoto } from '../../lib/api';
import { preparePhoto } from '../../lib/image';
import { Button, Card, cx, EmptyState, Field, inputClass } from '../../components/ui';
import { clock } from '../../lib/format';
import { Meter, MutationError, PageHeader, QueryState, Section, ShopSelect, StatusTag, Toggle } from '../components/common';
import { Icon } from '../components/icons';
import { k, useApi, useApiMutation } from '../lib/queries';
import { useCan, useMe, useShopName } from '../lib/session';
import type { ChecklistRun, ChecklistTemplate } from '../lib/types';

export function ChecklistsPage() {
  const can = useCan();
  const q = useApi<{ runs: ChecklistRun[] }>(k.checklistsToday(), '/owner/checklists/today', { refetchInterval: 30_000 });
  return (
    <>
      <PageHeader title="Checklists" subtitle={`Today · ${new Date().toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'short' })}`} />
      <QueryState q={q}>
        {() =>
          q.data!.runs.length === 0 ? (
            <EmptyState title="No checklists yet">{can('checklists.manage') ? 'Create a template below — a run appears here every day.' : 'Ask your manager to set one up.'}</EmptyState>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {q.data!.runs.map((r) => (
                <RunCard key={r.runId} run={r} />
              ))}
            </div>
          )
        }
      </QueryState>
      {can('checklists.manage') && <Templates />}
    </>
  );
}

function RunCard({ run }: { run: ChecklistRun }) {
  const me = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const key = k.checklistsToday();
  const toggle = useMutation({
    mutationFn: ({ itemId, done, photoId }: { itemId: string; done: boolean; photoId?: string }) =>
      api.post(`/owner/checklists/runs/${run.runId}/items/${encodeURIComponent(itemId)}`, { done, photoId }),
    // Optimistic: a cleaner ticking items on a phone shouldn't wait for each round-trip.
    onMutate: async ({ itemId, done }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ runs: ChecklistRun[] }>(key);
      qc.setQueryData<{ runs: ChecklistRun[] }>(key, (d) =>
        d && {
          runs: d.runs.map((r) =>
            r.runId !== run.runId
              ? r
              : {
                  ...r,
                  items: r.items.map((i) => (i.id === itemId ? { ...i, done: done ? { by: me.user.id, byName: me.user.name, at: new Date().toISOString(), photoUrl: null } : null } : i)),
                  done: r.done + (done ? 1 : -1),
                },
          ),
        },
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['owner', 'checklists'] });
      qc.invalidateQueries({ queryKey: k.overview });
    },
  });
  const allowed = can('checklists.complete');
  const complete = run.done >= run.total;
  const [uploadingItem, setUploadingItem] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  /** Proof of cleaning: take a photo, upload it, then tick the item with it. */
  async function tickWithPhoto(itemId: string, file: File | undefined) {
    if (!file) return;
    setUploadingItem(itemId);
    setPhotoError(null);
    try {
      const res = await uploadPhoto('/owner/uploads', await preparePhoto(file));
      toggle.mutate({ itemId, done: true, photoId: res.attachment.id });
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Could not upload the photo');
    } finally {
      setUploadingItem(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">{run.name}</h2>
            <div className="text-xs text-muted">{run.shopName}</div>
          </div>
          {complete ? (
            <StatusTag tone="good">Done{run.completedAt ? ` ${clock(run.completedAt)}` : ''}</StatusTag>
          ) : (
            <span className="text-sm font-medium tabular">
              {run.done}/{run.total}
            </span>
          )}
        </div>
        <Meter className="mt-3" value={run.total ? run.done / run.total : 0} tone={complete ? 'good' : 'info'} label={`${run.name}: ${run.done} of ${run.total} done`} />
      </div>
      <ul>
        {run.items.map((i) => {
          const done = !!i.done;
          const needsPhoto = !!i.photoRequired && !done;
          const busy = uploadingItem === i.id;
          return (
            <li key={i.id} className="flex items-center border-b border-line last:border-0">
              <label className={cx('flex min-h-14 flex-1 items-center gap-3 px-4 py-3', allowed ? 'cursor-pointer hover:bg-surface-2' : 'opacity-80')}>
                {needsPhoto ? (
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="peer sr-only"
                    aria-label={`${i.label} — take a photo to tick`}
                    disabled={!allowed || busy}
                    onChange={(e) => {
                      void tickWithPhoto(i.id, e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                ) : (
                  <input type="checkbox" className="peer sr-only" checked={done} disabled={!allowed} onChange={(e) => toggle.mutate({ itemId: i.id, done: e.target.checked })} />
                )}
                <span
                  aria-hidden
                  className={cx(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand',
                    done ? 'border-good bg-good text-white' : 'border-muted/60 bg-surface',
                  )}
                >
                  {done ? <Icon name="check" className="h-5 w-5" /> : needsPhoto ? <span className="text-sm">{busy ? '…' : '📷'}</span> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx('block text-base', done && 'text-ink-2 line-through decoration-1')}>{i.label}</span>
                  {i.done ? (
                    <span className="block text-xs text-muted">
                      {i.done.byName} · {clock(i.done.at)}
                    </span>
                  ) : (
                    i.photoRequired && <span className="block text-xs text-muted">{busy ? 'Uploading photo…' : 'Photo required — tap to take one'}</span>
                  )}
                </span>
              </label>
              {i.done?.photoUrl && (
                <a href={i.done.photoUrl} target="_blank" rel="noreferrer" className="mr-3 shrink-0">
                  <img src={i.done.photoUrl} alt={`Photo for ${i.label}`} loading="lazy" className="h-12 w-12 rounded-lg border border-line object-cover" />
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {toggle.error ? (
        <div className="px-4 pb-3">
          <MutationError error={toggle.error} />
        </div>
      ) : null}
      {photoError && <p className="px-4 pb-3 text-sm text-critical-ink">{photoError}</p>}
    </Card>
  );
}

// ---- templates (checklists.manage) ----

function Templates() {
  const q = useApi<{ templates: ChecklistTemplate[] }>(k.checklistTemplates, '/owner/checklists/templates');
  const shopName = useShopName();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <Section
      title="Templates"
      className="mt-8"
      action={
        editing !== 'new' && (
          <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
            <Icon name="plus" className="h-4 w-4" /> New template
          </Button>
        )
      }
    >
      {editing === 'new' && <TemplateForm onDone={() => setEditing(null)} />}
      <QueryState q={q}>
        {() => (
          <div className="space-y-3">
            {q.data!.templates.map((t) =>
              editing === t.id ? (
                <TemplateForm key={t.id} template={t} onDone={() => setEditing(null)} />
              ) : (
                <Card key={t.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted">
                      {shopName(t.shop_id)} · {t.items.length} items
                    </div>
                  </div>
                  {t.active ? <StatusTag tone="good">Active</StatusTag> : <StatusTag tone="neutral" icon="pause">Inactive</StatusTag>}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(t.id)}>
                    Edit
                  </Button>
                </Card>
              ),
            )}
          </div>
        )}
      </QueryState>
    </Section>
  );
}

function TemplateForm({ template, onDone }: { template?: ChecklistTemplate; onDone: () => void }) {
  const me = useMe();
  const [shopId, setShopId] = useState(template?.shop_id ?? me.shops[0]?.id ?? '');
  const [name, setName] = useState(template?.name ?? 'Daily opening check');
  const [active, setActive] = useState(template?.active ?? true);
  const [items, setItems] = useState<Array<{ id?: string; label: string; photoRequired?: boolean }>>(template?.items ?? [{ label: '' }]);
  const save = useApiMutation(
    () => {
      // Send existing item ids (so today's ticks survive a rename); the server assigns ids to new items.
      const clean = items.filter((i) => i.label.trim()).map((i) => ({ ...(i.id ? { id: i.id } : {}), label: i.label.trim(), photoRequired: !!i.photoRequired }));
      return template
        ? api.patch(`/owner/checklists/templates/${template.id}`, { name: name.trim(), items: clean, active })
        : api.post('/owner/checklists/templates', { shopId, name: name.trim(), items: clean, active });
    },
    [['owner', 'checklists'], ['owner', 'overview']],
    () => onDone(),
  );
  const valid = name.trim().length >= 2 && items.some((i) => i.label.trim());
  return (
    <Card className="mb-3 space-y-3 p-4">
      <h3 className="font-semibold">{template ? `Edit “${template.name}”` : 'New checklist template'}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {!template && (
          <div>
            <span className="mb-1 block text-sm font-medium">Shop</span>
            <ShopSelect value={shopId} onChange={setShopId} allowAll={false} />
          </div>
        )}
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Items</legend>
        <ol className="space-y-2">
          {items.map((it, idx) => (
            <li key={idx} className="flex items-center gap-2">
              <span className="w-5 text-right text-xs text-muted">{idx + 1}.</span>
              <input
                aria-label={`Item ${idx + 1}`}
                className={inputClass}
                value={it.label}
                maxLength={200}
                onChange={(e) => setItems((xs) => xs.map((x, j) => (j === idx ? { ...x, label: e.target.value } : x)))}
                placeholder="e.g. Empty all dryer lint filters"
              />
              <label className="flex shrink-0 items-center gap-1 text-xs text-ink-2" title="Staff must attach a photo to tick this item">
                <input
                  type="checkbox"
                  checked={!!it.photoRequired}
                  onChange={(e) => setItems((xs) => xs.map((x, j) => (j === idx ? { ...x, photoRequired: e.target.checked } : x)))}
                />
                📷 Photo
              </label>
              <button type="button" aria-label={`Remove item ${idx + 1}`} className="rounded-full p-2 text-muted hover:bg-surface-2" onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))}>
                <Icon name="x" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ol>
        <Button type="button" size="sm" variant="ghost" className="mt-2" disabled={items.length >= 40} onClick={() => setItems((xs) => [...xs, { label: '' }])}>
          <Icon name="plus" className="h-4 w-4" /> Add item
        </Button>
      </fieldset>
      <Toggle checked={active} onChange={setActive} label="Active" hint="Inactive templates don't create a daily run" />
      <MutationError error={save.error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={save.isPending || !valid} onClick={() => save.mutate(undefined)}>
          {save.isPending ? 'Saving…' : 'Save template'}
        </Button>
      </div>
    </Card>
  );
}
