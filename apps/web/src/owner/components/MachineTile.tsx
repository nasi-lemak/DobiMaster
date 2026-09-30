import { Link } from 'react-router';
import { StateBadge } from '../../components/ui';
import { minutesLeft } from '../../lib/format';
import { since } from '../lib/fmt';
import { SOURCE_LABEL, STATE_LABEL, typeLabel } from '../lib/labels';
import type { LiveMachine } from '../lib/types';
import { Icon } from './icons';

/** One machine in the branch live grid. The body links to details; the ⋯ button opens quick actions. */
export function MachineTile({ m, now, onActions }: { m: LiveMachine; now: number; onActions?: () => void }) {
  const left = m.state === 'running' ? minutesLeft(m.cycle?.expectedEndAt, now) : null;
  return (
    <div className="relative rounded-2xl border border-line bg-surface">
      <Link to={`/owner/machines/${m.id}`} className="block rounded-2xl p-3 pr-10 hover:bg-surface-2">
        <div className="text-xl font-bold leading-none">{m.code}</div>
        <div className="mt-0.5 text-xs text-muted">
          {typeLabel(m.type)} {m.capacityKg} kg
        </div>
        <StateBadge state={m.state} label={STATE_LABEL[m.state]} className="mt-2" />
        <div className="mt-2 space-y-0.5 text-xs text-ink-2">
          {m.state === 'running' && left != null && (
            <div className="font-medium text-ink">{left > 0 ? `~${left} min left` : 'Ending now'}</div>
          )}
          {m.state === 'finished' && <div className="font-medium text-warning-ink">Laundry inside · {since(m.cycle?.endedAt ?? m.stateSince, now)}</div>}
          {(m.state === 'maintenance' || m.state === 'disabled' || m.state === 'fault') && m.adminReason && <div className="line-clamp-2">“{m.adminReason}”</div>}
          <div className="text-muted">
            {m.state === 'running' || m.state === 'finished'
              ? `via ${SOURCE_LABEL[m.stateSource]}`
              : `for ${since(m.stateSince, now)}${m.stateSource !== 'none' ? ` · ${SOURCE_LABEL[m.stateSource]}` : ''}`}
          </div>
        </div>
      </Link>
      {onActions && (
        <button
          type="button"
          onClick={onActions}
          aria-label={`Actions for ${m.code}`}
          className="absolute right-1.5 top-1.5 rounded-full p-2 text-ink-2 hover:bg-surface-2"
        >
          <Icon name="more" className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
