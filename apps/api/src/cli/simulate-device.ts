/**
 * Pretend to be a power sensor on a washer: posts a realistic (time-compressed) power curve to the
 * telemetry endpoint so you can watch a machine go available → running → finished in the UIs.
 *
 *   pnpm --filter @dobi/api simulate -- --token demo-dobi-ceria-ss2-W4 --minutes 3
 *   pnpm --filter @dobi/api simulate -- --token <device token> --url https://your-host --fail
 *
 * Phases: fill (low) → wash (≈400 W, agitating) → soak (≈5 W) → rinse → spin (≈900 W) → idle.
 * Real washers need a long end-debounce because of the soak/fill dips — see detector.ts.
 */
const args = process.argv.slice(2);
const arg = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const token = arg('token');
const url = arg('url', 'http://localhost:3000')!;
const minutes = Number(arg('minutes', '3'));
const intervalSec = Number(arg('interval', '5'));
if (!token) {
  console.error('Usage: simulate -- --token <device token> [--minutes 3] [--url http://localhost:3000] [--interval 5]');
  process.exit(1);
}

function powerAt(frac: number): number {
  const jitter = () => (Math.random() - 0.5) * 40;
  if (frac < 0.08) return 15 + jitter() / 4; // fill: valve + controller
  if (frac < 0.45) return 380 + jitter() + (Math.floor(frac * 200) % 2 ? 60 : -60); // wash, motor reversing
  if (frac < 0.52) return 5; // soak / drain pause
  if (frac < 0.75) return 350 + jitter(); // rinse
  if (frac < 0.97) return 850 + jitter() * 3; // spin
  return 3; // done
}

async function post(powerW: number) {
  const res = await fetch(`${url}/api/v1/device/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ samples: [{ ts: Date.now(), powerW: Math.max(0, Math.round(powerW)) }] }),
  });
  const body = (await res.json()) as { events?: string[]; message?: string };
  if (!res.ok) throw new Error(`${res.status} ${body.message}`);
  return body.events ?? [];
}

const total = minutes * 60;
console.log(`Simulating a ${minutes}-minute washer cycle every ${intervalSec}s → ${url}`);
for (let t = 0; t <= total + 30; t += intervalSec) {
  const w = t <= total ? powerAt(t / total) : 2;
  const events = await post(w);
  process.stdout.write(`t=${String(t).padStart(4)}s  ${String(Math.round(w)).padStart(4)} W ${events.length ? ' → ' + events.join(', ') : ''}\n`);
  await new Promise((r) => setTimeout(r, intervalSec * 1000));
}
export {};
