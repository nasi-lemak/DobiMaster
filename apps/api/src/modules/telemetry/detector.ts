/**
 * Cycle detection from power readings — a pure, per-device-configurable state machine.
 *
 *  idle → running : power > startW continuously for startSec (filters door-lock / display blips)
 *  running → idle : power < endW continuously for endSec (washers need a long endSec: fill/soak phases draw little power)
 *  cycles shorter than minCycleSec are discarded as noise; cycles longer than maxCycleMin are force-closed (stuck).
 */

export interface DetectorConfig {
  startW: number;
  endW: number;
  startSec: number;
  endSec: number;
  minCycleSec: number;
  maxCycleMin: number;
}

export const WASHER_DEFAULTS: DetectorConfig = { startW: 30, endW: 10, startSec: 20, endSec: 240, minCycleSec: 300, maxCycleMin: 150 };
export const DRYER_DEFAULTS: DetectorConfig = { startW: 60, endW: 20, startSec: 15, endSec: 90, minCycleSec: 180, maxCycleMin: 120 };

export interface DetectorState {
  phase: 'idle' | 'running';
  /** First timestamp of the current above-startW streak while idle. */
  aboveSince: number | null;
  /** First timestamp of the current below-endW streak while running. */
  belowSince: number | null;
  /** When the current cycle started (ms). */
  cycleStart: number | null;
  /** Latest sample timestamp seen (ms) — older samples are ignored. */
  lastTs: number | null;
  /** Sum of W·s and seconds during the cycle, for average-power anomaly checks. */
  energyWs: number;
  lastPowerW: number | null;
}

export const initialDetectorState = (): DetectorState => ({
  phase: 'idle',
  aboveSince: null,
  belowSince: null,
  cycleStart: null,
  lastTs: null,
  energyWs: 0,
  lastPowerW: null,
});

export type DetectorEvent =
  | { type: 'cycle_started'; at: number }
  | { type: 'cycle_ended'; at: number; startedAt: number; avgPowerW: number }
  | { type: 'cycle_discarded'; at: number; startedAt: number }
  | { type: 'cycle_stuck'; at: number; startedAt: number };

export interface Sample {
  ts: number;
  powerW: number;
}

/**
 * Readings this far apart mean the sensor was off (power cut, unplugged, no Wi-Fi): a running sensor reports
 * every ~10 s and the Shelly script buffers ~10 min. What happened in between is unknown, so:
 *  - if the machine is idle when readings resume, the cycle ended while we weren't looking: end it at the
 *    last moment it was seen running (instead of calling it "stuck" hours later);
 *  - if it is still drawing power, carry on, but don't count energy across the gap.
 */
export const GAP_RESET_MS = 15 * 60_000;

export function step(state: DetectorState, sample: Sample, cfg: DetectorConfig): { state: DetectorState; events: DetectorEvent[] } {
  const s = { ...state };
  const events: DetectorEvent[] = [];
  if (s.lastTs !== null && sample.ts <= s.lastTs) return { state: s, events }; // out-of-order or duplicate
  const gap = s.lastTs !== null && sample.ts - s.lastTs > GAP_RESET_MS;
  if (gap && s.phase === 'idle') s.aboveSince = null;
  if (gap && s.phase === 'running') {
    if (sample.powerW < cfg.endW) {
      const startedAt = s.cycleStart!;
      const endedAt = s.belowSince ?? s.lastTs!;
      // Not a "blip": it was still running when we lost sight of it, so it ran at least this long.
      const durSec = (endedAt - startedAt) / 1000;
      events.push({ type: 'cycle_ended', at: endedAt, startedAt, avgPowerW: durSec > 0 ? s.energyWs / durSec : 0 });
      return { state: { ...initialDetectorState(), lastTs: sample.ts, lastPowerW: sample.powerW }, events };
    }
    s.lastPowerW = null; // still running: skip energy for the unseen gap
  }

  if (s.phase === 'running' && s.lastTs !== null && s.lastPowerW !== null) {
    s.energyWs += s.lastPowerW * ((sample.ts - s.lastTs) / 1000);
  }
  s.lastTs = sample.ts;
  s.lastPowerW = sample.powerW;

  if (s.phase === 'idle') {
    if (sample.powerW > cfg.startW) {
      s.aboveSince ??= sample.ts;
      if (sample.ts - s.aboveSince >= cfg.startSec * 1000) {
        s.phase = 'running';
        s.cycleStart = s.aboveSince;
        s.aboveSince = null;
        s.belowSince = null;
        s.energyWs = 0;
        events.push({ type: 'cycle_started', at: s.cycleStart });
      }
    } else {
      s.aboveSince = null;
    }
    return { state: s, events };
  }

  // running
  const startedAt = s.cycleStart!;
  if (sample.ts - startedAt > cfg.maxCycleMin * 60_000) {
    events.push({ type: 'cycle_stuck', at: sample.ts, startedAt });
    return { state: { ...initialDetectorState(), lastTs: sample.ts, lastPowerW: sample.powerW }, events };
  }
  if (sample.powerW < cfg.endW) {
    s.belowSince ??= sample.ts;
    if (sample.ts - s.belowSince >= cfg.endSec * 1000) {
      const endedAt = s.belowSince;
      const durSec = (endedAt - startedAt) / 1000;
      if (durSec < cfg.minCycleSec) {
        events.push({ type: 'cycle_discarded', at: endedAt, startedAt });
      } else {
        events.push({ type: 'cycle_ended', at: endedAt, startedAt, avgPowerW: durSec > 0 ? s.energyWs / durSec : 0 });
      }
      return { state: { ...initialDetectorState(), lastTs: sample.ts, lastPowerW: sample.powerW }, events };
    }
  } else {
    s.belowSince = null;
  }
  return { state: s, events };
}

export function runDetector(state: DetectorState, samples: Sample[], cfg: DetectorConfig) {
  let st = state;
  const events: DetectorEvent[] = [];
  for (const sample of [...samples].sort((a, b) => a.ts - b.ts)) {
    const r = step(st, sample, cfg);
    st = r.state;
    events.push(...r.events);
  }
  return { state: st, events };
}
