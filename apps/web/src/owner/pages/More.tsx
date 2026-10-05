import { Link } from 'react-router';
import { Card } from '../../components/ui';
import { PageHeader } from '../components/common';
import { Icon } from '../components/icons';
import { SECONDARY_NAV, useNavAllowed } from '../components/Layout';
import { PushButton } from '../components/PushButton';
import { useLogout, useMe } from '../lib/session';

/** Phone-only hub for everything that isn't a bottom tab. */
export function MorePage() {
  const me = useMe();
  const allowed = useNavAllowed();
  const { logout, error: logoutError } = useLogout();
  return (
    <>
      <PageHeader title="More" subtitle={`${me.user.name} · ${me.role} · ${me.tenant.name}`} />
      <Card className="divide-y divide-line">
        {SECONDARY_NAV.filter(allowed).map((n) => (
          <Link key={n.to} to={n.to} className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2">
            <Icon name={n.icon} className="h-5 w-5 text-ink-2" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{n.label}</span>
              {n.hint && <span className="block text-xs text-muted">{n.hint}</span>}
            </span>
            <Icon name="chevron" className="h-4 w-4 text-muted" />
          </Link>
        ))}
      </Card>
      <Card className="mt-4 p-4">
        <h2 className="mb-2 text-sm font-semibold">Notifications</h2>
        <PushButton />
      </Card>
      <button type="button" onClick={logout} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-medium text-critical-ink hover:bg-surface-2">
        <Icon name="logout" className="h-5 w-5" /> Log out
      </button>
      {logoutError && (
        <p role="alert" className="mt-2 text-center text-sm text-critical-ink">
          {logoutError}
        </p>
      )}
    </>
  );
}
