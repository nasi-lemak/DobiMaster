import { describe, expect, it } from 'vitest';
import { initialDetectorState, runDetector, WASHER_DEFAULTS, type Sample } from '../src/modules/telemetry/detector.js';
import { deriveMachineState, type DeriveInput } from '../src/modules/machines/derive.js';
import { isOpenAt, openIntervalsForDow, startOfLocalDay } from '../src/lib/time.js';
import { openIntervals } from '../src/modules/analytics/service.js';

const s = (sec: number, powerW: number): Sample => ({ ts: sec * 1000, powerW });

describe('power cycle detector', () => {
  it('ignores short blips (door lock, display) below startSec', () => {
    const { events } = runDetector(initialDetectorState(), [s(0, 2), s(5, 80), s(10, 80), s(15, 3), s(30, 2)], WASHER_DEFAULTS);
    expect(events).toEqual([]);
  });

  it('detects a washer cycle and survives low-power fill/soak phases', () => {
    const samples: Sample[] = [s(0, 2)];
    for (let t = 10; t <= 600; t += 10) samples.push(s(t, 400)); // wash
    for (let t = 610; t <= 780; t += 10) samples.push(s(t, 5)); // 3 min fill (< endSec 4 min)
    for (let t = 790; t <= 2400; t += 10) samples.push(s(t, 600)); // wash + spin
    for (let t = 2410; t <= 2700; t += 10) samples.push(s(t, 1)); // idle
    const { events, state } = runDetector(initialDetectorState(), samples, WASHER_DEFAULTS);
    expect(events.map((e) => e.type)).toEqual(['cycle_started', 'cycle_ended']);
    const end = events[1] as { at: number; startedAt: number };
    expect(end.startedAt).toBe(10_000);
    expect(end.at).toBe(2410_000);
    expect(state.phase).toBe('idle');
  });

  it('discards cycles shorter than minCycleSec', () => {
    const samples: Sample[] = [];
    for (let t = 0; t <= 120; t += 10) samples.push(s(t, 500));
    for (let t = 130; t <= 500; t += 10) samples.push(s(t, 1));
    const { events } = runDetector(initialDetectorState(), samples, WASHER_DEFAULTS);
    expect(events.map((e) => e.type)).toEqual(['cycle_started', 'cycle_discarded']);
  });

  it('ignores out-of-order samples and is resumable across batches', () => {
    const cfg = { ...WASHER_DEFAULTS, startSec: 20 };
    const a = runDetector(initialDetectorState(), [s(0, 100), s(10, 100)], cfg);
    const b = runDetector(a.state, [s(5, 0), s(25, 100)], cfg);
    expect(b.events.map((e) => e.type)).toEqual(['cycle_started']);
  });

  it('force-closes stuck cycles', () => {
    const cfg = { ...WASHER_DEFAULTS, maxCycleMin: 60 };
    const samples: Sample[] = [];
    for (let t = 0; t <= 3700; t += 60) samples.push(s(t, 300));
    expect(runDetector(initialDetectorState(), samples, cfg).events.map((e) => e.type)).toEqual(['cycle_started', 'cycle_stuck']);
  });
});

describe('machine state derivation', () => {
  const now = new Date('2026-09-30T10:00:00Z');
  const base: DeriveInput = {
    now,
    adminState: 'active',
    staffFault: false,
    faultReporters: 0,
    faultReportThreshold: 2,
    observed: false,
    device: null,
    runningCycle: null,
    lastFinishedCycle: null,
    finishedHoldMin: 20,
  };

  it('admin states win over everything', () => {
    expect(deriveMachineState({ ...base, adminState: 'disabled', staffFault: true }).state).toBe('disabled');
    expect(deriveMachineState({ ...base, adminState: 'maintenance' }).state).toBe('maintenance');
  });

  it('stale sensor heartbeat → offline, only for observed machines', () => {
    const device = { lastSeenAt: new Date(now.getTime() - 4 * 60_000), heartbeatSec: 60 };
    expect(deriveMachineState({ ...base, observed: true, device }).state).toBe('offline');
    expect(deriveMachineState({ ...base, observed: false, device }).state).toBe('available');
  });

  it('one report is a warning, the threshold makes it a fault', () => {
    expect(deriveMachineState({ ...base, faultReporters: 1 }).state).toBe('available');
    expect(deriveMachineState({ ...base, faultReporters: 2 }).state).toBe('fault');
  });

  it('finished laundry holds the machine for finishedHoldMin', () => {
    const f = { id: 'c', endedAt: new Date(now.getTime() - 10 * 60_000), collectedAt: null };
    expect(deriveMachineState({ ...base, lastFinishedCycle: f }).state).toBe('finished');
    expect(deriveMachineState({ ...base, lastFinishedCycle: { ...f, endedAt: new Date(now.getTime() - 30 * 60_000) } }).state).toBe('available');
    expect(deriveMachineState({ ...base, lastFinishedCycle: { ...f, collectedAt: now } }).state).toBe('available');
  });

  it('reports honest sources', () => {
    expect(deriveMachineState(base).source).toBe('none');
    expect(deriveMachineState({ ...base, observed: true, device: { lastSeenAt: now, heartbeatSec: 60 } }).source).toBe('sensor');
    const rc = { id: 'c', source: 'customer' as const, sensorConfirmed: false, expectedEndAt: now };
    expect(deriveMachineState({ ...base, runningCycle: rc }).source).toBe('customer');
    expect(deriveMachineState({ ...base, runningCycle: { ...rc, sensorConfirmed: true } }).source).toBe('sensor');
  });
});

describe('opening hours', () => {
  const tz = 'Asia/Kuala_Lumpur';
  const hours = {
    '1': { open: '08:00', close: '02:00' },
    '2': { open: '08:00', close: '02:00' },
    '3': { open: '08:00', close: '02:00' },
    '4': { open: '08:00', close: '02:00' },
    '5': { open: '08:00', close: '02:00' },
    '6': null,
    '7': null,
  };
  it('handles overnight closing', () => {
    expect(openIntervalsForDow(hours, 2)).toEqual([
      [480, 1440],
      [0, 120],
    ]);
    // Tuesday 01:00 local (Mon night) is open; Saturday 01:00 (Fri night) open; Sunday 01:00 closed.
    expect(isOpenAt(hours, new Date('2026-09-29T01:00:00+08:00'), tz)).toBe(true);
    expect(isOpenAt(hours, new Date('2026-10-03T01:00:00+08:00'), tz)).toBe(true);
    expect(isOpenAt(hours, new Date('2026-10-04T01:00:00+08:00'), tz)).toBe(false);
  });

  it('computes local midnight and open intervals in UTC', () => {
    expect(startOfLocalDay(new Date('2026-09-30T20:00:00Z'), tz).toISOString()).toBe('2026-09-30T16:00:00.000Z');
    const shop = { id: 's', name: 's', timezone: tz, opening_hours: hours };
    const ivs = openIntervals(shop, new Date('2026-09-28T16:00:00Z'), new Date('2026-09-29T16:00:00Z')); // Tuesday local
    const minutes = ivs.reduce((a, [x, y]) => a + (y - x) / 60_000, 0);
    expect(minutes).toBe(120 + 16 * 60); // Mon-night tail + Tuesday 08:00–24:00
  });
});
