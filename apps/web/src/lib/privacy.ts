import { api, forgetGuest } from './api';

/**
 * "Delete my data on this phone": erase the guest on the server, stop browser push, and forget the
 * guest ID stored here (only the language choice stays). Returns how many open problem reports keep
 * the phone number until they are resolved.
 */
export async function deleteMyData(): Promise<number> {
  const res = await api.del<{ openReportsKeepingPhone: number }>('/public/me', { guest: true });
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {
    /* push not supported or already off */
  }
  forgetGuest();
  return res.openReportsKeepingPhone;
}
