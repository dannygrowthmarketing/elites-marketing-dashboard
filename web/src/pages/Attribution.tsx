import { DataTable, Kpi, KpiRow, Page, Section, useRangeArgs } from "../components/ui";
import { useFilters, useRpc } from "../state";
import { costPer, fmt, ratio, roas, sum } from "../lib/metrics";
import { shortPath } from "../lib/insights";
import { totals, useSeries } from "./Overview";

export default function Attribution() {
  const f = useFilters();
  const { range } = useRangeArgs();
  const attr = useRpc<any[]>("rpc_attribution", range);
  const camp = useRpc<any[]>("rpc_attribution_campaigns", range);
  const funnel = useRpc<Record<string, number>>("rpc_funnel", range);
  const { cur } = useSeries();
  const t = totals(cur.data);
  const rows = (attr.data ?? []).map((r) => ({ ...r, leads: +r.leads, qualified: +r.qualified, booked: +r.booked, completed: +r.completed, revenue: Number(r.revenue), spend: r.spend == null ? null : Number(r.spend) }));
  const g = rows.find((r) => r.source === "google" && ["cpc", "ppc", "paid"].includes(r.medium));
  const fn = funnel.data ? Object.fromEntries(Object.entries(funnel.data).map(([k, v]) => [k, Number(v)])) : null;

  return (
    <Page eyebrow="Attribution" title="Which channels produce patients"
      intro={<>First-touch attribution from the CRM: each lead is credited to the source of their first recorded visit. Spend is joined only where it maps cleanly (google / cpc ↔ Google Ads, facebook|instagram / paid ↔ Meta). Revenue counts only what the clinic has entered.</>}>
      <Section n="01" title="Google Ads: platform vs reality" note="Three systems, three definitions. They describe overlapping events, so they're shown side by side and never summed.">
        <KpiRow>
          <Kpi logo="google_ads" label="Ads spend" value={t.ads_cost} format="inr" />
          <Kpi logo="google_ads" label="Google-attributed conversions" value={fn?.ads_conversions ?? null} format="dec" defKey="ads_conversions" sub="Google's count" />
          <Kpi label="GA4 confirmed bookings (all channels)" value={fn?.ga4_bookings_confirmed ?? null} sub="site event" />
          <Kpi logo="crm" label="CRM leads from google / cpc" value={g?.leads ?? (attr.data ? 0 : null)} sub="identified people" />
          <Kpi label="Booked from google / cpc" value={g?.booked ?? (attr.data ? 0 : null)} />
          <Kpi label="Cost per booked (Ads)" value={g?.booked ? costPer(g.spend, g.booked) : null} format="inr" defKey="cost_per_booking" invert />
        </KpiRow>
      </Section>

      <Section n="02" title="By source / medium">
        <DataTable rows={attr.data ? rows : null} csvName="attribution-source-medium" initialSort={{ key: "leads", dir: -1 }} empty="No CRM leads in this period yet." cols={[
          { key: "source", label: "Source" }, { key: "medium", label: "Medium" },
          { key: "leads", label: "Leads", align: "right", format: "int" },
          { key: "qualified", label: "Qualified", align: "right", format: "int" },
          { key: "booked", label: "Booked", align: "right", format: "int" },
          { key: "completed", label: "Completed", align: "right", format: "int" },
          { key: "l2b", label: "Lead→booking", align: "right", format: "pct", value: (r) => ratio(r.booked, r.leads) },
          { key: "b2c", label: "Booking→done", align: "right", format: "pct", value: (r) => ratio(r.completed, r.booked) },
          { key: "spend", label: "Spend", align: "right", render: (r) => (r.spend == null ? <span className="muted">n/a</span> : fmt.inr(r.spend)), value: (r) => r.spend },
          { key: "cpl", label: "Cost/lead", align: "right", format: "inr", value: (r) => costPer(r.spend, r.leads) },
          { key: "cpq", label: "Cost/qualified", align: "right", format: "inr", value: (r) => costPer(r.spend, r.qualified) },
          { key: "cpb", label: "Cost/booked", align: "right", format: "inr", value: (r) => costPer(r.spend, r.booked) },
          { key: "cpc_done", label: "Cost/completed", align: "right", format: "inr", value: (r) => costPer(r.spend, r.completed) },
          { key: "revenue", label: "Revenue", align: "right", render: (r) => (r.revenue ? fmt.inr(r.revenue) : <span className="muted">—</span>), value: (r) => r.revenue },
          { key: "rpl", label: "Rev/lead", align: "right", format: "inr", value: (r) => (r.revenue ? ratio(r.revenue, r.leads) : null) },
          { key: "roas", label: "ROAS", align: "right", render: (r) => { const x = r.revenue ? roas(r.revenue, r.spend) : null; return x == null ? <span className="muted">Not available</span> : fmt.x(x); }, value: (r) => (r.revenue ? roas(r.revenue, r.spend) : null) },
        ]} />
        <p className="muted small">Organic vs paid: {fmt.int(sum(rows.filter((r) => ["cpc", "ppc", "paid", "paid_social"].includes(r.medium)), (r) => r.leads))} paid-first leads, {fmt.int(sum(rows.filter((r) => !["cpc", "ppc", "paid", "paid_social"].includes(r.medium)), (r) => r.leads))} from everything else in {f.label.toLowerCase()}.</p>
      </Section>

      <Section n="03" title="By campaign, keyword and landing page" note="UTM detail captured on the lead's first visit.">
        <DataTable rows={camp.data?.map((r) => ({ ...r, leads: +r.leads, booked: +r.booked, completed: +r.completed, revenue: Number(r.revenue) })) ?? null}
          csvName="attribution-campaigns" cols={[
          { key: "source", label: "Source" }, { key: "medium", label: "Medium" }, { key: "campaign", label: "Campaign" },
          { key: "term", label: "Keyword" }, { key: "landing_page", label: "Landing", render: (r) => (r.landing_page === "(not set)" ? "—" : shortPath(r.landing_page)) },
          { key: "leads", label: "Leads", align: "right", format: "int" }, { key: "booked", label: "Booked", align: "right", format: "int" },
          { key: "completed", label: "Done", align: "right", format: "int" },
          { key: "revenue", label: "Revenue", align: "right", render: (r) => (r.revenue ? fmt.inr(r.revenue) : "—"), value: (r) => r.revenue },
        ]} />
      </Section>
    </Page>
  );
}
