import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { apiError, apiOk, guardMutation, readJson, serverError } from '@/lib/api';
import { bookingIdSchema, respondSchema } from '@/lib/bookings';

// POST /api/bookings/[id]/respond: the CAR OWNER approves or rejects a request.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;

  const user = await getCurrentUser();
  if (!user) return apiError(401, 'unauthenticated', 'Please sign in.');

  const id = bookingIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return apiError(404, 'booking_not_found', 'Booking not found.');
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = respondSchema.safeParse(body.data);
  if (!parsed.success) return apiError(400, 'invalid_request', 'decision must be "approve" or "reject".');
  const { decision } = parsed.data;

  let db;
  try { db = createSupabaseAdmin(); } catch (e) { console.error('[api] server misconfigured:', e); return apiError(500, 'server_misconfigured', 'The server is not configured correctly.'); }

  // Time out stale requests first, so an owner cannot approve one whose deadline has already passed.
  const sweep = await db.rpc('expire_stale_bookings');
  if (sweep.error) return serverError('expire sweep', sweep.error);

  const now = new Date();
  let patch: Record<string, unknown>;
  if (decision === 'approve') {
    const st = await db.from('platform_settings').select('payment_window_minutes').single();
    if (st.error) return serverError('settings lookup', st.error);
    // Approval starts the clock for the renter to pay. 'approved' HOLDS the car, so the deadline is what
    // stops an unpaid approval blocking the dates forever.
    patch = { status: 'approved', expires_at: new Date(now.getTime() + st.data.payment_window_minutes * 60_000).toISOString() };
  } else {
    patch = { status: 'rejected', expires_at: null };
  }

  // ONE atomic statement that is both the authorization check and the state change: it only matches if the
  // caller owns this booking AND it is still 'requested' AND its deadline has not passed. Two things this buys:
  //  - A renter or stranger can never match (owner_id filter), so there is no "check, then update" gap to exploit.
  //  - Two simultaneous clicks cannot both succeed (the second finds status != 'requested' and matches 0 rows).
  const upd = await db.from('bookings').update(patch).eq('id', id.data).eq('owner_id', user.id).eq('status', 'requested').gt('expires_at', now.toISOString()).select('id, status, expires_at').maybeSingle();

  if (upd.error) {
    // The database refused the approval: another booking already holds (or the owner blocked) these dates.
    if (upd.error.code === '23P01') return apiError(409, 'dates_unavailable', 'These dates are no longer available, so this request cannot be approved.');
    return serverError('booking respond update', upd.error);
  }

  if (!upd.data) {
    // Matched nothing. Work out why, WITHOUT revealing that someone else's booking exists.
    const cur = await db.from('bookings').select('id, owner_id, status').eq('id', id.data).maybeSingle();
    if (cur.error) return serverError('booking lookup', cur.error);
    if (!cur.data || cur.data.owner_id !== user.id) return apiError(404, 'booking_not_found', 'Booking not found.');
    const msg = cur.data.status === 'expired' ? 'This request has expired.' : `This request was already ${cur.data.status}.`;
    return apiError(409, 'not_pending', msg, { currentStatus: cur.data.status });
  }

  // Best-effort audit; see the note in POST /api/bookings about when this must become transactional.
  const audit = await db.from('audit_log').insert({ actor_id: user.id, action: `booking.${decision}`, entity: 'booking', entity_id: id.data, before: { status: 'requested' }, after: { status: upd.data.status, expiresAt: upd.data.expires_at } });
  if (audit.error) console.error('[api] AUDIT WRITE FAILED for booking.' + decision, id.data, audit.error);

  return apiOk({ booking: { id: upd.data.id, status: upd.data.status, expiresAt: upd.data.expires_at } });
}
