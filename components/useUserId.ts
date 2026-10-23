'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser as supabase } from '@/lib/supabase/browser';

// undefined = still checking, null = signed out, string = signed-in user id.
// A UI hint only (which screen to show). Every real permission is enforced by the database's Row Level
// Security and by the API routes, never by what this returns.
export function useUserId(): string | null | undefined {
  const [uid, setUid] = useState<string | null | undefined>(undefined);
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setUid(data.session?.user.id ?? null)); }, []);
  return uid;
}
