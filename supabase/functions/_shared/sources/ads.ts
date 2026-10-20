import { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { googleAccessToken, NotAuthorized } from "../google.ts";
import { fetchRetry, upsertBatched } from "../util.ts";

const API = () => `https://googleads.googleapis.com/${Deno.env.get("GOOGLE_ADS_API_VERSION") ?? "v26"}`;

export class PendingApproval extends Error {}

async function gaql(customerId: string, token: string, query: string): Promise<any[]> {
  // Developer tokens were sunset 9 Sep 2026: access now belongs to the OAuth client's Cloud project.
  // The header is optional; send it only if a legacy token is configured.
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const devToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN");
  if (devToken) headers["developer-token"] = devToken;
  const mcc = Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
  if (mcc) headers["login-customer-id"] = mcc.replace(/-/g, "");
  const r = await fetchRetry(`${API()}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST", headers, body: JSON.stringify({ query }),
  });
  const body = await r.json();
  if (!r.ok) {
    const msg = JSON.stringify(body).slice(0, 500);
    if (r.status === 401) throw new NotAuthorized(msg);
    // API not enabled on the project, or project still at Test access (test accounts only).
    if (/DEVELOPER_TOKEN_NOT_APPROVED|DEVELOPER_TOKEN_PROHIBITED|SERVICE_DISABLED|has not been used in project|ACCESS_LEVEL|TEST_ACCOUNT|only approved for use with test accounts/i.test(msg)) {
      throw new PendingApproval(msg);
    }
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

  // Match type is optional: if Google rejects the segment, fall back to the plain query.
  const stBase = `campaign.id, ad_group.id, search_term_view.search_term,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE ${where}`;
  let st: any[];
  try { st = await gaql(cid, token, `SELECT segments.date, segments.search_term_match_type, ${stBase}`); }
  catch (e) { if (e instanceof PendingApproval || e instanceof NotAuthorized) throw e; st = await gaql(cid, token, `SELECT segments.date, ${stBase}`); }
  // Same term can appear under multiple match rows per ad group/day — aggregate before upsert.
  const stMap = new Map<string, any>();
  for (const r of st) {
    const k = `${r.segments.date}|${r.adGroup.id}|${r.searchTermView.searchTerm}`;
    const cur = stMap.get(k) ?? { date: r.segments.date, campaign_id: String(r.campaign.id), ad_group_id: String(r.adGroup.id),
      search_term: r.searchTermView.searchTerm, impressions: 0, clicks: 0, cost_micros: 0, conversions: 0, _mt: new Set<string>() };
    cur.impressions += n(r.metrics.impressions); cur.clicks += n(r.metrics.clicks);
    cur.cost_micros += n(r.metrics.costMicros); cur.conversions += n(r.metrics.conversions);
    if (r.segments.searchTermMatchType) cur._mt.add(String(r.segments.searchTermMatchType));
    stMap.set(k, cur);
  }
  count += await upsertBatched(db, "ads_daily_search_term",
    [...stMap.values()].map(({ _mt, ...row }) => ({ ...row, match_types: _mt.size ? [..._mt].sort().join(",") : null })),
    "date,ad_group_id,search_term");

  // Per-ad daily metrics (Ad Library).
  const adDays = await gaql(cid, token, `SELECT segments.date, campaign.id, ad_group.id, ad_group_ad.ad.id,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
    FROM ad_group_ad WHERE ${where}`);
  count += await upsertBatched(db, "ads_daily_ad", adDays.map((r) => ({
    date: r.segments.date, ad_group_id: String(r.adGroup.id), ad_id: String(r.adGroupAd.ad.id), campaign_id: String(r.campaign.id),
    impressions: n(r.metrics.impressions), clicks: n(r.metrics.clicks), cost_micros: n(r.metrics.costMicros),
    conversions: n(r.metrics.conversions), conversion_value: n(r.metrics.conversionsValue),
  })), "date,ad_group_id,ad_id");

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

  // Creatives and assets are current-state snapshots: refresh them on syncs that reach the last week,
  // not on every historical backfill chunk.
  const weekAgo = new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 10);
  if (end >= weekAgo) count += await syncAdCreatives(db, cid, token);

  return count;
}

/** Run a GAQL query that is allowed to fail (a field unsupported for this account/API version).
 *  Access errors still propagate; anything else is recorded as a warning. */
async function tryGaql(cid: string, token: string, label: string, query: string, warnings: string[]): Promise<any[] | null> {
  try { return await gaql(cid, token, query); }
  catch (e) {
    if (e instanceof PendingApproval || e instanceof NotAuthorized) throw e;
    warnings.push(`${label}: ${(e instanceof Error ? e.message : String(e)).slice(0, 240)}`);
    return null;
  }
}

const textAssets = (list: any[] | undefined) => (list ?? []).map((h: any) => ({
  text: h.text ?? null,
  pinned: h.pinnedField && h.pinnedField !== "UNSPECIFIED" ? h.pinnedField : null,
  label: h.assetPerformanceLabel && !["UNSPECIFIED", "UNKNOWN"].includes(h.assetPerformanceLabel) ? h.assetPerformanceLabel : null,
  approval: h.policySummaryInfo?.approvalStatus ?? null,
})).filter((h: any) => h.text);
const assetRefs = (list: any[] | undefined) => (list ?? []).map((a: any) => a.asset).filter(Boolean);

export async function syncAdCreatives(db: SupabaseClient, cid: string, token: string): Promise<number> {
  const warnings: string[] = [];
  const syncStart = new Date().toISOString();
  let count = 0;

  // 1) Core ad fields (Search ads). Required: if this fails the error surfaces in sync_runs.
  const core = await gaql(cid, token, `SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status,
    campaign.advertising_channel_type, ad_group.id, ad_group.name, ad_group.status,
    ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.name, ad_group_ad.ad.final_urls,
    ad_group_ad.ad.final_mobile_urls, ad_group_ad.ad.display_url,
    ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
    ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2,
    ad_group_ad.status, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status,
    ad_group_ad.policy_summary.policy_topic_entries
    FROM ad_group_ad`);
  const ads = new Map<string, any>();
  for (const r of core) {
    const a = r.adGroupAd?.ad ?? {};
    const rsa = a.responsiveSearchAd ?? {};
    ads.set(`${r.adGroup.id}|${a.id}`, {
      ad_group_id: String(r.adGroup.id), ad_id: String(a.id), campaign_id: String(r.campaign.id),
      campaign_name: r.campaign.name ?? null, campaign_status: r.campaign.status ?? null,
      campaign_serving_status: r.campaign.servingStatus ?? null, campaign_channel: r.campaign.advertisingChannelType ?? null,
      ad_group_name: r.adGroup.name ?? null, ad_group_status: r.adGroup.status ?? null,
      ad_type: a.type ?? null, ad_name: a.name ?? null, ad_status: r.adGroupAd.status ?? null,
      approval_status: r.adGroupAd.policySummary?.approvalStatus ?? null,
      review_status: r.adGroupAd.policySummary?.reviewStatus ?? null,
      policy_topics: (r.adGroupAd.policySummary?.policyTopicEntries ?? []).map((t: any) => ({ topic: t.topic, type: t.type })),
      ad_strength: null,
      headlines: textAssets(rsa.headlines), descriptions: textAssets(rsa.descriptions),
      long_headline: null, business_name: null,
      path1: rsa.path1 ?? null, path2: rsa.path2 ?? null,
      final_urls: a.finalUrls ?? [], final_mobile_urls: a.finalMobileUrls ?? [], display_url: a.displayUrl ?? null,
      image_assets: [], logo_assets: [], video_assets: [], synced_at: syncStart,
    });
  }

  // 2) Optional extras: ad strength, display / demand-gen creatives, legacy expanded text ads.
  const extra = await tryGaql(cid, token, "ad strength", `SELECT ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad_strength FROM ad_group_ad`, warnings);
  for (const r of extra ?? []) { const x = ads.get(`${r.adGroup.id}|${r.adGroupAd.ad.id}`); if (x) x.ad_strength = r.adGroupAd.adStrength ?? null; }
  const disp = await tryGaql(cid, token, "display ad fields", `SELECT ad_group.id, ad_group_ad.ad.id,
    ad_group_ad.ad.responsive_display_ad.headlines, ad_group_ad.ad.responsive_display_ad.long_headline,
    ad_group_ad.ad.responsive_display_ad.descriptions, ad_group_ad.ad.responsive_display_ad.business_name,
    ad_group_ad.ad.responsive_display_ad.marketing_images, ad_group_ad.ad.responsive_display_ad.square_marketing_images,
    ad_group_ad.ad.responsive_display_ad.logo_images, ad_group_ad.ad.responsive_display_ad.youtube_videos
    FROM ad_group_ad WHERE ad_group_ad.ad.type = 'RESPONSIVE_DISPLAY_AD'`, warnings);
  for (const r of disp ?? []) {
    const x = ads.get(`${r.adGroup.id}|${r.adGroupAd.ad.id}`); const d = r.adGroupAd.ad.responsiveDisplayAd ?? {};
    if (!x) continue;
    x.headlines = textAssets(d.headlines); x.descriptions = textAssets(d.descriptions);
    x.long_headline = d.longHeadline?.text ?? null; x.business_name = d.businessName ?? null;
    x.image_assets = [...assetRefs(d.marketingImages), ...assetRefs(d.squareMarketingImages)];
    x.logo_assets = assetRefs(d.logoImages); x.video_assets = assetRefs(d.youtubeVideos);
  }
  const eta = await tryGaql(cid, token, "expanded text ad fields", `SELECT ad_group.id, ad_group_ad.ad.id,
    ad_group_ad.ad.expanded_text_ad.headline_part1, ad_group_ad.ad.expanded_text_ad.headline_part2,
    ad_group_ad.ad.expanded_text_ad.headline_part3, ad_group_ad.ad.expanded_text_ad.description,
    ad_group_ad.ad.expanded_text_ad.description2, ad_group_ad.ad.expanded_text_ad.path1, ad_group_ad.ad.expanded_text_ad.path2
    FROM ad_group_ad WHERE ad_group_ad.ad.type = 'EXPANDED_TEXT_AD'`, warnings);
  for (const r of eta ?? []) {
    const x = ads.get(`${r.adGroup.id}|${r.adGroupAd.ad.id}`); const e = r.adGroupAd.ad.expandedTextAd ?? {};
    if (!x) continue;
    x.headlines = [e.headlinePart1, e.headlinePart2, e.headlinePart3].filter(Boolean).map((t: string, i: number) => ({ text: t, pinned: `HEADLINE_${i + 1}`, label: null, approval: null }));
    x.descriptions = [e.description, e.description2].filter(Boolean).map((t: string, i: number) => ({ text: t, pinned: `DESCRIPTION_${i + 1}`, label: null, approval: null }));
    x.path1 = e.path1 ?? x.path1; x.path2 = e.path2 ?? x.path2;
  }
  count += await upsertBatched(db, "ads_ads", [...ads.values()], "ad_group_id,ad_id");

  // 3) Linked assets at account, campaign and ad group level.
  const full = `asset.id, asset.type, asset.name, asset.text_asset.text, asset.image_asset.full_size.url,
    asset.image_asset.full_size.width_pixels, asset.image_asset.full_size.height_pixels,
    asset.youtube_video_asset.youtube_video_id, asset.youtube_video_asset.youtube_video_title,
    asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2,
    asset.final_urls, asset.callout_asset.callout_text, asset.call_asset.phone_number,
    asset.structured_snippet_asset.header, asset.structured_snippet_asset.values, asset.policy_summary.approval_status`;
  const lean = `asset.id, asset.type, asset.name, asset.text_asset.text, asset.image_asset.full_size.url,
    asset.sitelink_asset.link_text, asset.final_urls, asset.callout_asset.callout_text`;
  const levels = [
    { level: "customer", res: "customer_asset", owner: "customer.id", pick: (r: any) => String(r.customer?.id ?? cid), link: (r: any) => r.customerAsset },
    { level: "campaign", res: "campaign_asset", owner: "campaign.id", pick: (r: any) => String(r.campaign.id), link: (r: any) => r.campaignAsset },
    { level: "ad_group", res: "ad_group_asset", owner: "ad_group.id", pick: (r: any) => String(r.adGroup.id), link: (r: any) => r.adGroupAsset },
  ];
  const assetRows: any[] = [];
  let levelsOk = true;
  for (const L of levels) {
    const q = (fields: string) => `SELECT ${L.owner}, ${L.res}.field_type, ${L.res}.status, ${fields} FROM ${L.res}`;
    let rows = await tryGaql(cid, token, `${L.level} assets`, q(full), warnings);
    if (!rows) rows = await tryGaql(cid, token, `${L.level} assets (reduced fields)`, q(lean), warnings);
    if (!rows) levelsOk = false;
    for (const r of rows ?? []) {
      const s = r.asset ?? {}; const link = L.link(r) ?? {};
      assetRows.push({
        level: L.level, owner_id: L.pick(r), asset_id: String(s.id), field_type: link.fieldType ?? "UNKNOWN",
        asset_type: s.type ?? null, asset_name: s.name ?? null,
        text_value: s.textAsset?.text ?? s.calloutAsset?.calloutText ?? null,
        image_url: s.imageAsset?.fullSize?.url ?? null,
        image_width: s.imageAsset?.fullSize?.widthPixels ? n(s.imageAsset.fullSize.widthPixels) : null,
        image_height: s.imageAsset?.fullSize?.heightPixels ? n(s.imageAsset.fullSize.heightPixels) : null,
        youtube_id: s.youtubeVideoAsset?.youtubeVideoId ?? null, youtube_title: s.youtubeVideoAsset?.youtubeVideoTitle ?? null,
        link_text: s.sitelinkAsset?.linkText ?? null, description1: s.sitelinkAsset?.description1 ?? null,
        description2: s.sitelinkAsset?.description2 ?? null, final_urls: s.finalUrls ?? null,
        phone: s.callAsset?.phoneNumber ?? null, snippet_header: s.structuredSnippetAsset?.header ?? null,
        snippet_values: s.structuredSnippetAsset?.values ?? null,
        link_status: link.status ?? null, approval_status: s.policySummary?.approvalStatus ?? null, synced_at: syncStart,
      });
    }
  }
  // 4) Images/videos referenced directly by display ads (resource names → urls).
  const refs = [...new Set([...ads.values()].flatMap((a) => [...a.image_assets, ...a.logo_assets, ...a.video_assets]))];
  if (refs.length) {
    const lib = await tryGaql(cid, token, "ad image library", `SELECT asset.resource_name, asset.id, asset.type, asset.name,
      asset.image_asset.full_size.url, asset.youtube_video_asset.youtube_video_id FROM asset
      WHERE asset.type IN ('IMAGE', 'YOUTUBE_VIDEO')`, warnings);
    for (const s of (lib ?? []).map((r) => r.asset)) {
      if (!refs.includes(s.resourceName)) continue;
      assetRows.push({ level: "customer", owner_id: "ad_library", asset_id: String(s.id), field_type: s.resourceName,
        asset_type: s.type, asset_name: s.name ?? null, image_url: s.imageAsset?.fullSize?.url ?? null,
        youtube_id: s.youtubeVideoAsset?.youtubeVideoId ?? null, synced_at: syncStart });
    }
  }
  // Snapshot replace: drop links that no longer exist, only after a successful fetch of all levels.
  count += await upsertBatched(db, "ads_assets", assetRows, "level,owner_id,asset_id,field_type");
  if (levelsOk) await db.from("ads_assets").delete().lt("synced_at", syncStart);

  await db.from("settings").upsert({ key: "ads_library_sync", value: { synced_at: syncStart, ads: ads.size, assets: assetRows.length, warnings } });
  return count;
}
