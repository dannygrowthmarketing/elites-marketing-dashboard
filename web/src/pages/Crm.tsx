import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { DataTable, Drawer, Kpi, KpiRow, Page, Section, Tag } from "../components/ui";
import { useFilters, useTable } from "../state";
import { supabase } from "../lib/supabase";
import { fmt, ratio } from "../lib/metrics";
import { shortPath } from "../lib/insights";

export const STATUSES = ["new", "contacted", "qualified", "appointment_booked", "completed", "lost", "cancelled"] as const;
const STATUS_LABEL: Record<string, string> = { new: "New", contacted: "Contacted", qualified: "Qualified", appointment_booked: "Appointment booked", completed: "Completed", lost: "Lost", cancelled: "Cancelled" };
const STATUS_TONE: Record<string, any> = { new: "info", contacted: "neutral", qualified: "neutral", appointment_booked: "good", completed: "good", lost: "bad", cancelled: "bad" };
const TYPES = ["phone", "whatsapp", "walk_in", "booking", "contact_form", "video_consult", "gbp", "referral", "ads_lead_form", "meta_lead_form", "other"];
const SERVICES = ["General check-up", "Root canal", "Implants", "Braces / aligners", "Crowns & bridges", "Dentures", "Cleaning", "Whitening", "Fillings", "Extraction", "Kids dentistry", "Smile makeover", "Other"];

export default function Crm() {
  const f = useFilters();
  const canEdit = f.role === "owner" || f.role === "editor";
  const [status, setStatus] = useState("all");
  const [showTest, setShowTest] = useState(false);
  // The CRM is the clinic's patient book: default to everyone, with the date bar as an option.
  const [scope, setScope] = useState<"all" | "range">(() => { try { return (localStorage.getItem("crm_scope") as any) || "all"; } catch { return "all"; } });
  const pickScope = (v: "all" | "range") => { setScope(v); try { localStorage.setItem("crm_scope", v); } catch { /* storage blocked */ } };
  const [sp] = useSearchParams();
  const [open, setOpen] = useState<string | null>(sp.get("lead"));
  const [adding, setAdding] = useState(false);
  const leads = useTable<any>("leads", (q) => {
    let x = q.select("*").order("first_inquiry_at", { ascending: false }).limit(5000);
    if (scope === "range") x = x.gte("first_inquiry_at", f.range.start + "T00:00:00+05:30").lte("first_inquiry_at", f.range.end + "T23:59:59+05:30");
    if (!showTest) x = x.eq("is_test", false);
    return x;
  }, [f.range.start, f.range.end, showTest, scope]);
  const rows = (leads.data ?? []).filter((l) => status === "all" || l.status === status);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of leads.data ?? []) c[l.status] = (c[l.status] ?? 0) + 1;
    return c;
  }, [leads.data]);
  const total = leads.data?.length ?? null;
  const booked = (counts.appointment_booked ?? 0) + (counts.completed ?? 0);
  const due = (leads.data ?? []).filter((l) => l.next_follow_up && l.next_follow_up <= f.today && !["completed", "lost", "cancelled"].includes(l.status)).length;

  return (
    <Page eyebrow="CRM" title="Leads & bookings"
      intro="Identified people only. Website forms and bookings arrive automatically with their source; calls, WhatsApp and walk-ins are added by staff. No clinical notes — keep treatment details in the clinic's own records."
      actions={canEdit && <button className="btn" onClick={() => setAdding(true)}>+ Add lead</button>}>
      <Section n="01" title="Pipeline" right={
        <div className="seg sm">
          <button className={scope === "all" ? "on" : ""} onClick={() => pickScope("all")}>All time</button>
          <button className={scope === "range" ? "on" : ""} onClick={() => pickScope("range")}>Selected dates ({f.label})</button>
        </div>}>
        <KpiRow>
          <Kpi logo="crm" label="Leads" value={total} defKey="crm_leads" />
          <Kpi logo="crm" label="Booked or completed" value={leads.data ? booked : null} />
          <Kpi logo="crm" label="Lead → booking rate" value={total ? ratio(booked, total) : null} format="pct" defKey="lead_to_booking" />
          <Kpi logo="crm" label="Follow-ups due" value={leads.data ? due : null} />
        </KpiRow>
        <div className="seg wrap">
          <button className={status === "all" ? "on" : ""} onClick={() => setStatus("all")}>All {total != null && `(${total})`}</button>
          {STATUSES.map((s) => <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>{STATUS_LABEL[s]} ({counts[s] ?? 0})</button>)}
          <label className="chk"><input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} /> show test leads</label>
        </div>
      </Section>
      <Section n="02" title="Leads">
        <DataTable rows={leads.data ? rows : null} csvName="crm-leads" onRow={(r) => setOpen(r.id)} limit={50} empty={scope === "range" ? "No leads in the selected dates. Switch to All time to see every patient." : "No leads yet. Website form enquiries and bookings arrive here automatically."} cols={[
          { key: "first_inquiry_at", label: "First enquiry", render: (r) => new Date(r.first_inquiry_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }), value: (r) => r.first_inquiry_at },
          { key: "name", label: "Name", render: (r) => <>{r.name ?? <span className="muted">—</span>} {r.is_test && <Tag>test</Tag>}</>, value: (r) => r.name },
          { key: "phone_e164", label: "Phone" },
          { key: "inquiry_type", label: "Type", render: (r) => r.inquiry_type.replace("_", " ") },
          { key: "requested_service", label: "Interest" },
          { key: "src", label: "First source", value: (r) => `${r.first_source ?? "(direct)"} / ${r.first_medium ?? "(none)"}` },
          { key: "first_campaign", label: "Campaign" },
          { key: "status", label: "Status", render: (r) => <Tag tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Tag>, value: (r) => STATUSES.indexOf(r.status) },
          { key: "next_follow_up", label: "Follow-up" },
        ]} />
      </Section>
      <Section n="03" title="Offline counts" note="For calls and walk-ins where you don't take names. Shown beside, never inside, the lead counts.">
        <ManualCounts canEdit={canEdit} />
      </Section>
      <Drawer open={!!open} onClose={() => setOpen(null)} title="Lead">{open && <LeadDetail id={open} canEdit={canEdit} onChanged={f.refresh} />}</Drawer>
      <Drawer open={adding} onClose={() => setAdding(false)} title="Add lead">{adding && <NewLead onDone={() => { setAdding(false); f.refresh(); }} />}</Drawer>
    </Page>
  );
}

function NewLead({ onDone }: { onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const phoneDigits = (d.phone ?? "").replace(/\D/g, "");
    const phone = phoneDigits.length === 10 ? "+91" + phoneDigits : phoneDigits.length === 12 && phoneDigits.startsWith("91") ? "+" + phoneDigits : d.phone ? "+" + phoneDigits : null;
    setBusy(true); setErr(null);
    const dedupe = phone ? await sha("p:" + phone) : d.email ? await sha("e:" + d.email.trim().toLowerCase()) : null;
    if (dedupe) {
      const { data: dup } = await supabase.from("leads").select("id,name,first_inquiry_at").eq("dedupe_key", dedupe).limit(1).maybeSingle();
      if (dup && !confirm(`A lead with this ${phone ? "phone" : "email"} exists (${dup.name ?? "no name"}, ${new Date(dup.first_inquiry_at).toLocaleDateString("en-IN")}). Add anyway?`)) { setBusy(false); return; }
    }
    const { error } = await supabase.from("leads").insert({
      name: d.name || null, phone_e164: phone, email: d.email?.trim().toLowerCase() || null, dedupe_key: dedupe,
      inquiry_type: d.inquiry_type, requested_service: d.service || null,
      first_source: d.source || "(direct)", first_medium: d.medium || "(none)", first_campaign: d.campaign || null,
      latest_source: d.source || "(direct)", latest_medium: d.medium || "(none)",
      first_inquiry_at: d.when ? new Date(d.when).toISOString() : new Date().toISOString(),
      status: d.status, next_follow_up: d.follow || null,
    });
    setBusy(false);
    if (error) setErr(error.message); else onDone();
  }
  return (
    <form className="form" onSubmit={submit}>
      <label>Name<input name="name" autoComplete="off" /></label>
      <label>Phone<input name="phone" inputMode="tel" placeholder="98765 43210" /></label>
      <label>Email<input name="email" type="email" /></label>
      <label>How did they reach us?<select name="inquiry_type" defaultValue="phone">{TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</select></label>
      <label>Interested in<select name="service" defaultValue=""><option value="">—</option>{SERVICES.map((s) => <option key={s}>{s}</option>)}</select></label>
      <fieldset><legend>Where did they hear about us?</legend>
        <select name="source" defaultValue="(direct)">
          {["(direct)", "google", "facebook", "instagram", "justdial", "practo", "referral", "walk_by", "other"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select name="medium" defaultValue="(none)">{["(none)", "organic", "cpc", "paid", "gbp", "social", "referral", "offline"].map((s) => <option key={s}>{s}</option>)}</select>
        <input name="campaign" placeholder="Campaign (optional)" />
      </fieldset>
      <label>When<input name="when" type="datetime-local" /></label>
      <label>Status<select name="status" defaultValue="new">{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
      <label>Follow up on<input name="follow" type="date" /></label>
      {err && <div className="errorbox">{err}</div>}
      <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save lead"}</button>
    </form>
  );
}

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function LeadDetail({ id, canEdit, onChanged }: { id: string; canEdit: boolean; onChanged: () => void }) {
  const [v, setV] = useState(0);
  const bump = () => { setV((x) => x + 1); onChanged(); };
  const lead = useTable<any>("leads", (q) => q.select("*").eq("id", id), [id, v]);
  const touches = useTable<any>("lead_touchpoints", (q) => q.select("*").eq("lead_id", id).order("occurred_at"), [id, v]);
  const appts = useTable<any>("appointments", (q) => q.select("*").eq("lead_id", id).order("booked_at"), [id, v]);
  const notes = useTable<any>("lead_notes", (q) => q.select("*").eq("lead_id", id).order("created_at", { ascending: false }), [id, v]);
  const rev = useTable<any>("revenue_entries", (q) => q.select("*").eq("lead_id", id).order("collected_on"), [id, v]);
  const l = lead.data?.[0];
  if (!l) return <div className="loading" style={{ height: 200 }} />;
  const upd = async (patch: Record<string, unknown>) => { await supabase.from("leads").update(patch).eq("id", id); bump(); };
  const revTotal = (rev.data ?? []).reduce((s, r) => s + Number(r.amount_inr), 0);

  return (
    <div className="lead">
      <div className="lead-head">
        <h4>{l.name ?? "Unnamed lead"} {l.is_test && <Tag>test</Tag>}</h4>
        <div className="muted">{l.phone_e164 ?? ""} {l.email ? `· ${l.email}` : ""}</div>
      </div>
      <dl className="kv">
        <dt>First enquiry</dt><dd>{new Date(l.first_inquiry_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {l.inquiry_type.replace("_", " ")}</dd>
        <dt>First touch</dt><dd>{l.first_source} / {l.first_medium}{l.first_campaign ? ` · ${l.first_campaign}` : ""}{l.first_term ? ` · “${l.first_term}”` : ""}</dd>
        <dt>Landing page</dt><dd>{l.first_landing_page ? shortPath(l.first_landing_page) : "—"}</dd>
        <dt>Latest touch</dt><dd>{l.latest_source} / {l.latest_medium}</dd>
        <dt>Interest</dt><dd>{l.requested_service ?? "—"}</dd>
        <dt>Revenue recorded</dt><dd>{revTotal ? fmt.inr(revTotal) : "—"}</dd>
      </dl>
      {canEdit && (
        <div className="lead-edit">
          <label>Status<select value={l.status} onChange={(e) => upd({ status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
          {["lost", "cancelled"].includes(l.status) && <label>Reason<input defaultValue={l.lost_reason ?? ""} onBlur={(e) => upd({ lost_reason: e.target.value || null })} /></label>}
          <label>Follow up<input type="date" defaultValue={l.next_follow_up ?? ""} onChange={(e) => upd({ next_follow_up: e.target.value || null })} /></label>
          <label>Owner<input defaultValue={l.owner ?? ""} placeholder="e.g. Abhi" onBlur={(e) => upd({ owner: e.target.value || null })} /></label>
          <label className="chk"><input type="checkbox" checked={l.is_test} onChange={(e) => upd({ is_test: e.target.checked })} /> test lead (exclude from reports)</label>
        </div>
      )}

      <h5>Appointments</h5>
      <DataTable rows={appts.data} limit={10} empty="None yet." cols={[
        { key: "appointment_at", label: "When", render: (a) => (a.appointment_at ? new Date(a.appointment_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—") },
        { key: "source_system", label: "Via" },
        { key: "status", label: "Status", render: (a) => canEdit
          ? <select value={a.status} onClick={(e) => e.stopPropagation()} onChange={async (e) => { await supabase.from("appointments").update({ status: e.target.value }).eq("id", a.id); if (e.target.value === "completed" && l.status !== "completed") await upd({ status: "completed" }); else bump(); }}>
              {["booked", "confirmed", "completed", "no_show", "cancelled", "rescheduled"].map((s) => <option key={s}>{s}</option>)}
            </select>
          : a.status },
      ]} />
      {canEdit && <AddAppt leadId={id} onDone={async () => { if (!["appointment_booked", "completed"].includes(l.status)) await upd({ status: "appointment_booked" }); else bump(); }} />}

      <h5>Payments collected</h5>
      <DataTable rows={rev.data} limit={10} empty="None recorded." cols={[
        { key: "collected_on", label: "Date" }, { key: "service_category", label: "For" },
        { key: "amount_inr", label: "Amount", align: "right", format: "inr", value: (r) => Number(r.amount_inr) },
      ]} />
      {canEdit && <AddRevenue leadId={id} appts={appts.data ?? []} onDone={bump} />}

      <h5>Touchpoints</h5>
      <DataTable rows={touches.data} limit={20} cols={[
        { key: "occurred_at", label: "When", render: (t) => new Date(t.occurred_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" }) },
        { key: "channel", label: "Channel" }, { key: "sm", label: "Source / medium", value: (t) => `${t.source ?? "—"} / ${t.medium ?? "—"}` },
        { key: "campaign", label: "Campaign" }, { key: "landing_page", label: "Page", render: (t) => (t.landing_page ? shortPath(t.landing_page) : "—") },
      ]} />

      <h5>Notes</h5>
      {canEdit && <form className="inline-form" onSubmit={async (e) => { e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form); const body = String(fd.get("body") ?? "").trim(); if (!body) return; const { data: s } = await supabase.auth.getUser(); await supabase.from("lead_notes").insert({ lead_id: id, body, author: s.user?.email }); form.reset(); bump(); }}>
        <input name="body" placeholder="Follow-up note (no clinical details)" /><button className="btn">Add</button>
      </form>}
      {(notes.data ?? []).map((n) => <div key={n.id} className="note"><div>{n.body}</div><div className="muted small">{n.author} · {new Date(n.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</div></div>)}
    </div>
  );
}

function AddAppt({ leadId, onDone }: { leadId: string; onDone: () => void }) {
  return (
    <form className="inline-form" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const d = Object.fromEntries(new FormData(form)) as Record<string, string>;
      await supabase.from("appointments").insert({ lead_id: leadId, appointment_at: d.at ? new Date(d.at).toISOString() : null, source_system: "manual", service_category: d.svc || null });
      form.reset(); onDone();
    }}>
      <input name="at" type="datetime-local" aria-label="Appointment time" />
      <select name="svc" defaultValue=""><option value="">Service…</option>{SERVICES.map((s) => <option key={s}>{s}</option>)}</select>
      <button className="btn ghost">+ Appointment</button>
    </form>
  );
}

function AddRevenue({ leadId, appts, onDone }: { leadId: string; appts: any[]; onDone: () => void }) {
  return (
    <form className="inline-form" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const d = Object.fromEntries(new FormData(form)) as Record<string, string>;
      const amt = Number(d.amt);
      if (!Number.isFinite(amt) || amt < 0) return;
      const { data: s } = await supabase.auth.getUser();
      await supabase.from("revenue_entries").insert({ lead_id: leadId, appointment_id: appts.at(-1)?.id ?? null, collected_on: d.on, amount_inr: amt, service_category: d.svc || null, entered_by: s.user?.email });
      form.reset(); onDone();
    }}>
      <input name="on" type="date" required aria-label="Collected on" defaultValue={new Date().toISOString().slice(0, 10)} />
      <input name="amt" type="number" min="0" step="1" required placeholder="₹ amount" />
      <select name="svc" defaultValue=""><option value="">For…</option>{SERVICES.map((s) => <option key={s}>{s}</option>)}</select>
      <button className="btn ghost">+ Payment</button>
    </form>
  );
}

function ManualCounts({ canEdit }: { canEdit: boolean }) {
  const f = useFilters();
  const [v, setV] = useState(0);
  const rows = useTable<any>("manual_daily_counts", (q) => q.select("*").gte("date", f.range.start).lte("date", f.range.end).order("date", { ascending: false }), [f.range.start, f.range.end, v]);
  return (
    <>
      {canEdit && <form className="inline-form" onSubmit={async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        await supabase.from("manual_daily_counts").upsert({ date: d.date, metric: d.metric, value: Number(d.value), note: d.note || null });
        setV((x) => x + 1);
      }}>
        <input name="date" type="date" required defaultValue={f.today} aria-label="Date" />
        <select name="metric"><option value="calls_answered">Calls answered</option><option value="walk_ins">Walk-ins</option><option value="whatsapp_chats">WhatsApp chats</option></select>
        <input name="value" type="number" min="0" required placeholder="Count" />
        <input name="note" placeholder="Note" />
        <button className="btn ghost">Save</button>
      </form>}
      <DataTable rows={rows.data} limit={14} csvName="offline-counts" empty="Nothing logged." cols={[
        { key: "date", label: "Date" }, { key: "metric", label: "What", render: (r) => r.metric.replace("_", " ") },
        { key: "value", label: "Count", align: "right", format: "int" }, { key: "note", label: "Note" },
      ]} />
    </>
  );
}
