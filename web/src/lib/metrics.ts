// Metric arithmetic + definitions. Every derived number on the dashboard comes from here.
// Rule: if an input is missing, the result is null ("Not available"), never 0.

export type Num = number | null | undefined;

const ok = (n: Num): n is number => typeof n === "number" && Number.isFinite(n);

export function ratio(a: Num, b: Num): number | null {
  if (!ok(a) || !ok(b) || b === 0) return null;
  return a / b;
}
export const ctr = (clicks: Num, impressions: Num) => ratio(clicks, impressions);
export const cpc = (cost: Num, clicks: Num) => ratio(cost, clicks);
export const cpm = (cost: Num, impressions: Num) => { const r = ratio(cost, impressions); return r == null ? null : r * 1000; };
export const costPer = (cost: Num, count: Num) => ratio(cost, count);
export const convRate = (conv: Num, base: Num) => ratio(conv, base);
/** ROAS needs both real revenue and real spend. Revenue of 0 with spend is a valid 0x. */
export function roas(revenue: Num, spend: Num): number | null {
  if (!ok(revenue) || !ok(spend) || spend === 0) return null;
  return revenue / spend;
}

/** % change vs comparison. Null when there is no comparison or the base is 0. */
export function pctChange(cur: Num, prev: Num): number | null {
  if (!ok(cur) || !ok(prev) || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

export function sum<T>(rows: T[], f: (r: T) => Num): number | null {
  let s = 0, any = false;
  for (const r of rows) { const v = f(r); if (ok(v)) { s += v; any = true; } }
  return any ? s : null;
}

/** Impression-weighted average position. */
export function weightedPosition(rows: { impressions: Num; position: Num }[]): number | null {
  let w = 0, n = 0;
  for (const r of rows) if (ok(r.impressions) && ok(r.position)) { w += r.impressions * r.position; n += r.impressions; }
  return n ? w / n : null;
}

const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export const NA = "Not available";

export const fmt = {
  int: (n: Num) => (ok(n) ? int.format(n) : "—"),
  dec: (n: Num) => (ok(n) ? dec1.format(n) : "—"),
  inr: (n: Num) => (ok(n) ? (Math.abs(n) < 100 ? inr2 : inr0).format(n) : "—"),
  pct: (n: Num, digits = 1) => (ok(n) ? `${(n * 100).toFixed(digits)}%` : "—"),
  x: (n: Num) => (ok(n) ? `${n.toFixed(2)}×` : "—"),
  secs: (n: Num) => {
    if (!ok(n)) return "—";
    const r = Math.round(n);
    return r < 60 ? `${r}s` : `${Math.floor(r / 60)}m ${String(r % 60).padStart(2, "0")}s`;
  },
  delta: (n: Num) => (ok(n) ? `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(1)}%` : ""),
  // Indian short scale: K (thousand), L (lakh), Cr (crore)
  compact: (n: Num) => {
    if (!ok(n)) return "—";
    const a = Math.abs(n), s = n < 0 ? "-" : "";
    const f = (v: number) => (v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, ""));
    if (a < 1e3) return s + int.format(a);
    if (a < 1e5) return s + f(a / 1e3) + "K";
    if (a < 1e7) return s + f(a / 1e5) + "L";
    return s + f(a / 1e7) + "Cr";
  },
};

export interface Definition { key: string; name: string; source: string; formula: string; notes?: string }

/** Shown on the Definitions page and as tooltips. Kept deliberately literal. */
export const DEFINITIONS: Definition[] = [
  { key: "gsc_clicks", name: "Search clicks", source: "Search Console", formula: "Sum of clicks from Google Search results to elitesdental.com", notes: "2–3 day delay. Totals include anonymised queries; query tables do not, so query rows won't add up to the total." },
  { key: "gsc_impressions", name: "Search impressions", source: "Search Console", formula: "Times a page from the site appeared in Google results" },
  { key: "gsc_ctr", name: "Search CTR", source: "Search Console", formula: "Clicks ÷ impressions" },
  { key: "gsc_position", name: "Average position", source: "Search Console", formula: "Σ(position × impressions) ÷ Σ impressions", notes: "An average across all searches and devices, not a fixed rank. Lower is better." },
  { key: "ga4_sessions", name: "Sessions", source: "GA4", formula: "Sessions started on the site" },
  { key: "ga4_engaged", name: "Engaged sessions", source: "GA4", formula: "Sessions lasting 10s+, with a key event, or 2+ page views" },
  { key: "ga4_engagement_rate", name: "Engagement rate", source: "GA4", formula: "Engaged sessions ÷ sessions" },
  { key: "ga4_users", name: "Users", source: "GA4", formula: "Sum of daily active users", notes: "Summed across days and segments, so it overstates unique people over long ranges. Use as a trend, not a headcount." },
  { key: "ga4_key_events", name: "Key events", source: "GA4", formula: "Events marked as key events in GA4", notes: "As of 30 Sep 2026 no events were marked as key events in this property, so this reads 0 until that's done." },
  { key: "gbp_views", name: "Profile views", source: "Business Profile", formula: "Search + Maps impressions, mobile + desktop", notes: "Counted per day by Google; one person on several days counts several times." },
  { key: "gbp_calls", name: "Call taps", source: "Business Profile", formula: "Taps on the Call button", notes: "A tap, not a completed or answered call." },
  { key: "gbp_directions", name: "Direction requests", source: "Business Profile", formula: "Taps on Directions" },
  { key: "ads_cost", name: "Ad spend", source: "Google Ads", formula: "Cost in account currency (INR)" },
  { key: "ads_cpc", name: "CPC", source: "Google Ads", formula: "Spend ÷ clicks" },
  { key: "ads_cpm", name: "CPM", source: "Google Ads", formula: "Spend ÷ impressions × 1,000" },
  { key: "ads_conversions", name: "Ads conversions", source: "Google Ads", formula: "Platform-attributed conversions (all primary actions)", notes: "Google's attribution. Includes phone taps, WhatsApp and directions clicks as well as confirmed bookings. Not the same as patients." },
  { key: "ads_cpa", name: "Cost per Ads conversion", source: "Google Ads", formula: "Spend ÷ Ads conversions" },
  { key: "crm_leads", name: "Leads", source: "CRM", formula: "Identified people (name/phone/email) who enquired, deduplicated by phone, then email, within 90 days", notes: "Test leads excluded." },
  { key: "crm_qualified", name: "Qualified leads", source: "CRM", formula: "Leads with status Qualified, Appointment booked or Completed" },
  { key: "crm_booked", name: "Appointments booked", source: "CRM", formula: "Appointments not cancelled, by booking date" },
  { key: "crm_completed", name: "Completed appointments", source: "CRM", formula: "Appointments marked Completed by the clinic" },
  { key: "lead_to_booking", name: "Lead → booking rate", source: "CRM", formula: "Leads that booked ÷ leads" },
  { key: "booking_to_completion", name: "Booking → completion rate", source: "CRM", formula: "Completed ÷ booked" },
  { key: "cpl", name: "Cost per lead", source: "Google Ads + CRM", formula: "Paid spend ÷ CRM leads whose first touch was that paid channel", notes: "Only where spend can be tied to the channel: google/cpc → Google Ads spend; facebook|instagram/paid → Meta spend." },
  { key: "cost_per_booking", name: "Cost per booked appointment", source: "Google Ads + CRM", formula: "Channel spend ÷ booked appointments from that channel" },
  { key: "revenue", name: "Revenue", source: "CRM (entered by clinic)", formula: "Sum of collected payments entered against leads", notes: "Only what the clinic records. Blank means not entered, not zero sales." },
  { key: "roas", name: "ROAS", source: "CRM + Ads", formula: "Revenue from channel ÷ channel spend", notes: "Shown as Not available unless both revenue and spend exist for the same channel and period." },
  { key: "clarity_sessions", name: "Recorded sessions", source: "Microsoft Clarity", formula: "Human sessions Clarity recorded; bot sessions are counted separately and left out", notes: "One snapshot per day, covering the 24 hours before the 08:00 IST sync. History starts 21 Oct 2026; Clarity's API can't return older days." },
  { key: "clarity_scroll", name: "Average scroll depth", source: "Microsoft Clarity", formula: "How far down the page visitors scrolled, averaged per session", notes: "Clarity's per-segment average, combined across devices weighted by sessions." },
  { key: "clarity_active", name: "Active time per session", source: "Microsoft Clarity", formula: "Time a visitor was actually interacting (scrolling, clicking, typing), per session", notes: "As reported by Clarity, combined across devices weighted by sessions. Time with the tab open but idle is not counted." },
  { key: "clarity_rage", name: "Sessions with rage clicks", source: "Microsoft Clarity", formula: "Share of sessions where someone clicked the same spot rapidly — a sign of frustration" },
  { key: "clarity_dead", name: "Sessions with dead clicks", source: "Microsoft Clarity", formula: "Share of sessions with clicks on something that didn't respond" },
  { key: "clarity_quickback", name: "Sessions with quick-backs", source: "Microsoft Clarity", formula: "Share of sessions where a visitor opened a page and came straight back" },
  { key: "website_conversion_rate", name: "Website conversion rate", source: "GA4", formula: "Confirmed bookings (appointment_confirmed events) ÷ sessions" },
];

export const defOf = (key: string) => DEFINITIONS.find((d) => d.key === key);
