'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, getToken } from '../lib/api';
import Nav from '../components/Nav';

type AuditEntry = {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  createdAt: string;
};

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      setError('Not signed in — sign in on the overview page first.');
      return;
    }
    apiGet('/admin/audit-logs?limit=200')
      .then((data) => setEntries(data as AuditEntry[]))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main style={{ margin: '48px auto', maxWidth: 900, padding: 24 }}>
      <Nav />
      <h1>Audit log</h1>
      <p>Every admin mutation, newest first: who did what, to which record.</p>
      {error && <p style={{ color: 'darkred' }}>{error}</p>}
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Action</th>
            <th>Target</th>
            <th>Actor</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.createdAt).toLocaleString()}</td>
              <td>{a.action}</td>
              <td>
                {a.targetType} {a.targetId}
              </td>
              <td>{a.actorId}</td>
              <td>{a.reason ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && !error && <p>No audit entries yet.</p>}
      <p>
        <Link href="/">Back to overview</Link>
      </p>
    </main>
  );
}
