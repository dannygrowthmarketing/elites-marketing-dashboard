import { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { admin, fetchRetry, todayLocal, upsertBatched } from "../util.ts";
import { NotAuthorized } from "../google.ts";

// Clarity Data Export API: last 1–3 days only, 10 requests/project/day.
// We take one snapshot per dimension per day (window = 1 day) => 3 calls/day.
// Every call needs dimension1 (a call without it returns 400). Totals = sum over Device.
const DIMENSIONS: (string | null)[] = ["Device", "Channel", "URL"];

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
        // Field casing differs from the parameter (dimension1=URL returns "Url").
        const key = dim ? Object.keys(info).find((k) => k.toLowerCase() === dim.toLowerCase()) : undefined;
        const dval = dim ? String((key && info[key]) ?? "(unknown)") : "ALL";
        rows.push({
          captured_on: today, window_days: 1, metric: metric.metricName,
          dimension: dim ?? "ALL", dimension_value: dval, payload: info,
        });
      }
    }
  }
  // Clarity can return several rows with the same dimension value for one metric
  // (e.g. a URL listed twice, or rows missing the dimension). Keep all of them:
  // a single row is stored as-is, repeats are stored together as { items: [...] }.
  const byKey = new Map<string, Record<string, any>>();
  for (const r of rows) {
    const k = `${r.metric}|${r.dimension}|${r.dimension_value}`;
    const cur = byKey.get(k);
    if (!cur) { byKey.set(k, r); continue; }
    const items = cur.payload?.items && cur._merged ? cur.payload.items : [cur.payload];
    byKey.set(k, { ...cur, payload: { items: [...items, r.payload] }, _merged: true });
  }
  const unique = [...byKey.values()].map(({ _merged, ...r }) => r);
  return await upsertBatched(db, "clarity_snapshots", unique, "captured_on,window_days,metric,dimension,dimension_value");
}
