// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import BookingWidget, { type BookingCar } from './BookingWidget';

// Supabase is replaced by controllable fakes: these tests are about what the widget DOES with the data, not about Supabase.
const m = vi.hoisted(() => ({ getSession: vi.fn(), settings: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase/browser', () => ({
  supabaseBrowser: { auth: { getSession: m.getSession }, from: () => ({ select: () => ({ single: m.settings }) }), rpc: m.rpc },
}));

const CAR: BookingCar = { id: '11111111-1111-4111-8111-111111111111', owner_id: 'owner-1', price_per_day: 1000, security_deposit: 2000, min_rental_days: 1, km_limit_per_day: 200, instant_book: false };
type Setup = { uid?: string | null; fee_charged_to?: string; service?: number; ranges?: { start_at: string; end_at: string }[]; settingsError?: boolean; car?: Partial<BookingCar> };

function setup(o: Setup = {}) {
  m.getSession.mockResolvedValue({ data: { session: o.uid === null ? null : { user: { id: o.uid ?? 'renter-1' } } } });
  m.settings.mockResolvedValue(o.settingsError ? { data: null, error: { message: 'boom' } }
    : { data: { fee_percent: 15, fee_charged_to: o.fee_charged_to ?? 'owner', renter_service_fee_paise: o.service ?? 0 }, error: null });
  m.rpc.mockResolvedValue({ data: o.ranges ?? [], error: null });
  return render(<BookingWidget car={{ ...CAR, ...o.car }} />);
}
const pick = (pickup: string, ret: string) => {
  fireEvent.change(screen.getByLabelText('Pickup'), { target: { value: pickup } });
  fireEvent.change(screen.getByLabelText('Return'), { target: { value: ret } });
};
const loaded = () => waitFor(() => expect(m.rpc).toHaveBeenCalled()).then(() => waitFor(() => expect(screen.getByText(/Pick pickup and return/)).toBeTruthy()));
const button = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const THREE_DAYS: [string, string] = ['2030-03-10T10:00', '2030-03-13T10:00'];

beforeEach(() => { vi.restoreAllMocks(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); m.getSession.mockReset(); m.settings.mockReset(); m.rpc.mockReset(); });

describe('price preview', () => {
  it('shows the day rate and asks for dates before any dates are picked', async () => {
    setup(); await loaded();
    expect(screen.getByRole('heading', { name: /₹1,000/ })).toBeTruthy();
    expect(button(/request to book/i).disabled).toBe(true);
  });
  it('previews 3 days: rental, trip total, refundable deposit and km allowance', async () => {
    setup(); await loaded(); pick(...THREE_DAYS);
    const sum = within(await screen.findByLabelText('Price breakdown'));
    expect(sum.getByText('3 days × ₹1,000')).toBeTruthy();
    expect(sum.getByText('Trip total').nextSibling?.textContent).toBe('₹3,000');
    expect(sum.getByText('Refundable deposit').nextSibling?.textContent).toBe('₹2,000');
    expect(sum.getByText('600 km')).toBeTruthy();
    expect(button(/request to book/i).disabled).toBe(false);
  });
  it('owner-pays mode shows no platform fee line (the renter does not pay it)', async () => {
    setup({ fee_charged_to: 'owner' }); await loaded(); pick(...THREE_DAYS);
    const sum = within(await screen.findByLabelText('Price breakdown'));
    expect(sum.queryByText('Platform fee')).toBeNull();
  });
  it('renter-pays mode adds the 15% platform fee to the total; service fee shows too', async () => {
    setup({ fee_charged_to: 'renter', service: 5000 }); await loaded(); pick(...THREE_DAYS);
    const sum = within(await screen.findByLabelText('Price breakdown'));
    expect(sum.getByText('Platform fee').nextSibling?.textContent).toBe('₹450');
    expect(sum.getByText('Service fee').nextSibling?.textContent).toBe('₹50');
    expect(sum.getByText('Trip total').nextSibling?.textContent).toBe('₹3,500');
  });
  it('unlimited-km cars say so; no deposit row when there is no deposit', async () => {
    setup({ car: { km_limit_per_day: null, security_deposit: 0 } }); await loaded(); pick(...THREE_DAYS);
    const sum = within(await screen.findByLabelText('Price breakdown'));
    expect(sum.getByText('Unlimited')).toBeTruthy();
    expect(sum.queryByText('Refundable deposit')).toBeNull();
  });
});

describe('date rules', () => {
  it('explains a booking shorter than the car minimum and blocks submitting', async () => {
    setup({ car: { min_rental_days: 3 } }); await loaded(); pick('2030-03-10T10:00', '2030-03-11T10:00');
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 3 day/);
    expect(button(/request to book/i).disabled).toBe(true);
  });
  it('rejects a start in the past', async () => {
    setup(); await loaded(); pick('2001-01-01T10:00', '2001-01-03T10:00');
    expect((await screen.findByRole('alert')).textContent).toMatch(/future/);
    expect(button(/request to book/i).disabled).toBe(true);
  });
  it('rejects a return before the pickup', async () => {
    setup(); await loaded(); pick('2030-03-13T10:00', '2030-03-10T10:00');
    expect((await screen.findByRole('alert')).textContent).toMatch(/after the start/);
  });
  it('rejects an over-long booking', async () => {
    setup(); await loaded(); pick('2030-03-01T10:00', '2030-06-01T10:00');
    expect((await screen.findByRole('alert')).textContent).toMatch(/30 days/);
  });
});

describe('availability', () => {
  const range = { start_at: '2030-03-11T00:00:00Z', end_at: '2030-03-12T00:00:00Z' };
  it('lists unavailable ranges', async () => {
    setup({ ranges: [range] }); await loaded();
    expect(screen.getByRole('heading', { name: 'Not available' })).toBeTruthy();
  });
  it('blocks dates that overlap an unavailable range', async () => {
    setup({ ranges: [range] }); await loaded(); pick(...THREE_DAYS);
    expect((await screen.findByText(/not available for those dates/)).getAttribute('role')).toBe('alert');
    expect(button(/request to book/i).disabled).toBe(true);
  });
  it('allows a trip that starts exactly when an unavailable range ends (back-to-back)', async () => {
    const r = { start_at: new Date(2030, 2, 8, 10).toISOString(), end_at: new Date(2030, 2, 10, 10).toISOString() };
    setup({ ranges: [r] }); await loaded(); pick(...THREE_DAYS);
    await screen.findByLabelText('Price breakdown');
    expect(screen.queryByText(/not available for those dates/)).toBeNull();
    expect(button(/request to book/i).disabled).toBe(false);
  });
});

describe('who is looking', () => {
  it('signed-out visitors see the preview but get a sign-in link that returns them to this car', async () => {
    setup({ uid: null }); await loaded(); pick(...THREE_DAYS);
    await screen.findByLabelText('Price breakdown');
    const link = screen.getByRole('link', { name: /sign in to book/i }) as HTMLAnchorElement;
    expect(new URL(link.href, 'http://x').searchParams.get('next')).toBe(`/cars/${CAR.id}`);
    expect(screen.queryByRole('button', { name: /request to book/i })).toBeNull();
  });
  it("the car's owner sees a notice, not a booking form", async () => {
    setup({ uid: 'owner-1' });
    expect(await screen.findByText(/cannot book your own car/i)).toBeTruthy();
    expect(screen.queryByLabelText('Pickup')).toBeNull();
  });
});

describe('submitting', () => {
  const respond = (status: number, body: unknown) => (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('sends ONLY the car id and two ISO dates: no price, fee, or user id', async () => {
    respond(201, { booking: { status: 'requested', expiresAt: '2030-03-09T22:00:00Z' } });
    setup(); await loaded(); pick(...THREE_DAYS);
    fireEvent.click(button(/request to book/i));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe('/api/bookings');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(Object.keys(body).sort()).toEqual(['carId', 'endAt', 'startAt']);
    expect(body.carId).toBe(CAR.id);
    expect(body.startAt).toBe(new Date(THREE_DAYS[0]).toISOString());
    expect(body.endAt).toBe(new Date(THREE_DAYS[1]).toISOString());
  });
  it('a request shows a calm success message that says nothing was charged', async () => {
    respond(201, { booking: { status: 'requested', expiresAt: '2030-03-09T22:00:00Z' } });
    setup(); await loaded(); pick(...THREE_DAYS); fireEvent.click(button(/request to book/i));
    const ok = await screen.findByRole('status');
    expect(ok.textContent).toMatch(/Request sent/); expect(ok.textContent).toMatch(/not be charged/);
  });
  it('an instant-book reservation explains the hold and that payment is not live yet', async () => {
    respond(201, { booking: { status: 'approved', expiresAt: '2030-03-09T22:30:00Z' } });
    setup({ car: { instant_book: true } }); await loaded(); pick(...THREE_DAYS); fireEvent.click(button(/book instantly/i));
    const ok = await screen.findByRole('status');
    expect(ok.textContent).toMatch(/held for you/); expect(ok.textContent).toMatch(/payment is coming soon/i);
  });
  it.each([
    [409, 'dates_unavailable', 'This car is not available for those dates.'],
    [429, 'rate_limited', 'Too many booking requests. Please try again later.'],
    [401, 'unauthenticated', 'Please sign in to book a car.'],
    [403, 'own_car', 'You cannot book your own car.'],
  ])('shows the server message for a %i (%s) as an alert, and re-enables the button', async (status, code, message) => {
    respond(status, { error: { code, message } });
    setup(); await loaded(); pick(...THREE_DAYS); fireEvent.click(button(/request to book/i));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    await waitFor(() => expect(button(/request to book/i).disabled).toBe(false));
  });
  it('survives a network failure with a clear message', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('Failed to fetch'));
    setup(); await loaded(); pick(...THREE_DAYS); fireEvent.click(button(/request to book/i));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not reach the server/i);
  });
  it('survives a non-JSON error response (e.g. a proxy 502 page)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }));
    setup(); await loaded(); pick(...THREE_DAYS); fireEvent.click(button(/request to book/i));
    expect((await screen.findByRole('alert')).textContent).toMatch(/something went wrong/i);
  });
  it('ignores a second click while the first request is still in flight (no double booking requests)', async () => {
    let finish!: (r: Response) => void;
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise<Response>((r) => { finish = r; }));
    setup(); await loaded(); pick(...THREE_DAYS);
    const btn = button(/request to book/i);
    fireEvent.click(btn); fireEvent.click(btn); fireEvent.click(btn);
    await waitFor(() => expect(button(/sending/i).disabled).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(1);
    finish(new Response(JSON.stringify({ booking: { status: 'requested', expiresAt: '2030-03-09T22:00:00Z' } }), { status: 201 }));
    await screen.findByRole('status');
  });
  it('changing a date clears an old message', async () => {
    respond(409, { error: { code: 'dates_unavailable', message: 'This car is not available for those dates.' } });
    setup(); await loaded(); pick(...THREE_DAYS); fireEvent.click(button(/request to book/i));
    await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText('Return'), { target: { value: '2030-03-14T10:00' } });
    expect(screen.queryByText('This car is not available for those dates.')).toBeNull();
  });
});

describe('load failures', () => {
  it('shows an error and keeps the button disabled when pricing settings cannot load', async () => {
    setup({ settingsError: true });
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load pricing/i);
    pick(...THREE_DAYS);
    expect(button(/request to book/i).disabled).toBe(true);
  });
});
