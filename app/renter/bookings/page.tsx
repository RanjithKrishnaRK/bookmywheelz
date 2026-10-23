'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabaseBrowser as supabase } from '@/lib/supabase/browser';
import { useUserId } from '@/components/useUserId';
import BookingCard from '@/components/BookingCard';
import type { BookingRow } from '@/lib/booking-view';

const COLUMNS = 'id, car_id, status, start_at, end_at, created_at, price_paise, delivery_fee_paise, platform_fee_paise, renter_service_fee_paise, owner_payout_paise, deposit_paise, expires_at, instant_book, cars(title, city)';

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; rows: BookingRow[]; now: Date };

export default function MyTrips() {
  const uid = useUserId();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0); // bumped by "Try again" to re-run the effect

  useEffect(() => {
    if (!uid) return;
    let cancelled = false; // a slow response must not update the page after the user has left it
    // The renter_id filter is for clarity; the real guard is the database policy that only lets the renter and
    // the car's owner read a booking, so even a tampered request could not return anyone else's trips.
    supabase.from('bookings').select(COLUMNS).eq('renter_id', uid).order('created_at', { ascending: false }).limit(100)
      .then(({ data, error }) => {
        if (cancelled) return;
        setLoad(error ? { state: 'error' } : { state: 'ready', rows: (data ?? []) as unknown as BookingRow[], now: new Date() });
      });
    return () => { cancelled = true; };
  }, [uid, attempt]);

  if (uid === undefined) return <main className="wrap"><p>Loading…</p></main>;
  if (uid === null) return <main className="wrap"><div className="empty"><h2>Sign in to see your trips</h2><Link className="btn" href="/login?next=%2Frenter%2Fbookings">Sign in</Link></div></main>;

  return (
    <main className="wrap">
      <h1>My trips</h1>
      {load.state === 'loading' && <p>Loading your trips…</p>}
      {load.state === 'error' && (
        <div className="err" role="alert"><p>Could not load your trips.</p><button className="btn" onClick={() => { setLoad({ state: 'loading' }); setAttempt(n => n + 1); }}>Try again</button></div>
      )}
      {load.state === 'ready' && (load.rows.length === 0
        ? <div className="empty"><h2>No trips yet</h2><p>Find a car and send your first request.</p><Link className="btn" href="/search">Find a car</Link></div>
        : <div className="stack">{load.rows.map(b => <BookingCard key={b.id} booking={b} role="renter" now={load.now} />)}</div>)}
    </main>
  );
}
