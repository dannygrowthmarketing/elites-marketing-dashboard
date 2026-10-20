import { addDays } from "./dates";
import { costPer, cpc, ctr, convRate, type Num } from "./metrics";

/* ---------------- types ---------------- */
export type TextAsset = { text: string; pinned: string | null; label: string | null; approval: string | null };
export interface AdRow {
  ad_group_id: string; ad_id: string; campaign_id: string; campaign_name: string | null; campaign_status: string | null;
  campaign_serving_status: string | null; campaign_channel: string | null; ad_group_name: string | null; ad_group_status: string | null;
  ad_type: string | null; ad_name: string | null; ad_status: string | null; approval_status: string | null; review_status: string | null;
  policy_topics: { topic: string; type: string }[] | null; ad_strength: string | null;
  headlines: TextAsset[] | null; descriptions: TextAsset[] | null; long_headline: string | null; business_name: string | null;
  path1: string | null; path2: string | null; final_urls: string[] | null; final_mobile_urls: string[] | null; display_url: string | null;
  image_assets: string[] | null; logo_assets: string[] | null; video_assets: string[] | null; synced_at: string;
  impressions: number; clicks: number; cost: number; conversions: number; conversion_value: number;
  has_rows: boolean; first_served: string | null; last_served: string | null;
}
export interface Asset {
  level: "customer" | "campaign" | "ad_group"; owner_id: string; asset_id: string; field_type: string; asset_type: string | null;
  asset_name: string | null; text_value: string | null; image_url: string | null; image_width: number | null; image_height: number | null;
  youtube_id: string | null; youtube_title: string | null; link_text: string | null; description1: string | null; description2: string | null;
  final_urls: string[] | null; phone: string | null; snippet_header: string | null; snippet_values: string[] | null;
  link_status: string | null; approval_status: string | null;
}
export type Status = "running" | "idle" | "never" | "paused" | "removed" | "ended";
export const STATUS_LABEL: Record<Status, string> = {
  running: "Running", idle: "Enabled · not serving", never: "Enabled · no impressions yet",
  paused: "Paused", removed: "Removed", ended: "Ended",
};
export const STATUS_TONE: Record<Status, "good" | "warn" | "neutral" | "bad" | "info"> = {
  running: "good", idle: "warn", never: "neutral", paused: "neutral", removed: "bad", ended: "neutral",
};
export const ACCOUNT = "520-119-6364";
export const lc = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ").toLowerCase();
export const num = (v: unknown) => (v == null ? 0 : Number(v));

/* ---------------- derivations ---------------- */
export function statusOf(a: AdRow, today: string): Status {
  if (a.ad_status === "REMOVED" || a.campaign_status === "REMOVED" || a.ad_group_status === "REMOVED") return "removed";
  if (a.campaign_serving_status === "ENDED") return "ended";
  if (a.ad_status === "PAUSED" || a.campaign_status === "PAUSED" || a.ad_group_status === "PAUSED") return "paused";
  if (!a.last_served) return "never";
  // Google Ads reports run up to a day behind; "running" = impressions within the last 3 days.
  return a.last_served >= addDays(today, -3) ? "running" : "idle";
}

export function domainOf(url: string | null | undefined) {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

/** Assets that apply to an ad: ad group level first, then campaign, then account (Google uses the most specific level). */
export function assetsFor(a: AdRow, all: Asset[]) {
  const pick = (types: string[]) => {
    for (const [level, owner] of [["ad_group", a.ad_group_id], ["campaign", a.campaign_id], ["customer", null]] as const) {
      const hit = all.filter((x) => x.level === level && (owner == null || x.owner_id === owner) && types.includes(x.field_type)
        && x.link_status !== "REMOVED" && x.owner_id !== "ad_library");
      if (hit.length) return { level, items: hit };
    }
    return { level: null as null | string, items: [] as Asset[] };
  };
  const enabled = (g: { items: Asset[] }) => g.items.filter((x) => x.link_status !== "PAUSED");
  const lib = all.filter((x) => x.owner_id === "ad_library");
  return {
    businessName: a.business_name ?? enabled(pick(["BUSINESS_NAME"]))[0]?.text_value ?? null,
    logo: enabled(pick(["BUSINESS_LOGO", "LOGO", "LANDSCAPE_LOGO"]))[0]?.image_url
      ?? lib.find((x) => a.logo_assets?.includes(x.field_type))?.image_url ?? null,
    sitelinks: pick(["SITELINK"]),
    callouts: pick(["CALLOUT"]),
    snippets: pick(["STRUCTURED_SNIPPET"]),
    calls: pick(["CALL"]),
    images: (() => {
      const own = lib.filter((x) => a.image_assets?.includes(x.field_type) && x.image_url);
      if (own.length) return { level: "ad", items: own };
      return pick(["AD_IMAGE", "MARKETING_IMAGE", "SQUARE_MARKETING_IMAGE", "PORTRAIT_MARKETING_IMAGE"]);
    })(),
    videos: (() => {
      const own = lib.filter((x) => a.video_assets?.includes(x.field_type) && x.youtube_id);
      return own.length ? { level: "ad", items: own } : pick(["YOUTUBE_VIDEO"]);
    })(),
    other: all.filter((x) => (x.level === "customer" || (x.level === "campaign" && x.owner_id === a.campaign_id) || (x.level === "ad_group" && x.owner_id === a.ad_group_id))
      && x.owner_id !== "ad_library"
      && !["BUSINESS_NAME", "BUSINESS_LOGO", "LOGO", "LANDSCAPE_LOGO", "SITELINK", "CALLOUT", "STRUCTURED_SNIPPET", "CALL", "AD_IMAGE", "MARKETING_IMAGE", "SQUARE_MARKETING_IMAGE", "PORTRAIT_MARKETING_IMAGE", "YOUTUBE_VIDEO"].includes(x.field_type)),
  };
}

/** One combination Google could show for a responsive ad: pins respected, then the remaining assets in order, rotated by `seed`. */
export function combo(list: TextAsset[] | null, slots: number, prefix: "HEADLINE" | "DESCRIPTION", seed: number): string[] {
  const items = (list ?? []).filter((x) => x.text);
  if (!items.length) return [];
  const out: (string | null)[] = Array(slots).fill(null);
  const used = new Set<number>();
  for (let s = 0; s < slots; s++) {
    const pinned = items.map((x, i) => [x, i] as const).filter(([x]) => x.pinned === `${prefix}_${s + 1}`);
    if (pinned.length) { const [x, i] = pinned[seed % pinned.length]; out[s] = x.text; used.add(i); }
  }
  const free = items.map((x, i) => [x, i] as const).filter(([x, i]) => !used.has(i) && !x.pinned);
  const rot = free.length ? seed % free.length : 0;
  const order = [...free.slice(rot), ...free.slice(0, rot)];
  let k = 0;
  for (let s = 0; s < slots; s++) if (out[s] == null && k < order.length) out[s] = order[k++][0].text;
  return out.filter((x): x is string => !!x);
}

export function metricsOf(r: { impressions: Num; clicks: Num; cost: Num; conversions: Num; conversion_value: Num }) {
  const imp = num(r.impressions), clk = num(r.clicks), cost = num(r.cost), conv = num(r.conversions), val = num(r.conversion_value);
  // This account values every conversion at a placeholder ₹1, so value only counts when it isn't simply equal to the count.
  const valueState: "ok" | "placeholder" | "none" = conv === 0 ? (val > 0 ? "ok" : "none") : val === 0 ? "none" : Math.abs(val - conv) < 0.001 ? "placeholder" : "ok";
  return { imp, clk, cost, conv, val, valueState, ctr: ctr(clk, imp), cpc: cpc(cost, clk), cr: convRate(conv, clk), cpa: costPer(cost, conv) };
}

