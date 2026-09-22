'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export function AppHeader({ children }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  useEffect(() => {
    api('/auth/me').then((d) => setEmail(d.user.email)).catch(() => {});
  }, []);
  async function signOut() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    router.replace('/login');
    router.refresh();
  }
  return (
    <header className="border-b border-rule bg-sheet">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/kits" className="font-semibold tracking-tight">
          Interview Prep Kit
        </Link>
        <div className="min-w-0 flex-1 truncate text-sm text-muted">{children}</div>
        {email && <span className="hidden text-sm text-muted sm:inline">{email}</span>}
        <button onClick={signOut} className="text-sm font-medium text-muted hover:text-ink">
          Sign out
        </button>
      </div>
    </header>
  );
}
