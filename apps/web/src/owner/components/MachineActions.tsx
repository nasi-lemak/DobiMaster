import { useState } from 'react';
import { Link } from 'react-router';
import type { AdminState } from '@dobi/shared';
import { api } from '../../lib/api';
import { Button, Field, inputClass, StateBadge } from '../../components/ui';
import { MutationError, Modal } from './common';
import { useApiMutation } from '../lib/queries';
import { useCan } from '../lib/session';
import { STATE_LABEL, typeLabel } from '../lib/labels';
import type { OwnerMachine } from '../lib/types';

type Mode = null | 'maintenance' | 'disabled' | 'fault';

const INVALIDATE = [['owner', 'shop'], ['owner', 'machine'], ['owner', 'machines'], ['owner', 'overview']];

/**
 * Staff/owner quick actions on one machine. Reasons for maintenance/disabled are shown to customers,
 * so they are required (the API enforces this too).
 */
export function MachineActionsSheet({ machine, open, onClose }: { machine: OwnerMachine; open: boolean; onClose: () => void }) {
  const can = useCan();
  const [mode, setMode] = useState<Mode>(null);
  const [reason, setReason] = useState('');

  const close = () => {
    setMode(null);
    setReason('');
    adminState.reset();
    clear.reset();
    onClose();
  };

  const adminState = useApiMutation(
    (b: { adminState?: AdminState; reason?: string | null; staffFault?: boolean }) => api.post(`/owner/machines/${machine.id}/admin-state`, b),
    INVALIDATE,
    () => close(),
  );
  const clear = useApiMutation(() => api.post(`/owner/machines/${machine.id}/clear`), INVALIDATE, () => close());

  const busy = adminState.isPending || clear.isPending;
  const outOfService = machine.adminState !== 'active';
  const customerFault = machine.state === 'fault' && !machine.staffFault;
  const canClearCheckIn = machine.state === 'finished' || (machine.state === 'running' && machine.stateSource !== 'sensor');

  if (!can('machines.state')) {
    return (
      <Modal open={open} onClose={close} title={`${machine.code} · ${typeLabel(machine.type)}`}>
        <p className="text-sm text-muted">Your role can view this machine but not change its state.</p>
        <Link to={`/owner/machines/${machine.id}`} className="mt-3 inline-block text-sm font-medium text-brand underline">
          Open machine details
        </Link>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={close} title={`${machine.code} · ${typeLabel(machine.type)} ${machine.capacityKg} kg`}>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <StateBadge state={machine.state} label={STATE_LABEL[machine.state]} />
        {machine.adminReason && <span className="text-muted">“{machine.adminReason}”</span>}
      </div>

      {mode ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === 'fault') adminState.mutate({ staffFault: true, reason: reason.trim() || null });
            else adminState.mutate({ adminState: mode, reason: reason.trim() });
          }}
          className="space-y-3"
        >
          <Field
            label={mode === 'fault' ? 'What is wrong? (optional)' : 'Reason — customers will see this'}
            hint={mode === 'maintenance' ? 'e.g. “Technician coming Friday”' : mode === 'disabled' ? 'e.g. “Removed for replacement”' : undefined}
          >
            <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} required={mode !== 'fault'} autoFocus />
          </Field>
          <MutationError error={adminState.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode(null)}>
              Back
            </Button>
            <Button type="submit" variant={mode === 'fault' ? 'danger' : 'primary'} disabled={busy || (mode !== 'fault' && !reason.trim())}>
              {busy ? 'Saving…' : mode === 'maintenance' ? 'Mark maintenance' : mode === 'disabled' ? 'Disable machine' : 'Mark faulty'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="grid gap-2">
          {outOfService ? (
            <Button variant="primary" size="lg" disabled={busy} onClick={() => adminState.mutate({ adminState: 'active' })}>
              Return to service
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="lg" disabled={busy} onClick={() => setMode('maintenance')}>
                Mark maintenance…
              </Button>
              <Button variant="secondary" size="lg" disabled={busy} onClick={() => setMode('disabled')}>
                Disable…
              </Button>
            </>
          )}
          {machine.staffFault ? (
            <Button variant="primary" size="lg" disabled={busy} onClick={() => adminState.mutate({ staffFault: false })}>
              Clear fault
            </Button>
          ) : (
            <Button variant="secondary" size="lg" disabled={busy} onClick={() => setMode('fault')}>
              Mark faulty…
            </Button>
          )}
          {customerFault && (
            <p className="rounded-xl bg-surface-2 p-3 text-xs text-ink-2">
              This fault comes from customer reports. It clears when the open tickets for {machine.code} are resolved.{' '}
              <Link className="font-medium underline" to={`/owner/tickets?machineId=${machine.id}`} onClick={close}>
                View tickets
              </Link>
            </p>
          )}
          {canClearCheckIn && (
            <Button variant="secondary" size="lg" disabled={busy} onClick={() => clear.mutate(undefined)}>
              {machine.state === 'finished' ? 'Emptied — mark as free' : 'Clear check-in (machine is idle)'}
            </Button>
          )}
          <MutationError error={adminState.error ?? clear.error} />
          <Link to={`/owner/machines/${machine.id}`} className="mt-1 text-center text-sm font-medium text-brand underline" onClick={close}>
            Open machine details
          </Link>
        </div>
      )}
    </Modal>
  );
}
