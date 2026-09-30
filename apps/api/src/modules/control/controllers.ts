import type { ControlKind, Program } from '@dobi/shared';
import type { Ctx } from '../../context.js';
import type { Machine } from '../../db/types.js';

export interface StartCommand {
  commandId: string;
  machine: Machine;
  program: Program;
}

/**
 * Controlling a machine is separate from observing it. A controller only *requests* a start;
 * the start counts as successful only when observation (sensor/vendor status) confirms it.
 * Implementations must be idempotent by commandId (a retry must never double-start).
 */
export interface MachineController {
  kind: ControlKind;
  start(ctx: Ctx, cmd: StartCommand): Promise<void>;
}

/**
 * Simulated controller for demos/tests: pretends to pulse the machine, and emits the power readings
 * a real sensor would see (via the device attached to the machine). Set device config `simFail: 1`
 * to simulate a machine that does not start, exercising the auto-refund path.
 */
/** Longer than the demo sensors' start/end debounce. */
const SIM_HOLD_SEC = 25;

export class SimulatedController implements MachineController {
  kind = 'simulated' as const;
  async start(ctx: Ctx, cmd: StartCommand) {
    const device = cmd.machine.device_id
      ? await ctx.db.selectFrom('devices').select(['id', 'config']).where('id', '=', cmd.machine.device_id).executeTakeFirst()
      : undefined;
    if (!device || device.config?.simFail) return;
    const t0 = ctx.now().getTime();
    await ctx.jobs.schedule('sim.power', new Date(t0 + 2000), { deviceId: device.id, powerW: 1800, holdSec: SIM_HOLD_SEC }, `sim.power:${cmd.commandId}:on`);
    await ctx.jobs.schedule(
      'sim.power',
      new Date(t0 + 2000 + cmd.program.durationMin * 60_000),
      { deviceId: device.id, powerW: 2, holdSec: SIM_HOLD_SEC },
      `sim.power:${cmd.commandId}:off`,
    );
  }
}

export class ControllerRegistry {
  private map = new Map<ControlKind, MachineController>();
  register(c: MachineController) {
    this.map.set(c.kind, c);
    return this;
  }
  get(kind: ControlKind): MachineController | undefined {
    return kind === 'none' ? undefined : this.map.get(kind);
  }
}

export function defaultControllers() {
  return new ControllerRegistry().register(new SimulatedController());
}
