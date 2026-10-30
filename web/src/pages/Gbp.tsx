import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DataTable, Kpi, KpiRow, Page, Pending, Section, TrendChart, useRangeArgs } from "../components/ui";
import { useFilters, useRpc, useTable } from "../state";
import { fmt } from "../lib/metrics";
import { C, totals, useSeries } from "./Overview";
import { KeywordsSection, ReviewsSection, type Theme } from "./GbpDeep";
import { GBP_CONFIG } from "./gbpConfig";

const LABELS: Record<string, string> = {
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "Views · Search, mobile",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "Views · Search, desktop",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "Views · Maps, mobile",
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "Views · Maps, desktop",
  CALL_CLICKS: "Call taps",
  WEBSITE_CLICKS: "Website clicks",
  BUSINESS_DIRECTION_REQUESTS: "Direction requests",
  BUSINESS_CONVERSATIONS: "Message conversations",
  BUSINESS_BOOKINGS: "Bookings (Reserve with Google)",
};
const ax = { fontSize: 11, fill: "#5C6F6A" };

export default function Gbp() {
  const f = useFilters();
  const { range, prevRange } = useRangeArgs();
  const { cur, prev } = useSeries();
  const metrics = useRpc<any[]>("rpc_gbp_metrics", range);
  const pm = useRpc<any[]>("rpc_gbp_metrics", prevRange);
  const integ = useTable<any>("integrations", (q) => q.select("status,last_error").eq("source", "gbp"));
  const t = totals(cur.data), p = f.prev ? totals(prev.data) : null;
  const m = useMemo(() => new Map((metrics.data ?? []).map((r) => [r.metric, Number(r.value)])), [metrics.data]);
  const pmap = useMemo(() => new Map((pm.data ?? []).map((r) => [r.metric, Number(r.value)])), [pm.data]);
  const status = integ.data?.[0]?.status;
  const none = t.gbp_views == null;
  const views = t.gbp_views ?? 0;
  const actions = (t.gbp_calls ?? 0) + (t.gbp_directions ?? 0) + (t.gbp_website ?? 0);
  const surfaces = [
    { name: "Maps · mobile", v: m.get("BUSINESS_IMPRESSIONS_MOBILE_MAPS") ?? 0 },
    { name: "Search · mobile", v: m.get("BUSINESS_IMPRESSIONS_MOBILE_SEARCH") ?? 0 },
    { name: "Maps · desktop", v: m.get("BUSINESS_IMPRESSIONS_DESKTOP_MAPS") ?? 0 },
    { name: "Search · desktop", v: m.get("BUSINESS_IMPRESSIONS_DESKTOP_SEARCH") ?? 0 },
  ];
  const acts = [
    { name: "Directions", v: t.gbp_directions ?? 0 },
    { name: "Calls", v: t.gbp_calls ?? 0 },
    { name: "Website", v: t.gbp_website ?? 0 },
    { name: "Messages", v: m.get("BUSINESS_CONVERSATIONS") ?? 0 },
    { name: "Bookings", v: m.get("BUSINESS_BOOKINGS") ?? 0 },
  ].filter((a) => a.v > 0);

  return (
    <Page eyebrow="Local" title="Google Business Profile" intro={GBP_CONFIG.intro}>
      {none && <Pending source="Business Profile">{status === "pending_approval"
        ? "Google must approve Business Profile API access for the Cloud project before any metrics can be read. The request form is linked from Integrations."
        : undefined}</Pending>}
      <Section n="01" title="Profile performance">
        <KpiRow>
          <Kpi logo="gbp" big label="Profile views" value={t.gbp_views} prev={p?.gbp_views} defKey="gbp_views" />
          <Kpi logo="gbp" big label="Actions taken" value={none ? null : actions} prev={p ? (p.gbp_calls ?? 0) + (p.gbp_directions ?? 0) + (p.gbp_website ?? 0) : undefined} sub="calls + directions + website" />
          <Kpi logo="gbp" big label="Action rate" value={views ? actions / views : null} format="pct" sub="actions per profile view" />
        </KpiRow>
        <KpiRow>
          <Kpi logo="gbp" label="Call taps" value={t.gbp_calls} prev={p?.gbp_calls} defKey="gbp_calls" />
          <Kpi logo="gbp" label="Direction requests" value={t.gbp_directions} prev={p?.gbp_directions} defKey="gbp_directions" />
          <Kpi label="Website clicks" value={t.gbp_website} prev={p?.gbp_website} />
          <Kpi label="Mobile share of views" value={views ? (surfaces[0].v + surfaces[1].v) / views : null} format="pct" />
        </KpiRow>
        <TrendChart rows={cur.data} prevRows={f.prev ? prev.data : null} series={[
          { key: "gbp_views", label: "Views", color: C.slate, kind: "area" },
          { key: "gbp_directions", label: "Directions", color: C.teal, axis: "right" },
          { key: "gbp_calls", label: "Call taps", color: C.gold, axis: "right" },
        ]} />
        {!none && <div className="grid2">
          <div className="chart-card">
            <div className="chart-title">Where people saw the profile</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={surfaces} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="#E4ECEA" />
                <XAxis type="number" tick={ax} tickFormatter={(v) => fmt.compact(v)} /><YAxis type="category" dataKey="name" tick={ax} width={110} />
                <Tooltip formatter={(v: any) => `${fmt.int(Number(v))} (${fmt.pct(views ? Number(v) / views : 0, 0)})`} />
                <Bar dataKey="v" name="Views" fill={C.navy} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-card">
            <div className="chart-title">What they did next</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={acts} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="#E4ECEA" />
                <XAxis type="number" tick={ax} tickFormatter={(v) => fmt.compact(v)} /><YAxis type="category" dataKey="name" tick={ax} width={80} />
                <Tooltip formatter={(v: any) => `${fmt.int(Number(v))} · ${views ? fmt.pct(Number(v) / views) : "—"} of views`} />
                <Bar dataKey="v" name="Taps" fill={C.teal} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>}
      </Section>

      <ReviewsSection n="02" range={range} themes={GBP_CONFIG.reviewThemes as Theme[]} />

      <KeywordsSection n="03" range={range} brand={GBP_CONFIG.brand} groups={GBP_CONFIG.searchGroups} />

      <Section n="04" title="All reported metrics">
        <DataTable rows={metrics.data?.map((r) => ({ ...r, label: LABELS[r.metric] ?? r.metric, value: Number(r.value), prev: pmap.get(r.metric) ?? null })) ?? null}
          csvName="gbp-metrics" cols={[
          { key: "label", label: "Metric" },
          { key: "value", label: "This period", align: "right", format: "int" },
          ...(f.prev ? [{ key: "prev", label: "Comparison", align: "right" as const, format: "int" as const }] : []),
        ]} />
      </Section>
    </Page>
  );
}
