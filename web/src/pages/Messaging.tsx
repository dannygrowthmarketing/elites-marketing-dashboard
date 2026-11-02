import { useMemo } from "react";
import { DataTable, ErrorBox, Kpi, KpiRow, Loading, Page, Section, Tag, TrendChart } from "../components/ui";
import { useFilters, useTable } from "../state";
import { fmt, ratio } from "../lib/metrics";
import { shortPath } from "../lib/insights";
import { channelOfGa4, withRates } from "../lib/funnel";
import { C, StatusTag } from "./Overview";
import { FunnelDiagram } from "./funnelData";
import PatientLists from "./PatientLists";

const WA_EVENTS = ["whatsapp_click", "joinchat"];

export default function Messaging() {
  const f = useFilters();
  const range = [f.range.start, f.range.end];
  const integ = useTable<any>("integrations", (q) => q.select("source,status,last_success_at,last_error,external_id").in("source", ["mailchimp", "whatsapp"]));
  const waEv = useTable<any>("ga4_daily_events", (q) => q.select("date,event_name,channel_group,source,campaign,page_path,event_count")
    .in("event_name", WA_EVENTS).gte("date", f.range.start).lte("date", f.range.end).limit(10000), range);
  const emailTraffic = useTable<any>("ga4_daily_traffic", (q) => q.select("date,source,medium,campaign,sessions,engaged_sessions,key_events")
    .or("channel_group.ilike.%email%,medium.ilike.%email%,source.ilike.%mailchimp%").gte("date", f.range.start).lte("date", f.range.end).limit(10000), range);
  const camps = useTable<any>("email_campaigns", (q) => q.select("*").gte("send_time", f.range.start + "T00:00:00+05:30").lte("send_time", f.range.end + "T23:59:59+05:30").order("send_time", { ascending: false }).limit(500), range);
  const audiences = useTable<any>("email_audiences", (q) => q.select("*").order("member_count", { ascending: false }));
  const wa = useTable<any>("whatsapp_daily", (q) => q.select("*").gte("date", f.range.start).lte("date", f.range.end).order("date").limit(2000), range);
  const waTpl = useTable<any>("whatsapp_template_daily", (q) => q.select("*").gte("date", f.range.start).lte("date", f.range.end).limit(10000), range);

  const st = (s: string) => integ.data?.find((i) => i.source === s);
  const mc = st("mailchimp"), wap = st("whatsapp");
  const notSetUp = [camps.error, wa.error].find((e) => e && /email_campaigns|whatsapp_daily|does not exist|schema cache/i.test(e));

  // Website → WhatsApp (GA4)
  const waTaps = (waEv.data ?? []).reduce((a, r) => a + +r.event_count, 0);
  const waByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of waEv.data ?? []) m.set(r.date, (m.get(r.date) ?? 0) + +r.event_count);
    return [...m.entries()].map(([date, taps]) => ({ date, taps })).sort((a, b) => a.date.localeCompare(b.date));
  }, [waEv.data]);
  const waByPage = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of waEv.data ?? []) {
      const k = `${r.page_path}|${channelOfGa4(r.channel_group, r.source, r.campaign)}`;
      const a = m.get(k) ?? { page: r.page_path, channel: channelOfGa4(r.channel_group, r.source, r.campaign), taps: 0 };
      a.taps += +r.event_count; m.set(k, a);
    }
    return [...m.values()];
  }, [waEv.data]);

  // Email traffic (GA4)
  const em = emailTraffic.data ?? [];
  const emSessions = em.reduce((a, r) => a + r.sessions, 0), emEngaged = em.reduce((a, r) => a + r.engaged_sessions, 0);
  const emByCampaign = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of em) { const k = `${r.source}|${r.campaign}`; const a = m.get(k) ?? { source: r.source, campaign: r.campaign, sessions: 0, engaged: 0 }; a.sessions += r.sessions; a.engaged += r.engaged_sessions; m.set(k, a); }
    return [...m.values()];
  }, [emailTraffic.data]);

  // Mailchimp
  const cs = camps.data ?? [];
  const sent = cs.reduce((a, c) => a + c.emails_sent, 0), uClicks = cs.reduce((a, c) => a + c.unique_clicks, 0), uOpens = cs.reduce((a, c) => a + c.unique_opens, 0);
  const unsubs = cs.reduce((a, c) => a + c.unsubscribed, 0);
  const members = (audiences.data ?? []).reduce((a, l) => a + (l.member_count ?? 0), 0);

  // WhatsApp Business
  const wsent = (wa.data ?? []).reduce((a, r) => a + r.sent, 0), wdel = (wa.data ?? []).reduce((a, r) => a + r.delivered, 0);
  const tpl = waTpl.data ?? [];
  const tSent = tpl.reduce((a, r) => a + r.sent, 0), tDel = tpl.reduce((a, r) => a + r.delivered, 0), tRead = tpl.reduce((a, r) => a + r.read, 0), tClk = tpl.reduce((a, r) => a + r.clicked, 0);
  const tplRows = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of tpl) { const a = m.get(r.template_id) ?? { name: r.template_name ?? r.template_id, category: r.category, sent: 0, delivered: 0, read: 0, clicked: 0 }; a.sent += r.sent; a.delivered += r.delivered; a.read += r.read; a.clicked += r.clicked; m.set(r.template_id, a); }
    return [...m.values()];
  }, [waTpl.data]);

  return (
    <Page eyebrow="Channels" title="Email & WhatsApp"
      intro="Patient lists for recalls, email campaigns (Mailchimp), WhatsApp Business campaigns, and how each brings people back to the clinic. What's already tracked on the website shows now; campaign numbers appear once each account is connected.">
      {notSetUp && <ErrorBox msg="Email & WhatsApp tables aren't set up yet — run the 24 Oct SQL file in Supabase." />}

      <PatientLists n="01" />

      <Section n="02" title="Website → WhatsApp" note="Taps on the site's WhatsApp button and chat widget (GA4). These are people starting a chat — the most common way patients reach out.">
        {waEv.loading ? <Loading /> : (
          <>
            <KpiRow>
              <Kpi logo="whatsapp" big label="WhatsApp taps from the website" value={waTaps} />
              <Kpi label="Pages it happens on" value={new Set(waByPage.map((r) => r.page)).size} />
            </KpiRow>
            {waTaps > 0 && <TrendChart rows={waByDay} height={180} series={[{ key: "taps", label: "WhatsApp taps", color: C.teal, kind: "bar" }]} />}
            <DataTable rows={waByPage} csvName="whatsapp-taps-by-page" initialSort={{ key: "taps", dir: -1 }} empty="No WhatsApp taps recorded in this period." cols={[
              { key: "page", label: "Page", render: (r: any) => shortPath(r.page) }, { key: "channel", label: "Visitor came from" },
              { key: "taps", label: "Taps", align: "right", format: "int" },
            ]} />
            <p className="small muted">What happens inside the chat isn't visible to the website. Log WhatsApp enquiries in Leads & CRM (type: WhatsApp) so they count as leads.</p>
          </>
        )}
      </Section>

      <Section n="03" title="Email campaigns — Mailchimp" right={mc && <StatusTag s={mc.status} />}>
        {mc?.status !== "connected" ? (
          <SetupCard title="Mailchimp isn't connected" steps={[
            "If the clinic already uses Mailchimp: in Mailchimp, open profile icon → Profile → Extras → API keys → Create A Key.",
            "Paste the key on the Integrations page (Mailchimp card). Campaigns from the last 18 months import the same day.",
            "If they don't use Mailchimp yet: it has a free plan for small lists — the clinic would create the account (I can't sign up on their behalf).",
            "Add utm_source=mailchimp&utm_medium=email to links in emails so visits and bookings are credited to email.",
          ]} />
        ) : camps.loading ? <Loading /> : (
          <>
            <KpiRow>
              <Kpi label="Campaigns sent" value={cs.length} />
              <Kpi logo="mailchimp" label="Emails delivered" value={sent} />
              <Kpi logo="mailchimp" label="Click rate" value={ratio(uClicks, sent)} format="pct" sub="unique clickers ÷ emails sent" />
              <Kpi label="Open rate" value={ratio(uOpens, sent)} format="pct" sub="inflated by Apple Mail privacy" />
              <Kpi label="Unsubscribes" value={unsubs} invert />
              <Kpi label="Audience size" value={members} sub={`${audiences.data?.length ?? 0} audience${audiences.data?.length === 1 ? "" : "s"}`} />
            </KpiRow>
            <DataTable rows={cs} csvName="email-campaigns" empty="No campaigns sent in this period." cols={[
              { key: "send_time", label: "Sent", render: (r: any) => r.send_time ? new Date(r.send_time).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—" },
              { key: "title", label: "Campaign", render: (r: any) => <>{r.title}<div className="small muted">{r.subject}</div></>, value: (r: any) => r.title },
              { key: "emails_sent", label: "Sent", align: "right", format: "int" },
              { key: "cr", label: "Click rate", align: "right", format: "pct", value: (r: any) => ratio(r.unique_clicks, r.emails_sent) },
              { key: "or", label: "Open rate", align: "right", format: "pct", value: (r: any) => ratio(r.unique_opens, r.emails_sent) },
              { key: "unsubscribed", label: "Unsubs", align: "right", format: "int" },
              { key: "bounces", label: "Bounces", align: "right", format: "int", value: (r: any) => r.hard_bounces + r.soft_bounces },
            ]} />
          </>
        )}
        <h3 className="sub">Visits from email (GA4)</h3>
        {emailTraffic.loading ? <Loading /> : (
          <>
            <KpiRow>
              <Kpi logo="mailchimp" label="Visits from email" value={emSessions} />
              <Kpi logo="ga4" label="Engaged" value={ratio(emEngaged, emSessions)} format="pct" />
            </KpiRow>
            <DataTable rows={emByCampaign} empty="No visits tagged as email in this period. Add utm_medium=email to email links." cols={[
              { key: "source", label: "Source" }, { key: "campaign", label: "Campaign" },
              { key: "sessions", label: "Visits", align: "right", format: "int" }, { key: "engaged", label: "Engaged", align: "right", format: "int" },
            ]} />
          </>
        )}
      </Section>

      <Section n="04" title="WhatsApp Business campaigns" right={wap && <StatusTag s={wap.status} />}
        note="Broadcasts and template messages sent from the clinic's WhatsApp Business number.">
        {wap?.status !== "connected" ? (
          <SetupCard title="WhatsApp Business isn't connected" steps={[
            "Find out which number the clinic sends campaigns from, and how: the WhatsApp Business app, or a provider such as AiSensy, Interakt, WATI or DoubleTick.",
            "Campaign numbers need the WhatsApp Business Platform (Cloud API). The ordinary WhatsApp Business app has no data connection. In India a number can now run on both the app and the API (“coexistence”), so the team can keep using the app.",
            "In Meta Business Settings → WhatsApp accounts: copy the WhatsApp Business Account ID. Under System users, create a token with whatsapp_business_management.",
            "Paste both on the Integrations page (WhatsApp card). A year of daily sent/delivered figures imports, plus read and clicked per template when template analytics is switched on.",
            "Meta charges per template message sent; there's no charge for connecting the data.",
          ]} />
        ) : wa.loading ? <Loading /> : (
          <>
            <KpiRow>
              <Kpi big label="Messages sent" value={wsent} />
              <Kpi label="Delivered" value={ratio(wdel, wsent)} format="pct" sub={`${fmt.int(wdel)} messages`} />
              <Kpi label="Template messages read" value={ratio(tRead, tDel)} format="pct" sub={tDel ? `${fmt.int(tRead)} of ${fmt.int(tDel)}` : "template analytics off"} />
              <Kpi label="Button / link clicks" value={tClk || null} />
            </KpiRow>
            {tSent > 0 && <FunnelDiagram stages={withRates([
              { key: "s", label: "Sent", value: tSent, source: "WhatsApp template analytics" },
              { key: "d", label: "Delivered", value: tDel, source: "WhatsApp template analytics" },
              { key: "r", label: "Read", value: tRead, source: "WhatsApp template analytics" },
              { key: "c", label: "Clicked", value: tClk, source: "WhatsApp template analytics" },
            ])} />}
            <TrendChart rows={wa.data} height={200} series={[{ key: "sent", label: "Sent", color: C.slate, kind: "area" }, { key: "delivered", label: "Delivered", color: C.teal }]} />
            <DataTable rows={tplRows} csvName="whatsapp-templates" initialSort={{ key: "sent", dir: -1 }} empty="No template data. Switch on template analytics in WhatsApp Manager to see read and click rates." cols={[
              { key: "name", label: "Template" }, { key: "category", label: "Type", render: (r: any) => <Tag>{(r.category ?? "—").toLowerCase()}</Tag> },
              { key: "sent", label: "Sent", align: "right", format: "int" },
              { key: "rr", label: "Read", align: "right", format: "pct", value: (r: any) => ratio(r.read, r.delivered) },
              { key: "clicked", label: "Clicks", align: "right", format: "int" },
            ]} />
          </>
        )}
      </Section>
    </Page>
  );
}

function SetupCard({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="card setup">
      <strong>{title}</strong>
      <ol>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      <a className="btn ghost" href="#/integrations">Go to Integrations →</a>
    </div>
  );
}
