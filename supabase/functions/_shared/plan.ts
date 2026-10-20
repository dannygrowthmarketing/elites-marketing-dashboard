// Pure planning logic for sync windows. No I/O — unit tested.

export type SourceKey = "ga4" | "gsc" | "gbp" | "google_ads" | "meta_ads";

export interface SourceSpec {
  chunkDays: number;        // backfill chunk size
  trailingDays: number;     // incremental re-pull window (late-arriving data)
  lagDays: number;          // newest date the API has (0 = today)
  floor: (today: string) => string; // earliest date the API can return
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const addMonths = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

export const SPECS: Record<SourceKey, SourceSpec> = {
  // GA4 property 548000513 — Data API returns from property creation; stop when an empty chunk is hit.
  ga4: { chunkDays: 90, trailingDays: 4, lagDays: 1, floor: () => "2015-08-14" },
  // Search Console keeps 16 months.
  gsc: { chunkDays: 30, trailingDays: 5, lagDays: 2, floor: (t) => addDays(addMonths(t, -16), 1) },
  // Business Profile Performance API: ~18 months of daily data.
  gbp: { chunkDays: 180, trailingDays: 7, lagDays: 3, floor: (t) => addDays(addMonths(t, -18), 1) },
  // Account 520-119-6364 has history from Feb 2019.
  google_ads: { chunkDays: 90, trailingDays: 7, lagDays: 0, floor: () => "2019-02-01" },
  // Meta insights: 37 months max.
  meta_ads: { chunkDays: 90, trailingDays: 7, lagDays: 0, floor: (t) => addDays(addMonths(t, -37), 1) },
};

export interface State { earliest_imported: string | null; latest_imported: string | null; backfill_complete: boolean }

export interface Window { start: string; end: string; kind: "incremental" | "backfill"; finishesBackfill: boolean }

/** Incremental: from (latest - trailing) to newest available. First run seeds with one chunk ending today-lag. */
export function incrementalWindow(src: SourceKey, s: State, today: string): Window | null {
  const spec = SPECS[src];
  const end = addDays(today, -spec.lagDays);
  const floor = spec.floor(today);
  let start: string;
  if (!s.latest_imported) start = addDays(end, -(spec.chunkDays - 1));
  else start = addDays(s.latest_imported, -spec.trailingDays);
  if (start < floor) start = floor;
  if (start > end) return null;
  return { start, end, kind: "incremental", finishesBackfill: false };
}

/** Backfill: the next chunk immediately before earliest_imported, never below the floor. */
export function backfillWindow(src: SourceKey, s: State, today: string): Window | null {
  if (s.backfill_complete) return null;
  const spec = SPECS[src];
  const floor = spec.floor(today);
  if (!s.earliest_imported) return incrementalWindow(src, s, today);
  if (s.earliest_imported <= floor) return null;
  const end = addDays(s.earliest_imported, -1);
  let start = addDays(end, -(spec.chunkDays - 1));
  let finishes = false;
  if (start <= floor) { start = floor; finishes = true; }
  return { start, end, kind: "backfill", finishesBackfill: finishes };
}

/** Clamp a manual range to what the source can return. */
export function clampManual(src: SourceKey, start: string, end: string, today: string): { start: string; end: string } | null {
  const spec = SPECS[src];
  const floor = spec.floor(today);
  const newest = addDays(today, -spec.lagDays);
  const s = start < floor ? floor : start;
  const e = end > newest ? newest : end;
  return s > e ? null : { start: s, end: e };
}

/** Split [start,end] into chunks of at most n days (for long manual ranges). */
export function chunks(start: string, end: string, n: number): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = [];
  let s = start;
  while (s <= end) {
    let e = addDays(s, n - 1);
    if (e > end) e = end;
    out.push({ start: s, end: e });
    s = addDays(e, 1);
  }
  return out;
}
