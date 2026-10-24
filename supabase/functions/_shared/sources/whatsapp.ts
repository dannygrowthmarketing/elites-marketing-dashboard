import { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { admin, fetchRetry, upsertBatched } from "../util.ts";
import { NotAuthorized } from "../google.ts";

// WhatsApp Business Platform (Meta Cloud API) analytics for one WhatsApp Business Account (WABA).
// Needs a system-user token with whatsapp_business_management and the WABA ID (saved as external_id).
// Pulls daily sent/delivered per sending number, and per-template sent/delivered/read/clicked when
// template analytics is switched on for the WABA. No message content or recipients are read.

const V = () => Deno.env.get("META_API_VERSION") ?? "v26.0";
const unix = (iso: string, endOfDay = false) => Math.floor(new Date(iso + (endOfDay ? "T23:59:59Z" : "T00:00:00Z")).getTime() / 1000);
const day = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const n = (v: unknown) => Number(v ?? 0);

async function graph(path: string, token: string) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetchRetry(`https://graph.facebook.com/${V()}/${path}${sep}access_token=${encodeURIComponent(token)}`);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (body?.error?.code === 190 || r.status === 401) throw new NotAuthorized("WhatsApp token invalid or expired");
    throw new Error(`WhatsApp ${r.status}: ${JSON.stringify(body?.error ?? body).slice(0, 300)}`);
  }
  return body;
}

export async function syncWhatsapp(db: SupabaseClient, wabaId: string | null, start: string, end: string): Promise<number> {
  const { data } = await admin().rpc("svc_get_credential", { p_provider: "whatsapp" });
  const token: string | undefined = data?.[0]?.api_token;
  if (!token || !wabaId) throw new NotAuthorized("WhatsApp token or WhatsApp Business Account ID not set");
  let count = 0;

  // 1) Daily sent / delivered per sending number.
  const a = await graph(`${wabaId}?fields=analytics.start(${unix(start)}).end(${unix(end, true)}).granularity(DAY)`, token);
  const pts: any[] = a.analytics?.data_points ?? [];
  const byKey = new Map<string, any>();
  for (const p of pts) {
    const k = `${day(p.start)}|${a.analytics?.phone_numbers?.[0] ?? "all"}`;
    const cur = byKey.get(k) ?? { date: day(p.start), phone_number: a.analytics?.phone_numbers?.join(",") || "all", sent: 0, delivered: 0 };
    cur.sent += n(p.sent); cur.delivered += n(p.delivered);
    byKey.set(k, cur);
  }
  count += await upsertBatched(db, "whatsapp_daily", [...byKey.values()], "date,phone_number");

  // 2) Template performance (optional: needs template analytics enabled on the WABA).
  try {
    const tpl = await graph(`${wabaId}/message_templates?fields=id,name,category,status&limit=100`, token);
    const templates: any[] = (tpl.data ?? []).filter((t: any) => t.status !== "DELETED");
    const meta = new Map(templates.map((t) => [String(t.id), t]));
    for (let i = 0; i < templates.length; i += 10) {
      const ids = templates.slice(i, i + 10).map((t) => t.id);
      const ta = await graph(`${wabaId}/template_analytics?start=${unix(start)}&end=${unix(end, true)}&granularity=DAILY` +
        `&metric_types=${encodeURIComponent(JSON.stringify(["SENT", "DELIVERED", "READ", "CLICKED"]))}&template_ids=${encodeURIComponent(JSON.stringify(ids))}`, token);
      const rows: any[] = [];
      for (const block of ta.data ?? []) for (const p of block.data_points ?? []) {
        const t = meta.get(String(p.template_id));
        rows.push({
          date: day(p.start), template_id: String(p.template_id), template_name: t?.name ?? null, category: t?.category ?? null,
          sent: n(p.sent), delivered: n(p.delivered), read: n(p.read),
          clicked: (p.clicked ?? []).reduce((s: number, c: any) => s + n(c.count), 0),
        });
      }
      count += await upsertBatched(db, "whatsapp_template_daily", rows, "date,template_id");
    }
  } catch (e) {
    if (e instanceof NotAuthorized) throw e;
    // Template analytics not enabled or no templates — daily totals above still count.
    console.warn("whatsapp template analytics:", e instanceof Error ? e.message : e);
  }
  return count;
}
