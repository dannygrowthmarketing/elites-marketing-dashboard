// Shared helpers for Edge Functions (Deno).
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export const TZ = "Asia/Kolkata";

export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-edc-signature, x-edc-timestamp",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

/** Today's date in clinic time, as YYYY-MM-DD. */
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function maxDate(a: string, b: string) { return a > b ? a : b; }
export function minDate(a: string, b: string) { return a < b ? a : b; }

/** fetch with retry on 429/5xx and network errors; exponential backoff with jitter. */
export async function fetchRetry(url: string, init: RequestInit = {}, attempts = 4): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, init);
      if (r.status === 429 || r.status >= 500) {
        lastErr = new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
      } else {
        return r;
      }
    } catch (e) {
      lastErr = e;
    }
    const wait = Math.min(30_000, 1000 * 2 ** i) + Math.floor(Math.random() * 500);
    await new Promise((res) => setTimeout(res, wait));
  }
  throw lastErr;
}

export async function upsertBatched(
  db: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string, size = 500,
): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const { error } = await db.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
    n += chunk.length;
  }
  return n;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Identify the calling user from the Authorization header and return their role, or null. */
export async function callerRole(req: Request): Promise<{ email: string; role: string } | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const db = admin();
  const { data, error } = await db.auth.getUser(auth.slice(7));
  if (error || !data.user?.email) return null;
  const { data: u } = await db.from("app_users").select("role").ilike("email", data.user.email).maybeSingle();
  return u ? { email: data.user.email, role: u.role } : null;
}
