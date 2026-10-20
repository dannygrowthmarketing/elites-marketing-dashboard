import assert from "node:assert/strict";
import { backfillWindow, chunks, clampManual, incrementalWindow, SPECS } from "../supabase/functions/_shared/plan.ts";
import { advanceStatus, dedupeBasis, leadColumns, normaliseEmail, normalisePhone, resolveTouch } from "../supabase/functions/_shared/lead.ts";

const today = "2026-10-20";
const empty = { earliest_imported: null, latest_imported: null, backfill_complete: false };

// --- plan ---
const first = incrementalWindow("gsc", empty, today)!;
assert.equal(first.end, "2026-10-18", "GSC lags 2 days");
assert.equal(first.start, "2026-09-19", "first run = one 30-day chunk");

const inc = incrementalWindow("ga4", { ...empty, earliest_imported: "2026-07-01", latest_imported: "2026-10-18" }, today)!;
assert.equal(inc.start, "2026-10-14", "re-pull trailing 4 days");
assert.equal(inc.end, "2026-10-19");

const bf = backfillWindow("gsc", { ...empty, earliest_imported: "2026-09-19", latest_imported: "2026-10-18" }, today)!;
assert.equal(bf.end, "2026-09-18");
assert.equal(bf.start, "2026-08-20");
assert.equal(bf.finishesBackfill, false);

const gscFloor = SPECS.gsc.floor(today);
assert.equal(gscFloor, "2025-06-21", "16 months back + 1 day");
const last = backfillWindow("gsc", { ...empty, earliest_imported: "2025-07-10", latest_imported: "2026-10-18" }, today)!;
assert.equal(last.start, gscFloor);
assert.equal(last.finishesBackfill, true);
assert.equal(backfillWindow("gsc", { ...empty, earliest_imported: gscFloor, latest_imported: "x" }, today), null);
assert.equal(backfillWindow("gsc", { ...empty, backfill_complete: true }, today), null);

assert.equal(SPECS.google_ads.floor(today), "2019-02-01");
const c = clampManual("gsc", "2020-01-01", "2026-12-31", today)!;
assert.deepEqual(c, { start: gscFloor, end: "2026-10-18" });
assert.equal(clampManual("gsc", "2026-10-19", "2026-10-20", today), null);

const ch = chunks("2026-01-01", "2026-03-15", 30);
assert.equal(ch.length, 3);
assert.equal(ch[0].end, "2026-01-30");
assert.equal(ch[2].end, "2026-03-15");

// --- lead ---
assert.equal(normalisePhone("80736 74779"), "+918073674779");
assert.equal(normalisePhone("+91 80736-74779"), "+918073674779");
assert.equal(normalisePhone("08073674779"), "+918073674779");
assert.equal(normalisePhone("+8073674779"), "+918073674779", "repairs missing 91");
assert.equal(normalisePhone("12345"), null);
assert.equal(normalisePhone("+44 20 7946 0958"), "+442079460958");
assert.equal(normaliseEmail(" A@B.COM "), "a@b.com");
assert.equal(normaliseEmail("nope"), null);
assert.equal(dedupeBasis("+918073674779", "a@b.com"), "p:+918073674779");
assert.equal(dedupeBasis(null, "a@b.com"), "e:a@b.com");

assert.deepEqual(
  [resolveTouch({ gclid: "abc" }).source, resolveTouch({ gclid: "abc" }).medium], ["google", "cpc"]);
assert.equal(resolveTouch({ referrer: "https://www.google.com/" }).medium, "organic");
assert.equal(resolveTouch({ referrer: "https://l.instagram.com/" }).source, "instagram");
assert.equal(resolveTouch({ referrer: "https://www.justdial.com/x" }).medium, "referral");
assert.equal(resolveTouch({}).source, "(direct)");
assert.equal(resolveTouch({ source: "Google", medium: "CPC" }).medium, "cpc");

const lc = leadColumns({
  event: "booking_confirmed", name: "Ravi", phone: "9876543210", external_ref: "c4a-1",
  attribution: { first: { source: "google", medium: "cpc", campaign: "edc_search_tcpalya", term: "dentist near me", landing: "/dental-clinic-tc-palya/" },
                 last: { source: "google", medium: "organic" } },
});
assert.equal(lc.row.first_medium, "cpc");
assert.equal(lc.row.latest_medium, "organic");
assert.equal(lc.row.status, "appointment_booked");
assert.equal(lc.row.inquiry_type, "booking");
assert.equal(lc.touch.channel, "booking_widget");
assert.equal(lc.row.is_test, false);
assert.equal(leadColumns({ event: "form_submit", name: "TEST lead (ignore)" }).row.is_test, true);

assert.equal(advanceStatus("new", "appointment_booked"), "appointment_booked");
assert.equal(advanceStatus("completed", "new"), "completed", "never downgrade");
assert.equal(advanceStatus("lost", "appointment_booked"), "appointment_booked");
assert.equal(advanceStatus("lost", "new"), "lost");

console.log("Logic tests passed");
