import { useMemo, useState } from "react";
import { DataTable, Drawer, ErrorBox, Kpi, KpiRow, Loading, Page, Section, Tag } from "../components/ui";
import { useFilters, useTable } from "../state";
import { supabase } from "../lib/supabase";
import { fmt } from "../lib/metrics";

const TYPES = ["School / preschool", "Workplace", "College", "Diagnostics & doctors", "Fitness & wellness", "Pharmacy"];
const STATUS: Record<string, { label: string; tone: any }> = {
  new: { label: "New", tone: "info" }, reviewing: { label: "Reviewing", tone: "neutral" }, shortlisted: { label: "Shortlisted", tone: "good" },
  not_a_fit: { label: "Not a fit", tone: "bad" }, partnered: { label: "Partnered", tone: "good" },
};
const when = (s?: string | null) => (s ? new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");
const secs = (a?: string, b?: string) => (a && b ? `${Math.max(0, Math.round((+new Date(b) - +new Date(a)) / 1000))}s` : "—");

export default function Partnerships() {
  const f = useFilters();
  const canEdit = f.role === "owner" || f.role === "editor";
  const opps = useTable<any>("partner_opportunities", (q) => q.select("*").order("score", { ascending: false }).limit(2000));
  const runs = useTable<any>("partner_runs", (q) => q.select("*").order("started_at", { ascending: false }).limit(50));
  const sources = useTable<any>("partner_sources", (q) => q.select("*").order("status"));
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("open");
  const [minScore, setMinScore] = useState(0);
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const all = opps.data ?? [];
  const active = all.filter((o) => o.active);
  const rows = useMemo(() => all.filter((o) =>
    (showInactive || o.active) && (type === "all" || o.partner_type === type) && o.score >= minScore &&
    (status === "all" || (status === "open" ? !["not_a_fit"].includes(o.status) : o.status === status))), [opps.data, type, status, minScore, showInactive]);
  const byType = useMemo(() => TYPES.map((t) => {
    const xs = active.filter((o) => o.partner_type === t);
    return { type: t, n: xs.length, top: xs.filter((o) => o.score >= 70).length, avg: xs.length ? xs.reduce((s, o) => s + o.score, 0) / xs.length : null };
  }), [opps.data]);
  const last = runs.data?.[0];
  const lastOk = runs.data?.find((r) => r.status === "success");
  const src = sources.data?.find((s) => s.key === "overture_places");
  const missing = [opps.error, runs.error].find((e) => e && /partner_/.test(e));
  const sel = all.find((o) => o.id === open);
  const selRun = runs.data?.find((r) => r.id === runOpen);

  async function rescore() {
    setMsg(null);
    const { data, error } = await supabase.rpc("rpc_partner_rescore");
    setMsg(error ? error.message : `Scoring re-applied to ${fmt.int(data)} opportunities.`); f.refresh();
  }

  return (
    <Page eyebrow="Growth" title="Partnerships"
      intro="Local businesses the clinic could team up with — schools, workplaces, gyms, pharmacies, labs. Found in open public data, checked and scored with the reasons shown. Nobody is contacted automatically."
      actions={canEdit && opps.data && all.length > 0 && <button className="btn ghost" onClick={rescore}>Re-apply scoring</button>}>
      {missing && <ErrorBox msg="Partnership tables aren't set up yet — run the 21 Oct SQL file in Supabase." />}
      {msg && <div className="notice">{msg}</div>}

      <Section n="01" title="Where things stand">
        {!opps.data ? <Loading /> : (
          <KpiRow>
            <Kpi big label="Opportunities" value={active.length} sub={`within ${lastOk?.params?.radius_km ?? "—"} km of the clinic`} />
            <Kpi label="Strong fits (score 70+)" value={active.filter((o) => o.score >= 70).length} />
            <Kpi label="Shortlisted" value={active.filter((o) => o.status === "shortlisted").length} />
            <Kpi label="Partnered" value={active.filter((o) => o.status === "partnered").length} />
            <Kpi label="Runs recorded" value={runs.data?.length ?? null} sub={last ? <>last {when(last.started_at)} · <Tag tone={last.status === "success" ? "good" : last.status === "error" ? "bad" : "info"}>{last.status}</Tag></> : "No runs yet"} />
          </KpiRow>
        )}
        {opps.data && all.length === 0 && !missing && <p className="muted">No opportunities yet. The first run fills this in.</p>}
        {all.length > 0 && (
          <DataTable rows={byType} cols={[
            { key: "type", label: "Partner type", render: (r: any) => <button className="linkish" onClick={() => setType(r.type)}>{r.type}</button>, value: (r: any) => r.type },
            { key: "n", label: "Found", align: "right", format: "int" },
            { key: "top", label: "Score 70+", align: "right", format: "int" },
            { key: "avg", label: "Average score", align: "right", format: "dec" },
          ]} />
        )}
      </Section>

      <Section n="02" title="Opportunities" right={
        <div className="seg">
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Partner type"><option value="all">All types</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="open">Open (hide not-a-fit)</option><option value="all">All statuses</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} aria-label="Minimum score">
            <option value={0}>Any score</option><option value={50}>50+</option><option value={60}>60+</option><option value={70}>70+</option><option value={80}>80+</option>
          </select>
          <label className="inline-toggle"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> include no-longer-listed</label>
        </div>}
        note="Click a row for the score breakdown, the evidence behind each field, and review notes.">
        <DataTable rows={opps.data ? rows : null} csvName="partnership-opportunities" onRow={(r: any) => setOpen(r.id)} limit={50} initialSort={{ key: "score", dir: -1 }}
          empty="Nothing matches these filters." cols={[
          { key: "score", label: "Score", align: "right", render: (r: any) => <span className="score-pill"><span className="track"><i style={{ width: `${r.score}%` }} /></span>{r.score}</span>, value: (r: any) => r.score },
          { key: "name", label: "Name", render: (r: any) => <>{r.name}{!r.active && <span className="muted small"> · not in latest data</span>}</>, value: (r: any) => r.name },
          { key: "partner_type", label: "Type" },
          { key: "distance_km", label: "Distance", align: "right", render: (r: any) => `${Number(r.distance_km).toFixed(1)} km`, value: (r: any) => Number(r.distance_km) },
          { key: "contact", label: "Contact", render: (r: any) => <span className="small">{[r.websites?.length ? "web" : null, r.phones?.length ? "phone" : null].filter(Boolean).join(" · ") || "—"}</span>,
            value: (r: any) => (r.websites?.length ? 1 : 0) + (r.phones?.length ? 1 : 0) },
          { key: "flags", label: "Flags", render: (r: any) => <span className="small muted">{(r.flags ?? []).join(" · ")}</span>, value: (r: any) => (r.flags ?? []).join(" ") },
          { key: "status", label: "Status", render: (r: any) => <Tag tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label ?? r.status}</Tag>, value: (r: any) => r.status },
        ]} />
      </Section>

      <Section n="03" title="Run history" note="Every run is recorded, including failures. Each run re-checks the whole area, so places that disappear from the source are marked, not deleted.">
        <DataTable rows={runs.data} onRow={(r: any) => setRunOpen(r.id)} limit={20} empty="No runs yet." cols={[
          { key: "started_at", label: "Started", render: (r: any) => when(r.started_at) },
          { key: "status", label: "Result", render: (r: any) => <Tag tone={r.status === "success" ? "good" : r.status === "error" ? "bad" : "info"}>{r.status}</Tag> },
          { key: "release", label: "Data release" },
          { key: "fetched", label: "Fetched", align: "right", format: "int" },
          { key: "in_scope", label: "Kept", align: "right", format: "int" },
          { key: "new_count", label: "New", align: "right", format: "int" },
          { key: "updated_count", label: "Updated", align: "right", format: "int" },
          { key: "gone_count", label: "No longer listed", align: "right", format: "int" },
          { key: "dur", label: "Took", align: "right", value: (r: any) => secs(r.started_at, r.finished_at) },
          { key: "error", label: "Error", render: (r: any) => <span className="small">{r.error ?? ""}</span> },
        ]} />
      </Section>

      <Section n="04" title="How the score works" note="Version v1. The same rules run on every place; change them and use “Re-apply scoring”.">
        <div className="score-rules">
          {[
            ["Partnership fit", 35, "School 35 · Workplace 32 · College 28 · Labs & doctors 25 · Fitness 22 · Pharmacy 15"],
            ["Distance from clinic", 25, "≤0.5 km 25 · ≤1 km 20 · ≤1.5 km 14 · ≤2 km 8 · further 4"],
            ["Public contact details", 20, "Website listed 10 · phone listed 10"],
            ["Data confidence", 10, "Source confidence × 10 (how sure the source is that the place exists as listed)"],
            ["Local decision-maker", 10, "Independent 10 · chain outlet 3"],
          ].map(([l, m, d]) => <div key={l as string} className="card"><strong>{l} <span className="muted">· up to {m}</span></strong><div className="small muted">{d}</div></div>)}
        </div>
        <p className="small muted">Before scoring, every place is audited: no name, not a partner category, outside the radius, another dental practice, listed as closed, source confidence below the minimum, or a duplicate listing within 150 m. Excluded counts are in each run.</p>
      </Section>

      <Section n="05" title="Data source">
        {(sources.data ?? []).map((s) => (
          <div key={s.key} className="card src-card">
            <div className="row"><strong>{s.name}</strong><Tag tone={s.status === "active" ? "good" : s.status === "rejected" ? "bad" : "neutral"}>{s.status === "active" ? "in use" : s.status}</Tag></div>
            <div className="small">Licence: {s.license}</div>
            <div className="small muted">Checked {s.verified_on}: {s.verification_note} <a href={s.terms_url} target="_blank" rel="noreferrer">Terms ↗</a></div>
          </div>
        ))}
        {src && <p className="small muted attribution">{src.attribution}</p>}
      </Section>

      <Drawer open={!!sel} onClose={() => setOpen(null)} title={sel?.name ?? ""}>
        {sel && <OppDetail o={sel} canEdit={canEdit} onSaved={f.refresh} />}
      </Drawer>
      <Drawer open={!!selRun} onClose={() => setRunOpen(null)} title={selRun ? `Run · ${when(selRun.started_at)}` : ""}>
        {selRun && <RunDetail r={selRun} />}
      </Drawer>
    </Page>
  );
}

function OppDetail({ o, canEdit, onSaved }: { o: any; canEdit: boolean; onSaved: () => void }) {
  const [status, setStatus] = useState(o.status);
  const [notes, setNotes] = useState(o.notes ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const maps = `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lon}`;
  const explore = `https://explore.overturemaps.org/#17/${o.lat}/${o.lon}`;
  const records = (o.evidence ?? []).find((e: any) => e.claim === "Records")?.value ?? [];
  async function save() {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("partner_opportunities").update({ status, notes: notes || null, reviewed_by: u.user?.email, reviewed_at: new Date().toISOString() }).eq("id", o.id);
    setSaved(error ? error.message : "Saved."); if (!error) onSaved();
  }
  return (
    <div className="opp">
      <p className="muted small">{o.partner_type} · {o.category?.replace(/_/g, " ")} · {Number(o.distance_km).toFixed(2)} km from the clinic</p>
      {o.address && <p>{o.address}{o.postcode ? `, ${o.postcode}` : ""}</p>}
      <div className="btns">
        {(o.websites ?? []).slice(0, 2).map((w: string) => <a key={w} className="btn ghost sm" href={w} target="_blank" rel="noreferrer">Website ↗</a>)}
        {(o.phones ?? []).slice(0, 1).map((p: string) => <a key={p} className="btn ghost sm" href={`tel:${p}`}>{p}</a>)}
        <a className="btn ghost sm" href={maps} target="_blank" rel="noreferrer">Check on Google Maps ↗</a>
        <a className="btn ghost sm" href={explore} target="_blank" rel="noreferrer">Source record ↗</a>
      </div>
      {(o.flags ?? []).length > 0 && <p className="warnline">{o.flags.join(" · ")}</p>}

      <h3 className="sub">Score {o.score} / 100</h3>
      <div className="score-parts">
        {(o.score_breakdown ?? []).map((p: any) => (
          <div key={p.key} className="score-part">
            <div className="row"><span>{p.label}</span><strong>{p.points} / {p.max}</strong></div>
            <div className="bar"><i style={{ width: `${(p.points / p.max) * 100}%` }} /></div>
            <div className="small muted">{p.why}</div>
          </div>
        ))}
      </div>

      <h3 className="sub">Evidence</h3>
      <table className="kvtable"><tbody>
        {(o.evidence ?? []).filter((e: any) => e.claim !== "Records").map((e: any) => (
          <tr key={e.claim}><th>{e.claim}</th><td>{e.value || <span className="muted">not listed</span>}</td></tr>
        ))}
      </tbody></table>
      <p className="small muted">Every field above comes from these source records:</p>
      <table className="kvtable small"><thead><tr><th>Dataset</th><th>Licence</th><th>Updated</th><th>Record</th></tr></thead><tbody>
        {records.map((r: any, i: number) => (
          <tr key={i}><td>{r.dataset}</td><td>{r.license}</td><td>{r.update_time ? String(r.update_time).slice(0, 10) : "—"}</td><td className="mono">{r.record_id ?? "—"}</td></tr>
        ))}
      </tbody></table>
      <p className="small muted">First seen {when(o.first_seen_at)} · last confirmed {when(o.last_seen_at)} · source id <span className="mono">{o.source_id}</span></p>

      <h3 className="sub">Review</h3>
      {canEdit ? (
        <div className="form">
          <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <label>Notes<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Spoke to the principal — open to a check-up camp in December" /></label>
          <div className="btns"><button className="btn" onClick={save}>Save review</button>{saved && <span className="small muted">{saved}</span>}</div>
          {o.reviewed_by && <p className="small muted">Last reviewed by {o.reviewed_by}, {when(o.reviewed_at)}</p>}
        </div>
      ) : <p><Tag tone={STATUS[o.status]?.tone}>{STATUS[o.status]?.label}</Tag> {o.notes}</p>}
    </div>
  );
}

function RunDetail({ r }: { r: any }) {
  const excl = Object.entries(r.excluded ?? {}).sort((a: any, b: any) => b[1] - a[1]);
  return (
    <div>
      <p className="small muted">Source {r.source_key} · release {r.release ?? "—"} · trigger {r.trigger}{r.triggered_by ? ` by ${r.triggered_by}` : ""} · took {secs(r.started_at, r.finished_at)}</p>
      {r.error && <div className="errorbox">{r.error}</div>}
      <table className="kvtable"><tbody>
        <tr><th>Radius</th><td>{r.params?.radius_km} km around {r.params?.center_lat}, {r.params?.center_lon}</td></tr>
        <tr><th>Minimum confidence</th><td>{r.params?.min_confidence}</td></tr>
        <tr><th>Fetched</th><td>{fmt.int(r.fetched)}{r.params?.fetch_seconds ? ` in ${r.params.fetch_seconds}s` : ""}</td></tr>
        <tr><th>Kept after audit</th><td>{fmt.int(r.in_scope)}</td></tr>
        <tr><th>New · updated · no longer listed</th><td>{fmt.int(r.new_count)} · {fmt.int(r.updated_count)} · {fmt.int(r.gone_count)}</td></tr>
      </tbody></table>
      <h3 className="sub">Excluded, by reason</h3>
      {excl.length ? <table className="kvtable"><tbody>{excl.map(([k, v]) => <tr key={k}><th>{k}</th><td>{fmt.int(v as number)}</td></tr>)}</tbody></table> : <p className="muted small">None.</p>}
      <h3 className="sub">Steps</h3>
      <ol className="small">{(r.log ?? []).map((s: any, i: number) => <li key={i}><strong>{s.step}</strong> {JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => k !== "step")))}</li>)}</ol>
    </div>
  );
}
