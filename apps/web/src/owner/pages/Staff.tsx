import { useState } from 'react';
import { ROLE_PERMISSIONS, ROLES, type Role } from '@dobi/shared';
import { api } from '../../lib/api';
import { Button, Card, EmptyState, Field, inputClass } from '../../components/ui';
import { MutationError, PageHeader, QueryState, StatusTag } from '../components/common';
import { Icon } from '../components/icons';
import { k, useApi, useApiMutation } from '../lib/queries';
import { useMe, useShopName } from '../lib/session';
import type { StaffRow } from '../lib/types';

const ROLE_HINT: Record<Role, string> = {
  owner: 'Everything, including staff and revenue',
  manager: 'Everything except managing staff',
  staff: 'Machine states, tickets, checklists, cash entry — no revenue figures',
};

export function StaffPage() {
  const shopName = useShopName();
  const [adding, setAdding] = useState(false);
  const q = useApi<{ staff: StaffRow[] }>(k.staff, '/owner/staff');
  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="Who can sign in, their role and which branches they see"
        actions={
          !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Icon name="plus" className="h-4 w-4" /> Add person
            </Button>
          )
        }
      />
      {adding && <AddStaff onDone={() => setAdding(false)} />}
      <QueryState q={q}>
        {() =>
          q.data!.staff.length === 0 ? (
            <EmptyState title="No team members" />
          ) : (
            <Card className="divide-y divide-line" role="list" aria-label="Team">
              {q.data!.staff.map((s) => (
                <div key={s.id} role="listitem" className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{s.name}</div>
                    <div className="text-xs text-muted">{s.email}</div>
                  </div>
                  <div className="text-right">
                    <StatusTag tone={s.role === 'owner' ? 'info' : 'neutral'} icon="users">
                      {s.role}
                    </StatusTag>
                    <div className="mt-0.5 text-xs text-muted">{s.shop_ids ? s.shop_ids.map(shopName).join(', ') : 'All branches'}</div>
                  </div>
                </div>
              ))}
            </Card>
          )
        }
      </QueryState>
    </>
  );
}

function AddStaff({ onDone }: { onDone: () => void }) {
  const me = useMe();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [allShops, setAllShops] = useState(false);
  const [shopIds, setShopIds] = useState<string[]>([]);
  const add = useApiMutation(
    () => api.post('/owner/staff', { name: name.trim(), email: email.trim(), password, role, shopIds: allShops ? null : shopIds }),
    [k.staff],
    () => onDone(),
  );
  const roles = ROLES.filter((r) => r !== 'owner' || me.role === 'owner');
  const valid = name.trim() && email.includes('@') && password.length >= 8 && (allShops || shopIds.length > 0);
  return (
    <Card className="mb-6 space-y-3 p-4" role="region" aria-labelledby="add-staff-title">
      <h2 id="add-staff-title" className="font-semibold">
        Add a team member
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Temporary password" hint="At least 8 characters — share it privately">
          <input className={inputClass} type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Role" hint={ROLE_HINT[role]}>
          <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r} ({ROLE_PERMISSIONS[r].length} permissions)
              </option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Branch access</legend>
        <label className="flex items-center gap-2 py-1 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={allShops} onChange={(e) => setAllShops(e.target.checked)} />
          All branches (including future ones)
        </label>
        {!allShops &&
          me.shops.map((s) => (
            <label key={s.id} className="flex items-center gap-2 py-1 pl-6 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--brand)]"
                checked={shopIds.includes(s.id)}
                onChange={(e) => setShopIds((ids) => (e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id)))}
              />
              {s.name}
            </label>
          ))}
      </fieldset>
      <MutationError error={add.error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={add.isPending || !valid} onClick={() => add.mutate(undefined)}>
          {add.isPending ? 'Adding…' : 'Add person'}
        </Button>
      </div>
    </Card>
  );
}
