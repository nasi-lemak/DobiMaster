/** Tiny fetch wrapper. Owner calls use the httpOnly session cookie; customer calls carry the guest token. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const GUEST_KEY = 'dobi.guest';

export function getGuestToken(): string | null {
  try {
    return localStorage.getItem(GUEST_KEY);
  } catch {
    return null;
  }
}

let guestPromise: Promise<string> | null = null;

/** Guests are created silently on first need — no sign-up, ever. */
export async function ensureGuest(locale = 'en'): Promise<string> {
  const existing = getGuestToken();
  if (existing) return existing;
  guestPromise ??= request<{ token: string }>('POST', '/public/guest', { locale }).then((r) => {
    try {
      localStorage.setItem(GUEST_KEY, r.token);
    } catch {
      /* private mode: token lives for this page only */
    }
    return r.token;
  });
  return guestPromise;
}

/** Forget this phone's guest identity (after "Delete my data"); the next request starts a fresh guest. */
export function forgetGuest() {
  try {
    localStorage.removeItem(GUEST_KEY);
  } catch {
    /* ignore */
  }
  guestPromise = null;
}

export async function request<T>(method: string, path: string, body?: unknown, opts: { guest?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.guest) headers.authorization = `Bearer ${await ensureGuest()}`;
  const res = await fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && opts.guest) {
      // Token from another environment / DB reset: start a fresh guest once.
      try {
        localStorage.removeItem(GUEST_KEY);
      } catch {
        /* ignore */
      }
      guestPromise = null;
    }
    throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? res.statusText, data?.details);
  }
  return data as T;
}

/** Upload a prepared photo as the raw request body (see lib/image.ts). */
export async function uploadPhoto(path: string, blob: Blob, opts: { guest?: boolean } = {}): Promise<{ attachment: { id: string; url?: string } }> {
  const headers: Record<string, string> = { 'content-type': blob.type || 'image/jpeg' };
  if (opts.guest) headers.authorization = `Bearer ${await ensureGuest()}`;
  const res = await fetch(`/api/v1${path}`, { method: 'POST', headers, body: blob, credentials: 'same-origin' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? res.statusText);
  return data;
}

export const api = {
  get: <T>(path: string, opts?: { guest?: boolean }) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: { guest?: boolean; headers?: Record<string, string> }) => request<T>('POST', path, body ?? {}, opts),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string, opts?: { guest?: boolean }) => request<T>('DELETE', path, undefined, opts),
};

export function uuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (+c / 4)))).toString(16));
}
