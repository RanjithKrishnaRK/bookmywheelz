// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AvailabilityPage from './page';

const m = vi.hoisted(() => ({ getSession: vi.fn(), car: vi.fn(), blocks: vi.fn(), insert: vi.fn(), save: vi.fn(), remove: vi.fn(), eq: vi.fn() }));
vi.mock('@/lib/supabase/browser', () => ({ supabaseBrowser: {
  auth: { getSession: m.getSession },
  from: (table: string) => {
    const chain = {
      select: () => chain,
      eq: (...args: unknown[]) => { m.eq(...args); return chain; },
      maybeSingle: m.car, order: m.blocks,
    };
    if (table === 'cars') return chain;
    return { ...chain,
      insert: (data: unknown) => { m.insert(data); return { select: m.save }; },
      delete: () => { const removal = { eq: (...args: unknown[]) => { m.eq(...args); return removal; }, select: m.remove }; return removal; },
    };
  },
} }));
beforeEach(() => {
  vi.resetAllMocks();
  m.getSession.mockResolvedValue({ data: { session: { user: { id: 'owner-1' } } } });
  m.car.mockResolvedValue({ data: { title: 'Swift VXi' }, error: null });
  m.blocks.mockResolvedValue({ data: [], error: null });
  m.save.mockResolvedValue({ data: [{ id: 'block-1' }], error: null });
});
afterEach(cleanup);
const show = async () => { await act(async () => { render(<AvailabilityPage params={Promise.resolve({ id: 'car-1' })} />); }); };
it('loads only the signed in owner car', async () => {
  await show(); expect(await screen.findByText('Swift VXi')).toBeTruthy();
  expect(m.eq).toHaveBeenCalledWith('owner_id', 'owner-1');
});
it('saves owner blocks as UTC instants and refreshes', async () => {
  await show(); await screen.findByText('Swift VXi');
  fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2099-03-01T10:00' } });
  fireEvent.change(screen.getByLabelText('End'), { target: { value: '2099-03-02T10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Block dates' }));
  expect(await screen.findByText('Dates blocked.')).toBeTruthy();
  expect(m.insert).toHaveBeenCalledWith({ car_id: 'car-1', reason: 'owner_blocked', start_at: new Date('2099-03-01T10:00').toISOString(), end_at: new Date('2099-03-02T10:00').toISOString() });
  await waitFor(() => expect(m.blocks).toHaveBeenCalledTimes(2));
});
it('reports booking conflicts without exposing raw database errors', async () => {
  m.save.mockResolvedValue({ data: null, error: { code: '23P01', message: 'private SQL' } });
  await show(); await screen.findByText('Swift VXi');
  fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2099-03-01T10:00' } });
  fireEvent.change(screen.getByLabelText('End'), { target: { value: '2099-03-02T10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Block dates' }));
  expect(await screen.findByText('These dates overlap an existing booking.')).toBeTruthy();
  expect(screen.queryByText('private SQL')).toBeNull();
});
it('removes only owner blocks', async () => {
  m.blocks.mockResolvedValue({ data: [{ id: 'block-1', reason: 'owner_blocked', start_at: '2099-03-01T10:00Z', end_at: '2099-03-02T10:00Z' }], error: null });
  m.remove.mockResolvedValue({ data: [{ id: 'block-1' }], error: null });
  await show(); fireEvent.click(await screen.findByRole('button', { name: 'Remove block' }));
  expect(await screen.findByText('Block removed.')).toBeTruthy();
  expect(m.eq).toHaveBeenCalledWith('id', 'block-1');
  expect(m.eq).toHaveBeenCalledWith('reason', 'owner_blocked');
});
it('does not render controls when the user does not own the car', async () => {
  m.car.mockResolvedValue({ data: null, error: null });
  await show(); expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Block dates' })).toBeNull();
});

