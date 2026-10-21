// POST /functions/v1/site-check  — owner/editor (dashboard button) or the scheduler (x-cron-secret).
// Reads the live site the way an answer engine or AI crawler would: robots.txt, llms.txt, sitemap,
// and key pages (structured data, headings, meta). Stores the result in settings.site_check.
import { admin, callerRole, cors, json, timingSafeEqual } from "../_shared/util.ts";

const SITE = "https://elitesdental.com";
const UA = "EliteDentalCare-SiteCheck/1.0 (+https://elites-marketing-dashboard.vercel.app)";
const DEFAULT_PAGES = ["/", "/about-us/", "/contact-us/", "/dental-implants/", "/root-canal-treatment/", "/orthodontics/",
  "/teeth-whitening/", "/crowns-bridges/", "/pediatric-dentistry/", "/appointment-form/"];
const BOTS = [
  { ua: "GPTBot", owner: "OpenAI (training)" }, { ua: "OAI-SearchBot", owner: "OpenAI (ChatGPT search)" }, { ua: "ChatGPT-User", owner: "OpenAI (user browsing)" },
  { ua: "PerplexityBot", owner: "Perplexity" }, { ua: "ClaudeBot", owner: "Anthropic" }, { ua: "Google-Extended", owner: "Google (Gemini training)" },
  { ua: "Googlebot", owner: "Google Search (incl. AI Overviews)" }, { ua: "Bingbot", owner: "Bing / Copilot" }, { ua: "CCBot", owner: "Common Crawl" },
];
const LOCALITIES: [string, RegExp][] = [
  ["Sannatammanahalli", /sannatammanahalli|sonnathimmanahalli/gi], ["TC Palya", /\bT\.?\s?C\.?\s?Palya\b/gi], ["Thambu Chetty Palya", /thambu\s*chetty\s*palya/gi],
  ["Manjunatha Layout", /manjunatha\s*layout/gi], ["Battarahalli", /battarahalli/gi], ["Ramamurthy Nagar", /rama\s?murthy\s*nagar/gi], ["KR Puram", /\bK\.?\s?R\.?\s?Puram\b/gi],
];

async function get(path: string) {
  const url = path.startsWith("http") ? path : SITE + path;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    return { url, status: r.status, finalUrl: r.url, text: r.ok ? await r.text() : "" };
  } catch (e) { return { url, status: 0, finalUrl: url, text: "", error: String(e).slice(0, 200) }; }
}

const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** robots.txt: is this user agent allowed to fetch "/"? Group-based, longest-match on Allow/Disallow. */
function robotsVerdict(txt: string, ua: string): "allowed" | "blocked" | "not mentioned" {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: any = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(); if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; }
    else { lastWasAgent = false; if (cur && (k === "allow" || k === "disallow")) cur.rules.push({ allow: k === "allow", path: v }); }
  }
  const pick = groups.find((g) => g.agents.includes(ua.toLowerCase())) ?? groups.find((g) => g.agents.includes("*"));
  const explicit = groups.some((g) => g.agents.includes(ua.toLowerCase()));
  if (!pick) return "not mentioned";
  const hits = pick.rules.filter((r) => r.path !== "" && "/".startsWith(r.path.replace(/\*$/, "")));
  const best = hits.sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow))[0];
  const verdict = best && !best.allow ? "blocked" : "allowed";
  return explicit || verdict === "blocked" ? verdict : "not mentioned";
}

function jsonLdTypes(html: string): { types: string[]; address: string | null; rating: boolean; faqCount: number } {
  const types = new Set<string>(); let address: string | null = null; let rating = false; let faqCount = 0;
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: any; try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const walk = (n: any) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== "object") return;
      const t = n["@type"]; (Array.isArray(t) ? t : t ? [t] : []).forEach((x: string) => types.add(String(x)));
      if (n.aggregateRating) rating = true;
      if ((Array.isArray(t) ? t : [t]).includes("FAQPage")) faqCount += Array.isArray(n.mainEntity) ? n.mainEntity.length : 0;
      if (n.address && !address) address = typeof n.address === "string" ? n.address : [n.address.streetAddress, n.address.addressLocality, n.address.postalCode].filter(Boolean).join(", ");
      Object.values(n).forEach(walk);
    };
    walk(data);
  }
  return { types: [...types].sort(), address, rating, faqCount };
}

function pageFacts(path: string, r: { status: number; finalUrl: string; text: string; error?: string }) {
  const h = r.text;
  const title = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
  const meta = h.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? h.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1] ?? null;
  const h1 = [...h.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => strip(m[1])).filter(Boolean);
  const heads = [...h.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi)].map((m) => strip(m[1])).filter(Boolean);
  const qHeads = heads.filter((x) => /\?\s*$|^(how|what|why|when|which|who|where|can|is|are|does|do|should|will)\b/i.test(x));
  const ld = jsonLdTypes(h);
  const text = strip(h);
  return {
    path, url: r.finalUrl, status: r.status, error: r.error ?? null, title, meta_description: meta, h1_count: h1.length, h1: h1.slice(0, 2),
    question_headings: qHeads.length, question_examples: qHeads.slice(0, 4), words: text ? text.split(" ").length : 0,
    schema_types: ld.types, faq_items: ld.faqCount, has_rating_schema: ld.rating, schema_address: ld.address,
    has_local_business: ld.types.some((t) => /Dentist|LocalBusiness|MedicalClinic|MedicalBusiness|MedicalOrganization/.test(t)),
    canonical: h.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? null,
    localities: Object.fromEntries(LOCALITIES.map(([l, re]) => [l, (text.match(re) ?? []).length]).filter(([, n]) => (n as number) > 0)),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const db = admin();
  let who: { email: string; role: string } | null = null;
  const hdr = req.headers.get("x-cron-secret") ?? "";
  if (hdr) {
    const { data: c } = await db.rpc("svc_get_credential", { p_provider: "cron" });
    const s = c?.[0]?.api_token ?? "";
    if (s && timingSafeEqual(hdr, s)) who = { email: "scheduler", role: "owner" };
  }
  who ??= await callerRole(req);
  if (!who || !["owner", "editor"].includes(who.role)) return json({ error: "forbidden" }, 403);
  const started = new Date().toISOString();

  // Pages: defaults plus the site's top Search Console pages.
  const { data: top } = await db.from("gsc_daily_query_page").select("page, impressions").order("impressions", { ascending: false }).limit(400);
  const extra = [...new Set((top ?? []).map((r: any) => { try { return new URL(r.page).pathname; } catch { return null; } }).filter(Boolean))] as string[];
  const pages = [...new Set([...DEFAULT_PAGES, ...extra])].slice(0, 14);

  const [robots, llms, llmsFull, sitemap] = await Promise.all([get("/robots.txt"), get("/llms.txt"), get("/llms-full.txt"), get("/sitemap_index.xml")]);
  const results = [];
  for (let i = 0; i < pages.length; i += 4) {
    const batch = await Promise.all(pages.slice(i, i + 4).map(async (p) => pageFacts(p, await get(p))));
    results.push(...batch);
  }
  const value = {
    checked_at: new Date().toISOString(), started_at: started, checked_by: who.email, site: SITE,
    robots: { status: robots.status, bots: BOTS.map((b) => ({ ...b, verdict: robots.status === 200 ? robotsVerdict(robots.text, b.ua) : "no robots.txt" })),
      sitemap_declared: /sitemap:/i.test(robots.text) },
    llms_txt: { status: llms.status, bytes: llms.text.length, full_status: llmsFull.status },
    sitemap: { status: sitemap.status, urls: (sitemap.text.match(/<loc>/g) ?? []).length },
    pages: results,
  };
  const { error } = await db.from("settings").upsert({ key: "site_check", value });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, pages: results.length, checked_at: value.checked_at });
});
