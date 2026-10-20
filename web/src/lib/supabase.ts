import { createClient } from "@supabase/supabase-js";

// Publishable values only. Secrets live in Supabase (private schema / Edge Function env).
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "https://pymwnsjjztahucqzlqkl.supabase.co";
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_0ft0KL8SqZkivvuVM-rB_w_LJd3MIvj";

export const supabase = createClient(SUPABASE_URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});

export async function callFunction<T = any>(name: string, body: unknown): Promise<T> {
  const { data: s } = await supabase.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}`, apikey: KEY },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}
