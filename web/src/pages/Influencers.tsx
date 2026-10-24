import { useMemo, useRef, useState, type FormEvent } from "react";
import { Drawer, ErrorBox, Kpi, KpiRow, Loading, Page, Section, Tag } from "../components/ui";
import { useFilters, useTable } from "../state";
import { supabase } from "../lib/supabase";
import { fmt } from "../lib/metrics";
import { downloadCsv } from "../lib/csv";
import { Logo } from "../components/Logo";

const STAGES = [
  { k: "prospect", label: "Prospect", tone: "neutral" }, { k: "contacted", label: "Contacted", tone: "info" },
  { k: "negotiating", label: "Negotiating", tone: "warn" }, { k: "agreed", label: "Agreed", tone: "good" },
  { k: "posted", label: "Posted", tone: "good" }, { k: "declined", label: "Declined", tone: "bad" }, { k: "not_fit", label: "Not a fit", tone: "bad" },
] as const;
const PLATFORMS = ["instagram", "youtube", "facebook", "x", "linkedin", "moj", "sharechat", "other"];
const PLATFORM_MARK: Record<string, string> = { instagram: "instagram", youtube: "youtube", facebook: "facebook" };
const NICHES = ["Parenting", "Food", "Lifestyle", "Fitness", "Beauty", "Local news", "Tech / IT", "Comedy", "Education", "Other"];
const FIELDS: { key: string; label: string; match: RegExp }[] = [
  { key: "name", label: "Name", match: /^(name|contact|full ?name|creator|influencer)/i },
  { key: "handle", label: "Handle / ID", match: /(handle|username|user ?id|insta(gram)? ?id|^id$|@)/i },
  { key: "platform", label: "Platform", match: /platform|channel|network/i },
  { key: "profile_url", label: "Profile URL", match: /(url|link|profile)/i },
  { key: "phone", label: "Phone", match: /(phone|mobile|number|whatsapp|contact no)/i },
  { key: "email", label: "Email", match: /mail/i },
  { key: "followers", label: "Followers", match: /(follower|subscriber|audience|reach)/i },
  { key: "niche", label: "Niche", match: /(niche|category|genre|type)/i },
  { key: "area", label: "Area", match: /(area|location|locality|city|place)/i },
  { key: "language", label: "Language", match: /lang/i },
  { key: "rate_inr", label: "Rate (₹)", match: /(rate|price|charge|fee|cost|budget)/i },
  { key: "notes", label: "Notes", match: /(note|comment|remark)/i },
];

const handleUrl = (r: any) => r.profile_url || (r.handle ? (r.platform === "youtube" ? `https://youtube.com/@${r.handle}` : r.platform === "facebook" ? `https://facebook.com/${r.handle}` : r.platform === "x" ? `https://x.com/${r.handle}` : `https://instagram.com/${r.handle}`) : null);
const waLink = (p: string) => { const d = p.replace(/\D/g, ""); return `https://wa.me/${d.length === 10 ? "91" + d : d}`; };
const tier = (n: number | null) => n == null ? null : n < 10000 ? "Nano" : n < 50000 ? "Micro" : n < 250000 ? "Mid" : "Macro";

export default function Influencers() {
  const f = useFilters();
  const canEdit = f.role === "owner" || f.role === "editor";
  const list = useTable<any>("influencers", (q) => q.select("*").order("created_at", { ascending: false }).limit(5000));
  const [stage, setStage] = useState<string>("all");
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("all");
  const [edit, setEdit] = useState<any | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rows = list.data ?? [];
  const missing = list.error && /influencers/.test(list.error);
  const shown = useMemo(() => rows.filter((r) =>
    (stage === "all" || r.status === stage) && (platform === "all" || r.platform === platform) &&
    (!q || [r.name, r.handle, r.niche, r.area, r.phone, r.notes].some((x) => String(x ?? "").toLowerCase().includes(q.toLowerCase())))), [rows, stage, platform, q]);
  const count = (k: string) => rows.filter((r) => r.status === k).length;
  const paid = rows.reduce((a, r) => a + Number(r.paid_inr ?? 0), 0);
  const patients = rows.reduce((a, r) => a + Number(r.patients ?? 0), 0);
  const enquiries = rows.reduce((a, r) => a + Number(r.enquiries ?? 0), 0);
  const reach = rows.filter((r) => ["agreed", "posted"].includes(r.status)).reduce((a, r) => a + Number(r.followers ?? 0), 0);

  async function setStatus(r: any, status: string) {
    const { error } = await supabase.from("influencers").update({ status }).eq("id", r.id);
    if (error) setErr(error.message); else f.refresh();
  }

  return (
    <Page eyebrow="Channels · Creators" title="Influencers"
      intro="Every local creator Elites could work with — contact details, where the conversation stands, what was agreed and what it brought in. Add them one at a time or upload your list."
      actions={<>
        <button className="btn ghost" onClick={() => downloadCsv("elites-influencers.csv", shown.map(({ id, added_by, ...r }) => r))}>Export CSV</button>
        {canEdit && <button className="btn ghost" onClick={() => setShowUpload((s) => !s)}>Upload list</button>}
        {canEdit && <button className="btn" onClick={() => setEdit({ platform: "instagram", status: "prospect" })}>+ Add influencer</button>}
      </>}>
      {missing && <div className="pending">The influencer table isn't set up yet — run the latest SQL file in Supabase (SQL Editor), then refresh.</div>}
      {list.error && !missing && <ErrorBox msg={list.error} />}
      {err && <ErrorBox msg={err} />}
      {showUpload && canEdit && <Upload onDone={() => { setShowUpload(false); f.refresh(); }} />}

      <KpiRow>
        <Kpi big logo="influencer" label="Creators in the list" value={list.data ? rows.length : null} sub={`${count("contacted") + count("negotiating")} in conversation`} />
        <Kpi big logo="instagram" label="Agreed or posted" value={list.data ? count("agreed") + count("posted") : null} sub={reach ? `${fmt.compact(reach)} combined followers` : undefined} />
        <Kpi logo="rupee" label="Paid to creators" value={list.data ? paid : null} format="inr" />
        <Kpi logo="whatsapp" label="Enquiries from creators" value={list.data ? enquiries : null} />
        <Kpi logo="crm" label="Patients from creators" value={list.data ? patients : null} sub={patients && paid ? `${fmt.inr(paid / patients)} per patient` : undefined} />
      </KpiRow>

      <Section n="01" title="Pipeline" note="Click a stage to filter the list.">
        <div className="pipe">
          <button className={stage === "all" ? "on" : ""} onClick={() => setStage("all")}><b>{rows.length}</b><span>All</span></button>
          {STAGES.map((s) => (
            <button key={s.k} className={`${stage === s.k ? "on" : ""} t-${s.tone}`} onClick={() => setStage(s.k)}
              style={{ ["--w" as any]: rows.length ? `${(count(s.k) / rows.length) * 100}%` : "0%" }}>
              <b>{count(s.k)}</b><span>{s.label}</span><i />
            </button>
          ))}
        </div>
      </Section>

      <Section n="02" title={`Creators${stage !== "all" ? ` · ${STAGES.find((s) => s.k === stage)?.label}` : ""}`}
        right={<div className="infl-filters">
          <input placeholder="Search name, handle, area, niche…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search influencers" />
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
            <option value="all">All platforms</option>{PLATFORMS.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
        </div>}>
        {!list.data ? <Loading h={200} /> : shown.length === 0 ? (
          <div className="empty chart-empty">{rows.length ? "No creators match these filters." : "No creators yet. Add one, or upload your list of contacts (Excel or CSV)."}</div>
        ) : (
          <div className="infl-grid">
            {shown.map((r) => { const url = handleUrl(r); const st = STAGES.find((s) => s.k === r.status)!; return (
              <article key={r.id} className="infl-card">
                <header>
                  <Logo id={PLATFORM_MARK[r.platform] ?? "influencer"} size={34} />
                  <div className="infl-id">
                    <strong>{r.name}</strong>
                    {r.handle && (url ? <a href={url} target="_blank" rel="noopener noreferrer">@{r.handle}</a> : <span>@{r.handle}</span>)}
                  </div>
                  <Tag tone={st.tone as any}>{st.label}</Tag>
                </header>
                <div className="infl-stats">
                  <div><b>{r.followers != null ? fmt.compact(r.followers) : "—"}</b><span>{tier(r.followers) ?? "followers"}</span></div>
                  <div><b>{r.rate_inr != null ? fmt.compact(r.rate_inr) : "—"}</b><span>rate</span></div>
                  <div><b>{r.patients ?? "—"}</b><span>patients</span></div>
                </div>
                <div className="infl-meta small">
                  {r.niche && <span className="chip">{r.niche}</span>}{r.area && <span className="chip">{r.area}</span>}{r.language && <span className="chip">{r.language}</span>}
                </div>
                {r.notes && <p className="small muted infl-notes">{r.notes}</p>}
                <footer>
                  {r.phone && <a className="btn ghost tiny" href={waLink(r.phone)} target="_blank" rel="noopener noreferrer"><Logo id="whatsapp" size={16} tile={false} /> WhatsApp</a>}
                  {r.phone && <a className="btn ghost tiny" href={`tel:${r.phone}`}>Call</a>}
                  {r.email && <a className="btn ghost tiny" href={`mailto:${r.email}`}>Email</a>}
                  {r.post_url && <a className="btn ghost tiny" href={r.post_url} target="_blank" rel="noopener noreferrer">View post</a>}
                  {canEdit && <select className="tiny" value={r.status} onChange={(e) => setStatus(r, e.target.value)} aria-label="Status">{STAGES.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</select>}
                  {canEdit && <button className="btn ghost tiny" onClick={() => setEdit(r)}>Edit</button>}
                </footer>
              </article>
            ); })}
          </div>
        )}
      </Section>

      <Section n="03" title="How to work with creators" note="Short playbook for a clinic.">
        <div className="tips">
          <div><b>Pick local, not big.</b> 5K–50K followers living in KR Puram, TC Palya, Ramamurthy Nagar, Hoodi beat one city-wide star.</div>
          <div><b>Give each a code.</b> A unique code (e.g. PRIYA10) or link with UTM, so bookings show up here and in the CRM.</div>
          <div><b>Show the visit.</b> A real check-up, a child's first visit or an aligner fitting — no cure claims or guaranteed results.</div>
          <div><b>Label it.</b> Paid posts must be marked as paid partnership / #ad (ASCI rules).</div>
        </div>
      </Section>

      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : "Add influencer"}>
        {edit && <EditForm row={edit} onDone={() => { setEdit(null); f.refresh(); }} onDelete={async () => {
          if (!edit.id || !window.confirm(`Delete ${edit.name}?`)) return;
          const { error } = await supabase.from("influencers").delete().eq("id", edit.id);
          if (error) setErr(error.message); setEdit(null); f.refresh();
        }} />}
      </Drawer>
    </Page>
  );
}

function EditForm({ row, onDone, onDelete }: { row: any; onDone: () => void; onDelete: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr(null);
    const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[^0-9.]/g, "")));
    const rec: Record<string, unknown> = {
      name: d.name.trim(), handle: d.handle.trim().replace(/^@/, "") || null, platform: d.platform, profile_url: d.profile_url.trim() || null,
      phone: d.phone.trim() || null, email: d.email.trim() || null, followers: num(d.followers), niche: d.niche || null, area: d.area.trim() || null,
      language: d.language.trim() || null, status: d.status, rate_inr: num(d.rate_inr), paid_inr: num(d.paid_inr), collab_type: d.collab_type.trim() || null,
      promo_code: d.promo_code.trim() || null, post_url: d.post_url.trim() || null, posted_on: d.posted_on || null,
      views: num(d.views), enquiries: num(d.enquiries), patients: num(d.patients), notes: d.notes.trim() || null,
    };
    const { data: u } = await supabase.auth.getUser();
    const { error } = row.id ? await supabase.from("influencers").update(rec).eq("id", row.id)
      : await supabase.from("influencers").insert({ ...rec, added_by: u.user?.email ?? null });
    setBusy(false);
    if (error) setErr(/influencers_handle_uniq/.test(error.message) ? "That handle is already in the list." : error.message); else onDone();
  }
  const F = ({ n, label, type = "text", ph }: { n: string; label: string; type?: string; ph?: string }) => (
    <label>{label}<input name={n} type={type} defaultValue={row[n] ?? ""} placeholder={ph} /></label>
  );
  return (
    <form className="form infl-form" onSubmit={submit}>
      {err && <ErrorBox msg={err} />}
      <div className="grid-form">
        <label>Name *<input name="name" required defaultValue={row.name ?? ""} /></label>
        <label>Platform<select name="platform" defaultValue={row.platform}>{PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
        <F n="handle" label="Handle / ID" ph="@username" />
        <F n="profile_url" label="Profile URL" type="url" ph="https://instagram.com/…" />
        <F n="phone" label="Phone / WhatsApp" type="tel" />
        <F n="email" label="Email" type="email" />
        <F n="followers" label="Followers" ph="12400" />
        <label>Niche<select name="niche" defaultValue={row.niche ?? ""}><option value="">—</option>{NICHES.map((n) => <option key={n}>{n}</option>)}</select></label>
        <F n="area" label="Area" ph="KR Puram" />
        <F n="language" label="Language" ph="Kannada, English" />
        <label>Status<select name="status" defaultValue={row.status}>{STAGES.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</select></label>
        <F n="rate_inr" label="Quoted rate (₹)" />
        <F n="collab_type" label="Collab type" ph="Paid reel, barter visit…" />
        <F n="promo_code" label="Promo code / UTM" ph="PRIYA10" />
        <F n="paid_inr" label="Paid (₹)" />
        <F n="post_url" label="Post URL" type="url" />
        <F n="posted_on" label="Posted on" type="date" />
        <F n="views" label="Views" />
        <F n="enquiries" label="Enquiries" />
        <F n="patients" label="Patients" />
      </div>
      <label>Notes<textarea name="notes" rows={3} defaultValue={row.notes ?? ""} /></label>
      <div className="btns">
        <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        {row.id && <button type="button" className="btn ghost danger" onClick={onDelete}>Delete</button>}
      </div>
    </form>
  );
}

function Upload({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<unknown[][] | null>(null);
  const [map, setMap] = useState<Record<string, number | undefined>>({});
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function load(fl: File) {
    setErr(null); setRes(null);
    try {
      let rows: unknown[][];
      if (/\.csv$/i.test(fl.name)) { const { default: Papa } = await import("papaparse"); rows = Papa.parse<string[]>(await fl.text(), { skipEmptyLines: "greedy" }).data; }
      else if (/\.xlsx$/i.test(fl.name)) { const { default: read } = await import("read-excel-file"); rows = (await read(fl)) as unknown[][]; }
      else { setErr("Use an .xlsx or .csv file."); return; }
      const h = rows.findIndex((r) => r.filter((c) => c != null && String(c).trim() !== "").length >= 2);
      if (h < 0) { setErr("Couldn't find a header row."); return; }
      const body = rows.slice(h); const head = body[0].map((c) => String(c ?? ""));
      const m: Record<string, number | undefined> = {}; const used = new Set<number>();
      for (const fd of FIELDS) { const i = head.findIndex((c, j) => !used.has(j) && fd.match.test(c)); if (i >= 0) { m[fd.key] = i; used.add(i); } }
      setSheet(body); setMap(m);
    } catch (e: any) { setErr(`Couldn't read the file: ${e.message ?? e}`); }
  }
  const data = (sheet ?? []).slice(1).map((r) => Object.fromEntries(FIELDS.filter((fd) => map[fd.key] != null).map((fd) => [fd.key, r[map[fd.key]!] == null ? "" : String(r[map[fd.key]!]).trim()])))
    .filter((r) => Object.values(r).some((v) => v));
  async function go() {
    setBusy(true); setErr(null);
    const { data: out, error } = await supabase.rpc("rpc_influencer_import", { p_rows: data });
    setBusy(false);
    if (error) setErr(error.message); else setRes(out);
  }
  async function template() {
    const { default: write } = await import("write-excel-file");
    await write([FIELDS.map((fd) => ({ value: fd.label, fontWeight: "bold" as const })), ["Priya Eats", "priyaeats", "instagram", "https://instagram.com/priyaeats", "9845000000", "", 12400, "Food", "KR Puram", "Kannada, English", 5000, "Met at Phoenix event"].map((value) => ({ value }))],
      { fileName: "elites-influencers-template.xlsx", columns: FIELDS.map(() => ({ width: 18 })) });
  }
  return (
    <div className="card upload-card">
      <div className="row">
        <div><strong>Upload your contact list</strong><div className="small muted">Excel (.xlsx) or CSV. Columns are matched by name — Name, Handle, Platform, URL, Phone, Followers, Niche, Area, Rate… Same handle twice updates the existing contact.</div></div>
        <div className="btns"><button className="btn ghost" onClick={template}>Template</button><button className="btn" onClick={() => ref.current?.click()}>Choose file</button></div>
        <input ref={ref} type="file" accept=".xlsx,.csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
      </div>
      {err && <ErrorBox msg={err} />}
      {sheet && !res && (
        <>
          <div className="map-grid">{FIELDS.map((fd) => (
            <label key={fd.key} className="small">{fd.label}
              <select value={map[fd.key] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [fd.key]: e.target.value === "" ? undefined : +e.target.value }))}>
                <option value="">— not in file —</option>{sheet[0].map((c, i) => <option key={i} value={i}>{String(c ?? `Column ${i + 1}`)}</option>)}
              </select>
            </label>
          ))}</div>
          <div className="row"><span className="small">{data.length} contacts ready{map.name == null && map.handle == null ? " — pick the Name or Handle column" : ""}.</span>
            <button className="btn" disabled={busy || !data.length || (map.name == null && map.handle == null)} onClick={go}>{busy ? "Adding…" : `Add ${data.length} contacts`}</button></div>
        </>
      )}
      {res && <div className="notice">Added {res.added}, updated {res.updated}{res.skipped ? `, skipped ${res.skipped} (no name or handle)` : ""}. <button className="btn ghost tiny" onClick={onDone}>Done</button></div>}
    </div>
  );
}
