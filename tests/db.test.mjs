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

// Cron jobs registered
const jobs = await db.query("select name from cron.job order by name");
assert.equal(jobs.rows.length, 7);
const cr = await db.query("select count(*)::int n from private.credentials where provider in ('cron','lead_webhook') and length(api_token)=64");
assert.equal(cr.rows[0].n, 2);

console.log("\nDB tests passed");
