// Competitor research for Elites Dental Care, TC Palya Main Road. Every figure is dated and sourced.
// Snapshots are public data read by hand during audits (Google Maps/Search, competitor websites,
// Overture Maps open data). They are research notes, not synced data — add a new snapshot to extend history.

export interface Snapshot { key: string; date: string; label: string; method: string }
export const SNAPSHOTS: Snapshot[] = [
  { key: "s1", date: "2026-09-18", label: "18 Sep", method: "Pitch audit — Google Maps listing counts, TC Palya Main Rd" },
  { key: "s2", date: "2026-09-27", label: "27 Sep", method: "Business Profile audit — Google Maps, signed-in, from the clinic pin" },
  { key: "s3", date: "2026-10-24", label: "24 Oct", method: "Google Maps search ‘dentist’ centred on the clinic (13.0231, 77.6957), zoom 15" },
];

export type Road = "tc_palya" | "nearby";
export interface Clinic {
  name: string; short: string; road: Road; rating: number; reviews: Partial<Record<string, number>>;
  website?: string | null; elites?: boolean; chain?: boolean; note?: string;
}

// Review counts per snapshot. Blank = not recorded in that audit.
export const CLINICS: Clinic[] = [
  { name: "SmileFit Dental Care", short: "SmileFit", road: "tc_palya", rating: 4.9, reviews: { s1: 798, s2: 810, s3: 848 }, website: null, note: "No website — wins on review volume and a Practo page" },
  { name: "KKS Dental and Medical Care", short: "KKS Dental", road: "tc_palya", rating: 4.8, reviews: { s1: 614, s2: 615, s3: 614 }, website: "kksdental.com", note: "Four map pins on the same phone number; 307 searches/6 mo for its brand on Elites' own profile" },
  { name: "Clove Dental – TC Palya", short: "Clove", road: "tc_palya", rating: 4.5, reviews: { s1: 398, s2: 398, s3: 400 }, website: "clovedental.in", chain: true, note: "National chain — location page, publishes prices, runs Search ads" },
  { name: "Pooja Dental and Orthodontic Clinic", short: "Pooja Dental", road: "tc_palya", rating: 4.9, reviews: { s3: 344 }, website: null },
  { name: "Elites Dental Care", short: "Elites", road: "tc_palya", rating: 4.9, reviews: { s1: 271, s2: 288, s3: 325 }, website: "elitesdental.com", elites: true },
  { name: "Pro+ Dental Care", short: "Pro+", road: "tc_palya", rating: 4.9, reviews: { s1: 322, s2: 321, s3: 321 }, website: "proplusdentalcare.com" },
  { name: "Prodent Dental Care", short: "Prodent", road: "tc_palya", rating: 4.8, reviews: { s1: 253, s2: 262, s3: 269 }, website: "prodentdentaltcpalya.com", note: "Ranks #4 organically; GTM + WhatsApp CTA + FAQ" },
  { name: "Dental Arc", short: "Dental Arc", road: "tc_palya", rating: 4.6, reviews: { s3: 200 }, website: null },
  { name: "DentStop Dental and Implant Centre", short: "DentStop", road: "tc_palya", rating: 4.5, reviews: { s1: 125, s3: 125 }, website: "dentstop.co.in", note: "Now advertising on Google (AW-17631669742) with full Dentist schema" },
  { name: "Shiva Dental Clinic", short: "Shiva", road: "tc_palya", rating: 4.9, reviews: { s3: 121 }, website: null },
  { name: "PearlFix Dental Clinic", short: "PearlFix", road: "tc_palya", rating: 4.6, reviews: { s1: 71, s2: 71, s3: 71 }, note: "‘– T C Palya Main Road’ in its business name" },
  { name: "PNS Dental Care", short: "PNS", road: "tc_palya", rating: 4.9, reviews: { s1: 63, s3: 65 }, note: "Keywords stuffed into business name" },
  { name: "Dezigner Smiles", short: "Dezigner Smiles", road: "nearby", rating: 4.9, reviews: { s2: 1835, s3: 1901 } },
  { name: "Healthy Smiles Dental Clinic", short: "Healthy Smiles", road: "nearby", rating: 4.9, reviews: { s2: 911, s3: 925 } },
  { name: "Sabka Dentist – KR Puram", short: "Sabka Dentist", road: "nearby", rating: 4.6, reviews: { s3: 874 }, chain: true },
  { name: "nimi DENTAL", short: "nimi", road: "nearby", rating: 4.9, reviews: { s1: 369, s3: 371 }, website: "nimidental.com" },
  { name: "ARKAS Dental Studio", short: "Arkas", road: "nearby", rating: 4.9, reviews: { s3: 361 }, website: "arkasdental.com" },
  { name: "Narayana Specialists Dental", short: "Narayana", road: "nearby", rating: 4.9, reviews: { s1: 228, s3: 230 }, website: "narayanadentals.com" },
];

/** Reviews gained per 30 days between the first and last recorded snapshot. */
export function velocity(c: Clinic): { per30: number; from: string; to: string; gained: number } | null {
  const pts = SNAPSHOTS.filter((s) => c.reviews[s.key] != null);
  if (pts.length < 2) return null;
  const a = pts[0], b = pts[pts.length - 1];
  const days = (Date.parse(b.date) - Date.parse(a.date)) / 864e5;
  const gained = (c.reviews[b.key] ?? 0) - (c.reviews[a.key] ?? 0);
  return { per30: days > 0 ? (gained / days) * 30 : 0, from: a.label, to: b.label, gained };
}
export const latest = (c: Clinic) => { for (const s of [...SNAPSHOTS].reverse()) if (c.reviews[s.key] != null) return c.reviews[s.key]!; return null; };
/** Months to catch a rival at current velocities. Null when never. */
export function monthsToCatch(me: Clinic, them: Clinic): number | null {
  const a = latest(me), b = latest(them), va = velocity(me)?.per30 ?? 0, vb = velocity(them)?.per30 ?? 0;
  if (a == null || b == null) return null;
  if (a >= b) return 0;
  return va > vb ? (b - a) / (va - vb) : null;
}

// ---------- Search results (page one, organic) ----------
export type SerpKind = "directory" | "chain" | "competitor" | "elites" | "other";
export interface SerpRow { term: string; date: string; results: { site: string; kind: SerpKind }[]; elitesPos: number | null }
export const SERP: SerpRow[] = [
  { term: "dental clinic tc palya", date: "2026-09-18", elitesPos: null, results: [
    { site: "justdial.com", kind: "directory" }, { site: "justdial.com", kind: "directory" }, { site: "practo.com", kind: "directory" },
    { site: "clovedental.in", kind: "chain" }, { site: "prodentdentaltcpalya.com", kind: "competitor" }, { site: "dentstopdental.com", kind: "competitor" },
    { site: "bajajfinservhealth.in", kind: "directory" }, { site: "localo.com", kind: "other" }] },
  { term: "dental clinic tc palya", date: "2026-10-24", elitesPos: 5, results: [
    { site: "justdial.com", kind: "directory" }, { site: "clovedental.in", kind: "chain" }, { site: "practo.com", kind: "directory" },
    { site: "prodentdentaltcpalya.com", kind: "competitor" }, { site: "elitesdental.com", kind: "elites" }, { site: "bajajfinservhealth.in", kind: "directory" },
    { site: "drrupalidentalcare.com", kind: "competitor" }, { site: "justdial.com", kind: "directory" }] },
  { term: "dentist in tc palya", date: "2026-09-18", elitesPos: null, results: [
    { site: "practo.com", kind: "directory" }, { site: "justdial.com", kind: "directory" }, { site: "justdial.com", kind: "directory" },
    { site: "clovedental.in", kind: "chain" }, { site: "prodentdentaltcpalya.com", kind: "competitor" }, { site: "drrupalidentalcare.com", kind: "competitor" },
    { site: "lybrate.com", kind: "directory" }, { site: "dentstop.co.in", kind: "competitor" }] },
  { term: "dentist in tc palya", date: "2026-10-24", elitesPos: 5, results: [
    { site: "practo.com", kind: "directory" }, { site: "justdial.com", kind: "directory" }, { site: "clovedental.in", kind: "chain" },
    { site: "prodentdentaltcpalya.com", kind: "competitor" }, { site: "elitesdental.com", kind: "elites" }, { site: "bajajfinservhealth.in", kind: "directory" },
    { site: "drrupalidentalcare.com", kind: "competitor" }, { site: "practo.com", kind: "directory" }, { site: "dentstopdental.com", kind: "competitor" }] },
  { term: "elites dental care tc palya", date: "2026-09-18", elitesPos: null, results: [
    { site: "elitedentalcare.co.in", kind: "other" }] },
  { term: "elites dental care tc palya", date: "2026-10-24", elitesPos: 1, results: [
    { site: "elitesdental.com", kind: "elites" }, { site: "practo.com", kind: "directory" }, { site: "elitesdental.com", kind: "elites" },
    { site: "instagram.com", kind: "elites" }, { site: "elitesdental.com", kind: "elites" }, { site: "magicpin.in", kind: "directory" }] },
];
export const SERP_NOTE = "Read in a browser on the dates shown (gl=in). Results can vary by device, location and account, so treat positions as a spot check, not a rank tracker.";

// ---------- Website scorecard (homepages, fetched 24 Oct 2026 as a mobile browser) ----------
export interface SiteAudit {
  site: string; who: string; elites?: boolean; ms: number | null; kb: number | null; h1: number; metaDesc: boolean;
  dentistSchema: boolean; ratingSchema: boolean; faq: boolean; blog: boolean; whatsapp: boolean; prices: boolean;
  googleAds: boolean; metaPixel: boolean; tagManager: boolean; llmsTxt: boolean; words: number; note?: string;
}
export const SITES: SiteAudit[] = [
  { site: "elitesdental.com", who: "Elites", elites: true, ms: 800, kb: 446, h1: 2, metaDesc: true, dentistSchema: true, ratingSchema: false, faq: false, blog: true, whatsapp: true, prices: false, googleAds: true, metaPixel: false, tagManager: false, llmsTxt: false, words: 1135 },
  { site: "prodentdentaltcpalya.com", who: "Prodent", ms: 523, kb: 89, h1: 2, metaDesc: true, dentistSchema: false, ratingSchema: false, faq: true, blog: true, whatsapp: true, prices: false, googleAds: true, metaPixel: false, tagManager: true, llmsTxt: false, words: 868, note: "Ads tag loads through Tag Manager (AW-17543698423 seen 18 Sep)" },
  { site: "dentstop.co.in", who: "DentStop", ms: 963, kb: 212, h1: 1, metaDesc: true, dentistSchema: true, ratingSchema: false, faq: false, blog: true, whatsapp: false, prices: false, googleAds: true, metaPixel: false, tagManager: false, llmsTxt: true, words: 1697 },
  { site: "drrupalidentalcare.com", who: "Dr Rupali's", ms: 3117, kb: 113, h1: 1, metaDesc: false, dentistSchema: false, ratingSchema: false, faq: false, blog: true, whatsapp: false, prices: false, googleAds: true, metaPixel: true, tagManager: true, llmsTxt: true, words: 663 },
  { site: "arkasdental.com", who: "Arkas", ms: 450, kb: 126, h1: 1, metaDesc: true, dentistSchema: true, ratingSchema: true, faq: false, blog: true, whatsapp: true, prices: false, googleAds: false, metaPixel: false, tagManager: false, llmsTxt: false, words: 301 },
  { site: "nimidental.com", who: "nimi", ms: 6109, kb: 141, h1: 1, metaDesc: true, dentistSchema: false, ratingSchema: false, faq: true, blog: true, whatsapp: false, prices: false, googleAds: false, metaPixel: true, tagManager: true, llmsTxt: false, words: 445 },
  { site: "kksdental.com", who: "KKS Dental", ms: 4145, kb: 78, h1: 1, metaDesc: true, dentistSchema: false, ratingSchema: false, faq: true, blog: false, whatsapp: true, prices: false, googleAds: false, metaPixel: false, tagManager: false, llmsTxt: false, words: 686 },
];
export const SITE_CHECKS: { key: keyof SiteAudit; label: string; weight: number; why: string }[] = [
  { key: "dentistSchema", label: "Dentist schema", weight: 3, why: "Tells Google and AI assistants the page is a dental clinic at this address" },
  { key: "ratingSchema", label: "Star-rating schema", weight: 2, why: "Can show review stars in results; only Arkas has it" },
  { key: "metaDesc", label: "Meta description", weight: 1, why: "Controls the snippet under the link" },
  { key: "faq", label: "FAQ section", weight: 2, why: "Answers the questions people type and AI tools quote" },
  { key: "blog", label: "Blog / articles", weight: 1, why: "Ranks for treatment and cost questions" },
  { key: "whatsapp", label: "WhatsApp button", weight: 2, why: "Most local patients would rather message than call" },
  { key: "prices", label: "Published prices", weight: 2, why: "Nobody on this road publishes prices — open ground" },
  { key: "googleAds", label: "Google Ads tag", weight: 1, why: "Sign the clinic is buying search traffic" },
  { key: "metaPixel", label: "Meta Pixel", weight: 1, why: "Needed to retarget visitors on Instagram/Facebook" },
  { key: "tagManager", label: "Tag Manager", weight: 1, why: "Easier, safer tracking changes" },
  { key: "llmsTxt", label: "llms.txt", weight: 1, why: "Plain-text summary for AI crawlers (small but free)" },
];
export function siteScore(s: SiteAudit): number {
  const max = SITE_CHECKS.reduce((a, c) => a + c.weight, 0) + 2;
  const got = SITE_CHECKS.reduce((a, c) => a + (s[c.key] ? c.weight : 0), 0) + (s.h1 === 1 ? 2 : s.h1 > 1 ? 1 : 0);
  return Math.round((got / max) * 100);
}

// ---------- Directories and social (audit 18–19 Sep; Elites brand search 24 Oct) ----------
export const PRESENCE: { channel: string; elites: string; best: string; tone: "good" | "bad" | "warn" }[] = [
  { channel: "Google Business Profile", elites: "4.9★ · 325 reviews (24 Oct)", best: "SmileFit 848 · Dezigner Smiles 1,901", tone: "warn" },
  { channel: "Practo", elites: "Not listed (a different ‘Elite Care Clinic’ shows on brand search)", best: "SmileFit full clinic page; Prodent's dentist has 3 doctor profiles", tone: "bad" },
  { channel: "Justdial", elites: "Listed 4.9 · 187 ratings, but under ‘Manjunatha Layout’", best: "Two Justdial pages own the top of page one", tone: "warn" },
  { channel: "Lybrate / Bajaj Health / Drlogy", elites: "Not listed", best: "Clove on Bajaj Health (ranks #6)", tone: "bad" },
  { channel: "Instagram", elites: "@elitesdentalcare — 30 followers (18 Sep)", best: "Prodent active on 6 social channels", tone: "bad" },
  { channel: "Facebook", elites: "2 followers (18 Sep)", best: "—", tone: "bad" },
  { channel: "Own website", elites: "Ranks #5 for both money terms (was absent 18 Sep)", best: "Prodent #4 · Clove #2–3", tone: "good" },
];

// ---------- Paid competition ----------
export const PAID = {
  advertisers: [
    { who: "DentStop", evidence: "Google Ads tag AW-17631669742 on site (24 Oct)" },
    { who: "Dr Rupali's Dental Care", evidence: "Ads tag AW-665907199 + Meta Pixel on site (24 Oct)" },
    { who: "Prodent", evidence: "Ads tag AW-17543698423 (18 Sep)" },
    { who: "Clove Dental", evidence: "Running Search ads (18 Sep)" },
    { who: "Ridgetop, National Dental Care, Smile Elements", evidence: "Sponsored Maps pins on ‘dentist’ near TC Palya (24 Oct) — clinics from outside the area" },
  ],
  // Competitor names Elites' own ads paid for, 1 Aug – 18 Sep (search terms report)
  brandSpend: [
    { term: "clove dental near me", cost: 277.89 }, { term: "sabka dentist near me", cost: 182.45 }, { term: "clove dental clinic near me", cost: 152.5 },
    { term: "dezy dental clinic near me", cost: 122.36 }, { term: "arvind's …", cost: 109.95 }, { term: "aagya's …", cost: 98.64 }, { term: "dr rajesh …", cost: 54.94 },
  ],
  // Competitor brand demand seen on Elites' Business Profile search terms, Apr–Sep 2026
  gbpTerms: [
    { term: "dental clinic near me", n: 1002 }, { term: "dentist near me", n: 414 }, { term: "kks dental", n: 307 }, { term: "pediatric dentist near me", n: 229 },
    { term: "elites dental care", n: 192 }, { term: "dental clinic", n: 187 }, { term: "elite dental clinic", n: 127 }, { term: "dentist", n: 125 }, { term: "dental clinic in tc palya", n: 99 },
  ],
};

// ---------- Maps rank from the clinic pin ----------
export const MAPS_RANK: { term: string; s2: number | null; s3: number | null }[] = [
  { term: "pediatric dentist", s2: 4, s3: null },
  { term: "dental clinic tc palya", s2: 7, s3: 8 },
  { term: "dental implants", s2: 10, s3: null },
  { term: "dentist", s2: 14, s3: 20 },
  { term: "root canal", s2: 17, s3: null },
];
export const MAPS_NOTE = "27 Sep: signed-in, single point at the pin. 24 Oct: position in the Maps list for the search, map centred on the clinic. Different methods — compare direction, not exact places.";

// ---------- Density (Overture Maps open data, release 2026-10-21.0) ----------
export const DENSITY = { release: "2026-10-21.0", within1: 4, within2: 23, within3: 33, withWebsite: 25,
  note: "Places tagged dental clinic / general dentistry with confidence ≥ 0.5. Open data misses some clinics — Google Maps lists more than 70 within the same view — so this is a floor." };
export const DENSITY_POINTS: { name: string; km: number; bearing: number }[] = [
  { name: "Shiva Dental", km: 0.32, bearing: 200 }, { name: "Prodent", km: 0.38, bearing: 250 }, { name: "KKS Dental", km: 0.39, bearing: 300 },
  { name: "Pooja Dental", km: 0.85, bearing: 20 }, { name: "Arkas", km: 1.02, bearing: 60 }, { name: "SmileFit", km: 1.03, bearing: 120 },
  { name: "Sai Aditi", km: 1.2, bearing: 170 }, { name: "Narayana", km: 1.21, bearing: 330 }, { name: "Clove", km: 1.22, bearing: 220 },
  { name: "Ranganath", km: 1.32, bearing: 90 }, { name: "Smile Studio", km: 1.5, bearing: 140 }, { name: "Specialist's", km: 1.57, bearing: 280 },
  { name: "Lotus", km: 1.61, bearing: 10 }, { name: "DDC", km: 1.62, bearing: 45 }, { name: "DentalDost", km: 1.62, bearing: 310 },
  { name: "Just Dental", km: 1.64, bearing: 190 }, { name: "nimi", km: 1.64, bearing: 345 }, { name: "Pro+", km: 1.74, bearing: 235 },
  { name: "Healthy Smiles", km: 1.85, bearing: 100 }, { name: "Shine", km: 1.89, bearing: 160 }, { name: "Mahita", km: 1.91, bearing: 70 },
  { name: "Tirumala", km: 1.98, bearing: 260 }, { name: "32 Smile", km: 2.2, bearing: 30 }, { name: "Aspire", km: 2.4, bearing: 300 },
  { name: "Nakshatra", km: 2.54, bearing: 130 }, { name: "Star Light", km: 2.58, bearing: 210 }, { name: "Inspiring Smilzz", km: 2.68, bearing: 80 },
  { name: "City Dental", km: 2.91, bearing: 170 }, { name: "Clove (2)", km: 2.92, bearing: 350 }, { name: "Seven Hills", km: 2.93, bearing: 110 },
  { name: "Seven Hills (2)", km: 2.96, bearing: 115 },
];

// ---------- Audit history (then → now) ----------
export interface AuditItem { area: string; item: string; then: string; now: string; status: "fixed" | "better" | "open" | "worse"; live?: string }
export const AUDIT: AuditItem[] = [
  { area: "Search", item: "Page one for ‘dental clinic tc palya’", then: "Absent (18 Sep)", now: "#5 organic (24 Oct)", status: "fixed" },
  { area: "Search", item: "Page one for ‘dentist in tc palya’", then: "Absent (18 Sep)", now: "#5 organic (24 Oct)", status: "fixed" },
  { area: "Search", item: "Brand search ‘Elites Dental Care TC Palya’", then: "#1 was a different clinic (elitedentalcare.co.in)", now: "elitesdental.com #1, 4 of top 5 are Elites", status: "fixed" },
  { area: "Website", item: "H1 headings", then: "No H1 on homepage or any service page", now: "", status: "better", live: "h1" },
  { area: "Website", item: "Meta descriptions", then: "Missing on all 11 pages checked", now: "", status: "fixed", live: "meta" },
  { area: "Website", item: "Dentist / LocalBusiness schema", then: "None", now: "", status: "better", live: "schema" },
  { area: "Website", item: "Wrong brand in titles (‘| Elite Dental’)", then: "7 pages", now: "Homepage title now ‘… | Elites Dental Care’", status: "fixed" },
  { area: "Website", item: "Star-rating schema", then: "None", now: "", status: "open", live: "rating" },
  { area: "Website", item: "FAQ markup", then: "FAQs on pages, no FAQPage markup", now: "", status: "open", live: "faq" },
  { area: "Website", item: "Homepage size", then: "619–666 KB HTML, 5.3 s throttled load", now: "446 KB, 0.8 s from a data centre", status: "better" },
  { area: "Website", item: "llms.txt for AI crawlers", then: "Missing", now: "", status: "open", live: "llms" },
  { area: "Business Profile", item: "Reviews", then: "271 (18 Sep)", now: "325 (24 Oct) — +54 in 36 days", status: "better" },
  { area: "Business Profile", item: "Services list", then: "300 entries, 178 stuffed duplicates", now: "121 clean entries (27 Sep)", status: "fixed" },
  { area: "Business Profile", item: "Locality name", then: "3 names: Sannatammanahalli, Battarahalli, Manjunatha Layout", now: "Profile + site say Sannatammanahalli/TC Palya; Justdial still Manjunatha Layout", status: "better" },
  { area: "Tracking", item: "Conversion value", then: "Hard-coded ₹1", now: "Fixed 7 Oct; GA4 key events still to mark", status: "better" },
  { area: "Tracking", item: "Meta Pixel", then: "None", now: "None — ad clicks can't be retargeted", status: "open" },
  { area: "Tracking", item: "Behaviour analytics", then: "None", now: "Microsoft Clarity live since 21 Oct", status: "fixed" },
  { area: "Paid", item: "Ads delivery", then: "All campaigns paused", now: "Search campaign ran 1–17 Oct (680 clicks, ₹14.4K); not serving since 17 Oct", status: "worse" },
  { area: "Directories", item: "Practo / Lybrate / Bajaj / Drlogy", then: "Not listed", now: "Not listed", status: "open" },
  { area: "Social", item: "Instagram / Facebook", then: "30 / 2 followers", now: "Not re-checked", status: "open" },
];

// ---------- Opportunities (impact 1–5, effort 1–5) ----------
export const OPPS: { title: string; impact: number; effort: number; cost: string; why: string }[] = [
  { title: "Ask every patient for a review", impact: 5, effort: 1, cost: "₹0", why: "Elites gains reviews faster than any clinic on the road (+54 in 36 days) and has already passed Pro+; Pooja is 19 ahead" },
  { title: "Claim Practo, Lybrate, Bajaj Health", impact: 5, effort: 2, cost: "₹0 to list", why: "Directories hold 4–5 of 8 page-one spots for both money terms" },
  { title: "Doctor profiles for all six MDS specialists", impact: 4, effort: 2, cost: "₹0", why: "Practo ranks doctors, not only clinics; Prodent's one dentist has three profiles" },
  { title: "Publish treatment prices", impact: 4, effort: 2, cost: "Low", why: "No clinic on the road publishes prices; 9 of 10 implant-cost results do" },
  { title: "Restart Search ads with call tracking", impact: 4, effort: 2, cost: "Ad budget", why: "October CPC was ₹21, a third of August's ₹51; campaign stopped 17 Oct" },
  { title: "Star-rating + FAQ schema", impact: 3, effort: 1, cost: "₹0", why: "Arkas is the only site with rating markup; nobody has FAQPage" },
  { title: "Fix Justdial locality", impact: 2, effort: 1, cost: "₹0", why: "One address everywhere strengthens the map listing" },
  { title: "Meta Pixel + Instagram content", impact: 3, effort: 3, cost: "Creative time", why: "Dr Rupali's and nimi already retarget; Elites can't" },
  { title: "Report name-stuffing (PearlFix, PNS)", impact: 3, effort: 1, cost: "₹0", why: "Keyword-stuffed names rank #1 for their terms; Google can remove the extra words" },
];
