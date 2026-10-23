// Shared data + building blocks for Funnel Analytics, Budget Simulator and AI Intelligence.
import { useRangeArgs } from "../components/ui";
import { useFilters, useRpc, useTable } from "../state";
import { ACTION_EVENTS, BOOKING_EVENTS, CHANNELS, channelOfGa4, channelOfLead, withRates, type Channel, type Stage } from "../lib/funnel";
import { fmt } from "../lib/metrics";
import { totals, useSeries } from "./Overview";

const EVENTS = [...ACTION_EVENTS, ...BOOKING_EVENTS];
const NEVER = "1900-01-01";

export function useEvents(start: string | null, end: string | null) {
  return useTable<any>("ga4_daily_events", (q) => q.select("date,event_name,channel_group,source,campaign,page_path,event_count")
    .in("event_name", EVENTS).gte("date", start ?? NEVER).lte("date", end ?? NEVER).limit(20000), [start, end]);
}

export function useFunnelData() {
  const f = useFilters();
  const { range, prevRange, cmp } = useRangeArgs();
  const { cur, prev } = useSeries();
  const acq = useRpc<any[]>("rpc_ga4_acquisition", range);
  const acqPrev = useRpc<any[]>("rpc_ga4_acquisition", prevRange);
  const ev = useEvents(f.range.start, f.range.end);
  const evPrev = useEvents(f.prev?.start ?? null, f.prev?.end ?? null);
  const camps = useRpc<any[]>("rpc_ads_campaigns", range);
  const landing = useRpc<any[]>("rpc_ga4_landing", cmp);
  const leads = useTable<any>("leads", (q) => q.select("id,name,first_inquiry_at,first_source,first_medium,first_campaign,inquiry_type,status,requested_service")
    .eq("is_test", false).gte("first_inquiry_at", f.range.start + "T00:00:00+05:30").lte("first_inquiry_at", f.range.end + "T23:59:59+05:30").limit(5000), [f.range.start, f.range.end]);
  const appts = useTable<any>("real_appointments", (q) => q.select("id,lead_id,booked_at,status")
    .gte("booked_at", f.range.start + "T00:00:00+05:30").lte("booked_at", f.range.end + "T23:59:59+05:30").limit(5000), [f.range.start, f.range.end]);
  const revenue = useTable<any>("real_revenue", (q) => q.select("lead_id,amount_inr,collected_on").gte("collected_on", f.range.start).lte("collected_on", f.range.end).limit(10000), [f.range.start, f.range.end]);
  const loading = [cur, acq, ev, camps, leads, appts].some((s) => s.loading);
  const error = [cur, acq, ev, camps, leads, appts].map((s) => s.error).find(Boolean) ?? null;
  return { cur, prev, acq, acqPrev, ev, evPrev, camps, landing, leads, appts, revenue, loading, error, hasPrev: !!f.prev };
}

export type FunnelData = ReturnType<typeof useFunnelData>;

/** Per-channel GA4 sessions/engaged/actions/bookings. */
export function byChannel(acq: any[] | null, ev: any[] | null) {
  const z = () => ({ sessions: 0, engaged: 0, actions: 0, bookings: 0 });
  const m = Object.fromEntries(CHANNELS.map((c) => [c, z()])) as Record<Channel, ReturnType<typeof z>>;
  for (const r of acq ?? []) { const c = channelOfGa4(r.channel_group, r.source, r.campaign); m[c].sessions += +r.sessions; m[c].engaged += +r.engaged_sessions; }
  for (const r of ev ?? []) {
    const c = channelOfGa4(r.channel_group, r.source, r.campaign);
    if (ACTION_EVENTS.includes(r.event_name)) m[c].actions += +r.event_count; else m[c].bookings += +r.event_count;
  }
  return m;
}

/** Build the funnel for one channel ("all" = whole business). Each stage names the system it comes from. */
export function buildStages(d: FunnelData, channel: Channel | "all", which: "cur" | "prev" = "cur"): Stage[] {
  const series = which === "cur" ? d.cur.data : d.prev.data;
  const t = totals(series);
  const ch = byChannel(which === "cur" ? d.acq.data : d.acqPrev.data, which === "cur" ? d.ev.data : d.evPrev.data);
  const sumCh = (k: "sessions" | "engaged" | "actions" | "bookings") => channel === "all" ? CHANNELS.reduce((a, c) => a + ch[c][k], 0) : ch[channel][k];
  const leads = which === "cur" ? (d.leads.data ?? []) : null;
  const inCh = (l: any) => channel === "all" || channelOfLead(l.first_source, l.first_medium, l.inquiry_type) === channel;
  const myLeads = leads?.filter(inCh) ?? null;
  const ids = new Set((myLeads ?? []).map((l) => l.id));
  const appts = which === "cur" ? (d.appts.data ?? []).filter((a) => channel === "all" || (a.lead_id && ids.has(a.lead_id))) : null;
  const rev = which === "cur" ? (d.revenue.data ?? []).filter((r) => channel === "all" || (r.lead_id && ids.has(r.lead_id))) : null;

  const seen = channel === "all" ? sumN(t.ads_impressions, t.gsc_impressions, t.gbp_views)
    : channel === "Paid search" ? t.ads_impressions : channel === "Organic search" ? t.gsc_impressions : channel === "Business Profile" ? t.gbp_views : null;
  const clicked = channel === "all" ? sumN(t.ads_clicks, t.gsc_clicks, t.gbp_website)
    : channel === "Paid search" ? t.ads_clicks : channel === "Organic search" ? t.gsc_clicks : channel === "Business Profile" ? t.gbp_website : null;
  const crm = (n: number | null) => (n == null ? null : n);
  return withRates([
    { key: "seen", label: "Seen on Google", value: seen, source: srcSeen(channel), note: "Impressions — one person can be counted many times." },
    { key: "clicked", label: "Clicked through", value: clicked, source: srcClick(channel) },
    { key: "visited", label: "Visited the website", value: series || d.acq.data ? sumCh("sessions") : null, source: "GA4 sessions" },
    { key: "engaged", label: "Engaged on the site", value: sumCh("engaged"), source: "GA4 engaged sessions (10s+, 2+ pages or a key event)" },
    { key: "action", label: "Took a lead action", value: sumCh("actions"), source: "GA4 events: phone, WhatsApp, book button, directions, forms", note: "Taps and clicks, not people — one person can tap twice." },
    { key: "booked_online", label: "Booked online", value: sumCh("bookings"), source: "GA4 booking-confirmed events" },
    { key: "lead", label: "Became a CRM lead", value: crm(myLeads ? myLeads.length : null), source: "CRM (test leads excluded)" },
    { key: "appt", label: "Appointment booked", value: crm(appts ? appts.filter((a) => a.status !== "cancelled").length : null), source: "CRM appointments" },
    { key: "done", label: "Visited the clinic", value: crm(appts ? appts.filter((a) => a.status === "completed").length : null), source: "CRM appointments marked completed" },
    { key: "paid", label: "Payment received", value: rev ? rev.length : null, source: "Revenue entries (payments)", note: rev && rev.length ? `₹${Math.round(rev.reduce((a, r) => a + +r.amount_inr, 0)).toLocaleString("en-IN")} collected` : undefined },
  ]);
}

const sumN = (...xs: (number | null)[]) => (xs.every((x) => x == null) ? null : xs.reduce<number>((a, x) => a + (x ?? 0), 0));
const srcSeen = (c: Channel | "all") => c === "all" ? "Google Ads + Search Console + Business Profile impressions" : c === "Paid search" ? "Google Ads impressions" : c === "Organic search" ? "Search Console impressions" : c === "Business Profile" ? "Business Profile views" : "Not measured for this channel";
const srcClick = (c: Channel | "all") => c === "all" ? "Google Ads clicks + Search Console clicks + Profile website taps" : c === "Paid search" ? "Google Ads clicks" : c === "Organic search" ? "Search Console clicks" : c === "Business Profile" ? "Profile website taps" : "Not measured for this channel";

// ---------------- Funnel diagram ----------------
export function FunnelDiagram({ stages, prev, onPick, selected }: { stages: Stage[]; prev?: Stage[] | null; onPick?: (s: Stage) => void; selected?: string | null }) {
  const vals = stages.map((s) => s.value ?? 0);
  const max = Math.max(...vals, 1);
  // Log scale so an 8,000-impression top and an 8-booking bottom are both readable.
  const w = (v: number | null) => (v == null || v <= 0 ? 0.14 : 0.14 + 0.86 * (Math.log10(v + 1) / Math.log10(max + 1)));
  const H = 46, G = 22, W = 1000, total = stages.length * (H + G);
  return (
    <div className="funnel-wrap">
      <svg viewBox={`0 0 ${W} ${total}`} className="funnel-svg" role="img" aria-label="Funnel diagram">
        {stages.map((s, i) => {
          const y = i * (H + G), top = w(s.value) * 600, bot = w(stages[i + 1]?.value ?? s.value) * 600, cx = 330;
          const p = prev?.find((x) => x.key === s.key)?.value;
          const ch = p != null && s.value != null && p > 0 ? (s.value - p) / p : null;
          const missing = s.value == null;
          return (
            <g key={s.key} className={`fstage ${missing ? "missing" : ""} ${selected === s.key ? "on" : ""}`} onClick={() => onPick?.(s)} style={{ cursor: onPick ? "pointer" : "default" }}>
              <title>{`${s.label}: ${s.value == null ? "not measured" : fmt.int(s.value)} — ${s.source}`}</title>
              <polygon points={`${cx - top / 2},${y} ${cx + top / 2},${y} ${cx + bot / 2},${y + H} ${cx - bot / 2},${y + H}`} className={`fpoly f${Math.min(i, 9)}`} />
              <text x={cx} y={y + H / 2 + 6} textAnchor="middle" className="fval">{missing ? "—" : fmt.int(s.value)}</text>
              <text x={660} y={y + 19} className="flabel">{s.label}</text>
              <text x={660} y={y + 38} className="fsub">
                {missing ? "not measured yet" : s.rateFromPrev != null ? `${fmt.pct(s.rateFromPrev, s.rateFromPrev < 0.1 ? 1 : 0)} of previous step` : "top of funnel"}
                {ch != null ? `  ·  ${ch >= 0 ? "▲" : "▼"} ${fmt.pct(Math.abs(ch), 0)} vs prev` : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
