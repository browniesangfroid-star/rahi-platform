'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPatch, apiPost, getToken } from '../lib/api';
import Nav from '../components/Nav';

type City = {
  id: string;
  name: string;
  countryCode: string;
  currency: string;
  timezone: string;
  centreLat: number | null;
  centreLng: number | null;
  isActive: boolean;
};

export default function CitiesPage() {
  const [cities, setCities] = useState<City[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    countryCode: 'PK',
    currency: 'PKR',
    timezone: 'Asia/Karachi',
    centreLat: '',
    centreLng: '',
  });

  const load = () =>
    apiGet('/admin/cities')
      .then((data) => setCities(data as City[]))
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    if (getToken()) load();
    else setError('Not signed in — sign in on the overview page first.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiPost('/admin/cities', {
        ...form,
        centreLat: Number(form.centreLat),
        centreLng: Number(form.centreLng),
      });
      setForm({ name: '', countryCode: 'PK', currency: 'PKR', timezone: 'Asia/Karachi', centreLat: '', centreLng: '' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    }
  };

  const toggle = async (city: City) => {
    setError(null);
    try {
      await apiPatch(`/admin/cities/${city.id}/active`, { isActive: !city.isActive });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    }
  };

  return (
    <main style={{ margin: '48px auto', maxWidth: 900, padding: 24 }}>
      <Nav />
      <h1>Cities</h1>
      {error && <p style={{ color: 'darkred' }}>{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Country</th>
            <th>Currency</th>
            <th>Centre</th>
            <th>Active</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {cities.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.countryCode}</td>
              <td>{c.currency}</td>
              <td>
                {c.centreLat}, {c.centreLng}
              </td>
              <td>{c.isActive ? 'Yes' : 'No'}</td>
              <td>
                <button type="button" onClick={() => toggle(c)}>
                  {c.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cities.length === 0 && !error && <p>No cities yet — create the first one below.</p>}
      <h2>Add a city</h2>
      <form onSubmit={create}>
        <label>
          Name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label>
          Country code
          <input value={form.countryCode} onChange={(e) => setForm({ ...form, countryCode: e.target.value })} required />
        </label>
        <label>
          Currency
          <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} required />
        </label>
        <label>
          Timezone
          <input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} required />
        </label>
        <label>
          Centre latitude
          <input value={form.centreLat} onChange={(e) => setForm({ ...form, centreLat: e.target.value })} required />
        </label>
        <label>
          Centre longitude
          <input value={form.centreLng} onChange={(e) => setForm({ ...form, centreLng: e.target.value })} required />
        </label>
        <button type="submit">Create city</button>
      </form>
      <p>
        <Link href="/">Back to overview</Link>
      </p>
    </main>
  );
}
