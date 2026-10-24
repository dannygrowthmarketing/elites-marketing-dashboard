import { useMemo, useState } from "react";
import { DataTable, ErrorBox, Kpi, KpiRow, Loading, Pending, Section, TrendChart } from "../components/ui";
import { useFilters, useTable } from "../state";
import { daily, isTestUrl, overall, pagePath, segments, testVisits, type Snap } from "../lib/clarity";
import { fmt } from "../lib/metrics";
import { C } from "./Overview";

const CLARITY_URL = "https://clarity.microsoft.com/projects/view/z0lytv4wck/dashboard";
const day = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Visitor behaviour from Microsoft Clarity (daily snapshots). */
export default function ClaritySection({ n }: { n: string }) {
  const f = useFilters();
  const integ = useTable<any>("integrations", (q) => q.select("status,last_success_at").eq("source", "clarity"));
  const snaps = useTable<Snap>("clarity_snapshots",
    (q) => q.select("captured_on,metric,dimension,dimension_value,payload").gte("captured_on", f.range.start).lte("captured_on", f.range.end).limit(5000),
    [f.range.start, f.range.end]);
  const first = useTable<any>("clarity_snapshots", (q) => q.select("captured_on").order("captured_on").limit(1));
  const [showTests, setShowTests] = useState(false);

  const rows = snaps.data ?? [];
  const o = useMemo(() => overall(rows), [snaps.data]);
  const days = useMemo(() => daily(rows), [snaps.data]);
  const tests = useMemo(() => testVisits(rows), [snaps.data]);
  const pages = useMemo(() => segments(rows, "URL", (u) => (!showTests && isTestUrl(u) ? null : pagePath(u)))
    .filter((p) => p.sessions > 0), [snaps.data, showTests]);
  const devices = useMemo(() => segments(rows, "Device"), [snaps.data]);
  const channels = useMemo(() => segments(rows, "Channel"), [snaps.data]);
  const firstDay = first.data?.[0]?.captured_on as string | undefined;

  const head = (
    <Section n={n} title="Visitor behaviour — Microsoft Clarity"
      right={<a className="btn ghost" href={CLARITY_URL} target="_blank" rel="noreferrer">Open recordings in Clarity ↗</a>}
      note={<>One snapshot a day, covering the 24 hours before the 08:00 IST sync. {firstDay ? <>History starts {day(firstDay)}.</> : null} Clarity's API can't return older days, so this builds up from here.</>}>
      {body()}
    </Section>
  );
  return head;

  function body() {
    if (snaps.error) return <ErrorBox msg={snaps.error} />;
    if (snaps.loading) return <Loading />;
    if (!firstDay) return <Pending source="Microsoft Clarity">{integ.data?.[0]?.status === "connected" ? "Connected — the first daily snapshot lands at 08:00 IST." : undefined}</Pending>;
    if (!rows.length || !o) return <p className="muted">No Clarity snapshot in {f.label.toLowerCase()}. Snapshots exist from {day(firstDay)} onwards — widen the date range.</p>;
    return (
      <>
        <KpiRow>
          <Kpi logo="clarity" label="Recorded sessions" value={o.sessions} defKey="clarity_sessions" sub={`${fmt.int(o.bots)} bot sessions left out`} />
          <Kpi logo="clarity" label="Avg scroll depth" value={o.scroll} format="pct" defKey="clarity_scroll" />
          <Kpi logo="clarity" label="Active time / session" value={o.active} format="secs" defKey="clarity_active" />
          <Kpi logo="clarity" label="Rage-click sessions" value={o.rage} format="pct" defKey="clarity_rage" invert />
          <Kpi logo="clarity" label="Dead-click sessions" value={o.dead} format="pct" defKey="clarity_dead" invert />
          <Kpi logo="clarity" label="Quick-back sessions" value={o.quickback} format="pct" defKey="clarity_quickback" invert />
        </KpiRow>
        {tests > 0 && <p className="warnline">{fmt.int(tests)} page visit{tests === 1 ? "" : "s"} in this period {tests === 1 ? "was" : "were"} our own testing (dashboard QA links and the Elementor editor preview). They're inside the totals above — Clarity doesn't split them out — and hidden in the page table below.</p>}
        {o.sessions < 30 && <p className="muted small">Fewer than 30 sessions so far: treat percentages as early signals, not rates.</p>}

        {days.length >= 3
          ? <TrendChart rows={days} height={200} series={[
              { key: "sessions", label: "Sessions", color: C.navy, kind: "area" },
              { key: "bots", label: "Bot sessions", color: C.teal },
            ]} />
          : <p className="muted small">Daily trend appears after 3 snapshots ({days.length} so far).</p>}

        <div className="sub-row"><h3 className="sub">Pages</h3>
          <label className="inline-toggle"><input type="checkbox" checked={showTests} onChange={(e) => setShowTests(e.target.checked)} /> Include test visits</label></div>
        <DataTable rows={pages} csvName="clarity-pages" initialSort={{ key: "sessions", dir: -1 }}
          empty="No visitor page views in this period once test visits are hidden." cols={[
          { key: "key", label: "Page" },
          { key: "sessions", label: "Sessions", align: "right", format: "int" },
          { key: "scroll", label: "Scroll depth", align: "right", format: "pct" },
          { key: "active", label: "Active time", align: "right", format: "secs" },
          { key: "rage", label: "Rage clicks", align: "right", format: "pct", title: "Share of sessions" },
          { key: "dead", label: "Dead clicks", align: "right", format: "pct", title: "Share of sessions" },
          { key: "quickback", label: "Quick-backs", align: "right", format: "pct", title: "Share of sessions" },
          { key: "bots", label: "Bots", align: "right", format: "int" },
        ]} />

        <div className="two-col">
          <div>
            <h3 className="sub">Devices</h3>
            <DataTable rows={devices} csvName="clarity-devices" cols={[
              { key: "key", label: "Device" },
              { key: "sessions", label: "Sessions", align: "right", format: "int" },
              { key: "scroll", label: "Scroll", align: "right", format: "pct" },
              { key: "active", label: "Active time", align: "right", format: "secs" },
            ]} />
          </div>
          <div>
            <h3 className="sub">Channels</h3>
            <DataTable rows={channels} csvName="clarity-channels" cols={[
              { key: "key", label: "Channel" },
              { key: "sessions", label: "Sessions", align: "right", format: "int" },
              { key: "scroll", label: "Scroll", align: "right", format: "pct" },
              { key: "active", label: "Active time", align: "right", format: "secs" },
            ]} />
          </div>
        </div>
      </>
    );
  }
}
