import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DataTable, Drawer, ErrorBox, Kpi, KpiRow, Loading, Page, Pending, Section, Tag, type Col } from "../components/ui";
import { useFilters, useRpc, useTable } from "../state";
import { fmtDate } from "../lib/dates";
import { costPer, cpc, ctr, convRate, fmt } from "../lib/metrics";
import { ACCOUNT, STATUS_LABEL, STATUS_TONE, assetsFor, combo, domainOf, lc, metricsOf, num, statusOf, type AdRow, type Asset, type Status, type TextAsset } from "../lib/adlib";

/* ---------------- page ---------------- */
export default function AdLibrary() {
  const f = useFilters();
  const [scope, setScope] = useState<"all" | "dashboard">("all");
  const range = scope === "all" ? { start: "2019-02-01", end: f.today } : f.range;
  const args = { p_start: range.start, p_end: range.end };
  const ads = useRpc<AdRow[]>("rpc_ads_ad_library", args, [range.start, range.end]);
  const camps = useRpc<any[]>("rpc_ads_campaigns", args, [range.start, range.end]);
  const assets = useTable<Asset>("ads_assets", (q) => q.select("*").limit(5000));
  const syncInfo = useTable<any>("settings", (q) => q.select("value").eq("key", "ads_library_sync"));
  const integ = useTable<any>("integrations", (q) => q.select("status,last_success_at,latest_imported,earliest_imported").eq("source", "google_ads"));

  const [view, setView] = useState<"gallery" | "table">(() => { try { return (localStorage.getItem("edc.adlib.view") as any) || "gallery"; } catch { return "gallery"; } });
  useEffect(() => { try { localStorage.setItem("edc.adlib.view", view); } catch { /* storage blocked */ } }, [view]);
  const [campaign, setCampaign] = useState("all");
  const [adGroup, setAdGroup] = useState("all");
  const [adType, setAdType] = useState("all");
  const [status, setStatus] = useState<"all" | Status>("all");
  const [q, setQ] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [open, setOpen] = useState<AdRow | null>(null);

  const rows = useMemo(() => (ads.data ?? []).map((a) => ({
    ...a, impressions: num(a.impressions), clicks: num(a.clicks), cost: num(a.cost), conversions: num(a.conversions),
    conversion_value: num(a.conversion_value), _status: statusOf(a, f.today),
  })), [ads.data, f.today]);
  const campaigns = useMemo(() => [...new Map(rows.map((r) => [r.campaign_id, r.campaign_name ?? r.campaign_id])).entries()], [rows]);
  const adGroups = useMemo(() => [...new Map(rows.filter((r) => campaign === "all" || r.campaign_id === campaign).map((r) => [r.ad_group_id, r.ad_group_name ?? r.ad_group_id])).entries()], [rows, campaign]);
  const adTypes = useMemo(() => [...new Set(rows.map((r) => r.ad_type ?? "UNKNOWN"))], [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (campaign === "all" || r.campaign_id === campaign)
      && (adGroup === "all" || r.ad_group_id === adGroup)
      && (adType === "all" || (r.ad_type ?? "UNKNOWN") === adType)
      && (status === "all" || r._status === status)
      && (!activeOnly || r.has_rows)
      && (!s || [r.campaign_name, r.ad_group_name, r.ad_id, r.ad_name, ...(r.headlines ?? []).map((h) => h.text), ...(r.descriptions ?? []).map((d) => d.text)]
        .some((x) => (x ?? "").toLowerCase().includes(s))));
  }, [rows, campaign, adGroup, adType, status, q, activeOnly]);

  const tot = metricsOf({
    impressions: filtered.reduce((s, r) => s + r.impressions, 0), clicks: filtered.reduce((s, r) => s + r.clicks, 0),
    cost: filtered.reduce((s, r) => s + r.cost, 0), conversions: filtered.reduce((s, r) => s + r.conversions, 0),
    conversion_value: filtered.reduce((s, r) => s + r.conversion_value, 0),
  });
  const campSpend = (camps.data ?? []).filter((c) => campaign === "all" || c.campaign_id === campaign).reduce((s, c) => s + num(c.cost), 0);
  const allAdSpend = rows.filter((r) => campaign === "all" || r.campaign_id === campaign).reduce((s, r) => s + r.cost, 0);
  const sync = syncInfo.data?.[0]?.value as { synced_at: string; ads: number; assets: number; warnings: string[] } | undefined;
  const running = rows.filter((r) => r._status === "running").length;
  const lastServedAll = rows.reduce<string | null>((m, r) => (r.last_served && (!m || r.last_served > m) ? r.last_served : m), null);
  const ga = integ.data?.[0];

  if (ga && ga.status !== "connected" && !rows.length) {
    return <Page eyebrow="Paid media" title="Google Ads Visual Ad Library"><Pending source="Google Ads" /></Page>;
  }

  return (
    <Page eyebrow="Paid media" title="Google Ads Visual Ad Library"
      intro={<>The actual ad text and assets from Google Ads account {ACCOUNT}, with each ad's results. Previews are <strong>rebuilt from the stored ad text and assets</strong>; they aren't screenshots, and what each searcher saw varied with device, position and which headlines Google chose.</>}>

      <Section n="01" title="Status" note={ads.data ? undefined : "Loading ads…"}>
        <div className={`adlib-banner ${running ? "live" : "hist"}`}>
          {running
            ? <><strong>{running} ad{running === 1 ? "" : "s"} currently serving.</strong> Other ads below are shown with their historical results.</>
            : <><strong>No ads are serving right now.</strong> {lastServedAll ? <>The last impression was on {fmtDate(lastServedAll)}. Everything below is <em>historical</em> performance.</> : "No impressions recorded yet."}</>}
          {sync?.synced_at && <span className="muted small"> Ad text and status as of {new Date(sync.synced_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}.</span>}
        </div>
        {sync?.warnings?.length ? (
          <details className="adlib-note"><summary>{sync.warnings.length} creative detail{sync.warnings.length === 1 ? "" : "s"} couldn't be read from the Google Ads API</summary>
            <ul>{sync.warnings.map((w, i) => <li key={i} className="small">{w}</li>)}</ul>
            <p className="small muted">Those fields are left blank rather than guessed.</p>
          </details>) : null}
      </Section>

      <Section n="02" title="Filters">
        <div className="adlib-filters">
          <label>Period
            <select value={scope} onChange={(e) => setScope(e.target.value as any)}>
              <option value="all">All time</option>
              <option value="dashboard">Dashboard period ({f.label})</option>
            </select>
          </label>
          <label>Campaign
            <select value={campaign} onChange={(e) => { setCampaign(e.target.value); setAdGroup("all"); }}>
              <option value="all">All campaigns</option>
              {campaigns.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label>Ad group
            <select value={adGroup} onChange={(e) => setAdGroup(e.target.value)}>
              <option value="all">All ad groups</option>
              {adGroups.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label>Ad type
            <select value={adType} onChange={(e) => setAdType(e.target.value)}>
              <option value="all">All types</option>
              {adTypes.map((t) => <option key={t} value={t}>{lc(t)}</option>)}
            </select>
          </label>
          <label>Status
            <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="all">Any status</option>
              {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="grow">Search
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Campaign, ad group, headline or ad ID" />
          </label>
        </div>
        <div className="adlib-toolbar">
          <label className="check"><input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Only ads with activity in this period</label>
          <div className="seg" role="tablist" aria-label="View">
            <button className={view === "gallery" ? "on" : ""} onClick={() => setView("gallery")}>Gallery</button>
            <button className={view === "table" ? "on" : ""} onClick={() => setView("table")}>Table</button>
          </div>
        </div>
        <p className="muted small">{range.start === "2019-02-01" ? "All time" : `${fmtDate(range.start)} – ${fmtDate(range.end)}`} · {fmt.int(filtered.length)} of {fmt.int(rows.length)} ads</p>
      </Section>

      <Section n="03" title="Totals for the ads shown" note="Rates are calculated from these totals, not averaged across ads.">
        <KpiRow>
          <Kpi label="Impressions" value={tot.imp} format="int" />
          <Kpi label="Clicks" value={tot.clk} format="int" />
          <Kpi label="CTR" value={tot.ctr} format="pct" />
          <Kpi label="Spend" value={tot.cost} format="inr" />
          <Kpi label="Avg CPC" value={tot.cpc} format="inr" />
          <Kpi label="Conversions" value={tot.conv} format="dec" />
          <Kpi label="Conv. rate" value={tot.cr} format="pct" />
          <Kpi label="Cost / conversion" value={tot.cpa} format="inr" />
        </KpiRow>
        {camps.data && ads.data && campSpend > 0 && Math.abs(campSpend - allAdSpend) > 1 && (
          <p className="muted small">Ad-level reports cover {fmt.inr(allAdSpend)} of {fmt.inr(campSpend)} campaign spend in this period. The gap is spend Google doesn't attribute to an individual ad, or ads deleted before this dashboard first synced.</p>
        )}
        <p className="muted small">Conversions are Google's own count (they include phone, WhatsApp and directions taps). Conversion value is shown only where it's really configured; this account currently values each conversion at a placeholder ₹1.</p>
      </Section>

      <Section n="04" title={view === "gallery" ? "Ads" : "Ad performance"}>
        {ads.error ? <ErrorBox msg={ads.error} /> : !ads.data ? <Loading h={240} /> : !filtered.length ? (
          <div className="empty">{rows.length ? "No ads match these filters." : "No ads synced yet. They appear after the next Google Ads sync."}</div>
        ) : view === "gallery" ? (
          <Gallery rows={filtered} assets={assets.data ?? []} onOpen={setOpen} />
        ) : (
          <AdTable rows={filtered} onOpen={setOpen} />
        )}
      </Section>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? (open.headlines?.[0]?.text ?? open.ad_name ?? `Ad ${open.ad_id}`) : ""}>
        {open && <AdDetail ad={open} assets={assets.data ?? []} range={range} today={f.today} />}
      </Drawer>
    </Page>
  );
}

/* ---------------- gallery ---------------- */
function Gallery({ rows, assets, onOpen }: { rows: (AdRow & { _status: Status })[]; assets: Asset[]; onOpen: (a: AdRow) => void }) {
  // Account → campaign → ad group → ad
  const tree = useMemo(() => {
    const m = new Map<string, { name: string; status: string | null; groups: Map<string, { name: string; status: string | null; ads: (AdRow & { _status: Status })[] }> }>();
    for (const r of rows) {
      const c = m.get(r.campaign_id) ?? { name: r.campaign_name ?? r.campaign_id, status: r.campaign_status, groups: new Map() };
      const g = c.groups.get(r.ad_group_id) ?? { name: r.ad_group_name ?? r.ad_group_id, status: r.ad_group_status, ads: [] };
      g.ads.push(r); c.groups.set(r.ad_group_id, g); m.set(r.campaign_id, c);
    }
    return [...m.entries()];
  }, [rows]);
  return (
    <div className="adlib-tree">
      <div className="crumb small muted">Account {ACCOUNT}</div>
      {tree.map(([cid, c]) => {
        const all = [...c.groups.values()].flatMap((g) => g.ads);
        const t = metricsOf({ impressions: all.reduce((s, r) => s + r.impressions, 0), clicks: all.reduce((s, r) => s + r.clicks, 0), cost: all.reduce((s, r) => s + r.cost, 0), conversions: all.reduce((s, r) => s + r.conversions, 0), conversion_value: 0 });
        return (
          <div key={cid} className="adlib-camp">
            <div className="adlib-camp-head">
              <h3>{c.name}</h3>
              <Tag tone={c.status === "ENABLED" ? "good" : c.status === "REMOVED" ? "bad" : "neutral"}>campaign {lc(c.status) || "status unknown"}</Tag>
              <span className="muted small">{fmt.inr(t.cost)} · {fmt.int(t.clk)} clicks · {fmt.dec(t.conv)} conv.</span>
            </div>
            {[...c.groups.entries()].map(([gid, g]) => (
              <div key={gid} className="adlib-group">
                <div className="adlib-group-head small"><span className="muted">Ad group</span> <strong>{g.name}</strong> <span className="muted">· {lc(g.status) || "status unknown"}</span></div>
                <div className="adlib-cards">{g.ads.map((a) => <AdCard key={`${a.ad_group_id}-${a.ad_id}`} ad={a} assets={assets} onOpen={onOpen} />)}</div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function AdCard({ ad, assets, onOpen }: { ad: AdRow & { _status: Status }; assets: Asset[]; onOpen: (a: AdRow) => void }) {
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const m = metricsOf(ad);
  return (
    <article className="adlib-card">
      <header className="adlib-card-head">
        <Tag tone={STATUS_TONE[ad._status]}>{STATUS_LABEL[ad._status]}</Tag>
        <span className="muted small">{lc(ad.ad_type)} · ID {ad.ad_id}</span>
        <div className="seg sm" role="tablist" aria-label="Preview device">
          <button className={device === "mobile" ? "on" : ""} onClick={() => setDevice("mobile")}>Mobile</button>
          <button className={device === "desktop" ? "on" : ""} onClick={() => setDevice("desktop")}>Desktop</button>
        </div>
      </header>
      <div className="adlib-card-body">
        <Preview ad={ad} assets={assets} device={device} compact />
        <MetricGrid m={m} hasRows={ad.has_rows} lastServed={ad.last_served} status={ad._status} />
      </div>
      <footer className="adlib-card-foot">
        <button className="btn" onClick={() => onOpen(ad)}>Open ad</button>
        {ad.final_urls?.[0] && <a className="btn ghost" href={ad.final_urls[0]} target="_blank" rel="noopener noreferrer">Landing page ↗</a>}
      </footer>
    </article>
  );
}

function MetricGrid({ m, hasRows, lastServed, status }: { m: ReturnType<typeof metricsOf>; hasRows: boolean; lastServed: string | null; status: Status }) {
  if (!hasRows) return (
    <div className="adlib-metrics empty-m">
      <p className="small muted">No activity in this period.{lastServed ? ` Last impression ${fmtDate(lastServed)}.` : status === "never" ? " This ad has no recorded impressions." : ""}</p>
    </div>
  );
  const cell = (label: string, v: ReactNode) => <div><span>{label}</span><strong>{v}</strong></div>;
  return (
    <div className="adlib-metrics">
      {cell("Impressions", fmt.int(m.imp))}
      {cell("Clicks", fmt.int(m.clk))}
      {cell("CTR", m.ctr == null ? "—" : fmt.pct(m.ctr))}
      {cell("Spend", fmt.inr(m.cost))}
      {cell("Avg CPC", m.cpc == null ? "—" : fmt.inr(m.cpc))}
      {cell("Conversions", fmt.dec(m.conv))}
      {cell("Conv. rate", m.cr == null ? "—" : fmt.pct(m.cr))}
      {cell("Cost / conv.", m.cpa == null ? "No conversions" : fmt.inr(m.cpa))}
      {cell("Conv. value", m.valueState === "ok" ? fmt.inr(m.val) : m.valueState === "placeholder" ? "Not configured (₹1 placeholder)" : "Not configured")}
    </div>
  );
}

/* ---------------- previews ---------------- */
function Preview({ ad, assets, device, compact = false }: { ad: AdRow; assets: Asset[]; device: "mobile" | "desktop"; compact?: boolean }) {
  const [seed, setSeed] = useState(0);
  const A = useMemo(() => assetsFor(ad, assets), [ad, assets]);
  const heads = combo(ad.headlines, 3, "HEADLINE", seed);
  const descs = combo(ad.descriptions, device === "mobile" ? 1 : 2, "DESCRIPTION", seed);
  const url = ad.final_mobile_urls?.[0] && device === "mobile" ? ad.final_mobile_urls[0] : ad.final_urls?.[0];
  const domain = domainOf(url) ?? ad.display_url ?? null;
  const path = [ad.path1, ad.path2].filter(Boolean).join(" › ");
  const name = A.businessName ?? domain ?? "Advertiser";
  const sl = A.sitelinks.items.filter((x) => x.link_status !== "PAUSED").slice(0, device === "mobile" ? 4 : 4);
  const co = A.callouts.items.filter((x) => x.link_status !== "PAUSED").map((x) => x.text_value).filter(Boolean).slice(0, 4);
  const img = A.images.items.find((x) => x.image_url)?.image_url;
  const call = A.calls.items.find((x) => x.phone)?.phone;
  const isSearch = !ad.ad_type || /SEARCH|TEXT/.test(ad.ad_type);
  const multi = (ad.headlines?.length ?? 0) > 3 || (ad.descriptions?.length ?? 0) > 2;

  if (!heads.length && !descs.length) return (
    <div className="adlib-preview-missing small muted">The Google Ads API returned no headline or description text for this {lc(ad.ad_type) || "ad"}, so a preview can't be rebuilt.</div>
  );

  const body = (
    <div className={`gad gad-${device}`}>
      <div className="gad-top">
        <span className="gad-spons">Sponsored</span>
      </div>
      <div className="gad-id">
        <span className="gad-fav">{A.logo ? <img src={A.logo} alt="" referrerPolicy="no-referrer" loading="lazy" /> : name.slice(0, 1).toUpperCase()}</span>
        <span className="gad-idtxt"><span className="gad-name">{name}</span><span className="gad-url">{domain}{path ? ` › ${path}` : ""}</span></span>
      </div>
      <div className={img && device === "mobile" ? "gad-main with-img" : "gad-main"}>
        <div>
          <div className="gad-h">{heads.join(" | ")}</div>
          <div className="gad-d">{descs.join(" ")}</div>
          {co.length > 0 && <div className="gad-co">{co.join(" · ")}</div>}
        </div>
        {img && <img className="gad-img" src={img} alt="Image asset from Google Ads" referrerPolicy="no-referrer" loading="lazy" />}
      </div>
      {sl.length > 0 && (device === "mobile"
        ? <div className="gad-sl-m">{sl.map((s) => <span key={s.asset_id}>{s.link_text}</span>)}</div>
        : <div className="gad-sl-d">{sl.map((s) => <div key={s.asset_id}><span className="gad-sl-t">{s.link_text}</span>{(s.description1 || s.description2) && <span className="gad-sl-x">{[s.description1, s.description2].filter(Boolean).join(" ")}</span>}</div>)}</div>)}
      {call && device === "mobile" && <div className="gad-call">📞 Call {call}</div>}
    </div>
  );

  return (
    <figure className={`adlib-preview ${device} ${compact ? "compact" : ""}`}>
      {device === "mobile"
        ? <div className="phone"><div className="phone-notch" /><div className="phone-screen"><div className="serp-bar">dentist near me</div>{body}</div></div>
        : <div className="desk"><div className="desk-bar"><span /><span /><span /><div className="desk-q">dental clinic tc palya</div></div><div className="desk-screen">{body}</div></div>}
      <figcaption className="small muted">
        Reconstructed {isSearch ? "Google Search" : ""} preview, not a screenshot.{multi ? " Google mixes headlines and descriptions; this is one possible combination." : ""} The search query shown is illustrative.
        {multi && <> <button className="linkbtn" onClick={() => setSeed((s) => s + 1)}>Show another combination</button></>}
      </figcaption>
    </figure>
  );
}

/* ---------------- table ---------------- */
function AdTable({ rows, onOpen }: { rows: (AdRow & { _status: Status })[]; onOpen: (a: AdRow) => void }) {
  const cols: Col<any>[] = [
    { key: "headline", label: "Ad", value: (r) => r.headlines?.[0]?.text ?? r.ad_name ?? `Ad ${r.ad_id}`, render: (r) => <span className="adlib-cell-ad"><strong>{r.headlines?.[0]?.text ?? r.ad_name ?? `Ad ${r.ad_id}`}</strong><span className="muted small">{lc(r.ad_type)} · ID {r.ad_id}</span></span> },
    { key: "campaign_name", label: "Campaign" },
    { key: "ad_group_name", label: "Ad group" },
    { key: "_status", label: "Status", value: (r) => STATUS_LABEL[r._status as Status], render: (r) => <Tag tone={STATUS_TONE[r._status as Status]}>{STATUS_LABEL[r._status as Status]}</Tag> },
    { key: "impressions", label: "Impr.", align: "right", format: "int" },
    { key: "clicks", label: "Clicks", align: "right", format: "int" },
    { key: "ctr", label: "CTR", align: "right", format: "pct", value: (r) => ctr(r.clicks, r.impressions) },
    { key: "cost", label: "Spend", align: "right", format: "inr" },
    { key: "cpc", label: "Avg CPC", align: "right", format: "inr", value: (r) => cpc(r.cost, r.clicks) },
    { key: "conversions", label: "Conv.", align: "right", format: "dec" },
    { key: "cr", label: "Conv. rate", align: "right", format: "pct", value: (r) => convRate(r.conversions, r.clicks) },
    { key: "cpa", label: "Cost/conv.", align: "right", format: "inr", value: (r) => costPer(r.cost, r.conversions) },
    { key: "last_served", label: "Last impression", value: (r) => r.last_served, render: (r) => (r.last_served ? fmtDate(r.last_served) : "—") },
  ];
  return <DataTable rows={rows} cols={cols} csvName="google-ads-ad-library" onRow={onOpen} limit={50} initialSort={{ key: "cost", dir: -1 }} />;
}

/* ---------------- detail ---------------- */
function AdDetail({ ad, assets, range, today }: { ad: AdRow; assets: Asset[]; range: { start: string; end: string }; today: string }) {
  const A = useMemo(() => assetsFor(ad, assets), [ad, assets]);
  const st = statusOf(ad, today);
  const m = metricsOf(ad);
  const [level, setLevel] = useState<"ad_group" | "campaign">("ad_group");
  const terms = useRpc<any>("rpc_ads_terms_for", { p_start: range.start, p_end: range.end, p_campaign_id: ad.campaign_id, p_ad_group_id: level === "ad_group" ? ad.ad_group_id : null }, [ad.ad_id, level, range.start, range.end]);
  const t = terms.data;
  const coverage = t && level === "campaign" && num(t.campaign_clicks) > 0 ? num(t.term_clicks) / num(t.campaign_clicks) : null;

  return (
    <div className="adlib-detail">
      <div className="crumb small muted">Account {ACCOUNT} › {ad.campaign_name} › {ad.ad_group_name} › Ad {ad.ad_id}</div>
      <div className="chips">
        <Tag tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Tag>
        <Tag>ad {lc(ad.ad_status) || "status unknown"}</Tag>
        <Tag>ad group {lc(ad.ad_group_status) || "?"}</Tag>
        <Tag>campaign {lc(ad.campaign_status) || "?"}{ad.campaign_serving_status && ad.campaign_serving_status !== "SERVING" ? ` · ${lc(ad.campaign_serving_status)}` : ""}</Tag>
        {ad.approval_status && <Tag tone={/DISAPPROVED/.test(ad.approval_status) ? "bad" : /LIMITED/.test(ad.approval_status) ? "warn" : "good"}>policy: {lc(ad.approval_status)}</Tag>}
        {ad.ad_strength && ad.ad_strength !== "UNSPECIFIED" && <Tag tone="info">ad strength: {lc(ad.ad_strength)}</Tag>}
      </div>
      {ad.first_served && <p className="small muted">Served {fmtDate(ad.first_served)} – {ad.last_served ? fmtDate(ad.last_served) : "?"} (all-time impressions). Results below: {range.start === "2019-02-01" ? "all time" : `${fmtDate(range.start)} – ${fmtDate(range.end)}`}.</p>}

      <h4>Customer-view previews</h4>
      <div className="adlib-previews">
        <Preview ad={ad} assets={assets} device="mobile" />
        <Preview ad={ad} assets={assets} device="desktop" />
      </div>
      <p className="small">{ad.final_urls?.[0] ? <>Landing page: <a href={ad.final_urls[0]} target="_blank" rel="noopener noreferrer">{ad.final_urls[0]}</a></> : <span className="muted">No final URL returned by the API.</span>}
        {ad.final_mobile_urls?.[0] && <> · Mobile: <a href={ad.final_mobile_urls[0]} target="_blank" rel="noopener noreferrer">{ad.final_mobile_urls[0]}</a></>}</p>

      <h4>Performance</h4>
      <MetricGrid m={m} hasRows={ad.has_rows} lastServed={ad.last_served} status={st} />

      <h4>Ad text ({ad.headlines?.length ?? 0} headlines, {ad.descriptions?.length ?? 0} descriptions)</h4>
      {ad.long_headline && <p><span className="muted small">Long headline</span><br />{ad.long_headline}</p>}
      <TextList title="Headlines" items={ad.headlines} limit={30} />
      <TextList title="Descriptions" items={ad.descriptions} limit={90} />
      {(ad.path1 || ad.path2) && <p className="small"><span className="muted">Display path:</span> /{[ad.path1, ad.path2].filter(Boolean).join("/")}</p>}
      <p className="small muted">Labels like "best" or "low" are Google's asset performance ratings where it reports them. Google doesn't keep earlier versions of edited text, so this is the ad as it stands now.</p>

      <h4>Assets used with this ad</h4>
      <AssetBlock title="Business name" level={A.businessName ? (ad.business_name ? "ad" : "linked") : null}>{A.businessName}</AssetBlock>
      <AssetBlock title="Logo" level={A.logo ? "linked" : null}>{A.logo && <img className="adlib-logo" src={A.logo} alt="Logo asset" referrerPolicy="no-referrer" />}</AssetBlock>
      <AssetBlock title="Sitelinks" level={A.sitelinks.level}>{A.sitelinks.items.map((s) => <div key={s.asset_id} className="adlib-asset"><strong>{s.link_text}</strong>{s.link_status && s.link_status !== "ENABLED" && <Tag>{lc(s.link_status)}</Tag>}<span className="small muted">{[s.description1, s.description2].filter(Boolean).join(" · ")}</span>{s.final_urls?.[0] && <a className="small" href={s.final_urls[0]} target="_blank" rel="noopener noreferrer">{s.final_urls[0]}</a>}</div>)}</AssetBlock>
      <AssetBlock title="Callouts" level={A.callouts.level}>{A.callouts.items.length > 0 && <div className="chips">{A.callouts.items.map((c) => <Tag key={c.asset_id}>{c.text_value}{c.link_status && c.link_status !== "ENABLED" ? ` (${lc(c.link_status)})` : ""}</Tag>)}</div>}</AssetBlock>
      <AssetBlock title="Structured snippets" level={A.snippets.level}>{A.snippets.items.map((s) => <div key={s.asset_id} className="small"><strong>{s.snippet_header}:</strong> {(s.snippet_values ?? []).join(", ")}</div>)}</AssetBlock>
      <AssetBlock title="Call" level={A.calls.level}>{A.calls.items.map((c) => <div key={c.asset_id}>{c.phone}</div>)}</AssetBlock>
      <AssetBlock title="Images" level={A.images.level}>{A.images.items.length > 0 && <div className="adlib-imgs">{A.images.items.filter((x) => x.image_url).map((x) => <a key={x.asset_id} href={x.image_url!} target="_blank" rel="noopener noreferrer"><img src={x.image_url!} alt={x.asset_name ?? "Image asset"} referrerPolicy="no-referrer" loading="lazy" /><span className="small muted">{x.image_width && x.image_height ? `${x.image_width}×${x.image_height}` : ""}</span></a>)}</div>}</AssetBlock>
      <AssetBlock title="Videos" level={A.videos.level}>{A.videos.items.filter((v) => v.youtube_id).map((v) => <a key={v.asset_id} className="adlib-video" href={`https://www.youtube.com/watch?v=${v.youtube_id}`} target="_blank" rel="noopener noreferrer"><img src={`https://i.ytimg.com/vi/${v.youtube_id}/hqdefault.jpg`} alt="" loading="lazy" /><span>{v.youtube_title ?? "YouTube video"} ↗</span></a>)}</AssetBlock>
      {A.other.length > 0 && <AssetBlock title="Other linked assets" level="linked">{A.other.map((x) => <div key={`${x.level}-${x.asset_id}-${x.field_type}`} className="small">{lc(x.field_type)}: {x.text_value ?? x.asset_name ?? x.asset_type} <span className="muted">({x.level === "customer" ? "account" : x.level.replace("_", " ")} level)</span></div>)}</AssetBlock>}
      <p className="small muted">Assets are the ones linked now, at the most specific level (ad group, then campaign, then account). Whether Google showed a given asset on a given search isn't reported per impression.</p>

      {ad.policy_topics && ad.policy_topics.length > 0 && <>
        <h4>Policy notes</h4>
        <ul className="small">{ad.policy_topics.map((p, i) => <li key={i}>{lc(p.topic)} <span className="muted">({lc(p.type)})</span></li>)}</ul>
      </>}

      <h4>Keywords and search terms</h4>
      <div className="seg sm">
        <button className={level === "ad_group" ? "on" : ""} onClick={() => setLevel("ad_group")}>This ad group</button>
        <button className={level === "campaign" ? "on" : ""} onClick={() => setLevel("campaign")}>Whole campaign</button>
      </div>
      {!t ? <Loading /> : <>
        <h5>Keywords</h5>
        <DataTable rows={(t.keywords ?? []).map((k: any) => ({ ...k, impressions: num(k.impressions), clicks: num(k.clicks), cost: num(k.cost), conversions: num(k.conversions) }))}
          csvName={`keywords-${ad.ad_group_id}`} limit={15} empty="No keyword data in this period." cols={[
          { key: "keyword", label: "Keyword" }, { key: "match_type", label: "Match", render: (r) => lc(r.match_type) },
          { key: "impressions", label: "Impr.", align: "right", format: "int" }, { key: "clicks", label: "Clicks", align: "right", format: "int" },
          { key: "ctr", label: "CTR", align: "right", format: "pct", value: (r) => ctr(r.clicks, r.impressions) },
          { key: "cost", label: "Spend", align: "right", format: "inr" }, { key: "conversions", label: "Conv.", align: "right", format: "dec" },
          { key: "cpa", label: "Cost/conv.", align: "right", format: "inr", value: (r) => costPer(r.cost, r.conversions) },
        ]} />
        <h5>Search terms</h5>
        <DataTable rows={(t.terms ?? []).map((k: any) => ({ ...k, impressions: num(k.impressions), clicks: num(k.clicks), cost: num(k.cost), conversions: num(k.conversions) }))}
          csvName={`search-terms-${ad.ad_group_id}`} limit={15} empty="No search terms reported in this period." initialSort={{ key: "cost", dir: -1 }} cols={[
          { key: "search_term", label: "Search term" }, { key: "match_types", label: "Matched as", render: (r) => r.match_types ? lc(r.match_types).replace(/,/g, ", ") : "—" },
          { key: "impressions", label: "Impr.", align: "right", format: "int" }, { key: "clicks", label: "Clicks", align: "right", format: "int" },
          { key: "ctr", label: "CTR", align: "right", format: "pct", value: (r) => ctr(r.clicks, r.impressions) },
          { key: "cost", label: "Spend", align: "right", format: "inr" }, { key: "conversions", label: "Conv.", align: "right", format: "dec" },
          { key: "cpa", label: "Cost/conv.", align: "right", format: "inr", value: (r) => costPer(r.cost, r.conversions) },
        ]} />
        <p className="small muted">
          Google hides search terms that too few people searched, for privacy, so this list never covers every click.
          {coverage != null && <> In this period, named search terms account for {fmt.pct(Math.min(coverage, 1))} of the campaign's clicks.</>}
          {" "}Search terms are reported per ad group, not per ad.
        </p>
      </>}
    </div>
  );
}

function TextList({ title, items, limit }: { title: string; items: TextAsset[] | null; limit: number }) {
  if (!items?.length) return <p className="small muted">{title}: none returned by the API.</p>;
  return (
    <table className="adlib-text">
      <thead><tr><th>{title}</th><th>Chars</th><th>Pinned</th><th>Google rating</th><th>Policy</th></tr></thead>
      <tbody>{items.map((h, i) => (
        <tr key={i}>
          <td>{h.text}</td>
          <td className={`num ${h.text.length > limit ? "over" : ""}`}>{h.text.length}/{limit}</td>
          <td>{h.pinned ? lc(h.pinned).replace("headline ", "position ").replace("description ", "position ") : "—"}</td>
          <td>{h.label ? <Tag tone={h.label === "BEST" ? "good" : h.label === "LOW" ? "bad" : "neutral"}>{lc(h.label)}</Tag> : <span className="muted">not rated</span>}</td>
          <td>{h.approval ? lc(h.approval) : "—"}</td>
        </tr>))}
      </tbody>
    </table>
  );
}

function AssetBlock({ title, level, children }: { title: string; level: string | null; children: ReactNode }) {
  const has = level != null && children != null && !(Array.isArray(children) && children.length === 0);
  return (
    <div className="adlib-assetblock">
      <div className="small"><strong>{title}</strong>{has && level && level !== "linked" && level !== "ad" && <span className="muted"> · {level === "customer" ? "account" : level.replace("_", " ")} level</span>}</div>
      {has ? children : <div className="small muted">None linked, or not returned by the Google Ads API.</div>}
    </div>
  );
}
