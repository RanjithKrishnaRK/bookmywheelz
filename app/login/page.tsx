'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/owner/new` } });
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
