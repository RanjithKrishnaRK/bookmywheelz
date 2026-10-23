import { describe, expect, it } from 'vitest';
import { billedDays, carOf, effectiveStatus, renterTotalPaise, statusHint, STATUS_LABEL } from './booking-view';

const NOW = new Date('2030-01-01T12:00:00Z');
const past = '2030-01-01T11:59:59Z', future = '2030-01-01T12:00:01Z';

describe('effectiveStatus', () => {
  it.each(['requested', 'approved', 'payment_pending'])('%s past its deadline reads as expired', (s) => expect(effectiveStatus(s, past, NOW)).toBe('expired'));
  it.each(['requested', 'approved', 'payment_pending'])('%s before its deadline is unchanged', (s) => expect(effectiveStatus(s, future, NOW)).toBe(s));
  it('a deadline exactly now counts as passed (same rule as the database sweep: expires_at < now)', () => expect(effectiveStatus('requested', NOW.toISOString(), NOW)).toBe('expired'));
  it.each(['confirmed', 'active', 'returned', 'completed', 'cancelled', 'disputed', 'rejected'])('%s is never turned into expired, even with an old deadline', (s) => expect(effectiveStatus(s, past, NOW)).toBe(s));
  it('a missing deadline never expires', () => expect(effectiveStatus('requested', null, NOW)).toBe('requested'));
});

describe('money and days', () => {
  it('renter total = owner payout + platform fee + service fee, for every fee mode', () => {
    // owner pays: base 300000, fee 45000 -> owner 255000, renter pays 300000
    expect(renterTotalPaise({ owner_payout_paise: 255000, platform_fee_paise: 45000, renter_service_fee_paise: 0 })).toBe(300000);
    // renter pays fee on top: owner 300000, fee 45000, service 5000 -> renter pays 350000
    expect(renterTotalPaise({ owner_payout_paise: 300000, platform_fee_paise: 45000, renter_service_fee_paise: 5000 })).toBe(350000);
  });
  it.each([['2030-01-01T10:00:00Z', '2030-01-02T10:00:00Z', 1], ['2030-01-01T10:00:00Z', '2030-01-02T10:00:01Z', 2], ['2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z', 1], ['2030-01-01T10:00:00Z', '2030-01-04T10:00:00Z', 3]])('%s -> %s is %i day(s), as billed', (a, b, n) => expect(billedDays(a, b)).toBe(n));
});

describe('carOf', () => {
  it('handles an embedded object, an embedded array, and a hidden car', () => {
    expect(carOf({ cars: { title: 'A', city: 'x' } })?.title).toBe('A');
    expect(carOf({ cars: [{ title: 'B', city: 'x' }] })?.title).toBe('B');
    expect(carOf({ cars: null })).toBeNull();
    expect(carOf({})).toBeNull();
  });
});

describe('labels and hints', () => {
  it('has a label for every booking status in the database', () => {
    for (const s of ['requested', 'approved', 'rejected', 'expired', 'payment_pending', 'confirmed', 'active', 'returned', 'completed', 'cancelled', 'disputed']) expect(STATUS_LABEL[s], s).toBeTruthy();
  });
  it('tells a renter nothing was charged on a request, a decline, and an expiry', () => {
    for (const s of ['requested', 'rejected', 'expired']) expect(statusHint('renter', s, future)).toMatch(/not (be )?charged/);
  });
  it('is honest that payment is not live on an accepted booking', () => expect(statusHint('renter', 'approved', future)).toMatch(/payment is coming soon/i));
  it('speaks to the owner differently from the renter', () => {
    expect(statusHint('owner', 'requested', future)).toMatch(/^Respond by/);
    expect(statusHint('renter', 'requested', future)).not.toMatch(/^Respond by/);
  });
});
