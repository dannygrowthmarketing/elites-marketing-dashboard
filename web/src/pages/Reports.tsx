import { cloneElement, Fragment, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, XAxis, YAxis, Legend } from "recharts";
import { ErrorBox, Loading, Page, useRangeArgs } from "../components/ui";
import { useFilters, useRpc, useTable } from "../state";
import { cpc, costPer, fmt, pctChange, ratio, type Num } from "../lib/metrics";
import { downloadCsv } from "../lib/csv";
import { fmtDate, type PresetKey } from "../lib/dates";
import { totals, useSeries } from "./Overview";
import { Logo, LogoStack, SOURCE_MARK } from "../components/Logo";
import { useInsights } from "./Insights";
import { buildStages, useFunnelData } from "./funnelData";

type Kind = "monthly" | "weekly" | "paid";
const KINDS: { k: Kind; label: string; preset: PresetKey; blurb: string }[] = [
  { k: "monthly", label: "Monthly client report", preset: "lastMonth", blurb: "Full picture for the clinic: discovery, website, ads, leads, revenue and next steps." },
  { k: "weekly", label: "Weekly pulse", preset: "lastWeek", blurb: "One page: the scorecard, what moved, and this week's actions." },
  { k: "paid", label: "Paid ads report", preset: "last30", blurb: "Spend, clicks, cost per result and campaign detail for Google and Meta ads." },
];
const QUICK: PresetKey[] = ["lastMonth", "thisMonth", "lastWeek", "last7", "last30", "lastQuarter"];

interface Row { group: string; metric: string; value: Num; prev: Num; format: keyof typeof fmt; source: string; invert?: boolean; key?: boolean; logo?: string }

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
      { group: "Visits", metric: "Organic search clicks", value: t.gsc_clicks, prev: pv("gsc_clicks"), format: "int", source: "Search Console", key: true, logo: "gsc" },
      { group: "Visits", metric: "Average search position", value: t.gsc_position, prev: pv("gsc_position"), format: "dec", source: "Search Console", invert: true },
      { group: "Visits", metric: "Website sessions", value: t.ga4_sessions, prev: pv("ga4_sessions"), format: "int", source: "GA4", key: true, logo: "ga4" },
      { group: "Visits", metric: "Engagement rate", value: ratio(t.ga4_engaged, t.ga4_sessions), prev: p ? ratio(p.ga4_engaged, p.ga4_sessions) : null, format: "pct", source: "GA4" },
      { group: "Actions", metric: "Profile call taps", value: t.gbp_calls, prev: pv("gbp_calls"), format: "int", source: "Business Profile", key: true, logo: "gbp" },
      { group: "Actions", metric: "Direction requests", value: t.gbp_directions, prev: pv("gbp_directions"), format: "int", source: "Business Profile" },
      { group: "Actions", metric: "Profile website taps", value: t.gbp_website, prev: pv("gbp_website"), format: "int", source: "Business Profile" },
      { group: "Paid", metric: "Ad spend (Google + Meta)", value: paidSpend(t), prev: paidSpend(p), format: "inr", source: "Google Ads + Meta", invert: true },
      { group: "Paid", metric: "Ad clicks", value: t.ads_clicks, prev: pv("ads_clicks"), format: "int", source: "Google Ads", key: true, logo: "google_ads" },
      { group: "Paid", metric: "Cost per click", value: cpc(t.ads_cost, t.ads_clicks), prev: p ? cpc(p.ads_cost, p.ads_clicks) : null, format: "inr", source: "Google Ads", invert: true },
      { group: "Paid", metric: "Ads conversions", value: t.ads_conversions, prev: pv("ads_conversions"), format: "dec", source: "Google Ads (platform-attributed)" },
      { group: "Paid", metric: "Cost per Ads conversion", value: costPer(t.ads_cost, t.ads_conversions), prev: p ? costPer(p.ads_cost, p.ads_conversions) : null, format: "inr", source: "Google Ads", invert: true },
      { group: "Patients", metric: "CRM leads", value: t.leads, prev: pv("leads"), format: "int", source: "CRM", key: true, logo: "crm" },
      { group: "Patients", metric: "Appointments booked", value: t.bookings, prev: pv("bookings"), format: "int", source: "CRM" },
      { group: "Patients", metric: "Completed visits", value: t.completed, prev: pv("completed"), format: "int", source: "CRM" },
      { group: "Patients", metric: "Revenue recorded", value: t.revenue, prev: pv("revenue"), format: "inr", source: "Revenue entries", key: true, logo: "rupee" },
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
  const connectedRows = (integ.data ?? []).filter((i) => i.status === "connected");
  const connected = connectedRows.map((i) => i.label);
  const missing = (integ.data ?? []).filter((i) => i.status !== "connected" && i.source !== "wordpress").map((i) => i.label);
  const kdef = KINDS.find((x) => x.k === kind)!;

  const csv = () => downloadCsv(`elites-${kind}-report-${f.range.start}_${f.range.end}.csv`,
    rows.map((r) => ({ section: r.group, metric: r.metric, value: r.value ?? "", previous: r.prev ?? "", change: pctChange(r.value, r.prev) ?? "", source: r.source })));

  const period = `${fmtDate(f.range.start)} – ${fmtDate(f.range.end)}`;
  const deckRef = useRef<HTMLDivElement>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const ser = (cur.data ?? []).map((d: any) => ({ ...d, label: new Date(d.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
    ga4_sessions: d.ga4_sessions == null ? null : +d.ga4_sessions, gsc_clicks: d.gsc_clicks == null ? null : +d.gsc_clicks, gbp_calls: d.gbp_calls == null ? null : +d.gbp_calls,
    ads_clicks: d.ads_clicks == null ? null : +d.ads_clicks, ads_cost: d.ads_cost == null ? null : +d.ads_cost }));
  const campRows = (camps.data ?? []).filter((c) => +c.impressions > 0).map((c) => ({ name: String(c.campaign_name).slice(0, 38), cost: +c.cost, clicks: +c.clicks, conv: +c.conversions, cpc: cpc(+c.cost, +c.clicks) }))
    .sort((a, b) => b.cost - a.cost).slice(0, 6);
  const topQ = (queries.data ?? []).map((q) => ({ name: q.query, v: +q.impressions, c: +q.clicks })).sort((a, b) => b.v - a.v).slice(0, 8);
  const topL = (landing.data ?? []).map((l) => ({ name: l.landing_page, v: +l.sessions })).sort((a, b) => b.v - a.v).slice(0, 8);
  const brand = { kind: kdef.label, period };

  const slides: { key: string; el: ReactNode }[] = [];
  slides.push({ key: "cover", el: <Cover {...brand} compare={f.prevLabel} prepared={fmtDate(f.today)} logos={connectedRows.map((i) => SOURCE_MARK[i.source]).filter(Boolean)}
    hero={rows.find((r) => r.metric === (kind === "paid" ? "Ad clicks" : "Website sessions"))} /> });
  slides.push({ key: "headline", el: <Slide {...brand} n={2} title="The numbers that matter" note="Change is against the previous period of the same length.">
    <div className="s-hero">{rows.filter((r) => r.key).map((r) => (
      <div key={r.metric} className="s-stat">{r.logo && <Logo id={r.logo} size={34} />}<small>{r.metric}</small>
        <strong>{r.value == null ? "—" : fmt[r.format](r.value as number)}</strong>
        <Delta cur={r.value} prev={r.prev} invert={r.invert} /></div>
    ))}</div></Slide> });
  slides.push({ key: "moves", el: <Slide {...brand} n={3} title="What moved">
    <div className="s-two">
      <div className="s-col good"><h4>Went well</h4>{moves.wins.length ? moves.wins.map((w) => <div key={w.metric} className="s-move"><b>{fmt.delta(w.ch)}</b><span>{w.metric}<small>{fmt[w.format](w.value as number)} vs {fmt[w.format](w.prev as number)}</small></span></div>) : <p className="s-muted">{f.prev ? "No metric improved by 5% or more." : "Comparison is off."}</p>}</div>
      <div className="s-col bad"><h4>To watch</h4>{moves.watch.length ? moves.watch.map((w) => <div key={w.metric} className="s-move"><b>{fmt.delta(w.ch)}</b><span>{w.metric}<small>{fmt[w.format](w.value as number)} vs {fmt[w.format](w.prev as number)}</small></span></div>) : <p className="s-muted">Nothing fell by 5% or more.</p>}</div>
    </div></Slide> });
  if (kind === "monthly") slides.push({ key: "channels", el: <Slide {...brand} n={0} title="Channel by channel">
    <div className="s-chan">{[
      { logo: "gsc", name: "Google Search", main: ["Clicks", t.gsc_clicks, p?.gsc_clicks, "int"], subs: [["Impressions", fmt.compact(t.gsc_impressions)], ["Avg position", fmt.dec(t.gsc_position)]] },
      { logo: "gbp", name: "Business Profile", main: ["Call taps", t.gbp_calls, p?.gbp_calls, "int"], subs: [["Views", fmt.compact(t.gbp_views)], ["Directions", fmt.int(t.gbp_directions)]] },
      { logo: "ga4", name: "Website", main: ["Sessions", t.ga4_sessions, p?.ga4_sessions, "int"], subs: [["Engaged", fmt.pct(ratio(t.ga4_engaged, t.ga4_sessions), 0)], ["Users", fmt.int(t.ga4_users)]] },
      { logo: "google_ads", name: "Google Ads", main: ["Clicks", t.ads_clicks, p?.ads_clicks, "int"], subs: [["Spend", fmt.inr(t.ads_cost)], ["CPC", fmt.inr(cpc(t.ads_cost, t.ads_clicks))]] },
      { logo: "crm", name: "Patients", main: ["Leads", t.leads, p?.leads, "int"], subs: [["Booked", fmt.int(t.bookings)], ["Revenue", fmt.inr(t.revenue)]] },
    ].map((c: any) => (
      <div key={c.name} className="s-chan-card"><Logo id={c.logo} size={44} /><h5>{c.name}</h5><small>{c.main[0]}</small>
        <strong>{c.main[1] == null ? "—" : fmt.int(c.main[1])}</strong><Delta cur={c.main[1]} prev={c.main[2]} />
        <dl>{c.subs.map(([k, v]: string[]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl></div>
    ))}</div></Slide> });
  if (kind !== "weekly") slides.push({ key: "trend", el: <Slide {...brand} n={0} title={kind === "paid" ? "Ad clicks and spend, day by day" : "Day by day"}>
    {ser.length ? (kind === "paid" ? (
      <BarChart width={1180} height={470} data={ser} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#E6E2D8" /><XAxis dataKey="label" tick={{ fontSize: 13, fill: "#6A7484" }} interval="preserveStartEnd" minTickGap={30} />
        <YAxis yAxisId="l" tick={{ fontSize: 13, fill: "#6A7484" }} /><YAxis yAxisId="r" orientation="right" tick={{ fontSize: 13, fill: "#6A7484" }} tickFormatter={(v) => fmt.compact(v)} />
        <Legend wrapperStyle={{ fontSize: 14 }} /><Bar yAxisId="l" dataKey="ads_clicks" name="Ad clicks" fill="#0B1F3A" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        <Line yAxisId="r" dataKey="ads_cost" name="Spend (₹)" stroke="#C9A84C" strokeWidth={3} dot={false} isAnimationActive={false} />
      </BarChart>) : (
      <AreaChart width={1180} height={470} data={ser} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <defs><linearGradient id="gS" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0B1F3A" stopOpacity={0.35} /><stop offset="1" stopColor="#0B1F3A" stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid vertical={false} stroke="#E6E2D8" /><XAxis dataKey="label" tick={{ fontSize: 13, fill: "#6A7484" }} interval="preserveStartEnd" minTickGap={30} /><YAxis tick={{ fontSize: 13, fill: "#6A7484" }} />
        <Legend wrapperStyle={{ fontSize: 14 }} />
        <Area dataKey="ga4_sessions" name="Website sessions" stroke="#0B1F3A" strokeWidth={2.5} fill="url(#gS)" isAnimationActive={false} />
        <Area dataKey="gsc_clicks" name="Organic clicks" stroke="#C9A84C" strokeWidth={2.5} fill="none" isAnimationActive={false} />
        <Area dataKey="gbp_calls" name="Profile call taps" stroke="#2E7D7A" strokeWidth={2.5} fill="none" isAnimationActive={false} />
      </AreaChart>)) : <p className="s-muted">No daily data in this period.</p>}
  </Slide> });
  if (kind !== "weekly") slides.push({ key: "funnel", el: <Slide {...brand} n={0} title={kind === "paid" ? "From ad to patient" : "From Google to the chair"} note="Each step names the system that counted it. Steps with no data yet show a dash, never zero.">
    {stages ? <SlideFunnel stages={stages} /> : null}</Slide> });
  if (kind !== "weekly") slides.push({ key: "camps", el: <Slide {...brand} n={0} title="Campaigns" note="Spend, clicks and Google-attributed conversions per campaign.">
    {campRows.length ? <div className={`s-camps n${Math.min(campRows.length, 3)}`}>{campRows.map((c) => (
      <div key={c.name} className="s-camp"><header><Logo id="google_ads" size={36} /><span>{c.name}</span></header>
        <div className="s-camp-grid">
          <div><small>Spend</small><strong>{fmt.inr(c.cost)}</strong></div><div><small>Clicks</small><strong>{fmt.int(c.clicks)}</strong></div>
          <div><small>Cost per click</small><strong>{fmt.inr(c.cpc)}</strong></div><div><small>Conversions</small><strong>{fmt.dec(c.conv)}</strong></div>
          <div><small>Cost per conversion</small><strong>{c.conv ? fmt.inr(c.cost / c.conv) : "—"}</strong></div>
          <div><small>Share of spend</small><strong>{fmt.pct(c.cost / Math.max(1, campRows.reduce((x, y) => x + y.cost, 0)), 0)}</strong></div>
        </div></div>))}</div> : <p className="s-muted">No ad delivery in this period.</p>}
  </Slide> });
  if (kind === "monthly") slides.push({ key: "search", el: <Slide {...brand} n={0} title="What people searched, where they landed">
    <div className="s-two">
      <div><h4><Logo id="gsc" size={26} /> Top Google searches</h4><Bars rows={topQ} fmtV={(v) => `${fmt.int(v)} impr.`} /></div>
      <div><h4><Logo id="ga4" size={26} /> Top landing pages</h4><Bars rows={topL} fmtV={(v) => `${fmt.int(v)} sessions`} /></div>
    </div></Slide> });
  slides.push({ key: "next", el: <Slide {...brand} n={0} title="Next steps">
    {actions.length ? <ol className="s-actions">{actions.map((a) => <li key={a.id}><strong>{a.title}</strong><span>{a.action}</span></li>)}</ol> : <p className="s-muted">Nothing flagged for this period.</p>}
  </Slide> });
  if (kind !== "weekly") slides.push({ key: "sources", el: <Slide {...brand} n={0} title="About the numbers">
    <div className="s-sources"><LogoStack ids={connectedRows.map((i) => SOURCE_MARK[i.source]).filter(Boolean)} size={46} /></div>
    <ul className="s-notes">
      <li><b>Connected:</b> {connected.join(", ") || "—"}.</li>
      {missing.length > 0 && <li><b>Not connected yet:</b> {missing.join(", ")} — shown as a dash, never as zero.</li>}
      <li>Google Ads conversions are Google's own attribution and include phone taps and WhatsApp clicks.</li>
      <li>Leads and revenue count only what the clinic records. Impressions and users count visits, not unique people.</li>
    </ul></Slide> });

  async function downloadPdf() {
    const nodes = [...(deckRef.current?.querySelectorAll<HTMLElement>(".slide") ?? [])];
    if (!nodes.length) return;
    setPdfBusy(`0/${nodes.length}`);
    try {
      const [{ toJpeg }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
      const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [1280, 720], hotfixes: ["px_scaling"], compress: true });
      for (let i = 0; i < nodes.length; i++) {
        setPdfBusy(`${i + 1}/${nodes.length}`);
        const url = await toJpeg(nodes[i], { quality: 0.92, pixelRatio: 2, width: 1280, height: 720, style: { transform: "none" }, cacheBust: true, backgroundColor: "#FBFAF7" });
        if (i) pdf.addPage([1280, 720], "landscape");
        pdf.addImage(url, "JPEG", 0, 0, 1280, 720, undefined, "FAST");
      }
      pdf.save(`Elites-${kdef.label.replace(/\s+/g, "-")}-${f.range.start}_${f.range.end}.pdf`);
    } catch (e: any) { alertMsg(setPdfBusy, e); return; }
    setPdfBusy(null);
  }

  return (
    <Page eyebrow="Reporting" title="Reports"
      intro={<>Presentation-style reports from the live data. Pick a report and a period, flip through the slides, then download a PDF to send to the clinic.</>}
      actions={<><button className="btn ghost" onClick={csv}>CSV</button><button className="btn ghost" onClick={() => window.print()}>Print</button>
        <button className="btn" onClick={downloadPdf} disabled={!!pdfBusy || cur.loading || fd.loading || !items}>{pdfBusy ? (pdfBusy.startsWith("Error") ? pdfBusy : `Building PDF ${pdfBusy}…`) : "⬇ Download PDF"}</button></>}>

      <div className="report-controls no-print">
        <div className="seg">{KINDS.map((x) => <button key={x.k} className={kind === x.k ? "on" : ""} onClick={() => { setKind(x.k); f.setPreset(x.preset); }}>{x.label}</button>)}</div>
        <div className="seg">{QUICK.map((q) => <button key={q} className={f.preset === q ? "on" : ""} onClick={() => f.setPreset(q)}>{({ lastMonth: "Last month", thisMonth: "This month", lastWeek: "Last week", last7: "Last 7 days", last30: "Last 30 days", lastQuarter: "Last quarter" } as Record<string, string>)[q]}</button>)}</div>
        <p className="small muted">{kdef.blurb} {slides.length} slides. Comparison: {f.prevLabel ? `previous period (${f.prevLabel})` : "off — turn it on in the date bar to see changes"}.</p>
      </div>

      {cur.error && <ErrorBox msg={cur.error} />}
      {cur.loading ? <Loading h={400} /> : (
        <div className="deck" ref={deckRef}>
          {slides.map((sl, i) => <SlideFrame key={sl.key}>{sl.key === "cover" ? sl.el : cloneElement(sl.el as ReactElement<any>, { n: i + 1 })}</SlideFrame>)}
        </div>
      )}
    </Page>
  );
}

function alertMsg(set: (s: string | null) => void, e: any) { set(`Error: ${String(e?.message ?? e).slice(0, 60)}`); setTimeout(() => set(null), 6000); }

/** Scales a fixed 1280×720 slide to the available width. The PDF captures the slide at full size. */
function SlideFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setK(el.clientWidth / 1280));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return <div className="slide-frame" ref={ref} style={{ height: 720 * k }}><div className="slide-scale" style={{ transform: `scale(${k})` }}>{children}</div></div>;
}

function Slide({ kind, period, n, title, note, children }: { kind: string; period: string; n: number; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="slide">
      <header className="s-head"><span className="s-brand"><span className="s-mark">E</span>Elites Dental Care · {kind}</span><span>{period}</span></header>
      <div className="s-title"><span className="s-n">{String(n).padStart(2, "0")}</span><h2>{title}</h2></div>
      {note && <p className="s-note">{note}</p>}
      <div className="s-body">{children}</div>
    </section>
  );
}

function Cover({ kind, period, compare, prepared, logos, hero }: { kind: string; period: string; compare: string | null; prepared: string; logos: string[]; hero?: Row }) {
  return (
    <section className="slide cover">
      <div className="c-glow" />
      <div className="c-top"><span className="s-mark big">E</span><div><strong>Elites Dental Care</strong><small>TC Palya Main Road · Bengaluru</small></div></div>
      <div className="c-main">
        <div className="c-eyebrow">{kind}</div>
        <h1>{period}</h1>
        {compare && <p>Compared with {compare}</p>}
      </div>
      {hero && hero.value != null && <div className="c-hero"><strong>{fmt[hero.format](hero.value as number)}</strong><span>{hero.metric.toLowerCase()}</span><Delta cur={hero.value} prev={hero.prev} light /></div>}
      <div className="c-foot"><span>Prepared {prepared}</span><span className="c-logos">{logos.map((l) => <Logo key={l} id={l} size={34} />)}</span></div>
    </section>
  );
}

function Delta({ cur, prev, invert, light }: { cur: Num; prev: Num; invert?: boolean; light?: boolean }) {
  const ch = pctChange(cur, prev);
  if (ch == null) return <span className={`s-delta ${light ? "light" : ""} none`}>—</span>;
  const good = invert ? ch < 0 : ch > 0;
  return <span className={`s-delta ${good ? "up" : "down"} ${light ? "light" : ""}`}>{ch >= 0 ? "▲" : "▼"} {fmt.pct(Math.abs(ch), 0)}</span>;
}

function Bars({ rows, fmtV }: { rows: { name: string; v: number }[]; fmtV: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  if (!rows.length) return <p className="s-muted">No data in this period.</p>;
  return <div className="s-bars">{rows.map((r) => <div key={r.name} className="s-bar"><span className="s-bar-l">{r.name}</span><span className="s-bar-t"><i style={{ width: `${(r.v / max) * 100}%` }} /></span><b>{fmtV(r.v)}</b></div>)}</div>;
}

function SlideFunnel({ stages }: { stages: { key: string; label: string; value: number | null; rateFromPrev?: number | null; source: string }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.value ?? 0));
  const w = (v: number | null) => (v == null || v <= 0 ? 4 : 8 + 92 * (Math.log10(v + 1) / Math.log10(max + 1)));
  return (
    <div className="s-fun">{stages.map((s, i) => (
      <div key={s.key} className="s-fun-row">
        <span className="s-fun-l">{s.label}</span>
        <span className="s-fun-t"><i style={{ width: `${w(s.value)}%`, opacity: 1 - i * 0.06 }} /></span>
        <b>{s.value == null ? "—" : fmt.int(s.value)}</b>
        <small>{s.value == null ? "not measured yet" : s.rateFromPrev != null ? `${fmt.pct(s.rateFromPrev, s.rateFromPrev < 0.1 ? 1 : 0)} of previous` : "start"}</small>
      </div>
    ))}</div>
  );
}
