import { Fragment, useMemo, useState } from "react";
import { DataTable, DeltaCell, ErrorBox, Loading, Page, Tag, TrendChart, useRangeArgs } from "../components/ui";
import { useFilters, useRpc, useTable } from "../state";
import { cpc, costPer, fmt, pctChange, ratio, type Num } from "../lib/metrics";
import { downloadCsv } from "../lib/csv";
import { fmtDate, type PresetKey } from "../lib/dates";
import { C, totals, useSeries } from "./Overview";
import { useInsights } from "./Insights";
import { buildStages, FunnelDiagram, useFunnelData } from "./funnelData";

type Kind = "monthly" | "weekly" | "paid";
const KINDS: { k: Kind; label: string; preset: PresetKey; blurb: string }[] = [
  { k: "monthly", label: "Monthly client report", preset: "lastMonth", blurb: "Full picture for the clinic: discovery, website, ads, leads, revenue and next steps." },
  { k: "weekly", label: "Weekly pulse", preset: "lastWeek", blurb: "One page: the scorecard, what moved, and this week's actions." },
  { k: "paid", label: "Paid ads report", preset: "last30", blurb: "Spend, clicks, cost per result and campaign detail for Google and Meta ads." },
];
const QUICK: PresetKey[] = ["lastMonth", "thisMonth", "lastWeek", "last7", "last30", "lastQuarter"];

interface Row { group: string; metric: string; value: Num; prev: Num; format: keyof typeof fmt; source: string; invert?: boolean; key?: boolean }

export default function Reports() {
  const f = useFilters();
  const [kind, setKind] = useState<Kind>("monthly");
  const { range, cmp } = useRangeArgs();
  const { cur, prev } = useSeries();
  const t = useMemo(() => totals(cur.data), [cur.data]);
  const p = useMemo(() => (f.prev ? totals(prev.data) : null), [prev.data, f.prev]);
  const camps = useRpc<any[]>("rpc_ads_campaigns", range);
  const queries = useRpc<any[]>("rpc_gsc_queries", { ...cmp, p_limit: 50 });
  const landing = useRpc<any[]>("rpc_ga4_landing", cmp);
  const integ = useTable<any>("integrations", (q) => q.select("source,label,status,last_success_at"));
  const fd = useFunnelData();
  const { items } = useInsights();

  const rows = useMemo<Row[]>(() => {
    const pv = (k: keyof typeof t) => (p ? p[k] : null);
    const paidSpend = (x: typeof t | null) => (x ? (x.ads_cost == null && x.meta_spend == null ? null : (x.ads_cost ?? 0) + (x.meta_spend ?? 0)) : null);
    const all: Row[] = [
      { group: "Discovery", metric: "Google Search impressions", value: t.gsc_impressions, prev: pv("gsc_impressions"), format: "int", source: "Search Console" },
      { group: "Discovery", metric: "Business Profile views", value: t.gbp_views, prev: pv("gbp_views"), format: "int", source: "Business Profile" },
      { group: "Discovery", metric: "Ad impressions", value: t.ads_impressions, prev: pv("ads_impressions"), format: "int", source: "Google Ads" },
      { group: "Visits", metric: "Organic search clicks", value: t.gsc_clicks, prev: pv("gsc_clicks"), format: "int", source: "Search Console", key: true },
      { group: "Visits", metric: "Average search position", value: t.gsc_position, prev: pv("gsc_position"), format: "dec", source: "Search Console", invert: true },
      { group: "Visits", metric: "Website sessions", value: t.ga4_sessions, prev: pv("ga4_sessions"), format: "int", source: "GA4", key: true },
      { group: "Visits", metric: "Engagement rate", value: ratio(t.ga4_engaged, t.ga4_sessions), prev: p ? ratio(p.ga4_engaged, p.ga4_sessions) : null, format: "pct", source: "GA4" },
      { group: "Actions", metric: "Profile call taps", value: t.gbp_calls, prev: pv("gbp_calls"), format: "int", source: "Business Profile", key: true },
      { group: "Actions", metric: "Direction requests", value: t.gbp_directions, prev: pv("gbp_directions"), format: "int", source: "Business Profile" },
      { group: "Actions", metric: "Profile website taps", value: t.gbp_website, prev: pv("gbp_website"), format: "int", source: "Business Profile" },
      { group: "Paid", metric: "Ad spend (Google + Meta)", value: paidSpend(t), prev: paidSpend(p), format: "inr", source: "Google Ads + Meta", invert: true },
      { group: "Paid", metric: "Ad clicks", value: t.ads_clicks, prev: pv("ads_clicks"), format: "int", source: "Google Ads", key: true },
      { group: "Paid", metric: "Cost per click", value: cpc(t.ads_cost, t.ads_clicks), prev: p ? cpc(p.ads_cost, p.ads_clicks) : null, format: "inr", source: "Google Ads", invert: true },
      { group: "Paid", metric: "Ads conversions", value: t.ads_conversions, prev: pv("ads_conversions"), format: "dec", source: "Google Ads (platform-attributed)" },
      { group: "Paid", metric: "Cost per Ads conversion", value: costPer(t.ads_cost, t.ads_conversions), prev: p ? costPer(p.ads_cost, p.ads_conversions) : null, format: "inr", source: "Google Ads", invert: true },
      { group: "Patients", metric: "CRM leads", value: t.leads, prev: pv("leads"), format: "int", source: "CRM", key: true },
      { group: "Patients", metric: "Appointments booked", value: t.bookings, prev: pv("bookings"), format: "int", source: "CRM" },
      { group: "Patients", metric: "Completed visits", value: t.completed, prev: pv("completed"), format: "int", source: "CRM" },
      { group: "Patients", metric: "Revenue recorded", value: t.revenue, prev: pv("revenue"), format: "inr", source: "Revenue entries", key: true },
    ];
    if (kind === "paid") return all.filter((r) => ["Paid", "Patients"].includes(r.group) || r.metric === "Ad impressions");
    return all;
  }, [t, p, kind]);

  const moves = useMemo(() => {
    const m = rows.filter((r) => r.value != null && r.prev != null && (r.prev as number) > 0 && r.format !== "pct" && r.metric !== "Average search position")
      .map((r) => { const ch = pctChange(r.value, r.prev)!; return { ...r, ch, good: r.invert ? ch < 0 : ch > 0 }; })
      .filter((r) => Math.abs(r.ch) >= 0.05);
    return { wins: m.filter((r) => r.good).sort((a, b) => Math.abs(b.ch) - Math.abs(a.ch)).slice(0, 4), watch: m.filter((r) => !r.good).sort((a, b) => Math.abs(b.ch) - Math.abs(a.ch)).slice(0, 4) };
  }, [rows]);

  const actions = (items ?? []).filter((i) => kind !== "paid" || /ads|paid/i.test(i.area)).slice(0, kind === "weekly" ? 3 : 6);
  const stages = fd.loading ? null : buildStages(fd, kind === "paid" ? "Paid search" : "all");
  const connected = (integ.data ?? []).filter((i) => i.status === "connected").map((i) => i.label);
  const missing = (integ.data ?? []).filter((i) => i.status !== "connected" && i.source !== "wordpress").map((i) => i.label);
  const kdef = KINDS.find((x) => x.k === kind)!;

  const csv = () => downloadCsv(`elites-${kind}-report-${f.range.start}_${f.range.end}.csv`,
    rows.map((r) => ({ section: r.group, metric: r.metric, value: r.value ?? "", previous: r.prev ?? "", change: pctChange(r.value, r.prev) ?? "", source: r.source })));

  return (
    <Page eyebrow="Reporting" title="Reports"
      intro={<>Client-ready reports built from the live data for the selected period. Pick a report, pick a period, then print or save as PDF. Numbers carry their source; anything not connected says so instead of showing zero.</>}
      actions={<><button className="btn ghost" onClick={csv}>Download CSV</button><button className="btn" onClick={() => window.print()}>Print / Save PDF</button></>}>

      <div className="report-controls no-print">
        <div className="seg">{KINDS.map((x) => <button key={x.k} className={kind === x.k ? "on" : ""} onClick={() => { setKind(x.k); f.setPreset(x.preset); }}>{x.label}</button>)}</div>
        <div className="seg">{QUICK.map((q) => <button key={q} className={f.preset === q ? "on" : ""} onClick={() => f.setPreset(q)}>{({ lastMonth: "Last month", thisMonth: "This month", lastWeek: "Last week", last7: "Last 7 days", last30: "Last 30 days", lastQuarter: "Last quarter" } as Record<string, string>)[q]}</button>)}</div>
        <p className="small muted">{kdef.blurb} Comparison: {f.prevLabel ? `previous period (${f.prevLabel})` : "off — turn it on in the date bar to see changes"}.</p>
      </div>

      {cur.error && <ErrorBox msg={cur.error} />}
      <article className="report">
        <header className="report-cover">
          <div className="report-brand"><span className="mark">E</span><div><strong>Elites Dental Care</strong><small>TC Palya Main Road, Bengaluru</small></div></div>
          <h2>{kdef.label}</h2>
          <div className="report-meta">
            <span><b>Period</b> {fmtDate(f.range.start)} – {fmtDate(f.range.end)}</span>
            {f.prevLabel && <span><b>Compared with</b> {f.prevLabel}</span>}
            <span><b>Prepared</b> {fmtDate(f.today)}{f.email ? ` · ${f.email}` : ""}</span>
          </div>
        </header>

        {cur.loading ? <Loading h={200} /> : <>
          <section className="report-sec">
            <h3><span className="sec-n">01</span> Summary</h3>
            <div className="report-hero">
              {rows.filter((r) => r.key).map((r) => (
                <div key={r.metric} className="hero-stat"><small>{r.metric}</small><strong>{r.value == null ? "—" : fmt[r.format](r.value as number)}</strong>
                  {r.prev != null && <DeltaCell cur={r.value} prev={r.prev} invert={r.invert} />}</div>
              ))}
            </div>
            <div className="grid2">
              <div><h4>What went well</h4>{moves.wins.length ? <ul>{moves.wins.map((w) => <li key={w.metric}><strong>{w.metric}</strong> {fmt.delta(w.ch)} — {fmt[w.format](w.value as number)} vs {fmt[w.format](w.prev as number)}</li>)}</ul> : <p className="muted small">{f.prev ? "No metric improved by 5% or more." : "Turn on comparison to see changes."}</p>}</div>
              <div><h4>What to watch</h4>{moves.watch.length ? <ul>{moves.watch.map((w) => <li key={w.metric}><strong>{w.metric}</strong> {fmt.delta(w.ch)} — {fmt[w.format](w.value as number)} vs {fmt[w.format](w.prev as number)}</li>)}</ul> : <p className="muted small">{f.prev ? "Nothing fell by 5% or more." : "—"}</p>}</div>
            </div>
          </section>

          <section className="report-sec">
            <h3><span className="sec-n">02</span> Scorecard</h3>
            <table className="report-table">
              <thead><tr><th>Metric</th><th className="r">This period</th>{f.prev && <><th className="r">Previous</th><th className="r">Change</th></>}<th>Source</th></tr></thead>
              <tbody>{rows.map((r, i) => <Fragment key={r.metric}>
                {(i === 0 || rows[i - 1].group !== r.group) && <tr className="grp"><td colSpan={f.prev ? 5 : 3}>{r.group}</td></tr>}
                <tr><td>{r.metric}</td><td className="r">{r.value == null ? <span className="muted">Not available</span> : fmt[r.format](r.value as number)}</td>
                  {f.prev && <><td className="r muted">{r.prev == null ? "—" : fmt[r.format](r.prev as number)}</td><td className="r"><DeltaCell cur={r.value} prev={r.prev} invert={r.invert} /></td></>}
                  <td className="small muted">{r.source}</td></tr>
              </Fragment>)}</tbody>
            </table>
          </section>

          {kind !== "weekly" && <section className="report-sec">
            <h3><span className="sec-n">03</span> Trend</h3>
            <TrendChart rows={cur.data} prevRows={f.prev ? prev.data : null} height={230} series={kind === "paid" ? [
              { key: "ads_clicks", label: "Ad clicks", color: C.navy, kind: "bar" }, { key: "ads_cost", label: "Ad spend", color: C.gold, axis: "right", format: "inr" },
            ] : [
              { key: "ga4_sessions", label: "Website sessions", color: C.navy, kind: "area" }, { key: "gsc_clicks", label: "Organic clicks", color: C.gold }, { key: "gbp_calls", label: "Profile call taps", color: C.teal },
            ]} />
          </section>}

          {kind !== "weekly" && <section className="report-sec">
            <h3><span className="sec-n">04</span> {kind === "paid" ? "Paid search funnel" : "Patient funnel"}</h3>
            {stages ? <FunnelDiagram stages={stages} /> : <Loading />}
          </section>}

          {(kind === "monthly" || kind === "paid") && <section className="report-sec">
            <h3><span className="sec-n">05</span> Campaigns</h3>
            {camps.loading ? <Loading /> : <DataTable rows={(camps.data ?? []).filter((c) => +c.impressions > 0).map((c) => ({ ...c, cost: +c.cost, clicks: +c.clicks, impressions: +c.impressions, conversions: +c.conversions, cpc: cpc(+c.cost, +c.clicks), cpa: costPer(+c.cost, +c.conversions) }))}
              empty="No ad delivery in this period." limit={10} cols={[
                { key: "campaign_name", label: "Campaign" }, { key: "impressions", label: "Impr.", align: "right", format: "int" }, { key: "clicks", label: "Clicks", align: "right", format: "int" },
                { key: "cost", label: "Spend", align: "right", format: "inr" }, { key: "cpc", label: "CPC", align: "right", format: "inr" }, { key: "conversions", label: "Conv.", align: "right", format: "dec" }, { key: "cpa", label: "Cost/conv.", align: "right", format: "inr" },
              ]} />}
          </section>}

          {kind === "monthly" && <section className="report-sec">
            <h3><span className="sec-n">06</span> Search and website</h3>
            <div className="grid2">
              <div><h4>Top Google searches</h4>{queries.loading ? <Loading /> : <DataTable rows={(queries.data ?? []).map((q) => ({ ...q, clicks: +q.clicks, impressions: +q.impressions, avg_position: q.avg_position == null ? null : +q.avg_position }))} limit={10} empty="No Search Console data in this period."
                initialSort={{ key: "impressions", dir: -1 }} cols={[{ key: "query", label: "Search" }, { key: "impressions", label: "Impr.", align: "right", format: "int" }, { key: "clicks", label: "Clicks", align: "right", format: "int" }, { key: "avg_position", label: "Pos.", align: "right", format: "dec" }]} />}</div>
              <div><h4>Top landing pages</h4>{landing.loading ? <Loading /> : <DataTable rows={(landing.data ?? []).map((l) => ({ ...l, sessions: +l.sessions, engaged_sessions: +l.engaged_sessions }))} limit={10} empty="No GA4 data in this period."
                initialSort={{ key: "sessions", dir: -1 }} cols={[{ key: "landing_page", label: "Page" }, { key: "sessions", label: "Sessions", align: "right", format: "int" }, { key: "engaged_sessions", label: "Engaged", align: "right", format: "int" }]} />}</div>
            </div>
          </section>}

          <section className="report-sec">
            <h3><span className="sec-n">{kind === "weekly" ? "03" : kind === "paid" ? "06" : "07"}</span> Next steps</h3>
            {!items ? <Loading /> : actions.length ? <ol className="report-actions">{actions.map((a) => <li key={a.id}><strong>{a.title}</strong><br /><span className="small">{a.action}</span> <Tag tone={a.severity === "high" ? "bad" : a.severity === "medium" ? "warn" : "neutral"}>{a.severity}</Tag></li>)}</ol> : <p className="muted">Nothing flagged for this period.</p>}
          </section>

          <footer className="report-foot small muted">
            <p><b>Data sources connected:</b> {connected.join(", ") || "—"}.{missing.length ? <> <b>Not connected yet:</b> {missing.join(", ")} — shown as “Not available”, never as zero.</> : null}</p>
            <p>Google Ads conversions are Google's own attribution and include phone taps and WhatsApp clicks. CRM leads and revenue count only what the clinic records. Users and impressions count visits, not unique people.</p>
          </footer>
        </>}
      </article>
    </Page>
  );
}
