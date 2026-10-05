import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { Button, Card, EmptyState, Field, inputClass } from '../../components/ui';
import { ago, dateTime } from '../../lib/format';
import { ConfirmButton, MutationError, PageHeader, QueryState, Section, StatusTag } from '../components/common';
import { useApi, useApiMutation } from '../lib/queries';
import { useLogout } from '../lib/session';

interface SessionRow {
  id: string;
  device: string;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

const KEY = ['owner', 'sessions'] as const;

/** Where am I signed in? Sign out a lost phone or a shared shop tablet without touching this device. */
export function SecurityPage() {
  const q = useApi<{ sessions: SessionRow[] }>(KEY, '/owner/sessions');
  const { logout, error: logoutError } = useLogout();
  const revoke = useApiMutation((id: string) => api.post(`/owner/sessions/${id}/revoke`), [KEY]);
  const others = useApiMutation(() => api.post<{ revoked: number }>('/owner/sessions/revoke-others'), [KEY]);

  return (
    <>
      <PageHeader title="Account &amp; devices" subtitle="Each sign-in lasts 14 days on that device. Logging out ends it for good — a copied link or cookie stops working too." />
      <QueryState q={q}>
        {() => {
          const sessions = q.data!.sessions;
          const otherCount = sessions.filter((s) => !s.current).length;
          return (
            <>
              <Section
                title={`${sessions.length} device${sessions.length === 1 ? '' : 's'}`}
                action={
                  otherCount > 0 && (
                    <ConfirmButton
                      title="Sign out other devices?"
                      message={`This signs you out on ${otherCount} other device${otherCount === 1 ? '' : 's'}. You stay signed in here.`}
                      confirmLabel="Sign out others"
                      onConfirm={() => others.mutateAsync(undefined)}
                      pending={others.isPending}
                      error={others.error}
                    >
                      Sign out other devices
                    </ConfirmButton>
                  )
                }
              >
                {sessions.length === 0 ? (
                  <EmptyState title="No active sessions" />
                ) : (
                  <Card className="divide-y divide-line" role="list" aria-label="Signed-in devices">
                    {sessions.map((s) => (
                      <div key={s.id} role="listitem" className="flex flex-wrap items-center gap-3 p-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 font-medium">
                            {s.device}
                            {s.current && <StatusTag tone="good">This device</StatusTag>}
                          </div>
                          <div className="text-xs text-muted">
                            Active {ago(s.lastSeenAt)} · signed in {dateTime(s.createdAt)}
                            {s.ip ? ` · ${s.ip}` : ''}
                          </div>
                        </div>
                        {s.current ? (
                          <ConfirmButton
                            title="Log out on this device?"
                            message="You'll need to sign in again here."
                            confirmLabel="Log out"
                            onConfirm={async () => {
                              if (!(await logout())) throw new Error('logout failed'); // keep the dialog open
                            }}
                            error={logoutError ? new Error(logoutError) : null}
                          >
                            Log out
                          </ConfirmButton>
                        ) : (
                          <ConfirmButton
                            title={`Sign out ${s.device}?`}
                            message="That device will need to sign in again."
                            confirmLabel="Sign out"
                            onConfirm={() => revoke.mutateAsync(s.id)}
                            pending={revoke.isPending}
                            error={revoke.error}
                          >
                            Sign out
                          </ConfirmButton>
                        )}
                      </div>
                    ))}
                  </Card>
                )}
              </Section>
              <p className="mt-3 text-xs text-muted">Lost your phone or signed in on a shared shop tablet? Use “Sign out other devices”. Removing a staff member from Staff ends their access immediately.</p>
              <ChangePassword />
            </>
          );
        }}
      </QueryState>
    </>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const change = useApiMutation(
    () => api.post<{ otherSessionsSignedOut: number }>('/owner/me/password', { currentPassword: current, newPassword: next }),
    [KEY],
    (r) => {
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(r.otherSessionsSignedOut ? `Password changed. Signed out ${r.otherSessionsSignedOut} other device${r.otherSessionsSignedOut === 1 ? '' : 's'}.` : 'Password changed.');
    },
  );
  const mismatch = confirm.length > 0 && next !== confirm;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setDone(null);
    if (!mismatch) change.mutate(undefined);
  };
  return (
    <Section title="Change password" className="mt-8">
      <Card className="p-4">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
          <Field label="Current password">
            <input className={inputClass} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <input className={inputClass} type="password" autoComplete="new-password" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Confirm new password" error={mismatch ? 'The passwords don’t match' : null}>
            <input className={inputClass} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
            <Button type="submit" size="sm" disabled={change.isPending || mismatch || next.length < 8}>
              {change.isPending ? 'Saving…' : 'Change password'}
            </Button>
            <span className="text-xs text-muted">Other devices are signed out; this one stays signed in.</span>
            {done && <span className="text-sm text-good-ink">{done}</span>}
          </div>
        </form>
        <MutationError error={change.error} />
      </Card>
    </Section>
  );
}
