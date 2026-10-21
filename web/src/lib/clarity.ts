// Microsoft Clarity daily snapshots → dashboard figures.
// Each snapshot covers the 24 hours before the 08:00 IST sync. Clarity returns
// per-segment averages (scroll depth, active time) and per-segment percentages
// (sessions with rage clicks etc.), so segments are combined weighted by sessions.

export interface Snap { captured_on: string; metric: string; dimension: string; dimension_value: string; payload: any }
type Item = Record<string, any>;

/** Rows Clarity sent twice for one key are stored as { items: [...] }. */
export function explode(s: Snap): { value: string; item: Item }[] {
  const list: Item[] = Array.isArray(s.payload?.items) ? s.payload.items : [s.payload ?? {}];
  return list.map((item) => {
    const key = Object.keys(item).find((k) => k.toLowerCase() === s.dimension.toLowerCase());
    return { value: String((key && item[key]) ?? s.dimension_value), item };
  });
}

/** Our own QA visits and editor previews — not patients. */
export const isTestUrl = (u: string) => /utm_source=claude_test|elementor-preview|[?&]preview=true|[?&]preview_id=/i.test(u);

export function pagePath(u: string): string {
  try { const p = new URL(u).pathname; return p === "" ? "/" : p; } catch { return u.split("?")[0] || "/"; }
}

const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export interface Segment {
  key: string; sessions: number; bots: number; users: number;
  scroll: number | null; active: number | null; total: number | null;
  rage: number | null; dead: number | null; quickback: number | null; errors: number | null; excessive: number | null; scriptErr: number | null;
  rageClicks: number; deadClicks: number;
}

const SIGNAL: Record<string, keyof Segment> = {
  RageClickCount: "rage", DeadClickCount: "dead", QuickbackClick: "quickback",
  ErrorClickCount: "errors", ExcessiveScroll: "excessive", ScriptErrorCount: "scriptErr",
};

/** Combine snapshots for one dimension into segments.
 *  keyOf maps a raw dimension value to a group key (or null to drop it). */
export function segments(snaps: Snap[], dimension: string, keyOf: (v: string) => string | null = (v) => v): Segment[] {
  const acc = new Map<string, any>();
  const get = (k: string) => {
    let a = acc.get(k);
    if (!a) {
      a = { key: k, sessions: 0, bots: 0, users: 0, sw: 0, scrollW: 0, aw: 0, activeW: 0, totalW: 0, sig: {} as Record<string, [number, number]>, rageClicks: 0, deadClicks: 0 };
      acc.set(k, a);
    }
    return a;
  };
  // Sessions per (date, raw value) from Traffic, used to weight averages.
  const sess = new Map<string, number>();
  for (const s of snaps) {
    if (s.dimension !== dimension || s.metric !== "Traffic") continue;
    for (const { value, item } of explode(s)) {
      const k = keyOf(value); if (k == null) continue;
      const a = get(k);
      const n = num(item.totalSessionCount) ?? 0;
      a.sessions += n; a.bots += num(item.totalBotSessionCount) ?? 0; a.users += num(item.distinctUserCount) ?? 0;
      sess.set(`${s.captured_on}|${value}`, (sess.get(`${s.captured_on}|${value}`) ?? 0) + n);
    }
  }
  for (const s of snaps) {
    if (s.dimension !== dimension || s.metric === "Traffic") continue;
    for (const { value, item } of explode(s)) {
      const k = keyOf(value); if (k == null) continue;
      const a = get(k);
      const w = sess.get(`${s.captured_on}|${value}`) ?? num(item.sessionsCount) ?? 0;
      if (s.metric === "ScrollDepth" && num(item.averageScrollDepth) != null && w > 0) { a.sw += w; a.scrollW += w * num(item.averageScrollDepth)!; }
      if (s.metric === "EngagementTime" && w > 0) {
        if (num(item.activeTime) != null) { a.aw += w; a.activeW += w * num(item.activeTime)!; a.totalW += w * (num(item.totalTime) ?? 0); }
      }
      const field = SIGNAL[s.metric];
      if (field) {
        const n = num(item.sessionsCount) ?? 0, pct = num(item.sessionsWithMetricPercentage);
        const cur = a.sig[field] ?? [0, 0];
        if (pct != null && n > 0) { cur[0] += n * pct / 100; cur[1] += n; }
        a.sig[field] = cur;
        if (s.metric === "RageClickCount") a.rageClicks += num(item.subTotal) ?? 0;
        if (s.metric === "DeadClickCount") a.deadClicks += num(item.subTotal) ?? 0;
      }
    }
  }
  return [...acc.values()].map((a) => {
    const share = (f: string) => { const v = a.sig[f]; return v && v[1] > 0 ? v[0] / v[1] : null; };
    return {
      key: a.key, sessions: a.sessions, bots: a.bots, users: a.users,
      scroll: a.sw > 0 ? a.scrollW / a.sw / 100 : null,
      active: a.aw > 0 ? a.activeW / a.aw : null, total: a.aw > 0 ? a.totalW / a.aw : null,
      rage: share("rage"), dead: share("dead"), quickback: share("quickback"), errors: share("errors"),
      excessive: share("excessive"), scriptErr: share("scriptErr"),
      rageClicks: a.rageClicks, deadClicks: a.deadClicks,
    };
  }).sort((x, y) => y.sessions - x.sessions || x.key.localeCompare(y.key));
}

/** Whole-site figures: Device segments merged into one. */
export function overall(snaps: Snap[]): Segment | null {
  const all = segments(snaps, "Device", () => "ALL");
  return all[0] ?? null;
}

/** Test/preview page visits in the snapshots (Traffic by URL). */
export function testVisits(snaps: Snap[]): number {
  let n = 0;
  for (const s of snaps) if (s.dimension === "URL" && s.metric === "Traffic")
    for (const { value, item } of explode(s)) if (isTestUrl(value)) n += num(item.totalSessionCount) ?? 0;
  return n;
}

export function daily(snaps: Snap[]): { date: string; sessions: number; bots: number }[] {
  const m = new Map<string, { date: string; sessions: number; bots: number }>();
  for (const s of snaps) if (s.dimension === "Device" && s.metric === "Traffic")
    for (const { item } of explode(s)) {
      const d = m.get(s.captured_on) ?? { date: s.captured_on, sessions: 0, bots: 0 };
      d.sessions += num(item.totalSessionCount) ?? 0; d.bots += num(item.totalBotSessionCount) ?? 0;
      m.set(s.captured_on, d);
    }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export const fmtSecs = (s: number | null | undefined) => {
  if (s == null || !Number.isFinite(s)) return "—";
  const r = Math.round(s);
  return r < 60 ? `${r}s` : `${Math.floor(r / 60)}m ${String(r % 60).padStart(2, "0")}s`;
};
