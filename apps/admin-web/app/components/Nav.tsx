'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearToken } from '../lib/api';

export default function Nav() {
  const router = useRouter();
  const logout = () => {
    clearToken();
    router.push('/');
    router.refresh();
  };
  return (
    <nav style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 24 }}>
      <strong>Rahi Admin</strong>
      <Link href="/">Overview</Link>
      <Link href="/cities">Cities</Link>
      <Link href="/pricing">Pricing</Link>
      <Link href="/support">Support</Link>
      <Link href="/analytics">Analytics</Link>
      <Link href="/audit">Audit log</Link>
      <button type="button" onClick={logout} style={{ marginLeft: 'auto' }}>
        Log out
      </button>
    </nav>
  );
}
