import { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { admin, fetchRetry, todayLocal, upsertBatched } from "../util.ts";
import { NotAuthorized } from "../google.ts";

// Clarity Data Export API: last 1–3 days only, 10 requests/project/day.
// We take one snapshot per dimension per day (window = 1 day) => 4 calls/day.
const DIMENSIONS = [null, "Device", "Browser", "URL"];

export async function syncClarity(db: SupabaseClient): Promise<number> {
  const { data } = await admin().rpc("svc_get_credential", { p_provider: "clarity" });
  const token = data?.[0]?.api_token;
  if (!token) throw new NotAuthorized("Clarity API token not set");
  const today = todayLocal();
  const rows: Record<string, unknown>[] = [];

  for (const dim of DIMENSIONS) {
    const q = new URLSearchParams({ numOfDays: "1" });
    if (dim) q.set("dimension1", dim);
    const r = await fetchRetry(`https://www.clarity.ms/export-data/api/v1/project-live-insights?${q}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    }, 2);
    if (r.status === 401 || r.status === 403) throw new NotAuthorized(`Clarity ${r.status}`);
    if (!r.ok) throw new Error(`Clarity ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const body = await r.json();
    for (const metric of body ?? []) {
      for (const info of metric.information ?? []) {
        const dval = dim ? String(info[dim] ?? "(unknown)") : "ALL";
        rows.push({
          captured_on: today, window_days: 1, metric: metric.metricName,
          dimension: dim ?? "ALL", dimension_value: dval, payload: info,
        });
      }
    }
  }
  return await upsertBatched(db, "clarity_snapshots", rows, "captured_on,window_days,metric,dimension,dimension_value");
}
