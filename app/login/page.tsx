'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser as supabase } from '@/lib/supabase/browser';
import { safeNextPath } from '@/lib/safe-path';

function LoginForm() {
  const params = useSearchParams();
  const failed = params.get('error') === 'link';
  // Where to land after signing in (same-site paths only; /auth/callback checks it again server-side).
  const next = safeNextPath(params.get('next'));
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    failed ? { ok: false, text: 'That sign-in link is invalid or expired. Request a new one (open it in the same browser you requested it from).' } : null
  );
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` } });
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: 'Check your inbox for the sign-in link.' });
    setBusy(false);
  }
  return (
    <main className="wrap"><div className="form">
      <h1>Sign in</h1>
      <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
      <button className="btn" onClick={send} disabled={busy || !email.includes('@')}>Email me a sign-in link</button>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? '' : 'err'}>{msg.text}</p>}
    </div></main>
  );
}

export default function Login() {
  return (
    <Suspense fallback={<main className="wrap"><p>Loading…</p></main>}>
      <LoginForm />
    </Suspense>
  );
}
