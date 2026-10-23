'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabaseBrowser as supabase } from '@/lib/supabase/browser';
import { useUserId } from '@/components/useUserId';

type Car = { id: string; title: string; status: string; instant_book: boolean };
export default function OwnerCars() {
  const uid = useUserId();
  const [cars, setCars] = useState<Car[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    supabase.from('cars').select('id, title, status, instant_book').eq('owner_id', uid).order('created_at', { ascending: false })
      .then(({ data, error }) => { if (!cancelled) { setError(!!error); setCars(error ? null : data); } });
    return () => { cancelled = true; };
  }, [uid, attempt]);
  async function toggle(car: Car) {
    if (busy) return;
    setBusy(car.id); setMessage('');
    try {
      const response = await fetch(`/api/cars/${car.id}/instant-book`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !car.instant_book }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) setMessage(json?.error?.message ?? 'Could not change instant booking. Please try again.');
      else if (typeof json?.car?.instantBook !== 'boolean') setMessage('Could not confirm the change. Refresh this page.');
      else {
        setCars(current => current?.map(c => c.id === car.id ? { ...c, instant_book: json.car.instantBook } : c) ?? null);
        setMessage(json.car.instantBook ? 'Instant booking enabled for future requests.' : 'Manual approval enabled for future requests.');
      }
    } catch { setMessage('Could not reach the server. Please try again.'); }
    finally { setBusy(null); }
  }
  if (uid === undefined) return <main className="wrap"><p>Loading…</p></main>;
  if (!uid) return <main className="wrap"><Link href="/login?next=%2Fowner%2Fcars">Sign in to manage your cars</Link></main>;
  return <main className="wrap"><h1>My cars</h1><p><Link href="/owner/bookings">Booking requests</Link> · <Link href="/owner/new">List a car</Link></p>
    <p className="note">Instant booking accepts new requests automatically. Turning it off requires your approval for new requests. Existing requests and bookings keep their current status.</p>
    {message && <p role="status">{message}</p>}
    {error ? <div role="alert">Could not load cars. <button onClick={() => setAttempt(n => n + 1)}>Try again</button></div>
      : !cars ? <p>Loading cars…</p> : cars.length === 0 ? <p>No cars listed yet.</p>
      : cars.map(car => <article className="trip" key={car.id}><h2>{car.title}</h2><p>{car.status}</p><Link href={`/owner/cars/${car.id}/availability`}>Manage availability</Link>
        <p>Instant booking: {car.instant_book ? 'On' : 'Off'}</p>
        <button className="btn ghost" type="button" disabled={busy !== null} onClick={() => toggle(car)}>{busy === car.id ? 'Saving…' : car.instant_book ? 'Require manual approval' : 'Enable instant booking'}</button>
      </article>)}
  </main>;
}
