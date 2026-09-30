import { useState, type FormEvent } from 'react';
import { CONTROL_KINDS, OBSERVATION_KINDS, type ControlKind, type MachineType, type ObservationKind, type Program } from '@dobi/shared';
import { Button, Field, inputClass } from '../../components/ui';
import { parseRm, senToRmInput } from '../lib/fmt';
import type { OwnerMachine } from '../lib/types';
import { MutationError, ShopSelect, Toggle } from './common';
import { Icon } from './icons';

type Lang = 'en' | 'ms' | 'zh';
const LANGS: Array<{ code: Lang; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ms', label: 'Bahasa Melayu' },
  { code: 'zh', label: '中文' },
];

interface ProgramDraft {
  id: string;
  name: Record<Lang, string>;
  durationMin: string;
  price: string;
}

const DEFAULT_PROGRAMS: Record<MachineType, Program[]> = {
  washer: [
    { id: 'cold', name: { en: 'Cold', ms: 'Sejuk', zh: '冷水' }, durationMin: 30, priceSen: 500 },
    { id: 'warm', name: { en: 'Warm', ms: 'Suam', zh: '温水' }, durationMin: 35, priceSen: 600 },
    { id: 'hot', name: { en: 'Hot', ms: 'Panas', zh: '热水' }, durationMin: 40, priceSen: 700 },
  ],
  dryer: [
    { id: 'dry30', name: { en: 'Dry 30 min', ms: 'Kering 30 min', zh: '烘干 30 分钟' }, durationMin: 30, priceSen: 400 },
    { id: 'dry40', name: { en: 'Dry 40 min', ms: 'Kering 40 min', zh: '烘干 40 分钟' }, durationMin: 40, priceSen: 500 },
  ],
};

const toDraft = (p: Program): ProgramDraft => ({
  id: p.id,
  name: { en: p.name.en ?? '', ms: p.name.ms ?? '', zh: p.name.zh ?? '' },
  durationMin: String(p.durationMin),
  price: senToRmInput(p.priceSen),
});

const OBS_LABEL: Record<ObservationKind, string> = { none: 'None (check-ins only)', power_monitor: 'Power monitor sensor', vendor: 'Vendor integration' };
const CTRL_LABEL: Record<ControlKind, string> = { none: 'None (coins / own QR)', simulated: 'Simulated (demo)', pulse: 'Coin-pulse interface', vendor: 'Vendor API' };

export type MachinePayload = Record<string, unknown>;

/** Add (bulk codes) or edit one machine. Money is entered in RM and sent as integer sen. */
export function MachineForm({
  mode,
  initial,
  defaultShopId,
  onSubmit,
  pending,
  error,
  onCancel,
}: {
  mode: 'add' | 'edit';
  initial?: OwnerMachine;
  defaultShopId?: string;
  onSubmit: (body: MachinePayload) => void;
  pending: boolean;
  error: unknown;
  onCancel?: () => void;
}) {
  const [shopId, setShopId] = useState(initial?.shopId ?? defaultShopId ?? '');
  const [codes, setCodes] = useState(initial?.code ?? '');
  const [type, setType] = useState<MachineType>(initial?.type ?? 'washer');
  const [capacity, setCapacity] = useState(String(initial?.capacityKg ?? 10));
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [programs, setPrograms] = useState<ProgramDraft[]>((initial?.programs ?? DEFAULT_PROGRAMS.washer).map(toDraft));
  const [instructions, setInstructions] = useState<Record<Lang, string>>({ en: initial?.instructions?.en ?? '', ms: initial?.instructions?.ms ?? '', zh: initial?.instructions?.zh ?? '' });
  const [load, setLoad] = useState<Record<Lang, string>>({ en: initial?.recommendedLoad?.en ?? '', ms: initial?.recommendedLoad?.ms ?? '', zh: initial?.recommendedLoad?.zh ?? '' });
  const [detergentAuto, setDetergentAuto] = useState(initial?.detergentAuto ?? false);
  const [softenerAuto, setSoftenerAuto] = useState(initial?.softenerAuto ?? false);
  const [observation, setObservation] = useState<ObservationKind>(initial?.observation ?? 'none');
  const [control, setControl] = useState<ControlKind>(initial?.control ?? 'none');
  const [cost, setCost] = useState(senToRmInput(initial?.purchaseCostSen));
  const [installedAt, setInstalledAt] = useState(initial?.installedAt?.slice(0, 10) ?? '');
  const [lang, setLang] = useState<Lang>('en');
  const [localError, setLocalError] = useState<string | null>(null);

  const codeList = codes
    .split(/[,\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  const setProgram = (i: number, patch: Partial<ProgramDraft>) => setPrograms((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const progs: Program[] = [];
    for (const [i, p] of programs.entries()) {
      const priceSen = parseRm(p.price);
      const dur = Number(p.durationMin);
      if (!p.id.trim() || !p.name.en.trim()) return setLocalError(`Program ${i + 1}: needs an id and an English name`);
      if (priceSen == null) return setLocalError(`Program ${i + 1}: enter a price in RM`);
      if (!Number.isInteger(dur) || dur < 1 || dur > 240) return setLocalError(`Program ${i + 1}: duration must be 1–240 minutes`);
      progs.push({ id: p.id.trim(), name: { en: p.name.en.trim(), ...(p.name.ms.trim() && { ms: p.name.ms.trim() }), ...(p.name.zh.trim() && { zh: p.name.zh.trim() }) }, durationMin: dur, priceSen });
    }
    if (!progs.length) return setLocalError('Add at least one program');
    if (mode === 'add' && !shopId) return setLocalError('Choose a shop');
    if (!codeList.length) return setLocalError('Enter a machine code');
    const cap = Number(capacity);
    if (!(cap >= 1 && cap <= 100)) return setLocalError('Capacity must be 1–100 kg');
    const trimI18n = (o: Record<Lang, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.trim()).map(([k2, v]) => [k2, v.trim()]));
    const body: MachinePayload = {
      type,
      capacityKg: cap,
      brand: brand.trim() || null,
      model: model.trim() || null,
      programs: progs,
      instructions: trimI18n(instructions),
      recommendedLoad: trimI18n(load),
      detergentAuto,
      softenerAuto,
      observation,
      control,
      purchaseCostSen: parseRm(cost),
      installedAt: installedAt || null,
    };
    if (mode === 'add') onSubmit({ ...body, shopId, code: codeList[0], codes: codeList });
    else onSubmit({ ...body, code: codeList[0] });
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-base font-semibold">Machine</legend>
        {mode === 'add' && (
          <div className="sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Shop</span>
            <ShopSelect value={shopId} onChange={setShopId} allowAll={false} />
          </div>
        )}
        <Field label={mode === 'add' ? 'Machine codes' : 'Machine code'} hint={mode === 'add' ? `Separate with commas, e.g. “W1, W2, W3”${codeList.length > 1 ? ` — ${codeList.length} machines will be added` : ''}` : 'Printed in large type on the sticker'}>
          <input className={inputClass} value={codes} onChange={(e) => setCodes(e.target.value)} required maxLength={mode === 'add' ? 400 : 12} placeholder="W1" />
        </Field>
        <Field label="Type">
          <select
            className={inputClass}
            value={type}
            onChange={(e) => {
              const t = e.target.value as MachineType;
              setType(t);
              if (mode === 'add') setPrograms(DEFAULT_PROGRAMS[t].map(toDraft));
            }}
          >
            <option value="washer">Washer</option>
            <option value="dryer">Dryer</option>
          </select>
        </Field>
        <Field label="Capacity (kg)">
          <input className={inputClass} inputMode="decimal" value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
        </Field>
        <Field label="Brand (optional)">
          <input className={inputClass} value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Model (optional)">
          <input className={inputClass} value={model} onChange={(e) => setModel(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Purchase cost RM (optional)" hint="Used for payback estimates">
          <input className={inputClass} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
        <Field label="Installed on (optional)">
          <input className={inputClass} type="date" value={installedAt} onChange={(e) => setInstalledAt(e.target.value)} />
        </Field>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-base font-semibold">Programs &amp; prices</legend>
        <div className="space-y-3">
          {programs.map((p, i) => (
            <div key={i} className="rounded-2xl border border-line p-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                <Field label="Id">
                  <input className={inputClass} value={p.id} onChange={(e) => setProgram(i, { id: e.target.value })} maxLength={40} required />
                </Field>
                <Field label="Name (EN)">
                  <input className={inputClass} value={p.name.en} onChange={(e) => setProgram(i, { name: { ...p.name, en: e.target.value } })} required />
                </Field>
                <Field label="Name (BM)">
                  <input className={inputClass} value={p.name.ms} onChange={(e) => setProgram(i, { name: { ...p.name, ms: e.target.value } })} />
                </Field>
                <Field label="Name (中文)">
                  <input className={inputClass} value={p.name.zh} onChange={(e) => setProgram(i, { name: { ...p.name, zh: e.target.value } })} />
                </Field>
                <Field label="Minutes">
                  <input className={inputClass} inputMode="numeric" value={p.durationMin} onChange={(e) => setProgram(i, { durationMin: e.target.value })} required />
                </Field>
                <Field label="Price RM">
                  <input className={inputClass} inputMode="decimal" value={p.price} onChange={(e) => setProgram(i, { price: e.target.value })} required />
                </Field>
              </div>
              {programs.length > 1 && (
                <button type="button" onClick={() => setPrograms((ps) => ps.filter((_, j) => j !== i))} className="mt-2 text-xs font-medium text-critical-ink underline">
                  Remove program
                </button>
              )}
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3"
          disabled={programs.length >= 12}
          onClick={() => setPrograms((ps) => [...ps, { id: `p${ps.length + 1}`, name: { en: '', ms: '', zh: '' }, durationMin: '30', price: '' }])}
        >
          <Icon name="plus" className="h-4 w-4" /> Add program
        </Button>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-base font-semibold">Customer instructions</legend>
        <div role="tablist" aria-label="Language" className="mb-3 inline-flex rounded-xl bg-surface-2 p-0.5">
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              role="tab"
              aria-selected={lang === l.code}
              onClick={() => setLang(l.code)}
              className={`rounded-[10px] px-3 py-1.5 text-sm font-medium ${lang === l.code ? 'bg-surface shadow-sm' : 'text-muted'}`}
            >
              {l.label}
              {(instructions[l.code] || load[l.code]) && <span aria-label=" (filled)"> ✓</span>}
            </button>
          ))}
        </div>
        <div className="grid gap-4">
          <Field label={`How to use (${LANGS.find((l) => l.code === lang)!.label})`} hint="One step per line. English is used when a language is missing.">
            <textarea className={inputClass} rows={6} value={instructions[lang]} onChange={(e) => setInstructions({ ...instructions, [lang]: e.target.value })} maxLength={2000} />
          </Field>
          <Field label={`Recommended load (${LANGS.find((l) => l.code === lang)!.label})`} hint="e.g. “≈ 1 queen comforter or 2 full baskets”">
            <input className={inputClass} value={load[lang]} onChange={(e) => setLoad({ ...load, [lang]: e.target.value })} maxLength={2000} />
          </Field>
        </div>
        <div className="mt-3 grid gap-1 sm:grid-cols-2">
          <Toggle checked={detergentAuto} onChange={setDetergentAuto} label="Detergent added automatically" hint="Customers are told not to add their own" />
          <Toggle checked={softenerAuto} onChange={setSoftenerAuto} label="Softener added automatically" />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-base font-semibold">Capabilities</legend>
        <Field label="Observation (how we know it's running)">
          <select className={inputClass} value={observation} onChange={(e) => setObservation(e.target.value as ObservationKind)}>
            {OBSERVATION_KINDS.map((o) => (
              <option key={o} value={o}>
                {OBS_LABEL[o]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Control (pay & start in app)" hint="Only enable for machines with a verified safe control path">
          <select className={inputClass} value={control} onChange={(e) => setControl(e.target.value as ControlKind)}>
            {CONTROL_KINDS.map((o) => (
              <option key={o} value={o}>
                {CTRL_LABEL[o]}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      {localError && <p role="alert" className="text-sm text-critical-ink">{localError}</p>}
      <MutationError error={error} />
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : mode === 'add' ? (codeList.length > 1 ? `Add ${codeList.length} machines` : 'Add machine') : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
