import { createContext, useContext, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@dobi/shared';
import { api } from '../../lib/api';
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

/** Log out: clear the cookie, drop every owner query and re-check /owner/me (which then shows the login screen). */
export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    try {
      await api.post('/owner/auth/logout');
    } finally {
      // /owner/me resolves to null when signed out; OwnerApp then renders the login screen.
      qc.setQueryData(['owner', 'me'], null);
      qc.removeQueries({ queryKey: ['owner'], predicate: (q) => q.queryKey[1] !== 'me' });
    }
  };
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
