import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';

// Only same-site relative paths. Without this, /auth/callback?next=https://evil.example would
// make our genuine sign-in email link bounce a freshly signed-in user to an attacker's site
// (open redirect, a classic phishing helper). '//host' and '/\host' are protocol-relative
// tricks browsers treat as external, so they are rejected too.
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/owner/new';
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));

  if (code) {
    const supabase = await createSupabaseServer();
    // Swaps the one-time PKCE code for a session and sets the session cookies. The code only
    // works in the browser that requested the link (its verifier cookie is needed), so a
    // forwarded or stolen link fails here.
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
