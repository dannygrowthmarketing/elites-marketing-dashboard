// Source and channel marks. Brand marks come from the Simple Icons set (used only to label each data source);
// sources without a published mark get a lettered badge in their own colour.
import type { CSSProperties } from "react";
import {
  siGoogleads, siMeta, siWhatsapp, siMailchimp, siPhonepe, siGooglepay, siRazorpay, siPaytm, siInstagram, siFacebook,
  siYoutube, siGoogleanalytics, siGooglesearchconsole, siGooglemaps, siGoogle, siWordpress, siGoogletagmanager, siSupabase,
} from "simple-icons";

type Brand = { title: string; hex: string; path: string };
type Mono = { title: string; hex: string; letters: string };
type Glyph = { title: string; hex: string; glyph: keyof typeof GLYPHS };
type Mark = Brand | Mono | Glyph;

// Simple line glyphs for things that aren't brands.
const GLYPHS = {
  influencer: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z",
  email: "M3 6h18v12H3z M3 6l9 7 9-7",
  seo: "M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z M15.5 15.5L21 21",
  crm: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7",
  community: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M2 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5 M12 20c0-3.3 1.8-5.5 4-5.5 3.3 0 6 2.2 6 5.5",
  camera: "M4 7h4l2-3h4l2 3h4v12H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  reserve: "M4 7h16v12H4z M4 11h16 M9 15h2",
  tracking: "M3 12h4l3-7 4 14 3-7h4",
  web: "M3 5h18v14H3z M3 9h18 M7 7h.01 M10 7h.01",
  directory: "M5 4h11l3 3v13H5z M9 10h6 M9 14h6",
  star: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z",
  upi: "M7 4l-3 16 M13 4l-3 16 M17 4l3 8-3 8",
  bank: "M3 10l9-6 9 6 M5 10v8 M9 10v8 M15 10v8 M19 10v8 M3 20h18",
  card: "M3 6h18v12H3z M3 10h18 M7 15h4",
  home: "M3 11l9-7 9 7 M5 10v10h14V10 M10 20v-6h4v6",
  bulb: "M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  spark: "M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l2.5 2.5 M15.5 15.5L18 18 M6 18l2.5-2.5 M15.5 8.5L18 6",
  funnel: "M3 4h18l-7 8v6l-4 2v-8z",
  sliders: "M4 6h10 M18 6h2 M4 12h4 M12 12h8 M4 18h12 M20 18h0 M14 4v4 M8 10v4 M16 16v4",
  doc: "M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19 12l2-1-1-3-2 .3-1.3-1.3.3-2-3-1-1 2h-2l-1-2-3 1 .3 2L6 7.3 4 7 3 10l2 1v2l-2 1 1 3 2-.3 1.3 1.3-.3 2 3 1 1-2h2l1 2 3-1-.3-2 1.3-1.3 2 .3 1-3-2-1z",
  plug: "M9 3v5 M15 3v5 M6 8h12v3a6 6 0 0 1-12 0z M12 17v4",
  trophy: "M8 4h8v5a4 4 0 0 1-8 0z M8 6H4c0 3 2 4 4 4 M16 6h4c0 3-2 4-4 4 M12 13v4 M8 21h8 M9 17h6",
  rupee: "M6 4h12 M6 8h12 M8 4c5 0 6 8 0 8 M8 12l8 8",
  handshake: "M3 12l4-4 4 2 4-2 6 4 M7 8l-4 7 4 3 3-2 2 2 3-2 3 1 2-3 M10 16l2 2",
  attribution: "M4 19l6-6 4 4 6-8 M14 9h6v6",
};

const B = (s: { title: string; hex: string; path: string }, title = s.title): Brand => ({ title, hex: "#" + s.hex, path: s.path });

export const MARKS: Record<string, Mark> = {
  google_ads: B(siGoogleads, "Google Ads"),
  meta: B(siMeta, "Meta"), meta_ads: B(siMeta, "Meta Ads"),
  instagram: B(siInstagram), facebook: B(siFacebook), youtube: B(siYoutube),
  whatsapp: B(siWhatsapp), mailchimp: { ...B(siMailchimp), hex: "#241C15" },
  phonepe: B(siPhonepe, "PhonePe"), gpay: B(siGooglepay, "Google Pay"), razorpay: { ...B(siRazorpay), hex: "#3395FF" }, paytm: { ...B(siPaytm), hex: "#00BAF2" },
  ga4: B(siGoogleanalytics, "Google Analytics 4"), gsc: B(siGooglesearchconsole, "Search Console"),
  gbp: B(siGooglemaps, "Business Profile"), google: B(siGoogle), wordpress: B(siWordpress, "Website forms"),
  gtm: B(siGoogletagmanager, "Tag Manager"), supabase: B(siSupabase),
  clarity: { title: "Microsoft Clarity", hex: "#0078D4", letters: "C" },
  cashfree: { title: "Cashfree", hex: "#6933D3", letters: "CF" },
  practo: { title: "Practo", hex: "#14BEF0", letters: "P" },
  justdial: { title: "Justdial", hex: "#FF6F00", letters: "Jd" },
  upi: { title: "UPI", hex: "#097939", glyph: "upi" },
  influencer: { title: "Influencers", hex: "#D6336C", glyph: "influencer" },
  email: { title: "Email", hex: "#C9A84C", glyph: "email" },
  seo: { title: "SEO & content", hex: "#2E7D7A", glyph: "seo" },
  crm: { title: "CRM", hex: "#6B4E7A", glyph: "crm" },
  community: { title: "Community", hex: "#B5543A", glyph: "community" },
  creative: { title: "Creative", hex: "#8E5BD9", glyph: "camera" },
  reserve: { title: "Reserve", hex: "#5B6B82", glyph: "reserve" },
  tracking: { title: "Tracking", hex: "#2F5F8F", glyph: "tracking" },
  web: { title: "Website", hex: "#0B1F3A", glyph: "web" },
  directory: { title: "Directories", hex: "#14BEF0", glyph: "directory" },
  reviews: { title: "Reviews", hex: "#F4B400", glyph: "star" },
  bank: { title: "Bank transfer", hex: "#5B6B82", glyph: "bank" },
  card: { title: "Card", hex: "#2F5F8F", glyph: "card" },
  home: { title: "Overview", hex: "#C9A84C", glyph: "home" }, bulb: { title: "Insights", hex: "#C9A84C", glyph: "bulb" },
  spark: { title: "AI", hex: "#C9A84C", glyph: "spark" }, funnel: { title: "Funnel", hex: "#C9A84C", glyph: "funnel" },
  sliders: { title: "Simulator", hex: "#C9A84C", glyph: "sliders" }, doc: { title: "Reports", hex: "#C9A84C", glyph: "doc" },
  gear: { title: "Settings", hex: "#C9A84C", glyph: "gear" }, plug: { title: "Integrations", hex: "#C9A84C", glyph: "plug" },
  trophy: { title: "Competitors", hex: "#C9A84C", glyph: "trophy" }, rupee: { title: "Revenue", hex: "#C9A84C", glyph: "rupee" },
  handshake: { title: "Partnerships", hex: "#C9A84C", glyph: "handshake" }, attribution: { title: "Attribution", hex: "#C9A84C", glyph: "attribution" },
  plan: { title: "Budget", hex: "#C9A84C", glyph: "reserve" }, leads: { title: "Leads", hex: "#C9A84C", glyph: "crm" }, site: { title: "Website", hex: "#C9A84C", glyph: "web" },
};

/** Integration source key → mark. */
export const SOURCE_MARK: Record<string, string> = {
  ga4: "ga4", gsc: "gsc", gbp: "gbp", google_ads: "google_ads", meta_ads: "meta_ads", clarity: "clarity", wordpress: "wordpress",
  mailchimp: "mailchimp", whatsapp: "whatsapp", razorpay: "razorpay", phonepe: "phonepe", cashfree: "cashfree",
};

export function Logo({ id, size = 22, tile = true, title, style }: { id: string; size?: number; tile?: boolean; title?: string; style?: CSSProperties }) {
  const m = MARKS[id];
  if (!m) return null;
  const label = title ?? m.title;
  const inner = Math.round(size * (tile ? 0.6 : 1));
  const body = "path" in m
    ? <svg viewBox="0 0 24 24" width={inner} height={inner} aria-hidden><path d={m.path} fill={m.hex} /></svg>
    : "glyph" in m
      ? <svg viewBox="0 0 24 24" width={inner} height={inner} aria-hidden fill="none" stroke={m.hex} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d={GLYPHS[m.glyph]} /></svg>
      : <span style={{ fontSize: Math.round(size * (m.letters.length > 1 ? 0.36 : 0.46)), color: m.hex, fontWeight: 800, letterSpacing: "-.02em" }}>{m.letters}</span>;
  if (!tile) return <span className="logo-bare" title={label} role="img" aria-label={label} style={style}>{body}</span>;
  return (
    <span className="logo-tile" title={label} role="img" aria-label={label}
      style={{ width: size, height: size, ["--lc" as any]: m.hex, ...style }}>{body}</span>
  );
}

export function LogoStack({ ids, size = 22 }: { ids: string[]; size?: number }) {
  return <span className="logo-stack">{ids.map((i) => <Logo key={i} id={i} size={size} />)}</span>;
}
