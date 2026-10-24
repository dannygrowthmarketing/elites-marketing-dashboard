// Runs all migrations on PGlite with a minimal Supabase stub, then exercises RLS and reporting RPCs.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const dir = path.resolve("../supabase/migrations");
const db = new PGlite({ extensions: { pgcrypto } });

// --- Supabase stubs ---
await db.exec(`
  create extension if not exists pgcrypto;
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create or replace function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create schema vault; create table vault.decrypted_secrets(name text, decrypted_secret text);
  create schema cron; create table cron.job(name text, sched text, cmd text);
  create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as
    $$ insert into cron.job values (n, s, c); select 1::bigint $$;
  create schema net; create schema extensions;
  create or replace function extensions.gen_random_bytes(n int) returns bytea language sql as $$ select public.gen_random_bytes(n) $$;
  create or replace function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint
    language sql as $$ select 1::bigint $$;
`);

let failures = 0;
for (const f of fs.readdirSync(dir).sort()) {
  let sql = fs.readFileSync(path.join(dir, f), "utf8");
  // PGlite lacks pg_cron/pg_net as real extensions; stubs above stand in.
  sql = sql.replace(/create extension if not exists (pg_cron|pg_net);/g, "");
  try { await db.exec(sql); console.log("migrated", f); }
  catch (e) { failures++; console.error("FAILED", f, e.message); }
}
assert.equal(failures, 0, "migrations failed");

await db.exec(`grant usage on schema public to authenticated, anon;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage on schema auth to authenticated, anon;`);

// --- Seed (as superuser, like the service role) ---
await db.exec(`
  insert into app_users values ('owner@x.com','owner'), ('viewer@x.com','viewer');
  insert into gsc_daily_totals values ('2026-10-01','ALL','ALL',10,200,1000),('2026-10-02','ALL','ALL',5,100,300);
  insert into gsc_daily_query_page values
    ('2026-10-01','dental clinic near me','https://elitesdental.com/',3,150,450,false),
    ('2026-10-01','elites dental care','https://elitesdental.com/',7,50,100,true),
    ('2026-09-01','dental clinic near me','https://elitesdental.com/',1,90,360,false);
  insert into ads_daily_campaign values
    ('2026-10-01','1','EDC Search','ENABLED','ALL',100,10,500000000,1,1),
    ('2026-10-01','1','EDC Search','ENABLED','MOBILE',90,9,450000000,1,1),
    ('2026-10-02','1','EDC Search','ENABLED','ALL',50,5,250000000,0,0);
  insert into ga4_daily_events values ('2026-10-01','phone_call_click','Paid Search','google','cpc','x','/',4);
  insert into leads (id, first_inquiry_at, inquiry_type, first_source, first_medium, status, dedupe_key)
    values ('11111111-1111-1111-1111-111111111111','2026-10-01T05:00:00Z','booking','google','cpc','appointment_booked','k1'),
           ('22222222-2222-2222-2222-222222222222','2026-10-02T05:00:00Z','contact_form',null,null,'new','k2');
  insert into leads (first_inquiry_at, inquiry_type, status, is_test) values ('2026-10-02T05:00:00Z','contact_form','new',true);
  insert into appointments (lead_id, booked_at, status) values ('11111111-1111-1111-1111-111111111111','2026-10-01T06:00:00Z','completed');
  insert into revenue_entries (lead_id, collected_on, amount_inr) values ('11111111-1111-1111-1111-111111111111','2026-10-03',4500);
  insert into leads (id, first_inquiry_at, inquiry_type, status, is_test) values ('33333333-3333-3333-3333-333333333333','2026-10-02T05:00:00Z','booking','appointment_booked',true);
  insert into appointments (lead_id, booked_at, status) values ('33333333-3333-3333-3333-333333333333','2026-10-02T06:00:00Z','booked');
  insert into revenue_entries (lead_id, collected_on, amount_inr) values ('33333333-3333-3333-3333-333333333333','2026-10-03',99999);
`);

async function as(email, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ email })}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`); }
}

// RLS: stranger sees nothing
await as("stranger@x.com", async () => {
  const r = await db.query("select count(*)::int n from leads");
  assert.equal(r.rows[0].n, 0, "stranger must not read leads");
  const i = await db.query("select count(*)::int n from integrations");
  assert.equal(i.rows[0].n, 0, "stranger must not read integrations");
});

// Viewer reads but can't write
await as("viewer@x.com", async () => {
  const r = await db.query("select count(*)::int n from leads");
  assert.equal(r.rows[0].n, 4);
  let blocked = false;
  try { await db.query("insert into leads (inquiry_type) values ('phone')"); } catch { blocked = true; }
  assert.ok(blocked, "viewer must not insert leads");
  let blocked2 = false;
  try { await db.query("insert into ads_daily_campaign (date,campaign_id,campaign_name) values ('2026-01-01','9','x')"); } catch { blocked2 = true; }
  assert.ok(blocked2, "viewer must not write analytics");
});

// Owner can work the CRM, but can't write analytics tables
await as("owner@x.com", async () => {
  await db.query("insert into leads (inquiry_type, status) values ('phone','new')");
  let blocked = false;
  try { await db.query("insert into gsc_daily_totals (date) values ('2026-01-01')"); } catch { blocked = true; }
  assert.ok(blocked, "editors must not write analytics");
  await db.query("delete from leads where inquiry_type='phone'");
});

// Private schema not reachable by authenticated
await as("owner@x.com", async () => {
  let blocked = false;
  try { await db.query("select * from private.credentials"); } catch { blocked = true; }
  assert.ok(blocked, "private schema must be closed");
  let blocked2 = false;
  try { await db.query("select * from svc_get_credential('google')"); } catch { blocked2 = true; }
  assert.ok(blocked2, "svc_ functions must be closed to users");
});

// Reporting RPCs
await as("viewer@x.com", async () => {
  const s = await db.query("select * from rpc_daily_series('2026-10-01','2026-10-03')");
  assert.equal(s.rows.length, 3);
  assert.equal(Number(s.rows[0].gsc_clicks), 10);
  assert.equal(Number(s.rows[0].gsc_position), 5.00, "weighted position = 1000/200");
  assert.equal(Number(s.rows[0].ads_cost), 500, "cost_micros -> INR, ALL rows only");
  assert.equal(Number(s.rows[1].leads), 1, "test lead excluded");
  assert.equal(Number(s.rows[2].revenue), 4500);

  const q = await db.query("select * from rpc_gsc_queries('2026-10-01','2026-10-31','2026-09-01','2026-09-30',50)");
  const near = q.rows.find((r) => r.query === "dental clinic near me");
  assert.equal(Number(near.prev_clicks), 1);
  assert.equal(Number(near.avg_position), 3.00);
  assert.equal(q.rows.find((r) => r.query === "elites dental care").is_branded, true);

  const a = await db.query("select * from rpc_attribution('2026-10-01','2026-10-31')");
  const g = a.rows.find((r) => r.source === "google");
  assert.equal(Number(g.leads), 1);
  assert.equal(Number(g.booked), 1);
  assert.equal(Number(g.completed), 1);
  assert.equal(Number(g.revenue), 4500);
  assert.equal(Number(g.spend), 750, "google/cpc gets Ads spend");
  const d = a.rows.find((r) => r.source === "(direct)");
  assert.equal(d.spend, null, "no spend for direct");

  const f = (await db.query("select rpc_funnel('2026-10-01','2026-10-31') f")).rows[0].f;
  assert.equal(Number(f.ga4_phone_clicks), 4);
  assert.equal(Number(f.crm_leads), 2);
  assert.equal(Number(f.crm_completed), 1);
  assert.equal(Number(f.crm_booked), 1, "test lead appointment excluded");
  assert.equal(Number(f.revenue), 4500, "test lead revenue excluded");
  assert.equal(Number(f.ads_conversions), 1);

  const b = (await db.query("select * from rpc_data_bounds()")).rows[0];
  assert.ok(b.earliest);

  const dev = await db.query("select * from rpc_ads_devices('2026-10-01','2026-10-31')");
  assert.equal(dev.rows.length, 1);
  assert.equal(dev.rows[0].device, "MOBILE");
});

// Ad Library: creatives + per-ad metrics; ratios are left to the client.
await db.exec(`
  insert into ads_ads (ad_group_id, ad_id, campaign_id, campaign_name, campaign_status, ad_type, ad_status, headlines, descriptions, final_urls)
  values ('ag1','ad1','c1','Search TC Palya','ENABLED','RESPONSIVE_SEARCH_AD','ENABLED','[{"text":"Dentist in TC Palya"}]','[{"text":"Book today"}]','["https://elitesdental.com/"]'),
         ('ag1','ad2','c1','Search TC Palya','ENABLED','RESPONSIVE_SEARCH_AD','PAUSED','[]','[]','[]');
  insert into ads_daily_ad (date, ad_group_id, ad_id, campaign_id, impressions, clicks, cost_micros, conversions)
  values ('2026-10-01','ag1','ad1','c1',100,10,200000000,1), ('2026-10-02','ag1','ad1','c1',50,5,100000000,0),
         ('2026-09-01','ag1','ad2','c1',30,1,10000000,0);
  insert into ads_daily_keyword (date, ad_group_id, criterion_id, keyword, match_type, impressions, clicks, cost_micros, conversions)
  values ('2026-10-01','ag1','k1','dentist near me','PHRASE',80,8,150000000,1);
  insert into ads_daily_search_term (date, campaign_id, ad_group_id, search_term, impressions, clicks, cost_micros, conversions, match_types)
  values ('2026-10-01','c1','ag1','dentist near me tc palya',40,4,80000000,1,'NEAR_PHRASE');
`);
await as("stranger@x.com", async () => {
  const r = await db.query("select count(*)::int n from rpc_ads_ad_library('2026-01-01','2026-12-31')");
  assert.equal(r.rows[0].n, 0, "stranger must not read ads");
});
await as("viewer@x.com", async () => {
  const lib = await db.query("select * from rpc_ads_ad_library('2026-10-01','2026-10-31')");
  assert.equal(lib.rows.length, 2, "ads with no rows in range still listed");
  const a1 = lib.rows.find((r) => r.ad_id === "ad1");
  assert.equal(Number(a1.impressions), 150); assert.equal(Number(a1.clicks), 15); assert.equal(Number(a1.cost), 300);
  assert.equal(a1.has_rows, true); assert.equal(new Date(a1.last_served).toISOString().slice(0, 10), "2026-10-02");
  const a2 = lib.rows.find((r) => r.ad_id === "ad2");
  assert.equal(a2.has_rows, false, "no data in range is flagged, not faked");
  assert.ok(a2.last_served, "lifetime last-served date kept");
  const t = (await db.query("select rpc_ads_terms_for('2026-10-01','2026-10-31','c1') j")).rows[0].j;
  assert.equal(t.keywords.length, 1); assert.equal(t.terms.length, 1);
  assert.equal(t.terms[0].match_types, "NEAR_PHRASE");
});

// Revenue: import, lead matching, duplicates, undo, permissions.
await db.exec(`update leads set phone_e164 = '+919845012345', email = 'a@x.com' where id = '11111111-1111-1111-1111-111111111111';`);
await as("viewer@x.com", async () => {
  let blocked = false;
  try { await db.query(`select rpc_revenue_import('[{"date":"2026-10-05","amount":100}]'::jsonb, 'f.xlsx', 'bulk')`); } catch { blocked = true; }
  assert.ok(blocked, "viewer must not import revenue");
});
await as("owner@x.com", async () => {
  const rows = JSON.stringify([
    { date: "2026-10-05", amount: "12000", invoice: "INV-1", service: "Implants", phone: "98450 12345", patient_type: "New" },
    { date: "2026-10-06", amount: 800, invoice: "INV-2", email: "A@X.com" },
    { date: "2026-10-07", amount: 1500, invoice: "INV-3", channel: "Walk-in", patient_type: "existing" },
    { date: "", amount: 50 },
    { date: "2026-10-08", amount: 99, invoice: "inv-1" },
  ]);
  const r = (await db.query(`select rpc_revenue_import($1::jsonb, 'oct.xlsx', 'bulk') j`, [rows])).rows[0].j;
  assert.equal(r.inserted, 3); assert.equal(r.skipped, 2); assert.equal(r.matched, 2); assert.equal(Number(r.total), 14300);
  assert.match(r.skipped_rows[1].reason, /already added/, "invoice numbers are case-insensitive duplicates");
  const m = await db.query("select invoice_ref, match_method, patient_type from revenue_entries where batch_id = $1 order by invoice_ref", [r.batch_id]);
  assert.deepEqual(m.rows.map((x) => [x.invoice_ref, x.match_method, x.patient_type]),
    [["INV-1", "phone", "new"], ["INV-2", "email", null], ["INV-3", "none", "returning"]]);

  const s = (await db.query("select rpc_revenue_summary('2026-10-01','2026-10-31') j")).rows[0].j;
  assert.equal(Number(s.total), 4500 + 14300, "existing CRM entry + import, test-lead revenue excluded");
  assert.equal(Number(s.google_ads_revenue), 4500 + 12000 + 800, "matched to google/cpc lead");
  assert.equal(Number(s.google_ads_spend), 750);
  assert.equal(s.by_channel.find((c) => c.channel === "Walk-in").revenue, 1500);
  assert.equal(s.by_month.length, 12);
  assert.equal(Number(s.by_month[11].revenue), 18800);

  const single = (await db.query(`select rpc_revenue_import('[{"date":"2026-10-09","amount":500,"lead_id":"22222222-2222-2222-2222-222222222222"}]'::jsonb, null, 'single') j`)).rows[0].j;
  assert.equal(single.inserted, 1); assert.equal(single.batch_id, null);

  const undone = (await db.query("select rpc_revenue_undo_batch($1) n", [r.batch_id])).rows[0].n;
  assert.equal(undone, 3);
  assert.equal((await db.query("select count(*)::int n from revenue_batches")).rows[0].n, 0);
  assert.equal((await db.query("select public.channel_label('google','cpc') a, public.channel_label(null,null) b")).rows[0].a, "Google Ads");
});

// Partnerships agent: audit, dedupe, chains, scoring, re-runs, review fields.
{
  const run = { source_key: "overture_places", release: "2026-09-23.1", params: { center_lat: 13.02312, center_lon: 77.695679, radius_km: 2, min_confidence: 0.6 } };
  const P = (id, name, category, dlat, extra = {}) => ({ source_id: id, name, category, lat: 13.02312 + dlat, lon: 77.695679, confidence: 0.9,
    websites: ["https://x.example"], phones: ["+91 80 1234 5678"], records: [{ dataset: "meta", record_id: "r" + id, update_time: "2026-09-01" }], ...extra });
  const rows = [
    P("a", "Bright Future School", "school", 0.004),                 // ~0.45 km
    P("b", "Bright Future School", "school", 0.0045, { confidence: 0.7 }), // duplicate within 150 m, lower confidence
    P("c", "MedPlus Pharmacy TC Palya", "pharmacy", 0.01),
    P("d", "MedPlus Ramamurthy", "pharmacy", 0.012),
    P("e", "Medplus Hoodi", "pharmacy", 0.014, { phones: [], websites: [] }),
    P("f", "Smile Dental Studio", "doctors_office", 0.003),          // competitor
    P("g", "Far Away Gym", "gym", 0.05),                             // ~5.5 km, outside radius
    P("h", "Shaky Listing Gym", "gym", 0.002, { confidence: 0.3 }),
    P("i", "Tasty Restaurant", "restaurant", 0.001),
  ];
  const r1 = (await db.query("select partner_ingest($1::jsonb, $2::jsonb) j", [JSON.stringify(run), JSON.stringify(rows)])).rows[0].j;
  assert.equal(r1.fetched, 9); assert.equal(r1.kept, 4); assert.equal(r1.new, 4);
  assert.deepEqual(r1.excluded, { "duplicate listing": 1, "dental practice (competitor)": 1, "outside radius": 1, "low source confidence": 1, "not a partner category": 1 });
  const school = (await db.query("select * from partner_opportunities where source_id = 'a'")).rows[0];
  assert.equal(school.score, 35 + 25 + 20 + 9 + 10, "fit + proximity + contact + confidence + independent");
  assert.equal(school.score_breakdown.length, 5);
  const med = (await db.query("select score, is_chain, flags from partner_opportunities where source_id = 'e'")).rows[0];
  assert.equal(med.is_chain, true, "3 MedPlus listings = chain");
  assert.ok(med.flags.includes("no public contact"));
  await as("viewer@x.com", async () => {
    assert.equal((await db.query("select count(*)::int n from partner_opportunities")).rows[0].n, 4);
    let blocked = false;
    try { await db.query(`select partner_ingest('{}'::jsonb, '[]'::jsonb)`); } catch { blocked = true; }
    assert.ok(blocked, "users can't call the ingest directly");
    const u = await db.query("update partner_opportunities set status = 'shortlisted' where source_id = 'a' returning id");
    assert.equal(u.rows.length, 0, "viewer can't review");
  });
  await as("owner@x.com", async () => {
    await db.query("update partner_opportunities set status = 'shortlisted', notes = 'Principal open to a camp' where source_id = 'a'");
    let blocked = false;
    try { await db.query("update partner_opportunities set score = 100 where source_id = 'a'"); } catch { blocked = true; }
    assert.ok(blocked, "editors can't change scores");
  });
  // Second run: school a still there, c gone.
  const r2 = (await db.query("select partner_ingest($1::jsonb, $2::jsonb) j", [JSON.stringify(run), JSON.stringify(rows.filter((x) => x.source_id !== "c"))])).rows[0].j;
  assert.equal(r2.new, 0); assert.equal(r2.updated, 3); assert.equal(r2.inactive, 1);
  const a2 = (await db.query("select status, notes, active from partner_opportunities where source_id = 'a'")).rows[0];
  assert.equal(a2.status, "shortlisted", "agent never overwrites review status"); assert.equal(a2.notes, "Principal open to a camp");
  assert.equal((await db.query("select active from partner_opportunities where source_id = 'c'")).rows[0].active, false);
  const runs = (await db.query("select status, fetched, in_scope from partner_runs order by started_at")).rows;
  assert.equal(runs.length, 2); assert.equal(runs[1].status, "success");
  let rejected = false;
  try { await db.query("select partner_ingest($1::jsonb, '[]'::jsonb)", [JSON.stringify({ ...run, source_key: "osm_overpass_public" })]); } catch { rejected = true; }
  assert.ok(rejected, "rejected sources can't be ingested");
}

// Cron jobs registered
const jobs = await db.query("select name from cron.job order by name");
assert.equal(jobs.rows.length, 9);
const cr = await db.query("select count(*)::int n from private.credentials where provider in ('cron','lead_webhook','partner_ingest') and length(api_token)=64");
assert.equal(cr.rows[0].n, 3);

console.log("\nDB tests passed");
