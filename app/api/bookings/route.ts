import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { apiError, apiOk, guardMutation, readJson, serverError } from '@/lib/api';
import { createBookingSchema, HOLDING_STATUSES, MAX_NEW_REQUESTS_PER_HOUR } from '@/lib/bookings';
import { calculateQuote } from '@/lib/pricing';

// POST /api/bookings: a renter asks to book a car for a date range.
// The body carries ONLY { carId, startAt, endAt }. Every amount is computed here from database values, so
// there is nothing in the request a hostile client could change to get a cheaper booking.
export async function POST(request: NextRequest) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;

  // Identity comes from the verified session, never from the body: otherwise anyone could book "as" someone else.
  const user = await getCurrentUser();
  if (!user) return apiError(401, 'unauthenticated', 'Please sign in to book a car.');

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = createBookingSchema.safeParse(body.data);
  if (!parsed.success) return apiError(400, 'invalid_request', 'Send a valid car and ISO start/end dates.');
  const { carId } = parsed.data;
  const startAt = new Date(parsed.data.startAt);
  const endAt = new Date(parsed.data.endAt);
  const now = new Date();

  let db;
  try { db = createSupabaseAdmin(); } catch (e) { console.error('[api] server misconfigured:', e); return apiError(500, 'server_misconfigured', 'The server is not configured correctly.'); }

  // Rate limit first: it is the cheapest query and the one that stops abuse before we do real work.
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const recent = await db.from('bookings').select('id', { count: 'exact', head: true }).eq('renter_id', user.id).gte('created_at', hourAgo);
  if (recent.error) return serverError('rate limit count', recent.error);
  if ((recent.count ?? 0) >= MAX_NEW_REQUESTS_PER_HOUR) return apiError(429, 'rate_limited', 'Too many booking requests. Please try again later.');

  // Free dates held by requests/approvals that ran out of time, so they cannot block this one.
  const sweep = await db.rpc('expire_stale_bookings');
  if (sweep.error) return serverError('expire sweep', sweep.error);

  // A car that does not exist and a car that is not approved look identical to the caller: do not let
  // people probe for unlisted or rejected listings.
  const carRes = await db.from('cars').select('id, owner_id, status, price_per_day, security_deposit, min_rental_days, km_limit_per_day, instant_book').eq('id', carId).maybeSingle();
  if (carRes.error) return serverError('car lookup', carRes.error);
  const car = carRes.data;
  if (!car || car.status !== 'approved') return apiError(404, 'car_not_found', 'This car is not available.');
  if (car.owner_id === user.id) return apiError(403, 'own_car', 'You cannot book your own car.');
  // STAGE 3: this is where "booking blocked until the renter's KYC is verified" will go.

  const settingsRes = await db.from('platform_settings').select('fee_percent, fee_charged_to, renter_service_fee_paise, owner_response_hours, payment_window_minutes').single();
  if (settingsRes.error) return serverError('settings lookup', settingsRes.error);
  const s = settingsRes.data;

  // Delivery is not offered yet: there is no trusted source for a delivery fee until car_locations exists
  // (Stage 3). It is deliberately NOT accepted from the request, so the fee is always 0 for now.
  const quoteRes = calculateQuote({
    car: { pricePerDayRupees: car.price_per_day, securityDepositRupees: car.security_deposit, minRentalDays: car.min_rental_days, kmLimitPerDay: car.km_limit_per_day },
    settings: { feePercent: Number(s.fee_percent), feeChargedTo: s.fee_charged_to, renterServiceFeePaise: s.renter_service_fee_paise },
    startAt, endAt, now, deliveryFeePaise: 0,
  });
  if (!quoteRes.ok) {
    // invalid_input means OUR data (the car row or the settings) is bad, not the user's request.
    if (quoteRes.code === 'invalid_input') return serverError('pricing rejected stored data', { carId, code: quoteRes.code });
    return apiError(400, quoteRes.code, quoteRes.message);
  }
  const q = quoteRes.quote;
  const startIso = startAt.toISOString();
  const endIso = endAt.toISOString();

  // Friendly up-front availability check. This is a UX nicety only: the real guarantee is the exclusion
  // constraint + triggers in the database, which still catch a race between this check and the insert.
  // Overlap of half-open ranges: a.start < b.end AND a.end > b.start (back-to-back trips do not conflict).
  const held = await db.from('bookings').select('id').eq('car_id', carId).in('status', [...HOLDING_STATUSES]).lt('start_at', endIso).gt('end_at', startIso).limit(1);
  if (held.error) return serverError('availability check (bookings)', held.error);
  const blockedDates = await db.from('availability_blocks').select('id').eq('car_id', carId).lt('start_at', endIso).gt('end_at', startIso).limit(1);
  if (blockedDates.error) return serverError('availability check (blocks)', blockedDates.error);
  if (held.data.length || blockedDates.data.length) return apiError(409, 'dates_unavailable', 'This car is not available for those dates.');

  // One live request per renter per car for overlapping dates: stops spamming an owner with duplicates.
  const dup = await db.from('bookings').select('id').eq('car_id', carId).eq('renter_id', user.id).in('status', ['requested', 'approved']).lt('start_at', endIso).gt('end_at', startIso).limit(1);
  if (dup.error) return serverError('duplicate check', dup.error);
  if (dup.data.length) return apiError(409, 'duplicate_request', 'You already have a request for this car on those dates.');

  // Instant-book cars skip owner approval: the booking starts as 'approved', which HOLDS the car while the
  // renter pays. Otherwise it starts as 'requested' and waits for the owner. Either way it has a deadline,
  // so nothing sits (or holds a car) forever.
  const instant = car.instant_book === true;
  const status = instant ? 'approved' : 'requested';
  const expiresAt = new Date(Math.min(startAt.getTime(), now.getTime() + (instant ? s.payment_window_minutes * 60_000 : s.owner_response_hours * 3_600_000))).toISOString();

  const ins = await db.from('bookings').insert({
    car_id: carId, renter_id: user.id, owner_id: car.owner_id, start_at: startIso, end_at: endIso,
    status, instant_book: instant, expires_at: expiresAt,
    price_paise: q.pricePaise, delivery_fee_paise: q.deliveryFeePaise, renter_service_fee_paise: q.renterServiceFeePaise,
    platform_fee_paise: q.platformFeePaise, owner_payout_paise: q.ownerPayoutPaise, deposit_paise: q.depositPaise, km_limit: q.kmLimit,
  }).select('id, status, start_at, end_at, expires_at, instant_book').single();

  if (ins.error) {
    // 23P01 = the database refused an overlap (someone else got the dates between our check and the insert).
    if (ins.error.code === '23P01') return apiError(409, 'dates_unavailable', 'This car is not available for those dates.');
    // 23503 = a foreign key failed: this user has no profile row (account created before the database was set up).
    if (ins.error.code === '23503') { console.error('[api] booking insert hit a foreign key error (user, car, owner):', user.id, carId, car.owner_id, ins.error); return apiError(409, 'profile_missing', 'Your profile is not set up yet. Please sign out and back in.'); }
    return serverError('booking insert', ins.error);
  }

  // Audit trail. Best effort for now: the booking is already stored and no money has moved yet, so a failed
  // audit write is logged loudly rather than undoing the booking. When payments exist (Stage 2B) money
  // movement and its audit row must be ONE database transaction, done in a SQL function.
  const audit = await db.from('audit_log').insert({ actor_id: user.id, action: 'booking.create', entity: 'booking', entity_id: ins.data.id, after: { status, quote: q, carId } });
  if (audit.error) console.error('[api] AUDIT WRITE FAILED for booking.create', ins.data.id, audit.error);

  return apiOk({ booking: { id: ins.data.id, status: ins.data.status, startAt: ins.data.start_at, endAt: ins.data.end_at, expiresAt: ins.data.expires_at, instantBook: ins.data.instant_book }, quote: q }, 201);
}
