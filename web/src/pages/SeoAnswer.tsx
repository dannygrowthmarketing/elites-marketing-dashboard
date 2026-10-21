// AEO (answer engines: featured answers, People Also Ask, voice) and GEO (AI assistants: ChatGPT, Perplexity,
// Gemini, Copilot, Google AI Overviews). Everything shown is measured; gaps are named, not estimated.
import { useMemo, useState, type ReactNode } from "react";
import { DataTable, ErrorBox, Kpi, KpiRow, Loading, Page, Section, Tag, useRangeArgs } from "../components/ui";
import { useFilters, useRpc, useTable } from "../state";
import { callFunction } from "../lib/supabase";
import { fmt, ratio } from "../lib/metrics";
import { totals, useSeries } from "./Overview";

const when = (s?: string | null) => (s ? new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");

/** Question-style or evaluative searches — the ones answer engines try to answer directly. */
export function intentOf(q: string): string | null {
  const s = q.toLowerCase();
  if (/\?|^(how|what|why|when|which|who|where|can|is|are|does|do|should|will)\b/.test(s)) return "Question";
  if (/\b(cost|price|prices|fees|fee|charges|charge|rate|rates|emi|insurance)\b/.test(s)) return "Cost";
  if (/\b(best|top|good|vs|versus|review|reviews|rated)\b/.test(s)) return "Best / compare";
  if (/\b(pain|painful|safe|side effects?|recovery|how long|duration|time|after|before|aftercare|procedure)\b/.test(s)) return "Concern";
  return null;
}

export const AI_SOURCES: { re: RegExp; name: string }[] = [
  { re: /chatgpt|openai/i, name: "ChatGPT" }, { re: /perplexity/i, name: "Perplexity" }, { re: /gemini|bard\.google/i, name: "Gemini" },
  { re: /copilot|bing\.com\/chat|edgeservices/i, name: "Microsoft Copilot" }, { re: /claude|anthropic/i, name: "Claude" },
  { re: /meta\.ai/i, name: "Meta AI" }, { re: /deepseek/i, name: "DeepSeek" }, { re: /grok|x\.ai/i, name: "Grok" },
  { re: /you\.com|phind|poe\.com|mistral|kagi/i, name: "Other AI" },
];
export const aiName = (src: string) => AI_SOURCES.find((a) => a.re.test(src))?.name ?? null;

function useSiteCheck() {
  return useTable<any>("settings", (q) => q.select("value").eq("key", "site_check"));
}

function SiteCheckBar({ check, onRun, canEdit }: { check: any; onRun: () => void; canEdit: boolean }) {
  return (
    <div className="card row sitecheck-bar">
      <div><strong>Live site check</strong>
        <div className="small muted">{check ? <>Last read {when(check.checked_at)} · {check.pages?.length ?? 0} pages of {check.site}</> : "Not run yet"}</div></div>
      {canEdit && <button className="btn ghost" onClick={onRun}>Re-check site now</button>}
    </div>
  );
}

function useRunCheck() {
  const f = useFilters();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setBusy(true); setMsg("Reading the site — takes about 20 seconds…");
    try { const r = await callFunction<any>("site-check", {}); setMsg(`Checked ${r.pages} pages.`); f.refresh(); }
    catch (e: any) { setMsg(e.message); }
    setBusy(false);
  }
  return { run, busy, msg };
}

const Yes = ({ ok, children }: { ok: boolean | null; children?: ReactNode }) =>
  <Tag tone={ok == null ? "neutral" : ok ? "good" : "bad"}>{children ?? (ok == null ? "n/a" : ok ? "yes" : "no")}</Tag>;

// ---------------- AEO ----------------
export function Aeo({ tabs }: { tabs: ReactNode }) {
  const f = useFilters();
  const canEdit = f.role === "owner" || f.role === "editor";
  const { cmp } = useRangeArgs();
  const queries = useRpc<any[]>("rpc_gsc_queries", { ...cmp, p_limit: 5000 });
  const appearance = useTable<any>("gsc_daily_appearance", (q) => q.select("appearance,clicks,impressions,date").gte("date", f.range.start).lte("date", f.range.end), [f.range.start, f.range.end]);
  const sc = useSiteCheck();
  const check = sc.data?.[0]?.value;
  const { run, busy, msg } = useRunCheck();

  const qs = useMemo(() => (queries.data ?? []).map((r) => ({ ...r, clicks: +r.clicks, impressions: +r.impressions, avg_position: r.avg_position == null ? null : +r.avg_position, intent: intentOf(r.query) }))
    .filter((r) => r.intent && !r.is_branded), [queries.data]);
  const allImpr = (queries.data ?? []).reduce((s, r) => s + +r.impressions, 0);
  const qImpr = qs.reduce((s, r) => s + r.impressions, 0), qClicks = qs.reduce((s, r) => s + r.clicks, 0);
  const byIntent = useMemo(() => ["Question", "Cost", "Best / compare", "Concern"].map((k) => {
    const xs = qs.filter((r) => r.intent === k);
    return { intent: k, queries: xs.length, impressions: xs.reduce((s, r) => s + r.impressions, 0), clicks: xs.reduce((s, r) => s + r.clicks, 0) };
  }), [qs]);
  const app = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of appearance.data ?? []) { const a = m.get(r.appearance) ?? { appearance: r.appearance, clicks: 0, impressions: 0 }; a.clicks += r.clicks; a.impressions += r.impressions; m.set(r.appearance, a); }
    return [...m.values()];
  }, [appearance.data]);

  const pages: any[] = check?.pages ?? [];
  const svc = pages.filter((p) => p.status === 200 && !["/", "/contact-us/", "/appointment-form/", "/about-us/"].includes(p.path));
  const share = (xs: any[], fn: (p: any) => boolean) => (xs.length ? xs.filter(fn).length / xs.length : null);
  const checks = check ? [
    { item: "Clinic described as a Dentist / LocalBusiness in structured data", why: "Lets answer engines state the clinic's name, address, hours and phone with confidence", v: share(pages.filter((p) => p.status === 200), (p) => p.has_local_business) },
    { item: "FAQ structured data on service pages", why: "Marks up the FAQs already written on each service page so they can be quoted as answers", v: share(svc, (p) => p.faq_items > 0) },
    { item: "Question-style headings on service pages", why: "“How long does a root canal take?” headings match how people ask", v: share(svc, (p) => p.question_headings >= 3) },
    { item: "One clear H1 per page", why: "Tells engines what the page answers", v: share(pages.filter((p) => p.status === 200), (p) => p.h1_count === 1) },
    { item: "Meta description present", why: "Often used as the answer snippet", v: share(pages.filter((p) => p.status === 200), (p) => !!p.meta_description) },
    { item: "Star rating in structured data", why: "Shows the 4.9★ rating in results", v: share(pages.filter((p) => p.status === 200), (p) => p.has_rating_schema) },
  ] : [];

  return (
    <Page eyebrow="Organic" title="Answer engine optimisation (AEO)"
      intro="Getting the clinic chosen as the direct answer — Google's featured snippets and People Also Ask, voice assistants and quick answers. Measured from Search Console and a live read of the site.">
      {tabs}
      <Section n="01" title="Is the site ready to be quoted?">
        <SiteCheckBar check={check} onRun={run} canEdit={canEdit} />
        {msg && <div className="notice">{busy ? "⏳ " : ""}{msg}</div>}
        {sc.loading ? <Loading /> : !check ? <p className="muted">No site check yet{canEdit ? " — use “Re-check site now”." : "."}</p> : (
          <DataTable rows={checks} cols={[
            { key: "item", label: "Check", render: (r: any) => <><strong>{r.item}</strong><div className="small muted">{r.why}</div></> },
            { key: "v", label: "Pages passing", align: "right", render: (r: any) => <Tag tone={r.v == null ? "neutral" : r.v >= 0.8 ? "good" : r.v > 0 ? "warn" : "bad"}>{r.v == null ? "n/a" : fmt.pct(r.v, 0)}</Tag>, value: (r: any) => r.v },
          ]} />
        )}
        {check && pages.some((p) => p.status !== 200) && (
          <p className="warnline">Google still shows {pages.filter((p) => p.status !== 200).map((p) => `${p.path} (${p.status || "no response"})`).join(", ")} — these no longer load. Redirect them to the right page.</p>
        )}
      </Section>

      <Section n="02" title="Question and comparison searches" note="Non-brand searches phrased as a question, about cost, “best…”, or a worry (pain, safety, recovery). These are what answer engines respond to directly.">
        {!queries.data ? <Loading /> : (
          <>
            <KpiRow>
              <Kpi label="Searches of this kind" value={qs.length} />
              <Kpi label="Impressions" value={qImpr} sub={allImpr ? `${fmt.pct(ratio(qImpr, allImpr))} of all impressions` : undefined} />
              <Kpi label="Clicks" value={qClicks} />
              <Kpi label="Click-through" value={ratio(qClicks, qImpr)} format="pct" />
            </KpiRow>
            <DataTable rows={byIntent} cols={[
              { key: "intent", label: "Kind" }, { key: "queries", label: "Searches", align: "right", format: "int" },
              { key: "impressions", label: "Impressions", align: "right", format: "int" }, { key: "clicks", label: "Clicks", align: "right", format: "int" },
            ]} />
            <h3 className="sub">The searches</h3>
            <DataTable rows={qs} csvName="aeo-question-searches" initialSort={{ key: "impressions", dir: -1 }} empty="No question-style searches in this period." cols={[
              { key: "query", label: "Search" }, { key: "intent", label: "Kind" },
              { key: "impressions", label: "Impressions", align: "right", format: "int" }, { key: "clicks", label: "Clicks", align: "right", format: "int" },
              { key: "avg_position", label: "Avg position", align: "right", format: "dec" },
              { key: "top_page", label: "Page Google shows", render: (r: any) => <span className="small">{r.top_page ? new URL(r.top_page).pathname : "—"}</span> },
            ]} />
            {qs.length > 0 && qClicks === 0 && <p className="warnline">These searches show the site but get no clicks yet. Clear question headings with short answers, plus FAQ markup, are what turn them into clicks and quoted answers.</p>}
          </>
        )}
      </Section>

      <Section n="03" title="How the site appears in Google" note="Search Console's search-appearance report: rich results, FAQ, review snippets and similar.">
        {!appearance.data ? <Loading /> : app.length === 0
          ? <p className="muted">No rich results recorded for the site in this period. Google shows these only when structured data is present and valid — see the checks in section 01.</p>
          : <DataTable rows={app} cols={[{ key: "appearance", label: "Appearance" }, { key: "impressions", label: "Impressions", align: "right", format: "int" }, { key: "clicks", label: "Clicks", align: "right", format: "int" }]} />}
      </Section>

      <Section n="04" title="Page by page">
        {!check ? <p className="muted">Run the site check first.</p> : (
          <DataTable rows={pages} csvName="aeo-site-check" limit={20} cols={[
            { key: "path", label: "Page" },
            { key: "status", label: "HTTP", align: "right" },
            { key: "h1_count", label: "H1s", align: "right" },
            { key: "meta", label: "Meta desc.", render: (p: any) => <Yes ok={!!p.meta_description} />, value: (p: any) => !!p.meta_description },
            { key: "question_headings", label: "Question headings", align: "right" },
            { key: "faq_items", label: "FAQ markup", align: "right" },
            { key: "schema", label: "Structured data", render: (p: any) => <span className="small">{(p.schema_types ?? []).filter((t: string) => !/^(ImageObject|ListItem|SearchAction|EntryPoint|ReadAction|PropertyValueSpecification)$/.test(t)).join(", ") || "none"}</span>,
              value: (p: any) => (p.schema_types ?? []).join(" ") },
            { key: "words", label: "Words", align: "right", format: "int" },
          ]} />
        )}
      </Section>
    </Page>
  );
}

// ---------------- GEO ----------------
export function Geo({ tabs }: { tabs: ReactNode }) {
  const f = useFilters();
  const canEdit = f.role === "owner" || f.role === "editor";
  const { cur } = useSeries();
  const t = totals(cur.data);
  const ai = useTable<any>("ga4_daily_traffic", (q) => q.select("date,source,medium,sessions,engaged_sessions,key_events")
    .gte("date", f.range.start).lte("date", f.range.end)
    .or(["chatgpt", "openai", "perplexity", "gemini", "bard", "copilot", "claude", "anthropic", "meta.ai", "deepseek", "grok", "you.com", "phind", "poe.com", "mistral", "kagi"].map((s) => `source.ilike.%${s}%`).join(",")),
    [f.range.start, f.range.end]);
  const allTime = useTable<any>("ga4_daily_traffic", (q) => q.select("date,source,sessions")
    .or(["chatgpt", "openai", "perplexity", "gemini", "bard", "copilot", "claude", "anthropic", "meta.ai", "deepseek", "grok", "you.com", "phind", "poe.com", "mistral", "kagi"].map((s) => `source.ilike.%${s}%`).join(",")));
  const sc = useSiteCheck();
  const check = sc.data?.[0]?.value;
  const { run, busy, msg } = useRunCheck();

  const rows = (ai.data ?? []).map((r) => ({ ...r, assistant: aiName(r.source) })).filter((r) => r.assistant);
  const sessions = rows.reduce((s, r) => s + r.sessions, 0);
  const byAssistant = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of rows) { const a = m.get(r.assistant) ?? { assistant: r.assistant, sessions: 0, engaged: 0, sources: new Set<string>(), last: r.date }; a.sessions += r.sessions; a.engaged += r.engaged_sessions; a.sources.add(r.source); if (r.date > a.last) a.last = r.date; m.set(r.assistant, a); }
    return [...m.values()].map((a) => ({ ...a, sources: [...a.sources].join(", ") }));
  }, [ai.data]);
  const everAi = (allTime.data ?? []).filter((r) => aiName(r.source));
  const firstAi = everAi.map((r) => r.date).sort()[0];

  const locs = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of check?.pages ?? []) for (const [k, v] of Object.entries(p.localities ?? {})) m.set(k, (m.get(k) ?? 0) + (v as number));
    return [...m.entries()].map(([name, mentions]) => ({ name, mentions })).sort((a, b) => b.mentions - a.mentions);
  }, [check]);
  const schemaAddr = (check?.pages ?? []).map((p: any) => p.schema_address).find(Boolean);
  const blocked = (check?.robots?.bots ?? []).filter((b: any) => b.verdict === "blocked");

  return (
    <Page eyebrow="Organic" title="Generative engine optimisation (GEO)"
      intro="Being recommended inside AI answers — ChatGPT, Perplexity, Gemini, Copilot and Google's AI Overviews. Visits are measured in GA4; readiness is read from the live site.">
      {tabs}
      <Section n="01" title="Visits from AI assistants" note="GA4 sessions whose source is an AI assistant. Many AI answers send no click at all, so this undercounts AI visibility — treat it as a floor.">
        {ai.error ? <ErrorBox msg={ai.error} /> : !ai.data ? <Loading /> : (
          <>
            <KpiRow>
              <Kpi big label="AI-assistant sessions" value={sessions} />
              <Kpi label="Share of all sessions" value={ratio(sessions, t.ga4_sessions)} format="pct" />
              <Kpi label="Assistants sending visits" value={byAssistant.length} />
              <Kpi label="AI sessions, all time" value={everAi.reduce((s, r) => s + r.sessions, 0)} sub={firstAi ? `first on ${new Date(firstAi + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : "none yet"} />
            </KpiRow>
            <DataTable rows={byAssistant} empty="No visits from AI assistants in this period." cols={[
              { key: "assistant", label: "Assistant" }, { key: "sessions", label: "Sessions", align: "right", format: "int" },
              { key: "engaged", label: "Engaged", align: "right", format: "int" }, { key: "sources", label: "GA4 source" }, { key: "last", label: "Last visit" },
            ]} />
          </>
        )}
      </Section>

      <Section n="02" title="Can AI crawlers read the site?" note="From the site's robots.txt. “Not mentioned” means the general rules apply — normally allowed.">
        <SiteCheckBar check={check} onRun={run} canEdit={canEdit} />
        {msg && <div className="notice">{busy ? "⏳ " : ""}{msg}</div>}
        {!check ? <p className="muted">Run the site check first.</p> : (
          <>
            {blocked.length > 0 && <p className="warnline">{blocked.map((b: any) => b.ua).join(", ")} {blocked.length === 1 ? "is" : "are"} blocked — {blocked.length === 1 ? "that assistant" : "those assistants"} can't read or cite the site.</p>}
            <DataTable rows={check.robots?.bots ?? []} cols={[
              { key: "ua", label: "Crawler" }, { key: "owner", label: "Used by" },
              { key: "verdict", label: "Access", render: (b: any) => <Tag tone={b.verdict === "blocked" ? "bad" : b.verdict === "allowed" ? "good" : "neutral"}>{b.verdict}</Tag> },
            ]} />
            <table className="kvtable"><tbody>
              <tr><th>llms.txt (a plain-language site summary for AI tools)</th><td><Yes ok={check.llms_txt?.status === 200}>{check.llms_txt?.status === 200 ? "present" : "missing"}</Yes></td></tr>
              <tr><th>Sitemap</th><td><Yes ok={check.sitemap?.status === 200}>{check.sitemap?.status === 200 ? `${check.sitemap.urls} entries` : "not found"}</Yes>{check.robots?.sitemap_declared ? <span className="small muted"> · declared in robots.txt</span> : null}</td></tr>
            </tbody></table>
          </>
        )}
      </Section>

      <Section n="03" title="Does the clinic come across as one clear entity?" note="AI answers lean on consistent facts. Mixed locality names make it harder for an assistant to say where the clinic is.">
        {!check ? <p className="muted">Run the site check first.</p> : (
          <>
            <table className="kvtable"><tbody>
              <tr><th>Address in structured data</th><td>{schemaAddr ?? <Tag tone="bad">none on any page checked</Tag>}</td></tr>
              <tr><th>Clinic marked up as a Dentist / LocalBusiness</th><td><Yes ok={(check.pages ?? []).some((p: any) => p.has_local_business)} /></td></tr>
            </tbody></table>
            <h3 className="sub">Locality names used on the site</h3>
            <DataTable rows={locs} empty="None of the tracked locality names appear on the pages checked." cols={[
              { key: "name", label: "Name" }, { key: "mentions", label: "Mentions", align: "right", format: "int" },
            ]} />
            <p className="small muted">For reference, Google Business Profile lists the clinic in Sannatammanahalli, and Justdial lists it in Manjunatha Layout.</p>
          </>
        )}
      </Section>

      <Section n="04" title="Not measured yet">
        <div className="card">
          <p><strong>Whether AI answers mention the clinic.</strong> No source reports this automatically. Search Console doesn't separate Google's AI Overviews, and the assistants don't publish mention data.</p>
          <p className="small muted">It can be tracked by asking the same fixed questions each month (for example “best dentist in TC Palya”, “kids dentist near KR Puram”) in ChatGPT, Perplexity and Gemini, and logging whether the clinic is named. Automating that needs paid API access, so it's left for a later step.</p>
        </div>
      </Section>
    </Page>
  );
}
