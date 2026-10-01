import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button, Field, inputClass } from '../../components/ui';
import { MutationError } from '../components/common';
import { k } from '../lib/queries';

/** Self-serve sign-up for a new laundromat business; lands in the setup wizard, signed in. */
export function SignupPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ businessName: '', name: '', email: '', password: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post('/owner/auth/signup', { ...form, email: form.email.trim() });
      navigate('/owner/setup', { replace: true });
      await qc.invalidateQueries({ queryKey: k.me });
    } catch (err) {
      setError(err);
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-10 w-10" />
          <div>
            <h1 className="text-xl font-semibold">Set up your laundromat</h1>
            <p className="text-sm text-muted">About 10 minutes. No hardware needed to start.</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-5">
          <Field label="Business name" hint="As customers know it, e.g. Dobi Ceria">
            <input className={inputClass} required minLength={2} maxLength={120} autoComplete="organization" value={form.businessName} onChange={set('businessName')} />
          </Field>
          <Field label="Your name">
            <input className={inputClass} required maxLength={100} autoComplete="name" value={form.name} onChange={set('name')} />
          </Field>
          <Field label="Email">
            <input className={inputClass} type="email" required autoComplete="username" inputMode="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Password" hint="At least 8 characters">
            <input className={inputClass} type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} />
          </Field>
          <MutationError error={error} />
          <Button type="submit" block size="lg" disabled={pending}>
            {pending ? 'Creating your account…' : 'Create account'}
          </Button>
          <p className="text-center text-xs text-muted">Your shop stays hidden from customers until you choose to go live.</p>
        </form>
        <p className="mt-4 text-center text-sm">
          Already have an account?{' '}
          <Link to="/owner" className="font-medium text-brand">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
