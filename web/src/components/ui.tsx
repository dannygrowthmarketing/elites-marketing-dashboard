import { useMemo, useState, type ReactNode } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar } from "recharts";
import { bucketKey, bucketLabel, compareRange, PRESETS, type Grain, type PresetKey } from "../lib/dates";
import { defOf, fmt, pctChange, type Num } from "../lib/metrics";
import { downloadCsv } from "../lib/csv";
import { useFilters } from "../state";
import { Logo } from "./Logo";

// ---------- layout ----------
export function Page({ eyebrow, title, intro, children, actions }: { eyebrow: string; title: string; intro?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <main className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          {intro && <p className="intro">{intro}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </main>
  );
}

export function Section({ n, title, note, children, right }: { n?: string; title: string; note?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{n && <span className="sec-n">{n}</span>}{title}</h2>
        {right}
      </div>
      {note && <p className="section-note">{note}</p>}
      {children}
    </section>
  );
}

// ---------- KPI ----------
export function Kpi({ label, value, prev, format = "int", defKey, invert = false, sub, big = false, logo }: {
  label: string; value: Num; prev?: Num; format?: keyof typeof fmt; defKey?: string; invert?: boolean; sub?: ReactNode; big?: boolean; logo?: string;
}) {
  const ch = prev === undefined ? null : pctChange(value, prev);
  const good = ch == null ? null : invert ? ch < 0 : ch > 0;
  const def = defKey ? defOf(defKey) : undefined;
  return (
    <div className={`kpi ${big ? "kpi-big" : ""}`} title={def ? `${def.formula}${def.notes ? "\n\n" + def.notes : ""}` : undefined}>
      <div className="kpi-label">{logo && <Logo id={logo} size={20} />}{label}{def && <span className="kpi-i" aria-hidden>i</span>}</div>
      <div className="kpi-value">{value == null ? <span className="na">Not available</span> : fmt[format](value as number)}</div>
      <div className="kpi-foot">
        {ch != null && <span className={`delta ${good ? "up" : "down"}`}>{fmt.delta(ch)}</span>}
        {prev !== undefined && prev != null && <span className="kpi-prev">vs {fmt[format](prev as number)}</span>}
        {sub && <span className="kpi-sub">{sub}</span>}
      </div>
    </div>
  );
}

export const KpiRow = ({ children }: { children: ReactNode }) => <div className="kpi-row">{children}</div>;

// ---------- states ----------
export function Loading({ h = 120 }: { h?: number }) { return <div className="loading" style={{ height: h }} aria-busy="true" />; }
export function ErrorBox({ msg }: { msg: string }) { return <div className="errorbox">Couldn't load: {msg}</div>; }
export function Pending({ source, children }: { source: string; children?: ReactNode }) {
  return (
    <div className="pending">
      <strong>{source}: no data yet.</strong> {children ?? "This source isn't connected or hasn't synced. Nothing is estimated in its place."}
      <a href="#/integrations"> See Integrations →</a>
    </div>
  );
}

export function Tag({ tone = "neutral", children }: { tone?: "good" | "bad" | "warn" | "neutral" | "info"; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

// ---------- date bar ----------
export function DateBar() {
  const f = useFilters();
  const partial = f.range.end >= f.today;
  return (
    <div className="datebar">
      <label className="sr" htmlFor="preset">Period</label>
      <select id="preset" value={f.preset} onChange={(e) => f.setPreset(e.target.value as PresetKey)}>
        {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
      {f.preset === "custom" && (
        <span className="custom">
          <input type="date" value={f.custom.start} max={f.custom.end} onChange={(e) => f.setCustom({ ...f.custom, start: e.target.value })} aria-label="Start date" />
          <span>→</span>
          <input type="date" value={f.custom.end} min={f.custom.start} max={f.today} onChange={(e) => f.setCustom({ ...f.custom, end: e.target.value })} aria-label="End date" />
        </span>
      )}
      <select value={f.compare} onChange={(e) => f.setCompare(e.target.value as any)} aria-label="Compare to">
        <option value="previous">vs previous period</option>
        <option value="yoy">vs same period last year</option>
        <option value="none">No comparison</option>
      </select>
      <select value={f.grainPref} onChange={(e) => f.setGrainPref(e.target.value as any)} aria-label="Chart grain">
        <option value="auto">Auto grain</option>
        <option value="day">Daily</option>
        <option value="week">Weekly</option>
        <option value="month">Monthly</option>
        <option value="quarter">Quarterly</option>
      </select>
      <span className="range-txt">
        {f.range.start} → {f.range.end}{partial && <Tag tone="warn">in progress</Tag>}
        {f.prevLabel && <span className="muted"> · compared with {f.prevLabel}</span>}
      </span>
    </div>
  );
}

// ---------- trend chart ----------
export interface SeriesDef { key: string; label: string; color: string; kind?: "line" | "area" | "bar"; agg?: "sum" | "avg"; axis?: "left" | "right"; format?: keyof typeof fmt }

export function bucketize(rows: any[], grain: Grain, series: SeriesDef[]) {
  const m = new Map<string, any>();
  for (const r of rows) {
    const k = bucketKey(r.date, grain);
    const b = m.get(k) ?? { bucket: k, _n: {} as Record<string, number> };
    for (const s of series) {
      const v = r[s.key];
      if (v == null) continue;
      b[s.key] = (b[s.key] ?? 0) + Number(v);
      b._n[s.key] = (b._n[s.key] ?? 0) + 1;
    }
    m.set(k, b);
  }
  return [...m.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)).map((b) => {
    for (const s of series) if (s.agg === "avg" && b[s.key] != null) b[s.key] = b[s.key] / b._n[s.key];
    return b;
  });
}

export function TrendChart({ rows, prevRows, series, height = 260 }: { rows: any[] | null; prevRows?: any[] | null; series: SeriesDef[]; height?: number }) {
  const { grain } = useFilters();
  const data = useMemo(() => {
    if (!rows) return [];
    const cur = bucketize(rows, grain, series);
    const prev = prevRows ? bucketize(prevRows, grain, series) : [];
    return cur.map((c, i) => {
      const o: any = { ...c, label: bucketLabel(c.bucket, grain) };
      if (prev[i]) for (const s of series) o[`prev_${s.key}`] = prev[i][s.key];
      return o;
    });
  }, [rows, prevRows, grain, series]);
  if (!rows) return <Loading h={height} />;
  const hasData = data.some((d) => series.some((s) => d[s.key] != null));
  if (!hasData) return <div className="empty chart-empty">No data in this period.</div>;
  const right = series.some((s) => s.axis === "right");
  return (
    <div className="chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: right ? 4 : 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--rule)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={{ stroke: "var(--rule)" }} minTickGap={18} />
          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} tickFormatter={(v) => fmt.compact(v)} width={48} />
          {right && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} tickFormatter={(v) => fmt.compact(v)} width={44} />}
          <Tooltip contentStyle={{ background: "var(--paper)", border: "1px solid var(--rule)", borderRadius: 6, fontSize: 12 }}
            formatter={(v: any, name: any) => {
              const isPrev = String(name).startsWith("Prev · ");
              const s = series.find((x) => x.label === String(name).replace("Prev · ", ""));
              return [s?.format ? fmt[s.format](v) : fmt.int(v), isPrev ? name : s?.label ?? name];
            }} />
          {series.map((s) => {
            const common = { yAxisId: s.axis ?? "left", dataKey: s.key, name: s.label, isAnimationActive: false } as const;
            if (s.kind === "bar") return <Bar key={s.key} {...common} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={28} />;
            if (s.kind === "area") return <Area key={s.key} {...common} type="monotoneX" stroke={s.color} fill={s.color} fillOpacity={0.12} strokeWidth={2} dot={false} connectNulls />;
            return <Line key={s.key} {...common} type="monotoneX" stroke={s.color} strokeWidth={2} dot={false} connectNulls />;
          })}
          {prevRows && series.filter((s) => s.kind !== "bar").map((s) => (
            <Line key={`p-${s.key}`} yAxisId={s.axis ?? "left"} dataKey={`prev_${s.key}`} name={`Prev · ${s.label}`} stroke={s.color} strokeOpacity={0.4} strokeDasharray="4 4" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="legend">
        {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
        {prevRows && <span><i className="dash" />comparison period</span>}
      </div>
    </div>
  );
}

// ---------- table ----------
export interface Col<T> { key: string; label: string; align?: "left" | "right"; format?: keyof typeof fmt; render?: (r: T) => ReactNode; value?: (r: T) => any; title?: string }

export function DataTable<T extends Record<string, any>>({ rows, cols, csvName, onRow, limit = 25, empty = "No rows in this period.", initialSort }: {
  rows: T[] | null; cols: Col<T>[]; csvName?: string; onRow?: (r: T) => void; limit?: number; empty?: string; initialSort?: { key: string; dir: 1 | -1 };
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(initialSort ?? null);
  const [all, setAll] = useState(false);
  const [q, setQ] = useState("");
  const val = (r: T, c: Col<T>) => (c.value ? c.value(r) : r[c.key]);
  const sorted = useMemo(() => {
    if (!rows) return [];
    let r = rows;
    if (q) { const s = q.toLowerCase(); r = r.filter((x) => cols.some((c) => String(val(x, c) ?? "").toLowerCase().includes(s))); }
    if (!sort) return r;
    const c = cols.find((x) => x.key === sort.key)!;
    return [...r].sort((a, b) => {
      const va = val(a, c), vb = val(b, c);
      if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
      return (typeof va === "number" ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, q]);
  if (!rows) return <Loading />;
  const shown = all ? sorted : sorted.slice(0, limit);
  return (
    <div className="table-wrap">
      <div className="table-tools">
        <input className="search" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter rows" />
        <span className="muted">{fmt.int(sorted.length)} rows</span>
        {csvName && rows.length > 0 && (
          <button className="btn ghost" onClick={() => downloadCsv(csvName, sorted.map((r) => Object.fromEntries(cols.map((c) => [c.label, val(r, c)]))))}>Export CSV</button>
        )}
      </div>
      {rows.length === 0 ? <div className="empty">{empty}</div> : (
        <div className="scroll-x">
          <table>
            <thead><tr>{cols.map((c) => (
              <th key={c.key} className={c.align === "right" ? "r" : ""} title={c.title}
                onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key ? (s.dir === 1 ? -1 : 1) : (c.align === "right" ? -1 : 1) }))}>
                {c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
              </th>))}</tr></thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={i} className={onRow ? "click" : ""} onClick={onRow ? () => onRow(r) : undefined}>
                  {cols.map((c) => <td key={c.key} className={c.align === "right" ? "r num" : ""}>{c.render ? c.render(r) : c.format ? fmt[c.format](val(r, c)) : String(val(r, c) ?? "—")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sorted.length > limit && <button className="btn ghost more" onClick={() => setAll((a) => !a)}>{all ? "Show fewer" : `Show all ${fmt.int(sorted.length)}`}</button>}
    </div>
  );
}

export function DeltaCell({ cur, prev, invert = false }: { cur: Num; prev: Num; invert?: boolean }) {
  const ch = pctChange(cur, prev);
  if (ch == null) return <span className="muted">—</span>;
  const good = invert ? ch < 0 : ch > 0;
  return <span className={`delta ${good ? "up" : "down"}`}>{fmt.delta(ch)}</span>;
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="drawer-bg" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="drawer-head"><h3>{title}</h3><button className="btn ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

/** Args for range + comparison RPCs. When comparison is off, a zero-length past range keeps signatures simple. */
export function useRangeArgs() {
  const f = useFilters();
  const prev = f.prev ?? compareRange(f.range, "previous")!;
  return {
    range: { p_start: f.range.start, p_end: f.range.end },
    cmp: { p_start: f.range.start, p_end: f.range.end, p_prev_start: prev.start, p_prev_end: prev.end },
    prevRange: f.prev ? { p_start: f.prev.start, p_end: f.prev.end } : null,
    hasCompare: !!f.prev,
  };
}
