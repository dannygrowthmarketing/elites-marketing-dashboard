import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DataTable, Drawer, ErrorBox, Kpi, KpiRow, Loading, Page, Section, Tag, TrendChart } from "../components/ui";
import { useFilters, useTable } from "../state";
import { ACTION_EVENTS, CHANNELS, EVENT_LABEL, biggestLeak, channelOfGa4, channelOfLead, type Channel, type Stage } from "../lib/funnel";
import { fmt, pctChange, ratio } from "../lib/metrics";
import { shortPath } from "../lib/insights";
import { C, totals } from "./Overview";
import { FunnelDiagram, buildStages, byChannel, useFunnelData, type FunnelData } from "./funnelData";

export default function FunnelAnalytics() {
  const f = useFilters();
  const d = useFunnelData();
  const [channel, setChannel] = useState<Channel | "all">("all");
  const [stage, setStage] = useState<Stage | null>(null);
  const [camp, setCamp] = useState<any | null>(null);
  const [page, setPage] = useState<string | null>(null);

  const stages = useMemo(() => (d.loading ? null : buildStages(d, channel)), [d.loading, d.cur.data, d.acq.data, d.ev.data, d.leads.data, d.appts.data, d.revenue.data, channel]);
  const prevStages = useMemo(() => (d.hasPrev && d.prev.data && d.acqPrev.data && d.evPrev.data ? buildStages(d, channel, "prev") : null), [d.prev.data, d.acqPrev.data, d.evPrev.data, channel, d.hasPrev]);
  const leak = stages ? biggestLeak(stages.filter((s) => !["seen"].includes(s.key))) : null;
  const t = totals(d.cur.data), p = d.hasPrev ? totals(d.prev.data) : null;
  const ch = useMemo(() => byChannel(d.acq.data, d.ev.data), [d.acq.data, d.ev.data]);
  const chPrev = useMemo(() => (d.hasPrev ? byChannel(d.acqPrev.data, d.evPrev.data) : null), [d.acqPrev.data, d.evPrev.data, d.hasPrev]);
  const val = (k: string, s = stages) => s?.find((x) => x.key === k)?.value ?? null;
  const paidSpend = channel === "all" || channel === "Paid search" ? t.ads_cost : null;
  const paidActions = ch["Paid search"].actions, paidBookings = ch["Paid search"].bookings;

  const chRows = CHANNELS.map((c) => ({ channel: c, ...ch[c], prevSessions: chPrev?.[c].sessions ?? null,
    spend: c === "Paid search" ? t.ads_cost : null })).filter((r) => r.sessions > 0 || r.actions > 0);

  const daily = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of d.cur.data ?? []) m.set(r.date, { date: r.date, sessions: r.ga4_sessions == null ? null : +r.ga4_sessions, actions: 0, bookings: 0 });
    for (const e of d.ev.data ?? []) {
      if (channel !== "all" && channelOfGa4(e.channel_group, e.source, e.campaign) !== channel) continue;
      const row = m.get(e.date); if (!row) continue;
      if (ACTION_EVENTS.includes(e.event_name)) row.actions += +e.event_count; else row.bookings += +e.event_count;
    }
    return [...m.values()];
  }, [d.cur.data, d.ev.data, channel]);

  const pages = useMemo(() => {
    const m = new Map<string, any>();
    for (const l of d.landing.data ?? []) m.set(l.landing_page, { page: l.landing_page, sessions: +l.sessions, engaged: +l.engaged_sessions, actions: 0, bookings: 0 });
    for (const e of d.ev.data ?? []) {
      if (channel !== "all" && channelOfGa4(e.channel_group, e.source, e.campaign) !== channel) continue;
      const row = m.get(e.page_path) ?? { page: e.page_path, sessions: 0, engaged: 0, actions: 0, bookings: 0 };
      if (ACTION_EVENTS.includes(e.event_name)) row.actions += +e.event_count; else row.bookings += +e.event_count;
      m.set(e.page_path, row);
    }
    return [...m.values()].filter((r) => r.sessions > 0 || r.actions > 0);
  }, [d.landing.data, d.ev.data, channel]);

  const leadsRows = (d.leads.data ?? []).map((l) => ({ ...l, channel: channelOfLead(l.first_source, l.first_medium, l.inquiry_type) }))
    .filter((l) => channel === "all" || l.channel === channel);

  return (
    <Page eyebrow="Analysis" title="Funnel analytics"
      intro="From being seen on Google to a paid visit — every step, where people drop off, and what each channel delivers. Each step names the system it comes from; steps from different systems are compared, never added together.">
      {d.error && <ErrorBox msg={d.error} />}

      <Section n="01" title="The full funnel" right={
        <div className="seg">
          <button className={channel === "all" ? "on" : ""} onClick={() => setChannel("all")}>All channels</button>
          {CHANNELS.map((c) => <button key={c} className={channel === c ? "on" : ""} onClick={() => setChannel(c)}>{c}</button>)}
        </div>}
        note={`Click a step to see what's behind it. ${f.label}${f.prevLabel ? ` vs ${f.prevLabel}` : ""}.`}>
        {!stages ? <Loading h={420} /> : (
          <>
            <KpiRow>
              <Kpi logo="ga4" big label="Website visits" value={val("visited")} prev={prevStages ? val("visited", prevStages) : undefined} defKey="ga4_sessions" />
              <Kpi logo="crm" label="Lead actions" value={val("action")} prev={prevStages ? val("action", prevStages) : undefined} />
              <Kpi label="Online bookings" value={val("booked_online")} prev={prevStages ? val("booked_online", prevStages) : undefined} />
              <Kpi label="Visit → action" value={ratio(val("action"), val("visited"))} prev={prevStages ? ratio(val("action", prevStages), val("visited", prevStages)) : undefined} format="pct" />
              {paidSpend != null && <Kpi logo="google_ads" label="Ad cost per lead action" value={ratio(paidSpend, paidActions)} prev={p && chPrev ? ratio(p.ads_cost, chPrev["Paid search"].actions) : undefined} format="inr" invert />}
              {paidSpend != null && <Kpi label="Ad cost per online booking" value={ratio(paidSpend, paidBookings)} prev={p && chPrev ? ratio(p.ads_cost, chPrev["Paid search"].bookings) : undefined} format="inr" invert />}
            </KpiRow>
            {prevStages && (val("action") ?? 0) > 20 && (val("action", prevStages) ?? 0) < (val("action") ?? 0) * 0.2 && (
              <p className="warnline">Lead-action tracking was switched on during the previous period, so its changes are mostly tracking starting, not real growth. Compare like-for-like once both periods are fully tracked.</p>
            )}
            <div className="funnel-grid">
              <FunnelDiagram stages={stages} prev={prevStages} onPick={setStage} selected={stage?.key} />
              <aside className="funnel-side">
                {leak && (
                  <div className="card leak">
                    <div className="eyebrow-s">Biggest drop-off</div>
                    <div className="big-num">{fmt.pct(1 - leak.rate, 0)}</div>
                    <p>lost between <strong>{leak.from.label.toLowerCase()}</strong> and <strong>{leak.to.label.toLowerCase()}</strong>.</p>
                    <p className="small muted">{leakAdvice(leak.to.key)}</p>
                  </div>
                )}
                {stages.some((s) => s.key === "lead" && s.value === 0) && val("booked_online") ? (
                  <div className="card"><strong>Bookings aren't reaching the CRM</strong>
                    <p className="small muted">{fmt.int(val("booked_online"))} online bookings were confirmed on the site, but the CRM has no matching leads for this period, so the steps after it can't be measured yet. Check the booking relay, and add phone and walk-in enquiries in Leads & CRM.</p></div>
                ) : null}
                <div className="small muted">Grey steps are not measured yet for this channel or period — they're shown so the gaps are visible, not hidden.</div>
              </aside>
            </div>
          </>
        )}
      </Section>

      <Section n="02" title="Funnel by channel" note="Click a row to filter the whole page to that channel.">
        {d.loading ? <Loading /> : (
          <>
            <ChannelRates rows={chRows} />
            <DataTable rows={chRows} csvName="funnel-by-channel" onRow={(r: any) => setChannel(r.channel)} initialSort={{ key: "sessions", dir: -1 }} cols={[
              { key: "channel", label: "Channel" },
              { key: "sessions", label: "Visits", align: "right", format: "int" },
              { key: "chg", label: "Visits Δ", align: "right", render: (r: any) => r.prevSessions == null ? "—" : <Delta v={pctChange(r.sessions, r.prevSessions)} />, value: (r: any) => pctChange(r.sessions, r.prevSessions) },
              { key: "er", label: "Engaged", align: "right", format: "pct", value: (r: any) => ratio(r.engaged, r.sessions) },
              { key: "actions", label: "Lead actions", align: "right", format: "int" },
              { key: "ar", label: "Action rate", align: "right", format: "pct", value: (r: any) => ratio(r.actions, r.sessions) },
              { key: "bookings", label: "Online bookings", align: "right", format: "int" },
              { key: "spend", label: "Spend", align: "right", format: "inr" },
              { key: "cpa", label: "Cost / action", align: "right", format: "inr", value: (r: any) => (r.spend == null ? null : ratio(r.spend, r.actions)) },
            ]} />
          </>
        )}
      </Section>

      <Section n="03" title="Trend" note="Daily or weekly, following the chart-grain setting. Actions and bookings follow the channel filter.">
        <TrendChart rows={d.cur.data ? daily : null} series={[
          { key: "sessions", label: channel === "all" ? "Visits (all)" : "Visits (all channels)", color: C.slate, kind: "area" },
          { key: "actions", label: "Lead actions", color: C.navy },
          { key: "bookings", label: "Online bookings", color: C.gold, kind: "bar", axis: "right" },
        ]} />
      </Section>

      {(channel === "all" || channel === "Paid search") && (
        <Section n="04" title="Paid search campaigns" note="Google Ads numbers for the period. Click a campaign for its daily trend.">
          <DataTable rows={d.camps.data?.map((c) => ({ ...c, impressions: +c.impressions, clicks: +c.clicks, cost: +c.cost, conversions: +c.conversions })) ?? null}
            csvName="funnel-campaigns" onRow={setCamp} empty="No Google Ads activity in this period." cols={[
            { key: "campaign_name", label: "Campaign" },
            { key: "campaign_status", label: "Status", render: (r: any) => <Tag tone={r.campaign_status === "ENABLED" ? "good" : "neutral"}>{(r.campaign_status ?? "").toLowerCase()}</Tag> },
            { key: "impressions", label: "Impressions", align: "right", format: "int" },
            { key: "clicks", label: "Clicks", align: "right", format: "int" },
            { key: "ctr", label: "CTR", align: "right", format: "pct", value: (r: any) => ratio(r.clicks, r.impressions) },
            { key: "cost", label: "Spend", align: "right", format: "inr" },
            { key: "cpc", label: "CPC", align: "right", format: "inr", value: (r: any) => ratio(r.cost, r.clicks) },
            { key: "conversions", label: "Ads conversions", align: "right", format: "dec" },
          ]} />
        </Section>
      )}

      <Section n={channel === "all" || channel === "Paid search" ? "05" : "04"} title="Landing pages" note="Where visits land and which pages produce lead actions. Click a page for the breakdown.">
        <DataTable rows={d.landing.data ? pages : null} csvName="funnel-landing-pages" onRow={(r: any) => setPage(r.page)} initialSort={{ key: "actions", dir: -1 }} cols={[
          { key: "page", label: "Page", render: (r: any) => shortPath(r.page), value: (r: any) => r.page },
          { key: "sessions", label: "Visits", align: "right", format: "int" },
          { key: "er", label: "Engaged", align: "right", format: "pct", value: (r: any) => ratio(r.engaged, r.sessions) },
          { key: "actions", label: "Lead actions", align: "right", format: "int" },
          { key: "ar", label: "Action rate", align: "right", format: "pct", value: (r: any) => ratio(r.actions, r.sessions) },
          { key: "bookings", label: "Online bookings", align: "right", format: "int" },
        ]} />
      </Section>

      <Section n={channel === "all" || channel === "Paid search" ? "06" : "05"} title="Leads in this period" note="CRM leads by first marketing touch. Click to open the lead.">
        <DataTable rows={d.leads.data ? leadsRows : null} csvName="funnel-leads" onRow={(r: any) => { location.hash = `#/crm?lead=${r.id}`; }}
          empty="No CRM leads in this period. Website enquiries arrive automatically; add calls, WhatsApp and walk-ins in Leads & CRM." cols={[
          { key: "first_inquiry_at", label: "When", render: (r: any) => new Date(r.first_inquiry_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) },
          { key: "name", label: "Name", render: (r: any) => r.name || <span className="muted">—</span> },
          { key: "channel", label: "Channel" }, { key: "inquiry_type", label: "Type" },
          { key: "requested_service", label: "Service" }, { key: "status", label: "Status" },
        ]} />
      </Section>

      <Drawer open={!!stage} onClose={() => setStage(null)} title={stage?.label ?? ""}>
        {stage && <StageDrill s={stage} d={d} channel={channel} pages={pages} onCamp={setCamp} />}
      </Drawer>
      <Drawer open={!!camp} onClose={() => setCamp(null)} title={camp?.campaign_name ?? ""}>
        {camp && <CampaignDrill c={camp} />}
      </Drawer>
      <Drawer open={!!page} onClose={() => setPage(null)} title={page ? shortPath(page) : ""}>
        {page && <PageDrill page={page} ev={d.ev.data ?? []} channel={channel} />}
      </Drawer>
    </Page>
  );
}

function leakAdvice(key: string) {
  return ({
    clicked: "Most people who see the clinic on Google don't click. Ad copy, titles and the Business Profile photo/rating are the levers.",
    visited: "Clicks aren't becoming site visits — slow pages or tracking gaps. Check page speed on mobile.",
    engaged: "Visitors leave quickly. The first screen on mobile needs the phone number, rating and a clear Book button.",
    action: "Engaged visitors aren't tapping call, WhatsApp or book. Make those buttons sticky and visible on every page.",
    booked_online: "Lots of taps, few confirmed online bookings — most people prefer to call. Make sure calls are answered and logged in the CRM.",
    lead: "Bookings happen on the site but don't reach the CRM. Check the booking relay and log phone enquiries.",
    appt: "Leads aren't converting to appointments — follow-up speed is usually the cause.",
    done: "Booked patients aren't turning up. Reminder calls or WhatsApp the day before help.",
    paid: "Completed visits without a payment record — enter revenue so return on spend can be measured.",
  } as Record<string, string>)[key] ?? "";
}

const Delta = ({ v }: { v: number | null }) => v == null ? <>—</> : <span className={`delta ${v >= 0 ? "up" : "down"}`}>{fmt.delta(v)}</span>;

function ChannelRates({ rows }: { rows: any[] }) {
  const data = rows.map((r) => ({ name: r.channel, rate: r.sessions ? (r.actions / r.sessions) * 100 : 0, actions: r.actions, sessions: r.sessions }));
  if (!data.length) return <div className="empty">No visits in this period.</div>;
  return (
    <div className="chart" style={{ height: Math.max(160, data.length * 38) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--rule)" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={130} interval={0} tick={{ fontSize: 12, fill: "var(--ink)" }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "var(--paper)", border: "1px solid var(--rule)", borderRadius: 6, fontSize: 12 }}
            formatter={(v: any, _n: any, p: any) => [`${Number(v).toFixed(1)}% · ${fmt.int(p.payload.actions)} actions from ${fmt.int(p.payload.sessions)} visits`, "Visit → action"]} />
          <Bar dataKey="rate" fill={C.navy} radius={[0, 3, 3, 0]} maxBarSize={22} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <div className="legend"><span><i style={{ background: C.navy }} />Share of visits that took a lead action</span></div>
    </div>
  );
}

function StageDrill({ s, d, channel, pages, onCamp }: { s: Stage; d: FunnelData; channel: Channel | "all"; pages: any[]; onCamp: (c: any) => void }) {
  const evRows = (d.ev.data ?? []).filter((e) => channel === "all" || channelOfGa4(e.channel_group, e.source, e.campaign) === channel);
  const byEvent = (names: string[]) => {
    const m = new Map<string, number>();
    for (const e of evRows) if (names.includes(e.event_name)) m.set(e.event_name, (m.get(e.event_name) ?? 0) + +e.event_count);
    return [...m.entries()].map(([k, n]) => ({ event: EVENT_LABEL[k] ?? k, n })).sort((a, b) => b.n - a.n);
  };
  return (
    <div>
      <table className="kvtable"><tbody>
        <tr><th>Value</th><td>{s.value == null ? "Not measured yet" : fmt.int(s.value)}</td></tr>
        <tr><th>Step conversion</th><td>{s.rateFromPrev == null ? "—" : fmt.pct(s.rateFromPrev)}</td></tr>
        <tr><th>Source</th><td>{s.source}</td></tr>
        {s.note && <tr><th>Note</th><td>{s.note}</td></tr>}
      </tbody></table>
      {(s.key === "seen" || s.key === "clicked") && (
        <>
          <h3 className="sub">Google Ads campaigns</h3>
          <DataTable rows={d.camps.data?.map((c) => ({ ...c, impressions: +c.impressions, clicks: +c.clicks, cost: +c.cost })) ?? null} onRow={onCamp} limit={10} cols={[
            { key: "campaign_name", label: "Campaign" }, { key: "impressions", label: "Impr.", align: "right", format: "int" },
            { key: "clicks", label: "Clicks", align: "right", format: "int" }, { key: "cost", label: "Spend", align: "right", format: "inr" },
          ]} />
          <p className="small muted">Organic search detail is on the <a href="#/seo">SEO page</a>; Business Profile on <a href="#/gbp">Business Profile</a>.</p>
        </>
      )}
      {(s.key === "visited" || s.key === "engaged") && (
        <>
          <h3 className="sub">Top landing pages</h3>
          <DataTable rows={[...pages].sort((a, b) => b.sessions - a.sessions)} limit={10} cols={[
            { key: "page", label: "Page", render: (r: any) => shortPath(r.page) }, { key: "sessions", label: "Visits", align: "right", format: "int" },
            { key: "er", label: "Engaged", align: "right", format: "pct", value: (r: any) => ratio(r.engaged, r.sessions) },
          ]} />
        </>
      )}
      {(s.key === "action" || s.key === "booked_online") && (
        <>
          <h3 className="sub">By type</h3>
          <DataTable rows={byEvent(s.key === "action" ? ACTION_EVENTS : ["appointment_confirmed", "video_consult_form_submit"])} cols={[
            { key: "event", label: "Action" }, { key: "n", label: "Count", align: "right", format: "int" }]} />
          <h3 className="sub">By page</h3>
          <DataTable rows={[...pages].sort((a, b) => (s.key === "action" ? b.actions - a.actions : b.bookings - a.bookings)).filter((r) => (s.key === "action" ? r.actions : r.bookings) > 0)} limit={10} cols={[
            { key: "page", label: "Page", render: (r: any) => shortPath(r.page) },
            { key: s.key === "action" ? "actions" : "bookings", label: "Count", align: "right", format: "int" }]} />
        </>
      )}
      {["lead", "appt", "done"].includes(s.key) && <p>See the full list in <a href="#/crm">Leads & CRM</a>.</p>}
      {s.key === "paid" && <p>Payments and return on spend are on the <a href="#/revenue">Revenue page</a>.</p>}
    </div>
  );
}

function CampaignDrill({ c }: { c: any }) {
  const f = useFilters();
  const rows = useTable<any>("ads_daily_campaign", (q) => q.select("date,impressions,clicks,cost_micros,conversions").eq("campaign_id", c.campaign_id).eq("device", "ALL")
    .gte("date", f.range.start).lte("date", f.range.end).order("date"), [c.campaign_id, f.range.start, f.range.end]);
  const data = (rows.data ?? []).map((r) => ({ date: r.date, clicks: r.clicks, cost: r.cost_micros / 1e6, impressions: r.impressions }));
  const last = data.filter((r) => r.impressions > 0).at(-1)?.date;
  return (
    <div>
      <KpiRow>
        <Kpi label="Spend" value={+c.cost} format="inr" /><Kpi label="Clicks" value={+c.clicks} />
        <Kpi logo="google_ads" label="CPC" value={ratio(+c.cost, +c.clicks)} format="inr" /><Kpi label="CTR" value={ratio(+c.clicks, +c.impressions)} format="pct" />
      </KpiRow>
      {rows.error ? <ErrorBox msg={rows.error} /> : <TrendChart rows={rows.data ? data : null} height={220} series={[
        { key: "clicks", label: "Clicks", color: C.navy }, { key: "cost", label: "Spend (₹)", color: C.gold, axis: "right", format: "inr" }]} />}
      <p className="small muted">Last day with impressions: {last ?? "none in this period"}. Creatives for this campaign are in the <a href="#/paid?tab=ads">Ad Library</a>.</p>
    </div>
  );
}

function PageDrill({ page, ev, channel }: { page: string; ev: any[]; channel: Channel | "all" }) {
  const rows = ev.filter((e) => e.page_path === page && (channel === "all" || channelOfGa4(e.channel_group, e.source, e.campaign) === channel));
  const m = new Map<string, any>();
  for (const e of rows) { const k = `${e.event_name}|${channelOfGa4(e.channel_group, e.source, e.campaign)}`; const a = m.get(k) ?? { event: EVENT_LABEL[e.event_name] ?? e.event_name, channel: channelOfGa4(e.channel_group, e.source, e.campaign), n: 0 }; a.n += +e.event_count; m.set(k, a); }
  return (
    <div>
      <p className="small muted"><a href={`https://elitesdental.com${page.startsWith("/") ? page : "/" + page}`} target="_blank" rel="noreferrer">Open the page ↗</a></p>
      <DataTable rows={[...m.values()].sort((a, b) => b.n - a.n)} empty="No lead actions recorded on this page in the period." cols={[
        { key: "event", label: "Action" }, { key: "channel", label: "Channel" }, { key: "n", label: "Count", align: "right", format: "int" }]} />
    </div>
  );
}
