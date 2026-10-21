import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// A NEW client per request, never a module-level singleton: it is bound to this request's
// cookies, so sharing it would leak one user's session into another user's request.
// Must be called inside <Suspense> or a route handler: cookies() is request-time data and
// with cacheComponents on, reading it outside Suspense fails the production build.
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot write cookies (Next throws). Safe to ignore ONLY because
            // proxy.ts refreshes the session on every request and does the writing there.
          }
        },
      },
    }
  );
}

export type CurrentUser = { id: string; email: string | undefined };

// The only sanctioned way to ask "who is this?" on the server.
// getClaims() verifies the JWT signature. We deliberately avoid auth.getSession() here:
// it just reads the cookie, and a cookie is client-controlled, so a forged one would pass.
// Never take a user id from the request body or query string for anything involving
// bookings or money; always take it from here.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { id: data.claims.sub, email: typeof data.claims.email === 'string' ? data.claims.email : undefined };
}
