import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Area } from "recharts";
import { DataTable, ErrorBox, Kpi, KpiRow, Loading, Page, Section, Tag } from "../components/ui";
import { useTable } from "../state";
import { ACTION_EVENTS, BOOKING_EVENTS, curve, marginalCostPerBooking, monthly, simulate, withRates, type Baseline, type SimInputs } from "../lib/funnel";
import { fmt } from "../lib/metrics";
import { C } from "./Overview";
import { FunnelDiagram } from "./funnelData";

const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const back = (n: number) => { const d = new Date(todayIso() + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const KEY = "edc.budgetScenarios.v2";
const CALL_EVENTS = ["phone_call_click", "whatsapp_click", "joinchat"];
const load = (): any[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; } };
const save = (s: any[]) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } };

export default function BudgetSimulator() {
  const [lookback, setLookback] = useState(60);
  const start = back(lookback);
  const ads = useTable<any>("ads_daily_campaign", (q) => q.select("date,clicks,cost_micros,impressions").eq("device", "ALL").gte("date", start).limit(5000), [start]);
  const ga = useTable<any>("ga4_daily_traffic", (q) => q.select("date,sessions").eq("channel_group", "Paid Search").gte("date", start).limit(20000), [start]);
  const ev = useTable<any>("ga4_daily_events", (q) => q.select("date,event_name,event_count").eq("channel_group", "Paid Search").in("event_name", [...ACTION_EVENTS, ...BOOKING_EVENTS]).gte("date", start).limit(20000), [start]);
  const rev = useTable<any>("real_revenue", (q) => q.select("amount_inr,lead_id").not("lead_id", "is", null).limit(5000));

  const base = useMemo<Baseline | null>(() => {
    if (!ads.data || !ga.data || !ev.data) return null;
    const byDay = new Map<string, number>();
    for (const r of ads.data) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.cost_micros / 1e6);
    const active = new Set([...byDay.entries()].filter(([, c]) => c > 0).map(([d]) => d));
    const inActive = (d: string) => active.has(d);
    return {
      days: active.size,
      spend: ads.data.filter((r) => inActive(r.date)).reduce((a, r) => a + r.cost_micros / 1e6, 0),
      clicks: ads.data.filter((r) => inActive(r.date)).reduce((a, r) => a + r.clicks, 0),
      visits: ga.data.filter((r) => inActive(r.date)).reduce((a, r) => a + r.sessions, 0),
      actions: ev.data.filter((r) => inActive(r.date) && ACTION_EVENTS.includes(r.event_name)).reduce((a, r) => a + r.event_count, 0),
      calls: ev.data.filter((r) => inActive(r.date) && CALL_EVENTS.includes(r.event_name)).reduce((a, r) => a + r.event_count, 0),
      bookings: ev.data.filter((r) => inActive(r.date) && BOOKING_EVENTS.includes(r.event_name)).reduce((a, r) => a + r.event_count, 0),
    };
  }, [ads.data, ga.data, ev.data]);
  const m = base ? monthly(base) : null;
  const revAvg = rev.data && rev.data.length >= 5 ? rev.data.reduce((a, r) => a + +r.amount_inr, 0) / rev.data.length : null;
  const onlineRate = base && base.visits > 0 ? base.bookings / base.visits : null;

  const [x, setX] = useState<SimInputs>({ monthlyBudget: 15000, elasticity: 0.85, callToBooking: 0.3, showRate: 0.75, revenuePerPatient: 3500 });
  const [init, setInit] = useState(false);
  useEffect(() => {
    if (init || !m) return;
    setX((s) => ({ ...s, monthlyBudget: Math.max(1000, Math.round(m.spend / 500) * 500), revenuePerPatient: revAvg ? Math.round(revAvg) : s.revenuePerPatient }));
    setInit(true);
  }, [m, revAvg, init]);
  const [saved, setSaved] = useState<any[]>(load);

  const r = base ? simulate(base, x) : null;
  const now = base && m ? simulate(base, { ...x, monthlyBudget: m.spend }) : null;
  const marg = base ? marginalCostPerBooking(base, x) : null;
  const pts = base ? curve(base, x).map((p) => ({ budget: p.budget, patients: +p.patients.toFixed(1), cpp: p.costPerPatient ? Math.round(p.costPerPatient) : null, lo: +p.low.toFixed(1), hi: +p.high.toFixed(1) })) : [];
  const stages = r ? withRates([
    { key: "clicked", label: "Ad clicks", value: Math.round(r.clicks), source: "Projected from your cost per click, with diminishing returns" },
    { key: "visited", label: "Website visits", value: Math.round(r.visits), source: "Your click → visit rate" },
    { key: "calls", label: "Calls & WhatsApp taps", value: Math.round(r.calls), source: "Your paid visit → call/WhatsApp rate" },
    { key: "booked", label: "Appointments booked", value: Math.round(r.bookings), source: "Online bookings (measured rate) + calls × booking setting", note: `${r.onlineBookings.toFixed(1)} online + ${r.callBookings.toFixed(1)} from calls` },
    { key: "patients", label: "Patients who visit", value: Math.round(r.patients), source: "Show-up rate (setting)" },
  ]) : null;
  const err = [ads, ga, ev].map((s) => s.error).find(Boolean);
  const thin = base && (base.days < 14 || base.bookings + base.calls * x.callToBooking < 10);
  const set = (k: keyof SimInputs) => (v: number) => setX((s) => ({ ...s, [k]: v }));

  return (
    <Page eyebrow="Planning" title="Budget simulator"
      intro="What a different Google Ads budget would likely deliver, based on how your own campaigns have performed. Move the sliders; every assumption is visible and editable.">
      {err && <ErrorBox msg={err} />}
      <Section n="01" title="Your baseline" right={
        <div className="seg">{[30, 60, 90].map((n) => <button key={n} className={lookback === n ? "on" : ""} onClick={() => setLookback(n)}>Last {n} days</button>)}</div>}
        note="Only days with ad spend count, so paused days don't drag the averages down. Visits and actions are GA4 Paid Search.">
        {!base || !m ? <Loading /> : base.days === 0 ? <div className="empty">No Google Ads spend in the last {lookback} days, so there's nothing to base a projection on. Try a longer window.</div> : (
          <KpiRow>
            <Kpi label="Active ad days" value={base.days} />
            <Kpi label="Spend per month" value={m.spend} format="inr" />
            <Kpi label="Cost per click" value={base.clicks ? base.spend / base.clicks : null} format="inr" />
            <Kpi label="Calls & WhatsApp taps / month" value={m.calls} format="dec" sub={base.visits ? `${fmt.pct(base.calls / base.visits)} of paid visits` : undefined} />
            <Kpi label="Online bookings / month" value={m.bookings} format="dec" sub={onlineRate != null ? `${fmt.pct(onlineRate)} of paid visits` : undefined} />
          </KpiRow>
        )}
      </Section>

      <Section n="02" title="Try a budget">
        {!base || !r || !m ? <Loading /> : base.days === 0 ? null : (
          <div className="sim-grid">
            <div className="card sim-controls">
              <Slider label="Monthly Google Ads budget" value={x.monthlyBudget} min={0} max={Math.max(100000, Math.round(m.spend * 4))} step={500} fmt={(v) => fmt.inr(v)} onChange={set("monthlyBudget")}
                hint={`Recent rate while ads were running: ${fmt.inr(m.spend)} a month`} />
              <Slider label="Calls & WhatsApp that become a booking" value={x.callToBooking} min={0.05} max={0.8} step={0.05} fmt={(v) => fmt.pct(v, 0)} onChange={set("callToBooking")}
                hint={<>Taps are measured; what happens on the call isn't yet. Log calls in the CRM to replace this with your real rate. Online bookings are already counted separately at your measured rate. <Tag tone="warn">assumption</Tag></>} />
              <Slider label="Booked patients who turn up" value={x.showRate} min={0.3} max={1} step={0.05} fmt={(v) => fmt.pct(v, 0)} onChange={set("showRate")} hint={<>Mark appointments completed in the CRM to measure this. <Tag tone="warn">assumption</Tag></>} />
              <Slider label="Revenue per new patient" value={x.revenuePerPatient} min={500} max={30000} step={250} fmt={(v) => fmt.inr(v)} onChange={set("revenuePerPatient")}
                hint={revAvg ? `Your recorded average: ${fmt.inr(revAvg)}` : <>No revenue recorded yet. First-visit value, not lifetime. <Tag tone="warn">assumption</Tag></>} />
              <Slider label="How fast extra spend gets pricier" value={x.elasticity} min={0.5} max={1} step={0.05} fmt={(v) => v.toFixed(2)} onChange={set("elasticity")}
                hint="1.00 = clicks grow in line with spend. 0.85 (default) = doubling budget gives ~1.8× clicks, because the extra clicks are bought at higher prices." />
              <div className="btns">
                <button className="btn ghost" onClick={() => { const s = [...saved, { name: `Scenario ${saved.length + 1}`, x, r: { patients: r.patients, revenue: r.revenue, cpp: r.costPerPatient, roas: r.roas, bookings: r.bookings } }].slice(-4); setSaved(s); save(s); }}>Save scenario</button>
                <button className="btn ghost" onClick={() => setX((s) => ({ ...s, monthlyBudget: Math.round(m.spend) }))}>Reset to current</button>
              </div>
            </div>
            <div>
              <KpiRow>
                <Kpi big label="Patients per month" value={r.patients} format="dec" prev={now?.patients} sub={`likely ${r.low.toFixed(0)}–${r.high.toFixed(0)}`} />
                <Kpi label="Revenue per month" value={r.revenue} format="inr" prev={now?.revenue} />
                <Kpi label="Cost per patient" value={r.costPerPatient} format="inr" prev={now?.costPerPatient} invert />
                <Kpi label="Return on ad spend" value={r.roas} format="x" prev={now?.roas} />
                <Kpi label="Cost of the next booking" value={marg} format="inr" sub="extra spend ÷ extra bookings at +10%" invert />
              </KpiRow>
              {thin && <p className="warnline">Only {base.days} active days and few bookings behind this — treat it as a direction, not a promise. The range shows how much it could vary.</p>}
              {stages && <FunnelDiagram stages={stages} />}
            </div>
          </div>
        )}
      </Section>

      <Section n="03" title="How results scale with budget" note="Each point is the same model at a different monthly budget. The shaded band is the likely range. Cost per patient rises as budget grows.">
        {!base ? <Loading /> : base.days === 0 ? null : <ResponseCurve pts={pts} now={m?.spend ?? 0} sel={x.monthlyBudget} />}
      </Section>

      <Section n="04" title="Saved scenarios" note="Kept in this browser only.">
        {saved.length === 0 ? <div className="empty">Save a scenario to compare it here.</div> : (
          <>
            <DataTable rows={saved} cols={[
              { key: "name", label: "Scenario" },
              { key: "b", label: "Budget", align: "right", format: "inr", value: (s: any) => s.x.monthlyBudget },
              { key: "ctb", label: "Call → booking", align: "right", format: "pct", value: (s: any) => s.x.callToBooking },
              { key: "p", label: "Patients", align: "right", format: "dec", value: (s: any) => s.r.patients },
              { key: "rev", label: "Revenue", align: "right", format: "inr", value: (s: any) => s.r.revenue },
              { key: "cpp", label: "Cost / patient", align: "right", format: "inr", value: (s: any) => s.r.cpp },
              { key: "roas", label: "Return", align: "right", format: "x", value: (s: any) => s.r.roas },
            ]} />
            <div className="btns"><button className="btn ghost" onClick={() => { setSaved([]); save([]); }}>Clear scenarios</button></div>
          </>
        )}
      </Section>

      <Section n="05" title="How the projection works">
        <div className="card small">
          <p><strong>Clicks</strong> = your monthly clicks × (new budget ÷ current budget)<sup>{x.elasticity.toFixed(2)}</sup>. <strong>Visits, actions</strong> use your own paid rates. <strong>Bookings</strong> = online bookings at your measured rate + calls/WhatsApp taps × your call → booking setting (book-button clicks aren't counted twice). <strong>Patients</strong> = bookings × show-up rate. <strong>Revenue</strong> = patients × revenue per patient.</p>
          <p className="muted">Limits: assumes the same campaigns, keywords and landing pages; very large increases may hit search-volume limits in the TC Palya area sooner than the curve suggests. Meta isn't modelled until it's connected.</p>
        </div>
      </Section>
    </Page>
  );
}

function Slider({ label, value, min, max, step, fmt: f, onChange, hint }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void; hint?: React.ReactNode }) {
  return (
    <label className="slider">
      <span className="row"><span>{label}</span><strong>{f(value)}</strong></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      {hint && <span className="small muted">{hint}</span>}
    </label>
  );
}

function ResponseCurve({ pts, now, sel }: { pts: any[]; now: number; sel: number }) {
  if (!pts.length) return <div className="empty">Not enough data.</div>;
  return (
    <div className="chart" style={{ height: 300 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={pts} margin={{ top: 10, right: 8, bottom: 0, left: -4 }}>
          <CartesianGrid stroke="var(--rule)" vertical={false} />
          <XAxis dataKey="budget" type="number" domain={[0, "dataMax"]} tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v) => "₹" + fmt.compact(v)} />
          <YAxis yAxisId="l" tick={{ fontSize: 11, fill: "var(--muted)" }} width={40} />
          <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v) => "₹" + fmt.compact(v)} width={52} />
          <Tooltip contentStyle={{ background: "var(--paper)", border: "1px solid var(--rule)", borderRadius: 6, fontSize: 12 }}
            labelFormatter={(v) => `Budget ${fmt.inr(Number(v))} / month`}
            formatter={(v: any, n: any) => (n === "Cost per patient" ? [fmt.inr(v), n] : n === "Likely range" ? [Array.isArray(v) ? `${v[0]}–${v[1]}` : v, n] : [v, n])} />
          <Area yAxisId="l" dataKey={(d: any) => [d.lo, d.hi]} name="Likely range" fill={C.navy} fillOpacity={0.1} stroke="none" isAnimationActive={false} />
          <Line yAxisId="l" dataKey="patients" name="Patients / month" stroke={C.navy} strokeWidth={2.5} dot={false} isAnimationActive={false} />
          <Line yAxisId="r" dataKey="cpp" name="Cost per patient" stroke={C.gold} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          <ReferenceLine yAxisId="l" x={Math.round(now)} stroke={C.slate} strokeDasharray="4 4" label={{ value: "now", fill: "var(--muted)", fontSize: 11, position: "top" }} />
          <ReferenceLine yAxisId="l" x={sel} stroke={C.rust} label={{ value: "selected", fill: C.rust, fontSize: 11, position: "top" }} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="legend"><span><i style={{ background: C.navy }} />Patients per month</span><span><i style={{ background: C.gold }} />Cost per patient</span></div>
    </div>
  );
}
