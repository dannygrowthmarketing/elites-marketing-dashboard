// POST /functions/v1/sync  { source, kind: 'incremental'|'backfill'|'manual', start?, end? }
// Auth: x-cron-secret (scheduler) or a signed-in editor/owner (manual sync button).
import { admin, callerRole, cors, json, minDate, maxDate, timingSafeEqual, todayLocal } from "../_shared/util.ts";
import { backfillWindow, chunks, clampManual, incrementalWindow, SPECS, SourceKey } from "../_shared/plan.ts";
import { NotAuthorized } from "../_shared/google.ts";
import { syncGa4 } from "../_shared/sources/ga4.ts";
import { syncGsc } from "../_shared/sources/gsc.ts";
import { syncGbp } from "../_shared/sources/gbp.ts";
import { PendingApproval, syncAds } from "../_shared/sources/ads.ts";
import { syncClarity } from "../_shared/sources/clarity.ts";
import { syncMeta } from "../_shared/sources/meta.ts";
import { syncMailchimp } from "../_shared/sources/mailchimp.ts";
import { syncWhatsapp } from "../_shared/sources/whatsapp.ts";

const DATED: SourceKey[] = ["ga4", "gsc", "gbp", "google_ads", "meta_ads", "whatsapp"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const hdr = req.headers.get("x-cron-secret") ?? "";
  let viaCron = false;
  if (hdr) {
    const { data: c } = await admin().rpc("svc_get_credential", { p_provider: "cron" });
    const cronSecret: string = c?.[0]?.api_token ?? "";
    viaCron = cronSecret.length > 0 && timingSafeEqual(hdr, cronSecret);
  }
  if (!viaCron) {
    const who = await callerRole(req);
    if (!who || !["owner", "editor"].includes(who.role)) return json({ error: "forbidden" }, 403);
  }

  const { source, kind = "incremental", start, end } = await req.json().catch(() => ({}));
  const db = admin();
  const { data: integ } = await db.from("integrations").select("*").eq("source", source).maybeSingle();
  if (!integ) return json({ error: `unknown source ${source}` }, 400);
  if (source === "wordpress") return json({ ok: true, note: "wordpress leads arrive by webhook" });

  const today = todayLocal();
  const { data: run } = await db.from("sync_runs").insert({ source, kind }).select("id").single();
  const runId = run?.id;
  await db.from("integrations").update({ last_attempt_at: new Date().toISOString() }).eq("source", source);

  try {
    let rows = 0;
    let win: { start: string; end: string } | null = null;
    let finishes = false;

    if (source === "clarity") {
      rows = await syncClarity(db);
      win = { start: today, end: today };
    } else if (source === "mailchimp") {
      rows = await syncMailchimp(db);
      win = { start: today, end: today };
    } else if (DATED.includes(source)) {
      const st = { earliest_imported: integ.earliest_imported, latest_imported: integ.latest_imported, backfill_complete: integ.backfill_complete };
      let windows: { start: string; end: string }[] = [];
      if (kind === "manual" && start && end) {
        const c = clampManual(source, start, end, today);
        if (c) windows = chunks(c.start, c.end, SPECS[source as SourceKey].chunkDays);
      } else if (kind === "backfill") {
        const w = backfillWindow(source, st, today);
        if (w) { windows = [w]; finishes = w.finishesBackfill; }
        else if (!integ.backfill_complete) await db.from("integrations").update({ backfill_complete: true }).eq("source", source);
      } else {
        const w = incrementalWindow(source, st, today);
        if (w) windows = [w];
      }

      for (const w of windows) {
        const got = await runSource(db, source, integ.external_id, w.start, w.end);
        rows += got;
        win = win ? { start: minDate(win.start, w.start), end: maxDate(win.end, w.end) } : w;
        // GA4 has no fixed floor: an empty backfill chunk means we passed the property's first day.
        if (kind === "backfill" && source === "ga4" && got === 0) finishes = true;
      }
    } else {
      throw new Error(`no sync implemented for ${source}`);
    }

    // Update coverage + status
    const patch: Record<string, unknown> = {
      status: "connected", last_success_at: new Date().toISOString(), last_error: null,
      records_total: (integ.records_total ?? 0) + rows,
    };
    if (win) {
      patch.earliest_imported = integ.earliest_imported ? minDate(integ.earliest_imported, win.start) : win.start;
      patch.latest_imported = integ.latest_imported ? maxDate(integ.latest_imported, win.end) : win.end;
    }
    if (finishes) patch.backfill_complete = true;
    if (DATED.includes(source)) patch.earliest_available = SPECS[source as SourceKey].floor(today);
    await db.from("integrations").update(patch).eq("source", source);
    await db.from("sync_runs").update({
      status: "success", finished_at: new Date().toISOString(), rows_upserted: rows,
      range_start: win?.start ?? null, range_end: win?.end ?? null,
    }).eq("id", runId);
    return json({ ok: true, source, kind, rows, window: win, backfill_complete: finishes || integ.backfill_complete });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // GBP Performance API answers 403 until Google approves API access for the project.
    // New projects also get a 0-requests/minute quota (HTTP 429 RESOURCE_EXHAUSTED) until approval.
    const gbpGate = source === "gbp" && ((e as any)?.status === 403 ||
      (/HTTP 429/.test(msg) && /mybusiness|businessprofileperformance/i.test(msg)));
    const status = e instanceof PendingApproval || gbpGate ? "pending_approval"
      : e instanceof NotAuthorized ? "pending_authorization" : "error";
    await db.from("integrations").update({ status, last_error: msg.slice(0, 1000) }).eq("source", source);
    await db.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), error: msg.slice(0, 2000) }).eq("id", runId);
    return json({ ok: false, source, status, error: msg }, status === "error" ? 500 : 200);
  }
});

async function runSource(db: any, source: string, externalId: string | null, start: string, end: string): Promise<number> {
  switch (source) {
    case "ga4": return syncGa4(db, externalId ?? "548000513", start, end);
    case "gsc": return syncGsc(db, externalId ?? "https://elitesdental.com/", start, end);
    case "gbp": return syncGbp(db, externalId, start, end);
    case "google_ads": return syncAds(db, externalId ?? "520-119-6364", start, end);
    case "meta_ads": return syncMeta(db, externalId, start, end);
    case "whatsapp": return syncWhatsapp(db, externalId, start, end);
  }
  throw new Error(`unknown source ${source}`);
}
