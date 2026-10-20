-- Elites Dental Care marketing dashboard — core schema
-- All reporting dates are clinic-local (Asia/Kolkata). Timestamps are timestamptz.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Access control: only allow-listed emails can read anything.
-- ---------------------------------------------------------------
create table if not exists public.app_users (
  email text primary key,
  role text not null default 'viewer' check (role in ('owner','editor','viewer')),
  added_at timestamptz not null default now()
);

create or replace function public.current_role_name() returns text
language sql stable security definer set search_path = public as $$
  select role from public.app_users
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_role_name() is not null
$$;

create or replace function public.can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_role_name() in ('owner','editor')
$$;

-- ---------------------------------------------------------------
-- Private schema: credentials. Never exposed through the API.
-- ---------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.credentials (
  provider text primary key,            -- 'google', 'clarity', 'meta', 'lead_webhook'
  refresh_token text,
  access_token text,
  access_expires_at timestamptz,
  api_token text,
  scopes text,
  account_email text,
  updated_at timestamptz not null default now()
);

create table if not exists private.oauth_states (
  state text primary key,
  provider text not null,
  created_by text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Integration registry + sync log
-- ---------------------------------------------------------------
create table if not exists public.integrations (
  source text primary key,              -- ga4 | gsc | gbp | google_ads | clarity | meta_ads | wordpress
  label text not null,
  status text not null default 'pending_authorization'
    check (status in ('connected','pending_authorization','pending_approval','error','not_configured','disabled')),
  external_id text,                     -- property id, site url, customer id, location id
  earliest_available date,
  earliest_imported date,
  latest_imported date,
  backfill_complete boolean not null default false,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  records_total bigint not null default 0,
  sync_frequency text,
  limitations text,
  updated_at timestamptz not null default now()
);

insert into public.integrations (source, label, status, external_id, sync_frequency, limitations) values
 ('ga4','Google Analytics 4','pending_authorization','548000513','Daily 06:30 IST',
  'Data API returns data from property creation. Thresholding can hide low counts. Property currency is USD.'),
 ('gsc','Google Search Console','pending_authorization','https://elitesdental.com/','Daily 07:00 IST',
  'Max 16 months history. 2–3 day delay. Anonymized queries are excluded from query rows but included in totals. Position is an average, not a rank guarantee.'),
 ('gbp','Google Business Profile','pending_approval','312345328089792595','Daily 07:30 IST',
  'Requires Google approval for the Business Profile Performance API. ~18 months daily metrics; search keywords are monthly with thresholded counts. Call clicks are taps, not completed calls.'),
 ('google_ads','Google Ads','pending_approval','520-119-6364','Daily 06:00 IST',
  'Requires an approved developer token (Basic access). Conversions are platform-attributed.'),
 ('clarity','Microsoft Clarity','not_configured',null,'Daily 08:00 IST',
  'Data Export API returns only the last 1–3 days, 10 calls/day. History accumulates from the first sync; no backfill. Clarity is not installed on the site yet.'),
 ('meta_ads','Meta Ads','pending_authorization',null,'Daily 06:15 IST',
  'Access to be provided later. No data shown until authorized.'),
 ('wordpress','Website leads (WordPress)','pending_authorization','elitesdental.com','Real time (webhook)',
  'Captures Elementor form submissions and Click4Appointment bookings from install date onward. Earlier submissions only if exported.')
on conflict (source) do nothing;

create table if not exists public.sync_runs (
  id bigint generated always as identity primary key,
  source text not null references public.integrations(source),
  kind text not null check (kind in ('backfill','incremental','manual','webhook')),
  range_start date,
  range_end date,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial','error')),
  rows_upserted integer not null default 0,
  attempts integer not null default 1,
  error text
);
create index if not exists sync_runs_source_started on public.sync_runs (source, started_at desc);

-- ---------------------------------------------------------------
-- GA4
-- ---------------------------------------------------------------
create table if not exists public.ga4_daily_traffic (
  date date not null,
  channel_group text not null default '(not set)',
  source text not null default '(not set)',
  medium text not null default '(not set)',
  campaign text not null default '(not set)',
  device text not null default '(not set)',
  sessions integer not null default 0,
  engaged_sessions integer not null default 0,
  total_users integer not null default 0,
  new_users integer not null default 0,
  page_views integer not null default 0,
  engagement_seconds numeric not null default 0,
  key_events numeric not null default 0,
  primary key (date, channel_group, source, medium, campaign, device)
);

create table if not exists public.ga4_daily_landing (
  date date not null,
  landing_page text not null,
  channel_group text not null default '(not set)',
  sessions integer not null default 0,
  engaged_sessions integer not null default 0,
  total_users integer not null default 0,
  key_events numeric not null default 0,
  primary key (date, landing_page, channel_group)
);

create table if not exists public.ga4_daily_events (
  date date not null,
  event_name text not null,
  channel_group text not null default '(not set)',
  source text not null default '(not set)',
  medium text not null default '(not set)',
  campaign text not null default '(not set)',
  page_path text not null default '(not set)',
  event_count integer not null default 0,
  primary key (date, event_name, channel_group, source, medium, campaign, page_path)
);

create table if not exists public.ga4_daily_geo (
  date date not null,
  country text not null default '(not set)',
  city text not null default '(not set)',
  sessions integer not null default 0,
  total_users integer not null default 0,
  primary key (date, country, city)
);

-- ---------------------------------------------------------------
-- Search Console
-- ---------------------------------------------------------------
create table if not exists public.gsc_daily_totals (
  date date not null,
  device text not null default 'ALL',
  country text not null default 'ALL',
  clicks integer not null default 0,
  impressions integer not null default 0,
  position_weighted numeric not null default 0,   -- sum(position * impressions); divide by impressions
  primary key (date, device, country)
);

create table if not exists public.gsc_daily_query_page (
  date date not null,
  query text not null,
  page text not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  position_weighted numeric not null default 0,
  is_branded boolean not null default false,
  primary key (date, query, page)
);
create index if not exists gsc_qp_query on public.gsc_daily_query_page (query);
create index if not exists gsc_qp_page on public.gsc_daily_query_page (page);

create table if not exists public.gsc_daily_appearance (
  date date not null,
  appearance text not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  primary key (date, appearance)
);

-- ---------------------------------------------------------------
-- Google Business Profile
-- ---------------------------------------------------------------
create table if not exists public.gbp_daily_metrics (
  date date not null,
  metric text not null,     -- BUSINESS_IMPRESSIONS_MOBILE_MAPS, CALL_CLICKS, WEBSITE_CLICKS, BUSINESS_DIRECTION_REQUESTS, ...
  value integer not null default 0,
  primary key (date, metric)
);

create table if not exists public.gbp_monthly_keywords (
  month date not null,       -- first day of month
  keyword text not null,
  impressions integer,       -- null when Google returns only a threshold
  threshold integer,
  primary key (month, keyword)
);

-- ---------------------------------------------------------------
-- Google Ads
-- ---------------------------------------------------------------
create table if not exists public.ads_daily_campaign (
  date date not null,
  campaign_id text not null,
  campaign_name text not null,
  campaign_status text,
  device text not null default 'ALL',
  impressions integer not null default 0,
  clicks integer not null default 0,
  cost_micros bigint not null default 0,
  conversions numeric not null default 0,
  conversion_value numeric not null default 0,
  primary key (date, campaign_id, device)
);

create table if not exists public.ads_daily_ad_group (
  date date not null,
  campaign_id text not null,
  ad_group_id text not null,
  ad_group_name text not null,
  impressions integer not null default 0,
  clicks integer not null default 0,
  cost_micros bigint not null default 0,
  conversions numeric not null default 0,
  primary key (date, ad_group_id)
);

create table if not exists public.ads_daily_keyword (
  date date not null,
  ad_group_id text not null,
  criterion_id text not null,
  keyword text not null,
  match_type text,
  impressions integer not null default 0,
  clicks integer not null default 0,
  cost_micros bigint not null default 0,
  conversions numeric not null default 0,
  primary key (date, criterion_id, ad_group_id)
);

create table if not exists public.ads_daily_search_term (
  date date not null,
  campaign_id text not null,
  ad_group_id text not null,
  search_term text not null,
  impressions integer not null default 0,
  clicks integer not null default 0,
  cost_micros bigint not null default 0,
  conversions numeric not null default 0,
  primary key (date, ad_group_id, search_term)
);

create table if not exists public.ads_daily_landing (
  date date not null,
  campaign_id text not null,
  landing_page text not null,
  impressions integer not null default 0,
  clicks integer not null default 0,
  cost_micros bigint not null default 0,
  conversions numeric not null default 0,
  primary key (date, campaign_id, landing_page)
);

create table if not exists public.ads_conversion_actions (
  date date not null,
  conversion_action text not null,
  campaign_id text not null,
  conversions numeric not null default 0,
  conversion_value numeric not null default 0,
  primary key (date, conversion_action, campaign_id)
);

-- ---------------------------------------------------------------
-- Meta Ads (structure only until authorized)
-- ---------------------------------------------------------------
create table if not exists public.meta_daily_ad (
  date date not null,
  campaign_id text not null,
  campaign_name text,
  adset_id text not null,
  adset_name text,
  ad_id text not null,
  ad_name text,
  impressions integer not null default 0,
  reach integer not null default 0,
  clicks integer not null default 0,
  spend numeric not null default 0,
  leads numeric not null default 0,
  conversions numeric not null default 0,
  conversion_value numeric not null default 0,
  primary key (date, ad_id)
);

-- ---------------------------------------------------------------
-- Microsoft Clarity (accumulates from first sync)
-- ---------------------------------------------------------------
create table if not exists public.clarity_snapshots (
  captured_on date not null,
  window_days integer not null,
  metric text not null,       -- Traffic, DeadClickCount, RageClickCount, ScrollDepth, ...
  dimension text not null default 'ALL',
  dimension_value text not null default 'ALL',
  payload jsonb not null,
  primary key (captured_on, window_days, metric, dimension, dimension_value)
);

-- ---------------------------------------------------------------
-- CRM: leads, touchpoints, appointments, revenue
-- No clinical details stored. "requested_service" is a marketing category only.
-- ---------------------------------------------------------------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_inquiry_at timestamptz not null default now(),
  name text,
  phone_e164 text,
  email text,
  dedupe_key text,             -- sha256 of normalised phone, else email
  inquiry_type text not null check (inquiry_type in
    ('booking','contact_form','video_consult','phone','whatsapp','walk_in','gbp','ads_lead_form','meta_lead_form','referral','other')),
  requested_service text,
  first_source text, first_medium text, first_campaign text, first_term text, first_content text,
  first_landing_page text, first_referrer text, first_gclid text, first_fbclid text,
  latest_source text, latest_medium text, latest_campaign text, latest_touch_at timestamptz,
  status text not null default 'new' check (status in
    ('new','contacted','qualified','appointment_booked','completed','lost','cancelled')),
  lost_reason text,
  owner text,
  next_follow_up date,
  consent_marketing boolean,
  is_test boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists leads_first_inquiry on public.leads (first_inquiry_at desc);
create index if not exists leads_dedupe on public.leads (dedupe_key);
create index if not exists leads_status on public.leads (status);

create table if not exists public.lead_touchpoints (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  channel text not null,        -- website_form, booking_widget, phone, whatsapp, ...
  source text, medium text, campaign text, term text, content text,
  landing_page text, referrer text, gclid text, fbclid text,
  external_ref text,            -- elementor submission id, c4a booking id
  raw jsonb
);
create unique index if not exists touch_external_ref on public.lead_touchpoints (channel, external_ref);
create index if not exists touch_lead on public.lead_touchpoints (lead_id, occurred_at);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  booked_at timestamptz not null default now(),
  appointment_at timestamptz,
  status text not null default 'booked' check (status in ('booked','confirmed','completed','no_show','cancelled','rescheduled')),
  source_system text not null default 'manual',   -- click4appointment | manual | video_consult
  external_ref text,
  service_category text,
  updated_at timestamptz not null default now()
);
create unique index if not exists appt_external on public.appointments (source_system, external_ref);
create index if not exists appt_lead on public.appointments (lead_id);

create table if not exists public.revenue_entries (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  collected_on date not null,
  amount_inr numeric(12,2) not null check (amount_inr >= 0),
  service_category text,
  entered_by text,
  created_at timestamptz not null default now()
);

create index if not exists revenue_lead on public.revenue_entries (lead_id);
create index if not exists revenue_appt on public.revenue_entries (appointment_id);

create table if not exists public.lead_notes (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  author text,
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Daily offline counts for things with no per-person data
-- (e.g. calls logged by reception, walk-ins)
-- ---------------------------------------------------------------
create index if not exists notes_lead on public.lead_notes (lead_id);

create table if not exists public.manual_daily_counts (
  date date not null,
  metric text not null,         -- calls_answered, walk_ins, ...
  value integer not null default 0,
  note text,
  primary key (date, metric)
);

-- ---------------------------------------------------------------
-- Settings (branded terms, targets)
-- ---------------------------------------------------------------
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.settings (key, value) values
 ('branded_terms', '["elites","elite dental","elitesdental","elites dental care"]'::jsonb),
 ('timezone', '"Asia/Kolkata"'::jsonb),
 ('currency', '"INR"'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

create trigger leads_touch before update on public.leads for each row execute function public.touch_updated_at();
create trigger appts_touch before update on public.appointments for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'integrations','sync_runs','ga4_daily_traffic','ga4_daily_landing','ga4_daily_events','ga4_daily_geo',
    'gsc_daily_totals','gsc_daily_query_page','gsc_daily_appearance','gbp_daily_metrics','gbp_monthly_keywords',
    'ads_daily_campaign','ads_daily_ad_group','ads_daily_keyword','ads_daily_search_term','ads_daily_landing',
    'ads_conversion_actions','meta_daily_ad','clarity_snapshots','leads','lead_touchpoints','appointments',
    'revenue_entries','lead_notes','manual_daily_counts','settings','app_users']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy member_read on public.%I for select to authenticated using ((select public.is_member()))', t);
  end loop;

  -- Editors can work the CRM and manual inputs. Analytics tables are written only by service role (Edge Functions).
  foreach t in array array['leads','lead_touchpoints','appointments','revenue_entries','lead_notes','manual_daily_counts','settings']
  loop
    execute format('create policy editor_insert on public.%I for insert to authenticated with check ((select public.can_edit()))', t);
    execute format('create policy editor_update on public.%I for update to authenticated using ((select public.can_edit())) with check ((select public.can_edit()))', t);
    execute format('create policy editor_delete on public.%I for delete to authenticated using ((select public.can_edit()))', t);
  end loop;
end $$;

create policy owner_insert_users on public.app_users for insert to authenticated with check ((select public.current_role_name()) = 'owner');
create policy owner_update_users on public.app_users for update to authenticated using ((select public.current_role_name()) = 'owner') with check ((select public.current_role_name()) = 'owner');
create policy owner_delete_users on public.app_users for delete to authenticated using ((select public.current_role_name()) = 'owner');

revoke all on all tables in schema public from anon;
