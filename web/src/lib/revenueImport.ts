// Turn a clinic spreadsheet (Excel or CSV) into revenue rows: guess columns, parse Indian
// date/amount formats, and flag problems before anything is sent to the database.

export type Field = "date" | "amount" | "invoice" | "service" | "phone" | "email" | "patient_type" | "channel" | "note";

export const FIELDS: { key: Field; label: string; required?: boolean; help: string }[] = [
  { key: "date", label: "Date", required: true, help: "Day the money was collected" },
  { key: "amount", label: "Amount (₹)", required: true, help: "Amount collected, in rupees" },
  { key: "invoice", label: "Invoice / bill no.", help: "Stops the same bill being added twice" },
  { key: "service", label: "Service", help: "Category only, e.g. Implants, Aligners, Cleaning" },
  { key: "phone", label: "Patient phone", help: "Only used to find the matching lead — not stored" },
  { key: "email", label: "Patient email", help: "Only used to find the matching lead — not stored" },
  { key: "patient_type", label: "New / returning", help: "New or Returning" },
  { key: "channel", label: "Source", help: "How they found you, if known (Google, Walk-in, Referral…)" },
  { key: "note", label: "Note", help: "Short admin note. No clinical details" },
];

const SYNONYMS: Record<Field, string[]> = {
  date: ["date", "bill date", "invoice date", "payment date", "collected on", "collection date", "paid on", "txn date", "transaction date", "receipt date"],
  amount: ["amount", "amount inr", "amount rs", "amount ₹", "total", "total amount", "paid", "amount paid", "paid amount", "collected", "collected amount", "net amount", "revenue", "fee", "fees", "bill amount", "payment"],
  invoice: ["invoice", "invoice no", "invoice number", "invoice id", "bill", "bill no", "bill number", "receipt", "receipt no", "receipt number", "ref", "reference", "txn id"],
  service: ["service", "services", "service category", "treatment category", "category", "procedure category", "department", "treatment type"],
  phone: ["phone", "phone no", "phone number", "mobile", "mobile no", "mobile number", "contact", "contact no", "contact number", "whatsapp"],
  email: ["email", "e mail", "email id", "email address"],
  patient_type: ["patient type", "new returning", "new or returning", "new old", "visit type", "new patient"],
  channel: ["source", "lead source", "channel", "how did you hear", "how they found us", "marketing source"],
  note: ["note", "notes", "remark", "remarks", "comment", "comments"],
};

const norm = (h: unknown) => String(h ?? "").toLowerCase().replace(/[^a-z0-9₹]+/g, " ").trim();

/** Guess which spreadsheet column holds each field. Returns field -> column index. */
export function guessMapping(headers: unknown[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  const used = new Set<number>();
  const hs = headers.map(norm);
  // exact matches first, then "contains"
  for (const pass of ["exact", "contains"] as const) {
    for (const f of FIELDS.map((x) => x.key)) {
      if (out[f] != null) continue;
      const idx = hs.findIndex((h, i) => !used.has(i) && h !== "" && SYNONYMS[f].some((s) =>
        pass === "exact" ? h === s : (h.startsWith(s + " ") || h.endsWith(" " + s) || h.includes(" " + s + " "))));
      if (idx >= 0) { out[f] = idx; used.add(idx); }
    }
  }
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** Dates as clinics type them. Slashed dates are read day-first (Indian format). */
export function parseDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === "number") {
    // Excel serial day (only if a CSV kept the raw number)
    if (v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return iso(y, +m[2], +m[1]); }
  m = s.match(/^(\d{1,2})[\s\-/]*([A-Za-z]{3,9})[\s\-/,]*(\d{2,4})$/);
  if (m) { const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return mo < 0 ? null : iso(y, mo + 1, +m[1]); }
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) { const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); return mo < 0 ? null : iso(+m[3], mo + 1, +m[2]); }
  return null;
}

/** '₹12,500', 'Rs. 12,500.00', '12500 INR' -> 12500 */
export function parseAmount(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/(rs\.?|inr|₹|\s|,)/gi, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

export interface PreparedRow {
  row: number;            // spreadsheet row number (header = 1)
  data: Partial<Record<Field, string | number>>;
  errors: string[];
  warnings: string[];
}

const CLINICAL = /\b(diagnos|caries|cavity|abscess|infection|pain|bleed|root canal|rct|extract|surgery|medic|antibiotic|allerg|diabet|pregnan|x-?ray)/i;

/** Apply a column mapping to sheet rows and validate each one. */
export function prepareRows(rows: unknown[][], mapping: Partial<Record<Field, number>>, today: string): PreparedRow[] {
  const seen = new Map<string, number>();
  const out: PreparedRow[] = [];
  rows.forEach((r, i) => {
    if (!r || r.every((c) => c == null || String(c).trim() === "")) return;   // blank line
    const cell = (f: Field) => (mapping[f] == null ? null : r[mapping[f]!]);
    const errors: string[] = [], warnings: string[] = [];
    const date = parseDate(cell("date"));
    const amount = parseAmount(cell("amount"));
    if (!date) errors.push(cell("date") == null || cell("date") === "" ? "No date" : `Can't read date "${String(cell("date"))}"`);
    else if (date > today) errors.push("Date is in the future");
    if (amount == null) errors.push(cell("amount") == null || cell("amount") === "" ? "No amount" : `Can't read amount "${String(cell("amount"))}"`);
    else if (amount < 0) errors.push("Negative amount (enter refunds separately)");
    else if (amount === 0) warnings.push("Amount is ₹0");
    else if (amount > 1000000) warnings.push("Over ₹10 lakh — check it");
    const txt = (f: Field) => { const v = cell(f); return v == null ? "" : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim(); };
    const invoice = txt("invoice");
    if (invoice) {
      const k = invoice.toLowerCase();
      if (seen.has(k)) errors.push(`Same invoice as row ${seen.get(k)}`); else seen.set(k, i + 2);
    }
    const note = txt("note");
    if (note && CLINICAL.test(note)) warnings.push("Note looks clinical — it will be left out");
    const phone = txt("phone").replace(/[^\d+]/g, "");
    if (txt("phone") && phone.replace(/\D/g, "").length < 10) warnings.push("Phone too short to match a lead");
    out.push({
      row: i + 2, errors, warnings,
      data: {
        date: date ?? undefined, amount: amount ?? undefined, invoice: invoice || undefined, service: txt("service") || undefined,
        phone: phone || undefined, email: txt("email") || undefined, patient_type: txt("patient_type") || undefined,
        channel: txt("channel") || undefined, note: note && !CLINICAL.test(note) ? note.slice(0, 300) : undefined,
      },
    });
  });
  return out;
}

export const SERVICES = ["General check-up", "Root canal", "Implants", "Braces / aligners", "Crowns & bridges", "Dentures",
  "Cleaning", "Whitening", "Fillings", "Extraction", "Kids dentistry", "Smile makeover", "Other"];
export const SOURCES = ["Google Ads", "Google Business Profile", "Organic search", "Website", "Meta Ads", "Instagram / Facebook",
  "WhatsApp", "Walk-in", "Referral", "Returning patient", "Practo / listing site", "Other"];
