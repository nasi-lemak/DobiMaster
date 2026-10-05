import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button, Field, inputClass } from '../../components/ui';
import { MutationError } from '../components/common';
import { k } from '../lib/queries';

/** The seeded demo accounts exist only on dev and demo servers (VITE_SHOW_DEMO_LOGINS=true at build time). */
const SHOW_DEMO_LOGINS = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_LOGINS === 'true';

export function LoginPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [forgot, setForgot] = useState<'off' | 'form' | 'sent'>('off');
  const signup = useQuery({ queryKey: ['owner', 'signup-allowed'], queryFn: () => api.get<{ allowed: boolean }>('/owner/auth/signup'), staleTime: 5 * 60_000 });

  const sendReset = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post('/owner/auth/forgot', { email: email.trim() });
      setForgot('sent');
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post('/owner/auth/login', { email: email.trim(), password });
      await qc.invalidateQueries({ queryKey: k.me });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-10 w-10" />
          <div>
            <h1 className="text-xl font-semibold">DobiMaster for owners</h1>
            <p className="text-sm text-muted">Every branch, one screen.</p>
          </div>
        </div>
        {forgot !== 'off' ? (
          <form onSubmit={sendReset} className="space-y-4 rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-semibold">Reset your password</h2>
            {forgot === 'sent' ? (
              <p className="text-sm text-ink-2">If an account exists for {email.trim()}, we’ve emailed a reset link. It works once, for 30 minutes.</p>
            ) : (
              <>
                <Field label="Email">
                  <input className={inputClass} type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                <MutationError error={error} />
                <Button type="submit" block disabled={pending}>
                  {pending ? 'Sending…' : 'Email me a reset link'}
                </Button>
              </>
            )}
            <button type="button" className="text-sm text-brand" onClick={() => (setForgot('off'), setError(null))}>
              ← Back to sign in
            </button>
          </form>
        ) : (
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-5">
          <Field label="Email">
            <input className={inputClass} type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <input className={inputClass} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <MutationError error={error} />
          <Button type="submit" block size="lg" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
          <button type="button" className="block w-full text-center text-sm text-brand" onClick={() => (setForgot('form'), setError(null))}>
            Forgot password?
          </button>
        </form>
        )}
        {signup.data?.allowed && (
          <p className="mt-4 text-center text-sm">
            New laundromat?{' '}
            <Link to="/owner/signup" className="font-medium text-brand">
              Create an account
            </Link>
          </p>
        )}
        <p className="mt-4 flex justify-center gap-4 text-xs text-muted">
          <a href="/privacy" className="underline-offset-2 hover:underline">
            Privacy
          </a>
          <a href="/terms" className="underline-offset-2 hover:underline">
            Terms
          </a>
        </p>
        {SHOW_DEMO_LOGINS && (
        <div className="mt-4 rounded-2xl bg-surface-2 p-3 text-xs text-ink-2">
          <p className="font-medium">Demo accounts (password demo1234)</p>
          <ul className="mt-1 space-y-0.5">
            <li>
              <button type="button" className="underline" onClick={() => (setEmail('owner@dobiceria.my'), setPassword('demo1234'))}>
                owner@dobiceria.my
              </button>{' '}
              — owner, all branches
            </li>
            <li>
              <button type="button" className="underline" onClick={() => (setEmail('staff@dobiceria.my'), setPassword('demo1234'))}>
                staff@dobiceria.my
              </button>{' '}
              — staff, SS2 only, no revenue
            </li>
          </ul>
        </div>
        )}
      </div>
    </main>
  );
}
