import { z } from 'zod';

// Statuses that HOLD a car. MUST stay identical to the exclusion constraint and triggers in
// supabase/migrations/0002_bookings.sql. If you change one, change the other.
export const HOLDING_STATUSES = ['approved', 'payment_pending', 'confirmed', 'active', 'returned', 'disputed'] as const;

// Spam / abuse cap. Counted from the bookings table itself rather than in server memory: serverless
// instances do not share memory, so an in-process counter would let an attacker spread requests across
// instances. (A dedicated rate limiter, e.g. Upstash, is the next step up if this ever needs to be stricter.)
export const MAX_NEW_REQUESTS_PER_HOUR = 10;

// .strict() rejects unknown keys. That is the money safeguard: a client that sends { price: 1 } or
// { ownerPayout: 99999 } gets a 400 instead of having the field silently ignored (or, after a future
// refactor, silently trusted). The only inputs are WHICH car and WHEN.
export const createBookingSchema = z.object({
  carId: z.uuid(),
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
}).strict();

export const respondSchema = z.object({ decision: z.enum(['approve', 'reject']) }).strict();
export const bookingIdSchema = z.uuid();
