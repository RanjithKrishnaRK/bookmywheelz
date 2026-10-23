// Booking price and fee calculation. PURE on purpose: no database, no clock, no network. Everything it
// needs is passed in, so the same inputs always give the same quote and it can be tested exhaustively.
//
// WHERE THIS MAY RUN: the server computes the quote that is stored on the booking and charged. A browser
// may call it to PREVIEW a price, but the browser's number is never trusted: /api/bookings recomputes it.
// Every value that affects money (car price, deposit, delivery fee, fee settings) must come from the
// database on the server, never from the request body.
//
// ALL MONEY IS INTEGER PAISE (1 rupee = 100 paise). No floats ever touch an amount: floats cannot
// represent 0.1 exactly, so 3 x 0.1 style drift would eventually put a rupee in the wrong pocket.
//
// THE MONEY IDENTITY (checked by the tests for every fee mode):
//   renterTotalPaise = ownerPayoutPaise + platformFeePaise + renterServiceFeePaise
// This is why the bookings table needs no column for "the renter's share of the commission": it can
// always be recomputed as platformFee + ownerPayout - price - delivery.
//
// NOT HANDLED HERE (flag to your CA; see spec section 2): GST on the platform fee and TDS on payouts.
// Hourly rentals (cars.price_per_hour) are also not priced: Stage 2 bills whole days only.

export type FeeChargedTo = 'owner' | 'renter' | 'split';

export type PricingCar = {
  pricePerDayRupees: number;      // cars.price_per_day (whole rupees, as stored by Stage 1)
  securityDepositRupees: number;  // cars.security_deposit (0 = none)
  minRentalDays: number;          // cars.min_rental_days
  kmLimitPerDay: number | null;   // cars.km_limit_per_day (null = unlimited)
};

export type PricingSettings = {
  feePercent: number;             // platform_settings.fee_percent, at most 2 decimals, 0..100
  feeChargedTo: FeeChargedTo;
  renterServiceFeePaise: number;  // flat fee added at checkout, NOT subject to commission
};

export type PricingInput = {
  car: PricingCar;
  settings: PricingSettings;
  startAt: Date;
  endAt: Date;
  now: Date;                      // injected (not read inside) so tests are deterministic
  deliveryFeePaise?: number;      // must come from the database for this car, never from the browser
};

export type Quote = {
  days: number;
  // These five map 1:1 onto bookings columns of the same name:
  pricePaise: number;             // days x daily rate (rental only)
  deliveryFeePaise: number;
  platformFeePaise: number;       // TOTAL commission, regardless of who pays it
  renterServiceFeePaise: number;  // the flat fee only
  ownerPayoutPaise: number;       // what the owner actually receives
  depositPaise: number;           // refundable; not part of any fee base
  kmLimit: number | null;         // total allowance for the whole booking (per-day limit x days)
  // Derived, for display and for the payment amount:
  ownerCommissionPaise: number;   // owner's share of the commission
  renterCommissionPaise: number;  // renter's share of the commission
  renterTotalPaise: number;       // everything the renter pays except the deposit
  amountDuePaise: number;         // renterTotal + deposit: the amount to charge at checkout
};

export type PricingErrorCode =
  | 'invalid_input' | 'invalid_dates' | 'in_the_past' | 'too_long' | 'below_min_rental';

export type PricingResult =
  | { ok: true; quote: Quote }
  | { ok: false; code: PricingErrorCode; message: string };

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Longer rentals are the Stage 4 "long-term plans" feature (weekly/monthly pricing). Until that exists,
// cap it so a typo (year 2207) cannot produce an absurd charge. Change deliberately, not casually.
export const MAX_RENTAL_DAYS = 30;
// Match the database's signed 32-bit integer columns. Intermediate products like
// amount x basis-points also stay below Number.MAX_SAFE_INTEGER, where integers stay exact.
const MAX_AMOUNT_PAISE = 2_147_483_647; // PostgreSQL integer columns

const fail = (code: PricingErrorCode, message: string): PricingResult => ({ ok: false, code, message });
const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= MAX_AMOUNT_PAISE;

// Round-half-up percentage of an integer amount, in integer arithmetic only.
// amount x bps / 10000, with the half rounded UP: floor((amount x bps + 5000) / 10000).
// Half-up (not banker's rounding) because it is what people expect from a bill: Rs 0.165 -> Rs 0.17.
const percentOf = (amountPaise: number, bps: number) => Math.floor((amountPaise * bps + 5000) / 10000);

export function calculateQuote(input: PricingInput): PricingResult {
  const { car, settings, startAt, endAt, now } = input;
  const deliveryFeePaise = input.deliveryFeePaise ?? 0;

  // --- Validate everything. This function is the last line of defence, so it does not assume the
  // --- caller already checked: a malformed DB row or a bug upstream must not become a wrong charge.
  const ms = [startAt, endAt, now].map((d) => (d instanceof Date ? d.getTime() : NaN));
  if (ms.some((t) => !Number.isFinite(t))) return fail('invalid_dates', 'Pick valid start and end dates.');
  const [start, end, nowMs] = ms;
  if (end <= start) return fail('invalid_dates', 'The end must be after the start.');
  if (start < nowMs) return fail('in_the_past', 'The start time must be in the future.');

  // Billing unit is a 24-hour block, rounded UP, minimum one. 25 hours = 2 days. This is the common
  // car-rental convention and matches how a renter thinks about "a day", but it is a product decision:
  // change it here (and the tests) if you prefer hourly or grace-period billing.
  const days = Math.max(1, Math.ceil((end - start) / MS_PER_DAY));
  if (days > MAX_RENTAL_DAYS) return fail('too_long', `Bookings are limited to ${MAX_RENTAL_DAYS} days for now.`);

  if (!Number.isInteger(car.minRentalDays) || car.minRentalDays < 1) return fail('invalid_input', 'This car has invalid rental rules.');
  if (days < car.minRentalDays) return fail('below_min_rental', `This car needs at least ${car.minRentalDays} day(s).`);

  if (!Number.isSafeInteger(car.pricePerDayRupees) || car.pricePerDayRupees <= 0) return fail('invalid_input', 'This car has an invalid price.');
  if (!Number.isSafeInteger(car.securityDepositRupees) || car.securityDepositRupees < 0) return fail('invalid_input', 'This car has an invalid deposit.');
  if (car.kmLimitPerDay !== null && (!Number.isSafeInteger(car.kmLimitPerDay) || car.kmLimitPerDay <= 0)) return fail('invalid_input', 'This car has an invalid km limit.');
  if (!isMoney(deliveryFeePaise)) return fail('invalid_input', 'Invalid delivery fee.');
  if (!isMoney(settings.renterServiceFeePaise)) return fail('invalid_input', 'Invalid service fee setting.');
  if (!['owner', 'renter', 'split'].includes(settings.feeChargedTo)) return fail('invalid_input', 'Invalid fee setting.');

  // fee_percent is numeric(5,2) in the database. Convert to integer basis points (1% = 100 bps) so the
  // rest is pure integer maths. The tolerance check rejects anything with more than 2 decimals rather
  // than silently rounding a setting someone mistyped.
  const bps = Math.round(settings.feePercent * 100);
  if (!Number.isFinite(settings.feePercent) || bps < 0 || bps > 10000 || Math.abs(settings.feePercent * 100 - bps) > 1e-6) {
    return fail('invalid_input', 'Invalid platform fee setting.');
  }

  const pricePaise = car.pricePerDayRupees * 100 * days;
  const depositPaise = car.securityDepositRupees * 100;
  if (!isMoney(pricePaise) || !isMoney(depositPaise)) return fail('invalid_input', 'Amount is too large.');

  // Commission base = rental + delivery. Deliberately EXCLUDES the deposit (it is the renter's money, held
  // and returned, never revenue) and the flat service fee (that is already the platform's own charge).
  const base = pricePaise + deliveryFeePaise;
  const platformFeePaise = percentOf(base, bps);

  // Who bears the commission. With 'split' and an odd number of paise, the OWNER bears the extra paisa:
  // the renter's share rounds DOWN, so a customer-facing charge is never rounded in the platform's favour.
  let renterCommissionPaise: number;
  if (settings.feeChargedTo === 'owner') renterCommissionPaise = 0;
  else if (settings.feeChargedTo === 'renter') renterCommissionPaise = platformFeePaise;
  else renterCommissionPaise = Math.floor(platformFeePaise / 2);
  const ownerCommissionPaise = platformFeePaise - renterCommissionPaise;

  const ownerPayoutPaise = base - ownerCommissionPaise; // >= 0 because bps <= 10000 so commission <= base
  const renterTotalPaise = base + renterCommissionPaise + settings.renterServiceFeePaise;
  const amountDuePaise = renterTotalPaise + depositPaise;
  if (![ownerPayoutPaise, renterTotalPaise, amountDuePaise].every(isMoney)) return fail('invalid_input', 'Amount is too large.');
  const kmLimit = car.kmLimitPerDay === null ? null : car.kmLimitPerDay * days;
  if (kmLimit !== null && (!Number.isSafeInteger(kmLimit) || kmLimit > 2_147_483_647)) return fail('invalid_input', 'Distance allowance is too large.');

  return {
    ok: true,
    quote: {
      days, pricePaise, deliveryFeePaise, platformFeePaise,
      renterServiceFeePaise: settings.renterServiceFeePaise,
      ownerPayoutPaise, depositPaise,
      kmLimit,
      ownerCommissionPaise, renterCommissionPaise, renterTotalPaise, amountDuePaise,
    },
  };
}
