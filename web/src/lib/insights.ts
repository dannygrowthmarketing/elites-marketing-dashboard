// Rule-based insights. Deterministic: same data in, same findings out.
// Each finding cites the metric, the comparison period and a suggested action.
// These are automated interpretations of correlations, not proof of cause.

import { ctr, pctChange, ratio, fmt } from "./metrics";

export type Severity = "high" | "medium" | "low" | "info";
export interface Insight {
  id: string;
  severity: Severity;
  area: "SEO" | "Website" | "Paid" | "Leads" | "Tracking" | "Data";
  title: string;
  evidence: string;      // the supporting metric(s)
  comparison: string;    // which periods
  opportunity: string;
  action: string;
  link?: string;         // route to drill into
}

export interface QueryRow { query: string; is_branded: boolean; clicks: number; impressions: number; ctr: number | null; avg_position: number | null; prev_clicks: number | null; prev_impressions: number | null; top_page?: string | null }
export interface LandingRow { landing_page: string; sessions: number; key_events: number | null; prev_sessions: number | null }
export interface CampaignRow { campaign_id: string; campaign_name: string; cost: number; conversions: number; clicks: number }
export interface DayRow { date: string; ga4_sessions: number | null; ads_cost: number | null; leads: number | null; gsc_clicks: number | null }
export interface IntegrationRow { source: string; label: string; status: string; last_success_at: string | null; last_error: string | null }
export interface AttributionRow { source: string; medium: string; leads: number; booked: number; spend: number | null }
export interface Funnel { [k: string]: number }

export interface InsightInput {
  periodLabel: string;
  compareLabel: string | null;
  queries: QueryRow[];
  landing: LandingRow[];
  campaigns: CampaignRow[];
  prevCampaigns: CampaignRow[];
  days: DayRow[];
  prevDays: DayRow[];
  integrations: IntegrationRow[];
  attribution: AttributionRow[];
  funnel: Funnel | null;
  ga4KeyEventsTotal: number | null;
  now?: Date;
}

/** Rough CTR you'd expect at a given average position on a local-service SERP. Conservative on purpose. */
export function expectedCtr(position: number): number {
  if (position <= 1.5) return 0.15;
  if (position <= 3) return 0.08;
  if (position <= 5) return 0.04;
  if (position <= 10) return 0.015;
  return 0.005;
}

const sumBy = <T,>(rows: T[], f: (r: T) => number | null) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);
const hasAny = <T,>(rows: T[], f: (r: T) => number | null) => rows.some((r) => f(r) != null);

export function buildInsights(x: InsightInput): Insight[] {
  const out: Insight[] = [];
  const cmp = x.compareLabel ?? "no comparison selected";
  const now = x.now ?? new Date();

  // --- Data health -------------------------------------------------------
  for (const i of x.integrations) {
    if (i.status === "error") {
      out.push({ id: `data-err-${i.source}`, severity: "high", area: "Data", title: `${i.label} sync is failing`,
        evidence: (i.last_error ?? "Unknown error").slice(0, 200), comparison: "Latest sync attempt",
        opportunity: "Numbers from this source are stale until it recovers.", action: "Open Integrations and retry, or reconnect the account.", link: "/integrations" });
    } else if (i.status === "connected" && i.last_success_at && now.getTime() - new Date(i.last_success_at).getTime() > 2.5 * 86400000) {
      out.push({ id: `data-stale-${i.source}`, severity: "medium", area: "Data", title: `${i.label} hasn't synced in over 2 days`,
        evidence: `Last success ${new Date(i.last_success_at).toLocaleString("en-IN")}`, comparison: "Expected daily",
        opportunity: "Recent days may be missing.", action: "Run a manual sync from Integrations.", link: "/integrations" });
    }
  }
  const pending = x.integrations.filter((i) => ["pending_authorization", "pending_approval", "not_configured"].includes(i.status));
  if (pending.length) {
    out.push({ id: "data-pending", severity: "info", area: "Data", title: `${pending.length} source${pending.length > 1 ? "s" : ""} not connected yet`,
      evidence: pending.map((p) => p.label).join(", "), comparison: "Current status",
      opportunity: "Sections that rely on these show 'Not available' instead of guessing.", action: "See Integrations for what each one needs.", link: "/integrations" });
  }

  // --- Tracking ----------------------------------------------------------
  if (x.funnel) {
    const ga4Bookings = x.funnel.ga4_bookings_confirmed ?? 0;
    const crmBooked = x.funnel.crm_booked ?? 0;
    if (x.ga4KeyEventsTotal === 0 && (ga4Bookings > 0 || (x.funnel.ga4_phone_clicks ?? 0) > 0)) {
      out.push({ id: "trk-key-events", severity: "high", area: "Tracking", title: "GA4 is receiving lead events but none are marked as key events",
        evidence: `${fmt.int(ga4Bookings)} appointment_confirmed and ${fmt.int(x.funnel.ga4_phone_clicks)} phone_call_click events, 0 key events`,
        comparison: x.periodLabel, opportunity: "GA4 conversion rates and channel reports read zero, hiding which traffic produces enquiries.",
        action: "In GA4 Admin → Key events, mark appointment_confirmed, phone_call_click, whatsapp_click and video_consult_request (needs Editor role)." });
    }
    if (ga4Bookings > 0 && crmBooked === 0 && x.integrations.find((i) => i.source === "wordpress")?.status !== "connected") {
      out.push({ id: "trk-crm-gap", severity: "medium", area: "Tracking", title: "Bookings are happening but none are reaching the CRM",
        evidence: `${fmt.int(ga4Bookings)} confirmed bookings in GA4, 0 in the CRM`, comparison: x.periodLabel,
        opportunity: "Without names and sources on each booking, cost per patient can't be measured.",
        action: "Install the WordPress lead-capture snippet so each booking and form lands here with its source.", link: "/integrations" });
    }
    const adsConv = x.funnel.ads_conversions ?? 0;
    if (adsConv > 0 && crmBooked > 0 && adsConv > crmBooked * 3) {
      out.push({ id: "trk-ads-inflated", severity: "medium", area: "Tracking", title: "Google Ads reports far more conversions than real bookings",
        evidence: `${fmt.dec(adsConv)} Ads conversions vs ${fmt.int(crmBooked)} booked appointments`, comparison: x.periodLabel,
        opportunity: "Bidding is optimising toward taps (phone, WhatsApp, directions), not patients.",
        action: "Keep taps as secondary conversions and make confirmed bookings (plus imported offline completions) the primary goal." });
    }
  }

  // --- SEO -----------------------------------------------------------------
  const curClicks = sumBy(x.days, (d) => d.gsc_clicks), prevClicks = sumBy(x.prevDays, (d) => d.gsc_clicks);
  if (hasAny(x.days, (d) => d.gsc_clicks) && hasAny(x.prevDays, (d) => d.gsc_clicks) && prevClicks >= 20) {
    const ch = pctChange(curClicks, prevClicks)!;
    if (Math.abs(ch) >= 0.2) {
      out.push({ id: "seo-trend", severity: ch < 0 ? "high" : "info", area: "SEO",
        title: `Organic search clicks ${ch < 0 ? "fell" : "rose"} ${fmt.pct(Math.abs(ch), 0)}`,
        evidence: `${fmt.int(curClicks)} clicks vs ${fmt.int(prevClicks)}`, comparison: `${x.periodLabel} vs ${cmp}`,
        opportunity: ch < 0 ? "Fewer people reaching the site from Google without paying." : "Momentum worth reinforcing.",
        action: ch < 0 ? "Check the queries and pages below for the biggest losses; look for ranking drops or seasonality." : "See which pages gained and add internal links to them.", link: "/seo" });
    }
  }

  const lowCtr = x.queries
    .filter((q) => !q.is_branded && q.impressions >= 100 && q.avg_position != null && q.avg_position <= 10)
    .map((q) => ({ q, exp: expectedCtr(q.avg_position!), act: ctr(q.clicks, q.impressions) ?? 0 }))
    .filter((r) => r.act < r.exp * 0.5)
    .sort((a, b) => b.q.impressions - a.q.impressions)
    .slice(0, 5);
  if (lowCtr.length) {
    const missed = lowCtr.reduce((s, r) => s + Math.max(0, Math.round(r.q.impressions * r.exp - r.q.clicks)), 0);
    out.push({ id: "seo-lowctr", severity: "high", area: "SEO", title: `${lowCtr.length} high-visibility searches get few clicks`,
      evidence: lowCtr.map((r) => `“${r.q.query}” ${fmt.int(r.q.impressions)} impr, pos ${fmt.dec(r.q.avg_position)}, CTR ${fmt.pct(r.act)}`).join("; "),
      comparison: x.periodLabel,
      opportunity: `Roughly ${fmt.int(missed)} extra clicks if CTR matched a typical rate for those positions (estimate).`,
      action: "Rewrite the title and meta description of the ranking page to match the search wording; add price or hours where relevant.", link: "/seo" });
  }

  const movers = x.queries.filter((q) => q.prev_clicks != null && (q.prev_clicks >= 5 || q.clicks >= 5));
  const losers = movers.map((q) => ({ q, d: q.clicks - (q.prev_clicks ?? 0) })).filter((r) => r.d <= -5).sort((a, b) => a.d - b.d).slice(0, 3);
  if (losers.length) {
    out.push({ id: "seo-losers", severity: "medium", area: "SEO", title: "Searches losing clicks",
      evidence: losers.map((r) => `“${r.q.query}” ${r.q.prev_clicks}→${r.q.clicks}`).join("; "), comparison: `${x.periodLabel} vs ${cmp}`,
      opportunity: "Recover lost organic traffic.", action: "Check the ranking page for each query in Search Console and compare with the current top results.", link: "/seo" });
  }

  // --- Website -------------------------------------------------------------
  const falling = x.landing.filter((l) => (l.prev_sessions ?? 0) >= 30)
    .map((l) => ({ l, ch: pctChange(l.sessions, l.prev_sessions)! })).filter((r) => r.ch <= -0.3).sort((a, b) => a.ch - b.ch).slice(0, 4);
  if (falling.length) {
    out.push({ id: "web-falling", severity: "medium", area: "Website", title: "Landing pages with falling traffic",
      evidence: falling.map((r) => `${shortPath(r.l.landing_page)} ${fmt.int(r.l.prev_sessions)}→${fmt.int(r.l.sessions)} (${fmt.delta(r.ch)})`).join("; "),
      comparison: `${x.periodLabel} vs ${cmp}`, opportunity: "These pages fed enquiries before.",
      action: "Check whether the drop is organic or paid (Website tab, by channel) and whether the page changed.", link: "/website" });
  }

  const curSess = sumBy(x.days, (d) => d.ga4_sessions), prevSess = sumBy(x.prevDays, (d) => d.ga4_sessions);
  const curLeads = sumBy(x.days, (d) => d.leads), prevLeads = sumBy(x.prevDays, (d) => d.leads);
  if (prevSess >= 100 && hasAny(x.days, (d) => d.leads)) {
    const sCh = pctChange(curSess, prevSess)!; const lCh = prevLeads > 0 ? pctChange(curLeads, prevLeads)! : null;
    if (sCh >= 0.2 && (lCh == null ? curLeads === 0 : lCh <= 0)) {
      out.push({ id: "web-traffic-no-leads", severity: "medium", area: "Website", title: "More visitors, no more leads",
        evidence: `Sessions ${fmt.delta(sCh)} (${fmt.int(prevSess)}→${fmt.int(curSess)}); leads ${fmt.int(prevLeads)}→${fmt.int(curLeads)}`,
        comparison: `${x.periodLabel} vs ${cmp}`, opportunity: "Extra traffic isn't converting — either it's low-intent or the path to book is leaking.",
        action: "Look at which channel grew (Website tab) and at booking-click → confirmed-booking drop-off.", link: "/website" });
    }
  }

  // --- Paid ----------------------------------------------------------------
  const prevById = new Map(x.prevCampaigns.map((c) => [c.campaign_id, c]));
  for (const c of x.campaigns) {
    const p = prevById.get(c.campaign_id);
    if (!p || c.conversions < 3 || p.conversions < 3) continue;
    const cpa = ratio(c.cost, c.conversions)!, pcpa = ratio(p.cost, p.conversions)!;
    const ch = pctChange(cpa, pcpa)!;
    if (ch >= 0.25) {
      out.push({ id: `paid-cpa-${c.campaign_id}`, severity: "high", area: "Paid", title: `Cost per conversion up ${fmt.pct(ch, 0)} on ${c.campaign_name}`,
        evidence: `${fmt.inr(pcpa)} → ${fmt.inr(cpa)} (${fmt.dec(p.conversions)} → ${fmt.dec(c.conversions)} conversions)`,
        comparison: `${x.periodLabel} vs ${cmp}`, opportunity: "Same budget is buying fewer enquiries.",
        action: "Review search terms for new irrelevant matches and check impression share lost to rank.", link: "/paid" });
    }
  }
  const totalSpend = sumBy(x.campaigns, (c) => c.cost);
  const gAttr = x.attribution.find((a) => a.source === "google" && ["cpc", "ppc", "paid"].includes(a.medium));
  if (totalSpend > 2000 && x.integrations.find((i) => i.source === "wordpress")?.status === "connected" && (!gAttr || gAttr.leads === 0)) {
    out.push({ id: "paid-no-crm", severity: "high", area: "Paid", title: "Google Ads spend with no identified leads",
      evidence: `${fmt.inr(totalSpend)} spent; 0 CRM leads with google / cpc as first touch`, comparison: x.periodLabel,
      opportunity: "Spend that can't be tied to a person can't be judged on patients.",
      action: "Check that the ads' final URL suffix carries UTMs and that bookings reach the CRM.", link: "/attribution" });
  }
  const priced = x.attribution.filter((a) => a.spend != null && a.spend > 0 && a.leads > 0)
    .map((a) => ({ a, cpl: ratio(a.spend, a.leads)! })).sort((p, q) => p.cpl - q.cpl);
  if (priced.length >= 2) {
    out.push({ id: "paid-cheapest", severity: "info", area: "Leads", title: `${priced[0].a.source} / ${priced[0].a.medium} is the cheapest paid lead source`,
      evidence: priced.map((p) => `${p.a.source}/${p.a.medium} ${fmt.inr(p.cpl)} per lead`).join("; "), comparison: x.periodLabel,
      opportunity: "Shift budget toward the lower cost per lead if lead quality holds.", action: "Compare booking rates by source before moving budget.", link: "/attribution" });
  }

  // --- Anomalies (trailing z-score on daily series) ------------------------
  for (const [key, label, area] of [["ga4_sessions", "Website sessions", "Website"], ["ads_cost", "Ad spend", "Paid"]] as const) {
    const vals = x.days.map((d) => d[key]).filter((v): v is number => v != null);
    if (vals.length < 14) continue;
    const last = x.days.slice(-3);
    const base = vals.slice(0, -3);
    const mean = base.reduce((s, v) => s + v, 0) / base.length;
    const sd = Math.sqrt(base.reduce((s, v) => s + (v - mean) ** 2, 0) / base.length);
    if (sd === 0) continue;
    for (const d of last) {
      const v = d[key]; if (v == null) continue;
      const z = (v - mean) / sd;
      if (Math.abs(z) >= 3) {
        out.push({ id: `anom-${key}-${d.date}`, severity: "medium", area, title: `Unusual ${label.toLowerCase()} on ${d.date}`,
          evidence: `${key === "ads_cost" ? fmt.inr(v) : fmt.int(v)} vs typical ${key === "ads_cost" ? fmt.inr(mean) : fmt.int(mean)} (${z > 0 ? "+" : ""}${z.toFixed(1)}σ)`,
          comparison: `Earlier days in ${x.periodLabel}`, opportunity: "Spikes can mean bot traffic or a budget change; dips can mean a broken tag or paused campaign.",
          action: "Check the source breakdown for that day.", link: area === "Paid" ? "/paid" : "/website" });
      }
    }
  }

  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function shortPath(url: string): string {
  try { const u = new URL(url, "https://elitesdental.com"); return u.pathname === "/" ? "Home" : u.pathname; } catch { return url; }
}
