// Pure lead normalisation + mapping. No I/O — unit tested.

export interface Touch {
  source?: string; medium?: string; campaign?: string; term?: string; content?: string;
  landing?: string; referrer?: string; gclid?: string; fbclid?: string; ts?: string;
}

export interface LeadPayload {
  event: "form_submit" | "booking_confirmed" | "video_consult" | "contact_form";
  external_ref?: string;
  occurred_at?: string;
  name?: string;
  phone?: string;
  email?: string;
  service?: string;
  form_name?: string;
  consent?: boolean;
  appointment_at?: string;
  page_url?: string;
  is_test?: boolean;
  attribution?: { first?: Touch; last?: Touch };
}

/** Normalise an Indian-default phone number to E.164. Returns null if it can't be a valid number. */
export function normalisePhone(raw?: string | null): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) {
    d = d.slice(1);
    // "+8073674779": an Indian mobile with the 91 dropped (seen on this site's old tel links)
    if (/^[6-9]\d{9}$/.test(d)) d = "91" + d;
  }
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0") && d.length === 11) d = "91" + d.slice(1);
  else if (d.length === 10) d = "91" + d;
  if (!/^\d{8,15}$/.test(d)) return null;
  if (d.startsWith("91") && d.length !== 12) return null;
  return "+" + d;
}

export function normaliseEmail(raw?: string | null): string | null {
  if (!raw) return null;
  const e = String(raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Phone is the strongest identifier for a dental clinic; email is the fallback. */
export function dedupeBasis(phone: string | null, email: string | null): string | null {
  if (phone) return `p:${phone}`;
  if (email) return `e:${email}`;
  return null;
}

export function inquiryType(ev: LeadPayload["event"]): string {
  switch (ev) {
    case "booking_confirmed": return "booking";
    case "video_consult": return "video_consult";
    default: return "contact_form";
  }
}

export function channelFor(ev: LeadPayload["event"]): string {
  return ev === "booking_confirmed" ? "booking_widget" : ev === "video_consult" ? "video_consult_form" : "website_form";
}

const clean = (s?: string | null, max = 300) => (s == null ? null : String(s).trim().slice(0, max) || null);

/** Infer source/medium when UTMs are missing, using click ids and referrer. */
export function resolveTouch(t: Touch | undefined): Required<Pick<Touch, "source" | "medium">> & Touch {
  const x = { ...(t ?? {}) };
  let source = clean(x.source)?.toLowerCase() ?? null;
  let medium = clean(x.medium)?.toLowerCase() ?? null;
  if (!source && x.gclid) { source = "google"; medium = "cpc"; }
  if (!source && x.fbclid) { source = "facebook"; medium = medium ?? "paid"; }
  if (!source && x.referrer) {
    try {
      const h = new URL(x.referrer).hostname.replace(/^www\./, "");
      if (/google\./.test(h)) { source = "google"; medium = "organic"; }
      else if (/bing\.com$/.test(h)) { source = "bing"; medium = "organic"; }
      else if (/(facebook|fb)\.com$|instagram\.com$/.test(h)) { source = h.includes("instagram") ? "instagram" : "facebook"; medium = "social"; }
      else if (/elitesdental\.com$/.test(h)) { /* internal */ }
      else { source = h; medium = "referral"; }
    } catch { /* bad referrer */ }
  }
  return { ...x, source: source ?? "(direct)", medium: medium ?? "(none)" };
}

/** Columns for a new lead row (without id/dedupe_key, which need I/O). */
export function leadColumns(p: LeadPayload) {
  const phone = normalisePhone(p.phone);
  const email = normaliseEmail(p.email);
  const first = resolveTouch(p.attribution?.first ?? p.attribution?.last);
  const last = resolveTouch(p.attribution?.last ?? p.attribution?.first);
  const at = p.occurred_at && !isNaN(Date.parse(p.occurred_at)) ? new Date(p.occurred_at).toISOString() : new Date().toISOString();
  return {
    phone, email,
    row: {
      first_inquiry_at: at,
      name: clean(p.name, 120),
      phone_e164: phone,
      email,
      inquiry_type: inquiryType(p.event),
      requested_service: clean(p.service, 80),
      first_source: first.source, first_medium: first.medium, first_campaign: clean(first.campaign),
      first_term: clean(first.term), first_content: clean(first.content), first_landing_page: clean(first.landing, 500),
      first_referrer: clean(first.referrer, 500), first_gclid: clean(first.gclid), first_fbclid: clean(first.fbclid),
      latest_source: last.source, latest_medium: last.medium, latest_campaign: clean(last.campaign), latest_touch_at: at,
      status: p.event === "booking_confirmed" ? "appointment_booked" : "new",
      consent_marketing: typeof p.consent === "boolean" ? p.consent : null,
      is_test: Boolean(p.is_test) || /\btest\b/i.test(p.name ?? ""),
    },
    touch: {
      occurred_at: at, channel: channelFor(p.event),
      source: last.source, medium: last.medium, campaign: clean(last.campaign), term: clean(last.term), content: clean(last.content),
      landing_page: clean(last.landing, 500), referrer: clean(last.referrer, 500), gclid: clean(last.gclid), fbclid: clean(last.fbclid),
      external_ref: clean(p.external_ref, 120),
    },
  };
}

/** Status only moves forward through the funnel on new activity; never downgrades. */
const ORDER = ["new", "contacted", "qualified", "appointment_booked", "completed"];
export function advanceStatus(current: string, incoming: string): string {
  if (["lost", "cancelled"].includes(current) && incoming === "appointment_booked") return incoming; // re-engaged
  const a = ORDER.indexOf(current), b = ORDER.indexOf(incoming);
  if (a === -1) return current;
  return b > a ? incoming : current;
}

export const DEDUPE_WINDOW_DAYS = 90;
