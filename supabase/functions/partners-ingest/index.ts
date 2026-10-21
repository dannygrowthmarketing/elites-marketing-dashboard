// POST /functions/v1/partners-ingest
// Called by the partnerships fetcher (not by browsers). Header x-partner-secret must match private.credentials 'partner_ingest'.
// Body: { run: {...}, rows: [...] }  or  { run: {...}, error: "..." } to record a failed fetch.
// Audit, scoring and storage happen in SQL (partner_ingest) so every run is applied the same way.
import { admin, json, timingSafeEqual } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const db = admin();
  const { data: cred } = await db.rpc("svc_get_credential", { p_provider: "partner_ingest" });
  const secret: string = cred?.[0]?.api_token ?? "";
  const got = req.headers.get("x-partner-secret") ?? "";
  if (!secret || !timingSafeEqual(got, secret)) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => null);
  if (!body?.run) return json({ error: "run is required" }, 400);

  if (body.error) {
    const { data, error } = await db.rpc("partner_log_failure", { p_run: body.run, p_error: String(body.error) });
    return error ? json({ error: error.message }, 500) : json({ ok: false, run_id: data, recorded: "failure" });
  }
  if (!Array.isArray(body.rows) || body.rows.length > 5000) return json({ error: "rows must be an array of at most 5,000" }, 400);

  const { data, error } = await db.rpc("partner_ingest", { p_run: body.run, p_rows: body.rows });
  if (error) {
    await db.rpc("partner_log_failure", { p_run: body.run, p_error: `ingest failed: ${error.message}` });
    return json({ error: error.message }, 500);
  }
  return json({ ok: true, ...data });
});
