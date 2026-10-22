import { describe, expect, it } from 'vitest';
import { calculateQuote, MAX_RENTAL_DAYS, type FeeChargedTo, type PricingInput, type Quote } from './pricing';

const NOW = new Date('2030-01-01T00:00:00Z');
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

const base = (over: Partial<PricingInput> & { fee?: number; to?: FeeChargedTo; service?: number; perDay?: number; deposit?: number; km?: number | null; minDays?: number } = {}): PricingInput => ({
  car: { pricePerDayRupees: over.perDay ?? 1000, securityDepositRupees: over.deposit ?? 0, minRentalDays: over.minDays ?? 1, kmLimitPerDay: over.km === undefined ? null : over.km },
  settings: { feePercent: over.fee ?? 15, feeChargedTo: over.to ?? 'owner', renterServiceFeePaise: over.service ?? 0 },
  startAt: over.startAt ?? at(24), endAt: over.endAt ?? at(24 * 4), now: NOW, deliveryFeePaise: over.deliveryFeePaise,
});
const ok = (i: PricingInput): Quote => { const r = calculateQuote(i); if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`); return r.quote; };
const err = (i: PricingInput) => { const r = calculateQuote(i); if (r.ok) throw new Error('expected an error but got a quote'); return r.code; };

describe('the spec example', () => {
  it('Rs 3,000 at 15% => platform earns Rs 450, owner receives Rs 2,550', () => {
    const q = ok(base({ perDay: 1000 })); // 3 days x Rs 1,000
    expect(q.pricePaise).toBe(300_000);
    expect(q.platformFeePaise).toBe(45_000);
    expect(q.ownerPayoutPaise).toBe(255_000);
    expect(q.renterTotalPaise).toBe(300_000); // owner-pays mode: renter pays just the price
  });
});

describe('billing days', () => {
  const days = (hours: number) => ok(base({ startAt: at(24), endAt: at(24 + hours) })).days;
  it.each([[1, 1], [24, 1], [24.0003, 2], [25, 2], [48, 2], [72, 3], [72.5, 4]])('%s hours => %s day(s)', (h, d) => expect(days(h)).toBe(d));
  it('a 1-millisecond overrun costs a whole extra day (documented rule)', () => {
    const exact = ok(base({ startAt: at(24), endAt: at(48) }));                           // exactly 24h
    const over = ok(base({ startAt: at(24), endAt: new Date(at(48).getTime() + 1) }));    // 24h + 1ms
    expect([exact.days, over.days]).toEqual([1, 2]);
  });
});

describe('rounding', () => {
  // Rs 1/day + 10 paise delivery = 110 paise; 15% = 16.5 paise => half rounds UP to 17.
  it('rounds a half-paisa UP', () => {
    const q = ok(base({ perDay: 1, deliveryFeePaise: 10, startAt: at(24), endAt: at(48) }));
    expect(q.platformFeePaise).toBe(17);
    expect(q.ownerPayoutPaise).toBe(93);
  });
  it('rounds below-half DOWN (110 paise at 10% = 11.0; 111 paise at 15% = 16.65 => 17; 104 at 15% = 15.6 => 16; 103 at 15% = 15.45 => 15)', () => {
    const f = (delivery: number) => ok(base({ perDay: 1, deliveryFeePaise: delivery - 100, startAt: at(24), endAt: at(48) })).platformFeePaise;
    expect(f(103)).toBe(15); expect(f(104)).toBe(16);
  });
  it('accepts EVERY 2-decimal percentage from 0.00 to 100.00 and matches exact integer maths', () => {
    for (let bps = 0; bps <= 10000; bps++) {
      const q = ok(base({ fee: bps / 100, perDay: 7, startAt: at(24), endAt: at(48) })); // 700 paise
      expect(q.platformFeePaise).toBe(Math.floor((700 * bps + 5000) / 10000));
    }
  });
});

describe('who pays the commission', () => {
  // base = 110 paise, fee = 17 paise (odd, so the split is interesting)
  const mk = (to: FeeChargedTo, service = 0) => ok(base({ to, perDay: 1, deliveryFeePaise: 10, service, startAt: at(24), endAt: at(48) }));
  it('owner: owner nets base - fee, renter pays base', () => {
    const q = mk('owner'); expect([q.ownerPayoutPaise, q.renterTotalPaise, q.renterCommissionPaise]).toEqual([93, 110, 0]);
  });
  it('renter: owner nets the full base, renter pays base + fee', () => {
    const q = mk('renter'); expect([q.ownerPayoutPaise, q.renterTotalPaise, q.ownerCommissionPaise]).toEqual([110, 127, 0]);
  });
  it('split with an odd fee: renter share rounds DOWN, owner bears the extra paisa', () => {
    const q = mk('split'); expect([q.renterCommissionPaise, q.ownerCommissionPaise]).toEqual([8, 9]);
    expect(q.ownerPayoutPaise).toBe(101); expect(q.renterTotalPaise).toBe(118);
  });
  it('the flat service fee is added for the renter and is NOT commissioned', () => {
    const q = mk('owner', 5000);
    expect(q.platformFeePaise).toBe(17);       // unchanged by the service fee
    expect(q.renterTotalPaise).toBe(110 + 5000);
  });
});

describe('deposit, delivery and km', () => {
  it('deposit is charged at checkout but is never part of the commission base or owner payout', () => {
    const q = ok(base({ deposit: 5000 }));
    expect(q.depositPaise).toBe(500_000);
    expect(q.platformFeePaise).toBe(45_000);
    expect(q.ownerPayoutPaise).toBe(255_000);
    expect(q.amountDuePaise).toBe(q.renterTotalPaise + 500_000);
  });
  it('delivery is part of the commission base', () => {
    const q = ok(base({ deliveryFeePaise: 20_000 })); // 3000 + 200 = 3200 -> 15% = 480
    expect(q.platformFeePaise).toBe(48_000);
    expect(q.ownerPayoutPaise).toBe(320_000 - 48_000);
  });
  it('km limit is the per-day limit times billed days; unlimited stays null', () => {
    expect(ok(base({ km: 200 })).kmLimit).toBe(600);
    expect(ok(base({ km: null })).kmLimit).toBeNull();
  });
});

describe('rejects bad or hostile input', () => {
  it.each([
    ['end before start', base({ startAt: at(48), endAt: at(24) }), 'invalid_dates'],
    ['end equals start', base({ startAt: at(24), endAt: at(24) }), 'invalid_dates'],
    ['invalid date object', base({ startAt: new Date('nope') }), 'invalid_dates'],
    ['start in the past', base({ startAt: at(-1), endAt: at(24) }), 'in_the_past'],
    ['longer than the cap', base({ startAt: at(24), endAt: at(24 + 24 * (MAX_RENTAL_DAYS + 1)) }), 'too_long'],
    ['below the car minimum', base({ minDays: 3, startAt: at(24), endAt: at(48) }), 'below_min_rental'],
    ['negative delivery fee', base({ deliveryFeePaise: -1 }), 'invalid_input'],
    ['fractional delivery fee', base({ deliveryFeePaise: 10.5 }), 'invalid_input'],
    ['NaN delivery fee', base({ deliveryFeePaise: NaN }), 'invalid_input'],
    ['Infinity delivery fee', base({ deliveryFeePaise: Infinity }), 'invalid_input'],
    ['absurdly large delivery fee', base({ deliveryFeePaise: 1e12 }), 'invalid_input'],
    ['zero price', base({ perDay: 0 }), 'invalid_input'],
    ['fractional price', base({ perDay: 99.5 }), 'invalid_input'],
    ['negative deposit', base({ deposit: -1 }), 'invalid_input'],
    ['fee over 100%', base({ fee: 100.01 }), 'invalid_input'],
    ['negative fee', base({ fee: -1 }), 'invalid_input'],
    ['fee with 3 decimals', base({ fee: 15.005 }), 'invalid_input'],
    ['NaN fee', base({ fee: NaN }), 'invalid_input'],
    ['unknown fee mode', base({ to: 'nobody' as FeeChargedTo }), 'invalid_input'],
    ['negative service fee', base({ service: -100 }), 'invalid_input'],
    ['zero km limit', base({ km: 0 }), 'invalid_input'],
    ['price so big the amount overflows the cap', base({ perDay: 1e9 }), 'invalid_input'],
  ] as const)('%s', (_label, input, code) => expect(err(input)).toBe(code));

  it('exactly the maximum number of days is allowed', () => {
    expect(ok(base({ startAt: at(24), endAt: at(24 + 24 * MAX_RENTAL_DAYS) })).days).toBe(MAX_RENTAL_DAYS);
  });
  it('starting exactly now is allowed', () => {
    expect(ok(base({ startAt: at(0), endAt: at(24) })).days).toBe(1);
  });
});

// Property tests: generate thousands of random but VALID bookings and check the invariants that must
// hold for EVERY one. A hand-written example can look right while a rare input leaks a paisa; this is
// what finds that. Seeded PRNG (mulberry32) so a failure is reproducible, not flaky.
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const isPaise = (n: number) => Number.isSafeInteger(n) && n >= 0;

describe('invariants over random valid bookings', () => {
  it('hold for 20,000 cases across all three fee modes', () => {
    const r = rng(20261022);
    const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
    const modes: FeeChargedTo[] = ['owner', 'renter', 'split'];
    for (let n = 0; n < 20_000; n++) {
      const to = modes[int(0, 2)];
      const startH = int(0, 500), durH = int(1, MAX_RENTAL_DAYS * 24);
      const service = int(0, 100_000), delivery = int(0, 5_000_000);
      const input: PricingInput = {
        car: { pricePerDayRupees: int(1, 200_000), securityDepositRupees: int(0, 500_000), minRentalDays: 1, kmLimitPerDay: r() < 0.5 ? null : int(1, 1000) },
        settings: { feePercent: int(0, 10_000) / 100, feeChargedTo: to, renterServiceFeePaise: service },
        startAt: at(startH), endAt: at(startH + durH), now: NOW, deliveryFeePaise: delivery,
      };
      const q = ok(input);
      const ctx = JSON.stringify(input);
      const b = q.pricePaise + q.deliveryFeePaise;

      // Every amount is an exact, non-negative integer (no float leakage, nothing negative).
      for (const v of [q.pricePaise, q.deliveryFeePaise, q.platformFeePaise, q.ownerPayoutPaise, q.renterTotalPaise, q.amountDuePaise, q.depositPaise, q.ownerCommissionPaise, q.renterCommissionPaise]) {
        if (!isPaise(v)) throw new Error('non-integer or negative amount for ' + ctx);
      }
      // THE MONEY IDENTITY: not one paisa is created or lost, in any fee mode.
      expect(q.renterTotalPaise, ctx).toBe(q.ownerPayoutPaise + q.platformFeePaise + q.renterServiceFeePaise);
      expect(q.ownerCommissionPaise + q.renterCommissionPaise, ctx).toBe(q.platformFeePaise);
      expect(q.ownerPayoutPaise, ctx).toBe(b - q.ownerCommissionPaise);
      expect(q.platformFeePaise, ctx).toBeLessThanOrEqual(b);   // commission can never exceed the booking
      expect(q.amountDuePaise, ctx).toBe(q.renterTotalPaise + q.depositPaise);
      expect(q.days, ctx).toBe(Math.ceil(durH / 24));
      // Mode-specific shape.
      if (to === 'owner') expect(q.renterTotalPaise, ctx).toBe(b + service);
      if (to === 'renter') expect(q.ownerPayoutPaise, ctx).toBe(b);
      if (to === 'split') { expect(q.ownerCommissionPaise - q.renterCommissionPaise, ctx).toBeGreaterThanOrEqual(0); expect(q.ownerCommissionPaise - q.renterCommissionPaise, ctx).toBeLessThanOrEqual(1); }
    }
  });
});

describe('hostile input fuzz', () => {
  it('never throws, and any quote it does return is fully valid, for 20,000 garbage inputs', () => {
    const r = rng(7);
    const junk = [NaN, Infinity, -Infinity, -1, 0, 0.5, 1e300, -1e300, Number.MAX_SAFE_INTEGER, 2 ** 53, null, undefined, '15', '', {}, [], true];
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    const maybe = (good: unknown) => (r() < 0.6 ? good : pick(junk));
    for (let n = 0; n < 20_000; n++) {
      const input = {
        car: { pricePerDayRupees: maybe(1000), securityDepositRupees: maybe(0), minRentalDays: maybe(1), kmLimitPerDay: maybe(null) },
        settings: { feePercent: maybe(15), feeChargedTo: maybe('owner'), renterServiceFeePaise: maybe(0) },
        startAt: maybe(at(24)), endAt: maybe(at(48)), now: maybe(NOW), deliveryFeePaise: maybe(0),
      } as unknown as PricingInput;
      let res;
      try { res = calculateQuote(input); } catch (e) { throw new Error('threw on ' + JSON.stringify(input) + ': ' + e); }
      if (res.ok) for (const v of [res.quote.pricePaise, res.quote.platformFeePaise, res.quote.ownerPayoutPaise, res.quote.renterTotalPaise, res.quote.amountDuePaise]) {
        if (!isPaise(v)) throw new Error('invalid money in an ok quote for ' + JSON.stringify(input));
      }
    }
  });
});
