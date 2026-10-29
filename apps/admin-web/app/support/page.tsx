'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPost, getToken } from '../lib/api';
import Nav from '../components/Nav';

type Ticket = {
  id: string;
  rideId: string | null;
  reporterUserId: string;
  category: string;
  subject: string;
  status: string;
  createdAt: string;
};

type QueueEntry = {
  rideId: string;
  customerId: string;
  driverId: string | null;
  status: string;
  actorId: string | null;
  actorRole: string | null;
  reason: string | null;
  cancelledAt: string;
  cancelCount7d: number;
  flaggedRepeat: boolean;
  isNoShow: boolean;
};

type Incident = {
  id: string;
  rideId: string;
  reporterUserId: string;
  priority: string;
  status: string;
  createdAt: string;
};

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [ticketData, queueData, incidentData] = await Promise.all([
        apiGet('/support/tickets'),
        apiGet('/admin/support/review-queue'),
        apiGet('/support/incidents'),
      ]);
      setTickets(ticketData as Ticket[]);
      setQueue(queueData as QueueEntry[]);
      setIncidents(incidentData as Incident[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    }
  };

  useEffect(() => {
    if (getToken()) load();
    else setError('Not signed in — sign in on the overview page first.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStatus = async (id: string, status: string) => {
    setError(null);
    try {
      await apiPost(`/support/tickets/${id}/status`, { status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    }
  };

  const resolveIncident = async (id: string) => {
    setError(null);
    try {
      await apiPost(`/support/incidents/${id}/resolve`, { resolutionNote: 'Resolved from the admin console.' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resolve failed');
    }
  };

  return (
    <main style={{ margin: '48px auto', maxWidth: 900, padding: 24 }}>
      <Nav />
      <h1>Support &amp; safety</h1>
      {error && <p style={{ color: 'darkred' }}>{error}</p>}
      <h2>Open safety incidents</h2>
      {incidents.length === 0 && !error && <p>No incidents.</p>}
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Ride</th>
            <th>Priority</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {incidents.map((i) => (
            <tr key={i.id}>
              <td>{new Date(i.createdAt).toLocaleString()}</td>
              <td>{i.rideId.slice(0, 8)}</td>
              <td>{i.priority}</td>
              <td>{i.status}</td>
              <td>
                {i.status === 'OPEN' && (
                  <button type="button" onClick={() => resolveIncident(i.id)}>
                    Resolve
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Support tickets</h2>
      {tickets.length === 0 && !error && <p>No tickets.</p>}
      <table>
        <thead>
          <tr>
            <th>Subject</th>
            <th>Category</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id}>
              <td>{t.subject}</td>
              <td>{t.category}</td>
              <td>{t.status}</td>
              <td>
                {t.status !== 'RESOLVED' && t.status !== 'CLOSED' && (
                  <button type="button" onClick={() => setStatus(t.id, 'RESOLVED')}>
                    Mark resolved
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Cancellation / no-show review queue</h2>
      <p>Flagged when the same actor cancelled 3 or more rides in 7 days.</p>
      {queue.length === 0 && !error && <p>No cancellations in the last 7 days.</p>}
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Ride</th>
            <th>Status</th>
            <th>Reason</th>
            <th>Cancels (7d)</th>
            <th>Flagged</th>
          </tr>
        </thead>
        <tbody>
          {queue.map((q) => (
            <tr key={q.rideId}>
              <td>{new Date(q.cancelledAt).toLocaleString()}</td>
              <td>{q.rideId.slice(0, 8)}</td>
              <td>{q.status}</td>
              <td>{q.reason ?? ''}</td>
              <td>{q.cancelCount7d}</td>
              <td>{q.flaggedRepeat ? 'Yes' : 'No'}</td>
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
