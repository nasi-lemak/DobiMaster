import { createContext, useContext, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@dobi/shared';
import { api, ApiError } from '../../lib/api';
import type { Me } from './types';

const MeContext = createContext<Me | null>(null);

export function MeProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe outside MeProvider');
  return me;
}

/** Permission check against GET /owner/me. UI hides what the user lacks; the API enforces it anyway. */
export function useCan() {
  const me = useMe();
  return (p: Permission) => me.permissions.includes(p);
}

export function useShopName() {
  const me = useMe();
  return (id: string | null | undefined) => me.shops.find((s) => s.id === id)?.name ?? '—';
}

/**
 * Log out: end the session on the server, then drop every owner query (OwnerApp shows the login screen).
 * Only clears the screen once the server confirmed: on a shared shop tablet, "logged out" must be true.
 */
export function useLogout() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const logout = async () => {
    setError(null);
    try {
      await api.post('/owner/auth/logout');
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) {
        setError('Couldn’t sign out: check the connection and try again.');
        return false;
      }
    }
    qc.setQueryData(['owner', 'me'], null);
    qc.removeQueries({ queryKey: ['owner'], predicate: (q) => q.queryKey[1] !== 'me' });
    return true;
  };
  return { logout, error };
}

/** Shop names without the words every branch shares ("Dobi Ceria SS2" → "SS2"), for tight labels. */
export function useShortShopName() {
  const me = useMe();
  const words = me.shops.map((s) => s.name.split(' '));
  let common = 0;
  if (words.length > 1) {
    while (words.every((w) => w.length > common + 1 && w[common] === words[0]![common])) common++;
  }
  return (name: string) => (common ? name.split(' ').slice(common).join(' ') : name);
}
