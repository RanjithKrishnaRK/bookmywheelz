import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Service-role client: BYPASSES Row Level Security. It is the only way to write bookings, money and audit
// rows, so every caller must have already authenticated the user and checked what that user may do.
// 'server-only' makes the build fail if this file is ever imported from client code, which would ship the
// key to every visitor's browser. The key must never be in a NEXT_PUBLIC_ variable or in Git.
export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY (or the Supabase URL) is not set on the server');
  // No session persistence: this is a server-side, per-request, stateless client.
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
