import type { AdminState, MachineState, StateSource } from '@dobi/shared';

export interface DeriveInput {
  now: Date;
  adminState: AdminState;
  staffFault: boolean;
  /** Distinct customers with open fault-type reports in the last 24 h. */
  faultReporters: number;
  faultReportThreshold: number;
  observed: boolean;
  device: { lastSeenAt: Date | null; heartbeatSec: number } | null;
  runningCycle: { source: StateSource; sensorConfirmed: boolean; expectedEndAt: Date; id: string } | null;
  lastFinishedCycle: { endedAt: Date; collectedAt: Date | null; id: string } | null;
  finishedHoldMin: number;
}

export interface Derived {
  state: MachineState;
  source: StateSource;
  cycleId: string | null;
  expectedEndAt: Date | null;
}

/**
 * The single place that decides what a machine "is". Precedence (highest first):
 * disabled → maintenance → offline → fault → running → finished (laundry inside) → available.
 */
export function deriveMachineState(i: DeriveInput): Derived {
  const base = { cycleId: null, expectedEndAt: null };
  if (i.adminState === 'disabled') return { ...base, state: 'disabled', source: 'staff' };
  if (i.adminState === 'maintenance') return { ...base, state: 'maintenance', source: 'staff' };

  if (i.observed && i.device) {
    const staleMs = 3 * i.device.heartbeatSec * 1000;
    if (!i.device.lastSeenAt || i.now.getTime() - i.device.lastSeenAt.getTime() > staleMs) {
      return { ...base, state: 'offline', source: 'system' };
    }
  }

  if (i.staffFault) return { ...base, state: 'fault', source: 'staff' };
  if (i.faultReporters >= i.faultReportThreshold) return { ...base, state: 'fault', source: 'customer' };

  if (i.runningCycle) {
    return {
      state: 'running',
      source: i.runningCycle.sensorConfirmed ? 'sensor' : i.runningCycle.source,
      cycleId: i.runningCycle.id,
      expectedEndAt: i.runningCycle.expectedEndAt,
    };
  }

  const f = i.lastFinishedCycle;
  if (f && !f.collectedAt && i.now.getTime() - f.endedAt.getTime() < i.finishedHoldMin * 60_000) {
    return { state: 'finished', source: i.observed ? 'sensor' : 'customer', cycleId: f.id, expectedEndAt: null };
  }

  return { ...base, state: 'available', source: i.observed ? 'sensor' : 'none' };
}
