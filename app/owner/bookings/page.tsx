'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabaseBrowser as supabase } from '@/lib/supabase/browser';
import { useUserId } from '@/components/useUserId';
import BookingCard from '@/components/BookingCard';
import { effectiveStatus, type BookingRow } from '@/lib/booking-view';

const COLUMNS = 'id, car_id, status, start_at, end_at, created_at, price_paise, delivery_fee_paise, platform_fee_paise, renter_service_fee_paise, owner_payout_paise, deposit_paise, expires_at, instant_book, cars(title, city)';

export default function OwnerBookings() {
  const uid = useUserId();
  const [rows, setRows] = useState<BookingRow[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    supabase.from('bookings').select(COLUMNS).eq('owner_id', uid).order('created_at', { ascending: false }).limit(100)
      .then(({ data, error }) => {
        if (cancelled) return;
        setError(error ? 'Could not load booking requests.' : '');
        setRows(error ? null : (data ?? []) as unknown as BookingRow[]);
        setNow(new Date());
      });
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [uid, attempt]);

  async function respond(id: string, decision: 'approve' | 'reject') {
    if (busy) return;
    setBusy(id); setMessage('');
    try {
      const res = await fetch(`/api/bookings/${id}/respond`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        setRows(current => current?.map(b => b.id === id ? { ...b, status: json.booking.status, expires_at: json.booking.expiresAt } : b) ?? null);
        setMessage(decision === 'approve' ? 'Request accepted. Payment is not live yet.' : 'Request declined.');
      } else {
        setMessage(json?.error?.message ?? 'Could not respond. Please try again.');
        setAttempt(n => n + 1);
      }
    } catch { setMessage('Could not reach the server. Please try again.'); }
    finally { setBusy(null); setNow(new Date()); }
  }

  if (uid === undefined) return <main className="wrap"><p>Loading…</p></main>;
  if (!uid) return <main className="wrap"><h1>Owner bookings</h1><Link className="btn" href="/login?next=%2Fowner%2Fbookings">Sign in to see requests</Link></main>;
  return <main className="wrap">
    <h1>Owner bookings</h1>
    <p><Link href="/owner/cars">Manage cars and availability</Link></p>
    {message && <p role="status">{message}</p>}
    {error ? <div role="alert"><p>{error}</p><button onClick={() => setAttempt(n => n + 1)}>Try again</button></div>
      : !rows || !now ? <p>Loading requests…</p>
      : rows.length === 0 ? <p>No booking requests yet.</p>
      : <div className="stack">{rows.map(b => <BookingCard key={b.id} booking={b} role="owner" now={now}>
        {effectiveStatus(b.status, b.expires_at, now) === 'requested' && new Date(b.start_at) > now && <div className="actions">
          <button className="btn" disabled={busy !== null} onClick={() => respond(b.id, 'approve')}>Accept request</button>{' '}
          <button className="btn ghost" disabled={busy !== null} onClick={() => respond(b.id, 'reject')}>Decline request</button>
        </div>}
      </BookingCard>)}</div>}
    <p className="note">Showing the latest 100 bookings.</p>
  </main>;
}
