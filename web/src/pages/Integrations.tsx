import { useEffect, useState } from "react";
import { DataTable, Page, Section, Tag } from "../components/ui";
import { useFilters, useTable } from "../state";
import { callFunction, supabase } from "../lib/supabase";
import { fmt } from "../lib/metrics";
import { StatusTag } from "./Overview";

const NEXT: Record<string, string> = {
  ga4: "Connect Google below. Uses the GA4 Data API (read-only).",
  gsc: "Connect Google below. Uses the Search Console API (read-only).",
  gbp: "Access requested from Google on 20 Oct 2026 (case 6-1332000041917, usually 7–10 working days). Data starts flowing automatically after approval, with ~18 months of history.",
  google_ads: "Connect Google. Access is granted to the Cloud project (developer tokens were retired in Sept 2026).",
  clarity: "Tag is installed and recording. New Clarity projects usually answer the export API only after their first daily processing; the 08:00 sync retries automatically. If it still fails, create a new token in Clarity → Settings → Data export and paste it below.",
  meta_ads: "Paste a Meta system-user token with ads_read and the ad account ID below when access is provided.",
  wordpress: "Install the WPCode snippet that posts form submissions and Click4Appointment bookings to this dashboard.",
};

export default function Integrations() {
  const f = useFilters();
  const isOwner = f.role === "owner";
  const integ = useTable<any>("integrations", (q) => q.select("*").order("source"));
  const runs = useTable<any>("sync_runs", (q) => q.select("*").order("started_at", { ascending: false }).limit(40));
  const [creds, setCreds] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { supabase.rpc("credential_status").then(({ data }) => setCreds(data ?? [])); }, [f.refreshKey]);
  useEffect(() => {
    const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
    if (q.get("google") === "connected") setMsg("Google connected. First syncs are running — refresh in a minute.");
    if (q.get("google") === "error") setMsg(`Google connection failed: ${q.get("reason")}`);
  }, []);

  const google = creds.find((c) => c.provider === "google");
  async function connectGoogle() {
    setBusy("google"); setMsg(null);
    try { const { url } = await callFunction<{ url: string }>("google-oauth", {}); location.href = url; }
    catch (e: any) { setMsg(e.message); setBusy(null); }
  }
  async function sync(source: string, kind = "incremental") {
    setBusy(source); setMsg(null);
    try {
      const r = await callFunction<any>("sync", { source, kind });
      setMsg(r.ok ? `${source}: ${fmt.int(r.rows)} rows (${r.window?.start ?? ""} → ${r.window?.end ?? ""})` : `${source}: ${r.status} — ${r.error}`);
    } catch (e: any) { setMsg(`${source}: ${e.message}`); }
    setBusy(null); f.refresh();
  }
  async function saveToken(provider: "clarity" | "meta", form: HTMLFormElement) {
    const d = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setBusy(provider);
    try { await callFunction("credentials", { action: "save", provider, token: d.token, external_id: d.external_id }); setMsg(`${provider} saved.`); form.reset(); }
    catch (e: any) { setMsg(e.message); }
    setBusy(null); f.refresh();
  }

  return (
    <Page eyebrow="System" title="Integrations & sync status"
      intro="What's connected, how far back data goes, and what each source still needs. Credentials are stored server-side and never sent to the browser.">
      {msg && <div className="notice">{msg}</div>}
      <Section n="01" title="Google account">
        <div className="card row">
          <div>
            <strong>{google?.connected ? `Connected as ${google.account_email ?? "Google account"}` : "Not connected"}</strong>
            <div className="muted small">One consent covers GA4, Search Console, Business Profile and Google Ads (read-only scopes, plus business.manage which Google requires for Profile performance data).</div>
          </div>
          {isOwner && <button className="btn" onClick={connectGoogle} disabled={busy === "google"}>{google?.connected ? "Reconnect" : "Connect Google"}</button>}
        </div>
      </Section>

      <Section n="02" title="Sources">
        <div className="integ-grid">
          {(integ.data ?? []).map((i) => (
            <article key={i.source} className="card integ">
              <div className="integ-top"><h3>{i.label}</h3><StatusTag s={i.status} /></div>
              <dl className="kv">
                <dt>ID</dt><dd>{i.external_id ?? "—"}</dd>
                <dt>Earliest available</dt><dd>{i.earliest_available ?? "—"}</dd>
                <dt>Imported</dt><dd>{i.earliest_imported ? `${i.earliest_imported} → ${i.latest_imported}` : "—"}</dd>
                <dt>Backfill</dt><dd>{i.backfill_complete ? <Tag tone="good">complete</Tag> : i.earliest_imported ? <Tag tone="warn">in progress</Tag> : "—"}</dd>
                <dt>Last success</dt><dd>{i.last_success_at ? new Date(i.last_success_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</dd>
                <dt>Rows imported</dt><dd>{fmt.int(i.records_total)}</dd>
                <dt>Schedule</dt><dd>{i.sync_frequency}</dd>
              </dl>
              {i.last_error && <div className="errorbox small">{i.last_error}</div>}
              <p className="small">{i.limitations}</p>
              {i.status !== "connected" && <p className="small next"><strong>Next:</strong> {NEXT[i.source]}</p>}
              {(f.role === "owner" || f.role === "editor") && !["wordpress"].includes(i.source) && (
                <div className="btns">
                  <button className="btn ghost" disabled={busy === i.source} onClick={() => sync(i.source)}>{busy === i.source ? "Syncing…" : "Sync now"}</button>
                  {["ga4", "gsc", "gbp", "google_ads", "meta_ads"].includes(i.source) && !i.backfill_complete && i.status === "connected" &&
                    <button className="btn ghost" disabled={busy === i.source} onClick={() => sync(i.source, "backfill")}>Backfill next chunk</button>}
                </div>
              )}
              {isOwner && i.source === "clarity" && (
                <form className="inline-form" onSubmit={(e) => { e.preventDefault(); saveToken("clarity", e.currentTarget); }}>
                  <input name="token" type="password" placeholder="Clarity API token" autoComplete="off" required />
                  <button className="btn ghost">Save</button>
                </form>
              )}
              {isOwner && i.source === "meta_ads" && (
                <form className="inline-form" onSubmit={(e) => { e.preventDefault(); saveToken("meta", e.currentTarget); }}>
                  <input name="external_id" placeholder="Ad account ID (act_…)" required />
                  <input name="token" type="password" placeholder="System-user token" autoComplete="off" required />
                  <button className="btn ghost">Save</button>
                </form>
              )}
            </article>
          ))}
        </div>
      </Section>

      <Section n="03" title="Sync log" note="Daily syncs run between 06:00 and 08:00 IST. While a backfill is in progress, the next historical chunk runs every 15 minutes.">
        <DataTable rows={runs.data} limit={20} csvName="sync-log" cols={[
          { key: "started_at", label: "Started", render: (r) => new Date(r.started_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" }) },
          { key: "source", label: "Source" }, { key: "kind", label: "Kind" },
          { key: "status", label: "Result", render: (r) => <Tag tone={r.status === "success" ? "good" : r.status === "running" ? "info" : "bad"}>{r.status}</Tag> },
          { key: "range", label: "Range", value: (r) => (r.range_start ? `${r.range_start} → ${r.range_end}` : "—") },
          { key: "rows_upserted", label: "Rows", align: "right", format: "int" },
          { key: "error", label: "Error", render: (r) => <span className="small">{r.error ?? ""}</span> },
        ]} />
      </Section>
    </Page>
  );
}
