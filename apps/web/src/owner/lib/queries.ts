import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';

/** All owner query keys start with 'owner' so they never collide with the customer app's cache. */
export const k = {
  me: ['owner', 'me'] as const,
  overview: ['owner', 'overview'] as const,
  shops: ['owner', 'shops'] as const,
  shop: (id: string) => ['owner', 'shop', id] as const,
  machines: (shopId?: string) => ['owner', 'machines', shopId ?? 'all'] as const,
  machine: (id: string) => ['owner', 'machine', id] as const,
  tickets: (status: string, shopId?: string, machineId?: string) => ['owner', 'tickets', status, shopId ?? 'all', machineId ?? 'all'] as const,
  ticket: (id: string) => ['owner', 'ticket', id] as const,
  refunds: (status: string) => ['owner', 'refunds', status] as const,
  alerts: (status: string) => ['owner', 'alerts', status] as const,
  analytics: (...parts: Array<string | number | undefined>) => ['owner', 'analytics', ...parts] as const,
  collections: (shopId?: string) => ['owner', 'collections', shopId ?? 'all'] as const,
  recon: (shopId?: string) => ['owner', 'recon', shopId ?? 'all'] as const,
  due: (shopId?: string) => ['owner', 'maintenance', 'due', shopId ?? 'all'] as const,
  plans: ['owner', 'maintenance', 'plans'] as const,
  checklistsToday: (shopId?: string) => ['owner', 'checklists', 'today', shopId ?? 'all'] as const,
  checklistTemplates: ['owner', 'checklists', 'templates'] as const,
  devices: ['owner', 'devices'] as const,
  announcements: ['owner', 'announcements'] as const,
  staff: ['owner', 'staff'] as const,
  audit: (entityType?: string) => ['owner', 'audit', entityType ?? 'all'] as const,
};

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [key, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(key, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export function useApi<T>(key: QueryKey, path: string, opts: { enabled?: boolean; refetchInterval?: number; keepPrevious?: boolean } = {}) {
  return useQuery({
    queryKey: key,
    queryFn: () => api.get<T>(path),
    enabled: opts.enabled,
    refetchInterval: opts.refetchInterval,
    placeholderData: opts.keepPrevious ? keepPreviousData : undefined,
  });
}

/**
 * Mutation that invalidates the given key prefixes on success. Errors are surfaced to the caller via
 * `errorMessage(m.error)`; buttons should be disabled while `isPending`.
 */
export function useApiMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>, invalidate: QueryKey[] = [], onSuccess?: (r: TResult, vars: TVars) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r, vars) => {
      onSuccess?.(r, vars);
      await Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
  });
}

export function errorMessage(e: unknown): string {
  if (!e) return '';
  if (e instanceof ApiError) {
    if (e.status === 403) return "You don't have permission to do that.";
    return e.message || 'Something went wrong';
  }
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}
