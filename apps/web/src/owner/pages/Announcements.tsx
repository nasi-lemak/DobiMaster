import { useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, EmptyState, Field, inputClass } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { ConfirmButton, MutationError, PageHeader, QueryState, Section, Segmented, ShopSelect, StatusTag } from '../components/common';
import { Icon } from '../components/icons';
import { k, useApi, useApiMutation } from '../lib/queries';
import { useCan, useMe, useShopName } from '../lib/session';
import type { Announcement } from '../lib/types';

/** YYYY-MM-DD in the browser's time zone (what a date input shows). */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const isLive = (a: Announcement, now = Date.now()) => new Date(a.starts_at).getTime() <= now && (!a.ends_at || new Date(a.ends_at).getTime() > now);

export function AnnouncementsPage() {
  const can = useCan();
  const shopName = useShopName();
  const [adding, setAdding] = useState(false);
  const q = useApi<{ announcements: Announcement[] }>(k.announcements, '/owner/announcements');
  const end = useApiMutation((id: string) => api.del(`/owner/announcements/${id}`), [k.announcements]);

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="Shown on the shop page and machine pages, in the customer's language"
        actions={
          can('announcements.manage') &&
          !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Icon name="plus" className="h-4 w-4" /> New announcement
            </Button>
          )
        }
      />
      {adding && <NewAnnouncement onDone={() => setAdding(false)} />}
      <QueryState q={q}>
        {() => {
          const list = q.data!.announcements;
          const live = list.filter((a) => isLive(a));
          const past = list.filter((a) => !isLive(a));
          return (
            <>
              <Section title={`Live now (${live.length})`} className="mt-0">
                {live.length === 0 ? (
                  <EmptyState title="No live announcements" />
                ) : (
                  <div className="space-y-3">
                    {live.map((a) => (
                      <Card key={a.id} className="p-4" role="article" aria-label={`${shopName(a.shop_id)}: ${a.message.en}`}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {a.level === 'warning' ? <StatusTag tone="warning">Warning</StatusTag> : <StatusTag tone="info">Info</StatusTag>}
                            <span className="text-sm font-medium">{shopName(a.shop_id)}</span>
                          </div>
                          {can('announcements.manage') && (
                            <ConfirmButton
                              title="End this announcement?"
                              message="It disappears from the shop page straight away."
                              confirmLabel="End now"
                              onConfirm={() => end.mutateAsync(a.id)}
                              pending={end.isPending}
                              error={end.error}
                            >
                              End now
                            </ConfirmButton>
                          )}
                        </div>
                        <p className="mt-2 text-sm">{a.message.en}</p>
                        {a.message.ms && <p className="mt-1 text-sm text-ink-2">BM: {a.message.ms}</p>}
                        {a.message.zh && <p className="mt-1 text-sm text-ink-2">中文: {a.message.zh}</p>}
                        <p className="mt-2 text-xs text-muted">
                          Since {dateTime(a.starts_at)} · {a.ends_at ? `until ${dateTime(a.ends_at)}` : 'no end date'}
                        </p>
                      </Card>
                    ))}
                  </div>
                )}
              </Section>
              {past.length > 0 && (
                <Section title="Ended or scheduled">
                  <Card className="divide-y divide-line">
                    {past.map((a) => (
                      <div key={a.id} className="px-4 py-3 text-sm">
                        <div>{a.message.en}</div>
                        <div className="text-xs text-muted">
                          {shopName(a.shop_id)} · {dateTime(a.starts_at)} – {a.ends_at ? dateTime(a.ends_at) : '…'}
                        </div>
                      </div>
                    ))}
                  </Card>
                </Section>
              )}
            </>
          );
        }}
      </QueryState>
    </>
  );
}

function NewAnnouncement({ onDone }: { onDone: () => void }) {
  const me = useMe();
  const [shopId, setShopId] = useState(me.shops[0]?.id ?? '');
  const [en, setEn] = useState('');
  const [ms, setMs] = useState('');
  const [zh, setZh] = useState('');
  const [level, setLevel] = useState<'info' | 'warning'>('info');
  const [endsAt, setEndsAt] = useState('');
  const create = useApiMutation(
    () =>
      api.post('/owner/announcements', {
        shopId,
        level,
        message: { en: en.trim(), ...(ms.trim() && { ms: ms.trim() }), ...(zh.trim() && { zh: zh.trim() }) },
        endsAt: endsAt ? new Date(`${endsAt}T23:59:00`).toISOString() : null,
      }),
    [k.announcements],
    () => onDone(),
  );
  return (
    <Card className="mb-6 space-y-3 p-4" role="region" aria-labelledby="new-announcement-title">
      <h2 id="new-announcement-title" className="font-semibold">
        New announcement
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-sm font-medium">Shop</span>
          <ShopSelect value={shopId} onChange={setShopId} allowAll={false} />
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium">Type</span>
          <Segmented
            label="Type"
            value={level}
            onChange={setLevel}
            options={[
              { value: 'info', label: 'Info' },
              { value: 'warning', label: 'Warning' },
            ]}
          />
        </div>
      </div>
      <Field label="English (required)">
        <textarea className={inputClass} rows={2} value={en} onChange={(e) => setEn(e.target.value)} maxLength={2000} placeholder="e.g. Dryer D2 under repair until Friday." />
      </Field>
      <Field label="Bahasa Melayu">
        <textarea className={inputClass} rows={2} value={ms} onChange={(e) => setMs(e.target.value)} maxLength={2000} />
      </Field>
      <Field label="中文">
        <textarea className={inputClass} rows={2} value={zh} onChange={(e) => setZh(e.target.value)} maxLength={2000} />
      </Field>
      <Field label="Show until (optional)" hint="Ends at the end of that day. Leave empty to end it manually.">
        <input className={inputClass} type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} min={localToday()} />
      </Field>
      <MutationError error={create.error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={create.isPending || !en.trim() || !shopId} onClick={() => create.mutate(undefined)}>
          {create.isPending ? 'Publishing…' : 'Publish'}
        </Button>
      </div>
    </Card>
  );
}
