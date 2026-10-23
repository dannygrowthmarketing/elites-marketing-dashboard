import { useMemo, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ErrorBox, Kpi, KpiRow, Loading, Page, Section, Tag } from "../components/ui";
import { useFilters, useRpc, useTable } from "../state";
import { ACTION_EVENTS, BOOKING_EVENTS, CHANNELS, anomalies, contributions, forecast, stoppedSince, type Pt } from "../lib/funnel";
import { fmt, pctChange, ratio } from "../lib/metrics";
import { C, totals } from "./Overview";
import { InsightList, useInsights } from "./Insights";
import { byChannel, useEvents, useFunnelData } from "./funnelData";

const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const back = (n: number) => { const d = new Date(todayIso() + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const METRICS = [
  { key: "sessions", label: "Website visits", fmtK: "int" as const },
  { key: "actions", label: "Lead actions", fmtK: "int" as const },
  { key: "bookings", label: "Online bookings", fmtK: "int" as const },
  { key: "spend", label: "Ad spend", fmtK: "inr" as const },
  { key: "clicks", label: "Ad clicks", fmtK: "int" as const },
];

interface Factor { label: string; points: number; ok: boolean; detail: string }
interface Health { area: string; score: number | null; factors: Factor[]; link: string }

export default function AiIntelligence() {
  const f = useFilters();
  const d = useFunnelData();
  const { items } = useInsights();
  const hist = useRpc<any[]>("rpc_daily_series", { p_start: back(120), p_end: todayIso() });
  const histEv = useEvents(back(120), todayIso());
  const camps = useRpc<any[]>("rpc_ads_campaigns", { p_start: f.range.start, p_end: f.range.end });
  const integ = useTable<any>("integrations", (q) => q.select("source,status"));
  const site = useTable<any>("settings", (q) => q.select("value").eq("key", "site_check"));
  const [metric, setMetric] = useState("sessions");

  // Daily history for forecasting and anomaly detection (independent of the date filter).
  const days = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of hist.data ?? []) m.set(r.date, { date: r.date, sessions: num(r.ga4_sessions), spend: num(r.ads_cost), clicks: num(r.ads_clicks), actions: 0, bookings: 0 });
    for (const e of histEv.data ?? []) { const r = m.get(e.date); if (!r) continue; if (ACTION_EVENTS.includes(e.event_name)) r.actions += +e.event_count; else if (BOOKING_EVENTS.includes(e.event_name)) r.bookings += +e.event_count; }
    // GA4 lags a day; drop today so a half day doesn't look like a crash.
    return [...m.values()].filter((r) => r.date < todayIso());
  }, [hist.data, histEv.data]);
  const series: Pt[] = days.map((r) => ({ date: r.date, value: r[metric] }));
  const fc = useMemo(() => forecast(series, 30), [days, metric]);
  const anom = useMemo(() => anomalies(series), [days, metric]);
  const spendStop = useMemo(() => stoppedSince(days.map((r) => ({ date: r.date, value: r.spend }))), [days]);

  const t = totals(d.cur.data), p = d.hasPrev ? totals(d.prev.data) : null;
  const ch = byChannel(d.acq.data, d.ev.data);
  const chPrev = d.hasPrev ? byChannel(d.acqPrev.data, d.evPrev.data) : null;
  const sum = (k: "sessions" | "actions" | "bookings", x = ch) => CHANNELS.reduce((a, c) => a + x[c][k], 0);
  const check = site.data?.[0]?.value;
  const health = useMemo(() => buildHealth({ t, p, ch, chPrev, camps: camps.data ?? [], leads: d.leads.data?.length ?? null, integ: integ.data ?? [], check, spendStop, keyEvents: (d.acq.data ?? []).reduce((a, r) => a + +r.key_events, 0) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d.cur.data, d.prev.data, d.acq.data, d.ev.data, camps.data, d.leads.data, integ.data, check, spendStop]);

  const sessDrv = chPrev ? contributions(Object.fromEntries(CHANNELS.map((c) => [c, ch[c].sessions])), Object.fromEntries(CHANNELS.map((c) => [c, chPrev[c].sessions]))) : null;
  const actDrv = chPrev ? contributions(Object.fromEntries(CHANNELS.map((c) => [c, ch[c].actions])), Object.fromEntries(CHANNELS.map((c) => [c, chPrev[c].actions]))) : null;
  const brief = d.loading ? null : briefing({ label: f.label, prevLabel: f.prevLabel, t, p, ch, chPrev, sum, health, items: items ?? [], spendStop, sessDrv });
  const M = METRICS.find((x) => x.key === metric)!;

  return (
    <Page eyebrow="Analysis" title="AI intelligence"
      intro={<>An automated analyst over your own data: a written briefing, health scores, a 30-day forecast, what changed and why, unusual days, and the actions worth doing first. Built on statistics and fixed rules — every finding shows how it was worked out, and nothing leaves your database. <Tag tone="info">Automated analysis</Tag></>}>
      {d.error && <ErrorBox msg={d.error} />}

      <Section n="01" title={`Briefing — ${f.label.toLowerCase()}`}>
        {!brief ? <Loading /> : (
          <div className="brief card">
            {brief.map((b, i) => <p key={i} className={i === 0 ? "brief-lead" : ""}>{b}</p>)}
          </div>
        )}
      </Section>

      <Section n="02" title="Health scores" note="Each area starts at 100 and loses points for specific, checkable problems. Click a card for the list.">
        {d.loading ? <Loading /> : (
          <div className="health-grid">{health.map((h) => <HealthCard key={h.area} h={h} />)}</div>
        )}
      </Section>

      <Section n="03" title="Next 30 days" right={
        <select value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Metric">{METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>}
        note={fc ? `${fc.method}. The band is the likely range if nothing changes.` : undefined}>
        {hist.loading || histEv.loading ? <Loading h={280} /> : !fc ? <div className="empty">Needs at least 28 days of {M.label.toLowerCase()} to forecast.</div> : (
          <>
            <KpiRow>
              <Kpi big label={`Forecast ${M.label.toLowerCase()}, next 30 days`} value={fc.total} format={M.fmtK} sub={`likely ${fmt[M.fmtK](fc.lo)} – ${fmt[M.fmtK](fc.hi)}`} />
              <Kpi label="Last 30 days, actual" value={days.slice(-30).reduce((a, r) => a + (r[metric] ?? 0), 0)} format={M.fmtK} />
            </KpiRow>
            {spendStop && <p className="warnline">Google Ads has spent nothing since {spendStop}{metric === "spend" || metric === "clicks" ? "" : ", and paid search brings most visits and actions"}. The forecast assumes that continues — expect it to rebound once ads serve again.</p>}
            <ForecastChart pts={fc.points} anom={anom} fmtK={M.fmtK} />
          </>
        )}
      </Section>

      <Section n="04" title="What changed, and where" note={d.hasPrev ? `${f.label} vs ${f.prevLabel}, split by channel.` : undefined}>
        {!d.hasPrev ? <div className="empty">Turn on “vs previous period” in the date bar to see what drove the change.</div> : d.loading ? <Loading /> : (
          <div className="two-col">
            <Drivers title="Website visits" total={[sum("sessions"), chPrev ? sum("sessions", chPrev) : 0]} rows={sessDrv ?? []} />
            <Drivers title="Lead actions" total={[sum("actions"), chPrev ? sum("actions", chPrev) : 0]} rows={actDrv ?? []} />
          </div>
        )}
      </Section>

      <Section n="05" title="Unusual days" note={`Days where ${M.label.toLowerCase()} sat far outside the previous four weeks (2.5+ standard deviations). Changes the metric with the selector in section 03.`}>
        {hist.loading ? <Loading /> : anom.length === 0 ? <div className="empty">No unusual days for {M.label.toLowerCase()} in the last 120 days.</div> : (
          <div className="anom-list">
            {anom.slice(-8).reverse().map((a) => (
              <div key={a.date} className="card anom">
                <strong>{new Date(a.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</strong>
                <span className={`delta ${a.z > 0 ? "up" : "down"}`}>{a.z > 0 ? "▲" : "▼"} {fmt[M.fmtK](a.value)}</span>
                <span className="small muted">usual ≈ {fmt[M.fmtK](a.mean)} · {Math.abs(a.z).toFixed(1)}σ</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section n="06" title="Do these first" note="Ranked by severity. Each one cites its evidence and the period it compares.">
        <InsightList items={items} />
      </Section>

      <Section n="07" title="How this works">
        <div className="card small">
          <p><strong>Forecast:</strong> a straight-line trend plus each weekday's usual pattern, fitted on up to 84 days, with one-off spikes removed first. <strong>Unusual days:</strong> compared with the 28 days before. <strong>What changed:</strong> each channel's share of the difference between the two periods. <strong>Health scores and actions:</strong> fixed, published rules — the same data always gives the same result.</p>
          <p className="muted">No language model writes these findings, and no data is sent anywhere. They point to patterns worth checking; they don't prove cause. Written commentary from Claude can be added later — it would need a paid API key.</p>
        </div>
      </Section>
    </Page>
  );
}

const num = (v: any) => (v == null ? null : Number(v));

function buildHealth(x: { t: any; p: any; ch: any; chPrev: any; camps: any[]; leads: number | null; integ: any[]; check: any; spendStop: string | null; keyEvents: number }): Health[] {
  const actions = CHANNELS.reduce((a, c) => a + x.ch[c].actions, 0), sessions = CHANNELS.reduce((a, c) => a + x.ch[c].sessions, 0), bookings = CHANNELS.reduce((a, c) => a + x.ch[c].bookings, 0);
  const engaged = CHANNELS.reduce((a, c) => a + x.ch[c].engaged, 0);
  const F = (ok: boolean, label: string, pts: number, detail: string): Factor => ({ ok, label, points: ok ? 0 : -pts, detail });
  const score = (fs: Factor[]) => Math.max(0, 100 + fs.reduce((a, f) => a + f.points, 0));

  const convValue = x.camps.reduce((a, c) => a + +c.conversion_value, 0), convs = x.camps.reduce((a, c) => a + +c.conversions, 0);
  const clarity = x.integ.find((i) => i.source === "clarity")?.status === "connected";
  const tracking = [
    F(!(actions > 0 && x.keyEvents === 0), "GA4 key events marked", 25, actions > 0 && x.keyEvents === 0 ? `${fmt.int(actions)} lead actions recorded, but none are marked as key events — GA4 and Google Ads can't optimise for them.` : "Lead events are marked as key events."),
    F(!(bookings > 0 && (x.leads ?? 0) === 0), "Bookings reach the CRM", 30, bookings > 0 && (x.leads ?? 0) === 0 ? `${fmt.int(bookings)} online bookings on the site, 0 leads in the CRM for the period.` : "Bookings and CRM leads line up."),
    F(!(x.ch["Paid search"].bookings >= 3 && convs <= 1), "Google Ads sees the bookings", 15, `Google Ads counted ${fmt.dec(convs)} conversions; the site recorded ${fmt.int(x.ch["Paid search"].bookings)} paid online bookings.`),
    F(!(convs > 0 && Math.abs(convValue - convs) < 0.01), "Real conversion values", 10, convs > 0 && Math.abs(convValue - convs) < 0.01 ? "Conversion value is ₹1 per conversion — a placeholder, so return on spend can't be judged in Google Ads." : "Conversion values are set."),
    F(clarity, "Behaviour tracking (Clarity)", 10, clarity ? "Clarity is connected." : "Clarity isn't connected."),
  ];
  const ctr = ratio(x.t.ads_clicks, x.t.ads_impressions);
  const cpa = ratio(x.t.ads_cost, x.ch["Paid search"].actions), cpaPrev = x.p && x.chPrev ? ratio(x.p.ads_cost, x.chPrev["Paid search"].actions) : null;
  const paidRate = ratio(x.ch["Paid search"].actions, x.ch["Paid search"].sessions), siteRate = ratio(actions, sessions);
  const paid = x.t.ads_cost == null && !x.spendStop ? null : [
    F(!x.spendStop, "Campaigns are serving", 40, x.spendStop ? `No spend or impressions since ${x.spendStop}. Check billing and campaign status.` : "Ads served in the last few days."),
    F(ctr == null || ctr >= 0.03, "Click-through rate", 15, ctr == null ? "No impressions in period." : `CTR ${fmt.pct(ctr)} — ${ctr >= 0.06 ? "strong" : ctr >= 0.03 ? "fine" : "low for local search; review ad copy and keywords"}.`),
    F(!(cpa != null && cpaPrev != null && cpa > cpaPrev * 1.25), "Cost per lead action steady", 15, cpa == null ? "No paid actions in period." : `₹${Math.round(cpa)} per action${cpaPrev ? ` vs ₹${Math.round(cpaPrev)} before` : ""}.`),
    F(!(paidRate != null && siteRate != null && paidRate < siteRate * 0.7), "Paid visitors act like others", 10, paidRate == null ? "No paid visits." : `Paid visitors take action ${fmt.pct(paidRate)} of the time vs ${fmt.pct(siteRate)} site-wide.`),
  ];
  const pages: any[] = x.check?.pages ?? [];
  const svc = pages.filter((pg) => pg.status === 200 && !["/", "/contact-us/", "/appointment-form/", "/about-us/"].includes(pg.path));
  const broken = pages.filter((pg) => pg.status !== 200);
  const gscCh = x.p ? pctChange(x.t.gsc_clicks, x.p.gsc_clicks) : null;
  const seo = !x.check ? null : [
    F(svc.some((pg) => pg.faq_items > 0), "FAQ markup on service pages", 15, svc.some((pg) => pg.faq_items > 0) ? "Present." : "None of the service pages mark up their FAQs, so Google can't show them as answers."),
    F(pages.filter((pg) => pg.status === 200 && pg.h1_count === 1).length >= pages.filter((pg) => pg.status === 200).length * 0.7, "One H1 per page", 10, `${pages.filter((pg) => pg.status === 200 && pg.h1_count !== 1).length} pages have zero or several H1 headings.`),
    F(broken.length === 0, "No broken pages in Google", Math.min(20, broken.length * 10), broken.length ? `Google still shows ${broken.map((b) => b.path).join(", ")}, which no longer load.` : "None found."),
    F(!(gscCh != null && gscCh < -0.2), "Search clicks holding up", 15, gscCh == null ? "Turn on comparison to check the trend." : `Search clicks ${gscCh >= 0 ? "up" : "down"} ${fmt.pct(Math.abs(gscCh), 0)} vs previous period.`),
    F(x.check.llms_txt?.status === 200, "llms.txt for AI tools", 5, x.check.llms_txt?.status === 200 ? "Present." : "Missing — a short plain-language summary helps AI assistants describe the clinic."),
  ];
  const er = ratio(engaged, sessions);
  const web = sessions === 0 ? null : [
    F(er == null || er >= 0.5, "Visitors engage", 15, `${fmt.pct(er)} of visits are engaged (10s+, 2+ pages or an action).`),
    F(siteRate == null || siteRate >= 0.05, "Visitors take action", 15, `${fmt.pct(siteRate)} of visits lead to a call, WhatsApp, booking or directions tap.`),
    F(bookings > 0, "Online booking works", 15, bookings > 0 ? `${fmt.int(bookings)} confirmed online bookings.` : "No confirmed online bookings in the period — test the booking form."),
  ];
  return [
    { area: "Tracking & data", score: score(tracking), factors: tracking, link: "/integrations" },
    { area: "Paid search", score: paid ? score(paid) : null, factors: paid ?? [], link: "/paid" },
    { area: "Search & AI visibility", score: seo ? score(seo) : null, factors: seo ?? [], link: "/seo?tab=aeo" },
    { area: "Website", score: web ? score(web) : null, factors: web ?? [], link: "/funnel" },
    { area: "Lead handling", score: x.leads ? 100 : null, factors: x.leads ? [] : [{ ok: false, label: "No CRM leads yet", points: 0, detail: "Scores once enquiries are in the CRM: response time, follow-ups and booking rate." }], link: "/crm" },
  ];
}

function briefing(x: { label: string; prevLabel: string | null; t: any; p: any; ch: any; chPrev: any; sum: (k: any, c?: any) => number; health: Health[]; items: any[]; spendStop: string | null; sessDrv: any[] | null }): string[] {
  const s = x.sum("sessions"), a = x.sum("actions"), b = x.sum("bookings");
  const sp = x.chPrev ? x.sum("sessions", x.chPrev) : null, ap = x.chPrev ? x.sum("actions", x.chPrev) : null;
  const chg = (c: number, p: number | null) => (p ? ` (${c >= p ? "up" : "down"} ${fmt.pct(Math.abs((c - p) / p), 0)} on ${x.prevLabel})` : "");
  const paid = x.ch["Paid search"];
  const out: string[] = [];
  out.push(`${x.label}: ${fmt.int(s)} website visits${chg(s, sp)}, ${fmt.int(a)} lead actions${chg(a, ap)} and ${fmt.int(b)} confirmed online bookings.`);
  if (x.t.ads_cost) out.push(`Google Ads spent ${fmt.inr(x.t.ads_cost)} for ${fmt.int(x.t.ads_clicks)} clicks. Paid search brought ${fmt.pct(ratio(paid.sessions, s), 0)} of visits and ${fmt.pct(ratio(paid.actions, a), 0)} of lead actions, at ${fmt.inr(ratio(x.t.ads_cost, paid.actions))} per action.`);
  if (x.spendStop) out.push(`Ads have not served since ${x.spendStop} — that is the single biggest risk to next month's enquiries.`);
  const top = x.sessDrv?.[0];
  if (top && top.delta !== 0) out.push(`Biggest change: ${top.key} visits went ${top.delta > 0 ? "up" : "down"} by ${fmt.int(Math.abs(top.delta))}.`);
  const weakest = x.health.filter((h) => h.score != null).sort((p, q) => p.score! - q.score!)[0];
  if (weakest) out.push(`Weakest area: ${weakest.area.toLowerCase()} (${weakest.score}/100) — ${weakest.factors.filter((f) => !f.ok)[0]?.detail ?? "see the list"}`);
  const hi = x.items.filter((i) => i.severity === "high").slice(0, 2).map((i) => i.title.toLowerCase());
  if (hi.length) out.push(`First to fix: ${hi.join("; ")}.`);
  return out;
}

function HealthCard({ h }: { h: Health }) {
  const [open, setOpen] = useState(false);
  const tone = h.score == null ? "neutral" : h.score >= 80 ? "good" : h.score >= 60 ? "warn" : "bad";
  return (
    <div className={`card health ${tone}`} onClick={() => setOpen((o) => !o)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen((o) => !o)}>
      <div className="small muted">{h.area}</div>
      <div className="big-num">{h.score == null ? "—" : h.score}<span className="small muted">{h.score == null ? " not enough data" : " / 100"}</span></div>
      <div className="hbar"><i style={{ width: `${h.score ?? 0}%` }} /></div>
      {open ? (
        <ul className="factors">{h.factors.map((f) => <li key={f.label} className={f.ok ? "ok" : "bad"}><strong>{f.ok ? "✓" : `${f.points}`}</strong> {f.label}<div className="small muted">{f.detail}</div></li>)}
          <li><a href={`#${h.link}`} onClick={(e) => e.stopPropagation()}>Open →</a></li></ul>
      ) : <div className="small muted">{h.factors.filter((f) => !f.ok).length} issue{h.factors.filter((f) => !f.ok).length === 1 ? "" : "s"} · click for detail</div>}
    </div>
  );
}

function ForecastChart({ pts, anom, fmtK }: { pts: any[]; anom: { date: string; value: number }[]; fmtK: "int" | "inr" }) {
  const data = pts.map((p) => ({ ...p, label: new Date(p.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }), band: p.lo != null ? [p.lo, p.hi] : null }));
  const marks = anom.filter((a) => data.some((d) => d.date === a.date));
  return (
    <div className="chart" style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
          <CartesianGrid stroke="var(--rule)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={24} />
          <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v) => (fmtK === "inr" ? "₹" : "") + fmt.compact(v)} width={48} />
          <Tooltip contentStyle={{ background: "var(--paper)", border: "1px solid var(--rule)", borderRadius: 6, fontSize: 12 }}
            formatter={(v: any, n: any) => [Array.isArray(v) ? `${fmt[fmtK](v[0])} – ${fmt[fmtK](v[1])}` : fmt[fmtK](v), n]} />
          <Area dataKey="band" name="Likely range" fill={C.gold} fillOpacity={0.15} stroke="none" isAnimationActive={false} />
          <Line dataKey="actual" name="Actual" stroke={C.navy} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          <Line dataKey="forecast" name="Forecast" stroke={C.gold} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          {marks.map((m) => <ReferenceDot key={m.date} x={data.find((d) => d.date === m.date)!.label} y={m.value} r={5} fill={C.rust} stroke="var(--paper)" />)}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="legend"><span><i style={{ background: C.navy }} />Actual</span><span><i style={{ background: C.gold }} />Forecast</span><span><i style={{ background: C.rust }} />Unusual day</span></div>
    </div>
  );
}

function Drivers({ title, total, rows }: { title: string; total: [number, number]; rows: any[] }) {
  const ch = total[1] ? (total[0] - total[1]) / total[1] : null;
  const data = rows.slice(0, 6).map((r) => ({ name: r.key, delta: r.delta, cur: r.cur, prev: r.prev }));
  return (
    <div>
      <h3 className="sub">{title}: {fmt.int(total[0])} <span className={`delta ${ch != null && ch >= 0 ? "up" : "down"}`}>{ch == null ? "" : fmt.delta(ch)}</span></h3>
      {!data.length ? <div className="empty">No change.</div> : (
        <div className="chart" style={{ height: Math.max(140, data.length * 34) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 8 }}>
              <CartesianGrid stroke="var(--rule)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={124} interval={0} tick={{ fontSize: 12, fill: "var(--ink)" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "var(--paper)", border: "1px solid var(--rule)", borderRadius: 6, fontSize: 12 }}
                formatter={(v: any, _n: any, p: any) => [`${v > 0 ? "+" : ""}${fmt.int(v)} (${fmt.int(p.payload.prev)} → ${fmt.int(p.payload.cur)})`, "Change"]} />
              <Bar dataKey="delta" radius={3} maxBarSize={20} isAnimationActive={false}>
                {data.map((r) => <Cell key={r.name} fill={r.delta >= 0 ? C.teal : C.rust} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
