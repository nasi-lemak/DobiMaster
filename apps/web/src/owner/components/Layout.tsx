import { NavLink, Outlet, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@dobi/shared';
import { cx } from '../../components/ui';
import { useChannels } from '../../lib/realtime';
import { k, useApi } from '../lib/queries';
import { useCan, useLogout, useMe } from '../lib/session';
import type { Overview } from '../lib/types';
import { Icon, type IconName } from './icons';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  perm?: Permission;
  anyOf?: Permission[];
  hint?: string;
}

export const PRIMARY_NAV: NavItem[] = [
  { to: '/owner', label: 'Overview', icon: 'home' },
  { to: '/owner/machines', label: 'Machines', icon: 'washer' },
  { to: '/owner/tickets', label: 'Tickets', icon: 'ticket' },
];

export const SECONDARY_NAV: NavItem[] = [
  { to: '/owner/refunds', label: 'Refunds', icon: 'refund', perm: 'refunds.decide', hint: 'Approve, reject, mark paid' },
  { to: '/owner/analytics', label: 'Analytics', icon: 'chart', perm: 'revenue.view', hint: 'Revenue, utilisation, capacity' },
  { to: '/owner/collections', label: 'Collections', icon: 'cash', anyOf: ['collections.create', 'revenue.view'], hint: 'Record cash, reconcile' },
  { to: '/owner/maintenance', label: 'Maintenance', icon: 'wrench', hint: 'Due list and plans' },
  { to: '/owner/checklists', label: 'Checklists', icon: 'checklist', hint: "Today's cleaning runs" },
  { to: '/owner/digest', label: 'Weekly summary', icon: 'log', hint: 'Last week at a glance · email & WhatsApp' },
  { to: '/owner/alerts', label: 'Alerts', icon: 'bell', hint: 'Repeat faults, sensors, low usage' },
  { to: '/owner/announcements', label: 'Announcements', icon: 'megaphone', hint: 'Shown on the shop page' },
  { to: '/owner/devices', label: 'Sensors', icon: 'sensor', hint: 'Power monitors per machine' },
  { to: '/owner/settings', label: 'Shop settings', icon: 'store', perm: 'shops.manage', hint: 'Hours, facilities, policy' },
  { to: '/owner/staff', label: 'Staff', icon: 'users', perm: 'staff.manage', hint: 'Team and branch access' },
  { to: '/owner/audit', label: 'Audit log', icon: 'log', perm: 'audit.view', hint: 'Who changed what' },
  { to: '/owner/security', label: 'Account & devices', icon: 'phone', hint: 'Password, signed-in devices' },
];

export function useNavAllowed() {
  const can = useCan();
  return (n: NavItem) => (!n.perm || can(n.perm)) && (!n.anyOf || n.anyOf.some(can));
}

/** Tenant-wide realtime: events are hints to refetch; polling covers a dropped socket. */
function useOwnerRealtime(tenantId: string) {
  const qc = useQueryClient();
  const inv = (...keys: string[]) => keys.forEach((key) => qc.invalidateQueries({ queryKey: ['owner', key] }));
  useChannels(
    [`tenant:${tenantId}`],
    (e) => {
      switch (e.type) {
        case 'machine.state_changed':
        case 'cycle.updated':
        case 'device.status':
          inv('overview', 'shop', 'machine', 'machines', 'devices');
          break;
        case 'ticket.created':
        case 'ticket.updated':
          inv('overview', 'tickets', 'ticket', 'machine');
          break;
        case 'alert.created':
        case 'alert.resolved':
          inv('overview', 'alerts');
          break;
        case 'refund.updated':
          inv('overview', 'refunds', 'ticket');
          break;
        case 'payment.updated':
          inv('overview', 'ticket');
          break;
        case 'checklist.updated':
          inv('overview', 'checklists');
          break;
        default:
          inv('overview');
      }
    },
    () => qc.invalidateQueries({ queryKey: ['owner'] }),
  );
}

function Badge({ n, label }: { n?: number; label: string }) {
  if (!n) return null;
  return (
    <span aria-label={`${n} ${label}`} className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-critical px-1.5 text-[11px] font-semibold text-white">
      {n > 99 ? '99+' : n}
    </span>
  );
}

export function OwnerLayout() {
  const me = useMe();
  const allowed = useNavAllowed();
  const { pathname } = useLocation();
  useOwnerRealtime(me.tenant.id);
  const overview = useApi<Overview>(k.overview, '/owner/overview', { refetchInterval: 30_000 });
  const t = overview.data?.totals;
  const badges: Record<string, number | undefined> = { '/owner/tickets': t?.openTickets, '/owner/refunds': t?.pendingRefunds };
  const secondary = SECONDARY_NAV.filter(allowed);
  const moreActive = secondary.some((n) => pathname.startsWith(n.to)) || pathname.startsWith('/owner/more');

  const logout = useLogout();

  const sideLink = (n: NavItem) => (
    <NavLink
      key={n.to}
      to={n.to}
      end={n.to === '/owner'}
      className={({ isActive }) =>
        cx('flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium', isActive ? 'bg-brand-soft text-ink' : 'text-ink-2 hover:bg-surface-2')
      }
    >
      <Icon name={n.icon} className="h-[18px] w-[18px]" />
      {n.label}
      <Badge n={badges[n.to]} label="pending" />
    </NavLink>
  );

  return (
    <div className="min-h-dvh lg:flex">
      {/* Sidebar ≥1024px */}
      <aside className="no-print sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex items-center gap-2 px-5 py-4">
          <img src="/icon.svg" alt="" className="h-7 w-7" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{me.tenant.name}</div>
            <div className="truncate text-xs text-muted">
              {me.user.name} · {me.role}
            </div>
          </div>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
          {PRIMARY_NAV.map(sideLink)}
          <div className="my-2 border-t border-line" />
          {secondary.map(sideLink)}
        </nav>
        <div className="border-t border-line p-3">
          <button type="button" onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-ink-2 hover:bg-surface-2">
            <Icon name="logout" className="h-[18px] w-[18px]" />
            Log out
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Phone top bar */}
        <header className="no-print sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur lg:hidden">
          <img src="/icon.svg" alt="" className="h-6 w-6" />
          <span className="truncate text-sm font-semibold">{me.tenant.name}</span>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-4 lg:px-8 lg:pb-12 lg:pt-6">
          <Outlet />
        </main>
      </div>

      {/* Phone bottom tabs */}
      <nav aria-label="Main tabs" className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        {[...PRIMARY_NAV, { to: '/owner/more', label: 'More', icon: 'menu' as IconName }].map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/owner'}
            className={({ isActive }) =>
              cx('relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive || (n.to === '/owner/more' && moreActive) ? 'text-brand' : 'text-muted')
            }
          >
            <Icon name={n.icon} className="h-6 w-6" />
            {n.label}
            {n.to === '/owner/tickets' && !!t?.openTickets && (
              <span className="absolute left-1/2 top-1 ml-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold text-white" aria-label={`${t.openTickets} open`}>
                {t.openTickets}
              </span>
            )}
            {n.to === '/owner/more' && !!t?.pendingRefunds && secondary.some((s) => s.to === '/owner/refunds') && (
              <span className="absolute left-1/2 top-1 ml-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold text-white" aria-label={`${t.pendingRefunds} refunds pending`}>
                {t.pendingRefunds}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
