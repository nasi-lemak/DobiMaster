export const rm = (sen: number | null | undefined) => (sen == null ? '—' : `RM ${(sen / 100).toFixed(2)}`);
export const rm0 = (sen: number | null | undefined) => (sen == null ? '—' : `RM ${Math.round(sen / 100).toLocaleString('en-MY')}`);
export const pct = (v: number | null | undefined, digits = 0) => (v == null ? '—' : `${(v * 100).toFixed(digits)}%`);

export function minutesLeft(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 60_000));
}

export function clock(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' });
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return '—';
  const m = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
