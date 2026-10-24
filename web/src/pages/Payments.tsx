import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Kpi, KpiRow, Loading, Tag, useRangeArgs } from "../components/ui";
import { useRpc, useTable } from "../state";
import { fmt } from "../lib/metrics";
import { Logo, MARKS } from "../components/Logo";

const METHOD_MARK: Record<string, string> = { "Google Pay": "gpay", PhonePe: "phonepe", "PhonePe PG (UPI)": "phonepe", Paytm: "paytm", BHIM: "upi", "Amazon Pay": "upi", "Other UPI": "upi", Card: "card", Netbanking: "bank", Wallet: "card" };
const GW = ["razorpay", "phonepe", "cashfree"];

export function GatewayPayments() {
  const { range } = useRangeArgs();
  const s = useRpc<any>("rpc_payment_summary", range);
  const integ = useTable<any>("integrations", (q) => q.select("source,label,status,records_total").in("source", GW));
  if (s.error) return <div className="pending">Payment gateways aren't set up yet — run the latest SQL file in Supabase, then add a gateway on <a href="#/integrations">Integrations</a>.</div>;
  if (!s.data) return <Loading />;
  const d = s.data;
  const live = (integ.data ?? []).filter((i) => i.status === "connected" || i.status === "pending_approval");
  const methods = (d.by_method ?? []).map((m: any) => ({ ...m, amount: +m.amount, color: MARKS[METHOD_MARK[m.method] ?? "card"]?.hex ?? "#5B6B82" }));
  return (
    <>
      <div className="gw-row">
        {GW.map((g) => { const i = (integ.data ?? []).find((x) => x.source === g); return (
          <div key={g} className={`gw-card ${i?.status === "connected" ? "on" : ""}`}>
            <Logo id={g} size={34} />
            <div><strong>{i?.label?.split(" (")[0] ?? g}</strong><br />
              {i?.status === "connected" ? <Tag tone="good">Receiving</Tag> : i?.status === "pending_approval" ? <Tag tone="info">Waiting for first payment</Tag> : <Tag>Not set up</Tag>}</div>
          </div>
        ); })}
        <a className="btn ghost" href="#/integrations">Set up a gateway →</a>
      </div>
      {Number(d.payments) === 0 ? (
        <div className="empty chart-empty">{live.length ? "No gateway payments in this period yet." : "Connect Razorpay, PhonePe or Cashfree to see online payments here — GPay and PhonePe UPI payments show which app paid."}</div>
      ) : (
        <>
          <KpiRow>
            <Kpi logo="rupee" big label="Collected online" value={+d.collected} format="inr" />
            <Kpi logo="upi" label="Payments" value={+d.payments} />
            <Kpi logo="reserve" label="Refunded" value={+d.refunded} format="inr" invert />
            <Kpi logo="crm" label="Matched to a lead" value={+d.payments ? +d.matched / +d.payments : null} format="pct" />
            <Kpi logo="card" label="Failed attempts" value={+d.failed} invert />
          </KpiRow>
          <div className="grid2">
            <div className="chart">
              <div className="chart-title">How patients paid</div>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={methods} dataKey="amount" nameKey="method" innerRadius={60} outerRadius={95} paddingAngle={2}>
                    {methods.map((m: any) => <Cell key={m.method} fill={m.color} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => fmt.inr(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="method-legend">{methods.map((m: any) => <span key={m.method}><Logo id={METHOD_MARK[m.method] ?? "card"} size={22} />{m.method} <b>{fmt.inr(m.amount)}</b> <span className="muted">· {m.n}</span></span>)}</div>
            </div>
            <div className="chart">
              <div className="chart-title">Collected per day</div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={(d.daily ?? []).map((x: any) => ({ ...x, amount: +x.amount, label: new Date(x.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) }))}>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt.compact(v)} />
                  <Tooltip formatter={(v: any) => fmt.inr(v)} />
                  <Bar dataKey="amount" fill="#C9A84C" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </>
  );
}
