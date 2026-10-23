import { formatWhen } from '@/lib/format';

// Presentation rules for bookings, shared by the renter and owner screens. Kept apart from lib/bookings.ts
// (request validation, used by API routes) because this is about what a person reads, not what the server accepts.

export type BookingRow = {
  id: string; car_id: string; status: string; start_at: string; end_at: string; created_at: string;
  price_paise: number; delivery_fee_paise: number; platform_fee_paise: number; renter_service_fee_paise: number;
  owner_payout_paise: number; deposit_paise: number; expires_at: string | null; instant_book: boolean;
  cars?: { title: string; city: string } | { title: string; city: string }[] | null;
};

export const STATUS_LABEL: Record<string, string> = {
  requested: 'Waiting for owner', approved: 'Accepted', rejected: 'Declined', expired: 'Expired', payment_pending: 'Awaiting payment',
  confirmed: 'Confirmed', active: 'On the road', returned: 'Returned', completed: 'Completed', cancelled: 'Cancelled', disputed: 'In dispute',
};

// Statuses that carry a deadline (see expires_at). Past that deadline they are dead, whatever the row still says.
const HAS_DEADLINE = ['requested', 'approved', 'payment_pending'];

// The database flips these to 'expired' only when a sweep runs (on the next booking API call). Until then a stale
// row still says 'requested'. Showing "waiting for the owner" for a request that already timed out would mislead
// both people, so the screens use this instead of the raw status.
export function effectiveStatus(status: string, expiresAt: string | null, now: Date): string {
  return HAS_DEADLINE.includes(status) && expiresAt && new Date(expiresAt) <= now ? 'expired' : status;
}

// What the renter pays for the trip itself (the deposit is separate). This is the money identity from
// lib/pricing.ts, which is why bookings need no extra column for it.
export const renterTotalPaise = (b: Pick<BookingRow, 'owner_payout_paise' | 'platform_fee_paise' | 'renter_service_fee_paise'>) =>
  b.owner_payout_paise + b.platform_fee_paise + b.renter_service_fee_paise;

// Whole-day count the same way the pricing code bills it: 24h blocks, rounded up, minimum one.
export const billedDays = (startAt: string, endAt: string) =>
  Math.max(1, Math.ceil((new Date(endAt).getTime() - new Date(startAt).getTime()) / 86_400_000));

export const carOf = (b: Pick<BookingRow, 'cars'>) => (Array.isArray(b.cars) ? b.cars[0] : b.cars) ?? null;

// One plain sentence telling each side what happens next.
export function statusHint(role: 'renter' | 'owner', status: string, expiresAt: string | null): string {
  const by = expiresAt ? formatWhen(expiresAt) : '';
  if (role === 'renter') {
    switch (status) {
      case 'requested': return `The owner has until ${by} to respond. You will not be charged yet.`;
      case 'approved': case 'payment_pending': return `Accepted. The car is held for you until ${by}. Online payment is coming soon.`;
      case 'rejected': return 'The owner declined this request. You were not charged.';
      case 'expired': return 'This request ran out of time. You were not charged.';
      case 'confirmed': return 'Your booking is confirmed.';
      default: return '';
    }
  }
  switch (status) {
    case 'requested': return `Respond by ${by}, or the request expires.`;
    case 'approved': case 'payment_pending': return `Accepted. The car is held for the renter until ${by}.`;
    case 'rejected': return 'You declined this request.';
    case 'expired': return 'This request ran out of time.';
    case 'confirmed': return 'Confirmed.';
    default: return '';
  }
}
