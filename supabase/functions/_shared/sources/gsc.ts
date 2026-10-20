import { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { googleAccessToken, googleJson } from "../google.ts";
import { upsertBatched } from "../util.ts";

async function query(site: string, token: string, body: Record<string, unknown>) {
  const rows: any[] = [];
  let startRow = 0;
  const rowLimit = 25000;
  while (true) {
    const res = await googleJson(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, token,
      { method: "POST", body: JSON.stringify({ ...body, rowLimit, startRow, dataState: "all" }) },
    );
    const got = res.rows ?? [];
    rows.push(...got);
    if (got.length < rowLimit) break;
    startRow += rowLimit;
  }
  return rows;
}

export function isBranded(q: string, terms: string[]): boolean {
  const s = q.toLowerCase();
  return terms.some((t) => s.includes(t.toLowerCase()));
}

export async function syncGsc(db: SupabaseClient, site: string, start: string, end: string): Promise<number> {
  const token = await googleAccessToken();
  const { data: s } = await db.from("settings").select("value").eq("key", "branded_terms").maybeSingle();
  const branded: string[] = Array.isArray(s?.value) ? s!.value : [];
  const base = { startDate: start, endDate: end };
  let n = 0;

  // Totals (include anonymized queries)
  const totals = await query(site, token, { ...base, dimensions: ["date"] });
  const byDevice = await query(site, token, { ...base, dimensions: ["date", "device"] });
  const byCountry = await query(site, token, { ...base, dimensions: ["date", "country"] });
  const tRows = [
    ...totals.map((r) => ({ date: r.keys[0], device: "ALL", country: "ALL", ...m(r) })),
    ...byDevice.map((r) => ({ date: r.keys[0], device: r.keys[1], country: "ALL", ...m(r) })),
    ...byCountry.map((r) => ({ date: r.keys[0], device: "ALL", country: r.keys[1].toUpperCase(), ...m(r) })),
  ];
  n += await upsertBatched(db, "gsc_daily_totals", tRows, "date,device,country");

  // Query x page (anonymized queries are not returned here)
  const qp = await query(site, token, { ...base, dimensions: ["date", "query", "page"] });
  n += await upsertBatched(db, "gsc_daily_query_page", qp.map((r) => ({
    date: r.keys[0], query: r.keys[1], page: r.keys[2], ...m(r), is_branded: isBranded(r.keys[1], branded),
  })), "date,query,page", 1000);

  // Search appearance — Google may reject some combinations; non-fatal.
  try {
    const app = await query(site, token, { ...base, dimensions: ["date", "searchAppearance"] });
    n += await upsertBatched(db, "gsc_daily_appearance", app.map((r) => ({
      date: r.keys[0], appearance: r.keys[1], clicks: r.clicks, impressions: r.impressions,
    })), "date,appearance");
  } catch (_e) { /* not available for this property/range */ }

  return n;
}

function m(r: any) {
  return { clicks: r.clicks ?? 0, impressions: r.impressions ?? 0, position_weighted: (r.position ?? 0) * (r.impressions ?? 0) };
}
