import { useMemo, useState } from "react";
import { DataTable, DeltaCell, Drawer, Kpi, KpiRow, Page, Pending, Section, TrendChart, useRangeArgs } from "../components/ui";
import { useFilters, useRpc, useTable } from "../state";
import { convRate, fmt, pctChange, ratio, sum } from "../lib/metrics";
import { shortPath } from "../lib/insights";
import { C, totals, useSeries } from "./Overview";

const EVENT_LABEL: Record<string, string> = {
  appointment_confirmed: "Booking confirmed (Click4Appointment)",
  book_appointment_click: "Book button click",
  phone_call_click: "Phone tap",
  whatsapp_click: "WhatsApp tap",
  joinchat: "WhatsApp widget",
  directions_click: "Directions tap",
  email_click: "Email click",
  video_consult_request: "Video consult requested",
  video_consult_form_submit: "Video consult form sent",
  psych_block_click: "Proof/CTA block click",
  form_start: "Form started",
  form_submit: "Form submitted",
  generate_lead: "Lead (generate_lead)",
};

export default function Website() {
  const f = useFilters();
  const { range, cmp } = useRangeArgs();
  const { cur, prev } = useSeries();
  const acq = useRpc<any[]>("rpc_ga4_acquisition", range);
  const dev = useRpc<any[]>("rpc_ga4_devices", range);
  const landing = useRpc<any[]>("rpc_ga4_landing", cmp);
  const events = useRpc<any[]>("rpc_ga4_events", range);
  const integ = useTable<any>("integrations", (q) => q.select("status").eq("source", "ga4"));
  const [channel, setChannel] = useState<string>("all");
  const [drill, setDrill] = useState<string | null>(null);
  const t = totals(cur.data), p = f.prev ? totals(prev.data) : null;

  const acqRows = (acq.data ?? []).map((r) => ({ ...r, sessions: +r.sessions, engaged_sessions: +r.engaged_sessions, users: +r.users, key_events: +r.key_events }));
  const channels = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of acqRows) {
      const a = m.get(r.channel_group) ?? { channel: r.channel_group, sessions: 0, engaged: 0, users: 0, key_events: 0 };
      a.sessions += r.sessions; a.engaged += r.engaged_sessions; a.users += r.users; a.key_events += r.key_events; m.set(r.channel_group, a);
    }
    return [...m.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acq.data]);
  const evRows = (events.data ?? []).map((r) => ({ ...r, event_count: +r.event_count }));
  const evFiltered = channel === "all" ? evRows : evRows.filter((r) => r.channel_group === channel);
  const evTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of evFiltered) m.set(r.event_name, (m.get(r.event_name) ?? 0) + r.event_count);
    return [...m.entries()].map(([event_name, count]) => ({ event_name, label: EVENT_LABEL[event_name] ?? event_name, count }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.data, channel]);
  const bookings = evRows.filter((r) => r.event_name === "appointment_confirmed").reduce((s, r) => s + r.event_count, 0);
  const evByLanding = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of evRows) if (["appointment_confirmed", "phone_call_click", "whatsapp_click", "video_consult_request"].includes(r.event_name)) m.set(r.page_path, (m.get(r.page_path) ?? 0) + r.event_count);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.data]);
  const keyEventsTotal = sum(acqRows, (r) => r.key_events);
  const none = t.ga4_sessions == null;

  return (
    <Page eyebrow="Website" title="Website analytics — GA4"
      intro="Property 548000513. Lead actions come from the site's own tracking snippets (phone, WhatsApp, directions, book clicks, confirmed bookings, video consult).">
      {none && integ.data?.[0]?.status !== "connected" && <Pending source="Google Analytics 4" />}
      <Section n="01" title="Traffic">
        <KpiRow>
          <Kpi label="Sessions" value={t.ga4_sessions} prev={p?.ga4_sessions} defKey="ga4_sessions" />
          <Kpi label="Engaged sessions" value={t.ga4_engaged} prev={p?.ga4_engaged} defKey="ga4_engaged" />
          <Kpi label="Engagement rate" value={ratio(t.ga4_engaged, t.ga4_sessions)} prev={p ? ratio(p.ga4_engaged, p.ga4_sessions) : undefined} format="pct" defKey="ga4_engagement_rate" />
          <Kpi label="Users (sum of daily)" value={t.ga4_users} prev={p?.ga4_users} defKey="ga4_users" />
          <Kpi label="Booking conversion rate" value={none ? null : convRate(bookings, t.ga4_sessions)} format="pct" defKey="website_conversion_rate" />
        </KpiRow>
        {keyEventsTotal === 0 && !none && <p className="warnline">No GA4 key events are marked in this property, so GA4's own conversion columns read 0. Lead actions below are counted from raw events instead.</p>}
        <TrendChart rows={cur.data} prevRows={f.prev ? prev.data : null} series={[
          { key: "ga4_sessions", label: "Sessions", color: C.navy, kind: "area" },
          { key: "ga4_engaged", label: "Engaged", color: C.teal },
        ]} />
      </Section>

      <Section n="02" title="Channels">
        <DataTable rows={acq.data ? channels : null} csvName="ga4-channels" onRow={(r) => setChannel(r.channel)} initialSort={{ key: "sessions", dir: -1 }} cols={[
          { key: "channel", label: "Channel" },
          { key: "sessions", label: "Sessions", align: "right", format: "int" },
          { key: "engaged", label: "Engaged", align: "right", format: "int" },
          { key: "rate", label: "Engagement", align: "right", format: "pct", value: (r) => ratio(r.engaged, r.sessions) },
          { key: "key_events", label: "Key events", align: "right", format: "dec" },
        ]} />
        <h3 className="sub">Source / medium / campaign</h3>
        <DataTable rows={acq.data ? acqRows : null} csvName="ga4-source-medium" cols={[
          { key: "source", label: "Source" }, { key: "medium", label: "Medium" }, { key: "campaign", label: "Campaign" },
          { key: "sessions", label: "Sessions", align: "right", format: "int" },
          { key: "engaged_sessions", label: "Engaged", align: "right", format: "int" },
          { key: "key_events", label: "Key events", align: "right", format: "dec" },
        ]} />
      </Section>

      <Section n="03" title="Lead actions on the site" right={
        <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Filter by channel">
          <option value="all">All channels</option>{channels.map((c) => <option key={c.channel}>{c.channel}</option>)}
        </select>}
        note="Taps and clicks are intent, not leads. A confirmed booking is the only event here that means an appointment exists.">
        <DataTable rows={events.data ? evTotals : null} csvName="ga4-lead-actions" initialSort={{ key: "count", dir: -1 }} cols={[
          { key: "label", label: "Action" }, { key: "event_name", label: "GA4 event" },
          { key: "count", label: "Count", align: "right", format: "int" },
        ]} />
      </Section>

      <Section n="04" title="Landing pages" note="Lead actions are matched by page path where the action happened.">
        <DataTable rows={landing.data?.map((r) => ({ ...r, sessions: +r.sessions, engaged_sessions: +r.engaged_sessions, prev_sessions: r.prev_sessions == null ? null : +r.prev_sessions, actions: evByLanding.get(r.landing_page) ?? 0 })) ?? null}
          csvName="ga4-landing-pages" onRow={(r) => setDrill(r.landing_page)} cols={[
          { key: "landing_page", label: "Landing page", render: (r) => shortPath(r.landing_page) },
          { key: "sessions", label: "Sessions", align: "right", format: "int" },
          { key: "rate", label: "Engagement", align: "right", format: "pct", value: (r) => ratio(r.engaged_sessions, r.sessions) },
          { key: "actions", label: "Lead actions", align: "right", format: "int" },
          { key: "cr", label: "Action rate", align: "right", format: "pct", value: (r) => ratio(r.actions, r.sessions) },
          ...(f.prev ? [{ key: "chg", label: "Sessions Δ", align: "right" as const, render: (r: any) => <DeltaCell cur={r.sessions} prev={r.prev_sessions} />, value: (r: any) => pctChange(r.sessions, r.prev_sessions) }] : []),
        ]} />
      </Section>

      <Section n="05" title="Devices">
        <DataTable rows={dev.data?.map((r) => ({ ...r, sessions: +r.sessions, engaged_sessions: +r.engaged_sessions })) ?? null} csvName="ga4-devices" cols={[
          { key: "device", label: "Device" },
          { key: "sessions", label: "Sessions", align: "right", format: "int" },
          { key: "share", label: "Share", align: "right", format: "pct", value: (r) => ratio(r.sessions, t.ga4_sessions) },
          { key: "rate", label: "Engagement", align: "right", format: "pct", value: (r) => ratio(r.engaged_sessions, r.sessions) },
        ]} />
      </Section>

      <Drawer open={!!drill} onClose={() => setDrill(null)} title={drill ? shortPath(drill) : ""}>
        {drill && <LandingDrill page={drill} />}
      </Drawer>
    </Page>
  );
}

function LandingDrill({ page }: { page: string }) {
  const f = useFilters();
  const rows = useTable<any>("ga4_daily_landing", (q) => q.select("date,channel_group,sessions,engaged_sessions").eq("landing_page", page).gte("date", f.range.start).lte("date", f.range.end).order("date"), [page, f.range.start, f.range.end]);
  const byDate = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of rows.data ?? []) { const a = m.get(r.date) ?? { date: r.date, sessions: 0 }; a.sessions += r.sessions; m.set(r.date, a); }
    return [...m.values()];
  }, [rows.data]);
  const byCh = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of rows.data ?? []) { const a = m.get(r.channel_group) ?? { channel: r.channel_group, sessions: 0, engaged: 0 }; a.sessions += r.sessions; a.engaged += r.engaged_sessions; m.set(r.channel_group, a); }
    return [...m.values()];
  }, [rows.data]);
  return (
    <>
      <TrendChart rows={rows.data ? byDate : null} height={200} series={[{ key: "sessions", label: "Sessions", color: C.navy, kind: "area" }]} />
      <DataTable rows={rows.data ? byCh : null} cols={[{ key: "channel", label: "Channel" }, { key: "sessions", label: "Sessions", align: "right", format: "int" }, { key: "engaged", label: "Engaged", align: "right", format: "int" }]} />
      <p className="muted small">{fmt.int(byDate.reduce((s, r) => s + r.sessions, 0))} sessions in {f.label.toLowerCase()}.</p>
    </>
  );
}
