// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import MyTrips from './page';

// Supabase is a controllable fake: these tests are about what the page does with the rows it gets.
const m = vi.hoisted(() => ({ getSession: vi.fn(), query: vi.fn(), eq: vi.fn() }));
vi.mock('@/lib/supabase/browser', () => ({
  supabaseBrowser: { auth: { getSession: m.getSession }, from: () => ({ select: () => ({ eq: (...a: unknown[]) => { m.eq(...a); return { order: () => ({ limit: m.query }) }; } }) }) },
}));

const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const row = (over: Record<string, unknown> = {}) => ({
  id: 'b1', car_id: 'c1', status: 'requested', created_at: iso(-HOUR),
  start_at: '2030-03-10T10:00:00Z', end_at: '2030-03-13T10:00:00Z', expires_at: iso(6 * HOUR), instant_book: false,
  price_paise: 300000, delivery_fee_paise: 0, platform_fee_paise: 45000, renter_service_fee_paise: 0, owner_payout_paise: 255000, deposit_paise: 200000,
  cars: { title: 'Swift VXi', city: 'Hyderabad' }, ...over,
});
const signedIn = () => m.getSession.mockResolvedValue({ data: { session: { user: { id: 'renter-1' } } } });

beforeEach(() => { m.getSession.mockReset(); m.query.mockReset(); m.eq.mockReset(); });
afterEach(cleanup);

describe('My trips', () => {
  it('shows a loading state, then the trips', async () => {
    signedIn(); m.query.mockResolvedValue({ data: [row()], error: null });
    render(<MyTrips />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'My trips' })).toBeTruthy();
    expect(await screen.findByText('Swift VXi')).toBeTruthy();
  });
  it('asks signed-out visitors to sign in, and returns them here afterwards', async () => {
    m.getSession.mockResolvedValue({ data: { session: null } });
    render(<MyTrips />);
    const link = (await screen.findByRole('link', { name: 'Sign in' })) as HTMLAnchorElement;
    expect(new URL(link.href, 'http://x').searchParams.get('next')).toBe('/renter/bookings');
    expect(m.query).not.toHaveBeenCalled(); // never queries without a session
  });
  it('filters by the signed-in renter', async () => {
    signedIn(); m.query.mockResolvedValue({ data: [], error: null });
    render(<MyTrips />); await screen.findByText('No trips yet');
    expect(m.eq).toHaveBeenCalledWith('renter_id', 'renter-1');
  });
  it('has a friendly empty state with a way forward', async () => {
    signedIn(); m.query.mockResolvedValue({ data: [], error: null });
    render(<MyTrips />);
    expect(await screen.findByText('No trips yet')).toBeTruthy();
    expect((screen.getByRole('link', { name: 'Find a car' }) as HTMLAnchorElement).getAttribute('href')).toBe('/search');
  });
  it('shows an error with a working retry', async () => {
    signedIn(); m.query.mockResolvedValueOnce({ data: null, error: { message: 'boom' } }).mockResolvedValueOnce({ data: [row()], error: null });
    render(<MyTrips />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load/i);
    expect(screen.queryByText(/boom/)).toBeNull(); // never show raw database messages
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Swift VXi')).toBeTruthy();
    expect(m.query).toHaveBeenCalledTimes(2);
  });
  it('a renter sees what THEY pay: trip total from the identity, plus the refundable deposit', async () => {
    signedIn(); m.query.mockResolvedValue({ data: [row()], error: null });
    render(<MyTrips />);
    const card = within(await screen.findByRole('article'));
    expect(card.getByText('₹3,000')).toBeTruthy();                       // 255000 + 45000 + 0
    expect(card.getByText(/plus ₹2,000 refundable deposit/)).toBeTruthy();
    expect(card.getByText(/3 days/)).toBeTruthy();
    expect(card.queryByText(/You receive/)).toBeNull();
  });
  it('a request waiting on the owner says nobody has been charged', async () => {
    signedIn(); m.query.mockResolvedValue({ data: [row()], error: null });
    render(<MyTrips />);
    const card = within(await screen.findByRole('article'));
    expect(card.getByText('Waiting for owner')).toBeTruthy();
    expect(card.getByText(/not be charged yet/)).toBeTruthy();
  });
  it('a request past its deadline reads as EXPIRED even though the database row still says requested', async () => {
    signedIn(); m.query.mockResolvedValue({ data: [row({ expires_at: iso(-HOUR) })], error: null });
    render(<MyTrips />);
    const card = within(await screen.findByRole('article'));
    expect(card.getByText('Expired')).toBeTruthy();
    expect(card.queryByText('Waiting for owner')).toBeNull();
    expect(card.getByText(/ran out of time/)).toBeTruthy();
  });
  it('shows an accepted booking honestly: held, payment not live yet', async () => {
    signedIn(); m.query.mockResolvedValue({ data: [row({ status: 'approved' })], error: null });
    render(<MyTrips />);
    const card = within(await screen.findByRole('article'));
    expect(card.getByText('Accepted')).toBeTruthy();
    expect(card.getByText(/payment is coming soon/i)).toBeTruthy();
  });
  it('links to the car when visible, and copes when the car is no longer listed', async () => {
    signedIn(); m.query.mockResolvedValue({ data: [row(), row({ id: 'b2', cars: null })], error: null });
    render(<MyTrips />);
    await screen.findAllByRole('article');
    expect((screen.getByRole('link', { name: 'Swift VXi' }) as HTMLAnchorElement).getAttribute('href')).toBe('/cars/c1');
    expect(screen.getByText('Car no longer listed')).toBeTruthy();
  });
  it('copes with the car embedded as an array', async () => {
    signedIn(); m.query.mockResolvedValue({ data: [row({ cars: [{ title: 'Array Car', city: 'Pune' }] })], error: null });
    render(<MyTrips />);
    expect(await screen.findByText('Array Car')).toBeTruthy();
  });
});
