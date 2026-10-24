// Owner-only: save or remove API tokens that don't use OAuth (Clarity, Meta, Mailchimp, WhatsApp), and set source ids.
// POST { action: 'save'|'remove', provider: 'clarity'|'meta'|'mailchimp'|'whatsapp', token?, external_id? }
import { admin, callerRole, cors, json } from "../_shared/util.ts";

const ALLOWED: Record<string, string> = { clarity: "clarity", meta: "meta_ads", mailchimp: "mailchimp", whatsapp: "whatsapp" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const who = await callerRole(req);
  if (who?.role !== "owner") return json({ error: "Only an owner can manage credentials" }, 403);

  const { action, provider, token, external_id } = await req.json().catch(() => ({}));
  const source = ALLOWED[provider];
  if (!source && provider !== "google") return json({ error: "unknown provider" }, 400);
  const db = admin();

  if (action === "remove") {
    await db.rpc("svc_delete_credential", { p_provider: provider });
    const srcs = provider === "google" ? ["ga4", "gsc", "gbp", "google_ads"] : [source];
    await db.from("integrations").update({ status: "pending_authorization" }).in("source", srcs);
    return json({ ok: true });
  }
  if (action === "save") {
    if (provider === "google") return json({ error: "Use the Connect Google button" }, 400);
    if (typeof token !== "string" || token.length < 10) return json({ error: "token missing" }, 400);
    if (provider === "mailchimp" && !/-[a-z]+\d+$/.test(token.trim())) return json({ error: "That doesn't look like a Mailchimp API key — it should end like -us21" }, 400);
    if (provider === "whatsapp" && !/^\d{6,}$/.test(String(external_id ?? "").trim())) return json({ error: "Enter the WhatsApp Business Account ID (numbers only)" }, 400);
    await db.rpc("svc_put_credential", { p_provider: provider, p_api_token: token.trim() });
    const patch: Record<string, unknown> = { status: "connected", last_error: null };
    if (external_id) patch.external_id = String(external_id).trim();
    await db.from("integrations").update(patch).eq("source", source);
    await db.rpc("svc_kick_sync", { p_sources: [source] });
    return json({ ok: true });
  }
  return json({ error: "unknown action" }, 400);
});
