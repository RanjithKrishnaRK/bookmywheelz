// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OwnerBookings from './page';

const m = vi.hoisted(() => ({ getSession: vi.fn(), query: vi.fn(), eq: vi.fn() }));
vi.mock('@/lib/supabase/browser', () => ({ supabaseBrowser: {
  auth: { getSession: m.getSession },
  from: () => ({ select: () => ({ eq: (...args: unknown[]) => { m.eq(...args); return { order: () => ({ limit: m.query }) }; } }) }),
} }));
const booking = (over = {}) => ({
  id: 'booking-1', car_id: 'car-1', status: 'requested', created_at: '2030-01-01T00:00:00Z',
  start_at: '2099-03-10T10:00:00Z', end_at: '2099-03-13T10:00:00Z', expires_at: '2099-03-09T10:00:00Z',
  price_paise: 300000, delivery_fee_paise: 0, platform_fee_paise: 45000, renter_service_fee_paise: 0,
  owner_payout_paise: 255000, deposit_paise: 200000, instant_book: false,
  cars: { title: 'Swift VXi', city: 'Hyderabad' }, ...over,
});
beforeEach(() => {
  vi.resetAllMocks();
  m.getSession.mockResolvedValue({ data: { session: { user: { id: 'owner-1' } } } });
  m.query.mockResolvedValue({ data: [booking()], error: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('filters requests by owner and displays their payout', async () => {
  render(<OwnerBookings />);
  expect(await screen.findByText('Swift VXi')).toBeTruthy();
  expect(m.eq).toHaveBeenCalledWith('owner_id', 'owner-1');
  expect(screen.getByText('₹2,550')).toBeTruthy();
});
it.each(['Accept request', 'Decline request'])('sends %s through the authenticated endpoint and updates the card', async label => {
  const status = label === 'Accept request' ? 'approved' : 'rejected';
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ booking: { status, expiresAt: '2099-03-09T10:00:00Z' } }) });
  vi.stubGlobal('fetch', fetcher);
  render(<OwnerBookings />);
  fireEvent.click(await screen.findByRole('button', { name: label }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Accept request' })).toBeNull());
  expect(fetcher).toHaveBeenCalledWith('/api/bookings/booking-1/respond', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ decision: status === 'approved' ? 'approve' : 'reject' }),
  }));
  expect(screen.getByText(status === 'approved' ? 'Accepted' : 'Declined')).toBeTruthy();
});
it('does not offer actions on expired requests', async () => {
  m.query.mockResolvedValue({ data: [booking({ expires_at: '2000-01-01T00:00:00Z' })], error: null });
  render(<OwnerBookings />);
  expect(await screen.findByText('Expired')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Accept request' })).toBeNull();
});
it('keeps a request actionable after a network failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  render(<OwnerBookings />);
  fireEvent.click(await screen.findByRole('button', { name: 'Accept request' }));
  expect(await screen.findByText(/Could not reach the server/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Accept request' }) as HTMLButtonElement).disabled).toBe(false);
});
it('asks signed out owners to sign in without loading bookings', async () => {
  m.getSession.mockResolvedValue({ data: { session: null } });
  render(<OwnerBookings />);
  expect(await screen.findByText('Sign in to see requests')).toBeTruthy();
  expect(m.query).not.toHaveBeenCalled();
});
