import { useMemo, useState } from "react";
import { DataTable, DeltaCell, Drawer, Kpi, KpiRow, Page, Pending, Section, Tag, TrendChart, useRangeArgs } from "../components/ui";
import { useFilters, useRpc, useTable } from "../state";
import { ctr, fmt, pctChange } from "../lib/metrics";
import { expectedCtr, shortPath } from "../lib/insights";
import { C, totals, useSeries } from "./Overview";

export default function Seo() {
  const f = useFilters();
  const { cmp } = useRangeArgs();
  const { cur, prev } = useSeries();
  const queries = useRpc<any[]>("rpc_gsc_queries", { ...cmp, p_limit: 5000 });
  const pages = useRpc<any[]>("rpc_gsc_pages", cmp);
  const integ = useTable<any>("integrations", (q) => q.select("status").eq("source", "gsc"));
  const [brand, setBrand] = useState<"all" | "brand" | "nonbrand">("all");
  const [drill, setDrill] = useState<{ type: "query" | "page"; key: string } | null>(null);

  const t = totals(cur.data), p = f.prev ? totals(prev.data) : null;
  const q = useMemo(() => (queries.data ?? []).map((r) => ({ ...r, clicks: +r.clicks, impressions: +r.impressions, ctr: r.ctr == null ? null : +r.ctr, avg_position: r.avg_position == null ? null : +r.avg_position, prev_clicks: r.prev_clicks == null ? null : +r.prev_clicks, prev_impressions: r.prev_impressions == null ? null : +r.prev_impressions })), [queries.data]);
  const filtered = q.filter((r) => brand === "all" || (brand === "brand" ? r.is_branded : !r.is_branded));
  const brandSplit = useMemo(() => {
    const b = q.filter((r) => r.is_branded), n = q.filter((r) => !r.is_branded);
    const s = (a: any[], k: string) => a.reduce((x, r) => x + r[k], 0);
    return { bc: s(b, "clicks"), bi: s(b, "impressions"), nc: s(n, "clicks"), ni: s(n, "impressions") };
  }, [q]);
  const opps = q.filter((r) => !r.is_branded && r.impressions >= 50 && r.avg_position != null && r.avg_position <= 15)
    .map((r) => ({ ...r, gap: Math.max(0, Math.round(r.impressions * expectedCtr(r.avg_position!) - r.clicks)) }))
    .filter((r) => r.gap >= 3).sort((a, b) => b.gap - a.gap);
  const movers = f.prev ? q.filter((r) => r.prev_clicks != null || r.clicks > 0).map((r) => ({ ...r, d: r.clicks - (r.prev_clicks ?? 0) })) : [];
  const up = [...movers].sort((a, b) => b.d - a.d).filter((r) => r.d > 0).slice(0, 10);
  const down = [...movers].sort((a, b) => a.d - b.d).filter((r) => r.d < 0).slice(0, 10);
  const notConnected = integ.data && integ.data[0]?.status !== "connected" && t.gsc_impressions == null;

  return (
    <Page eyebrow="Organic" title="SEO — Google Search Console"
      intro="Property https://elitesdental.com/ (URL-prefix). Data runs 2–3 days behind. Average position is impression-weighted and moves with device, location and personalisation — it is not a guaranteed rank.">
      {notConnected && <Pending source="Search Console" />}
      <Section n="01" title="Search performance">
        <KpiRow>
          <Kpi label="Clicks" value={t.gsc_clicks} prev={p?.gsc_clicks} defKey="gsc_clicks" />
          <Kpi label="Impressions" value={t.gsc_impressions} prev={p?.gsc_impressions} defKey="gsc_impressions" />
          <Kpi label="CTR" value={ctr(t.gsc_clicks, t.gsc_impressions)} prev={p ? ctr(p.gsc_clicks, p.gsc_impressions) : undefined} format="pct" defKey="gsc_ctr" />
          <Kpi label="Avg position" value={t.gsc_position} prev={p?.gsc_position} format="dec" defKey="gsc_position" invert />
        </KpiRow>
        <TrendChart rows={cur.data} prevRows={f.prev ? prev.data : null} series={[
          { key: "gsc_impressions", label: "Impressions", color: C.slate, kind: "area" },
          { key: "gsc_clicks", label: "Clicks", color: C.gold, axis: "right" },
        ]} />
      </Section>

      <Section n="02" title="Branded vs non-branded" note={<>Branded = query contains a brand term from Settings (elites, elite dental…). Anonymised queries are excluded here, so these won't sum to the totals above.</>}>
        <KpiRow>
          <Kpi label="Branded clicks" value={brandSplit.bc || null} sub={`${fmt.int(brandSplit.bi)} impr`} />
          <Kpi label="Non-branded clicks" value={brandSplit.nc || null} sub={`${fmt.int(brandSplit.ni)} impr`} />
          <Kpi label="Non-branded share of clicks" value={brandSplit.bc + brandSplit.nc ? brandSplit.nc / (brandSplit.bc + brandSplit.nc) : null} format="pct" />
        </KpiRow>
      </Section>

      <Section n="03" title="Click opportunities" note="Non-brand searches on page 1–2 where clicks trail a typical CTR for that position. 'Gap' is an estimate of missed clicks, not a forecast.">
        <DataTable rows={queries.data ? opps : null} csvName="seo-opportunities" onRow={(r) => setDrill({ type: "query", key: r.query })} initialSort={{ key: "gap", dir: -1 }} cols={[
          { key: "query", label: "Query" },
          { key: "impressions", label: "Impr.", align: "right", format: "int" },
          { key: "clicks", label: "Clicks", align: "right", format: "int" },
          { key: "ctr", label: "CTR", align: "right", format: "pct" },
          { key: "avg_position", label: "Avg pos", align: "right", format: "dec" },
          { key: "gap", label: "Gap (est.)", align: "right", format: "int" },
          { key: "top_page", label: "Ranking page", render: (r) => shortPath(r.top_page ?? "") },
        ]} />
      </Section>

      {f.prev && (
        <Section n="04" title="Movers" note={`Change in clicks, ${f.label} vs ${f.prevLabel}.`}>
          <div className="two">
            <DataTable rows={queries.data ? up : null} limit={10} cols={[{ key: "query", label: "Gaining" }, { key: "prev_clicks", label: "Before", align: "right", format: "int" }, { key: "clicks", label: "Now", align: "right", format: "int" }, { key: "d", label: "Δ", align: "right", render: (r) => <span className="delta up">+{r.d}</span>, value: (r) => r.d }]} />
            <DataTable rows={queries.data ? down : null} limit={10} cols={[{ key: "query", label: "Losing" }, { key: "prev_clicks", label: "Before", align: "right", format: "int" }, { key: "clicks", label: "Now", align: "right", format: "int" }, { key: "d", label: "Δ", align: "right", render: (r) => <span className="delta down">{r.d}</span>, value: (r) => r.d }]} />
          </div>
        </Section>
      )}

      <Section n="05" title="Queries" right={
        <div className="seg">{(["all", "nonbrand", "brand"] as const).map((b) => <button key={b} className={brand === b ? "on" : ""} onClick={() => setBrand(b)}>{b === "all" ? "All" : b === "brand" ? "Branded" : "Non-branded"}</button>)}</div>}>
        <DataTable rows={queries.data ? filtered : null} csvName="seo-queries" onRow={(r) => setDrill({ type: "query", key: r.query })} cols={[
          { key: "query", label: "Query", render: (r) => <>{r.query} {r.is_branded && <Tag>brand</Tag>}</> , value: (r) => r.query },
          { key: "clicks", label: "Clicks", align: "right", format: "int" },
          { key: "impressions", label: "Impr.", align: "right", format: "int" },
          { key: "ctr", label: "CTR", align: "right", format: "pct" },
          { key: "avg_position", label: "Avg pos", align: "right", format: "dec" },
          ...(f.prev ? [{ key: "chg", label: "Clicks Δ", align: "right" as const, render: (r: any) => <DeltaCell cur={r.clicks} prev={r.prev_clicks} />, value: (r: any) => pctChange(r.clicks, r.prev_clicks) }] : []),
        ]} />
      </Section>

      <Section n="06" title="Pages">
        <DataTable rows={pages.data?.map((r) => ({ ...r, clicks: +r.clicks, impressions: +r.impressions, ctr: r.ctr == null ? null : +r.ctr, avg_position: r.avg_position == null ? null : +r.avg_position })) ?? null}
          csvName="seo-pages" onRow={(r) => setDrill({ type: "page", key: r.page })} cols={[
          { key: "page", label: "Page", render: (r) => shortPath(r.page), value: (r) => r.page },
          { key: "clicks", label: "Clicks", align: "right", format: "int" },
          { key: "impressions", label: "Impr.", align: "right", format: "int" },
          { key: "ctr", label: "CTR", align: "right", format: "pct" },
          { key: "avg_position", label: "Avg pos", align: "right", format: "dec" },
          { key: "queries", label: "Queries", align: "right", format: "int" },
          ...(f.prev ? [{ key: "chg", label: "Clicks Δ", align: "right" as const, render: (r: any) => <DeltaCell cur={r.clicks} prev={r.prev_clicks == null ? null : +r.prev_clicks} />, value: (r: any) => pctChange(r.clicks, r.prev_clicks) }] : []),
        ]} />
      </Section>

      <Drawer open={!!drill} onClose={() => setDrill(null)} title={drill ? (drill.type === "query" ? `“${drill.key}”` : shortPath(drill.key)) : ""}>
        {drill && <GscDrill type={drill.type} k={drill.key} />}
      </Drawer>
    </Page>
  );
}

function GscDrill({ type, k }: { type: "query" | "page"; k: string }) {
  const f = useFilters();
  const rows = useTable<any>("gsc_daily_query_page", (q) => q.select("date,query,page,clicks,impressions,position_weighted")
    .eq(type, k).gte("date", f.range.start).lte("date", f.range.end).order("date").limit(5000), [type, k, f.range.start, f.range.end]);
  const { byDate, byOther } = useMemo(() => {
    const d = new Map<string, any>(), o = new Map<string, any>();
    for (const r of rows.data ?? []) {
      const a = d.get(r.date) ?? { date: r.date, clicks: 0, impressions: 0 }; a.clicks += r.clicks; a.impressions += r.impressions; d.set(r.date, a);
      const key = type === "query" ? r.page : r.query;
      const b = o.get(key) ?? { key, clicks: 0, impressions: 0, pw: 0 }; b.clicks += r.clicks; b.impressions += r.impressions; b.pw += Number(r.position_weighted); o.set(key, b);
    }
    return { byDate: [...d.values()], byOther: [...o.values()].map((b) => ({ ...b, pos: b.impressions ? b.pw / b.impressions : null })) };
  }, [rows.data, type]);
  return (
    <>
      <TrendChart rows={rows.data ? byDate : null} height={200} series={[{ key: "impressions", label: "Impressions", color: C.slate, kind: "area" }, { key: "clicks", label: "Clicks", color: C.gold, axis: "right" }]} />
      <DataTable rows={rows.data ? byOther : null} csvName={`gsc-${type}-drill`} cols={[
        { key: "key", label: type === "query" ? "Page" : "Query", render: (r) => (type === "query" ? shortPath(r.key) : r.key), value: (r) => r.key },
        { key: "clicks", label: "Clicks", align: "right", format: "int" },
        { key: "impressions", label: "Impr.", align: "right", format: "int" },
        { key: "pos", label: "Avg pos", align: "right", format: "dec" },
      ]} />
    </>
  );
}
