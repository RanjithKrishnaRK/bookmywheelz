'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabaseBrowser as supabase } from '@/lib/supabase/browser';

// "Sign in" or "Sign out" depending on the session. The header lives in the root layout, which is a server
// component; reading cookies there would make EVERY page dynamic, so this small client piece asks instead.
// It starts as "Sign in" and flips once the session is known, so the server HTML and first browser render match.
export default function AuthNav() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(!!session));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!signedIn) return <Link href="/login">Sign in</Link>;
  return <button type="button" onClick={async () => { await supabase.auth.signOut(); router.push('/'); router.refresh(); }}>Sign out</button>;
}
