import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../lib/api';
import { Button, Field, inputClass } from '../../components/ui';
import { MutationError } from '../components/common';

/** Landing page for the emailed reset link (works while signed out). */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const mismatch = confirm.length > 0 && pw !== confirm;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== confirm) return;
    setPending(true);
    setError(null);
    try {
      await api.post('/owner/auth/reset', { token, newPassword: pw });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Choose a new password</h1>
        {done ? (
          <div className="space-y-3 rounded-2xl border border-line bg-surface p-5 text-sm">
            <p className="text-good-ink">Password changed. You’ve been signed out on all devices.</p>
            <Link to="/owner" className="font-medium text-brand">
              Sign in →
            </Link>
          </div>
        ) : !token ? (
          <p className="text-sm text-critical-ink">This link is incomplete. Open the link from your email again, or ask for a new one on the sign-in page.</p>
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-5">
            <Field label="New password" hint="At least 8 characters">
              <input className={inputClass} type="password" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            <Field label="Confirm new password" error={mismatch ? 'The passwords don’t match' : null}>
              <input className={inputClass} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <MutationError error={error} />
            <Button type="submit" block disabled={pending || mismatch || pw.length < 8}>
              {pending ? 'Saving…' : 'Set new password'}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
