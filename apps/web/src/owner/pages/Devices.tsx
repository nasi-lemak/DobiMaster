import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { Button, Card, EmptyState, Field, inputClass } from '../../components/ui';
import { ago } from '../../lib/format';
import { CopyButton, Modal, MutationError, PageHeader, QueryState, ShopSelect, StatusTag, TableWrap, td, th } from '../components/common';
import { Icon } from '../components/icons';
import { k, qs, useApi, useApiMutation } from '../lib/queries';
import { useCan, useMe, useShopName } from '../lib/session';
import type { DeviceRow, OwnerMachine } from '../lib/types';
// The on-device script lives at the repo root so the API tests run the exact same file.
import shellyTemplate from '../../../../../devices/shelly/dobimaster-sensor.js?raw';

const KINDS = [
  { value: 'generic_power', label: 'Generic power monitor (HTTP)' },
  { value: 'shelly', label: 'Shelly (EM Gen3, Pro EM, Plus 1PM, PM Mini)' },
  { value: 'esp32_ct', label: 'ESP32 + CT clamp' },
  { value: 'simulator', label: 'Simulator (testing)' },
] as const;

interface Registered {
  device: { id: string; kind: string; label: string };
  token: string;
  ingestUrl: string;
}

export function DevicesPage() {
  const can = useCan();
  const shopName = useShopName();
  const [adding, setAdding] = useState(false);
  const [registered, setRegistered] = useState<Registered | null>(null);
  const q = useApi<{ devices: DeviceRow[] }>(k.devices, '/owner/devices', { refetchInterval: 30_000 });

  return (
    <>
      <PageHeader
        title="Sensors"
        subtitle="Power monitors that tell us, without anyone checking in, when a machine runs"
        actions={
          can('machines.manage') &&
          !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Icon name="plus" className="h-4 w-4" /> Register sensor
            </Button>
          )
        }
      />
      {adding && <RegisterForm onCancel={() => setAdding(false)} onDone={(r) => (setAdding(false), setRegistered(r))} />}
      <QueryState q={q}>
        {() =>
          q.data!.devices.length === 0 ? (
            <EmptyState title="No sensors yet">A cheap energy monitor per machine gives live availability and catches silent failures.</EmptyState>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className={th}>Machine</th>
                  <th className={th}>Status</th>
                  <th className={th}>Last seen</th>
                  <th className={`${th} text-right`}>Last reading</th>
                  <th className={th}>Device</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.devices.map((d) => (
                  <tr key={d.id}>
                    <td className={td}>
                      {d.machine_id ? (
                        <Link to={`/owner/machines/${d.machine_id}`} className="font-bold hover:underline">
                          {d.machine_code}
                        </Link>
                      ) : (
                        <span className="text-muted">Not linked</span>
                      )}
                      <div className="text-xs text-muted">{shopName(d.shop_id)}</div>
                    </td>
                    <td className={td}>{d.online ? <StatusTag tone="good">Online</StatusTag> : <StatusTag tone="warning">Not reporting</StatusTag>}</td>
                    <td className={td}>{ago(d.last_seen_at)}</td>
                    <td className={`${td} text-right tabular`}>{d.last_power_w != null ? `${d.last_power_w} W` : '—'}</td>
                    <td className={td}>
                      {d.label || '—'}
                      <div className="text-xs text-muted">
                        {KINDS.find((x) => x.value === d.kind)?.label ?? d.kind} · every {d.heartbeat_sec}s
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )
        }
      </QueryState>
      {registered && <TokenModal r={registered} onClose={() => setRegistered(null)} />}
    </>
  );
}

function RegisterForm({ onCancel, onDone }: { onCancel: () => void; onDone: (r: Registered) => void }) {
  const me = useMe();
  const [shopId, setShopId] = useState(me.shops[0]?.id ?? '');
  const [machineId, setMachineId] = useState('');
  const [kind, setKind] = useState<string>('shelly');
  const [label, setLabel] = useState('');
  const [heartbeat, setHeartbeat] = useState('60');
  const machines = useApi<{ machines: OwnerMachine[] }>(k.machines(shopId), `/owner/machines${qs({ shopId })}`, { enabled: !!shopId });
  const create = useApiMutation(
    () => api.post<Registered>('/owner/devices', { shopId, machineId: machineId || null, kind, label: label.trim(), heartbeatSec: Number(heartbeat) || 60 }),
    [k.devices, ['owner', 'machine'], ['owner', 'machines'], ['owner', 'shop'], ['owner', 'overview']],
    (r) => onDone(r),
  );
  return (
    <Card className="mb-6 space-y-3 p-4" role="region" aria-labelledby="register-sensor-title">
      <h2 id="register-sensor-title" className="font-semibold">
        Register a sensor
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-sm font-medium">Shop</span>
          <ShopSelect value={shopId} onChange={(id) => (setShopId(id), setMachineId(''))} allowAll={false} />
        </div>
        <Field label="Machine it measures">
          <select className={inputClass} value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            <option value="">Link later</option>
            {machines.data?.machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} · {m.type} {m.capacityKg} kg{m.deviceId ? ' (replaces current sensor)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kind">
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label (optional)">
          <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="e.g. W3 clamp, DB box 2" />
        </Field>
        <Field label="Reports every (seconds)" hint="We alert when it misses a few in a row">
          <input className={inputClass} inputMode="numeric" value={heartbeat} onChange={(e) => setHeartbeat(e.target.value)} />
        </Field>
      </div>
      <MutationError error={create.error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={create.isPending || !shopId} onClick={() => create.mutate(undefined)}>
          {create.isPending ? 'Registering…' : 'Register & get token'}
        </Button>
      </div>
    </Card>
  );
}

/** The device token is returned exactly once by the API — make that impossible to miss. */
function TokenModal({ r, onClose }: { r: Registered; onClose: () => void }) {
  const curl = `curl -X POST '${r.ingestUrl}' \\
  -H 'Authorization: Bearer ${r.token}' \\
  -H 'Content-Type: application/json' \\
  -d '{"samples":[{"powerW":1500}]}'`;
  return (
    <Modal
      open
      onClose={onClose}
      title="Sensor registered"
      wide
      // The token can't be recovered: a stray tap outside or Escape must not throw it away.
      dismissible={false}
      footer={
        <Button onClick={onClose}>
          <Icon name="check" className="h-4 w-4" /> I've saved the token
        </Button>
      }
    >
      <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl bg-warning/15 p-3 text-sm text-warning-ink">
        <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>Copy this token now.</strong> It is shown only once and can't be recovered — if it's lost, register the sensor again.
        </span>
      </div>
      <Field label="Device token">
        <div className="flex gap-2">
          <input className={`${inputClass} font-mono text-xs`} readOnly value={r.token} onFocus={(e) => e.currentTarget.select()} />
          <CopyButton text={r.token} />
        </div>
      </Field>
      {r.device.kind === 'shelly' && <ShellySetup r={r} />}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium">Test it: send one power reading</span>
          <CopyButton text={curl} label="Copy command" />
        </div>
        <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 text-xs leading-relaxed">{curl}</pre>
        <p className="mt-2 text-xs text-muted">
          Configure the monitor to POST readings to <code className="break-all">{r.ingestUrl}</code> with this token. A cycle is detected when power rises above the start threshold and falls back.
        </p>
      </div>
    </Modal>
  );
}

const SHELLY_CHANNELS = [
  { value: 'em1:0', label: 'Shelly EM Gen3 / Pro EM — clamp 1' },
  { value: 'em1:1', label: 'Shelly EM Gen3 / Pro EM — clamp 2' },
  { value: 'switch:0', label: 'Shelly Plus 1PM / Pro 1PM (inline, max 16 A)' },
  { value: 'pm1:0', label: 'Shelly PM Mini Gen3 (inline, max 16 A)' },
  { value: 'switch:0', label: 'Shelly Plus Plug UK (plug-in, max 13 A: testing / small washers)' },
] as const;

/** Ready-to-paste on-device script with URL, token and channel filled in, plus install steps. */
function ShellySetup({ r }: { r: Registered }) {
  const [component, setComponent] = useState<string>('em1:0');
  const script = shellyTemplate.replace('__INGEST_URL__', r.ingestUrl).replace('__COMPONENT__', component).replace('__TOKEN__', r.token);
  const download = () => {
    const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `dobimaster-${(r.device.label || r.device.id.slice(0, 8)).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.js`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="mt-4 space-y-3 rounded-xl border border-line p-3" aria-labelledby="shelly-setup-title">
      <h3 id="shelly-setup-title" className="text-sm font-semibold">
        Set up the Shelly
      </h3>
      <Field label="Which Shelly, and which channel measures this machine?" hint="Dryers and big washers need a clamp model (EM); the inline models are for small washers only.">
        <select className={inputClass} value={component} onChange={(e) => setComponent(e.target.value)}>
          {SHELLY_CHANNELS.map((c) => (
            <option key={c.label} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
        <li>Connect the Shelly to the shop Wi-Fi (Shelly app, or its own hotspot at 192.168.33.1) and update its firmware.</li>
        <li>
          Open the Shelly’s web page → <strong>Scripts</strong> → <strong>Create script</strong>, paste the script below and save.
        </li>
        <li>
          Turn on <strong>Run on startup</strong>, then press <strong>Start</strong>.
        </li>
        <li>Run one cycle on the machine and check it shows as running, then finished, in DobiMaster.</li>
      </ol>
      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">Script (contains this sensor’s token — don’t share it)</span>
          <span className="flex shrink-0 gap-2 whitespace-nowrap">
            <CopyButton text={script} label="Copy script" />
            <Button size="sm" variant="secondary" onClick={download}>
              Download
            </Button>
          </span>
        </div>
        <textarea readOnly aria-label="Shelly script" className={`${inputClass} h-40 font-mono text-[11px] leading-snug`} value={script} onFocus={(e) => e.currentTarget.select()} />
      </div>
      <p className="text-xs text-muted">
        One Shelly EM measuring two machines? Register the second machine’s sensor too, then add its line to <code>channels</code> in the same script:{' '}
        <code className="break-all">{'{ component: "em1:1", token: "<second token>" }'}</code>. The full installer checklist is in <code>docs/INSTALL-sensors.md</code>.
      </p>
    </section>
  );
}
