import { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { admin, fetchRetry, upsertBatched } from "../util.ts";
import { NotAuthorized } from "../google.ts";

// Meta Marketing API insights. Structure is ready; stays "pending authorization"
// until a system-user token and ad account id are saved.
const V = () => Deno.env.get("META_API_VERSION") ?? "v26.0";

const LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];

export async function syncMeta(db: SupabaseClient, adAccountId: string | null, start: string, end: string): Promise<number> {
  const { data } = await admin().rpc("svc_get_credential", { p_provider: "meta" });
  const token = data?.[0]?.api_token;
  if (!token || !adAccountId) throw new NotAuthorized("Meta access not provided yet");
  const acct = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const fields = "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,impressions,reach,clicks,spend,actions,action_values";
  let url: string | null = `https://graph.facebook.com/${V()}/${acct}/insights?` + new URLSearchParams({
    level: "ad", time_increment: "1", fields, limit: "500",
    time_range: JSON.stringify({ since: start, until: end }), access_token: token,
  });
  const rows: Record<string, unknown>[] = [];
  while (url) {
    const r = await fetchRetry(url);
    const body = await r.json();
    if (!r.ok) {
      if (body?.error?.code === 190) throw new NotAuthorized("Meta token invalid or expired");
      throw new Error(`Meta ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
    }
    for (const x of body.data ?? []) {
      const act = (arr: any[] | undefined, types: string[]) =>
        (arr ?? []).filter((a) => types.includes(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0);
      rows.push({
        date: x.date_start, campaign_id: x.campaign_id, campaign_name: x.campaign_name,
        adset_id: x.adset_id, adset_name: x.adset_name, ad_id: x.ad_id, ad_name: x.ad_name,
        impressions: Number(x.impressions || 0), reach: Number(x.reach || 0), clicks: Number(x.clicks || 0),
        spend: Number(x.spend || 0), leads: act(x.actions, LEAD_ACTIONS),
        conversions: act(x.actions, [...LEAD_ACTIONS, "purchase", "schedule", "contact"]),
        conversion_value: act(x.action_values, ["purchase", "lead", "schedule"]),
      });
    }
    url = body.paging?.next ?? null;
  }
  return await upsertBatched(db, "meta_daily_ad", rows, "date,ad_id");
}
