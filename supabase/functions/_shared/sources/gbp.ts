import { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { googleAccessToken, googleJson } from "../google.ts";
import { upsertBatched } from "../util.ts";

// Business Profile Performance API daily metrics.
export const GBP_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_CONVERSATIONS", "BUSINESS_DIRECTION_REQUESTS", "CALL_CLICKS", "WEBSITE_CLICKS",
  "BUSINESS_BOOKINGS",
];

const parts = (iso: string) => ({ y: +iso.slice(0, 4), m: +iso.slice(5, 7), d: +iso.slice(8, 10) });

/** Resolve "locations/{id}" for the clinic. Uses a stored id if it looks like a location id. */
export async function resolveLocation(db: SupabaseClient, token: string, stored: string | null): Promise<string> {
  if (stored?.startsWith("locations/")) return stored;
  // A bare numeric Business Profile ID is the location id; skips the account-management lookup.
  if (stored && /^\d{6,}$/.test(stored)) return `locations/${stored}`;
  const accts = await googleJson("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", token);
  for (const a of accts.accounts ?? []) {
    let pageToken = "";
    do {
      const url = `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title,storefrontAddress&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ""}`;
      const res = await googleJson(url, token);
      const hit = (res.locations ?? []).find((l: any) => /elites\s*dental/i.test(l.title ?? ""));
      if (hit) {
        await db.from("integrations").update({ external_id: hit.name }).eq("source", "gbp");
        return hit.name;
      }
      pageToken = res.nextPageToken ?? "";
    } while (pageToken);
  }
  throw new Error("Elites Dental Care location not found under the connected Google account");
}

export async function syncGbp(db: SupabaseClient, stored: string | null, start: string, end: string): Promise<number> {
  const token = await googleAccessToken();
  const loc = await resolveLocation(db, token, stored);
  const s = parts(start), e = parts(end);
  const q = new URLSearchParams();
  GBP_METRICS.forEach((mtr) => q.append("dailyMetrics", mtr));
  q.set("dailyRange.start_date.year", String(s.y)); q.set("dailyRange.start_date.month", String(s.m)); q.set("dailyRange.start_date.day", String(s.d));
  q.set("dailyRange.end_date.year", String(e.y)); q.set("dailyRange.end_date.month", String(e.m)); q.set("dailyRange.end_date.day", String(e.d));
  const res = await googleJson(`https://businessprofileperformance.googleapis.com/v1/${loc}:fetchMultiDailyMetricsTimeSeries?${q}`, token);

  const rows: Record<string, unknown>[] = [];
  for (const block of res.multiDailyMetricTimeSeries ?? []) {
    for (const series of block.dailyMetricTimeSeries ?? []) {
      for (const dv of series.timeSeries?.datedValues ?? []) {
        const d = dv.date;
        rows.push({
          date: `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`,
          metric: series.dailyMetric, value: Number(dv.value ?? 0),
        });
      }
    }
  }
  let n = await upsertBatched(db, "gbp_daily_metrics", rows, "date,metric");

  // Search keywords: one request per calendar month so each row maps to a single month.
  // The current, incomplete month is skipped (Google publishes it after month end).
  const months: string[] = [];
  const cur = new Date(start.slice(0, 7) + "-01T00:00:00Z");
  const thisMonth = new Date().toISOString().slice(0, 7);
  while (cur.toISOString().slice(0, 7) <= end.slice(0, 7)) {
    if (cur.toISOString().slice(0, 7) < thisMonth) months.push(cur.toISOString().slice(0, 10));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  for (const m of months) {
    const y = m.slice(0, 4), mo = String(+m.slice(5, 7));
    const kwRows: Record<string, unknown>[] = [];
    let pageToken = "";
    do {
      const kq = new URLSearchParams({
        "monthlyRange.start_month.year": y, "monthlyRange.start_month.month": mo,
        "monthlyRange.end_month.year": y, "monthlyRange.end_month.month": mo, pageSize: "100",
      });
      if (pageToken) kq.set("pageToken", pageToken);
      const kr = await googleJson(`https://businessprofileperformance.googleapis.com/v1/${loc}/searchkeywords/impressions/monthly?${kq}`, token);
      for (const k of kr.searchKeywordsCounts ?? []) {
        kwRows.push({
          month: m, keyword: k.searchKeyword,
          impressions: k.insightsValue?.value != null ? Number(k.insightsValue.value) : null,
          threshold: k.insightsValue?.threshold != null ? Number(k.insightsValue.threshold) : null,
        });
      }
      pageToken = kr.nextPageToken ?? "";
    } while (pageToken);
    n += await upsertBatched(db, "gbp_monthly_keywords", kwRows, "month,keyword");
  }
  return n;
}
