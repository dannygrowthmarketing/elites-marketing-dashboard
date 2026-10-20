// Google OAuth token handling. Refresh token lives in private.credentials (provider='google').
import { admin, fetchRetry } from "./util.ts";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/business.manage",
  "https://www.googleapis.com/auth/adwords",
];

export class NotAuthorized extends Error {}

export async function googleAccessToken(): Promise<string> {
  const db = admin();
  const { data, error } = await db.rpc("svc_get_credential", { p_provider: "google" });
  if (error) throw error;
  const cred = data?.[0];
  if (!cred?.refresh_token) throw new NotAuthorized("Google account not connected");

  if (cred.access_token && cred.access_expires_at && new Date(cred.access_expires_at).getTime() > Date.now() + 120_000) {
    return cred.access_token;
  }
  const r = await fetchRetry("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: cred.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const body = await r.json();
  if (!r.ok) {
    if (body.error === "invalid_grant") throw new NotAuthorized("Google refresh token revoked or expired — reconnect Google");
    throw new Error(`Google token refresh failed: ${JSON.stringify(body).slice(0, 300)}`);
  }
  const expires = new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString();
  await db.rpc("svc_put_credential", { p_provider: "google", p_access_token: body.access_token, p_access_expires_at: expires });
  return body.access_token;
}

export async function googleJson(url: string, token: string, init: RequestInit = {}) {
  const r = await fetchRetry(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await r.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) {
    const msg = typeof body === "object" ? (body.error?.message ?? JSON.stringify(body)) : String(body);
    const err = new Error(`${r.status} ${msg}`.slice(0, 500));
    (err as any).status = r.status;
    throw err;
  }
  return body;
}
