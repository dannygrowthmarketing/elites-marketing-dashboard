// Date ranges in clinic time (Asia/Kolkata). All ranges are inclusive [start, end] as YYYY-MM-DD.

export const TZ = "Asia/Kolkata";

export type PresetKey =
  | "today" | "yesterday" | "last7" | "last30" | "thisWeek" | "lastWeek"
  | "thisMonth" | "lastMonth" | "thisQuarter" | "lastQuarter" | "thisYear" | "lastYear"
  | "all" | "custom";

export type CompareMode = "none" | "previous" | "yoy";
export type Grain = "day" | "week" | "month" | "quarter";

export interface Range { start: string; end: string }

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "thisWeek", label: "This week" },
  { key: "lastWeek", label: "Last week" },
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "thisQuarter", label: "This quarter" },
  { key: "lastQuarter", label: "Last quarter" },
  { key: "thisYear", label: "This year" },
  { key: "lastYear", label: "Last year" },
  { key: "all", label: "All available time" },
  { key: "custom", label: "Custom range" },
];

export function todayLocal(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const toD = (iso: string) => new Date(iso + "T00:00:00Z");
const toIso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  const d = toD(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d);
}
export function addMonths(iso: string, n: number): string {
  const d = toD(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toIso(d);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((toD(b).getTime() - toD(a).getTime()) / 86400000) + 1;
}
/** Monday-start ISO week. */
export function startOfWeek(iso: string): string {
  const dow = (toD(iso).getUTCDay() + 6) % 7; return addDays(iso, -dow);
}
export function startOfMonth(iso: string) { return iso.slice(0, 8) + "01"; }
export function endOfMonth(iso: string) { return addDays(addMonths(startOfMonth(iso), 1), -1); }
export function startOfQuarter(iso: string) {
  const m = Number(iso.slice(5, 7)); const q = Math.floor((m - 1) / 3) * 3 + 1;
  return `${iso.slice(0, 4)}-${String(q).padStart(2, "0")}-01`;
}
export function startOfYear(iso: string) { return iso.slice(0, 4) + "-01-01"; }

export function presetRange(key: PresetKey, today: string, allStart?: string | null): Range {
  switch (key) {
    case "today": return { start: today, end: today };
    case "yesterday": { const y = addDays(today, -1); return { start: y, end: y }; }
    case "last7": return { start: addDays(today, -6), end: today };
    case "last30": return { start: addDays(today, -29), end: today };
    case "thisWeek": return { start: startOfWeek(today), end: today };
    case "lastWeek": { const s = addDays(startOfWeek(today), -7); return { start: s, end: addDays(s, 6) }; }
    case "thisMonth": return { start: startOfMonth(today), end: today };
    case "lastMonth": { const s = addMonths(startOfMonth(today), -1); return { start: s, end: endOfMonth(s) }; }
    case "thisQuarter": return { start: startOfQuarter(today), end: today };
    case "lastQuarter": { const s = addMonths(startOfQuarter(today), -3); return { start: s, end: addDays(addMonths(s, 3), -1) }; }
    case "thisYear": return { start: startOfYear(today), end: today };
    case "lastYear": { const y = String(Number(today.slice(0, 4)) - 1); return { start: `${y}-01-01`, end: `${y}-12-31` }; }
    case "all": return { start: allStart ?? addDays(today, -365), end: today };
    default: return { start: addDays(today, -29), end: today };
  }
}

/** Is the period still running (end is today or later)? Used to flag partial periods. */
export function isIncomplete(r: Range, today: string): boolean { return r.end >= today; }

/** Comparison window: same length immediately before, or same dates one year earlier. */
export function compareRange(r: Range, mode: CompareMode): Range | null {
  if (mode === "none") return null;
  if (mode === "yoy") return { start: addMonths(r.start, -12), end: addMonths(r.end, -12) };
  const len = daysBetween(r.start, r.end);
  return { start: addDays(r.start, -len), end: addDays(r.start, -1) };
}

export function bucketKey(iso: string, grain: Grain): string {
  switch (grain) {
    case "week": return startOfWeek(iso);
    case "month": return startOfMonth(iso);
    case "quarter": return startOfQuarter(iso);
    default: return iso;
  }
}

/** Sensible default grain for a range length. */
export function autoGrain(r: Range): Grain {
  const n = daysBetween(r.start, r.end);
  if (n <= 45) return "day";
  if (n <= 180) return "week";
  if (n <= 730) return "month";
  return "quarter";
}

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "UTC" }).format(toD(iso));
}

export function bucketLabel(key: string, grain: Grain): string {
  if (grain === "day") return fmtDate(key, { day: "numeric", month: "short" });
  if (grain === "week") return "w/c " + fmtDate(key, { day: "numeric", month: "short" });
  if (grain === "month") return fmtDate(key, { month: "short", year: "2-digit" });
  const q = Math.floor((Number(key.slice(5, 7)) - 1) / 3) + 1;
  return `Q${q} ${key.slice(2, 4)}`;
}
