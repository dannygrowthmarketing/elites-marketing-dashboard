import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { Kpi, KpiRow, Page, Section, Tag } from "../components/ui";
import { useTable } from "../state";
import { allocate, byChannel, DEFAULT_ASSUMPTIONS, project, type Assumptions, type Category, type Goal } from "../lib/budgetPlan";
import { Logo, LogoStack } from "../components/Logo";
import { ACTION_EVENTS, BOOKING_EVENTS } from "../lib/funnel";
import { fmt } from "../lib/metrics";
import { C } from "./Overview";

const PRESETS = [50000, 75000, 100000, 200000, 500000, 1000000, 2000000];
const COMPARE = [50000, 100000, 200000, 500000, 1000000];
const GOALS: { k: Goal; label: string; blurb: string }[] = [
  { k: "patients", label: "More patients now", blurb: "Most of the money on search and Maps, where people are already looking for a dentist." },
  { k: "balanced", label: "Balanced", blurb: "Patients this quarter plus the content and reputation that make next quarter cheaper." },
  { k: "brand", label: "Build the brand", blurb: "More video, reels and content so Elites becomes the name people search for." },
];
const CAT_COLOR: Record<Category, string> = { "Paid media": C.navy, Foundation: C.teal, "Content & creative": C.gold, "Community & CRM": C.plum, Reserve: C.slate };
const CALLS = ["phone_call_click", "whatsapp_click", "joinchat"];
const lakh = (n: number) => n < 100000 ? `₹${Math.round(n / 1000)}K` : `₹${(n / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 2 })}L`;
const back = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

export default function BudgetPlan() {
  const [total, setTotal] = useState(100000);
  const [months, setMonths] = useState(3);
  const [goal, setGoal] = useState<Goal>("balanced");
  const [a, setA] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const [measured, setMeasured] = useState<Record<string, string>>({});

  // Measured baseline: last 90 days of Google Ads + GA4 paid traffic, active days only.
  const start = back(90);
  const ads = useTable<any>("ads_daily_campaign", (q) => q.select("date,clicks,cost_micros").eq("device", "ALL").gte("date", start).limit(5000), [start]);
  const ev = useTable<any>("ga4_daily_events", (q) => q.select("date,event_name,event_count").eq("channel_group", "Paid Search").in("event_name", [...ACTION_EVENTS, ...BOOKING_EVENTS]).gte("date", start).limit(20000), [start]);
  const rev = useTable<any>("real_revenue", (q) => q.select("amount_inr").limit(5000));
  useEffect(() => {
    if (!ads.data || !ev.data) return;
    const active = ads.data.filter((r) => r.cost_micros > 0);
    const days = new Set(active.map((r) => r.date));
    const spend = active.reduce((s, r) => s + r.cost_micros / 1e6, 0), clicks = active.reduce((s, r) => s + r.clicks, 0);
    if (clicks < 50 || days.size < 7) return;
    const inD = (r: any) => days.has(r.date);
    const bookings = ev.data.filter((r) => inD(r) && BOOKING_EVENTS.includes(r.event_name)).reduce((s, r) => s + r.event_count, 0);
    const calls = ev.data.filter((r) => inD(r) && CALLS.includes(r.event_name)).reduce((s, r) => s + r.event_count, 0);
    const eq = (bookings + calls * 0.3) * 0.75;
    const next: Partial<Assumptions> = { searchCpc: Math.round(spend / clicks), searchBaseMonthly: Math.round((spend / days.size) * 30.4 / 500) * 500 };
    const m: Record<string, string> = { searchCpc: `${fmt.int(clicks)} clicks, ${fmt.inr(spend)} over ${days.size} active days`, searchBaseMonthly: "Average monthly pace on active days" };
    if (eq >= 5) { next.clickToPatient = Math.min(0.08, Math.max(0.01, +(eq / clicks).toFixed(3))); m.clickToPatient = `${bookings} online bookings + 30% of ${calls} call/WhatsApp taps, 75% show rate`; }
    const r = rev.data ?? [];
    if (r.length >= 5) { next.revenuePerPatient = Math.round(r.reduce((s, x) => s + +x.amount_inr, 0) / r.length); m.revenuePerPatient = `Average of ${r.length} recorded payments`; }
    setA((s) => ({ ...s, ...next })); setMeasured(m);
  }, [ads.data, ev.data, rev.data]);

  const plan = useMemo(() => allocate(total, months, goal), [total, months, goal]);
  const proj = useMemo(() => project(plan, a), [plan, a]);
  const media = plan.byCategory.find((c) => c.category === "Paid media")?.share ?? 0;
  const compare = COMPARE.map((t) => { const p = project(allocate(t, months, goal), a); return { t, ...p }; });
  const monthRows = plan.monthTotals.map((_, m) => {
    const row: any = { month: `M${m + 1}`, patients: +proj.months[m].patients.toFixed(1) };
    for (const c of plan.byCategory) row[c.category] = Math.round(plan.lines.filter((l) => l.item.category === c.category).reduce((s, l) => s + l.byMonth[m], 0));
    return row;
  });
  const lines = [...plan.lines].sort((x, y) => y.total - x.total);
  const channels = byChannel(plan);

  return (
    <Page eyebrow="Planning" title="Marketing budget proposal"
      intro={<>Give a total budget — ₹5 lakh, ₹10 lakh, anything — and this lays out how Elites should spend it: which channels, how much each month, what each rupee buys, and roughly how many patients to expect. Paid-search numbers come from the clinic's own Google Ads and GA4 data; everything else is a planning assumption you can change below.</>}
      actions={<button className="btn ghost" onClick={() => window.print()}>Print / PDF</button>}>

      <div className="plan-inputs card">
        <div><label className="small muted">Total budget</label>
          <div className="seg">{PRESETS.map((p) => <button key={p} className={total === p ? "on" : ""} onClick={() => setTotal(p)}>{lakh(p)}</button>)}
            <input type="number" min={25000} step={5000} value={total} onChange={(e) => setTotal(Math.max(25000, +e.target.value || 0))} aria-label="Custom total budget in rupees" style={{ width: 130 }} /></div></div>
        <div><label className="small muted">Over</label>
          <div className="seg">{[1, 3, 6, 12].map((m) => <button key={m} className={months === m ? "on" : ""} onClick={() => setMonths(m)}>{m === 1 ? "1 month" : `${m} months`}</button>)}</div></div>
        <div><label className="small muted">Priority</label>
          <div className="seg">{GOALS.map((g) => <button key={g.k} className={goal === g.k ? "on" : ""} onClick={() => setGoal(g.k)}>{g.label}</button>)}</div>
          <p className="small muted" style={{ margin: "6px 0 0" }}>{GOALS.find((g) => g.k === goal)!.blurb}</p></div>
      </div>

      <KpiRow>
        <Kpi big label="Per month" value={total / months} format="inr" sub={`${lakh(total)} over ${months} months`} />
        <Kpi big label="Paid media share" value={media} format="pct" sub="the rest builds assets that keep working" />
        <Kpi big label="Projected new patients" value={Math.round(proj.patients)} sub={`likely ${Math.round(proj.low)}–${Math.round(proj.high)}`} />
        <Kpi big label="Cost per patient" value={proj.costPerPatient} format="inr" sub="all-in, including set-up" />
        <Kpi big label="Projected revenue" value={proj.revenue} format="compact" sub={proj.roas ? `${proj.roas.toFixed(1)}× the budget` : undefined} />
      </KpiRow>
      <p className="small muted">Projections count patients from search, Maps, Meta, influencers, WhatsApp recalls and camps. SEO, reviews, directories, email and retargeting also bring patients, but their effect is too uncertain to put a number on — treat the figure as a floor for those.</p>

      <Section n="01" title="The plan, channel by channel" note="Every rupee, grouped the way the clinic will see it on invoices and reports.">
        <div className="chan-grid">
          {channels.map((c) => (
            <article key={c.key} className="chan-card" style={{ ["--share" as any]: `${Math.round(c.share * 100)}%` }}>
              <header><LogoStack ids={c.logos} size={30} /><span className="chan-pct">{Math.round(c.share * 100)}%</span></header>
              <h3>{c.label}</h3>
              <div className="chan-amt">{fmt.inr(c.total)}<small> · {fmt.inr(c.total / months)}/mo</small></div>
              <div className="chan-bar"><i /></div>
              <p className="small muted">{c.blurb}</p>
              <ul>{c.lines.map((l) => <li key={l.item.key}><Logo id={l.item.logo} size={18} /><span>{l.item.label}</span><b>{fmt.compact(l.total)}</b></li>)}</ul>
            </article>
          ))}
        </div>
        {months === 1 && <p className="small muted">One-month plans pay the set-up and ad-learning cost without the payback months — the same money over 3 months usually brings more patients.</p>}
      </Section>

      <Section n="02" title="Where the money goes">
        <div className="grid2">
          <div className="chart">
            <div className="chart-title">By type of spend</div>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={plan.byCategory} dataKey="total" nameKey="category" innerRadius={70} outerRadius={110} paddingAngle={1}
                  label={({ category, share }: any) => `${category} ${Math.round(share * 100)}%`} labelLine={false} fontSize={11}>
                  {plan.byCategory.map((c) => <Cell key={c.category} fill={CAT_COLOR[c.category]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => fmt.inr(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="chart">
            <div className="chart-title">By channel</div>
            <ResponsiveContainer width="100%" height={Math.max(280, lines.length * 24)}>
              <BarChart data={lines.map((l) => ({ name: l.item.label.split(" — ")[0].split(" (")[0], v: Math.round(l.total), c: l.item.category }))} layout="vertical" margin={{ left: 8, right: 50 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 11 }} interval={0} />
                <Tooltip formatter={(v: any) => fmt.inr(v)} />
                <Bar dataKey="v" radius={[0, 3, 3, 0]} label={{ position: "right", fontSize: 10.5, formatter: (v: any) => fmt.compact(v) }}>
                  {lines.map((l) => <Cell key={l.item.key} fill={CAT_COLOR[l.item.category]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="table-wrap scroll-x"><table>
          <thead><tr><th>Line</th><th className="r">Total</th><th className="r">Per month</th><th className="r">Share</th><th>What it buys</th><th>Judge it by</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.item.key}><td><span className="line-name"><Logo id={l.item.logo} size={26} /><span><strong>{l.item.label}</strong><br /><span className="small muted">{l.item.category}{l.item.phasing === "front" ? " · front-loaded" : l.item.phasing === "ramp" ? " · ramps up" : ""}</span></span></span></td>
              <td className="r num">{fmt.inr(l.total)}</td><td className="r num">{fmt.inr(l.monthly)}</td><td className="r num">{fmt.pct(l.share, 0)}</td>
              <td className="small">{l.item.buys}</td><td className="small muted">{l.item.kpi}</td></tr>
          ))}
            <tr className="total-row"><td><strong>Total</strong></td><td className="r num"><strong>{fmt.inr(total)}</strong></td><td className="r num">{fmt.inr(total / months)}</td><td className="r">100%</td><td colSpan={2} /></tr>
          </tbody>
        </table></div>
        {plan.dropped.length > 0 && <p className="small muted">Left out at this budget (too small to work): {plan.dropped.map((d) => d.label).join(", ")}. Their share went to the lines above.</p>}
      </Section>

      <Section n="03" title="Month by month" note="Set-up work (tracking, website, directories, the first shoot) is front-loaded. Ads start at 60% and reach full spend by month 3 while campaigns learn.">
        <div className="chart">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={monthRows} margin={{ left: 0, right: 10 }}>
              <CartesianGrid vertical={false} stroke="var(--rule)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="l" tick={{ fontSize: 11 }} tickFormatter={(v) => fmt.compact(v)} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any, n: any) => n === "Projected patients" ? Math.round(v) : fmt.inr(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {plan.byCategory.map((c) => <Bar key={c.category} yAxisId="l" dataKey={c.category} stackId="s" fill={CAT_COLOR[c.category]} />)}
              <Line yAxisId="r" dataKey="patients" name="Projected patients" stroke={C.rust} strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <ol className="timeline">
          <li><b>Month 1</b><strong>Foundation</strong><span>Call tracking, GA4 key events, Meta Pixel, landing pages, Practo/Lybrate profiles, clinic shoot. Search + Maps ads at 60%.</span></li>
          <li><b>Month 2</b><strong>Scale what works</strong><span>Cut keywords and hours with no bookings, move money to the best treatment ads, start reels and the first camp.</span></li>
          <li><b>Month 3+</b><strong>Compound</strong><span>Full spend, monthly report review, release the reserve to the cheapest cost per patient, publish price and FAQ pages.</span></li>
        </ol>
      </Section>

      <Section n="04" title="What different budgets buy" note={`Same ${months}-month period and priority. Each extra lakh buys fewer extra patients, because local search demand within a few km is limited.`}>
        <div className="table-wrap"><table>
          <thead><tr><th>Budget</th><th className="r">Per month</th><th className="r">Projected patients</th><th className="r">Likely range</th><th className="r">Cost per patient</th><th className="r">Projected revenue</th></tr></thead>
          <tbody>{compare.map((c) => (
            <tr key={c.t} className={c.t === total ? "hl" : ""}><td><strong>{lakh(c.t)}</strong></td><td className="r num">{fmt.inr(c.t / months)}</td><td className="r num">{Math.round(c.patients)}</td>
              <td className="r num muted">{Math.round(c.low)}–{Math.round(c.high)}</td><td className="r num">{fmt.inr(c.costPerPatient)}</td><td className="r num">{fmt.compact(c.revenue)}</td></tr>
          ))}</tbody>
        </table></div>
      </Section>

      <Section n="05" title="Assumptions" note="Change any number and the plan updates. ‘Measured’ values come from the dashboard's own data; the rest are planning estimates until there is enough data to replace them.">
        <div className="assume-grid">
          {([
            ["searchCpc", "Search cost per click (₹)", 1],
            ["searchBaseMonthly", "Search spend the CPC was measured at (₹/month)", 500],
            ["clickToPatient", "Search click → patient", 0.005],
            ["elasticity", "Diminishing returns (1 = none)", 0.05],
            ["localCostFactor", "Maps/PMax cost per patient vs Search (×)", 0.1],
            ["metaCostPerLead", "Meta cost per lead (₹)", 25],
            ["metaLeadToPatient", "Meta lead → patient", 0.05],
            ["waCostPerMessage", "WhatsApp cost per message (₹)", 0.1],
            ["waBookRate", "WhatsApp message → booking", 0.001],
            ["waAudience", "Opted-in WhatsApp contacts", 100],
            ["influencerCostPerPatient", "Influencer cost per patient (₹)", 250],
            ["campCost", "Cost per camp (₹)", 1000],
            ["patientsPerCamp", "Patients per camp", 1],
            ["revenuePerPatient", "Revenue per patient (₹)", 100],
          ] as [keyof Assumptions, string, number][]).map(([k, label, step]) => (
            <label key={k} className="assume">
              <span>{label} {measured[k] ? <Tag tone="good">measured</Tag> : <Tag tone="warn">assumption</Tag>}</span>
              <input type="number" step={step} value={a[k]} onChange={(e) => setA((s) => ({ ...s, [k]: +e.target.value || 0 }))} />
              {measured[k] && <small className="muted">{measured[k]}</small>}
            </label>
          ))}
        </div>
        <p className="small muted">Ranges are ±40%. These are plans, not quotes — confirm vendor prices (call tracking, Practo plans, shoot costs) before committing. Health ads must follow Google and Meta healthcare ad policies: no guaranteed results, before/after only with consent.</p>
      </Section>
    </Page>
  );
}
