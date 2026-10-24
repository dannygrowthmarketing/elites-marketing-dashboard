import { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { admin, fetchRetry, upsertBatched } from "../util.ts";
import { NotAuthorized } from "../google.ts";

// Mailchimp Marketing API. API key format "<key>-<dc>" (e.g. abc123-us21); the data centre is the API host.
// Pulls audiences (size, averages) and reports for campaigns sent in the last 18 months. Totals only.

export function mailchimpBase(key: string): string {
  const dc = key.split("-").pop() ?? "";
  if (!/^[a-z]+\d+$/.test(dc)) throw new Error("Mailchimp API key should end with the data centre, e.g. -us21");
  return `https://${dc}.api.mailchimp.com/3.0`;
}

async function mc(base: string, key: string, path: string) {
  const r = await fetchRetry(`${base}${path}`, { headers: { Authorization: `Basic ${btoa(`dashboard:${key}`)}` } });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) throw new NotAuthorized(`Mailchimp ${r.status}: ${body?.detail ?? "invalid API key"}`);
  if (!r.ok) throw new Error(`Mailchimp ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

const n = (v: unknown) => Number(v ?? 0);

export async function syncMailchimp(db: SupabaseClient): Promise<number> {
  const { data } = await admin().rpc("svc_get_credential", { p_provider: "mailchimp" });
  const key: string | undefined = data?.[0]?.api_token;
  if (!key) throw new NotAuthorized("Mailchimp API key not set");
  const base = mailchimpBase(key);
  const now = new Date().toISOString();
  let count = 0;

  const lists = await mc(base, key, "/lists?count=100&fields=lists.id,lists.name,lists.stats");
  count += await upsertBatched(db, "email_audiences", (lists.lists ?? []).map((l: any) => ({
    list_id: l.id, name: l.name, member_count: n(l.stats?.member_count), unsubscribe_count: n(l.stats?.unsubscribe_count),
    cleaned_count: n(l.stats?.cleaned_count), campaign_count: n(l.stats?.campaign_count),
    avg_open_rate: l.stats?.open_rate ?? null, avg_click_rate: l.stats?.click_rate ?? null,
    last_sub_date: l.stats?.last_sub_date || null, synced_at: now,
  })), "list_id");

  const since = new Date(Date.now() - 548 * 864e5).toISOString();
  const fields = "reports.id,reports.campaign_title,reports.subject_line,reports.list_id,reports.type,reports.send_time,reports.emails_sent," +
    "reports.abuse_reports,reports.unsubscribed,reports.bounces,reports.opens,reports.clicks,total_items";
  for (let offset = 0; offset < 2000; offset += 100) {
    const page = await mc(base, key, `/reports?count=100&offset=${offset}&since_send_time=${encodeURIComponent(since)}&fields=${fields}`);
    const rows = (page.reports ?? []).map((r: any) => ({
      campaign_id: r.id, list_id: r.list_id ?? null, title: r.campaign_title ?? null, subject: r.subject_line ?? null,
      campaign_type: r.type ?? null, send_time: r.send_time || null, emails_sent: n(r.emails_sent),
      opens: n(r.opens?.opens_total), unique_opens: n(r.opens?.unique_opens), open_rate: r.opens?.open_rate ?? null,
      clicks: n(r.clicks?.clicks_total), unique_clicks: n(r.clicks?.unique_clicks), click_rate: r.clicks?.click_rate ?? null,
      unsubscribed: n(r.unsubscribed), hard_bounces: n(r.bounces?.hard_bounces), soft_bounces: n(r.bounces?.soft_bounces),
      abuse_reports: n(r.abuse_reports), synced_at: now,
    }));
    count += await upsertBatched(db, "email_campaigns", rows, "campaign_id");
    if (rows.length < 100) break;
  }
  return count;
}
