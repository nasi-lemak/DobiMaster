/** Round axis maximum and evenly spaced ticks (0 / 1,000 / 2,000 …). */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

/** Compact RM for axis ticks: "RM 0", "RM 500", "RM 1.2k", "RM 20k". */
export function rmTick(sen: number) {
  const r = sen / 100;
  if (r >= 1000) return `RM ${(r / 1000).toFixed(r >= 10_000 || r % 1000 === 0 ? 0 : 1)}k`;
  return `RM ${Math.round(r)}`;
}

/** "2026-09-23" → "23 Sep"; "2026-09" → "Sep 2026"; other keys unchanged. */
export function periodLabel(key: string, groupBy: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const d = new Date(`${key}T00:00:00`);
    const s = d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
    return groupBy === 'week' ? `Wk ${s}` : s;
  }
  if (/^\d{4}-\d{2}$/.test(key)) return new Date(`${key}-01T00:00:00`).toLocaleDateString('en-MY', { month: 'short', year: 'numeric' });
  return key;
}
