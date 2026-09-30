import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui';
import { shortDate } from '../lib/fmt';
import { useCan } from '../lib/session';
import type { DueItem } from '../lib/types';
import { Meter, StatusTag, type Tone } from './common';
import { LogMaintenanceModal } from './LogMaintenance';

const STATUS: Record<DueItem['status'], { tone: Tone; label: string }> = {
  due: { tone: 'serious', label: 'Due' },
  due_soon: { tone: 'warning', label: 'Due soon' },
  ok: { tone: 'good', label: 'OK' },
};

/** Which configured triggers exist and how far along each one is; the leading trigger is bold. */
function triggers(d: DueItem) {
  const list = [
    d.intervalDays ? { r: d.daysSince / d.intervalDays, text: `${d.daysSince} of ${d.intervalDays} days` } : null,
    d.intervalCycles ? { r: d.cyclesSince / d.intervalCycles, text: `${d.cyclesSince} of ${d.intervalCycles} cycles${d.cycleSource === 'counter' ? ' (counter)' : ''}` } : null,
    d.intervalRunHours ? { r: d.runHoursSince / d.intervalRunHours, text: `${d.runHoursSince} of ${d.intervalRunHours} run-hours` } : null,
  ].filter((x): x is { r: number; text: string } => !!x);
  const max = Math.max(...list.map((x) => x.r));
  return list.map((x) => ({ ...x, lead: x.r === max }));
}

export function DueItemRow({ d, showMachine = true }: { d: DueItem; showMachine?: boolean }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const s = STATUS[d.status];
  return (
    <div className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {showMachine && (
              <Link to={`/owner/machines/${d.machineId}`} className="mr-1.5 font-bold underline-offset-2 hover:underline">
                {d.machineCode}
              </Link>
            )}
            {d.title}
          </div>
          <div className="mt-0.5 text-xs text-muted">Last done {d.lastDoneAt ? shortDate(d.lastDoneAt) : 'never (since install)'}</div>
        </div>
        <StatusTag tone={s.tone}>{s.label}</StatusTag>
      </div>
      <Meter className="mt-2.5" value={Math.min(1, d.progress)} tone={s.tone} label={`${d.machineCode} ${d.title}: ${Math.round(d.progress * 100)}% of interval`} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-x-3 text-xs text-ink-2">
          {triggers(d).map((t) => (
            <span key={t.text} className={t.lead ? 'font-semibold text-ink' : ''}>
              {t.text}
            </span>
          ))}
        </div>
        {can('maintenance.log') && (
          <Button size="sm" variant={d.status === 'ok' ? 'secondary' : 'primary'} onClick={() => setOpen(true)}>
            Log done
          </Button>
        )}
      </div>
      <LogMaintenanceModal open={open} onClose={() => setOpen(false)} machineId={d.machineId} machineCode={d.machineCode} planId={d.planId} planTitle={d.title} />
    </div>
  );
}
