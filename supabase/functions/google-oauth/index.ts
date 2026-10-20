// Google OAuth for GA4 + Search Console + Business Profile + Ads (one consent, read scopes).
// POST (signed-in owner)  -> { url } to send the browser to Google
// GET  ?code&state        -> Google redirects here; stores refresh token; bounces back to the app
import { admin, callerRole, cors, fetchRetry, json } from "../_shared/util.ts";
import { GOOGLE_SCOPES } from "../_shared/google.ts";

const redirectUri = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-oauth`;
// The live dashboard URL comes from APP_URL, else from private.credentials (provider 'app_url').
async function appUrl(): Promise<string> {
  const env = Deno.env.get("APP_URL");
  if (env) return env.replace(/\/$/, "");
  const { data } = await admin().rpc("svc_get_credential", { p_provider: "app_url" });
  return (data?.[0]?.api_token ?? "http://localhost:5173").replace(/\/$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();

  if (req.method === "POST") {
    const who = await callerRole(req);
    if (who?.role !== "owner") return json({ error: "Only an owner can connect Google" }, 403);
    if (!Deno.env.get("GOOGLE_CLIENT_ID")) return json({ error: "Google OAuth client not configured yet (GOOGLE_CLIENT_ID secret missing)" }, 412);
    const { data: state, error } = await db.rpc("svc_create_oauth_state", { p_provider: "google", p_created_by: who.email });
    if (error) return json({ error: error.message }, 500);
    const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return json({ url });
  }

  // GET callback
  const u = new URL(req.url);
  const base = await appUrl();
  const back = (q: string) => Response.redirect(`${base}/#/integrations?${q}`, 302);
  if (u.searchParams.get("error")) return back(`google=error&reason=${encodeURIComponent(u.searchParams.get("error")!)}`);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  if (!code || !state) return back("google=error&reason=missing_code");

  const { data: provider } = await db.rpc("svc_consume_oauth_state", { p_state: state });
  if (provider !== "google") return back("google=error&reason=bad_state");

  const r = await fetchRetry("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      redirect_uri: redirectUri(), grant_type: "authorization_code",
    }),
  });
  const tok = await r.json();
  if (!r.ok || !tok.refresh_token) return back(`google=error&reason=${encodeURIComponent(tok.error ?? "no_refresh_token")}`);

  let email: string | null = null;
  try {
    const p = JSON.parse(atob(tok.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    email = p.email ?? null;
  } catch { /* ignore */ }

  await db.rpc("svc_put_credential", {
    p_provider: "google", p_refresh_token: tok.refresh_token, p_access_token: tok.access_token,
    p_access_expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
    p_scopes: tok.scope ?? null, p_account_email: email,
  });
  // Flip Google sources to connected-pending-first-sync; Ads/GBP keep pending_approval until their gates clear.
  await db.from("integrations").update({ status: "connected", last_error: null }).in("source", ["ga4", "gsc"]);
  await db.from("integrations").update({ status: "pending_approval", last_error: null }).in("source", ["gbp", "google_ads"]);
  // Kick off first syncs immediately rather than waiting for the nightly schedule.
  await db.rpc("svc_kick_sync", { p_sources: ["ga4", "gsc", "gbp", "google_ads"] });
  return back("google=connected");
});
