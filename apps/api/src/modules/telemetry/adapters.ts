import { z } from 'zod';
import type { Sample } from './detector.js';

/**
 * Observation adapters turn vendor payloads into normalised samples.
 * Add one per device family (e.g. Shelly webhook/RPC status, vendor cloud APIs, Modbus gateway).
 */
export interface ObservationAdapter {
  kind: string;
  parse(payload: unknown, receivedAt: Date): Sample[];
}

const genericSchema = z.object({
  samples: z
    .array(z.object({ ts: z.union([z.string(), z.number()]).optional(), powerW: z.number().min(0).max(100_000) }))
    .min(1)
    .max(500),
});

/** Our own format: {samples:[{ts?, powerW}]}. Used by ESP32 firmware, the simulator and bridges. */
export const genericPowerAdapter: ObservationAdapter = {
  kind: 'generic_power',
  parse(payload, receivedAt) {
    const p = genericSchema.parse(payload);
    return p.samples.map((s) => ({
      ts: s.ts === undefined ? receivedAt.getTime() : typeof s.ts === 'number' ? s.ts : Date.parse(s.ts),
      powerW: s.powerW,
    }));
  },
};

const shellySchema = z.object({
  // Shelly Gen2+ "Switch.GetStatus"/"EM1.GetStatus"-style payload forwarded by a script or MQTT bridge.
  apower: z.number().optional(),
  act_power: z.number().optional(),
  ts: z.number().optional(), // unix seconds
});

/** Shelly Gen2+/Gen3 status payloads (apower for PM switches, act_power for EM meters). */
export const shellyAdapter: ObservationAdapter = {
  kind: 'shelly',
  parse(payload, receivedAt) {
    const items = Array.isArray(payload) ? payload : [payload];
    return items.map((raw) => {
      const p = shellySchema.parse(raw);
      return { ts: p.ts ? p.ts * 1000 : receivedAt.getTime(), powerW: Math.max(0, p.apower ?? p.act_power ?? 0) };
    });
  },
};

export const adapters: Record<string, ObservationAdapter> = {
  generic_power: genericPowerAdapter,
  esp32_ct: genericPowerAdapter,
  simulator: genericPowerAdapter,
  shelly: shellyAdapter,
};
