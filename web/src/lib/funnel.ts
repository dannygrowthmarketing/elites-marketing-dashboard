// Funnel, budget simulation, forecasting and anomaly maths. Pure functions — unit tested.

export const ACTION_EVENTS = ["phone_call_click", "whatsapp_click", "joinchat", "book_appointment_click", "directions_click",
  "email_click", "video_consult_request", "form_submit", "generate_lead"];
export const BOOKING_EVENTS = ["appointment_confirmed", "video_consult_form_submit"];
export const EVENT_LABEL: Record<string, string> = {
  phone_call_click: "Phone tap", whatsapp_click: "WhatsApp tap", joinchat: "WhatsApp widget", book_appointment_click: "Book button",
  directions_click: "Directions", email_click: "Email", video_consult_request: "Video consult request", form_submit: "Form sent",
  generate_lead: "Lead form", appointment_confirmed: "Booking confirmed", video_consult_form_submit: "Video consult booked",
};

export type Channel = "Paid search" | "Organic search" | "Business Profile" | "Direct" | "Social" | "Email" | "Referral & other";
export const CHANNELS: Channel[] = ["Paid search", "Organic search", "Business Profile", "Direct", "Social", "Email", "Referral & other"];

/** GA4 default channel group (+ source) → dashboard channel. GBP visits carry utm_source=google&utm_campaign=gbp_*. */
export function channelOfGa4(group: string, source?: string | null, campaign?: string | null): Channel {
  const g = (group ?? "").toLowerCase();
  if (/gbp|business.?profile|gmb/i.test(campaign ?? "") || /business\.google|gbp|gmb/i.test(source ?? "")) return "Business Profile";
  if (g.includes("paid search") || g === "cross-network") return "Paid search";
  if (g.includes("organic search")) return "Organic search";
  if (g === "direct") return "Direct";
  if (g.includes("social")) return "Social";
  if (g.includes("email") || /mailchimp|newsletter/i.test(source ?? "")) return "Email";
  return "Referral & other";
}

/** CRM first touch → dashboard channel. */
export function channelOfLead(source?: string | null, medium?: string | null, inquiry?: string | null): Channel {
  const s = (source ?? "").toLowerCase(), m = (medium ?? "").toLowerCase();
  if (/gbp|gmb|business/.test(s) || /gbp|gmb|local/.test(m) || inquiry === "gbp") return "Business Profile";
  if (s === "google" && /cpc|ppc|paid/.test(m)) return "Paid search";
  if (m === "organic") return "Organic search";
  if (/facebook|instagram|meta|fb|ig/.test(s)) return "Social";
  if (m === "email" || /mailchimp|newsletter/.test(s)) return "Email";
  if (!s || s === "(direct)") return "Direct";
  return "Referral & other";
}

export interface Stage {
  key: string; label: string; value: number | null; source: string; note?: string;
  prev?: number | null; rateFromPrev?: number | null;
}

/** Attach step conversion rates. A stage with no value breaks the chain (rate = null). */
export function withRates(stages: Stage[]): Stage[] {
  return stages.map((s, i) => {
    const before = stages.slice(0, i).reverse().find((x) => x.value != null && x.value > 0);
    return { ...s, rateFromPrev: i === 0 || s.value == null || !before ? null : s.value / before.value! };
  });
}

/** Biggest relative drop between consecutive measured stages. */
export function biggestLeak(stages: Stage[]): { from: Stage; to: Stage; rate: number } | null {
  let best: { from: Stage; to: Stage; rate: number } | null = null;
  const m = stages.filter((s) => s.value != null && s.value > 0);
  for (let i = 1; i < m.length; i++) {
    const rate = m[i].value! / m[i - 1].value!;
    if (rate < 1 && (!best || rate < best.rate)) best = { from: m[i - 1], to: m[i], rate };
  }
  return best;
}

// ---------------- budget simulator ----------------
// Bookings come from two measured paths: online bookings (measured directly) and calls/WhatsApp
// (measured as taps; how many become bookings is a setting until calls are logged in the CRM).
// Book-button clicks are not counted again — they already end in the online bookings figure.
export interface Baseline { days: number; spend: number; clicks: number; visits: number; actions: number; calls: number; bookings: number }
export interface SimInputs {
  monthlyBudget: number;
  elasticity: number;          // 1 = clicks scale linearly with spend; lower = each extra rupee buys fewer clicks
  callToBooking: number;       // share of call/WhatsApp taps that become a booked appointment
  showRate: number;            // share of bookings that turn up
  revenuePerPatient: number;   // ₹ first-visit value
}
export interface SimResult {
  budget: number; clicks: number; visits: number; actions: number; calls: number; onlineBookings: number; callBookings: number;
  bookings: number; patients: number; revenue: number;
  cpc: number | null; costPerAction: number | null; costPerBooking: number | null; costPerPatient: number | null; roas: number | null;
  low: number; high: number;   // patients range
}
const MONTH = 30.4;

export function monthly(b: Baseline) {
  const f = b.days > 0 ? MONTH / b.days : 0;
  return { spend: b.spend * f, clicks: b.clicks * f, visits: b.visits * f, actions: b.actions * f, calls: b.calls * f, bookings: b.bookings * f };
}

export function simulate(b: Baseline, x: SimInputs): SimResult {
  const m = monthly(b);
  const ratio = m.spend > 0 ? x.monthlyBudget / m.spend : 0;
  const clicks = m.spend > 0 && x.monthlyBudget > 0 ? m.clicks * Math.pow(ratio, x.elasticity) : 0;
  const per = (v: number) => (m.visits > 0 ? v / m.visits : 0);
  const visits = clicks * (m.clicks > 0 ? Math.min(1.3, m.visits / m.clicks) : 0);
  const actions = visits * per(m.actions);
  const calls = visits * per(m.calls);
  const onlineBookings = visits * per(m.bookings);
  const callBookings = calls * x.callToBooking;
  const bookings = onlineBookings + callBookings;
  const patients = bookings * x.showRate;
  const revenue = patients * x.revenuePerPatient;
  // Uncertainty: Poisson on the booking-equivalent count behind the baseline.
  const n = Math.max(1, b.bookings + b.calls * x.callToBooking);
  const rel = Math.min(0.9, 1.96 / Math.sqrt(n));
  const div = (a: number, d: number) => (d > 0 ? a / d : null);
  return {
    budget: x.monthlyBudget, clicks, visits, actions, calls, onlineBookings, callBookings, bookings, patients, revenue,
    cpc: div(x.monthlyBudget, clicks), costPerAction: div(x.monthlyBudget, actions), costPerBooking: div(x.monthlyBudget, bookings),
    costPerPatient: div(x.monthlyBudget, patients), roas: div(revenue, x.monthlyBudget),
    low: patients * (1 - rel), high: patients * (1 + rel),
  };
}

/** Results across a range of budgets, for the response curve. */
export function curve(b: Baseline, x: SimInputs, steps = 24): SimResult[] {
  const m = monthly(b);
  const max = Math.max(m.spend * 3, x.monthlyBudget * 1.2, 10000);
  return Array.from({ length: steps + 1 }, (_, i) => simulate(b, { ...x, monthlyBudget: Math.round((max * i) / steps) }));
}

/** Cost of the next booking at a budget: extra spend ÷ extra bookings for a +10% step. */
export function marginalCostPerBooking(b: Baseline, x: SimInputs): number | null {
  const a = simulate(b, x), c = simulate(b, { ...x, monthlyBudget: x.monthlyBudget * 1.1 });
  const db = c.bookings - a.bookings;
  return db > 0 ? (c.budget - a.budget) / db : null;
}

// ---------------- forecasting ----------------
export interface Pt { date: string; value: number | null }
export interface ForecastPt { date: string; actual: number | null; forecast: number | null; lo: number | null; hi: number | null }

const addDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();

/** Linear trend + day-of-week effect, fitted on up to the last 84 days. Needs 28+ observed days. */
export function forecast(series: Pt[], horizon = 30): { points: ForecastPt[]; method: string; total: number; lo: number; hi: number } | null {
  let obs = series.filter((p) => p.value != null).slice(-84) as { date: string; value: number }[];
  if (obs.length < 28) return null;
  // One-off spikes would drag the trend: drop points more than 3.5 MADs from the median before fitting.
  const sorted = [...obs.map((p) => p.value)].sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
  const mad = [...obs.map((p) => Math.abs(p.value - med))].sort((a, b) => a - b)[Math.floor(obs.length / 2)] || 1;
  obs = obs.filter((p) => Math.abs(p.value - med) / (1.4826 * mad) <= 3.5 || p.value === 0);
  const t0 = new Date(obs[0].date + "T00:00:00Z").getTime();
  const t = obs.map((p) => (new Date(p.date + "T00:00:00Z").getTime() - t0) / 864e5);
  const y = obs.map((p) => p.value);
  const n = y.length, mt = t.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  const sxx = t.reduce((a, b) => a + (b - mt) ** 2, 0), sxy = t.reduce((a, b, i) => a + (b - mt) * (y[i] - my), 0);
  const slope = sxx > 0 ? sxy / sxx : 0, icpt = my - slope * mt;
  const resid = y.map((v, i) => v - (icpt + slope * t[i]));
  const wk = Array.from({ length: 7 }, (_, d) => { const r = resid.filter((_, i) => dow(obs[i].date) === d); return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0; });
  const res2 = resid.map((r, i) => r - wk[dow(obs[i].date)]);
  const sd = Math.sqrt(res2.reduce((a, b) => a + b * b, 0) / Math.max(1, n - 2));
  const last = obs[obs.length - 1].date, tl = t[t.length - 1];
  const points: ForecastPt[] = series.slice(-56).map((p) => ({ date: p.date, actual: p.value, forecast: null, lo: null, hi: null }));
  let total = 0;
  for (let h = 1; h <= horizon; h++) {
    const d = addDays(last, h);
    const f = Math.max(0, icpt + slope * (tl + h) + wk[dow(d)]);
    total += f;
    points.push({ date: d, actual: null, forecast: f, lo: Math.max(0, f - 1.96 * sd), hi: f + 1.96 * sd });
  }
  const band = 1.96 * sd * Math.sqrt(horizon);
  return { points, method: `Linear trend + day-of-week pattern, fitted on ${n} days`, total, lo: Math.max(0, total - band), hi: total + band };
}

/** Days that sit far outside the previous 28 days (|z| ≥ threshold), ignoring tiny counts. */
export function anomalies(series: Pt[], threshold = 2.5, minAbs = 5): { date: string; value: number; mean: number; z: number }[] {
  const out: { date: string; value: number; mean: number; z: number }[] = [];
  for (let i = 28; i < series.length; i++) {
    const v = series[i].value; if (v == null) continue;
    const w = series.slice(i - 28, i).map((p) => p.value).filter((x): x is number => x != null);
    if (w.length < 21) continue;
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / w.length);
    if (sd === 0 || Math.abs(v - mean) < minAbs) continue;
    const z = (v - mean) / sd;
    if (Math.abs(z) >= threshold) out.push({ date: series[i].date, value: v, mean, z });
  }
  return out;
}

/** Consecutive trailing days at zero after earlier activity (e.g. a campaign that stopped serving). */
export function stoppedSince(series: Pt[], minDays = 3): string | null {
  let i = series.length - 1, n = 0;
  while (i >= 0 && (series[i].value ?? 0) === 0) { n++; i--; }
  if (n < minDays || i < 0) return null;
  return series[i + 1].date;
}

/** Split a change in a total into each segment's contribution, largest first. */
export function contributions(cur: Record<string, number>, prev: Record<string, number>) {
  const keys = [...new Set([...Object.keys(cur), ...Object.keys(prev)])];
  const total = keys.reduce((a, k) => a + (cur[k] ?? 0) - (prev[k] ?? 0), 0);
  return keys.map((k) => ({ key: k, cur: cur[k] ?? 0, prev: prev[k] ?? 0, delta: (cur[k] ?? 0) - (prev[k] ?? 0) }))
    .filter((r) => r.delta !== 0 || r.cur > 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .map((r) => ({ ...r, share: total !== 0 ? r.delta / total : null }));
}
