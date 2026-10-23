'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabaseBrowser as supabase } from '@/lib/supabase/browser';
import { useUserId } from '@/components/useUserId';

type Car = { id: string; title: string; status: string };
export default function OwnerCars() {
  const uid = useUserId();
  const [cars, setCars] = useState<Car[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    supabase.from('cars').select('id, title, status').eq('owner_id', uid).order('created_at', { ascending: false })
      .then(({ data, error }) => { if (!cancelled) { setError(!!error); setCars(error ? null : data); } });
    return () => { cancelled = true; };
  }, [uid, attempt]);
  if (uid === undefined) return <main className="wrap"><p>Loading…</p></main>;
  if (!uid) return <main className="wrap"><Link href="/login?next=%2Fowner%2Fcars">Sign in to manage your cars</Link></main>;
  return <main className="wrap"><h1>My cars</h1><p><Link href="/owner/bookings">Booking requests</Link> · <Link href="/owner/new">List a car</Link></p>
    {error ? <div role="alert">Could not load cars. <button onClick={() => setAttempt(n => n + 1)}>Try again</button></div>
      : !cars ? <p>Loading cars…</p> : cars.length === 0 ? <p>No cars listed yet.</p>
      : cars.map(car => <article className="trip" key={car.id}><h2>{car.title}</h2><p>{car.status}</p><Link href={`/owner/cars/${car.id}/availability`}>Manage availability</Link></article>)}
  </main>;
}
