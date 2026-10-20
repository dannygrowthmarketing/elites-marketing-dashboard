import { useMemo } from "react";
import { DataTable, Kpi, KpiRow, Page, Pending, Section, TrendChart, useRangeArgs } from "../components/ui";
import { useFilters, useRpc, useTable } from "../state";
import { C, totals, useSeries } from "./Overview";

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

export default function Gbp() {
  const f = useFilters();
  const { range, prevRange } = useRangeArgs();
  const { cur, prev } = useSeries();
  const metrics = useRpc<any[]>("rpc_gbp_metrics", range);
  const pm = useRpc<any[]>("rpc_gbp_metrics", prevRange);
  const integ = useTable<any>("integrations", (q) => q.select("status,last_error").eq("source", "gbp"));
  const kw = useTable<any>("gbp_monthly_keywords", (q) => q.select("*").gte("month", f.range.start.slice(0, 7) + "-01").lte("month", f.range.end).order("month", { ascending: false }).limit(2000), [f.range.start, f.range.end]);
  const t = totals(cur.data), p = f.prev ? totals(prev.data) : null;
  const pmap = useMemo(() => new Map((pm.data ?? []).map((r) => [r.metric, Number(r.value)])), [pm.data]);
  const kwAgg = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of kw.data ?? []) {
      const a = m.get(r.keyword) ?? { keyword: r.keyword, impressions: 0, months: 0, thresholded: 0 };
      if (r.impressions != null) a.impressions += r.impressions; else a.thresholded++;
      a.months++; m.set(r.keyword, a);
    }
    return [...m.values()];
  }, [kw.data]);
  const status = integ.data?.[0]?.status;
  const none = t.gbp_views == null;

  return (
    <Page eyebrow="Local" title="Google Business Profile"
      intro="Elites Dental Care, CMS Towers, TC Palya Main Rd. Calls are taps on the Call button, not answered calls. Views count per day, so one person on two days counts twice.">
      {none && <Pending source="Business Profile">{status === "pending_approval"
        ? "Google must approve Business Profile API access for the Cloud project before any metrics can be read. The request form is linked from Integrations."
        : undefined}</Pending>}
      <Section n="01" title="Profile performance">
        <KpiRow>
          <Kpi label="Profile views" value={t.gbp_views} prev={p?.gbp_views} defKey="gbp_views" />
          <Kpi label="Call taps" value={t.gbp_calls} prev={p?.gbp_calls} defKey="gbp_calls" />
          <Kpi label="Direction requests" value={t.gbp_directions} prev={p?.gbp_directions} defKey="gbp_directions" />
          <Kpi label="Website clicks" value={t.gbp_website} prev={p?.gbp_website} />
        </KpiRow>
        <TrendChart rows={cur.data} prevRows={f.prev ? prev.data : null} series={[
          { key: "gbp_views", label: "Views", color: C.slate, kind: "area" },
          { key: "gbp_directions", label: "Directions", color: C.teal, axis: "right" },
          { key: "gbp_calls", label: "Call taps", color: C.gold, axis: "right" },
        ]} />
      </Section>
      <Section n="02" title="All reported metrics">
        <DataTable rows={metrics.data?.map((r) => ({ ...r, label: LABELS[r.metric] ?? r.metric, value: Number(r.value), prev: pmap.get(r.metric) ?? null })) ?? null}
          csvName="gbp-metrics" cols={[
          { key: "label", label: "Metric" },
          { key: "value", label: "This period", align: "right", format: "int" },
          ...(f.prev ? [{ key: "prev", label: "Comparison", align: "right" as const, format: "int" as const }] : []),
        ]} />
      </Section>
      <Section n="03" title="Search terms that showed the profile" note="Monthly, from Google. Low-volume terms come back only as '< threshold' and are counted here as months thresholded, never as a number. The current month appears after it ends.">
        <DataTable rows={kw.data ? kwAgg : null} csvName="gbp-search-terms" initialSort={{ key: "impressions", dir: -1 }} cols={[
          { key: "keyword", label: "Search term" },
          { key: "impressions", label: "Impressions (reported)", align: "right", format: "int" },
          { key: "thresholded", label: "Months below threshold", align: "right", format: "int" },
        ]} />
      </Section>
    </Page>
  );
}
