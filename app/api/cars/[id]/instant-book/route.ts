import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { apiError, apiOk, guardMutation, readJson, serverError } from '@/lib/api';

const schema = z.object({ enabled: z.boolean() }).strict();
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const blocked = guardMutation(request);
  if (blocked) return blocked;
  const user = await getCurrentUser();
  if (!user) return apiError(401, 'unauthenticated', 'Please sign in.');
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return apiError(404, 'car_not_found', 'Car not found.');
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) return apiError(400, 'invalid_request', 'Choose whether instant booking is enabled.');
  let db;
  try { db = createSupabaseAdmin(); }
  catch { return apiError(500, 'server_misconfigured', 'The server is not configured correctly.'); }
  const recent = await db.from('audit_log').select('id', { count: 'exact', head: true })
    .eq('actor_id', user.id).eq('action', 'car.instant_book')
    .gte('created_at', new Date(Date.now() - 3_600_000).toISOString());
  if (recent.error) return serverError('instant booking rate limit', recent.error);
  if ((recent.count ?? 0) >= 30) return apiError(429, 'rate_limited', 'Too many changes. Please try again later.');
  // Check ownership in the update itself; only this preference is writable.
  const result = await db.from('cars').update({ instant_book: parsed.data.enabled })
    .eq('id', id.data).eq('owner_id', user.id).select('id, instant_book').maybeSingle();
  if (result.error) return serverError('instant booking update', result.error);
  if (!result.data) return apiError(404, 'car_not_found', 'Car not found.');
  const audit = await db.from('audit_log').insert({ actor_id: user.id, action: 'car.instant_book', entity: 'car', entity_id: id.data, after: { instant_book: result.data.instant_book } });
  if (audit.error) console.error('[api] AUDIT WRITE FAILED for car.instant_book', id.data, audit.error);
  return apiOk({ car: { id: result.data.id, instantBook: result.data.instant_book } });
}
