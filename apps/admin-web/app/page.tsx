'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost, getToken, setToken } from './lib/api';
import Nav from './components/Nav';

type Overview = {
  usersTotal: number;
  driversByKyc: Record<string, number>;
  ridesByStatus: Record<string, number>;
  paymentsByStatus: Record<string, number>;
  commissionBalanceMinor: number;
  pendingTopups: number;
  pendingWithdrawals: number;
  citiesTotal: number;
  activeCities: number;
};

function counts(record: Record<string, number>) {
  return Object.entries(record)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
}

export default function Home() {
  const [token, setTokenState] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTokenState(getToken());
  }, []);

  useEffect(() => {
    if (!token) return;
    apiGet('/admin/overview')
      .then((data) => setOverview(data as Overview))
      .catch((e: Error) => setError(e.message));
  }, [token]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = (await apiPost('/auth/admin/login', { email, password })) as {
        accessToken?: string;
        mfaToken?: string;
      };
      if (data.mfaToken) {
        setMfaToken(data.mfaToken);
      } else if (data.accessToken) {
        setToken(data.accessToken);
        setTokenState(data.accessToken);
      } else {
        setError('Unexpected login response from the API.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const verifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = (await apiPost('/auth/admin/mfa-verify', { mfaToken, code: mfaCode })) as {
        accessToken?: string;
      };
      if (data.accessToken) {
        setToken(data.accessToken);
        setTokenState(data.accessToken);
        setMfaToken(null);
      } else {
        setError('Unexpected MFA response from the API.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'MFA verification failed');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <main style={{ margin: '48px auto', maxWidth: 480, padding: 24 }}>
        <h1>Rahi Admin — sign in</h1>
        {mfaToken ? (
          <form onSubmit={verifyMfa}>
            <p>Enter the authenticator code for this admin account.</p>
            <label>
              Authenticator code
              <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} required />
            </label>
            <button type="submit" disabled={loading}>
              Verify
            </button>
          </form>
        ) : (
          <form onSubmit={login}>
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <button type="submit" disabled={loading}>
              Sign in
            </button>
          </form>
        )}
        {error && <p style={{ color: 'darkred' }}>{error}</p>}
      </main>
    );
  }

  return (
    <main style={{ margin: '48px auto', maxWidth: 900, padding: 24 }}>
      <Nav />
      <h1>Overview</h1>
      {error && <p style={{ color: 'darkred' }}>{error}</p>}
      {!overview && !error && <p>Loading live overview…</p>}
      {overview && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <section>
            <h2>Users</h2>
            <p>{overview.usersTotal}</p>
          </section>
          <section>
            <h2>Drivers by KYC</h2>
            <p>{counts(overview.driversByKyc) || 'None yet'}</p>
          </section>
          <section>
            <h2>Rides by status</h2>
            <p>{counts(overview.ridesByStatus) || 'None yet'}</p>
          </section>
          <section>
            <h2>Payments by status</h2>
            <p>{counts(overview.paymentsByStatus) || 'None yet'}</p>
          </section>
          <section>
            <h2>Commission balance (minor units)</h2>
            <p>{overview.commissionBalanceMinor}</p>
          </section>
          <section>
            <h2>Pending approvals</h2>
            <p>
              Top-ups: {overview.pendingTopups} · Withdrawals: {overview.pendingWithdrawals}
            </p>
          </section>
          <section>
            <h2>Cities</h2>
            <p>
              {overview.activeCities} active of {overview.citiesTotal}
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
