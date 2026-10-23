// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import OwnerCars from './page';
const m = vi.hoisted(() => ({ getSession: vi.fn(), cars: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/supabase/browser', () => ({ supabaseBrowser: { auth: { getSession: m.getSession }, from: () => ({ select: () => ({ eq: () => ({ order: m.cars }) }) }) } }));
beforeEach(() => {
  vi.resetAllMocks();
  m.getSession.mockResolvedValue({ data: { session: { user: { id: 'owner-1' } } } });
  m.cars.mockResolvedValue({ data: [{ id: 'car-1', title: 'Swift', status: 'approved', instant_book: false }], error: null });
  vi.stubGlobal('fetch', m.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('enables instant booking after the server confirms it', async () => {
  m.fetch.mockResolvedValue({ ok: true, json: async () => ({ car: { instantBook: true } }) });
  render(<OwnerCars />);
  fireEvent.click(await screen.findByRole('button', { name: 'Enable instant booking' }));
  expect(await screen.findByRole('button', { name: 'Require manual approval' })).toBeTruthy();
  expect(m.fetch).toHaveBeenCalledWith('/api/cars/car-1/instant-book', expect.objectContaining({ body: JSON.stringify({ enabled: true }) }));
});
it('keeps manual approval when the server fails', async () => {
  m.fetch.mockRejectedValue(new Error('offline'));
  render(<OwnerCars />);
  fireEvent.click(await screen.findByRole('button', { name: 'Enable instant booking' }));
  expect(await screen.findByText('Could not reach the server. Please try again.')).toBeTruthy();
  expect(screen.getByText('Instant booking: Off')).toBeTruthy();
});
