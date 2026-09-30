import { useState } from 'react';
import { api } from '../../lib/api';
import { Button, Field, inputClass } from '../../components/ui';
import { Modal, MutationError } from './common';
import { parseRm } from '../lib/fmt';
import { useApiMutation } from '../lib/queries';

/** "Log maintenance done" for one machine (optionally against a plan). */
export function LogMaintenanceModal({ open, onClose, machineId, machineCode, planId, planTitle }: { open: boolean; onClose: () => void; machineId: string; machineCode: string; planId?: string | null; planTitle?: string | null }) {
  const [notes, setNotes] = useState('');
  const [cost, setCost] = useState('');
  const close = () => {
    setNotes('');
    setCost('');
    m.reset();
    onClose();
  };
  const m = useApiMutation(
    () => api.post('/owner/maintenance/logs', { machineId, planId: planId ?? null, notes: notes.trim() || null, costSen: parseRm(cost) }),
    [['owner', 'maintenance'], ['owner', 'machine', machineId], ['owner', 'overview'], ['owner', 'alerts']],
    () => close(),
  );
  const costInvalid = cost.trim() !== '' && parseRm(cost) == null;
  return (
    <Modal
      open={open}
      onClose={close}
      title={`Log maintenance · ${machineCode}`}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate(undefined)} disabled={m.isPending || costInvalid}>
            {m.isPending ? 'Saving…' : 'Log as done now'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {planTitle && (
          <p className="text-sm">
            Plan: <span className="font-medium">{planTitle}</span>
          </p>
        )}
        <Field label="Notes (optional)">
          <textarea className={inputClass} rows={3} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="What was done, parts replaced…" />
        </Field>
        <Field label="Cost in RM (optional)" error={costInvalid ? 'Enter an amount like 45 or 45.50' : null}>
          <input className={inputClass} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
        </Field>
        <MutationError error={m.error} />
      </div>
    </Modal>
  );
}
