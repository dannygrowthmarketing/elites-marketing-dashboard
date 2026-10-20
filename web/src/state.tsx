import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { autoGrain, compareRange, fmtDate, PRESETS, presetRange, todayLocal, type CompareMode, type Grain, type PresetKey, type Range } from "./lib/dates";
import { supabase } from "./lib/supabase";

interface Ctx {
  today: string;
  preset: PresetKey; setPreset: (p: PresetKey) => void;
  custom: Range; setCustom: (r: Range) => void;
  compare: CompareMode; setCompare: (c: CompareMode) => void;
  grainPref: Grain | "auto"; setGrainPref: (g: Grain | "auto") => void;
  range: Range; prev: Range | null; grain: Grain;
  label: string; prevLabel: string | null;
  bounds: { earliest: string | null; latest: string | null };
  refreshKey: number; refresh: () => void;
  role: string | null; email: string | null;
}

const C = createContext<Ctx | null>(null);
const LS = "edc.filters.v1";

function load() {
  try { return JSON.parse(localStorage.getItem(LS) ?? "{}"); } catch { return {}; }
}

export function FiltersProvider({ children, email }: { children: ReactNode; email: string | null }) {
  const saved = load();
  const today = todayLocal();
  const [preset, setPreset] = useState<PresetKey>(saved.preset ?? "last30");
  const [custom, setCustom] = useState<Range>(saved.custom ?? presetRange("last30", today));
  const [compare, setCompare] = useState<CompareMode>(saved.compare ?? "previous");
  const [grainPref, setGrainPref] = useState<Grain | "auto">(saved.grainPref ?? "auto");
  const [bounds, setBounds] = useState<{ earliest: string | null; latest: string | null }>({ earliest: null, latest: null });
  const [refreshKey, setRefreshKey] = useState(0);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify({ preset, custom, compare, grainPref })); } catch { /* storage blocked */ }
  }, [preset, custom, compare, grainPref]);

  useEffect(() => {
    supabase.rpc("rpc_data_bounds").then(({ data }) => {
      const b = Array.isArray(data) ? data[0] : data;
      if (b) setBounds({ earliest: b.earliest, latest: b.latest });
    });
    if (email) supabase.from("app_users").select("role").ilike("email", email).maybeSingle().then(({ data }) => setRole(data?.role ?? null));
  }, [refreshKey, email]);

  const range = preset === "custom" ? custom : presetRange(preset, today, bounds.earliest);
  const prev = compareRange(range, compare);
  const grain = grainPref === "auto" ? autoGrain(range) : grainPref;
  const label = preset === "custom" ? `${fmtDate(range.start)} – ${fmtDate(range.end)}` : PRESETS.find((p) => p.key === preset)!.label;
  const prevLabel = prev ? `${fmtDate(prev.start)} – ${fmtDate(prev.end)}` : null;
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const value = useMemo(() => ({
    today, preset, setPreset, custom, setCustom, compare, setCompare, grainPref, setGrainPref,
    range, prev, grain, label, prevLabel, bounds, refreshKey, refresh, role, email,
  }), [today, preset, custom, compare, grainPref, range.start, range.end, prev?.start, prev?.end, grain, label, prevLabel, bounds, refreshKey, refresh, role, email]);

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useFilters() {
  const v = useContext(C);
  if (!v) throw new Error("FiltersProvider missing");
  return v;
}

/** Call an RPC and track loading/error. Re-runs when deps or the global refresh key change. */
export function useRpc<T = any>(fn: string, args: Record<string, unknown> | null, deps: unknown[] = []) {
  const { refreshKey } = useFilters();
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!args) { setState({ data: null, loading: false, error: null }); return; }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    supabase.rpc(fn, args).then(({ data, error }) => {
      if (!live) return;
      setState({ data: (data as T) ?? null, loading: false, error: error?.message ?? null });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, JSON.stringify(args), refreshKey, ...deps]);
  return state;
}

export function useTable<T = any>(table: string, build: (q: any) => any, deps: unknown[] = []) {
  const { refreshKey } = useFilters();
  const [state, setState] = useState<{ data: T[] | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    build(supabase.from(table)).then(({ data, error }: any) => {
      if (live) setState({ data: data ?? [], loading: false, error: error?.message ?? null });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, refreshKey, ...deps]);
  return state;
}
