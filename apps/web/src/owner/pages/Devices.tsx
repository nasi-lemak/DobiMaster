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

const KINDS = [
  { value: 'generic_power', label: 'Generic power monitor (HTTP)' },
  { value: 'shelly', label: 'Shelly Plus 1PM / Pro EM' },
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
  const [kind, setKind] = useState<string>('generic_power');
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
