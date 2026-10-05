import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { MACHINE_PRESETS, type MachinePreset, type Program } from '@dobi/shared';
import { api } from '../../lib/api';
import { Button, Card, cx, Field, inputClass } from '../../components/ui';
import { CopyButton, MutationError, PageHeader, QueryState, Segmented, Toggle } from '../components/common';
import { Icon } from '../components/icons';
import { k, useApi, useApiMutation } from '../lib/queries';
import { FACILITIES, TIMES } from './ShopSettings';

interface Onboarding {
  steps: { shop: boolean; machines: boolean; stickers: boolean; live: boolean };
  complete: boolean;
  shop: { id: string; name: string; slug: string; published: boolean; publicUrl: string } | null;
  machines: Array<{ id: string; code: string; type: 'washer' | 'dryer'; capacityKg: number }>;
}

type StepKey = keyof Onboarding['steps'];
const STEPS: Array<{ key: StepKey; title: string }> = [
  { key: 'shop', title: 'Your shop' },
  { key: 'machines', title: 'Machines' },
  { key: 'stickers', title: 'QR stickers' },
  { key: 'live', title: 'Go live' },
];

/** First-run wizard: shop → machines → stickers → go live. Progress is derived from real data on the server. */
export function SetupPage() {
  const q = useApi<Onboarding>(k.onboarding, '/owner/onboarding');
  const [step, setStep] = useState<StepKey | null>(null);

  return (
    <>
      <PageHeader title="Set up your laundromat" subtitle="Customers see nothing until you go live. Coins keep working as they do today." />
      <QueryState q={q}>
        {() => {
          const d = q.data!;
          const firstOpen = STEPS.find((s) => !d.steps[s.key])?.key ?? 'live';
          const current = step ?? firstOpen;
          const next = (from: StepKey) => setStep(STEPS[STEPS.findIndex((s) => s.key === from) + 1]?.key ?? 'live');
          return (
            <div className="max-w-2xl space-y-4">
              <ol className="grid grid-cols-4 gap-1.5" aria-label="Setup steps">
                {STEPS.map((s, i) => {
                  const reachable = i === 0 || d.steps.shop;
                  return (
                    <li key={s.key}>
                      <button
                        type="button"
                        disabled={!reachable}
                        aria-current={current === s.key ? 'step' : undefined}
                        onClick={() => setStep(s.key)}
                        className={cx(
                          'w-full rounded-xl border px-2 py-2 text-left text-xs transition disabled:opacity-50',
                          current === s.key ? 'border-brand bg-surface' : 'border-line bg-surface-2 hover:bg-surface',
                        )}
                      >
                        <span className={cx('mb-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold', d.steps[s.key] ? 'bg-good text-white' : 'bg-surface text-ink-2 ring-1 ring-line')}>
                          {d.steps[s.key] ? <Icon name="check" className="h-3 w-3" /> : i + 1}
                        </span>
                        <span className="font-medium">{s.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              {current === 'shop' && <ShopStep d={d} onDone={() => next('shop')} />}
              {current === 'machines' && d.shop && <MachinesStep d={d} shopId={d.shop.id} onDone={() => next('machines')} />}
              {current === 'stickers' && d.shop && <StickersStep d={d} shopId={d.shop.id} onDone={() => next('stickers')} />}
              {current === 'live' && d.shop && <LiveStep d={d} shopId={d.shop.id} />}
            </div>
          );
        }}
      </QueryState>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// 1. Shop

function ShopStep({ d, onDone }: { d: Onboarding; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', address: '', whatsapp: '' });
  const [hoursMode, setHoursMode] = useState<'24h' | 'daily'>('24h');
  const [open, setOpen] = useState('07:00');
  const [close, setClose] = useState('24:00');
  const [facilities, setFacilities] = useState<Record<string, boolean>>({});
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const m = useApiMutation((body: unknown) => api.post<{ shopId: string }>('/owner/onboarding/shop', body), [k.onboarding, k.me, k.overview, k.shops], onDone);

  if (d.shop)
    return (
      <Card className="space-y-3 p-5">
        <p className="text-sm">
          <strong>{d.shop.name}</strong> is set up. You can change its hours, prices and facilities any time in{' '}
          <Link to={`/owner/settings?shop=${d.shop.id}`} className="text-brand">
            Shop settings
          </Link>
          .
        </p>
        <Button onClick={onDone}>Next: machines</Button>
      </Card>
    );

  const locate = () => {
    if (!('geolocation' in navigator)) return setLocMsg('Location isn’t available on this device.');
    setLocMsg('Finding you…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) });
        setLocMsg(null);
      },
      () => setLocMsg('Couldn’t get your location. You can add it later in Shop settings.'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate({
      name: form.name.trim(),
      address: form.address.trim(),
      whatsapp: form.whatsapp.trim() || null,
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      hours: hoursMode === '24h' ? { mode: '24h' } : { mode: 'daily', open, close },
      facilities,
    });
  };
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <Field label="Shop name" hint="What customers see, e.g. Dobi Ceria SS2">
        <input className={inputClass} required minLength={2} maxLength={120} value={form.name} onChange={set('name')} />
      </Field>
      <Field label="Address">
        <textarea className={inputClass} rows={2} maxLength={300} value={form.address} onChange={set('address')} />
      </Field>
      <div className="space-y-1">
        <Button type="button" variant="secondary" size="sm" onClick={locate}>
          Use my location (stand inside the shop)
        </Button>
        {loc && <p className="text-xs text-good-ink">Location saved · {loc.lat}, {loc.lng} · customers can find you on “nearby”</p>}
        {locMsg && <p className="text-xs text-muted">{locMsg}</p>}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Opening hours</p>
        <Segmented
          label="Opening hours"
          value={hoursMode}
          onChange={setHoursMode}
          options={[
            { value: '24h', label: 'Open 24 hours' },
            { value: 'daily', label: 'Same hours every day' },
          ]}
        />
        {hoursMode === 'daily' && (
          <div className="flex items-center gap-2 text-sm">
            <select aria-label="Opens at" className={cx(inputClass, 'w-28')} value={open} onChange={(e) => setOpen(e.target.value)}>
              {TIMES.slice(0, -1).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            to
            <select aria-label="Closes at" className={cx(inputClass, 'w-28')} value={close} onChange={(e) => setClose(e.target.value)}>
              {TIMES.slice(1).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
        )}
        <p className="text-xs text-muted">Different hours on some days? Adjust them later in Shop settings.</p>
      </div>
      <Field label="WhatsApp number (optional)" hint="Shown on your shop page so customers can reach you, e.g. +60123456789">
        <input className={inputClass} type="tel" inputMode="tel" maxLength={30} value={form.whatsapp} onChange={set('whatsapp')} />
      </Field>
      <div>
        <p className="text-sm font-medium">Facilities</p>
        <div className="grid sm:grid-cols-2">
          {FACILITIES.map((f) => (
            <Toggle key={f.key} checked={!!facilities[f.key]} onChange={(v) => setFacilities((x) => ({ ...x, [f.key]: v }))} label={f.label} />
          ))}
        </div>
      </div>
      <p className="text-xs text-muted">We’ll also add a starter daily cleaning checklist and maintenance reminders (dryer lint ducts, washer descaling). You can edit them later.</p>
      <MutationError error={m.error} />
      <Button type="submit" disabled={m.isPending}>
        {m.isPending ? 'Saving…' : 'Save and continue'}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// 2. Machines

interface Row {
  quantity: number;
  programs: Program[];
}

/** "W1–W4" for the next `count` free numbers after the shop's existing machines. */
function codePreview(existing: string[], prefix: 'W' | 'D', count: number) {
  if (!count) return null;
  const used = new Set(existing.map((c) => c.toUpperCase()));
  const codes: string[] = [];
  for (let n = 1; codes.length < count; n++) if (!used.has(`${prefix}${n}`)) codes.push(`${prefix}${n}`);
  return codes.length === 1 ? codes[0] : `${codes[0]}–${codes[codes.length - 1]}`;
}

function MachinesStep({ d, shopId, onDone }: { d: Onboarding; shopId: string; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(MACHINE_PRESETS.map((p) => [p.id, { quantity: 0, programs: p.programs }])));
  const [detergentAuto, setDetergentAuto] = useState(false);
  const [softenerAuto, setSoftenerAuto] = useState(false);
  const [adding, setAdding] = useState(!d.steps.machines);
  const m = useApiMutation((body: unknown) => api.post('/owner/onboarding/machines', body), [k.onboarding, k.overview, ['owner', 'machines']], () => {
    setRows((r) => Object.fromEntries(Object.entries(r).map(([id, row]) => [id, { ...row, quantity: 0 }])));
    setAdding(false);
  });

  const chosen = MACHINE_PRESETS.filter((p) => rows[p.id]!.quantity > 0);
  const washers = chosen.filter((p) => p.type === 'washer').reduce((s, p) => s + rows[p.id]!.quantity, 0);
  const dryers = chosen.filter((p) => p.type === 'dryer').reduce((s, p) => s + rows[p.id]!.quantity, 0);
  const existing = d.machines.map((x) => x.code);
  const update = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id]!, ...patch } }));

  const submit = () =>
    m.mutate({
      shopId,
      detergentAuto,
      softenerAuto,
      groups: chosen.map((p) => ({ presetId: p.id, quantity: rows[p.id]!.quantity, programs: rows[p.id]!.programs })),
    });

  return (
    <div className="space-y-4">
      {d.machines.length > 0 && (
        <Card className="space-y-3 p-5">
          <p className="text-sm font-medium">
            {d.machines.length} machine{d.machines.length === 1 ? '' : 's'} added
          </p>
          <div className="flex flex-wrap gap-1.5">
            {d.machines.map((x) => (
              <span key={x.id} className="rounded-lg bg-surface-2 px-2 py-1 text-xs">
                {x.code} · {x.capacityKg} kg
              </span>
            ))}
          </div>
          <p className="text-xs text-muted">Brand, model and per-machine prices can be edited later on each machine’s page.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onDone}>Next: QR stickers</Button>
            {!adding && (
              <Button variant="secondary" onClick={() => setAdding(true)}>
                <Icon name="plus" className="h-4 w-4" /> Add more machines
              </Button>
            )}
          </div>
        </Card>
      )}
      {adding && (
        <Card className="space-y-4 p-5">
          <div>
            <p className="font-medium">How many of each machine do you have?</p>
            <p className="text-sm text-muted">Pick the closest size. Prices are a starting point: change them to match your price board.</p>
          </div>
          <div className="divide-y divide-line">
            {MACHINE_PRESETS.map((p) => (
              <PresetRow key={p.id} preset={p} row={rows[p.id]!} onChange={(patch) => update(p.id, patch)} />
            ))}
          </div>
          <div>
            <Toggle checked={detergentAuto} onChange={setDetergentAuto} label="Washers add detergent automatically" hint="Changes the customer instructions: “no need to add detergent”" />
            <Toggle checked={softenerAuto} onChange={setSoftenerAuto} label="Washers add softener automatically" />
          </div>
          {washers + dryers > 0 && (
            <p className="rounded-xl bg-surface-2 p-3 text-sm">
              Will be numbered{' '}
              {[codePreview(existing, 'W', washers), codePreview(existing, 'D', dryers)].filter(Boolean).join(' and ')}. Number the machines in the shop the same way (the
              stickers will show these codes).
            </p>
          )}
          <MutationError error={m.error} />
          <Button onClick={submit} disabled={m.isPending || washers + dryers === 0}>
            {m.isPending ? 'Adding…' : `Add ${washers + dryers || ''} machine${washers + dryers === 1 ? '' : 's'}`}
          </Button>
        </Card>
      )}
    </div>
  );
}

function PresetRow({ preset, row, onChange }: { preset: MachinePreset; row: Row; onChange: (patch: Partial<Row>) => void }) {
  const setQty = (n: number) => onChange({ quantity: Math.max(0, Math.min(30, n)) });
  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon name="washer" className="h-5 w-5 text-muted" />
          <span className="text-sm font-medium">{preset.label}</span>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label={`${preset.label} quantity`}>
          <button type="button" aria-label={`Fewer ${preset.label}`} className="h-8 w-8 rounded-lg bg-surface-2 text-lg leading-none disabled:opacity-40" disabled={row.quantity === 0} onClick={() => setQty(row.quantity - 1)}>
            −
          </button>
          <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">
            {row.quantity}
          </span>
          <button type="button" aria-label={`More ${preset.label}`} className="h-8 w-8 rounded-lg bg-surface-2 text-lg leading-none" onClick={() => setQty(row.quantity + 1)}>
            +
          </button>
        </div>
      </div>
      {row.quantity > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2 pl-7">
          {row.programs.map((prog, i) => (
            <label key={prog.id} className="text-xs text-muted">
              {/min$/.test(prog.name.en) ? prog.name.en : `${prog.name.en} · ${prog.durationMin} min`}
              <span className="mt-0.5 flex items-center gap-1">
                RM
                <input
                  className={cx(inputClass, 'px-2 py-1.5')}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.5}
                  aria-label={`${preset.label} ${prog.name.en} price (RM)`}
                  value={prog.priceSen / 100}
                  onChange={(e) => {
                    const priceSen = Math.round(Number(e.target.value) * 100);
                    onChange({ programs: row.programs.map((x, j) => (j === i ? { ...x, priceSen: Number.isFinite(priceSen) ? Math.max(0, priceSen) : 0 } : x)) });
                  }}
                />
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 3. Stickers

function StickersStep({ d, shopId, onDone }: { d: Onboarding; shopId: string; onDone: () => void }) {
  const mark = useApiMutation(() => api.post('/owner/onboarding/stickers-printed'), [k.onboarding]);
  return (
    <Card className="space-y-4 p-5">
      <div className="space-y-2 text-sm">
        <p className="font-medium">Print a QR sticker for every machine</p>
        <ul className="list-disc space-y-1 pl-5 text-ink-2">
          <li>One A4 sheet holds the stickers for {d.machines.length} machine{d.machines.length === 1 ? '' : 's'}, plus one for the shop door.</li>
          <li>Stick each one at eye level on the matching machine (W1 on W1…). Laminated or vinyl stickers last longest near water.</li>
          <li>Customers scan to see instructions in their language, start a timer, get “almost done” alerts and report problems.</li>
          <li>
            Also print the{' '}
            <Link to={`/owner/shops/${shopId}/poster`} className="font-medium text-brand">
              customer poster
            </Link>{' '}
            for the entrance: it explains how it works in BM, English and 中文.
          </li>
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          to={`/owner/shops/${shopId}/qr-sheet`}
          onClick={() => mark.mutate(undefined)}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-medium text-brand-ink hover:opacity-90"
        >
          <Icon name="print" className="h-4 w-4" /> Open sticker sheet
        </Link>
        <Button variant={d.steps.stickers ? 'primary' : 'secondary'} onClick={onDone}>
          {d.steps.stickers ? 'Next: go live' : 'I’ll print them later'}
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// 4. Go live

function LiveStep({ d, shopId }: { d: Onboarding; shopId: string }) {
  const m = useApiMutation(() => api.post('/owner/onboarding/go-live', { shopId }), [k.onboarding, k.overview, k.shops]);
  const [justLive, setJustLive] = useState(false);
  useEffect(() => {
    if (m.isSuccess) setJustLive(true);
  }, [m.isSuccess]);
  const url = d.shop!.publicUrl;

  if (!d.steps.live)
    return (
      <Card className="space-y-4 p-5">
        <div className="space-y-2 text-sm">
          <p className="font-medium">Ready to show {d.shop!.name} to customers?</p>
          <ul className="list-disc space-y-1 pl-5 text-ink-2">
            <li>Your shop appears in “nearby” and its QR stickers start working for everyone.</li>
            <li>Machine status comes from customers’ timers and staff check-ins until you add sensors. Customers are told so (“from check-ins”), never shown fake live counts.</li>
          </ul>
          {!d.steps.machines && <p className="text-warning-ink">Add your machines first.</p>}
        </div>
        <MutationError error={m.error} />
        <Button onClick={() => m.mutate(undefined)} disabled={m.isPending || !d.steps.machines}>
          {m.isPending ? 'Publishing…' : 'Go live'}
        </Button>
      </Card>
    );

  return (
    <Card className="space-y-4 p-5">
      <p className="font-medium">{justLive ? '🎉 You’re live!' : `${d.shop!.name} is live`}</p>
      <div className="space-y-1">
        <p className="text-sm text-ink-2">Your shop page: share it on WhatsApp, Google Maps and Facebook.</p>
        <div className="flex flex-wrap items-center gap-2">
          <a href={url} target="_blank" rel="noreferrer" className="break-all text-sm font-medium text-brand">
            {url}
          </a>
          <CopyButton text={url} label="Copy link" />
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">What next</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <NextLink to="/owner/staff" icon="users" title="Invite staff" text="So they can do check-ins, cleaning and cash." />
          <NextLink to="/owner/devices" icon="sensor" title="Add sensors" text="Optional: live status, about RM 150–250 per machine." />
          <NextLink to="/owner" icon="home" title="Dashboard" text="See today at a glance." />
        </div>
      </div>
    </Card>
  );
}

function NextLink({ to, icon, title, text }: { to: string; icon: 'users' | 'sensor' | 'home'; title: string; text: string }) {
  return (
    <Link to={to} className="rounded-xl border border-line p-3 hover:bg-surface-2">
      <Icon name={icon} className="h-5 w-5 text-brand" />
      <p className="mt-1 text-sm font-medium">{title}</p>
      <p className="text-xs text-muted">{text}</p>
    </Link>
  );
}
