import { describe, expect, it } from 'vitest';
import { bookingIdSchema, createBookingSchema, respondSchema } from './bookings';

const id = '11111111-1111-4111-8111-111111111111';
const good = { carId: id, startAt: '2030-01-01T10:00:00Z', endAt: '2030-01-04T10:00:00+05:30' };

describe('createBookingSchema', () => {
  it('accepts a car id and two ISO datetimes (with Z or an offset)', () => expect(createBookingSchema.safeParse(good).success).toBe(true));
  // The money safeguard: any attempt to smuggle in an amount or identity is a hard rejection, not a silent ignore.
  it.each(['price', 'price_paise', 'pricePaise', 'ownerPayoutPaise', 'platformFeePaise', 'amount', 'renterId', 'renter_id', 'ownerId', 'status', 'deliveryFeePaise', 'depositPaise'])(
    'rejects a client-supplied "%s"', (key) => expect(createBookingSchema.safeParse({ ...good, [key]: 1 }).success).toBe(false));
  it.each([
    ['missing carId', { startAt: good.startAt, endAt: good.endAt }],
    ['non-uuid carId', { ...good, carId: '1; drop table cars' }],
    ['date without time', { ...good, startAt: '2030-01-01' }],
    ['date without timezone', { ...good, startAt: '2030-01-01T10:00:00' }],
    ['numeric timestamp', { ...good, startAt: 1893492000000 }],
    ['garbage date', { ...good, endAt: 'tomorrow' }],
    ['null body', null], ['array body', []], ['string body', 'x'],
  ])('rejects %s', (_l, input) => expect(createBookingSchema.safeParse(input).success).toBe(false));
});

describe('respondSchema and id', () => {
  it('accepts only approve or reject', () => {
    expect(respondSchema.safeParse({ decision: 'approve' }).success).toBe(true);
    expect(respondSchema.safeParse({ decision: 'reject' }).success).toBe(true);
    for (const d of ['APPROVE', 'confirm', '', null, 1]) expect(respondSchema.safeParse({ decision: d }).success).toBe(false);
    expect(respondSchema.safeParse({ decision: 'approve', status: 'confirmed' }).success).toBe(false);
  });
  it('booking id must be a uuid', () => {
    expect(bookingIdSchema.safeParse(id).success).toBe(true);
    for (const v of ['1', "' or 1=1 --", '../etc/passwd', '']) expect(bookingIdSchema.safeParse(v).success).toBe(false);
  });
});
