import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatPaise, formatWhen } from '@/lib/format';
import { billedDays, carOf, effectiveStatus, renterTotalPaise, statusHint, STATUS_LABEL, type BookingRow } from '@/lib/booking-view';

// One booking, from either side. `role` decides which money the person cares about: a renter sees what THEY pay,
// an owner sees what THEY receive. `now` is passed in (not read here) so the card renders the same everywhere.
export default function BookingCard({ booking: b, role, now, children }: { booking: BookingRow; role: 'renter' | 'owner'; now: Date; children?: ReactNode }) {
  const status = effectiveStatus(b.status, b.expires_at, now);
  const car = carOf(b);
  const days = billedDays(b.start_at, b.end_at);
  const ownerFee = b.price_paise + b.delivery_fee_paise - b.owner_payout_paise; // the owner's share of the platform fee
  const hint = statusHint(role, status, b.expires_at);
  return (
    <article className="trip" aria-label={car?.title ?? 'Booking'}>
      <div className="trip-head">
        <h3>{car ? (role === 'renter' ? <Link href={`/cars/${b.car_id}`}>{car.title}</Link> : car.title) : 'Car no longer listed'}</h3>
        <span className={`badge b-${status}`}>{STATUS_LABEL[status] ?? status}</span>
      </div>
      <p className="note">{car?.city ? `${car.city} · ` : ''}{formatWhen(b.start_at)} to {formatWhen(b.end_at)} · {days} day{days === 1 ? '' : 's'}</p>
      {role === 'renter' ? (
        <p>Trip total <strong>{formatPaise(renterTotalPaise(b))}</strong>{b.deposit_paise > 0 && <span className="note"> · plus {formatPaise(b.deposit_paise)} refundable deposit</span>}</p>
      ) : (
        <p>You receive <strong>{formatPaise(b.owner_payout_paise)}</strong>{ownerFee > 0 && <span className="note"> · after a {formatPaise(ownerFee)} platform fee</span>}{b.deposit_paise > 0 && <span className="note"> · {formatPaise(b.deposit_paise)} deposit</span>}</p>
      )}
      {hint && <p className="note">{hint}</p>}
      {children}
    </article>
  );
}
