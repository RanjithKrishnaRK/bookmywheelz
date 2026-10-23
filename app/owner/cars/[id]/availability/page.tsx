'use client';
import Link from 'next/link';
import { Suspense, use, useEffect, useState } from 'react';
import { supabaseBrowser as supabase } from '@/lib/supabase/browser';
import { useUserId } from '@/components/useUserId';
import { formatWhen } from '@/lib/format';

type Block = { id: string; start_at: string; end_at: string; reason: string };
export default function AvailabilityPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<main className="wrap"><p>Loading availability…</p></main>}><Availability params={params} /></Suspense>;
}

function Availability({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const uid = useUserId();
  const [title, setTitle] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    Promise.all([
      supabase.from('cars').select('title').eq('id', id).eq('owner_id', uid).maybeSingle(),
      supabase.from('availability_blocks').select('id, start_at, end_at, reason').eq('car_id', id).order('start_at'),
    ]).then(([car, ranges]) => {
      if (cancelled) return;
      setError(car.error || ranges.error ? 'Could not load availability.' : !car.data ? 'Car not found or you do not own it.' : '');
      setTitle(car.data?.title ?? null); setBlocks(ranges.data ?? []); setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [uid, id, attempt]);
  async function mutate(blockId?: string) {
    if (busy || !title) return;
    if (!blockId && (!start || !end || !Number.isFinite(new Date(start).getTime()) || !Number.isFinite(new Date(end).getTime()) || new Date(end) <= new Date(start))) {
      setMessage('Choose valid dates with the end after the start.'); return;
    }
    setBusy(true); setMessage('');
    try {
      const result = blockId
        ? await supabase.from('availability_blocks').delete().eq('id', blockId).eq('car_id', id).eq('reason', 'owner_blocked').select('id')
        : await supabase.from('availability_blocks').insert({ car_id: id, start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString(), reason: 'owner_blocked' }).select('id');
      if (result.error) setMessage(result.error.code === '23P01' ? 'These dates overlap an existing booking.' : 'Could not save availability. Please try again.');
      else if (!result.data?.length) setMessage('The block was not changed. Refresh and try again.');
      else { setMessage(blockId ? 'Block removed.' : 'Dates blocked.'); setAttempt(n => n + 1); if (!blockId) { setStart(''); setEnd(''); } }
    } catch { setMessage('Could not reach the server. Please try again.'); }
    finally { setBusy(false); }
  }
  if (uid === undefined) return <main className="wrap"><p>Loading…</p></main>;
  if (!uid) return <main className="wrap"><Link href={`/login?next=${encodeURIComponent(`/owner/cars/${id}/availability`)}`}>Sign in to manage availability</Link></main>;
  return <main className="wrap"><h1>Manage availability</h1><p><Link href="/owner/cars">My cars</Link></p>
    {!loaded ? <p>Loading…</p> : error ? <div role="alert">{error} <button onClick={() => setAttempt(n => n + 1)}>Try again</button></div> : <>
      <h2>{title}</h2><p>Block dates when your car is unavailable. Existing accepted bookings are protected.</p>
      <form className="form" onSubmit={e => { e.preventDefault(); void mutate(); }}>
        <label>Start<input type="datetime-local" required value={start} onChange={e => setStart(e.target.value)} /></label>
        <label>End<input type="datetime-local" required value={end} min={start} onChange={e => setEnd(e.target.value)} /></label>
        <button className="btn" disabled={busy}>Block dates</button>
      </form>
      {blocks.length === 0 ? <p>No blocked dates.</p> : <ul>{blocks.map(b => <li key={b.id}>{formatWhen(b.start_at)} to {formatWhen(b.end_at)}{' '}
        {b.reason === 'owner_blocked' && <button disabled={busy} onClick={() => mutate(b.id)}>Remove block</button>}</li>)}</ul>}
    </>}
    {message && <p role="status">{message}</p>}
  </main>;
}
