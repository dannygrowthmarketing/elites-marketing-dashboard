import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { Kpi, KpiRow, Page, Section, Tag } from "../components/ui";
import { useTable } from "../state";
import { AUDIT, CLINICS, DENSITY, DENSITY_POINTS, latest, MAPS_NOTE, MAPS_RANK, monthsToCatch, OPPS, PAID, PRESENCE, SERP, SERP_NOTE, SITE_CHECKS, SITES, siteScore, SNAPSHOTS, velocity, type AuditItem, type SerpKind } from "../lib/competitors";
import { fmt } from "../lib/metrics";
import { C } from "./Overview";

const KIND_LABEL: Record<SerpKind, string> = { directory: "Directory", chain: "Chain", competitor: "Local rival", elites: "Elites", other: "Other" };

export default function Competitors() {
  const [scope, setScope] = useState<"tc_palya" | "all">("tc_palya");
  const site = useTable<any>("settings", (q) => q.select("value").eq("key", "site_check").limit(1));
  const check = site.data?.[0]?.value ?? null;

  const me = CLINICS.find((c) => c.elites)!;
  const pool = CLINICS.filter((c) => scope === "all" || c.road === "tc_palya");
  const ranked = [...pool].sort((a, b) => (latest(b) ?? 0) - (latest(a) ?? 0));
  const myRank = ranked.findIndex((c) => c.elites) + 1;
  const myVel = velocity(me)!;
  const road = CLINICS.filter((c) => c.road === "tc_palya");
  const fastest = [...road].filter((c) => !c.elites).map((c) => ({ c, v: velocity(c) })).filter((x) => x.v).sort((a, b) => b.v!.per30 - a.v!.per30)[0];
  const ahead = ranked.slice(0, Math.max(0, myRank - 1)).reverse()[0];
  const catchIn = ahead ? monthsToCatch(me, ahead) : null;
  const leader = ranked[0];
  const mySite = SITES.find((s) => s.elites)!;
  const bestOther = [...SITES].filter((s) => !s.elites).sort((a, b) => siteScore(b) - siteScore(a))[0];

  const bars = ranked.map((c) => ({ name: c.short, reviews: latest(c), elites: !!c.elites, rating: c.rating }));
  const slope = SNAPSHOTS.map((s) => {
    const row: any = { label: s.label };
    for (const c of road) if (c.reviews.s1 != null && c.reviews.s3 != null) row[c.short] = c.reviews[s.key] ?? null;
    return row;
  });
  const slopeKeys = road.filter((c) => c.reviews.s1 != null && c.reviews.s3 != null).map((c) => c.short);
  const vel = CLINICS.map((c) => ({ name: c.short, v: velocity(c), elites: !!c.elites })).filter((x) => x.v).map((x) => ({ name: x.name, per30: +x.v!.per30.toFixed(1), elites: x.elites, span: `${x.v!.from} → ${x.v!.to}` })).sort((a, b) => b.per30 - a.per30);

  const live = useMemo(() => liveAudit(check), [check]);

  return (
    <Page eyebrow="Market · TC Palya Main Road" title="Competitor analysis"
      intro={<>How Elites stacks up against the clinics patients compare it with, across reviews, search results, websites, directories and ads. Each figure carries the date and method of the audit it comes from; nothing here is estimated.</>}
      actions={<button className="btn ghost" onClick={() => window.print()}>Print / PDF</button>}>

      <KpiRow>
        <Kpi big label="Elites Google reviews" value={latest(me)} sub={`+${myVel.gained} since ${myVel.from}`} />
        <Kpi big label={`Review rank (${scope === "all" ? "area" : "TC Palya Main Rd"})`} value={myRank} sub={`of ${ranked.length} · leader ${leader.short} ${fmt.int(latest(leader))}`} />
        <Kpi big label="Reviews per month" value={Math.round(myVel.per30)} sub={fastest ? `fastest rival on the road: ${fastest.c.short} ${Math.round(fastest.v!.per30)}` : undefined} />
        <Kpi big label="Organic rank, money terms" value={5} sub="was off page one on 18 Sep" />
        <Kpi big label="Website score" value={siteScore(mySite)} sub={`best rival: ${bestOther.who} ${siteScore(bestOther)}`} />
      </KpiRow>

      <div className="callout">
        <strong>The short version.</strong> Elites now has the best momentum on the road: it reached page one for both money searches, owns its brand search,
        and is gaining reviews faster than any clinic on TC Palya Main Road. {ahead ? <>Next up is <strong>{ahead.short}</strong>, {fmt.int((latest(ahead) ?? 0) - (latest(me) ?? 0))} reviews ahead{catchIn != null && catchIn > 0 && velocity(ahead) ? <> — about {catchIn < 1 ? `${Math.max(1, Math.round(catchIn * 4.3))} week(s)` : `${catchIn.toFixed(1)} months`} at both clinics' current pace</> : <> — about {Math.max(1, Math.round((((latest(ahead) ?? 0) - (latest(me) ?? 0)) / Math.max(1, myVel.per30)) * 4.3))} week(s) at Elites' pace</>}.</> : null} The gaps
        are presence, not quality: no Practo/Lybrate listings, no prices, no star-rating markup, a near-dormant Instagram, and ads that stopped on 17 Oct.
      </div>

      <Section n="01" title="The review race" note={<>Google review counts read on {SNAPSHOTS.map((s) => s.label).join(", ")}. Reviews are the biggest visible trust signal on Maps.</>}
        right={<div className="seg">{(["tc_palya", "all"] as const).map((k) => <button key={k} className={scope === k ? "on" : ""} onClick={() => setScope(k)}>{k === "all" ? "Wider area" : "TC Palya Main Rd"}</button>)}</div>}>
        <div className="grid2">
          <div className="chart">
            <div className="chart-title">Reviews today (24 Oct)</div>
            <ResponsiveContainer width="100%" height={Math.max(260, bars.length * 26)}>
              <BarChart data={bars} layout="vertical" margin={{ left: 8, right: 40 }}>
                <CartesianGrid horizontal={false} stroke="var(--rule)" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={104} tick={{ fontSize: 11.5 }} interval={0} />
                <Tooltip formatter={(v: any) => fmt.int(v)} />
                <Bar dataKey="reviews" radius={[0, 3, 3, 0]}>
                  {bars.map((b) => <Cell key={b.name} fill={b.elites ? C.gold : C.slate} fillOpacity={b.elites ? 1 : 0.55} />)}
                  <LabelList dataKey="reviews" position="right" style={{ fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div className="chart">
              <div className="chart-title">Reviews gained per 30 days</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={vel} margin={{ left: -10, right: 10 }}>
                  <CartesianGrid vertical={false} stroke="var(--rule)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10.5 }} interval={0} angle={-35} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any, _n, p: any) => [`${v} / 30 days`, p.payload.span]} />
                  <Bar dataKey="per30" radius={[3, 3, 0, 0]}>{vel.map((b) => <Cell key={b.name} fill={b.elites ? C.gold : C.teal} fillOpacity={b.elites ? 1 : 0.6} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="chart">
              <div className="chart-title">Road leaders over time</div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={slope} margin={{ left: -10, right: 70 }}>
                  <CartesianGrid vertical={false} stroke="var(--rule)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  {slopeKeys.map((k) => <Line key={k} dataKey={k} connectNulls stroke={k === "Elites" ? C.gold : C.slate} strokeWidth={k === "Elites" ? 3 : 1.2} strokeOpacity={k === "Elites" ? 1 : 0.6} dot={{ r: 2.5 }}
                    label={({ x, y, index }: any) => index === slope.length - 1 ? <text x={x + 6} y={y + 4} fontSize={10.5} fill={k === "Elites" ? C.gold : "var(--muted)"}>{k}</text> : <g />} />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <p className="small muted">The 27 Sep audit noted many recent reviews have no text or come from accounts with 0–2 reviews. Steady asks at checkout keep the pace natural and within Google's rules.</p>
      </Section>

      <Section n="02" title="Who owns page one" note={SERP_NOTE}>
        <div className="serp-grid">
          {[...new Set(SERP.map((s) => s.term))].map((term) => (
            <div key={term} className="serp-term">
              <h3>“{term}”</h3>
              {SERP.filter((s) => s.term === term).map((s) => (
                <div key={s.date} className="serp-row">
                  <div className="serp-date">{new Date(s.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    <span>{s.elitesPos ? <Tag tone="good">Elites #{s.elitesPos}</Tag> : <Tag tone="bad">Elites absent</Tag>}</span></div>
                  <ol className="serp-tiles">{s.results.map((r, i) => <li key={i} className={`k-${r.kind}`} title={`${i + 1}. ${r.site} — ${KIND_LABEL[r.kind]}`}><b>{i + 1}</b>{r.site.replace(/^www\./, "").replace(/\.(com|in|co\.in)$/, "")}</li>)}</ol>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="legend-row">{(["elites", "directory", "chain", "competitor", "other"] as SerpKind[]).map((k) => <span key={k}><i className={`sw k-${k}`} />{KIND_LABEL[k]}</span>)}</div>
        <p className="small muted" style={{ marginTop: 10 }}>Directories hold 4 of the 8 spots for each money term. A Practo and Bajaj Health listing gives Elites more chances on the same page.</p>
      </Section>

      <Section n="03" title="Website scorecard" note="Homepages fetched on 24 Oct 2026 as a mobile browser. Timing is from a data centre, so read it as relative, not as what a phone on 4G sees. Score = weighted share of the checks below.">
        <div className="table-wrap heat-wrap">
          <table className="heat">
            <thead><tr><th>Check</th>{SITES.map((s) => <th key={s.site} className={s.elites ? "me" : ""}>{s.who}</th>)}</tr></thead>
            <tbody>
              <tr className="score-row"><td><strong>Score</strong></td>{SITES.map((s) => <td key={s.site} className={s.elites ? "me" : ""}><div className="meter"><i style={{ width: `${siteScore(s)}%` }} /></div><strong>{siteScore(s)}</strong></td>)}</tr>
              <tr><td title="One H1 per page is the clean setup">H1 headings</td>{SITES.map((s) => <td key={s.site} className={`${s.h1 === 1 ? "y" : s.h1 > 1 ? "p" : "n"} ${s.elites ? "me" : ""}`}>{s.h1}</td>)}</tr>
              {SITE_CHECKS.map((c) => (
                <tr key={c.key}><td title={c.why}>{c.label}</td>{SITES.map((s) => <td key={s.site} className={`${s[c.key] ? "y" : "n"} ${s.elites ? "me" : ""}`}>{s[c.key] ? "✓" : "✗"}</td>)}</tr>
              ))}
              <tr><td>Words on homepage</td>{SITES.map((s) => <td key={s.site} className={s.elites ? "me" : ""}>{fmt.int(s.words)}</td>)}</tr>
              <tr><td>Homepage size</td>{SITES.map((s) => <td key={s.site} className={s.elites ? "me" : ""}>{s.kb} KB</td>)}</tr>
              <tr><td>Response time</td>{SITES.map((s) => <td key={s.site} className={`${(s.ms ?? 0) > 2500 ? "n" : (s.ms ?? 0) > 900 ? "p" : "y"} ${s.elites ? "me" : ""}`}>{s.ms != null ? `${(s.ms / 1000).toFixed(1)} s` : "—"}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <p className="small muted">Not checked: clovedental.in, Pro+ (blocked automated fetches or loads by script), SmileFit and Pooja (no website). Hover a check for why it matters.</p>
      </Section>

      <Section n="04" title="How crowded the area is" note={<>Dental clinics within 3 km of Elites in Overture Maps open data (release {DENSITY.release}). {DENSITY.note}</>}>
        <div className="grid2">
          <DensityRings />
          <div>
            <KpiRow>
              <Kpi label="Within 1 km" value={DENSITY.within1} />
              <Kpi label="Within 2 km" value={DENSITY.within2} />
              <Kpi label="Within 3 km" value={DENSITY.within3} />
            </KpiRow>
            <p>Three rivals — Shiva, Prodent and KKS — sit <strong>within 400 m</strong>. A patient walking the road passes several clinics before Elites, so the Maps listing, reviews and the first screen of the website do the deciding.</p>
            <p className="small muted">{DENSITY.withWebsite} of {DENSITY.within3} have a website listed. Several have a Practo page or a free business.site page as their only site.</p>
          </div>
        </div>
      </Section>

      <Section n="05" title="Maps visibility" note={MAPS_NOTE}>
        <div className="table-wrap"><table>
          <thead><tr><th>Search</th><th className="r">27 Sep</th><th className="r">24 Oct</th><th>Read</th></tr></thead>
          <tbody>{MAPS_RANK.map((m) => (
            <tr key={m.term}><td>{m.term}</td><td className="r">{m.s2 ? `#${m.s2}` : "—"}</td><td className="r">{m.s3 ? `#${m.s3}` : "—"}</td>
              <td>{m.s2 && m.s3 ? (m.s3 <= m.s2 ? <Tag tone="good">Holding</Tag> : <Tag tone="warn">Lower in the list</Tag>) : <span className="muted small">Not re-checked</span>}</td></tr>
          ))}</tbody>
        </table></div>
        <p className="small muted">On 24 Oct the ‘dentist’ list put Elites 20th, behind clinics with 450–1,900 reviews and several outside TC Palya. Reviews, photos and the ‘Dentist’ category with specialist services are the levers.</p>
      </Section>

      <Section n="06" title="Directories and social" note="Where patients compare clinics before they ever reach a website.">
        <div className="table-wrap"><table>
          <thead><tr><th>Channel</th><th>Elites</th><th>Strongest rival</th><th /></tr></thead>
          <tbody>{PRESENCE.map((p) => <tr key={p.channel}><td><strong>{p.channel}</strong></td><td>{p.elites}</td><td className="muted">{p.best}</td><td><Tag tone={p.tone}>{p.tone === "good" ? "Strong" : p.tone === "warn" ? "Partial" : "Gap"}</Tag></td></tr>)}</tbody>
        </table></div>
      </Section>

      <Section n="07" title="Paid competition" note="Who is buying search attention around TC Palya, and the competitor names Elites' own ads paid for.">
        <div className="grid2">
          <div className="table-wrap"><table>
            <thead><tr><th>Advertiser</th><th>Evidence</th></tr></thead>
            <tbody>{PAID.advertisers.map((a) => <tr key={a.who}><td><strong>{a.who}</strong></td><td className="small">{a.evidence}</td></tr>)}</tbody>
          </table></div>
          <div className="chart">
            <div className="chart-title">What people searched before finding Elites' profile (Apr–Sep)</div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={PAID.gbpTerms} layout="vertical" margin={{ left: 8, right: 36 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="term" width={150} tick={{ fontSize: 11 }} interval={0} />
                <Tooltip />
                <Bar dataKey="n" radius={[0, 3, 3, 0]}>
                  {PAID.gbpTerms.map((t) => <Cell key={t.term} fill={/kks/.test(t.term) ? C.rust : /elite/.test(t.term) ? C.gold : C.navy} fillOpacity={0.8} />)}
                  <LabelList dataKey="n" position="right" style={{ fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <p className="small">From 1 Aug to 18 Sep Elites' ads spent <strong>{fmt.inr(PAID.brandSpend.reduce((a, b) => a + b.cost, 0))}</strong> on other clinics' names ({PAID.brandSpend.map((b) => b.term).slice(0, 4).join(", ")} …). Those searchers wanted a specific clinic — add them as negative keywords unless conquesting is a deliberate choice. Meanwhile “kks dental” was searched 307 times by people who then saw Elites' profile.</p>
      </Section>

      <Section n="08" title="Audit history — then and now" note="What the 18 Sep pitch audit found, against today. ‘Now’ cells marked live are read from the site check stored on the Website page.">
        <AuditTimeline />
        <div className="table-wrap"><table>
          <thead><tr><th>Area</th><th>Item</th><th>Then</th><th>Now</th><th>Status</th></tr></thead>
          <tbody>{AUDIT.map((a) => { const l = a.live ? live[a.live] : null; const st = l?.status ?? a.status; return (
            <tr key={a.item}><td className="small muted">{a.area}</td><td><strong>{a.item}</strong></td><td className="small">{a.then}</td>
              <td className="small">{l ? <>{l.text} <Tag tone="info">live</Tag></> : a.now}</td><td><StatusTag s={st} /></td></tr>
          ); })}</tbody>
        </table></div>
        <AuditSummary live={live} />
      </Section>

      <Section n="09" title="Where to win next" note="Impact on new patients against effort, from the gaps above. Top-left is the place to start.">
        <div className="grid2">
          <div className="chart">
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: -10 }}>
                <CartesianGrid stroke="var(--rule)" />
                <XAxis type="number" dataKey="effort" domain={[0, 6]} ticks={[1, 2, 3, 4, 5]} name="Effort" label={{ value: "Effort →", position: "insideBottom", offset: -10, fontSize: 11 }} tick={{ fontSize: 11 }} />
                <YAxis type="number" dataKey="impact" domain={[0, 6]} ticks={[1, 2, 3, 4, 5]} name="Impact" label={{ value: "Impact →", angle: -90, position: "insideLeft", offset: 20, fontSize: 11 }} tick={{ fontSize: 11 }} />
                <ZAxis range={[90, 90]} />
                <Tooltip cursor={false} content={({ payload }: any) => payload?.[0] ? <div className="tip"><strong>{payload[0].payload.title}</strong><br />{payload[0].payload.why}</div> : null} />
                <Scatter data={OPPS.map((o, i) => ({ ...o, effort: o.effort + ((i % 3) - 1) * 0.12, n: i + 1 }))} fill={C.gold}
                  shape={(p: any) => <g><circle cx={p.cx} cy={p.cy} r={11} fill={C.navy} /><text x={p.cx} y={p.cy + 4} textAnchor="middle" fontSize={11} fill="#fff">{p.payload.n}</text></g>} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <ol className="opp-list">{OPPS.map((o) => <li key={o.title}><strong>{o.title}</strong> <span className="muted small">· {o.cost}</span><br /><span className="small">{o.why}</span></li>)}</ol>
        </div>
      </Section>
    </Page>
  );
}

function StatusTag({ s }: { s: AuditItem["status"] }) {
  return s === "fixed" ? <Tag tone="good">Fixed</Tag> : s === "better" ? <Tag tone="info">Improved</Tag> : s === "worse" ? <Tag tone="bad">Worse</Tag> : <Tag tone="warn">Open</Tag>;
}

function AuditSummary({ live }: { live: Record<string, { status: AuditItem["status"] }> }) {
  const st = AUDIT.map((a) => (a.live && live[a.live]?.status) || a.status);
  const c = (k: AuditItem["status"]) => st.filter((s) => s === k).length;
  const total = st.length;
  const seg = [["fixed", c("fixed"), C.teal], ["better", c("better"), "#2F5F8F"], ["open", c("open"), C.gold], ["worse", c("worse"), C.rust]] as const;
  return (
    <div className="stackbar-wrap">
      <div className="stackbar">{seg.map(([k, n, col]) => n ? <i key={k} style={{ width: `${(n / total) * 100}%`, background: col }} title={`${k}: ${n}`} /> : null)}</div>
      <div className="legend-row">{seg.map(([k, n, col]) => <span key={k}><i className="sw" style={{ background: col }} />{k === "better" ? "Improved" : k[0].toUpperCase() + k.slice(1)} {n}</span>)}</div>
    </div>
  );
}

function AuditTimeline() {
  const ev = [
    { d: "18 Sep", t: "Pitch audit", s: "Site, ads, Maps, search, directories" },
    { d: "27 Sep", t: "Profile clean-up", s: "178 stuffed services removed, description rewritten" },
    { d: "29 Sep–2 Oct", t: "Website fixes", s: "H1s, meta, Dentist schema, titles" },
    { d: "7 Oct", t: "Tracking fixed", s: "Real conversion value, booking events" },
    { d: "1–17 Oct", t: "Search campaign", s: "680 clicks at ₹21 CPC" },
    { d: "21 Oct", t: "Clarity + site check", s: "Behaviour data starts" },
    { d: "24 Oct", t: "Re-audit", s: "Page one for both money terms" },
  ];
  return <ol className="timeline">{ev.map((e) => <li key={e.d}><b>{e.d}</b><strong>{e.t}</strong><span>{e.s}</span></li>)}</ol>;
}

function DensityRings() {
  const R = 150, cx = 170, cy = 170, k = R / 3;
  return (
    <div className="chart">
      <svg viewBox="0 0 340 340" className="rings" role="img" aria-label="Dental clinics within 1, 2 and 3 km of Elites">
        {[3, 2, 1].map((r) => <g key={r}><circle cx={cx} cy={cy} r={r * k} className={`ring r${r}`} /><text x={cx + 4} y={cy - r * k + 13} className="ring-l">{r} km</text></g>)}
        {DENSITY_POINTS.map((p) => {
          const a = ((p.bearing - 90) * Math.PI) / 180, x = cx + Math.cos(a) * p.km * k, y = cy + Math.sin(a) * p.km * k;
          return <circle key={p.name} cx={x} cy={y} r={4.2} className="dot"><title>{`${p.name} — ${p.km} km`}</title></circle>;
        })}
        <circle cx={cx} cy={cy} r={8} fill={C.gold} stroke="#fff" strokeWidth={2} />
        <text x={cx} y={cy + 24} textAnchor="middle" className="ring-me">Elites</text>
      </svg>
      <p className="small muted" style={{ margin: "0 10px" }}>Distances are real; directions are approximate, for readability.</p>
    </div>
  );
}

/** Turn the stored site check into "now" values for the audit table. */
function liveAudit(check: any): Record<string, { text: string; status: AuditItem["status"] }> {
  if (!check?.pages) return {};
  const pages = (check.pages as any[]).filter((p) => p.status === 200);
  const n = pages.length;
  if (!n) return {};
  const one = pages.filter((p) => p.h1_count === 1).length, none = pages.filter((p) => !p.h1_count).length;
  const meta = pages.filter((p) => p.meta_description).length;
  const schema = pages.filter((p) => p.has_local_business).length;
  const rating = pages.filter((p) => p.has_rating_schema).length;
  const faq = pages.filter((p) => (p.faq_items ?? 0) > 0).length;
  const date = check.checked_at ? new Date(check.checked_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
  return {
    h1: { text: `${n - none}/${n} pages have an H1; ${one} have exactly one (${date})`, status: none === 0 && one === n ? "fixed" : "better" },
    meta: { text: `${meta}/${n} pages (${date})`, status: meta === n ? "fixed" : meta > 0 ? "better" : "open" },
    schema: { text: `Dentist schema on ${schema}/${n} pages (${date})`, status: schema === n ? "fixed" : schema > 0 ? "better" : "open" },
    rating: { text: rating ? `${rating}/${n} pages` : `None (${date})`, status: rating ? "better" : "open" },
    faq: { text: faq ? `FAQ markup on ${faq}/${n} pages` : `No FAQ markup (${date})`, status: faq ? "better" : "open" },
    llms: { text: check.llms_txt?.status === 200 ? "Present" : `Missing — ${check.llms_txt?.status ?? "?"} (${date})`, status: check.llms_txt?.status === 200 ? "fixed" : "open" },
  };
}
