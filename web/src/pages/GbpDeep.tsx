import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DataTable, Kpi, KpiRow, Loading, Section } from "../components/ui";
import { useRpc } from "../state";
import { fmt } from "../lib/metrics";
import { C } from "./Overview";

/** A theme is a label plus a case-insensitive regex run against review text (Postgres ~*). */
export type Theme = { label: string; re: string };

type Rev = {
  google: { average_rating: number | null; total_reviews: number | null; date: string; error: string | null } | null;
  period: { n: number; avg: number | null; good: number; neutral: number; bad: number; replied: number; bad_unreplied: number; with_text: number; median_reply_h: number | null };
  prev: { n: number; avg: number | null; bad: number };
  all_time: { n: number; avg: number | null; first_at: string | null };
  stars: { star: number; n: number; all: number }[];
  monthly: { month: string; n: number; avg: number | null; good: number; neutral: number; bad: number; replied: number }[];
  weekday: { dow: number; n: number; avg: number | null }[];
  themes: { label: string; good: number; bad: number; all: number; avg: number | null }[];
};
type Row = { review_id: string; star: number; comment: string | null; created_at: string; reply: string | null; reply_at: string | null; total: number };

const ax = { fontSize: 11, fill: "#5C6F6A" };
const GOOD = "#2E8B57", MID = "#D9A441", BAD = "#C4473A";
const STAR_COLOR: Record<number, string> = { 5: "#2E8B57", 4: "#7FB77E", 3: "#D9A441", 2: "#E07B53", 1: "#C4473A" };
const DOW = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const mon = (m: string) => new Date(m + "-01T00:00:00").toLocaleString("en-IN", { month: "short", year: "2-digit" });
const day = (s: string) => new Date(s).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const hours = (h: number | null) => (h == null ? "—" : h < 48 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1)} days`);
const ratio = (a: number, b: number) => (b ? a / b : null);

export function ReviewsSection({ n, range, themes }: { n: string; range: { p_start: string; p_end: string }; themes: Theme[] }) {
  const r = useRpc<Rev>("rpc_gbp_reviews", { ...range, p_themes: themes });
  const d = r.data;
  if (r.loading && !d) return <Section n={n} title="Reviews"><Loading h={300} /></Section>;
  if (!d || !d.all_time?.n) return (
    <Section n={n} title="Reviews">
      <div className="empty">{d?.google?.error ? `Reviews could not be read: ${d.google.error}` : "No reviews imported yet. They refresh daily at 7:45 am."}</div>
    </Section>
  );
  const p = d.period, pv = d.prev, g = d.google;
  const monthly = d.monthly.map((m) => ({ ...m, label: mon(m.month), avg: m.avg == null ? null : Number(m.avg) }));
  const dist = d.stars.map((s) => ({ ...s, label: `${s.star}★`, share: ratio(s.n, p.n) ?? 0, shareAll: ratio(s.all, d.all_time.n) ?? 0 }));
  const week = d.weekday.map((w) => ({ ...w, label: DOW[w.dow], avg: w.avg == null ? null : Number(w.avg) }));
  const th = d.themes.filter((t) => t.all > 0).map((t) => ({ ...t, other: t.all - t.good - t.bad, avg: t.avg == null ? null : Number(t.avg) }))
    .sort((a, b) => b.all - a.all);
  return (
    <Section n={n} title="Reviews" note={<>Every Google review, refreshed daily. Good = 4–5★, bad = 1–2★. Period counts use the date the review was posted.{g?.date ? ` Google's headline figures as of ${day(g.date)}.` : ""} Reviewer names are not stored.</>}>
      <KpiRow>
        <Kpi logo="gbp" big label="Google rating" value={g?.average_rating ?? d.all_time.avg} format="dec" sub={`${fmt.int(g?.total_reviews ?? d.all_time.n)} reviews in total`} />
        <Kpi logo="gbp" big label="New reviews" value={p.n} prev={pv.n} sub={p.avg != null ? `averaging ${Number(p.avg).toFixed(2)}★ (before: ${pv.avg != null ? Number(pv.avg).toFixed(2) + "★" : "—"})` : undefined} />
        <Kpi logo="gbp" big label="Good (4–5★)" value={ratio(p.good, p.n)} format="pct" sub={`${fmt.int(p.good)} good · ${fmt.int(p.neutral)} neutral`} />
        <Kpi logo="gbp" big label="Bad (1–2★)" value={p.bad} prev={pv.bad} invert sub={`${fmt.pct(ratio(p.bad, p.n))} of new reviews`} />
      </KpiRow>
      <KpiRow>
        <Kpi label="Reply rate" value={ratio(p.replied, p.n)} format="pct" sub={`${fmt.int(p.replied)} of ${fmt.int(p.n)} answered`} />
        <Kpi label="Typical reply time (days)" value={p.median_reply_h == null ? null : p.median_reply_h / 24} format="dec" sub="median, for reviews that got a reply" />
        <Kpi label="Bad reviews with no reply" value={p.bad_unreplied} invert sub="listed below" />
        <Kpi label="Reviews with written text" value={ratio(p.with_text, p.n)} format="pct" sub={`${fmt.int(p.with_text)} reviews`} />
      </KpiRow>

      <div className="grid2">
        <div className="chart-card">
          <div className="chart-title">Star split: this period vs all time</div>
          <div className="gbpx-dist">
            {dist.map((s) => (
              <div key={s.star} className="gbpx-dist-row">
                <span className="gbpx-dist-lbl" style={{ color: STAR_COLOR[s.star] }}>{s.star}★</span>
                <div className="gbpx-dist-bars">
                  <div className="gbpx-bar" style={{ width: `${Math.max(s.share * 100, s.n ? 1.5 : 0)}%`, background: STAR_COLOR[s.star] }} title={`${s.n} this period`} />
                  <div className="gbpx-bar ghost" style={{ width: `${Math.max(s.shareAll * 100, 0.5)}%` }} title={`${s.all} all time`} />
                </div>
                <span className="gbpx-dist-n">{fmt.int(s.n)}<small> · {fmt.pct(s.share, 0)}</small></span>
                <span className="gbpx-dist-all">{fmt.int(s.all)}<small> · {fmt.pct(s.shareAll, 0)}</small></span>
              </div>
            ))}
            <div className="gbpx-dist-key"><span><i style={{ background: "#2E8B57" }} />This period</span><span><i className="ghost" />All time ({fmt.int(d.all_time.n)} since {d.all_time.first_at ? new Date(d.all_time.first_at).getFullYear() : "—"})</span></div>
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-title">Reviews per month, last 18 months, with average rating</div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={monthly} margin={{ top: 8, right: 4, left: -14, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#E4ECEA" />
              <XAxis dataKey="label" tick={ax} interval="preserveStartEnd" minTickGap={14} />
              <YAxis yAxisId="l" tick={ax} allowDecimals={false} />
              <YAxis yAxisId="r" orientation="right" tick={ax} domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} />
              <Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="l" dataKey="good" name="Good 4–5★" stackId="m" fill={GOOD} />
              <Bar yAxisId="l" dataKey="neutral" name="Neutral 3★" stackId="m" fill={MID} />
              <Bar yAxisId="l" dataKey="bad" name="Bad 1–2★" stackId="m" fill={BAD} radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" dataKey="avg" name="Avg ★" stroke={C.navy} strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid2">
        <div className="chart-card">
          <div className="chart-title">What reviews talk about (mentions in this period)</div>
          {th.length ? (
            <ResponsiveContainer width="100%" height={Math.max(200, th.length * 34)}>
              <BarChart data={th} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="#E4ECEA" />
                <XAxis type="number" tick={ax} allowDecimals={false} /><YAxis type="category" dataKey="label" tick={ax} width={110} />
                <Tooltip formatter={(v: any, name: any) => [v, name]} labelFormatter={(l: any) => { const t = th.find((x) => x.label === l); return `${l}${t?.avg != null ? ` · avg ${t.avg.toFixed(2)}★` : ""}`; }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="good" name="In good reviews" stackId="t" fill={GOOD} />
                <Bar dataKey="other" name="In 3★" stackId="t" fill={MID} />
                <Bar dataKey="bad" name="In bad reviews" stackId="t" fill={BAD} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="empty">No written reviews in this period mention the tracked topics.</div>}
          <p className="small muted">Matched on keywords in the review text. A review can mention several topics.</p>
        </div>
        <div className="chart-card">
          <div className="chart-title">Day of week: reviews and average rating</div>
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={week} margin={{ top: 8, right: 4, left: -14, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#E4ECEA" />
              <XAxis dataKey="label" tick={ax} /><YAxis yAxisId="l" tick={ax} allowDecimals={false} />
              <YAxis yAxisId="r" orientation="right" tick={ax} domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} />
              <Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="l" dataKey="n" name="Reviews" fill="#9FD3C7" radius={[3, 3, 0, 0]}>
                {week.map((w) => <Cell key={w.dow} fill={w.avg != null && w.avg < 3.5 ? "#F2B8A8" : "#9FD3C7"} />)}
              </Bar>
              <Line yAxisId="r" dataKey="avg" name="Avg ★" stroke={C.navy} strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="small muted">Days shaded red average under 3.5★.</p>
        </div>
      </div>

      <ReviewExplorer range={range} badUnreplied={p.bad_unreplied} />
    </Section>
  );
}

function ReviewExplorer({ range, badUnreplied }: { range: { p_start: string; p_end: string }; badUnreplied: number }) {
  const [view, setView] = useState<"todo" | "all" | "bad" | "good">(badUnreplied > 0 ? "todo" : "all");
  const [replied, setReplied] = useState<"any" | "yes" | "no">("any");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(25);
  const starsFor = view === "bad" || view === "todo" ? [1, 2] : view === "good" ? [4, 5] : null;
  const rep = view === "todo" ? false : replied === "any" ? null : replied === "yes";
  const list = useRpc<Row[]>("rpc_gbp_review_list", { ...range, p_stars: starsFor, p_replied: rep, p_q: q.trim() || null, p_limit: limit, p_offset: 0 });
  const rows = list.data ?? [];
  const total = rows[0]?.total ?? 0;
  return (
    <div className="gbpx-explorer">
      <div className="gbpx-explorer-head">
        <div className="chart-title" style={{ margin: 0 }}>Read the reviews</div>
        <div className="seg sm">
          {([["todo", `Bad, no reply (${badUnreplied})`], ["bad", "Bad 1–2★"], ["good", "Good 4–5★"], ["all", "All"]] as const).map(([k, l]) => (
            <button key={k} className={view === k ? "on" : ""} onClick={() => { setView(k); setLimit(25); }}>{l}</button>
          ))}
        </div>
        {view !== "todo" && <div className="seg sm">
          {([["any", "Any"], ["no", "Not replied"], ["yes", "Replied"]] as const).map(([k, l]) => (
            <button key={k} className={replied === k ? "on" : ""} onClick={() => setReplied(k)}>{l}</button>
          ))}
        </div>}
        <input className="gbpx-search" type="search" placeholder="Search the text…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(25); }} aria-label="Search review text" />
      </div>
      {list.loading && !list.data ? <Loading h={160} /> : rows.length === 0 ? <div className="empty">No reviews match.</div> : (
        <>
          <p className="small muted" style={{ margin: "4px 0 10px" }}>{fmt.int(total)} review{total === 1 ? "" : "s"} · newest first</p>
          <div className="gbpx-list">
            {rows.map((r) => (
              <article key={r.review_id} className={`gbpx-rev s${r.star}`}>
                <header>
                  <span className="gbpx-stars" aria-label={`${r.star} stars`}><b style={{ color: STAR_COLOR[r.star] }}>{"★".repeat(r.star)}</b><i>{"★".repeat(5 - r.star)}</i></span>
                  <span className="muted small">{day(r.created_at)}</span>
                  {r.reply ? <span className="tag tag-good">Replied {r.reply_at ? `in ${hours((new Date(r.reply_at).getTime() - new Date(r.created_at).getTime()) / 36e5)}` : ""}</span>
                    : <span className={`tag ${r.star <= 2 ? "tag-bad" : ""}`}>No reply</span>}
                </header>
                <p className={r.comment ? "" : "muted"}>{r.comment ?? "Rating only, no text."}</p>
                {r.reply && <blockquote>{r.reply}</blockquote>}
              </article>
            ))}
          </div>
          {total > rows.length && <button className="btn ghost sm" onClick={() => setLimit((l) => Math.min(l + 50, 500))}>Show more ({fmt.int(total - rows.length)} left)</button>}
        </>
      )}
    </div>
  );
}

type Kw = { rows: { keyword: string; impressions: number | null; months: number; thresholded: number; last_m: number | null; prev_m: number | null }[]; monthly: { month: string; impressions: number | null; terms: number }[]; last_month: string | null; fallback?: boolean };

export function KeywordsSection({ n, range, brand, groups }: { n: string; range: { p_start: string; p_end: string }; brand: RegExp; groups: { label: string; re: RegExp }[] }) {
  const k = useRpc<Kw>("rpc_gbp_keywords", range);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | "brand" | "generic">("all");
  const d = k.data;
  const rows = useMemo(() => (d?.rows ?? []).map((r) => ({ ...r, branded: brand.test(r.keyword), group: brand.test(r.keyword) ? "Searched the name" : groups.find((g) => g.re.test(r.keyword))?.label ?? "Other",
    chg: r.last_m != null && r.prev_m ? r.last_m / r.prev_m - 1 : null })), [d, brand, groups]);
  const shown = rows.filter((r) => (kind === "all" || (kind === "brand") === r.branded) && (!q || r.keyword.toLowerCase().includes(q.toLowerCase())));
  const sum = (xs: typeof rows) => xs.reduce((s, r) => s + (r.impressions ?? 0), 0);
  const brandImp = sum(rows.filter((r) => r.branded)), allImp = sum(rows);
  const byGroup = groups.map((g) => ({ label: g.label, impressions: sum(rows.filter((r) => r.group === g.label)), terms: rows.filter((r) => r.group === g.label).length }))
    .concat(["Searched the name", "Other"].map((l) => ({ label: l, impressions: sum(rows.filter((r) => r.group === l)), terms: rows.filter((r) => r.group === l).length })))
    .filter((g) => g.impressions > 0).sort((a, b) => b.impressions - a.impressions);
  const top = rows.filter((r) => r.impressions != null && !r.branded).slice(0, 12).map((r) => ({ name: r.keyword.length > 26 ? r.keyword.slice(0, 25) + "…" : r.keyword, full: r.keyword, v: r.impressions! }));
  const monthly = (d?.monthly ?? []).map((m) => ({ ...m, label: mon(m.month) }));

  if (k.loading && !d) return <Section n={n} title="Search terms"><Loading h={260} /></Section>;
  if (!rows.length) return <Section n={n} title="Search terms"><div className="empty">No search-term data for these months yet. Google publishes a month's terms after it ends.</div></Section>;
  return (
    <Section n={n} title="Search terms that showed the profile" note={<>Monthly, from Google. {d?.fallback ? <b>Google hasn't published this period's terms yet, so this shows {d.last_month ? mon(d.last_month) : "the latest month"}, the latest full month.</b> : <>Months that overlap the selected dates{d?.last_month ? ` (latest: ${mon(d.last_month)})` : ""}.</>} Terms below Google's privacy threshold come back without a number and are counted separately, never guessed.</>}>
      <KpiRow>
        <Kpi logo="gbp" big label="Search impressions" value={allImp} format="compact" sub={`${fmt.int(rows.length)} distinct terms`} />
        <Kpi logo="gbp" big label="Searched the name" value={ratio(brandImp, allImp)} format="pct" sub={`${fmt.compact(brandImp)} branded impressions`} />
        <Kpi logo="gbp" big label="Found by category" value={ratio(allImp - brandImp, allImp)} format="pct" sub="people who didn't type the name" />
        <Kpi label="Terms under threshold" value={rows.filter((r) => r.impressions == null).length} sub="too few searches to report" />
      </KpiRow>
      <div className="grid2">
        <div className="chart-card">
          <div className="chart-title">Top non-branded searches</div>
          <ResponsiveContainer width="100%" height={40 + top.length * 30}>
            <BarChart data={top} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke="#E4ECEA" />
              <XAxis type="number" tick={ax} tickFormatter={(v) => fmt.compact(v)} /><YAxis type="category" dataKey="name" tick={ax} width={170} interval={0} />
              <Tooltip formatter={(v: any) => fmt.int(Number(v))} labelFormatter={(_l: any, pl: any) => pl?.[0]?.payload?.full ?? _l} />
              <Bar dataKey="v" name="Impressions" fill={C.teal} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div className="chart-card">
            <div className="chart-title">Impressions by search theme</div>
            <ResponsiveContainer width="100%" height={Math.max(160, byGroup.length * 30)}>
              <BarChart data={byGroup} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="#E4ECEA" />
                <XAxis type="number" tick={ax} tickFormatter={(v) => fmt.compact(v)} /><YAxis type="category" dataKey="label" tick={ax} width={120} />
                <Tooltip formatter={(v: any) => fmt.int(Number(v))} />
                <Bar dataKey="impressions" name="Impressions" fill={C.navy} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {monthly.length > 1 && <div className="chart-card">
            <div className="chart-title">Search impressions by month</div>
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={monthly} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#E4ECEA" />
                <XAxis dataKey="label" tick={ax} /><YAxis tick={ax} tickFormatter={(v) => fmt.compact(v)} />
                <Tooltip formatter={(v: any) => fmt.int(Number(v))} />
                <Bar dataKey="impressions" name="Impressions" fill={C.gold} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>}
        </div>
      </div>
      <div className="gbpx-explorer-head">
        <div className="seg sm">
          {([["all", "All terms"], ["generic", "Non-branded"], ["brand", "Branded"]] as const).map(([kk, l]) => (
            <button key={kk} className={kind === kk ? "on" : ""} onClick={() => setKind(kk)}>{l}</button>
          ))}
        </div>
        <input className="gbpx-search" type="search" placeholder="Filter terms…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter search terms" />
      </div>
      <DataTable rows={shown} csvName="gbp-search-terms" limit={25} initialSort={{ key: "impressions", dir: -1 }} cols={[
        { key: "keyword", label: "Search term" },
        { key: "group", label: "Theme", render: (r) => <span className="tag">{r.group}</span> },
        { key: "branded", label: "Type", render: (r) => (r.branded ? <span className="tag tag-info">Branded</span> : <span className="tag">Category</span>), value: (r) => (r.branded ? 1 : 0) },
        { key: "impressions", label: "Impressions", align: "right", format: "int" },
        { key: "last_m", label: d?.last_month ? mon(d.last_month) : "Latest month", align: "right", format: "int" },
        { key: "chg", label: "vs month before", align: "right", render: (r) => (r.chg == null ? "—" : <span style={{ color: r.chg >= 0 ? GOOD : BAD }}>{fmt.delta(r.chg)}</span>), value: (r) => r.chg },
        { key: "thresholded", label: "Months under threshold", align: "right", format: "int" },
      ]} />
    </Section>
  );
}
