'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Button, Field, inputClass, ErrorState } from './ui';

const REASONS = {
  SESSION_EXPIRED: 'Your session expired. Sign in again to continue.',
  INVALID_SESSION: 'Please sign in again.',
};

export function AuthForm({ mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const register = mode === 'register';
  const reason = REASONS[params.get('reason')];

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: { email, password } });
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/kits');
      router.refresh();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 py-10">
      <p className="text-sm font-semibold text-action">Interview Prep Kit</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">{register ? 'Create your account' : 'Sign in'}</h1>
      <p className="mt-2 text-muted">{register ? 'Your kits are private to your account.' : 'Pick up your preparation where you left it.'}</p>
      {reason && <p className="mt-4 rounded-md bg-warn/10 px-3 py-2 text-sm text-warn">{reason}</p>}
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <Field label="Email" id="email">
          <input id="email" type="email" autoComplete="email" required className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" id="password" hint={register ? 'At least 8 characters.' : undefined}>
          <input
            id="password"
            type="password"
            autoComplete={register ? 'new-password' : 'current-password'}
            required
            minLength={register ? 8 : 1}
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <ErrorState title={register ? 'Could not create the account' : 'Could not sign in'} message={error} />}
        <Button type="submit" variant="primary" size="lg" className="w-full" busy={busy}>
          {register ? 'Create account' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        {register ? 'Already have an account? ' : 'New here? '}
        <Link className="font-semibold text-action underline-offset-2 hover:underline" href={register ? '/login' : '/register'}>
          {register ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </main>
  );
}
