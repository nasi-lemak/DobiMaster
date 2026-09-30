import { api, ensureGuest } from './api';

export type PushSupport = 'supported' | 'needs-install' | 'unsupported' | 'denied';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;

export function pushSupport(): PushSupport {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // iOS Safari only exposes Web Push to installed (home-screen) web apps.
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  return 'supported';
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function subscription() {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = await api.get<{ publicKey: string }>('/public/push/vapid-key');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  }
  return sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
}

/** Ask permission at the moment the user sees why (starting a timer), then register with the API. */
export async function enableCustomerPush(locale: string): Promise<boolean> {
  if (pushSupport() !== 'supported') return false;
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return false;
  await ensureGuest(locale);
  const sub = await subscription();
  await api.post('/public/push/subscribe', { ...sub, locale }, { guest: true });
  return true;
}

export async function enableOwnerPush(): Promise<boolean> {
  if (pushSupport() !== 'supported') return false;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;
  await api.post('/owner/push/subscribe', await subscription());
  return true;
}

export function registerServiceWorker() {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  } else if ('serviceWorker' in navigator && import.meta.env.DEV) {
    // Dev: still register so push can be tested locally.
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}
