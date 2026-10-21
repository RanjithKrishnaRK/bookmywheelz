import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

// Next 16 renamed middleware.ts to proxy.ts (middleware.ts is deprecated).
export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // API routes are deliberately INCLUDED: Stage 2 endpoints read the session from cookies.
  // Static assets are excluded so we don't pay a token check per image/css request.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
