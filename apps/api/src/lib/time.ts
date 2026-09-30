import type { OpeningHours } from '@dobi/shared';

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** ISO weekday, 1 = Monday … 7 = Sunday */
  isoDow: number;
  /** YYYY-MM-DD in the shop's timezone */
  date: string;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const DOW: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localParts(d: Date, tz: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(d)) parts[p.type] = p.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    isoDow: DOW[parts.weekday!] ?? 1,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Offset (ms) of tz from UTC at instant d. */
export function tzOffsetMs(d: Date, tz: string): number {
  const p = localParts(d, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(d.getTime() / 60000) * 60000;
}

/** UTC instant of local midnight for the local date containing d. */
export function startOfLocalDay(d: Date, tz: string): Date {
  const p = localParts(d, tz);
  const guess = Date.UTC(p.year, p.month - 1, p.day) - tzOffsetMs(d, tz);
  return new Date(guess);
}

/** UTC instant for a local date string (YYYY-MM-DD) at 00:00. */
export function localDateToUtc(date: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const approx = new Date(Date.UTC(y, m - 1, d, 12));
  return new Date(Date.UTC(y, m - 1, d) - tzOffsetMs(approx, tz));
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Open intervals (minutes since local midnight) for an ISO weekday. Handles overnight closing (e.g. 08:00–02:00). */
export function openIntervalsForDow(hours: OpeningHours, isoDow: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const today = hours[String(isoDow) as keyof OpeningHours];
  if (today) {
    const o = toMin(today.open);
    const c = toMin(today.close);
    out.push(c > o ? [o, c] : [o, 24 * 60]);
  }
  const prevDow = isoDow === 1 ? 7 : isoDow - 1;
  const prev = hours[String(prevDow) as keyof OpeningHours];
  if (prev) {
    const o = toMin(prev.open);
    const c = toMin(prev.close);
    if (c <= o && c > 0) out.push([0, c]);
  }
  return out;
}

export function isOpenAt(hours: OpeningHours, d: Date, tz: string): boolean {
  const p = localParts(d, tz);
  const m = p.hour * 60 + p.minute;
  return openIntervalsForDow(hours, p.isoDow).some(([o, c]) => m >= o && m < c);
}

export function openMinutesOnDow(hours: OpeningHours, isoDow: number): number {
  return openIntervalsForDow(hours, isoDow).reduce((s, [o, c]) => s + (c - o), 0);
}

/** Is the shop open during local hour h (any minute of it) on iso weekday dow. */
export function isOpenDuringHour(hours: OpeningHours, isoDow: number, h: number): boolean {
  return openIntervalsForDow(hours, isoDow).some(([o, c]) => o < (h + 1) * 60 && c > h * 60);
}

export function addMinutes(d: Date, min: number): Date {
  return new Date(d.getTime() + min * 60_000);
}

export function is24h(hours: OpeningHours): boolean {
  return Object.values(hours).every((h) => h && h.open === '00:00' && (h.close === '24:00' || h.close === '00:00'));
}
