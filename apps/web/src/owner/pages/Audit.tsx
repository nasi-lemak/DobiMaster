import { useId, useState } from 'react';
import { EmptyState, inputClass } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { PageHeader, QueryState, TableWrap, td, th } from '../components/common';
import { k, qs, useApi } from '../lib/queries';
import type { AuditEntry } from '../lib/types';

const ENTITY_TYPES = ['machine', 'ticket', 'refund', 'collection', 'shop', 'announcement', 'alert', 'device', 'maintenance_plan', 'checklist_template', 'user'];

function summarise(v: unknown) {
  if (v == null) return '';
  const s = JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

/** Read-only: who changed what, when. */
export function AuditPage() {
  const [entityType, setEntityType] = useState('');
  const [actor, setActor] = useState('');
  const selId = useId();
  const actorId = useId();
  const q = useApi<{ entries: AuditEntry[] }>(k.audit(entityType || undefined), `/owner/audit${qs({ entityType, limit: 300 })}`, { keepPrevious: true });

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change to machines, money, tickets and settings" />
      <div className="mb-4 flex flex-wrap gap-2">
        <label htmlFor={selId} className="sr-only">
          Entity type
        </label>
        <select id={selId} className={`${inputClass} w-auto py-2`} value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          <option value="">Everything</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <label htmlFor={actorId} className="sr-only">
          Filter by person
        </label>
        <input id={actorId} className={`${inputClass} w-auto py-2`} placeholder="Filter by person" value={actor} onChange={(e) => setActor(e.target.value)} />
      </div>
      <QueryState q={q}>
        {() => {
          const rows = q.data!.entries.filter((e) => !actor.trim() || (e.actor_name ?? 'system').toLowerCase().includes(actor.trim().toLowerCase()));
          if (!rows.length) return <EmptyState title="No entries">Changes made in the dashboard are recorded here.</EmptyState>;
          return (
            <TableWrap className={q.isPlaceholderData ? 'opacity-60' : undefined}>
              <thead>
                <tr>
                  <th className={th}>When</th>
                  <th className={th}>Who</th>
                  <th className={th}>Action</th>
                  <th className={th}>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className={`${td} whitespace-nowrap`}>{dateTime(e.created_at)}</td>
                    <td className={td}>{e.actor_name ?? 'System'}</td>
                    <td className={td}>
                      <code className="text-xs">{e.action}</code>
                    </td>
                    <td className={`${td} max-w-md`}>
                      <span className="block truncate font-mono text-[11px] text-ink-2" title={summarise(e.after ?? e.before)}>
                        {summarise(e.after ?? e.before)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          );
        }}
      </QueryState>
    </>
  );
}
