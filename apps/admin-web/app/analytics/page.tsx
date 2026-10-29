'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, getToken } from '../lib/api';
import Nav from '../components/Nav';

type Overview = {
  periodDays: number;
  ridesRequested: number;
  ridesCompleted: number;
  ridesCancelled: number;
  noDriverFound: number;
  completionRate: number | null;
  avgFareMinor: number | null;
  totalCommissionMinor: number;
  offerAcceptanceRate: number | null;
};

type DispatchStats = {
  attempts: number;
  byOutcome: Record<string, number>;
  byRadiusKm: Record<string, number>;
  avgScore: number | null;
  avgMatchSeconds: number | null;
  offersSent: number;
  offersAccepted: number;
  offerAcceptanceRate: number | null;
};

type CityRow = {
  cityId: string;
  cityName: string;
  requested: number;
  completed: number;
  cancelled: number;
  commissionMinor: number;
  avgFareMinor: number | null;
};

type LeaderRow = {
  driverUserId: string;
  completedRides: number;
  earningsMinor: number;
  avgRating: number | null;
  acceptanceRate: number | null;
};

type DailyRow = {
  date: string;
  requested: number;
  completed: number;
  commissionMinor: number;
};

function pkr(minor: number | null): string {
  if (minor === null) return '—';
  return `PKR ${(minor / 100).toFixed(2)}`;
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [dispatch, setDispatch] = useState<DispatchStats | null>(null);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async (d: number) => {
    setError(null);
    try {
      const [o, s, c, l, y] = await Promise.all([
        apiGet(`/admin/analytics/overview?days=${d}`),
        apiGet(`/admin/analytics/dispatch?days=${d}`),
        apiGet(`/admin/analytics/cities?days=${d}`),
        apiGet(`/admin/analytics/drivers?days=${d}`),
        apiGet(`/admin/analytics/daily?days=${d}`),
      ]);
      setOverview(o as Overview);
      setDispatch(s as DispatchStats);
      setCities(c as CityRow[]);
      setLeaders(l as LeaderRow[]);
      setDaily(y as DailyRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    }
  };

  useEffect(() => {
    if (getToken()) load(days);
    else setError('Not signed in — sign in on the overview page first.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const maxDaily = Math.max(1, ...daily.map((r) => r.requested));

  return (
    <main style={{ margin: '48px auto', maxWidth: 900, padding: 24 }}>
      <Nav />
      <h1>Analytics</h1>
      <label>
        Window:{' '}
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </label>
      {error && <p style={{ color: 'darkred' }}>{error}</p>}
      {overview && (
        <section>
          <h2>Overview</h2>
          <p>
            Requested: {overview.ridesRequested} · Completed: {overview.ridesCompleted} ·
            Cancelled: {overview.ridesCancelled} · No driver found: {overview.noDriverFound}
          </p>
          <p>
            Completion rate: {overview.completionRate === null ? '—' : `${(overview.completionRate * 100).toFixed(0)}%`} ·
            Average fare: {pkr(overview.avgFareMinor)} ·
            Commission: {pkr(overview.totalCommissionMinor)} ·
            Offer acceptance: {overview.offerAcceptanceRate === null ? '—' : `${(overview.offerAcceptanceRate * 100).toFixed(0)}%`}
          </p>
        </section>
      )}
      {dispatch && (
        <section>
          <h2>Dispatch</h2>
          <p>
            Attempts: {dispatch.attempts} · Average score: {dispatch.avgScore ?? '—'} ·
            Average match time: {dispatch.avgMatchSeconds === null ? '—' : `${dispatch.avgMatchSeconds}s`} ·
            Offers: {dispatch.offersAccepted}/{dispatch.offersSent}
          </p>
          <p>
            By outcome: {Object.entries(dispatch.byOutcome).map(([k, v]) => `${k} ${v}`).join(', ') || '—'} ·
            By radius: {Object.entries(dispatch.byRadiusKm).map(([k, v]) => `${k}km ${v}`).join(', ') || '—'}
          </p>
        </section>
      )}
      <h2>Daily requests</h2>
      {daily.map((r) => (
        <div key={r.date} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 100 }}>{r.date}</span>
          <div style={{ background: '#2f6fed', height: 14, width: `${(r.requested / maxDaily) * 300}px` }} />
          <span>
            {r.requested} requested · {r.completed} completed · {pkr(r.commissionMinor)} commission
          </span>
        </div>
      ))}
      <h2>By city</h2>
      <table>
        <thead>
          <tr>
            <th>City</th>
            <th>Requested</th>
            <th>Completed</th>
            <th>Cancelled</th>
            <th>Commission</th>
            <th>Avg fare</th>
          </tr>
        </thead>
        <tbody>
          {cities.map((c) => (
            <tr key={c.cityId}>
              <td>{c.cityName}</td>
              <td>{c.requested}</td>
              <td>{c.completed}</td>
              <td>{c.cancelled}</td>
              <td>{pkr(c.commissionMinor)}</td>
              <td>{pkr(c.avgFareMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Driver leaderboard</h2>
      <table>
        <thead>
          <tr>
            <th>Driver</th>
            <th>Completed</th>
            <th>Earnings (fare − commission)</th>
            <th>Avg rating</th>
            <th>Acceptance</th>
          </tr>
        </thead>
        <tbody>
          {leaders.map((l) => (
            <tr key={l.driverUserId}>
              <td>{l.driverUserId.slice(0, 8)}</td>
              <td>{l.completedRides}</td>
              <td>{pkr(l.earningsMinor)}</td>
              <td>{l.avgRating ?? '—'}</td>
              <td>{l.acceptanceRate === null ? '—' : `${(l.acceptanceRate * 100).toFixed(0)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <Link href="/">Back to overview</Link>
      </p>
    </main>
  );
}
