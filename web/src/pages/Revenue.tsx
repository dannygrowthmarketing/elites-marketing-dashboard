import { useMemo, useRef, useState, type FormEvent } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DataTable, ErrorBox, Kpi, KpiRow, Loading, Page, Section, Tag, useRangeArgs } from "../components/ui";
import { useFilters, useRpc, useTable } from "../state";
import { supabase } from "../lib/supabase";
import { fmt, ratio } from "../lib/metrics";
import { FIELDS, SERVICES, SOURCES, guessMapping, prepareRows, type Field, type PreparedRow } from "../lib/revenueImport";
import { C } from "./Overview";
import { GatewayPayments } from "./Payments";

const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const monthLabel = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
const dayLabel = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const MATCH: Record<string, string> = { phone: "by phone", email: "by email", lead: "picked in CRM", none: "" };
const VIA: Record<string, string> = { crm: "CRM", single: "Entered", bulk: "Upload", gateway: "Gateway" };

export default function Revenue() {
  const f = useFilters();
  const canEdit = f.role === "owner" || f.role === "editor";
  const { range } = useRangeArgs();
  const s = useRpc<any>("rpc_revenue_summary", range);
  const batches = useTable<any>("revenue_batches", (q) => q.select("*").order("created_at", { ascending: false }).limit(50));
  const [tab, setTab] = useState<"single" | "bulk">("single");
  const d = s.data;
  const none = d && Number(d.all_time_entries) === 0;

  const gRoas = d && Number(d.google_ads_spend) > 0 && Number(d.google_ads_revenue) > 0 ? Number(d.google_ads_revenue) / Number(d.google_ads_spend) : null;
  const traced = d ? ratio(Number(d.matched_total), Number(d.total)) : null;
  const typed = d ? Number(d.new_total) + Number(d.returning_total) : 0;

  return (
    <Page eyebrow="Business" title="Revenue"
      intro="What the clinic collected and which marketing brought it in. Entered by the clinic — nothing here is estimated.">
      {s.error && <ErrorBox msg={s.error.includes("rpc_revenue_summary") ? "Revenue tables aren't set up yet — run the revenue SQL in Supabase." : s.error} />}

      {none && (
        <div className="card rev-empty">
          <strong>No revenue recorded yet.</strong>
          <p className="muted small">Add payments one at a time, or upload the clinic's Excel/CSV export below. Each payment is matched to its lead by phone or email, so revenue shows up against Google Ads, Business Profile, walk-ins and so on.</p>
        </div>
      )}

      <Section n="01" title={`Revenue — ${f.label.toLowerCase()}`}>
        {!d ? <Loading /> : (
          <KpiRow>
            <Kpi logo="rupee" big label="Revenue collected" value={Number(d.total)} format="inr" defKey="revenue" />
            <Kpi label="Payments" value={Number(d.entries)} />
            <Kpi logo="rupee" label="Average payment" value={ratio(Number(d.total), Number(d.entries))} format="inr" />
            <Kpi label="Traced to a marketing lead" value={traced} format="pct" sub={d.entries > 0 ? `${fmt.int(d.matched_entries)} of ${fmt.int(d.entries)} payments` : undefined} defKey="rev_traced" />
            <Kpi label="Google Ads return" value={gRoas} format="x" defKey="roas"
              sub={Number(d.google_ads_spend) > 0 ? `${fmt.inr(Number(d.google_ads_revenue))} from ${fmt.inr(Number(d.google_ads_spend))} spend` : "No Google Ads spend in period"} />
            <Kpi label="From new patients" value={typed > 0 ? Number(d.new_total) / typed : null} format="pct" sub={typed > 0 ? "of payments marked new/returning" : "Not marked"} />
          </KpiRow>
        )}
        {d && Number(d.entries) > 0 && traced != null && traced < 0.5 && <p className="warnline">Less than half of revenue is traced to a lead. Add patient phone numbers to uploads so payments can be matched to the enquiry that brought them in.</p>}
      </Section>

      <Section n="02" title="Online payments" note="UPI (Google Pay, PhonePe, Paytm), cards and netbanking collected through Razorpay, PhonePe PG or Cashfree. They are added to revenue automatically.">
        <GatewayPayments />
      </Section>

      <Section n="03" title="Last 12 months" note="Calendar months ending with the selected period. Always shows the full year, whatever the date filter.">
        {!d ? <Loading h={220} /> : <MonthChart rows={d.by_month ?? []} />}
      </Section>

      <Section n="04" title="Where it came from" note="Matched payments use the lead's first marketing touch. Unmatched payments use the source the clinic entered.">
        <div className="two-col">
          <DataTable rows={d ? d.by_channel : null} csvName="revenue-by-source" empty="No revenue in this period." cols={[
            { key: "channel", label: "Source", render: (r: any) => <>{r.channel}{r.from_leads ? null : <span className="muted small"> · clinic-entered</span>}</> },
            { key: "revenue", label: "Revenue", align: "right", format: "inr" },
            { key: "share", label: "Share", align: "right", format: "pct", value: (r: any) => ratio(r.revenue, Number(d?.total)) },
            { key: "entries", label: "Payments", align: "right", format: "int" },
          ]} />
          <DataTable rows={d ? d.by_service : null} csvName="revenue-by-service" empty="No revenue in this period." cols={[
            { key: "service", label: "Service" },
            { key: "revenue", label: "Revenue", align: "right", format: "inr" },
            { key: "entries", label: "Payments", align: "right", format: "int" },
            { key: "avg", label: "Average", align: "right", format: "inr", value: (r: any) => ratio(r.revenue, r.entries) },
          ]} />
        </div>
      </Section>

      {canEdit && (
        <Section n="05" title="Add revenue">
          <div className="page-tabs" role="tablist">
            <button role="tab" className={tab === "single" ? "on" : ""} onClick={() => setTab("single")}>One payment</button>
            <button role="tab" className={tab === "bulk" ? "on" : ""} onClick={() => setTab("bulk")}>Upload Excel / CSV</button>
          </div>
          {tab === "single" ? <SingleForm onDone={f.refresh} /> : <BulkUpload onDone={f.refresh} />}
        </Section>
      )}

      <Section n={canEdit ? "06" : "05"} title="Payments" note="Up to 500 most recent in the selected period.">
        <EntriesTable rows={d ? d.entries_list : null} canEdit={canEdit} onChange={f.refresh} />
      </Section>

      {(batches.data?.length ?? 0) > 0 && (
        <Section n={canEdit ? "07" : "06"} title="Uploads" note="Undo removes the upload and every payment it added.">
          <BatchesTable rows={batches.data} canEdit={canEdit} onChange={f.refresh} />
        </Section>
      )}
    </Page>
  );
}

function MonthChart({ rows }: { rows: { date: string; revenue: number; entries: number }[] }) {
  const data = rows.map((r) => ({ ...r, revenue: Number(r.revenue), label: monthLabel(r.date) }));
  if (!data.some((r) => r.revenue > 0)) return <div className="empty chart-empty">No revenue recorded in these 12 months yet.</div>;
  return (
    <div className="chart" style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
          <CartesianGrid stroke="var(--rule)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={{ stroke: "var(--rule)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} tickFormatter={(v) => "₹" + fmt.compact(v)} width={52} />
          <Tooltip cursor={{ fill: "var(--hover)" }} contentStyle={{ background: "var(--paper)", border: "1px solid var(--rule)", borderRadius: 6, fontSize: 12 }}
            formatter={(v: any, _n: any, p: any) => [`${fmt.inr(v)} · ${fmt.int(p.payload.entries)} payments`, "Revenue"]} />
          <Bar dataKey="revenue" fill={C.navy} radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- single payment ----------
function SingleForm({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const amount = Number(String(v.amount).replace(/[₹,\s]/g, ""));
    if (!v.date || !Number.isFinite(amount) || amount <= 0) { setMsg({ ok: false, text: "Enter a date and an amount above ₹0." }); return; }
    if (v.date > todayIso()) { setMsg({ ok: false, text: "Date can't be in the future." }); return; }
    setBusy(true); setMsg(null);
    const row = { date: v.date, amount, invoice: v.invoice, service: v.service === "Other" ? v.service_other || "Other" : v.service,
      patient_type: v.patient_type, channel: v.channel, phone: v.phone, email: v.email, note: v.note };
    const { data, error } = await supabase.rpc("rpc_revenue_import", { p_rows: [row], p_file_name: null, p_source: "single" });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    if (data.inserted === 0) { setMsg({ ok: false, text: `Not added: ${data.skipped_rows?.[0]?.reason ?? "check the details"}.` }); return; }
    setMsg({ ok: true, text: `Added ${fmt.inr(amount)}. ${data.matched ? "Matched to a lead — it now counts against that lead's marketing source." : v.channel ? `No matching lead; counted under “${v.channel}”.` : "No matching lead and no source chosen; counted as “Not recorded”."}` });
    form.reset(); (form.elements.namedItem("date") as HTMLInputElement).value = todayIso();
    onDone();
  }
  return (
    <form className="form rev-form" onSubmit={submit}>
      <div className="rev-grid">
        <label>Date collected *<input name="date" type="date" defaultValue={todayIso()} max={todayIso()} required /></label>
        <label>Amount (₹) *<input name="amount" inputMode="decimal" placeholder="12,500" required /></label>
        <label>Invoice / bill no.<input name="invoice" placeholder="Stops double entry" autoComplete="off" /></label>
        <label>Service<select name="service" defaultValue=""><option value="">—</option>{SERVICES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>New or returning<select name="patient_type" defaultValue=""><option value="">—</option><option value="new">New patient</option><option value="returning">Returning patient</option></select></label>
        <label>Source (if no lead matches)<select name="channel" defaultValue=""><option value="">—</option>{SOURCES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Patient phone<input name="phone" inputMode="tel" placeholder="98450 12345" autoComplete="off" /></label>
        <label>Patient email<input name="email" type="email" autoComplete="off" /></label>
        <label className="span2">Note<input name="note" maxLength={300} placeholder="Admin note only — no clinical details" /></label>
      </div>
      <p className="muted small">Phone and email are only used to find the matching enquiry. They aren't saved with the payment.</p>
      <div className="btns"><button className="btn" disabled={busy}>{busy ? "Adding…" : "Add payment"}</button></div>
      {msg && <div className={msg.ok ? "notice" : "errorbox"}>{msg.text}</div>}
    </form>
  );
}

// ---------- bulk upload ----------
async function downloadTemplate() {
  const { default: writeXlsxFile } = await import("write-excel-file");
  const H = (value: string) => ({ value, fontWeight: "bold" as const, backgroundColor: "#0B1F3A", color: "#FFFFFF" });
  const header = ["Date", "Amount (₹)", "Invoice no", "Service", "Patient phone", "Patient email", "New/Returning", "Source", "Note"].map(H);
  const guide: any[][] = [
    [H("Column"), H("What to put"), H("Example")],
    ...[
      ["Date", "Day the money was collected. DD/MM/YYYY is fine.", "05/10/2026"],
      ["Amount (₹)", "Amount collected. Commas and ₹ are fine. Required.", "12,500"],
      ["Invoice no", "Bill or receipt number. The same number is never added twice.", "EDC-1042"],
      ["Service", "Category only: " + SERVICES.join(", "), "Implants"],
      ["Patient phone", "Used only to match the payment to the enquiry. Not stored.", "98450 12345"],
      ["Patient email", "Optional, used only for matching. Not stored.", ""],
      ["New/Returning", "New or Returning", "New"],
      ["Source", "If you know how they found you: " + SOURCES.join(", "), "Walk-in"],
      ["Note", "Short admin note. No clinical details.", ""],
    ].map((r) => r.map((value) => ({ value }))),
    [],
    [{ value: "Fill the 'Revenue' sheet, one row per payment, then upload it on the dashboard's Revenue page. Don't add patient names or treatment notes." }],
  ];
  await writeXlsxFile([[header], guide], {
    sheets: ["Revenue", "How to fill"],
    columns: [[14, 14, 14, 18, 16, 22, 15, 20, 30].map((width) => ({ width })), [{ width: 16 }, { width: 80 }, { width: 16 }]],
    fileName: "elites-revenue-template.xlsx",
  });
}

function BulkUpload({ onDone }: { onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<string | null>(null);
  const [sheet, setSheet] = useState<unknown[][] | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<Field, number>>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function load(fl: File) {
    setErr(null); setResult(null); setSheet(null);
    try {
      let rows: unknown[][];
      if (/\.csv$/i.test(fl.name)) {
        const text = await fl.text();
        const { default: Papa } = await import("papaparse");
        rows = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" }).data;
      } else if (/\.xlsx$/i.test(fl.name)) {
        const { default: readXlsxFile } = await import("read-excel-file");
        rows = (await readXlsxFile(fl)) as unknown[][];
      } else { setErr("Use an .xlsx or .csv file. For an old .xls file, open it in Excel and Save As .xlsx."); return; }
      // Header = first row with at least two filled cells.
      const h = rows.findIndex((r) => r.filter((c) => c != null && String(c).trim() !== "").length >= 2);
      if (h < 0 || rows.length - h < 2) { setErr("Couldn't find a header row followed by data."); return; }
      const body = rows.slice(h);
      setFile(fl.name); setSheet(body); setMapping(guessMapping(body[0]));
    } catch (e: any) { setErr(`Couldn't read the file: ${e.message ?? e}`); }
  }

  const headers = sheet?.[0] ?? [];
  const prepared = useMemo<PreparedRow[]>(() => (sheet ? prepareRows(sheet.slice(1), mapping, todayIso()) : []), [sheet, mapping]);
  const good = prepared.filter((r) => r.errors.length === 0);
  const goodTotal = good.reduce((a, r) => a + Number(r.data.amount ?? 0), 0);
  const missingRequired = mapping.date == null || mapping.amount == null;

  async function importRows() {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("rpc_revenue_import", { p_rows: good.map((r) => r.data), p_file_name: file, p_source: "bulk" });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setResult(data); setSheet(null); setFile(null); if (fileRef.current) fileRef.current.value = "";
    onDone();
  }

  return (
    <div className="bulk">
      <div className="btns">
        <label className="btn">Choose Excel / CSV file
          <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
        <button className="btn ghost" type="button" onClick={downloadTemplate}>Download template (.xlsx)</button>
      </div>
      <p className="muted small">Any layout works: the columns are matched automatically and you can fix them below. Patient names in the file are ignored. Phone/email are used for matching only and never stored.</p>
      {err && <div className="errorbox">{err}</div>}
      {result && (
        <div className="notice">
          <strong>Imported {fmt.int(result.inserted)} payment{result.inserted === 1 ? "" : "s"} · {fmt.inr(Number(result.total))}</strong>
          {" "}· {fmt.int(result.matched)} matched to a lead{result.skipped ? ` · ${fmt.int(result.skipped)} skipped` : ""}.
          {result.skipped_rows?.length > 0 && <ul className="small">{result.skipped_rows.slice(0, 10).map((s: any) => <li key={s.row}>File row {s.row}: {s.reason}</li>)}</ul>}
          <div className="small muted">Wrong file? Undo it under Uploads below.</div>
        </div>
      )}

      {sheet && (
        <>
          <h3 className="sub">{file} — check the columns</h3>
          <div className="map-grid">
            {FIELDS.map((fd) => (
              <label key={fd.key} title={fd.help}>{fd.label}{fd.required ? " *" : ""}
                <select value={mapping[fd.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [fd.key]: e.target.value === "" ? undefined : Number(e.target.value) }))}>
                  <option value="">— not in file —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{String(h ?? `Column ${i + 1}`)}</option>)}
                </select>
              </label>
            ))}
          </div>
          {missingRequired ? <div className="errorbox">Pick the Date and Amount columns to continue.</div> : (
            <>
              <p className="small"><Tag tone="good">{fmt.int(good.length)} ready · {fmt.inr(goodTotal)}</Tag>{" "}
                {prepared.length - good.length > 0 && <Tag tone="bad">{fmt.int(prepared.length - good.length)} with problems — will be left out</Tag>}</p>
              <DataTable rows={prepared} limit={50} cols={[
                { key: "row", label: "Row", align: "right" },
                { key: "status", label: "", render: (r: PreparedRow) => r.errors.length ? <Tag tone="bad">fix</Tag> : r.warnings.length ? <Tag tone="warn">check</Tag> : <Tag tone="good">ok</Tag>, value: (r) => r.errors.length * 2 + (r.warnings.length ? 1 : 0) },
                { key: "date", label: "Date", value: (r: PreparedRow) => r.data.date ?? "" },
                { key: "amount", label: "Amount", align: "right", format: "inr", value: (r: PreparedRow) => r.data.amount ?? null },
                { key: "invoice", label: "Invoice", value: (r: PreparedRow) => r.data.invoice ?? "" },
                { key: "service", label: "Service", value: (r: PreparedRow) => r.data.service ?? "" },
                { key: "match", label: "Match by", value: (r: PreparedRow) => (r.data.phone ? "phone" : r.data.email ? "email" : "—") },
                { key: "issues", label: "Issues", render: (r: PreparedRow) => <span className="small">{[...r.errors, ...r.warnings].join(" · ")}</span>, value: (r) => [...r.errors, ...r.warnings].join(" ") },
              ]} />
              <div className="btns">
                <button className="btn" disabled={busy || good.length === 0} onClick={importRows}>{busy ? "Importing…" : `Import ${fmt.int(good.length)} payments (${fmt.inr(goodTotal)})`}</button>
                <button className="btn ghost" type="button" onClick={() => { setSheet(null); setFile(null); if (fileRef.current) fileRef.current.value = ""; }}>Cancel</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------- lists ----------
function ConfirmButton({ label, confirm, onConfirm }: { label: string; confirm: string; onConfirm: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <button className={`btn ghost sm ${armed ? "danger" : ""}`} disabled={busy}
      onBlur={() => setArmed(false)}
      onClick={async (e) => { e.stopPropagation(); if (!armed) { setArmed(true); return; } setBusy(true); await onConfirm(); setBusy(false); setArmed(false); }}>
      {busy ? "…" : armed ? confirm : label}
    </button>
  );
}

function EntriesTable({ rows, canEdit, onChange }: { rows: any[] | null; canEdit: boolean; onChange: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      {err && <div className="errorbox">{err}</div>}
      <DataTable rows={rows} csvName="revenue-payments" limit={25} empty="No payments in this period." cols={[
        { key: "collected_on", label: "Date", render: (r: any) => dayLabel(r.collected_on) },
        { key: "amount_inr", label: "Amount", align: "right", format: "inr" },
        { key: "invoice_ref", label: "Invoice" },
        { key: "service_category", label: "Service" },
        { key: "channel", label: "Source" },
        { key: "lead_name", label: "Lead", render: (r: any) => r.lead_id ? <a href={`#/crm?lead=${r.lead_id}`}>{r.lead_name || "Lead"}</a> : <span className="muted">—</span>,
          value: (r: any) => r.lead_name ?? "" },
        { key: "match_method", label: "Matched", render: (r: any) => <span className="small muted">{MATCH[r.match_method] ?? ""}</span> },
        { key: "entry_source", label: "Added via", render: (r: any) => <span className="small">{VIA[r.entry_source] ?? r.entry_source}</span> },
        ...(canEdit ? [{ key: "x", label: "", render: (r: any) => r.batch_id ? <span className="small muted" title="Remove it by undoing its upload">in upload</span> :
          <ConfirmButton label="Remove" confirm="Confirm remove" onConfirm={async () => {
            const { error } = await supabase.from("revenue_entries").delete().eq("id", r.id);
            if (error) setErr(error.message); else onChange();
          }} /> }] : []),
      ]} />
    </>
  );
}

function BatchesTable({ rows, canEdit, onChange }: { rows: any[] | null; canEdit: boolean; onChange: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      {err && <div className="errorbox">{err}</div>}
      <DataTable rows={rows} limit={10} cols={[
        { key: "created_at", label: "Uploaded", render: (r: any) => new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) },
        { key: "file_name", label: "File" },
        { key: "inserted", label: "Added", align: "right", format: "int" },
        { key: "skipped", label: "Skipped", align: "right", format: "int" },
        { key: "matched", label: "Matched", align: "right", format: "int" },
        { key: "total_inr", label: "Total", align: "right", format: "inr" },
        { key: "uploaded_by", label: "By" },
        ...(canEdit ? [{ key: "x", label: "", render: (r: any) => <ConfirmButton label="Undo" confirm={`Remove ${r.inserted} payments`} onConfirm={async () => {
          const { error } = await supabase.rpc("rpc_revenue_undo_batch", { p_batch: r.id });
          if (error) setErr(error.message); else onChange();
        }} /> }] : []),
      ]} />
    </>
  );
}
