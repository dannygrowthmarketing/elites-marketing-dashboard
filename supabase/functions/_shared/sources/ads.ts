import { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { googleAccessToken, NotAuthorized } from "../google.ts";
import { fetchRetry, upsertBatched } from "../util.ts";

const API = () => `https://googleads.googleapis.com/${Deno.env.get("GOOGLE_ADS_API_VERSION") ?? "v26"}`;

export class PendingApproval extends Error {}

async function gaql(customerId: string, token: string, query: string): Promise<any[]> {
  const devToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN");
  if (!devToken) throw new PendingApproval("Google Ads developer token not set (needs Basic access approval)");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`, "developer-token": devToken, "Content-Type": "application/json",
  };
  const mcc = Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
  if (mcc) headers["login-customer-id"] = mcc.replace(/-/g, "");
  const r = await fetchRetry(`${API()}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST", headers, body: JSON.stringify({ query }),
  });
  const body = await r.json();
  if (!r.ok) {
    const msg = JSON.stringify(body).slice(0, 500);
    if (r.status === 401) throw new NotAuthorized(msg);
    if (/DEVELOPER_TOKEN_NOT_APPROVED|DEVELOPER_TOKEN_PROHIBITED/.test(msg)) throw new PendingApproval(msg);
    throw new Error(`Google Ads ${r.status}: ${msg}`);
  }
  return (Array.isArray(body) ? body : [body]).flatMap((b) => b.results ?? []);
}

const n = (v: unknown) => Number(v ?? 0);

export async function syncAds(db: SupabaseClient, customerIdRaw: string, start: string, end: string): Promise<number> {
  const cid = customerIdRaw.replace(/-/g, "");
  const token = await googleAccessToken();
  const where = `segments.date BETWEEN '${start}' AND '${end}'`;
  let count = 0;

  const camp = await gaql(cid, token, `SELECT segments.date, campaign.id, campaign.name, campaign.status,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
    FROM campaign WHERE ${where}`);
  const campDev = await gaql(cid, token, `SELECT segments.date, segments.device, campaign.id, campaign.name, campaign.status,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
    FROM campaign WHERE ${where}`);
  const cRow = (r: any, device: string) => ({
    date: r.segments.date, campaign_id: String(r.campaign.id), campaign_name: r.campaign.name,
    campaign_status: r.campaign.status, device,
    impressions: n(r.metrics.impressions), clicks: n(r.metrics.clicks), cost_micros: n(r.metrics.costMicros),
    conversions: n(r.metrics.conversions), conversion_value: n(r.metrics.conversionsValue),
  });
  count += await upsertBatched(db, "ads_daily_campaign",
    [...camp.map((r) => cRow(r, "ALL")), ...campDev.map((r) => cRow(r, r.segments.device))], "date,campaign_id,device");

  const ag = await gaql(cid, token, `SELECT segments.date, campaign.id, ad_group.id, ad_group.name,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM ad_group WHERE ${where}`);
  count += await upsertBatched(db, "ads_daily_ad_group", ag.map((r) => ({
    date: r.segments.date, campaign_id: String(r.campaign.id), ad_group_id: String(r.adGroup.id), ad_group_name: r.adGroup.name,
    impressions: n(r.metrics.impressions), clicks: n(r.metrics.clicks), cost_micros: n(r.metrics.costMicros), conversions: n(r.metrics.conversions),
  })), "date,ad_group_id");

  const kw = await gaql(cid, token, `SELECT segments.date, ad_group.id, ad_group_criterion.criterion_id,
    ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM keyword_view WHERE ${where}`);
  count += await upsertBatched(db, "ads_daily_keyword", kw.map((r) => ({
    date: r.segments.date, ad_group_id: String(r.adGroup.id), criterion_id: String(r.adGroupCriterion.criterionId),
    keyword: r.adGroupCriterion.keyword?.text ?? "", match_type: r.adGroupCriterion.keyword?.matchType ?? null,
    impressions: n(r.metrics.impressions), clicks: n(r.metrics.clicks), cost_micros: n(r.metrics.costMicros), conversions: n(r.metrics.conversions),
  })), "date,criterion_id,ad_group_id");

  const st = await gaql(cid, token, `SELECT segments.date, campaign.id, ad_group.id, search_term_view.search_term,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE ${where}`);
  // Same term can appear under multiple match rows per ad group/day — aggregate before upsert.
  const stMap = new Map<string, any>();
  for (const r of st) {
    const k = `${r.segments.date}|${r.adGroup.id}|${r.searchTermView.searchTerm}`;
    const cur = stMap.get(k) ?? { date: r.segments.date, campaign_id: String(r.campaign.id), ad_group_id: String(r.adGroup.id),
      search_term: r.searchTermView.searchTerm, impressions: 0, clicks: 0, cost_micros: 0, conversions: 0 };
    cur.impressions += n(r.metrics.impressions); cur.clicks += n(r.metrics.clicks);
    cur.cost_micros += n(r.metrics.costMicros); cur.conversions += n(r.metrics.conversions);
    stMap.set(k, cur);
  }
  count += await upsertBatched(db, "ads_daily_search_term", [...stMap.values()], "date,ad_group_id,search_term");

  const lp = await gaql(cid, token, `SELECT segments.date, campaign.id, expanded_landing_page_view.expanded_final_url,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM expanded_landing_page_view WHERE ${where}`);
  const lpMap = new Map<string, any>();
  for (const r of lp) {
    const url = (r.expandedLandingPageView?.expandedFinalUrl ?? "").split("?")[0];
    const k = `${r.segments.date}|${r.campaign.id}|${url}`;
    const cur = lpMap.get(k) ?? { date: r.segments.date, campaign_id: String(r.campaign.id), landing_page: url,
      impressions: 0, clicks: 0, cost_micros: 0, conversions: 0 };
    cur.impressions += n(r.metrics.impressions); cur.clicks += n(r.metrics.clicks);
    cur.cost_micros += n(r.metrics.costMicros); cur.conversions += n(r.metrics.conversions);
    lpMap.set(k, cur);
  }
  count += await upsertBatched(db, "ads_daily_landing", [...lpMap.values()], "date,campaign_id,landing_page");

  const conv = await gaql(cid, token, `SELECT segments.date, segments.conversion_action_name, campaign.id,
    metrics.conversions, metrics.conversions_value FROM campaign WHERE ${where} AND metrics.conversions > 0`);
  count += await upsertBatched(db, "ads_conversion_actions", conv.map((r) => ({
    date: r.segments.date, conversion_action: r.segments.conversionActionName, campaign_id: String(r.campaign.id),
    conversions: n(r.metrics.conversions), conversion_value: n(r.metrics.conversionsValue),
  })), "date,conversion_action,campaign_id");

  return count;
}
