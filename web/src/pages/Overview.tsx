import { useMemo } from "react";
import { Kpi, KpiRow, Loading, Page, Section, Tag, TrendChart, useRangeArgs, ErrorBox } from "../components/ui";
import { useFilters, useRpc, useTable } from "../state";
import { fmt, ratio, sum } from "../lib/metrics";
import { InsightList, useInsights } from "./Insights";
import { Logo, SOURCE_MARK } from "../components/Logo";

export const C = { navy: "#0B1F3A", gold: "#C9A84C", teal: "#2E7D7A", rust: "#B5543A", slate: "#5B6B82", plum: "#6B4E7A" };

export function useSeries() {
  const { range, prevRange } = useRangeArgs();
  const cur = useRpc<any[]>("rpc_daily_series", range);
  const prev = useRpc<any[]>("rpc_daily_series", prevRange);
  return { cur, prev };
}

export function totals(rows: any[] | null) {
  const r = rows ?? [];
  const s = (k: string) => sum(r, (x) => (x[k] == null ? null : Number(x[k])));
  const gscImpr = s("gsc_impressions");
  const posW = sum(r, (x) => (x.gsc_position == null ? null : Number(x.gsc_position) * Number(x.gsc_impressions ?? 0)));
  return {
    gsc_clicks: s("gsc_clicks"), gsc_impressions: gscImpr, gsc_position: gscImpr ? ratio(posW, gscImpr) : null,
    ga4_sessions: s("ga4_sessions"), ga4_engaged: s("ga4_engaged"), ga4_users: s("ga4_users"),
    gbp_views: s("gbp_views"), gbp_calls: s("gbp_calls"), gbp_directions: s("gbp_directions"), gbp_website: s("gbp_website"),
    ads_impressions: s("ads_impressions"), ads_clicks: s("ads_clicks"), ads_cost: s("ads_cost"), ads_conversions: s("ads_conversions"),
    meta_spend: s("meta_spend"),
    // The CRM is always on (manual entry works without integrations), so an empty period is a real zero.
    leads: rows ? s("leads") ?? 0 : null, bookings: rows ? s("bookings") ?? 0 : null, completed: rows ? s("completed") ?? 0 : null,
    revenue: s("revenue"),
  };
}

export default function Overview() {
  const f = useFilters();
  const { range } = useRangeArgs();
  const { cur, prev } = useSeries();
  const funnel = useRpc<Record<string, number>>("rpc_funnel", range);
  const integ = useTable<any>("integrations", (q) => q.select("*").order("source"));
  const t = useMemo(() => totals(cur.data), [cur.data]);
  const p = useMemo(() => (f.prev ? totals(prev.data) : null), [prev.data, f.prev]);
  const insights = useInsights();
  const pv = (k: keyof ReturnType<typeof totals>) => (p ? p[k] : undefined);
  const spend = (t.ads_cost ?? 0) + (t.meta_spend ?? 0);
  const totalSpend = t.ads_cost == null && t.meta_spend == null ? null : spend;

  return (
    <Page eyebrow="Elites Dental Care · Marketing intelligence" title="Overview"
      intro={<>Discovery to patients for <strong>{f.label.toLowerCase()}</strong>. Each number keeps its own source; systems that count the same visit differently are never added together.</>}>
      {cur.error && <ErrorBox msg={cur.error} />}
      <div className="src-strip" aria-label="Data sources">
        {(integ.data ?? []).filter((i) => SOURCE_MARK[i.source]).map((i) => (
          <a key={i.source} href="#/integrations" className={`src-pill ${i.status === "connected" ? "ok" : i.status === "pending_approval" ? "wait" : ""}`} title={`${i.label}: ${i.status.replace(/_/g, " ")}`} style={{ textDecoration: "none", color: "inherit" }}>
            <Logo id={SOURCE_MARK[i.source]} size={22} />{i.label.split(" (")[0]}<span className="dot" />
          </a>
        ))}
      </div>

      <Section n="01" title="Discovery">
        <KpiRow>
          <Kpi logo="gsc" big label="Google Search impressions" value={t.gsc_impressions} prev={pv("gsc_impressions")} defKey="gsc_impressions" format="compact" />
          <Kpi logo="gbp" big label="Business Profile views" value={t.gbp_views} prev={pv("gbp_views")} defKey="gbp_views" format="compact" />
          <Kpi logo="google_ads" big label="Ad impressions" value={t.ads_impressions} prev={pv("ads_impressions")} format="compact" />
        </KpiRow>
      </Section>

      <Section n="02" title="Visits and actions">
        <KpiRow>
          <Kpi logo="ga4" label="Website sessions" value={t.ga4_sessions} prev={pv("ga4_sessions")} defKey="ga4_sessions" />
          <Kpi logo="gsc" label="Organic search clicks" value={t.gsc_clicks} prev={pv("gsc_clicks")} defKey="gsc_clicks" />
          <Kpi logo="gbp" label="Profile call taps" value={t.gbp_calls} prev={pv("gbp_calls")} defKey="gbp_calls" />
          <Kpi logo="gbp" label="Direction requests" value={t.gbp_directions} prev={pv("gbp_directions")} defKey="gbp_directions" />
          <Kpi logo="google_ads" label="Ad clicks" value={t.ads_clicks} prev={pv("ads_clicks")} />
        </KpiRow>
        <TrendChart rows={cur.data} prevRows={f.prev ? prev.data : null} series={[
          { key: "ga4_sessions", label: "Website sessions", color: C.navy, kind: "area" },
          { key: "gsc_clicks", label: "Organic clicks", color: C.gold },
          { key: "gbp_calls", label: "Profile call taps", color: C.teal },
        ]} />
      </Section>

      <Section n="03" title="Leads, bookings, revenue" note="CRM figures count identified people. Google Ads conversions are Google's own attribution and include taps, so they sit beside the CRM, not inside it.">
        <KpiRow>
          <Kpi logo="crm" label="CRM leads" value={t.leads} prev={pv("leads")} defKey="crm_leads" />
          <Kpi logo="crm" label="Appointments booked" value={t.bookings} prev={pv("bookings")} defKey="crm_booked" />
          <Kpi logo="crm" label="Completed" value={t.completed} prev={pv("completed")} defKey="crm_completed" />
          <Kpi logo="rupee" label="Revenue recorded" value={t.revenue} prev={pv("revenue")} format="inr" defKey="revenue" />
          <Kpi logo="google_ads" label="Google Ads conversions" value={t.ads_conversions} prev={pv("ads_conversions")} format="dec" defKey="ads_conversions" />
        </KpiRow>
        {funnel.data ? <FunnelStrip f={funnel.data} /> : <Loading h={80} />}
      </Section>

      <Section n="04" title="Spend and efficiency">
        <KpiRow>
          <Kpi logo="google_ads" label="Paid spend" value={totalSpend} prev={p ? ((p.ads_cost ?? 0) + (p.meta_spend ?? 0)) || null : undefined} format="inr" defKey="ads_cost" invert />
          <Kpi logo="google_ads" label="Cost per Ads conversion" value={ratio(t.ads_cost, t.ads_conversions)} prev={p ? ratio(p.ads_cost, p.ads_conversions) : undefined} format="inr" defKey="ads_cpa" invert />
          <Kpi logo="crm" label="Cost per CRM lead (all paid)" value={t.leads ? ratio(totalSpend, t.leads) : null} format="inr" defKey="cpl" invert sub="see Attribution for per-channel" />
          <Kpi logo="rupee" label="ROAS" value={t.revenue != null && totalSpend ? ratio(t.revenue, totalSpend) : null} format="x" defKey="roas" />
        </KpiRow>
        <TrendChart rows={cur.data} series={[
          { key: "ads_cost", label: "Ad spend", color: C.gold, kind: "bar", format: "inr" },
          { key: "leads", label: "CRM leads", color: C.navy, axis: "right" },
          { key: "ads_conversions", label: "Ads conversions", color: C.rust, axis: "right", format: "dec" },
        ]} />
      </Section>

      <Section n="05" title="What needs attention" right={<a className="btn ghost" href="#/insights">All insights →</a>}>
        <InsightList items={insights.items?.slice(0, 4) ?? null} />
      </Section>

      <Section n="06" title="Data freshness">
        <div className="fresh">
          {(integ.data ?? []).map((i: any) => (
            <div key={i.source} className="fresh-item">
              <span>{i.label}</span>
              <StatusTag s={i.status} />
              <span className="muted">{i.latest_imported ? `to ${i.latest_imported}` : "—"}</span>
            </div>
          ))}
        </div>
      </Section>
    </Page>
  );
}

export function StatusTag({ s }: { s: string }) {
  const m: Record<string, [any, string]> = {
    connected: ["good", "Connected"], pending_authorization: ["warn", "Pending authorization"], pending_approval: ["warn", "Pending Google approval"],
    error: ["bad", "Error"], not_configured: ["neutral", "Not configured"], disabled: ["neutral", "Disabled"],
  };
  const [tone, label] = m[s] ?? ["neutral", s];
  return <Tag tone={tone}>{label}</Tag>;
}

function FunnelStrip({ f }: { f: Record<string, number> }) {
  const steps = [
    { label: "Book-button clicks", v: f.ga4_book_clicks, src: "GA4" },
    { label: "Phone taps (site)", v: f.ga4_phone_clicks, src: "GA4" },
    { label: "WhatsApp taps", v: f.ga4_whatsapp_clicks, src: "GA4" },
    { label: "Directions taps", v: f.ga4_directions_clicks, src: "GA4" },
    { label: "Video consult requests", v: f.ga4_video_consult, src: "GA4" },
    { label: "Bookings confirmed", v: f.ga4_bookings_confirmed, src: "GA4" },
    { label: "Leads identified", v: f.crm_leads, src: "CRM" },
    { label: "Qualified", v: f.crm_qualified, src: "CRM" },
    { label: "Booked", v: f.crm_booked, src: "CRM" },
    { label: "Completed", v: f.crm_completed, src: "CRM" },
  ];
  return (
    <div className="funnel">
      {steps.map((s) => (
        <div key={s.label} className="funnel-step">
          <div className="funnel-v">{fmt.int(s.v)}</div>
          <div className="funnel-l">{s.label}</div>
          <div className="funnel-s">{s.src}</div>
        </div>
      ))}
    </div>
  );
}
