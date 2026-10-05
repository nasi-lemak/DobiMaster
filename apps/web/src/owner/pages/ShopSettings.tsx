import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { DEFAULT_SHOP_SETTINGS, type OpeningHours } from '@dobi/shared';
import { api } from '../../lib/api';
import { Button, Card, cx, Field, inputClass } from '../../components/ui';
import { CopyButton, MutationError, PageHeader, QueryState, Section, ShopSelect, Toggle } from '../components/common';
import { Icon } from '../components/icons';
import { WEEKDAYS } from '../lib/labels';
import { k, useApi, useApiMutation } from '../lib/queries';
import { useMe } from '../lib/session';
import type { ShopLive, ShopRow } from '../lib/types';

const DAYS = ['1', '2', '3', '4', '5', '6', '7'] as const;
export const TIMES = Array.from({ length: 49 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
export const FACILITIES: Array<{ key: string; label: string }> = [
  { key: 'detergentVending', label: 'Detergent vending' },
  { key: 'changeMachine', label: 'Change machine' },
  { key: 'qrPayment', label: 'QR payment' },
  { key: 'wifi', label: 'Wi-Fi' },
  { key: 'parking', label: 'Parking' },
  { key: 'cctv', label: 'CCTV' },
  { key: 'aircon', label: 'Air-conditioned' },
  { key: 'seating', label: 'Seating' },
  { key: 'foldingTable', label: 'Folding table' },
];

export function ShopSettingsPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const shopId = params.get('shop') ?? me.shops[0]?.id ?? '';
  const q = useApi<ShopLive>(k.shop(shopId), `/owner/shops/${shopId}`, { enabled: !!shopId });
  return (
    <>
      <PageHeader title="Shop settings" subtitle="What customers see on the shop page, and how alerts behave" />
      {me.shops.length > 1 && (
        <div className="mb-4">
          <ShopSelect value={shopId} onChange={(id) => setParams({ shop: id })} allowAll={false} className="max-w-xs" />
        </div>
      )}
      <QueryState q={q}>{() => <SettingsForm key={q.data!.shop.id} shop={q.data!.shop} />}</QueryState>
    </>
  );
}

const is24h = (h: OpeningHours) => DAYS.every((d) => h[d]?.open === '00:00' && h[d]?.close === '24:00');

function SettingsForm({ shop }: { shop: ShopRow }) {
  const [name, setName] = useState(shop.name);
  const [address, setAddress] = useState(shop.address);
  const [phone, setPhone] = useState(shop.phone ?? '');
  const [whatsapp, setWhatsapp] = useState(shop.whatsapp ?? '');
  const [hours, setHours] = useState<OpeningHours>(shop.opening_hours);
  const [allDay, setAllDay] = useState(is24h(shop.opening_hours));
  const [facilities, setFacilities] = useState<Record<string, boolean>>(shop.facilities ?? {});
  const [policy, setPolicy] = useState({ en: shop.policy?.en ?? '', ms: shop.policy?.ms ?? '', zh: shop.policy?.zh ?? '' });
  const s = { ...DEFAULT_SHOP_SETTINGS, ...(shop.settings ?? {}) };
  const [threshold, setThreshold] = useState(String(s.faultReportThreshold));
  const [remind, setRemind] = useState(String(s.remindBeforeMin));
  const [hold, setHold] = useState(String(s.finishedHoldMin));
  const [uncollected, setUncollected] = useState(String(s.uncollectedReminderMin));
  const [tariff, setTariff] = useState(((s.electricitySenPerKwh ?? 50) / 100).toFixed(3));
  const [published, setPublished] = useState(shop.is_published);
  const [saved, setSaved] = useState(false);

  const save = useApiMutation(
    () =>
      api.patch(`/owner/shops/${shop.id}`, {
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim() || null,
        whatsapp: whatsapp.trim() || null,
        openingHours: allDay ? Object.fromEntries(DAYS.map((d) => [d, { open: '00:00', close: '24:00' }])) : hours,
        facilities,
        policy: Object.fromEntries(Object.entries(policy).filter(([, v]) => v.trim()).map(([l, v]) => [l, v.trim()])),
        settings: { faultReportThreshold: Number(threshold), remindBeforeMin: Number(remind), finishedHoldMin: Number(hold), uncollectedReminderMin: Number(uncollected), electricitySenPerKwh: Math.round(Number(tariff) * 1000) / 10 },
        isPublished: published,
      }),
    [['owner', 'shop', shop.id], ['owner', 'overview'], k.me],
    () => setSaved(true),
  );

  const setDay = (d: (typeof DAYS)[number], v: { open: string; close: string } | null) => setHours((h) => ({ ...h, [d]: v }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        save.mutate(undefined);
      }}
      onChange={() => setSaved(false)}
    >
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-4 text-sm">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Your shop page {!shop.is_published && <span className="text-warning-ink">(hidden from customers: turn on “Published” below)</span>}</p>
          <a href={`/s/${shop.slug}`} target="_blank" rel="noreferrer" className="break-all text-brand">
            {`${window.location.origin}/s/${shop.slug}`}
          </a>
          <p className="text-xs text-muted">Share it on WhatsApp, Facebook and your Google Maps listing.</p>
        </div>
        <CopyButton text={`${window.location.origin}/s/${shop.slug}`} label="Copy link" />
        <Link to={`/owner/shops/${shop.id}/poster`} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">
          <Icon name="print" className="h-4 w-4" /> Poster
        </Link>
      </Card>
      <Section title="Shop" className="mt-0">
        <Card className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} />
          </Field>
          <Field label="Address">
            <input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
          </Field>
          <Field label="Phone">
            <input className={inputClass} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
          </Field>
          <Field label="WhatsApp" hint="Customers get a “WhatsApp us” button">
            <input className={inputClass} type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} maxLength={30} />
          </Field>
          <div className="sm:col-span-2">
            <Toggle checked={published} onChange={setPublished} label="Published" hint="Unpublished shops are hidden from the customer app" />
          </div>
        </Card>
      </Section>

      <Section title="Opening hours">
        <Card className="p-4">
          <Toggle checked={allDay} onChange={setAllDay} label="Open 24 hours, every day" />
          {!allDay && (
            <div className="mt-3 space-y-2">
              {DAYS.map((d, i) => {
                const v = hours[d];
                return (
                  <div key={d} className="flex flex-wrap items-center gap-2">
                    <span className="w-10 text-sm font-medium">{WEEKDAYS[i]}</span>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={!!v} onChange={(e) => setDay(d, e.target.checked ? { open: '08:00', close: '22:00' } : null)} className="h-4 w-4 accent-[var(--brand)]" />
                      Open
                    </label>
                    {v ? (
                      <>
                        <select aria-label={`${WEEKDAYS[i]} opens`} className={cx(inputClass, 'w-auto py-1.5')} value={v.open} onChange={(e) => setDay(d, { ...v, open: e.target.value })}>
                          {TIMES.slice(0, 48).map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                        <span className="text-muted">–</span>
                        <select aria-label={`${WEEKDAYS[i]} closes`} className={cx(inputClass, 'w-auto py-1.5')} value={v.close} onChange={(e) => setDay(d, { ...v, close: e.target.value })}>
                          {TIMES.slice(1).map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <span className="text-sm text-muted">Closed</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </Section>

      <Section title="Facilities">
        <Card className="grid gap-x-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {FACILITIES.map((f) => (
            <Toggle key={f.key} checked={!!facilities[f.key]} onChange={(v) => setFacilities((x) => ({ ...x, [f.key]: v }))} label={f.label} />
          ))}
        </Card>
      </Section>

      <Section title="Clothes-removal policy">
        <Card className="space-y-3 p-4">
          <p className="text-xs text-muted">Shown next to machines that have finished but still have laundry inside.</p>
          <Field label="English">
            <textarea className={inputClass} rows={2} value={policy.en} onChange={(e) => setPolicy({ ...policy, en: e.target.value })} maxLength={2000} />
          </Field>
          <Field label="Bahasa Melayu">
            <textarea className={inputClass} rows={2} value={policy.ms} onChange={(e) => setPolicy({ ...policy, ms: e.target.value })} maxLength={2000} />
          </Field>
          <Field label="中文">
            <textarea className={inputClass} rows={2} value={policy.zh} onChange={(e) => setPolicy({ ...policy, zh: e.target.value })} maxLength={2000} />
          </Field>
        </Card>
      </Section>

      <Section title="Faults & reminders">
        <Card className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Reports to mark a machine faulty" hint="Different customers within 24 hours (1–10)">
            <input className={inputClass} type="number" min={1} max={10} value={threshold} onChange={(e) => setThreshold(e.target.value)} required />
          </Field>
          <Field label="“Almost done” reminder (min before end)" hint="1–30">
            <input className={inputClass} type="number" min={1} max={30} value={remind} onChange={(e) => setRemind(e.target.value)} required />
          </Field>
          <Field label="Show “finished, laundry inside” for (min)" hint="5–120">
            <input className={inputClass} type="number" min={5} max={120} value={hold} onChange={(e) => setHold(e.target.value)} required />
          </Field>
          <Field label="“Please collect” reminder after (min)" hint="1–120">
            <input className={inputClass} type="number" min={1} max={120} value={uncollected} onChange={(e) => setUncollected(e.target.value)} required />
          </Field>
          <Field label="Electricity price (RM per kWh)" hint="All-in, from your TNB bill (energy + surcharges). Used for the electricity cost per cycle on sensor-equipped machines.">
            <input className={inputClass} type="number" min={0.01} max={5} step={0.001} value={tariff} onChange={(e) => setTariff(e.target.value)} required />
          </Field>
        </Card>
      </Section>

      <div className="sticky bottom-20 mt-6 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-line bg-surface p-3 shadow-sm lg:bottom-4">
        {saved && (
          <span role="status" className="mr-auto flex items-center gap-1.5 text-sm text-good-ink">
            <Icon name="checkCircle" className="h-4 w-4" /> Saved
          </span>
        )}
        <MutationError error={save.error} />
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  );
}
