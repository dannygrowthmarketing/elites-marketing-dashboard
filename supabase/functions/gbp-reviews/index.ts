// Business Profile reviews (My Business API v4) -> gbp_reviews + gbp_review_snapshot.
// Reviewer names and photos are not stored; only stars, review text, dates and the owner's reply.
// POST { full?: boolean }  cron (x-cron-secret) or an owner/editor.
import { admin, callerRole, cors, json, timingSafeEqual, upsertBatched } from "../_shared/util.ts";
import { googleAccessToken, googleJson } from "../_shared/google.ts";

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const today = () => new Date().toISOString().slice(0, 10);

// Translated reviews arrive as "(Translated by Google) <English>\n\n(Original)\n<original>"; keep the English part.
function cleanComment(c: unknown): string | null {
  if (!c) return null;
  const s = String(c).split(/\n\n\(Translated by Google\)|\(Original\)\n/)[0].replace(/^\(Translated by Google\)\s*/, "").trim();
  return s || null;
}

async function reviewParent(db: ReturnType<typeof admin>, token: string): Promise<string> {
  const { data } = await db.from("gbp_review_snapshot").select("review_parent").not("review_parent", "is", null).order("date", { ascending: false }).limit(1);
  if (data?.[0]?.review_parent) return data[0].review_parent;
  const { data: integ } = await db.from("integrations").select("external_id").eq("source", "gbp").single();
  const id = String(integ?.external_id ?? "").replace("locations/", "");
  if (!id) throw new Error("Business Profile location not set");
  const accts = await googleJson("https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20", token);
  let lastErr: unknown = null;
  for (const a of accts.accounts ?? []) {
    const parent = `${a.name}/locations/${id}`;
    try { await googleJson(`https://mybusiness.googleapis.com/v4/${parent}/reviews?pageSize=1`, token); return parent; }
    catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("No Business Profile account can read this location's reviews");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const db = admin();
  const body = await req.json().catch(() => ({}));
  let viaCron = false;
  const hdr = req.headers.get("x-cron-secret") ?? "";
  if (hdr) {
    const { data: c } = await db.rpc("svc_get_credential", { p_provider: "cron" });
    const s = c?.[0]?.api_token ?? "";
    viaCron = s.length > 0 && timingSafeEqual(hdr, s);
  }
  if (!viaCron) {
    const who = await callerRole(req);
    if (!who || !["owner", "editor"].includes(who.role)) return json({ error: "forbidden" }, 403);
  }

  try {
    const token = await googleAccessToken();
    const parent = await reviewParent(db, token);
    // Incremental: newest-updated first, stop 3 days past what is stored. Full pull when empty or asked.
    const { data: last } = await db.from("gbp_reviews").select("updated_at").order("updated_at", { ascending: false, nullsFirst: false }).limit(1);
    const { data: snap } = await db.from("gbp_review_snapshot").select("last_error").order("date", { ascending: false }).limit(1);
    const wasPartial = /^Partial/.test(snap?.[0]?.last_error ?? "");
    const since = !body.full && !wasPartial && last?.[0]?.updated_at ? new Date(new Date(last[0].updated_at).getTime() - 3 * 864e5) : null;
    let pageToken = "", rows = 0, pages = 0, stop = false;
    let avg: number | null = null, total: number | null = null;
    const started = Date.now();
    do {
      const q = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc" });
      if (pageToken) q.set("pageToken", pageToken);
      const r = await googleJson(`https://mybusiness.googleapis.com/v4/${parent}/reviews?${q}`, token);
      if (avg == null && r.averageRating != null) avg = Number(r.averageRating);
      if (total == null && r.totalReviewCount != null) total = Number(r.totalReviewCount);
      const out = (r.reviews ?? []).map((x: any) => ({
        review_id: x.reviewId ?? String(x.name).split("/").pop(),
        star: STARS[x.starRating] ?? null,
        comment: cleanComment(x.comment),
        created_at: x.createTime, updated_at: x.updateTime ?? x.createTime,
        reply: x.reviewReply?.comment ?? null, reply_at: x.reviewReply?.updateTime ?? null,
        synced_at: new Date().toISOString(),
      })).filter((x: any) => x.star != null);
      if (out.length) rows += await upsertBatched(db, "gbp_reviews", out, "review_id");
      if (since && out.length && new Date(out[out.length - 1].updated_at) < since) stop = true;
      pageToken = r.nextPageToken ?? "";
      pages++;
    } while (pageToken && !stop && Date.now() - started < 120_000);
    const complete = !pageToken || stop;
    await db.from("gbp_review_snapshot").upsert({ date: today(), average_rating: avg, total_reviews: total, review_parent: parent,
      last_error: complete ? null : "Partial pull (time limit); the next run continues" }, { onConflict: "date" });
    return json({ ok: true, rows, pages, complete, average_rating: avg, total_reviews: total });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("gbp_review_snapshot").upsert({ date: today(), last_error: msg.slice(0, 500) }, { onConflict: "date" });
    return json({ ok: false, error: msg }, 500);
  }
});
