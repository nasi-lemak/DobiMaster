import { useEffect, useState } from 'react';

/** Re-render every `ms` so relative times ("12 min") stay fresh. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Compact duration: "4 min", "2 h 5 min", "3 d 4 h". */
export function duration(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

export const since = (iso: string | null | undefined, now = Date.now()) => (iso ? duration(now - new Date(iso).getTime()) : '—');

export function shortDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
}

/** "RM 5.00" → 500 sen. Returns null for blank/invalid input. */
export function parseRm(v: string): number | null {
  const t = v.trim().replace(/^rm\s*/i, '');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export const senToRmInput = (sen: number | null | undefined) => (sen == null ? '' : (sen / 100).toFixed(2));

export const hours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);

/** RM with thousands separators and cents, for charts and tables: "RM 20,757.12". */
export const rmc = (sen: number | null | undefined) =>
  sen == null ? '—' : `${sen < 0 ? '−' : ''}RM ${(Math.abs(sen) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
