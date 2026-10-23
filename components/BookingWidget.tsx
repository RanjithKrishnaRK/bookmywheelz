'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser as supabase } from '@/lib/supabase/browser';
import { calculateQuote, type FeeChargedTo } from '@/lib/pricing';
import { formatPaise, formatWhen, toLocalInput } from '@/lib/format';

// The car fields the widget needs. The page passes only these (not the whole row) so the client bundle never
// carries data it does not use.
export type BookingCar = {
  id: string; owner_id: string; price_per_day: number; security_deposit: number;
  min_rental_days: number; km_limit_per_day: number | null; instant_book: boolean;
};

type Settings = { feePercent: number; feeChargedTo: FeeChargedTo; renterServiceFeePaise: number };
type Range = { start_at: string; end_at: string };
type Msg = { ok: boolean; text: string } | null;

// An empty or half-typed datetime-local value is '' and an invalid one gives an Invalid Date: both mean "not picked yet".
const parse = (s: string) => { if (!s) return null; const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d; };

export default function BookingWidget({ car }: { car: BookingCar }) {
  const [uid, setUid] = useState<string | null | undefined>(undefined); // undefined = still checking
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ranges, setRanges] = useState<Range[]>([]);
  const [loadError, setLoadError] = useState(false);
  // "Now" is read AFTER mount, never during render: the server-rendered HTML and the browser's first render must
  // match exactly, and the server's clock is not the browser's clock.
  const [now, setNow] = useState<Date | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [session, st, rg] = await Promise.all([
        supabase.auth.getSession(),
        // Fee numbers are public by design (the renter sees them at checkout) so the anon key can read them.
        supabase.from('platform_settings').select('fee_percent, fee_charged_to, renter_service_fee_paise').single(),
        // Date RANGES only, never who booked: renters cannot read other people's bookings.
        supabase.rpc('car_unavailable_ranges', { p_car_id: car.id }),
      ]);
      if (cancelled) return;
      setUid(session.data.session?.user.id ?? null); // a UI hint only; the server re-checks identity on submit
      if (st.error || !st.data) setLoadError(true);
      else setSettings({ feePercent: Number(st.data.fee_percent), feeChargedTo: st.data.fee_charged_to, renterServiceFeePaise: st.data.renter_service_fee_paise });
      // If the ranges fail to load we still let people try: the server and database refuse conflicts regardless.
      setRanges(rg.error ? [] : ((rg.data ?? []) as Range[]));
      setNow(new Date());
    })();
    return () => { cancelled = true; };
  }, [car.id]);

  const startAt = parse(start);
  const endAt = parse(end);
  // This PREVIEWS the price with the very same function the server uses, so the two can never drift apart.
  // It is only a preview: POST /api/bookings recomputes everything from the database and ignores this.
  const quote = settings && now && startAt && endAt
    ? calculateQuote({
        car: { pricePerDayRupees: car.price_per_day, securityDepositRupees: car.security_deposit, minRentalDays: car.min_rental_days, kmLimitPerDay: car.km_limit_per_day },
        settings, startAt, endAt, now, deliveryFeePaise: 0,
      })
    : null;
  // Half-open overlap (same rule as the database): back-to-back trips do not conflict.
  const conflict = !!(startAt && endAt && ranges.some(r => new Date(r.start_at) < endAt && new Date(r.end_at) > startAt));
  const upcoming = [...ranges].sort((a, b) => a.start_at.localeCompare(b.start_at)).slice(0, 6);
  const isOwner = uid != null && uid === car.owner_id;
  const canSubmit = !!(quote?.ok) && !conflict && !!uid && !isOwner && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !startAt || !endAt || busy) return;
    setBusy(true); setMsg(null);
    try {
      // The ONLY things sent are which car and when. No price, fee or user id: the server decides all of those.
      const res = await fetch('/api/bookings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carId: car.id, startAt: startAt.toISOString(), endAt: endAt.toISOString() }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        const b = json?.booking;
        setMsg({ ok: true, text: b?.status === 'approved'
          ? `Reserved. The car is held for you until ${formatWhen(b.expiresAt)}. Online payment is coming soon.`
          : `Request sent. The owner has until ${formatWhen(b?.expiresAt)} to respond. You will not be charged yet.` });
      } else {
        setMsg({ ok: false, text: json?.error?.message ?? 'Something went wrong. Please try again.' });
      }
    } catch {
      setMsg({ ok: false, text: 'Could not reach the server. Check your connection and try again.' });
    }
    setBusy(false);
  }

  if (isOwner) {
    return <aside className="book"><h2>Your listing</h2><p className="note">You cannot book your own car. <Link href={`/owner/cars/${car.id}/availability`}>Manage availability</Link></p></aside>;
  }

  const q = quote?.ok ? quote.quote : null;
  return (
    <aside className="book" aria-labelledby="book-title">
      <h2 id="book-title">{formatPaise(car.price_per_day * 100)} <small>/ day</small></h2>
      <form onSubmit={submit} className="form">
        <label>Pickup<input type="datetime-local" value={start} min={now ? toLocalInput(now) : undefined} onChange={e => { setStart(e.target.value); setMsg(null); }} required /></label>
        <label>Return<input type="datetime-local" value={end} min={start || (now ? toLocalInput(now) : undefined)} onChange={e => { setEnd(e.target.value); setMsg(null); }} required /></label>

        {loadError && <p role="alert" className="err">Could not load pricing. Refresh the page to try again.</p>}
        {!loadError && quote && !quote.ok && <p role="alert" className="err">{quote.code === 'invalid_input' ? 'This car cannot be priced right now.' : quote.message}</p>}
        {conflict && <p role="alert" className="err">The car is not available for those dates.</p>}

        {q && (
          <dl className="sum" aria-label="Price breakdown">
            <div><dt>{q.days} day{q.days === 1 ? '' : 's'} × {formatPaise(car.price_per_day * 100)}</dt><dd>{formatPaise(q.pricePaise)}</dd></div>
            {q.renterCommissionPaise > 0 && <div><dt>Platform fee</dt><dd>{formatPaise(q.renterCommissionPaise)}</dd></div>}
            {q.renterServiceFeePaise > 0 && <div><dt>Service fee</dt><dd>{formatPaise(q.renterServiceFeePaise)}</dd></div>}
            <div className="total"><dt>Trip total</dt><dd>{formatPaise(q.renterTotalPaise)}</dd></div>
            {q.depositPaise > 0 && <div><dt>Refundable deposit</dt><dd>{formatPaise(q.depositPaise)}</dd></div>}
            <div className="note"><dt>Distance included</dt><dd>{q.kmLimit === null ? 'Unlimited' : `${q.kmLimit.toLocaleString('en-IN')} km`}</dd></div>
          </dl>
        )}
        {!q && !loadError && !(quote && !quote.ok) && <p className="note">Pick pickup and return times to see the price.</p>}

        {uid === null
          ? <Link className="btn" href={`/login?next=${encodeURIComponent(`/cars/${car.id}`)}`}>Sign in to book</Link>
          : <button className="btn" disabled={!canSubmit}>{busy ? 'Sending…' : car.instant_book ? 'Book instantly' : 'Request to book'}</button>}
        <p className="note">{car.instant_book ? 'This owner accepts bookings instantly.' : 'The owner must accept before you pay. You will not be charged now.'}</p>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'ok' : 'err'}>{msg.text} {msg.ok && <Link href="/renter/bookings">View my trips</Link>}</p>}
      </form>

      {upcoming.length > 0 && (
        <div>
          <h3>Not available</h3>
          <ul className="note">{upcoming.map(r => <li key={r.start_at + r.end_at}>{formatWhen(r.start_at)} to {formatWhen(r.end_at)}</li>)}</ul>
        </div>
      )}
    </aside>
  );
}
