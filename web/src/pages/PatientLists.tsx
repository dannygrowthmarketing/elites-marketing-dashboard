import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DataTable, Kpi, KpiRow, Loading, Section } from "../components/ui";
import { supabase } from "../lib/supabase";
import { useRpc } from "../state";
import { fmt } from "../lib/metrics";
import { C } from "./Overview";

type Seg = {
  patients: number; messageable: number; opted_out: number; recent_90: number; recall_due: number; lapsed: number;
  repeat: number; one_visit: number; first_visit_min: string | null; last_visit_max: string | null;
  by_month: { month: string; new: number }[] | null;
  oil_shop: number; oil_shop_patients: number; oil_shop_arrived: number; oil_shop_booked: number;
};
type Row = { lead_id: string; name: string | null; phone_e164: string | null; first_visit: string; last_visit: string; visits: number; opted_out: boolean };

const SEGMENTS = [
  { k: "recall_due", label: "Due for check-up", note: "Last visit 6–12 months ago." },
  { k: "lapsed", label: "Not seen in a year", note: "Last visit more than 12 months ago." },
  { k: "one_visit", label: "Came once", note: "One visit only." },
  { k: "repeat", label: "Repeat patients", note: "Two or more visits." },
  { k: "all", label: "All", note: "" },
] as const;

const ax = { fontSize: 11, fill: "#5C6F6A" };
const day = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const mon = (m: string) => new Date(m + "-01T00:00:00").toLocaleString("en-IN", { month: "short", year: "2-digit" });
const first = (n: string | null) => (n ?? "").replace(/^(mr|mrs|ms|dr|baby|kid)\.?\s*/i, "").split(/[\s.]+/)[0] || "there";

function recallText(r: Row, seg: string) {
  const hi = `Hi ${first(r.name)}, this is Elites Dental Care, TC Palya.`;
  const body = seg === "repeat"
    ? " Thank you for trusting us with your smile. It's time for your routine check-up and cleaning."
    : ` It's been a while since your visit on ${day(r.last_visit)}. A check-up every 6 months keeps small problems small.`;
  return `${hi}${body} Reply here and we'll find a time that suits you. (Reply STOP if you'd rather not hear from us.)`;
}

export default function PatientLists({ n }: { n: string }) {
  const [seg, setSeg] = useState<(typeof SEGMENTS)[number]["k"]>("recall_due");
  const [bump, setBump] = useState(0);
  const s = useRpc<Seg>("rpc_contact_segments", {}, [bump]);
  const list = useRpc<Row[]>("rpc_contact_list", { p_segment: seg, p_limit: 1000 }, [bump]);
  const d = s.data;
  if (s.loading && !d) return <Section n={n} title="Patient lists & recall"><Loading h={240} /></Section>;
  if (!d || !d.patients) return null;
  const optOut = async (r: Row) => {
    await supabase.from("contact_lists").update({ opted_out_at: new Date().toISOString() }).eq("lead_id", r.lead_id);
    setBump((b) => b + 1);
  };
  const cur = SEGMENTS.find((x) => x.k === seg)!;
  const rows = (list.data ?? []).filter((r) => !r.opted_out);
  return (
    <Section n={n} title="Patient lists & recall" note={<>Imported from the Click4Appointment patient register ({d.first_visit_min ? day(d.first_visit_min) : "—"} to {d.last_visit_max ? day(d.last_visit_max) : "—"}). Visits after that come in from new bookings. Gender isn't stored.</>}>
      <KpiRow>
        <Kpi logo="crm" big label="Patients on file" value={d.patients} sub={`${fmt.int(d.messageable)} can be messaged · ${fmt.int(d.opted_out)} opted out`} />
        <Kpi logo="crm" big label="Came only once" value={d.patients ? d.one_visit / d.patients : null} format="pct" invert sub={`${fmt.int(d.one_visit)} patients never returned`} />
        <Kpi logo="crm" big label="Due for check-up" value={d.recall_due} sub="last visit 6–12 months ago" />
        <Kpi logo="crm" big label="Not seen in a year" value={d.lapsed} invert sub="win-back list" />
      </KpiRow>
      {d.by_month && d.by_month.length > 1 && (
        <div className="chart-card">
          <div className="chart-title">New patients per month (first visit)</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={d.by_month.map((m) => ({ ...m, label: mon(m.month) }))} margin={{ top: 8, right: 4, left: -14, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#E4ECEA" />
              <XAxis dataKey="label" tick={ax} interval="preserveStartEnd" minTickGap={16} /><YAxis tick={ax} allowDecimals={false} />
              <Tooltip /><Bar dataKey="new" name="New patients" fill={C.teal} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="gbpx-explorer-head">
        <div className="seg sm">
          {SEGMENTS.map((x) => <button key={x.k} className={seg === x.k ? "on" : ""} onClick={() => setSeg(x.k)}>{x.label}</button>)}
        </div>
        <span className="small muted">{cur.note}</span>
      </div>
      {list.loading && !list.data ? <Loading h={160} /> : (
        <DataTable rows={rows} csvName={`patients-${seg}`} limit={20} initialSort={{ key: "last_visit", dir: -1 }} empty="No patients in this group." cols={[
          { key: "name", label: "Patient", render: (r: Row) => r.name ?? "—" },
          { key: "last_visit", label: "Last visit", render: (r: Row) => day(r.last_visit) },
          { key: "visits", label: "Visits", align: "right", format: "int" },
          { key: "act", label: "Message", render: (r: Row) => r.phone_e164 ? (
            <span className="pl-acts">
              <a className="btn ghost sm" target="_blank" rel="noreferrer" href={`https://wa.me/${r.phone_e164.replace("+", "")}?text=${encodeURIComponent(recallText(r, seg))}`}>WhatsApp</a>
              <a className="btn ghost sm" href={`tel:${r.phone_e164}`}>Call</a>
              <button className="btn ghost sm" onClick={() => optOut(r)} title="Never include in recalls or campaigns">Opted out</button>
            </span>) : "—", value: () => 0 },
        ]} />
      )}
      <p className="small muted">"WhatsApp" opens a chat on the clinic phone with a ready recall message for that patient; staff check it and press send. Keep it to about 30 a day from the app so WhatsApp doesn't flag the number. Once the WhatsApp Business API is connected, these lists send as approved templates with a Stop button instead. Mark anyone who says stop as "Opted out" and they drop off every list.</p>

      <div className="card pl-partner">
        <strong>Oil-shop partner list: {fmt.int(d.oil_shop)} contacts, not messaged</strong>
        <p className="small">These people gave their numbers to another shop, so they're held only as a one-way fingerprint: no names or numbers are stored and nothing can be sent to them. When one of them books or messages Elites on their own, the CRM credits the oil-shop partnership.</p>
        <KpiRow>
          <Kpi label="Already Elites patients" value={d.oil_shop_patients} />
          <Kpi label="Reached Elites since listed" value={d.oil_shop_arrived} />
          <Kpi label="Booked since listed" value={d.oil_shop_booked} />
        </KpiRow>
        <p className="small muted">To reach them properly: a QR card at the shop counter ("Scan to WhatsApp Elites: free check-up") and WhatsApp ads around TC Palya. Scanning starts the chat, which is their opt-in.</p>
      </div>
    </Section>
  );
}
