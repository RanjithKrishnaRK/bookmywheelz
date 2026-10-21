import { createBrowserClient } from '@supabase/ssr';

// Client-component Supabase client. Unlike the plain supabase-js client in lib/supabase.ts
// (which keeps the session in localStorage, invisible to the server), this one stores the
// session in cookies. That is the whole point of the @supabase/ssr move: route handlers and
// server components can now see who is signed in, which Stage 2 booking endpoints require.
// It also forces PKCE, so the magic link returns ?code=... to /auth/callback.
export const supabaseBrowser = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
