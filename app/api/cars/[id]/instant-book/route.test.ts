import { beforeEach, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
const m = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), result: vi.fn(), recent: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getCurrentUser: m.user }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdmin: m.admin }));
const id = '00000000-0000-4000-8000-000000000001';
const request = (body: unknown, headers = {}) => new Request('https://test.invalid/api/cars/' + id + '/instant-book', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) as NextRequest;
const call = (body: unknown = { enabled: true }, headers = {}) => POST(request(body, headers), { params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({ id: 'owner-1' });
  m.admin.mockReturnValue({ from: m.from });
  const chain = { eq: (...args: unknown[]) => { m.eq(...args); return chain; }, select: () => chain, maybeSingle: m.result };
  m.update.mockReturnValue(chain);
  m.from.mockImplementation((table: string) => table === 'cars' ? { update: m.update } : { select: () => ({ eq: () => ({ eq: () => ({ gte: m.recent }) }) }), insert: m.audit });
  m.recent.mockResolvedValue({ count: 0, error: null });
  m.result.mockResolvedValue({ data: { id, instant_book: true }, error: null });
  m.audit.mockResolvedValue({ error: null });
});
it('updates only the flag with an atomic owner filter', async () => {
  const res = await call();
  expect(res.status).toBe(200);
  expect(m.update).toHaveBeenCalledWith({ instant_book: true });
  expect(m.eq).toHaveBeenCalledWith('owner_id', 'owner-1');
  expect(m.eq).toHaveBeenCalledWith('id', id);
  expect(await res.json()).toEqual({ car: { id, instantBook: true } });
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ actor_id: 'owner-1', action: 'car.instant_book' }));
});
it('requires a verified session', async () => {
  m.user.mockResolvedValue(null);
  expect((await call()).status).toBe(401);
  expect(m.update).not.toHaveBeenCalled();
});
it('does not reveal a car belonging to somebody else', async () => {
  m.result.mockResolvedValue({ data: null, error: null });
  expect((await call()).status).toBe(404);
  expect(m.audit).not.toHaveBeenCalled();
});
it.each([{ enabled: 'true' }, { enabled: true, status: 'approved' }, { enabled: true, owner_id: 'other' }])('rejects invalid or extra fields %j', async body => {
  expect((await call(body)).status).toBe(400);
  expect(m.update).not.toHaveBeenCalled();
});
it('rejects cross-site mutations', async () => {
  expect((await call({ enabled: true }, { Origin: 'https://attacker.invalid' })).status).toBe(403);
  expect(m.user).not.toHaveBeenCalled();
});
it('rate limits repeated preference changes', async () => {
  m.recent.mockResolvedValue({ count: 30, error: null });
  expect((await call()).status).toBe(429);
  expect(m.update).not.toHaveBeenCalled();
});
it('allows disabling the setting', async () => {
  m.result.mockResolvedValue({ data: { id, instant_book: false }, error: null });
  expect((await call({ enabled: false })).status).toBe(200);
  expect(m.update).toHaveBeenCalledWith({ instant_book: false });
});
