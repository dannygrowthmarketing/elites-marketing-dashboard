// Marketing budget proposal: split a total budget across channels, phase it by month and project patients.
// Pure functions — unit tested. Projections use the clinic's measured search numbers where they exist;
// every other rate is a stated planning assumption that the page shows and lets you change.

export type Goal = "patients" | "balanced" | "brand";
export type Category = "Paid media" | "Foundation" | "Content & creative" | "Community & CRM" | "Reserve";
export type Phasing = "ramp" | "front" | "even";
export type ChannelKey = "google" | "meta" | "influencer" | "whatsapp" | "email" | "local" | "content" | "foundation" | "community" | "reserve";

/** How lines roll up for the channel view. `logos` are keys in components/Logo MARKS. */
export const CHANNELS: Record<ChannelKey, { label: string; logos: string[]; blurb: string }> = {
  google: { label: "Google Ads", logos: ["google_ads", "gbp", "youtube"], blurb: "People already searching for a dentist, on Search, Maps and YouTube" },
  meta: { label: "Meta Ads", logos: ["meta", "instagram", "facebook"], blurb: "Families within a few km, on Instagram and Facebook" },
  influencer: { label: "Influencer marketing", logos: ["influencer", "instagram", "youtube"], blurb: "Local Bengaluru creators — parents, food and lifestyle pages in East Bengaluru" },
  whatsapp: { label: "WhatsApp marketing", logos: ["whatsapp"], blurb: "Recalls, reminders and offers to opted-in patients" },
  email: { label: "Email marketing", logos: ["mailchimp", "email"], blurb: "Newsletters and recall emails to past patients" },
  local: { label: "Local presence", logos: ["gbp", "reviews", "directory"], blurb: "Business Profile, reviews and directory listings" },
  content: { label: "SEO, content & creative", logos: ["seo", "creative"], blurb: "Pages that rank, plus the photos and reels every channel needs" },
  foundation: { label: "Website & tracking", logos: ["web", "tracking"], blurb: "So visits turn into bookings and every rupee is traceable" },
  community: { label: "Community", logos: ["community"], blurb: "School, office and apartment-society check-up camps" },
  reserve: { label: "Testing reserve", logos: ["reserve"], blurb: "Held back to scale what works" },
};

export interface Item {
  key: string; label: string; category: Category; channel: ChannelKey; phasing: Phasing; logo: string;
  weights: Record<Goal, number>;
  minMonthly: number;            // below this per month the item is dropped and its share redistributed
  maxMonthly?: number;           // spend above this per month buys little (local demand is finite)
  minTotalMonthly?: number;      // only include when the overall monthly budget is at least this
  buys: string; kpi: string;
}

export const ITEMS: Item[] = [
  { key: "search", label: "Google Search ads", channel: "google", logo: "google_ads", category: "Paid media", phasing: "ramp",
    weights: { patients: 30, balanced: 24, brand: 15 }, minMonthly: 5000, maxMonthly: 120000,
    buys: "Ads on high-intent searches — implants, root canal, aligners, kids' dentist, ‘dentist near me’ — within ~5 km, weighted to mornings and Sundays", kpi: "Cost per booked patient" },
  { key: "local", label: "Google Maps & Performance Max", channel: "google", logo: "gbp", category: "Paid media", phasing: "ramp",
    weights: { patients: 10, balanced: 8, brand: 6 }, minMonthly: 3000, maxMonthly: 60000,
    buys: "Promoted pin on Maps; calls and directions straight from the Business Profile", kpi: "Calls + direction requests" },
  { key: "video", label: "YouTube & Demand Gen video", channel: "google", logo: "youtube", category: "Paid media", phasing: "ramp",
    weights: { patients: 0, balanced: 3, brand: 8 }, minMonthly: 12000, minTotalMonthly: 80000,
    buys: "15–30 s doctor and patient-story videos shown to the local area", kpi: "Views, brand searches" },
  { key: "meta", label: "Instagram & Facebook ads", channel: "meta", logo: "meta", category: "Paid media", phasing: "ramp",
    weights: { patients: 13, balanced: 13, brand: 15 }, minMonthly: 4000,
    buys: "Reels and click-to-WhatsApp ads to families within 3–5 km — check-up, cleaning, aligner consult", kpi: "Cost per WhatsApp chat / lead" },
  { key: "retarget", label: "Retargeting (Meta + Google)", channel: "meta", logo: "instagram", category: "Paid media", phasing: "ramp",
    weights: { patients: 5, balanced: 5, brand: 5 }, minMonthly: 2000,
    buys: "Reminders to people who visited the site or watched a reel but didn't book (needs the Meta Pixel)", kpi: "Return visits that book" },
  { key: "influencer", label: "Local creator collaborations", channel: "influencer", logo: "influencer", category: "Paid media", phasing: "even",
    weights: { patients: 3, balanced: 5, brand: 9 }, minMonthly: 5000, minTotalMonthly: 30000,
    buys: "2–4 micro-creators a month (5K–50K local followers): clinic visit reels, kids' first check-up, aligner journey — marked as paid partnerships", kpi: "Profile visits, WhatsApp chats with creator code" },
  { key: "whatsapp", label: "WhatsApp broadcasts & recalls", channel: "whatsapp", logo: "whatsapp", category: "Community & CRM", phasing: "even",
    weights: { patients: 4, balanced: 4, brand: 3 }, minMonthly: 1000,
    buys: "6-month check-up and cleaning recalls, treatment follow-ups, festival offers to opted-in patients via the WhatsApp Business Platform (Meta charges per marketing message)", kpi: "Recalls booked" },
  { key: "email", label: "Email newsletters & recalls", channel: "email", logo: "mailchimp", category: "Community & CRM", phasing: "even",
    weights: { patients: 2, balanced: 2, brand: 2 }, minMonthly: 500,
    buys: "Monthly newsletter and recall emails via Mailchimp (free plan for small lists, paid beyond)", kpi: "Clicks → bookings" },
  { key: "gbp", label: "Business Profile & reviews", channel: "local", logo: "reviews", category: "Content & creative", phasing: "even",
    weights: { patients: 4, balanced: 4, brand: 4 }, minMonthly: 1000,
    buys: "Weekly posts and photos, review-ask QR at the desk, replies, reporting competitor name-stuffing", kpi: "Reviews / month, Maps rank" },
  { key: "directories", label: "Practo, Justdial, Lybrate", channel: "local", logo: "directory", category: "Foundation", phasing: "front",
    weights: { patients: 3, balanced: 3, brand: 3 }, minMonthly: 1000,
    buys: "Clinic + six doctor profiles with the right locality; paid placement only if trial bookings justify it", kpi: "Directory bookings" },
  { key: "seo", label: "SEO & content", channel: "content", logo: "seo", category: "Content & creative", phasing: "even",
    weights: { patients: 6, balanced: 8, brand: 9 }, minMonthly: 2000,
    buys: "TC Palya location page, treatment cost pages, FAQ + rating schema, 2–4 articles a month", kpi: "Organic clicks, page-one terms" },
  { key: "creative", label: "Photo, video & reels", channel: "content", logo: "creative", category: "Content & creative", phasing: "front",
    weights: { patients: 6, balanced: 8, brand: 10 }, minMonthly: 2500,
    buys: "Clinic and doctor shoot, before/after with consent, 8–12 reels a month for ads and Instagram", kpi: "Creatives live, ad CTR" },
  { key: "website", label: "Website & landing pages", channel: "foundation", logo: "web", category: "Foundation", phasing: "front",
    weights: { patients: 5, balanced: 5, brand: 4 }, minMonthly: 2000,
    buys: "Fast mobile booking, ad landing pages per treatment, price pages, booking-widget fixes", kpi: "Visit → booking rate" },
  { key: "tracking", label: "Tracking & call tracking", channel: "foundation", logo: "tracking", category: "Foundation", phasing: "front",
    weights: { patients: 3, balanced: 3, brand: 2 }, minMonthly: 1000,
    buys: "Call-tracking number, GA4 key events, Meta Pixel, CRM upkeep", kpi: "Share of patients with a known source" },
  { key: "community", label: "School & corporate camps", channel: "community", logo: "community", category: "Community & CRM", phasing: "even",
    weights: { patients: 3, balanced: 4, brand: 4 }, minMonthly: 5000,
    buys: "Check-up camps at nearby schools, offices and apartment societies (see Partnerships)", kpi: "Attendees → patients" },
  { key: "reserve", label: "Testing reserve", channel: "reserve", logo: "reserve", category: "Reserve", phasing: "even",
    weights: { patients: 3, balanced: 1, brand: 1 }, minMonthly: 0,
    buys: "Held back to scale whatever wins in the first weeks, or for new tests", kpi: "—" },
];

const CORE = new Set(["search", "meta", "gbp", "whatsapp", "tracking"]);

export interface Assumptions {
  searchCpc: number;            // ₹ per click at the clinic's current spend level
  searchBaseMonthly: number;    // ₹/month the CPC was measured at (diminishing returns above it)
  clickToPatient: number;       // search click → patient who turns up
  localCostFactor: number;      // Maps/PMax cost per patient relative to Search
  metaCostPerLead: number;      // ₹
  metaLeadToPatient: number;
  waCostPerMessage: number;     // ₹ per marketing message incl. tool
  waBookRate: number;           // share of messages that lead to a booked visit
  waAudience: number;           // opted-in contacts; caps messages at 2 per contact per month
  influencerCostPerPatient: number; // ₹
  campCost: number;             // ₹ per camp
  patientsPerCamp: number;
  revenuePerPatient: number;    // ₹ first-visit + treatment value
  elasticity: number;           // 1 = linear; lower = each extra rupee buys fewer clicks
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  searchCpc: 30, searchBaseMonthly: 25000, clickToPatient: 0.03, localCostFactor: 1.3, metaCostPerLead: 300, metaLeadToPatient: 0.2,
  waCostPerMessage: 1, waBookRate: 0.005, waAudience: 1500, influencerCostPerPatient: 4000, campCost: 10000, patientsPerCamp: 4, revenuePerPatient: 3500, elasticity: 0.85,
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
    // Core local-clinic lines (search, Meta, profile/reviews, WhatsApp, tracking) are the last to go.
    const keep = (i: Item) => i.weights[goal] * (CORE.has(i.key) ? 4 : 1);
    const drop = tooSmall.sort((a, b) => keep(a) - keep(b))[0];
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

export interface Projection { month: number; spend: number; search: number; local: number; meta: number; community: number; whatsapp: number; influencer: number; patients: number; low: number; high: number; revenue: number }

/** Patients from channels with a usable rate. SEO, profile, directories, email and retargeting lift these but aren't counted separately. */
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
    const whatsapp = Math.min(get("whatsapp", m) / a.waCostPerMessage, a.waAudience * 2) * a.waBookRate;
    const influencer = get("influencer", m) / a.influencerCostPerPatient;
    // ramp-up: new campaigns and pages take time to learn
    const learn = [0.7, 0.9][m] ?? 1;
    const patients = (search + local + meta + community + whatsapp + influencer) * learn;
    return { month: m + 1, spend, search: search * learn, local: local * learn, meta: meta * learn, community: community * learn, whatsapp: whatsapp * learn, influencer: influencer * learn, patients, low: patients * 0.6, high: patients * 1.4, revenue: patients * a.revenuePerPatient };
  });
  const patients = months.reduce((x, p) => x + p.patients, 0), revenue = patients * a.revenuePerPatient;
  return { months, patients, low: patients * 0.6, high: patients * 1.4, revenue, costPerPatient: patients > 0 ? plan.total / patients : null, roas: plan.total > 0 ? revenue / plan.total : null };
}

export function byChannel(plan: Plan) {
  const keys = Object.keys(CHANNELS) as ChannelKey[];
  return keys.map((k) => {
    const lines = plan.lines.filter((l) => l.item.channel === k);
    const total = lines.reduce((a, l) => a + l.total, 0);
    return { key: k, ...CHANNELS[k], lines, total, share: plan.total ? total / plan.total : 0 };
  }).filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
}
