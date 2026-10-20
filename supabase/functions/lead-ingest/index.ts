// Webhook from elitesdental.com (WordPress, server-side). Signed with HMAC-SHA256.
// Headers: x-edc-timestamp (unix seconds), x-edc-signature = hex(hmac(secret, `${ts}.${rawBody}`))
import { admin, cors, hmacHex, json, sha256Hex, timingSafeEqual } from "../_shared/util.ts";
import { advanceStatus, dedupeBasis, DEDUPE_WINDOW_DAYS, LeadPayload, leadColumns } from "../_shared/lead.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const { data: cred } = await admin().rpc("svc_get_credential", { p_provider: "lead_webhook" });
  const secret: string | undefined = cred?.[0]?.api_token;
  if (!secret) return json({ error: "not configured" }, 503);
  const raw = await req.text();
  const ts = req.headers.get("x-edc-timestamp") ?? "";
  const sig = req.headers.get("x-edc-signature") ?? "";
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return json({ error: "stale" }, 401);
  const expect = await hmacHex(secret, `${ts}.${raw}`);
  if (!timingSafeEqual(expect, sig)) return json({ error: "bad signature" }, 401);

  let p: LeadPayload;
  try { p = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }
  if (!["form_submit", "booking_confirmed", "video_consult", "contact_form"].includes(p.event)) return json({ error: "bad event" }, 400);

  const db = admin();
  const { phone, email, row, touch } = leadColumns(p);
  const basis = dedupeBasis(phone, email);
  const dedupe_key = basis ? await sha256Hex(basis) : null;

  // Idempotency: same external ref already recorded => no-op.
  if (touch.external_ref) {
    const { data: seen } = await db.from("lead_touchpoints").select("lead_id")
      .eq("channel", touch.channel).eq("external_ref", touch.external_ref).maybeSingle();
    if (seen) return json({ ok: true, duplicate: true, lead_id: seen.lead_id });
  }

  // Dedupe: same person within the window => attach to existing lead.
  let leadId: string | null = null;
  if (dedupe_key) {
    const since = new Date(Date.now() - DEDUPE_WINDOW_DAYS * 86400_000).toISOString();
    const { data: existing } = await db.from("leads").select("id,status,name,email")
      .eq("dedupe_key", dedupe_key).gte("first_inquiry_at", since)
      .order("first_inquiry_at", { ascending: false }).limit(1).maybeSingle();
    if (existing) {
      leadId = existing.id;
      await db.from("leads").update({
        latest_source: row.latest_source, latest_medium: row.latest_medium, latest_campaign: row.latest_campaign,
        latest_touch_at: row.latest_touch_at,
        status: advanceStatus(existing.status, row.status),
        name: existing.name ?? row.name, email: existing.email ?? row.email,
      }).eq("id", leadId);
    }
  }
  if (!leadId) {
    const { data: ins, error } = await db.from("leads").insert({ ...row, dedupe_key }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    leadId = ins.id;
  }

  const { error: tErr } = await db.from("lead_touchpoints").insert({ ...touch, lead_id: leadId, raw: { form_name: p.form_name ?? null, page_url: p.page_url ?? null } });
  if (tErr && !/duplicate key/.test(tErr.message)) return json({ error: tErr.message }, 500);

  if (p.event === "booking_confirmed") {
    await db.from("appointments").upsert({
      lead_id: leadId, source_system: "click4appointment", external_ref: touch.external_ref,
      appointment_at: p.appointment_at && !isNaN(Date.parse(p.appointment_at)) ? new Date(p.appointment_at).toISOString() : null,
      status: "booked", service_category: row.requested_service,
    }, { onConflict: "source_system,external_ref", ignoreDuplicates: true });
  }

  await db.from("integrations").update({
    status: "connected", last_success_at: new Date().toISOString(), last_error: null,
  }).eq("source", "wordpress");
  return json({ ok: true, lead_id: leadId });
});
