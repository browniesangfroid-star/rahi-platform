'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPost, getToken } from '../lib/api';
import Nav from '../components/Nav';

type City = { id: string; name: string };
type Rule = {
  id: string;
  cityId: string | null;
  serviceCode: string;
  mode: string;
  baseFareMinor: number;
  perKmMinor: number;
  perMinMinor: number;
  minimumFareMinor: number;
  bookingFeeMinor: number;
  demandCap: number;
  version: number;
};

export default function PricingPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    cityId: '',
    serviceCode: 'CAR',
    mode: 'NEGOTIATION',
    baseFareMinor: '',
    perKmMinor: '',
    perMinMinor: '',
    minimumFareMinor: '',
    bookingFeeMinor: '0',
    demandCap: '2',
  });

  const load = async () => {
    try {
      const [ruleData, cityData] = await Promise.all([apiGet('/admin/pricing-rules'), apiGet('/admin/cities')]);
      setRules(ruleData as Rule[]);
      setCities(cityData as City[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    }
  };

  useEffect(() => {
    if (getToken()) load();
    else setError('Not signed in — sign in on the overview page first.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiPost('/admin/pricing-rules', {
        cityId: form.cityId || null,
        serviceCode: form.serviceCode,
        mode: form.mode,
        baseFareMinor: Number(form.baseFareMinor),
        perKmMinor: Number(form.perKmMinor),
        perMinMinor: Number(form.perMinMinor),
        minimumFareMinor: Number(form.minimumFareMinor),
        bookingFeeMinor: Number(form.bookingFeeMinor),
        demandCap: Number(form.demandCap),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    }
  };

  const cityName = (id: string | null) => cities.find((c) => c.id === id)?.name ?? 'Global';

  return (
    <main style={{ margin: '48px auto', maxWidth: 900, padding: 24 }}>
      <Nav />
      <h1>Pricing rules</h1>
      <p>Creating a rule for a city and service that already has one writes the next version — old versions are never edited.</p>
      {error && <p style={{ color: 'darkred' }}>{error}</p>}
      <table>
        <thead>
          <tr>
            <th>City</th>
            <th>Service</th>
            <th>Mode</th>
            <th>Base</th>
            <th>Per km</th>
            <th>Per min</th>
            <th>Minimum</th>
            <th>Booking fee</th>
            <th>Demand cap</th>
            <th>Version</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td>{cityName(r.cityId)}</td>
              <td>{r.serviceCode}</td>
              <td>{r.mode}</td>
              <td>{r.baseFareMinor}</td>
              <td>{r.perKmMinor}</td>
              <td>{r.perMinMinor}</td>
              <td>{r.minimumFareMinor}</td>
              <td>{r.bookingFeeMinor}</td>
              <td>{r.demandCap}</td>
              <td>{r.version}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rules.length === 0 && !error && <p>No pricing rules yet.</p>}
      <h2>Add a pricing rule</h2>
      <form onSubmit={create}>
        <label>
          City (blank = global)
          <select value={form.cityId} onChange={(e) => setForm({ ...form, cityId: e.target.value })}>
            <option value="">Global</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Service
          <select value={form.serviceCode} onChange={(e) => setForm({ ...form, serviceCode: e.target.value })}>
            <option value="CAR">CAR</option>
            <option value="BIKE">BIKE</option>
            <option value="DELIVERY">DELIVERY</option>
          </select>
        </label>
        <label>
          Mode
          <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
            <option value="NEGOTIATION">NEGOTIATION</option>
            <option value="FIXED">FIXED</option>
            <option value="DYNAMIC">DYNAMIC</option>
            <option value="HYBRID">HYBRID</option>
          </select>
        </label>
        <label>
          Base fare (minor units)
          <input value={form.baseFareMinor} onChange={(e) => setForm({ ...form, baseFareMinor: e.target.value })} required />
        </label>
        <label>
          Per km (minor units)
          <input value={form.perKmMinor} onChange={(e) => setForm({ ...form, perKmMinor: e.target.value })} required />
        </label>
        <label>
          Per minute (minor units)
          <input value={form.perMinMinor} onChange={(e) => setForm({ ...form, perMinMinor: e.target.value })} required />
        </label>
        <label>
          Minimum fare (minor units)
          <input value={form.minimumFareMinor} onChange={(e) => setForm({ ...form, minimumFareMinor: e.target.value })} required />
        </label>
        <label>
          Booking fee (minor units)
          <input value={form.bookingFeeMinor} onChange={(e) => setForm({ ...form, bookingFeeMinor: e.target.value })} required />
        </label>
        <label>
          Demand cap
          <input value={form.demandCap} onChange={(e) => setForm({ ...form, demandCap: e.target.value })} required />
        </label>
        <button type="submit">Create rule</button>
      </form>
      <p>
        <Link href="/">Back to overview</Link>
      </p>
    </main>
  );
}
