import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Refreshes the Supabase session on every matched request. Access tokens are short-lived;
// refreshing needs to WRITE new cookies, which server components cannot do, so it has to
// happen here, before rendering. Without this users get randomly signed out.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          // Update the incoming request too, so server components rendered in THIS request
          // already see the refreshed token instead of the stale one.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          // Cache headers stop a CDN from caching a response that carries someone's Set-Cookie.
          Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    }
  );

  // Triggers the refresh. No code may run between creating the client and this call.
  // This does NOT block pages: authorization is checked per-route with getCurrentUser(),
  // because the docs say proxy is for optimistic checks, not as the authorization layer.
  await supabase.auth.getClaims();
  return response;
}
