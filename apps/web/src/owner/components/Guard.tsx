import type { ReactNode } from 'react';
import type { Permission } from '@dobi/shared';
import { EmptyState } from '../../components/ui';
import { useCan } from '../lib/session';

/** Route-level permission gate (the API enforces the same rule; this avoids a screen of 403s). */
export function Guard({ perm, children }: { perm: Permission; children: ReactNode }) {
  const can = useCan();
  if (!can(perm)) return <EmptyState title="Not available for your role">Ask the shop owner if you need access to this page.</EmptyState>;
  return <>{children}</>;
}
