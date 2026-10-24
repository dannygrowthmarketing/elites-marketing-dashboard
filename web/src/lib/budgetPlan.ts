// Marketing budget proposal: split a total budget across channels, phase it by month and project patients.
// Pure functions — unit tested. Projections use the clinic's measured search numbers where they exist;
// every other rate is a stated planning assumption that the page shows and lets you change.

export type Goal = "patients" | "balanced" | "brand";
export type Category = "Paid media" | "Foundation" | "Content & creative" | "Community & CRM" | "Reserve";
export type Phasing = "ramp" | "front" | "even";

export interface Item {
  key: string; label: string; category: Category; phasing: Phasing;
  weights: Record<Goal, number>;
  minMonthly: number;            // below this per month the item is dropped and its share redistributed
  maxMonthly?: number;           // spend above this per month buys little (local demand is finite)
  minTotalMonthly?: number;      // only include when the overall monthly budget is at least this
  buys: string; kpi: string;
}

export const ITEMS: Item[] = [
  { key: "search", label: "Google Search ads — treatments & local", category: "Paid media", phasing: "ramp",
    weights: { patients: 30, balanced: 24, brand: 16 }, minMonthly: 8000, maxMonthly: 120000,
    buys: "Ads on high-intent searches: implants, root canal, aligners, kids' dentist, ‘dentist near me’ within ~5 km, mornings and Sundays weighted", kpi: "Cost per booked patient" },
  { key: "local", label: "Google Maps & Performance Max (local)", category: "Paid media", phasing: "ramp",
    weights: { patients: 10, balanced: 8, brand: 6 }, minMonthly: 6000, maxMonthly: 60000,
    buys: "Promoted pin on Maps and calls/directions from the Business Profile", kpi: "Calls + direction requests" },
  { key: "meta", label: "Meta ads — Instagram & Facebook", category: "Paid media", phasing: "ramp",
    weights: { patients: 14, balanced: 15, brand: 18 }, minMonthly: 8000,
    buys: "Reels and lead forms to families within 3–5 km; treatment offers (check-up, cleaning, aligner consult)", kpi: "Cost per WhatsApp/lead" },
  { key: "retarget", label: "Retargeting (Meta + Google)", category: "Paid media", phasing: "ramp",
    weights: { patients: 5, balanced: 5, brand: 5 }, minMonthly: 4000,
    buys: "Reminders to people who visited the site or watched a reel but didn't book (needs Meta Pixel)", kpi: "Return visits that book" },
  { key: "video", label: "YouTube & Demand Gen video", category: "Paid media", phasing: "ramp",
    weights: { patients: 0, balanced: 4, brand: 9 }, minMonthly: 15000, minTotalMonthly: 80000,
    buys: "15–30 s doctor and patient-story videos to the local area", kpi: "Views, brand searches" },
  { key: "tracking", label: "Tracking, call tracking & CRM", category: "Foundation", phasing: "front",
    weights: { patients: 4, balanced: 4, brand: 3 }, minMonthly: 2000,
    buys: "Call tracking number, GA4 key events, Meta Pixel, CRM upkeep — so every rupee can be traced to patients", kpi: "Share of patients with a known source" },
  { key: "website", label: "Website conversion & landing pages", category: "Foundation", phasing: "front",
    weights: { patients: 6, balanced: 6, brand: 5 }, minMonthly: 3000,
    buys: "Fast mobile booking, treatment landing pages for ads, price pages, booking-widget fixes", kpi: "Visit → booking rate" },
  { key: "seo", label: "SEO & content (location, price, treatment pages)", category: "Content & creative", phasing: "even",
    weights: { patients: 6, balanced: 8, brand: 10 }, minMonthly: 4000,
    buys: "TC Palya location page, price/cost pages, FAQ + rating schema, 2–4 articles a month", kpi: "Organic clicks, page-one terms" },
  { key: "gbp", label: "Business Profile & reviews programme", category: "Content & creative", phasing: "even",
    weights: { patients: 4, balanced: 4, brand: 4 }, minMonthly: 2000,
    buys: "Weekly posts and photos, review-ask cards/QR at the desk, replies, competitor name-stuffing reports", kpi: "Reviews/month, Maps rank" },
  { key: "directories", label: "Directories — Practo, Justdial, Lybrate", category: "Foundation", phasing: "front",
    weights: { patients: 3, balanced: 3, brand: 3 }, minMonthly: 1500,
    buys: "Clinic + six doctor profiles, fixed locality; paid placement only if trial bookings justify it", kpi: "Directory bookings" },
  { key: "creative", label: "Photo, video & reels production", category: "Content & creative", phasing: "front",
    weights: { patients: 6, balanced: 8, brand: 11 }, minMonthly: 4000,
    buys: "Clinic and doctor shoot, before/after (with consent), 8–12 reels a month for ads and Instagram", kpi: "Creatives live, ad CTR" },
  { key: "messaging", label: "WhatsApp & email re-engagement", category: "Community & CRM", phasing: "even",
    weights: { patients: 3, balanced: 3, brand: 2 }, minMonthly: 1500,
    buys: "Recall reminders (6-month check-up, cleaning), treatment follow-ups, festival messages — opted-in patients only", kpi: "Recalls booked" },
  { key: "community", label: "Community — school & corporate camps", category: "Community & CRM", phasing: "even",
    weights: { patients: 4, balanced: 4, brand: 5 }, minMonthly: 8000,
    buys: "Dental check-up camps at nearby schools, offices and apartment societies (see Partnerships)", kpi: "Camp attendees → patients" },
  { key: "reserve", label: "Testing reserve", category: "Reserve", phasing: "even",
    weights: { patients: 5, balanced: 4, brand: 3 }, minMonthly: 0,
    buys: "Held back to scale whatever wins in months 1–2, or for new tests", kpi: "—" },
];

export interface Assumptions {
  searchCpc: number;            // ₹ per click at the clinic's current spend level
  searchBaseMonthly: number;    // ₹/month the CPC was measured at (diminishing returns above it)
  clickToPatient: number;       // search click → patient who turns up
  localCostFactor: number;      // Maps/PMax cost per patient relative to Search
  metaCostPerLead: number;      // ₹
  metaLeadToPatient: number;
  campCost: number;             // ₹ per camp
  patientsPerCamp: number;
  revenuePerPatient: number;    // ₹ first-visit + treatment value
  elasticity: number;           // 1 = linear; lower = each extra rupee buys fewer clicks
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  searchCpc: 30, searchBaseMonthly: 25000, clickToPatient: 0.03, localCostFactor: 1.3, metaCostPerLead: 300, metaLeadToPatient: 0.2,
  campCost: 10000, patientsPerCamp: 4, revenuePerPatient: 3500, elasticity: 0.85,
};

export interface Line { item: Item; total: number; monthly: number; share: number; byMonth: number[] }
export interface Plan {
  total: number; months: number; goal: Goal; lines: Line[]; dropped: Item[];
  byCategory: { category: Category; total: number; share: number }[];
  monthTotals: number[];
}

const ramp = (m: number) => Array.from({ length: m }, (_, i) => [0.6, 0.85][i] ?? 1);
/** Spread an item's total over the months. "front" puts 40% in month 1 (set-up work), the rest evenly. */
export function phase(total: number, months: number, p: Phasing): number[] {
  if (months <= 1) return [total];
  if (p === "front") return [total * 0.4, ...Array(months - 1).fill((total * 0.6) / (months - 1))];
  const w = p === "ramp" ? ramp(months) : Array(months).fill(1);
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => (total * x) / s);
}

/** Split the budget. Items under their minimum are dropped; anything over a cap flows to the others. */
export function allocate(total: number, months: number, goal: Goal): Plan {
  const monthlyTotal = total / months;
  let active = ITEMS.filter((i) => i.weights[goal] > 0 && (!i.minTotalMonthly || monthlyTotal >= i.minTotalMonthly));
  const dropped: Item[] = ITEMS.filter((i) => !active.includes(i) && i.weights[goal] > 0);
  const split = () => { const wsum = active.reduce((a, i) => a + i.weights[goal], 0); return new Map(active.map((i) => [i.key, (monthlyTotal * i.weights[goal]) / wsum])); };
  let alloc = split();
  for (;;) {
    const tooSmall = active.filter((i) => i.key !== "reserve" && (alloc.get(i.key) ?? 0) < i.minMonthly);
    if (!tooSmall.length) break;
    // Drop the lowest-weight item that can't reach its minimum, then split again.
    const drop = tooSmall.sort((a, b) => a.weights[goal] - b.weights[goal])[0];
    active = active.filter((i) => i !== drop); dropped.push(drop);
    alloc = split();
  }
  // caps: move the excess to uncapped paid media + content, pro rata
  let excess = 0;
  for (const i of active) if (i.maxMonthly && (alloc.get(i.key) ?? 0) > i.maxMonthly) { excess += alloc.get(i.key)! - i.maxMonthly; alloc.set(i.key, i.maxMonthly); }
  if (excess > 0) {
    const sinks = active.filter((i) => !i.maxMonthly && ["meta", "video", "seo", "creative", "community", "retarget"].includes(i.key));
    const ws = sinks.reduce((a, i) => a + i.weights[goal], 0) || 1;
    for (const i of sinks) alloc.set(i.key, (alloc.get(i.key) ?? 0) + (excess * i.weights[goal]) / ws);
  }
  const lines: Line[] = active.map((item) => {
    const monthly = alloc.get(item.key) ?? 0, t = monthly * months;
    return { item, monthly, total: t, share: t / total, byMonth: phase(t, months, item.phasing) };
  });
  const cats = [...new Set(ITEMS.map((i) => i.category))];
  const byCategory = cats.map((c) => { const s = lines.filter((l) => l.item.category === c).reduce((a, l) => a + l.total, 0); return { category: c, total: s, share: s / total }; }).filter((c) => c.total > 0);
  const monthTotals = Array.from({ length: months }, (_, m) => lines.reduce((a, l) => a + l.byMonth[m], 0));
  return { total, months, goal, lines, dropped, byCategory, monthTotals };
}

export interface Projection { month: number; spend: number; search: number; local: number; meta: number; community: number; patients: number; low: number; high: number; revenue: number }

/** Patients from the channels that can be projected. SEO, profile, directories and retargeting lift these but aren't counted separately. */
export function project(plan: Plan, a: Assumptions): { months: Projection[]; patients: number; low: number; high: number; revenue: number; costPerPatient: number | null; roas: number | null } {
  const get = (k: string, m: number) => plan.lines.find((l) => l.item.key === k)?.byMonth[m] ?? 0;
  const searchCpp = a.searchCpc / Math.max(1e-6, a.clickToPatient);
  const months: Projection[] = plan.monthTotals.map((spend, m) => {
    const s = get("search", m);
    const clicks = s > 0 ? (a.searchBaseMonthly / a.searchCpc) * Math.pow(s / a.searchBaseMonthly, a.elasticity) : 0;
    const search = clicks * a.clickToPatient;
    const local = get("local", m) / (searchCpp * a.localCostFactor);
    const meta = (get("meta", m) / a.metaCostPerLead) * a.metaLeadToPatient;
    const community = (get("community", m) / a.campCost) * a.patientsPerCamp;
    // ramp-up: new campaigns and pages take time to learn
    const learn = [0.7, 0.9][m] ?? 1;
    const patients = (search + local + meta + community) * learn;
    return { month: m + 1, spend, search: search * learn, local: local * learn, meta: meta * learn, community: community * learn, patients, low: patients * 0.6, high: patients * 1.4, revenue: patients * a.revenuePerPatient };
  });
  const patients = months.reduce((x, p) => x + p.patients, 0), revenue = patients * a.revenuePerPatient;
  return { months, patients, low: patients * 0.6, high: patients * 1.4, revenue, costPerPatient: patients > 0 ? plan.total / patients : null, roas: plan.total > 0 ? revenue / plan.total : null };
}
