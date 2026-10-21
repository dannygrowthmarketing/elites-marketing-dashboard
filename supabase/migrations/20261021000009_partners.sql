-- Partnership opportunities agent: discover, audit, score and track public business partners
-- near the clinic (schools, workplaces, gyms, pharmacies, labs...). No outreach is automated.
-- Safe to re-run. Adds tables/functions only.

-- Shared secret the fetcher sends to partners-ingest (generated in-database, never in code).
insert into private.credentials (provider, api_token)
values ('partner_ingest', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (provider) do nothing;

-- Sources the agent is allowed to use, with the licence check that cleared them.
create table if not exists public.partner_sources (
  key text primary key,
  name text not null,
  license text not null,
  terms_url text not null,
  attribution text not null,
  verified_on date not null,
  verification_note text not null,
  status text not null default 'active' check (status in ('active','paused','rejected'))
);
insert into public.partner_sources (key, name, license, terms_url, attribution, verified_on, verification_note, status) values
  ('overture_places', 'Overture Maps — Places',
   'CDLA-Permissive-2.0 (Meta, Microsoft, PinMeTo and others) · Apache-2.0 (Foursquare) · CC0-1.0 (AllThePlaces)',
   'https://docs.overturemaps.org/attribution/',
   'Places data © Overture Maps Foundation and contributors (Meta, Microsoft, Foursquare, PinMeTo, AllThePlaces and others). CDLA-Permissive-2.0 / Apache-2.0 / CC0.',
   '2026-10-21',
   'Open-licence releases published for any use including commercial; downloaded as public files from the Overture S3 bucket (no scraping, no API terms). Per-record licence kept in evidence. OpenStreetMap''s public Overpass server was considered and rejected: its policy says commercial use should use paid or self-hosted servers.',
   'active'),
  ('osm_overpass_public', 'OpenStreetMap — public Overpass API',
   'ODbL-1.0', 'https://wiki.openstreetmap.org/wiki/Overpass_API',
   '© OpenStreetMap contributors, ODbL', '2026-10-21',
   'Rejected for now: overpass-api.de usage policy says "Commercial use should use self-hosted or paid Overpass servers". Could be revisited with a self-hosted instance or an extract.',
   'rejected')
on conflict (key) do update set name = excluded.name, license = excluded.license, terms_url = excluded.terms_url,
  attribution = excluded.attribution, verified_on = excluded.verified_on, verification_note = excluded.verification_note, status = excluded.status;

create table if not exists public.partner_runs (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references public.partner_sources(key),
  release text,
  trigger text not null default 'manual',
  triggered_by text,
  params jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','error')),
  fetched integer not null default 0,     -- places the fetcher returned (already limited to partner categories in the area)
  in_scope integer not null default 0,    -- passed every audit check
  duplicates integer not null default 0,
  new_count integer not null default 0,
  updated_count integer not null default 0,
  gone_count integer not null default 0,
  excluded jsonb not null default '{}'::jsonb,   -- reason -> count
  log jsonb not null default '[]'::jsonb,
  error text
);
create index if not exists partner_runs_started on public.partner_runs (started_at desc);

create table if not exists public.partner_opportunities (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references public.partner_sources(key),
  source_id text not null,                 -- Overture GERS id
  name text not null,
  partner_type text not null,
  category text,
  lat double precision not null,
  lon double precision not null,
  distance_km numeric(6,2) not null,
  address text, locality text, postcode text,
  websites text[] not null default '{}',
  phones text[] not null default '{}',     -- public business numbers as listed
  socials text[] not null default '{}',
  source_confidence numeric(4,3),
  chain_key text,
  chain_count integer not null default 1,
  is_chain boolean not null default false,
  flags text[] not null default '{}',
  evidence jsonb not null default '[]'::jsonb,
  score integer not null default 0,
  score_breakdown jsonb not null default '[]'::jsonb,
  score_version text not null default 'v1',
  status text not null default 'new' check (status in ('new','reviewing','shortlisted','not_a_fit','partnered')),
  notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  active boolean not null default true,
  first_seen_run uuid references public.partner_runs(id) on delete set null,
  last_seen_run uuid references public.partner_runs(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (source_key, source_id)
);
create index if not exists partner_opps_score on public.partner_opportunities (score desc);

do $$
declare t text;
begin
  foreach t in array array['partner_sources','partner_runs','partner_opportunities'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists member_read on public.%I', t);
    execute format('create policy member_read on public.%I for select to authenticated using ((select public.is_member()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- Reviewers can only change the review fields.
drop policy if exists editor_review on public.partner_opportunities;
create policy editor_review on public.partner_opportunities for update to authenticated
  using ((select public.can_edit())) with check ((select public.can_edit()));
revoke insert, delete on public.partner_opportunities, public.partner_runs, public.partner_sources from authenticated;
-- Supabase grants table-wide UPDATE by default, so enforce the review-only rule with a trigger.
create or replace function public.partner_review_only() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and
     (to_jsonb(new) - array['status','notes','reviewed_by','reviewed_at']) is distinct from (to_jsonb(old) - array['status','notes','reviewed_by','reviewed_at']) then
    raise exception 'Only status and notes can be changed here; the agent owns the other fields';
  end if;
  return new;
end $$;
drop trigger if exists partner_review_only on public.partner_opportunities;
create trigger partner_review_only before update on public.partner_opportunities for each row execute function public.partner_review_only();

-- Which partner type a place category belongs to (null = not a partner category).
create or replace function public.partner_type_for(p_category text)
returns text language sql immutable as $$
  select case
    when p_category in ('school','private_school','public_school','preschool','elementary_school','middle_school','high_school','montessori_school','kindergarten','day_care_preschool','child_care_and_day_care') then 'School / preschool'
    when p_category in ('college_university','nursing_school','vocational_and_technical_school') then 'College'
    when p_category in ('information_technology_company','corporate_or_business_office','biotechnology_company','pharmaceutical_company',
                        'industrial_company','clothing_company','telecommunications_company','manufacturer','software_development','bank_or_credit_union_office') then 'Workplace'
    when p_category in ('gym','fitness_studio','yoga_studio','sport_or_fitness_facility','fitness_trainer','pilates_studio','martial_arts_club','sports_club_and_league') then 'Fitness & wellness'
    when p_category in ('pharmacy','pharmacy_and_drug_store','drugstore') then 'Pharmacy'
    when p_category in ('diagnostic_imaging','laboratory_testing','doctors_office','pediatrician','general_practitioner','ent_doctor','family_practice','physical_therapy') then 'Diagnostics & doctors'
  end
$$;

-- Transparent score, 0–100. Every part carries its points, its maximum and the reason.
create or replace function public.partner_score(p_type text, p_km numeric, p_has_web boolean, p_has_phone boolean, p_conf numeric, p_chain boolean)
returns jsonb language sql immutable as $$
  with parts as (
    select * from (values
      (1, 'fit', 'Partnership fit', 35,
        case p_type when 'School / preschool' then 35 when 'Workplace' then 32 when 'College' then 28
                    when 'Diagnostics & doctors' then 25 when 'Fitness & wellness' then 22 when 'Pharmacy' then 15 else 0 end,
        case p_type when 'School / preschool' then 'Check-up camps for children; the clinic offers paediatric dentistry'
                    when 'Workplace' then 'Employee dental camps and corporate tie-ups reach many adults at once'
                    when 'College' then 'Student camps and student-rate tie-ups'
                    when 'Diagnostics & doctors' then 'Two-way referrals (X-ray/OPG, patients needing dental care)'
                    when 'Fitness & wellness' then 'Wellness cross-promotion; sports mouthguards'
                    when 'Pharmacy' then 'Referral point for people asking about tooth pain; low commitment' else 'Not a partner category' end),
      (2, 'proximity', 'Distance from clinic', 25,
        case when p_km <= 0.5 then 25 when p_km <= 1 then 20 when p_km <= 1.5 then 14 when p_km <= 2 then 8 else 4 end,
        to_char(p_km, 'FM990.0') || ' km away — ' || case when p_km <= 1 then 'walking distance for referred patients' when p_km <= 2 then 'short drive' else 'further out' end),
      (3, 'reach', 'Public contact details', 20,
        (case when p_has_web then 10 else 0 end) + (case when p_has_phone then 10 else 0 end),
        concat_ws(' · ', case when p_has_web then 'website listed' else 'no website' end, case when p_has_phone then 'phone listed' else 'no phone' end)),
      (4, 'confidence', 'Data confidence', 10,
        least(10, greatest(0, round(coalesce(p_conf, 0) * 10)))::int,
        'Source confidence ' || to_char(coalesce(p_conf,0), 'FM0.00') || ' that the place exists as listed'),
      (5, 'local', 'Local decision-maker', 10,
        case when p_chain then 3 else 10 end,
        case when p_chain then 'Chain outlet — a tie-up usually needs head-office approval' else 'Independent — the person on site can usually decide' end)
    ) v(ord, key, label, max, points, why)
  )
  select jsonb_build_object('total', sum(points), 'version', 'v1',
    'parts', jsonb_agg(jsonb_build_object('key', key, 'label', label, 'points', points, 'max', max, 'why', why) order by ord))
  from parts
$$;

create or replace function public.partner_dataset_license(p_dataset text)
returns text language sql immutable as $$
  select case lower(coalesce(p_dataset,'')) when 'foursquare' then 'Apache-2.0' when 'alltheplaces' then 'CC0-1.0' else 'CDLA-Permissive-2.0' end
$$;

-- Ingest one fetch: audit every candidate, score what survives, upsert, and record the run.
-- p_run:  {source_key, release, trigger, triggered_by, params:{center_lat, center_lon, radius_km, min_confidence}}
-- p_rows: [{source_id, name, category, lat, lon, address, locality, postcode, websites[], phones[], socials[],
--           confidence, operating_status, brand, records:[{dataset, record_id, update_time, confidence}]}]
create or replace function public.partner_ingest(p_run jsonb, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_run uuid;
  v_src text := coalesce(p_run->>'source_key', 'overture_places');
  v_lat double precision := (p_run->'params'->>'center_lat')::double precision;
  v_lon double precision := (p_run->'params'->>'center_lon')::double precision;
  v_radius numeric := coalesce((p_run->'params'->>'radius_km')::numeric, 2);
  v_minconf numeric := coalesce((p_run->'params'->>'min_confidence')::numeric, 0.6);
  v_fetched int; v_kept int; v_dups int; v_new int; v_upd int; v_gone int; v_excl jsonb; v_log jsonb := '[]'::jsonb;
begin
  if v_lat is null or v_lon is null then raise exception 'params.center_lat/center_lon required'; end if;
  if not exists (select 1 from partner_sources where key = v_src and status = 'active') then
    raise exception 'source % is not an active, verified source', v_src;
  end if;

  insert into partner_runs (source_key, release, trigger, triggered_by, params, status)
  values (v_src, p_run->>'release', coalesce(p_run->>'trigger','manual'), p_run->>'triggered_by', coalesce(p_run->'params','{}'::jsonb), 'running')
  returning id into v_run;

  create temp table _c on commit drop as
  select r->>'source_id' sid, nullif(trim(r->>'name'),'') nm, r->>'category' cat, public.partner_type_for(r->>'category') ptype,
         (r->>'lat')::double precision lat, (r->>'lon')::double precision lon,
         nullif(r->>'address','') addr, nullif(r->>'locality','') loc, nullif(r->>'postcode','') pc,
         coalesce(array(select jsonb_array_elements_text(r->'websites')), '{}') webs,
         coalesce(array(select jsonb_array_elements_text(r->'phones')), '{}') phs,
         coalesce(array(select jsonb_array_elements_text(r->'socials')), '{}') socs,
         (r->>'confidence')::numeric conf, lower(coalesce(r->>'operating_status','')) opst, nullif(r->>'brand','') brand,
         coalesce(r->'records','[]'::jsonb) recs,
         null::numeric km, null::text reason, null::text chain_key, 1 chain_n
  from jsonb_array_elements(p_rows) r;

  update _c set km = round((6371 * 2 * asin(sqrt(power(sin(radians(lat - v_lat)/2),2)
                 + cos(radians(v_lat)) * cos(radians(lat)) * power(sin(radians(lon - v_lon)/2),2))))::numeric, 2);
  select count(*) into v_fetched from _c;
  v_log := v_log || jsonb_build_object('step','fetched','count',v_fetched);

  -- Audit checks, first failing reason wins.
  update _c set reason = case
      when sid is null or nm is null then 'missing id or name'
      when ptype is null then 'not a partner category'
      when km > v_radius then 'outside radius'
      when nm ~* 'dent|orthodont' then 'dental practice (competitor)'
      when opst in ('closed','permanently_closed','temporarily_closed') then 'listed as closed'
      when coalesce(conf,0) < v_minconf then 'low source confidence'
    end;

  -- Duplicates: same normalised name within 150 m — keep the most confident record.
  with n as (select ctid, lower(regexp_replace(nm, '[^a-zA-Z0-9]', '', 'g')) k, lat, lon, conf from _c where reason is null),
  d as (select a.ctid from n a join n b on a.k = b.k and a.ctid <> b.ctid
          and 6371 * 2 * asin(sqrt(power(sin(radians(a.lat - b.lat)/2),2) + cos(radians(a.lat)) * cos(radians(b.lat)) * power(sin(radians(a.lon - b.lon)/2),2))) < 0.15
          and (coalesce(b.conf,0) > coalesce(a.conf,0) or (coalesce(b.conf,0) = coalesce(a.conf,0) and b.ctid < a.ctid)))
  update _c set reason = 'duplicate listing' where ctid in (select ctid from d);

  -- Chains: same leading brand word on 3+ listings in the fetch (or a brand set by the source).
  update _c set chain_key = (select w from regexp_split_to_table(lower(regexp_replace(nm, '[^a-zA-Z0-9 ]', ' ', 'g')), '\s+') with ordinality t(w, o)
                             where length(w) >= 4 and w not in ('little','shree','sree','international','school','public','clinic','centre','center',
                               'fitness','pharmacy','medical','health','care','diagnostics','diagnostic','academy','kids','global','india','bangalore','bengaluru',
                               'royal','green','best','smart','bright','new','first','star','life','gym','yoga','studio','labs','college','institute','technologies','private','limited')
                             order by o limit 1);
  update _c c set chain_n = x.n from (select chain_key, count(*) n from _c where chain_key is not null group by 1) x where c.chain_key = x.chain_key;

  select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) into v_excl from (select reason, count(*) n from _c where reason is not null group by 1) x;
  select count(*) filter (where reason = 'duplicate listing'), count(*) filter (where reason is null) into v_dups, v_kept from _c;
  v_log := v_log || jsonb_build_object('step','audit','kept',v_kept,'excluded',v_excl);

  -- Upsert survivors. Review fields (status, notes) are never touched by the agent.
  with up as (
    insert into partner_opportunities as o (source_key, source_id, name, partner_type, category, lat, lon, distance_km, address, locality, postcode,
      websites, phones, socials, source_confidence, chain_key, chain_count, is_chain, flags, evidence, score, score_breakdown, score_version,
      active, first_seen_run, last_seen_run, last_seen_at)
    select v_src, sid, nm, ptype, cat, lat, lon, km, addr, loc, pc, webs, phs, socs, conf, chain_key, chain_n,
      (brand is not null or chain_n >= 3),
      array_remove(array[
        case when cardinality(webs) = 0 and cardinality(phs) = 0 then 'no public contact' end,
        case when brand is not null or chain_n >= 3 then 'chain outlet' end,
        case when coalesce(conf,0) < 0.8 then 'check it still operates' end], null),
      jsonb_build_array(
        jsonb_build_object('claim','Name','value',nm),
        jsonb_build_object('claim','Category','value',cat),
        jsonb_build_object('claim','Location','value', to_char(lat,'FM990.000000') || ', ' || to_char(lon,'FM990.000000')),
        jsonb_build_object('claim','Address','value',addr),
        jsonb_build_object('claim','Website','value',array_to_string(webs, ' · ')),
        jsonb_build_object('claim','Phone','value',array_to_string(phs, ' · ')),
        jsonb_build_object('claim','Records','value',
          (select jsonb_agg(jsonb_build_object('dataset', e->>'dataset', 'record_id', e->>'record_id', 'update_time', e->>'update_time',
                   'confidence', e->'confidence', 'license', public.partner_dataset_license(e->>'dataset'))) from jsonb_array_elements(recs) e)),
        jsonb_build_object('claim','Release','value',p_run->>'release')),
      (public.partner_score(ptype, km, cardinality(webs) > 0, cardinality(phs) > 0, conf, brand is not null or chain_n >= 3)->>'total')::int,
      public.partner_score(ptype, km, cardinality(webs) > 0, cardinality(phs) > 0, conf, brand is not null or chain_n >= 3)->'parts', 'v1',
      true, v_run, v_run, now()
    from _c where reason is null
    on conflict (source_key, source_id) do update set
      name = excluded.name, partner_type = excluded.partner_type, category = excluded.category, lat = excluded.lat, lon = excluded.lon,
      distance_km = excluded.distance_km, address = excluded.address, locality = excluded.locality, postcode = excluded.postcode,
      websites = excluded.websites, phones = excluded.phones, socials = excluded.socials, source_confidence = excluded.source_confidence,
      chain_key = excluded.chain_key, chain_count = excluded.chain_count, is_chain = excluded.is_chain, flags = excluded.flags,
      evidence = excluded.evidence, score = excluded.score, score_breakdown = excluded.score_breakdown, score_version = excluded.score_version,
      active = true, last_seen_run = excluded.last_seen_run, last_seen_at = now()
    returning (xmax = 0) inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_new, v_upd from up;

  -- Anything this source showed before, inside this radius, but not now: mark inactive (kept for history).
  update partner_opportunities set active = false, flags = array_append(array_remove(flags, 'not in latest data'), 'not in latest data')
  where source_key = v_src and active and last_seen_run is distinct from v_run and distance_km <= v_radius;
  get diagnostics v_gone = row_count;

  v_log := v_log || jsonb_build_object('step','stored','new',v_new,'updated',v_upd,'marked_inactive',v_gone);
  update partner_runs set status = 'success', finished_at = now(), fetched = v_fetched, in_scope = v_kept, duplicates = v_dups,
    new_count = v_new, updated_count = v_upd, gone_count = v_gone, excluded = v_excl, log = v_log
  where id = v_run;
  return jsonb_build_object('run_id', v_run, 'fetched', v_fetched, 'kept', v_kept, 'new', v_new, 'updated', v_upd, 'inactive', v_gone, 'excluded', v_excl);
end $$;

-- Record a failed fetch (called by the ingest function when the fetcher reports an error).
create or replace function public.partner_log_failure(p_run jsonb, p_error text)
returns uuid language sql security definer set search_path = public as $$
  insert into partner_runs (source_key, release, trigger, triggered_by, params, status, finished_at, error)
  values (coalesce(p_run->>'source_key','overture_places'), p_run->>'release', coalesce(p_run->>'trigger','manual'), p_run->>'triggered_by',
          coalesce(p_run->'params','{}'::jsonb), 'error', now(), left(p_error, 2000))
  returning id
$$;

-- Re-apply the current scoring to every stored opportunity (after a scoring change). Editors only.
create or replace function public.rpc_partner_rescore()
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.can_edit() then raise exception 'Only owners and editors can rescore'; end if;
  update partner_opportunities o set
    score = (s->>'total')::int, score_breakdown = s->'parts', score_version = s->>'version'
  from (select id, public.partner_score(partner_type, distance_km, cardinality(websites) > 0, cardinality(phones) > 0, source_confidence, is_chain) s
        from partner_opportunities) x
  where x.id = o.id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.partner_ingest(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.partner_log_failure(jsonb, text) from public, anon, authenticated;
grant execute on function public.partner_ingest(jsonb, jsonb) to service_role;
grant execute on function public.partner_log_failure(jsonb, text) to service_role;
revoke execute on function public.rpc_partner_rescore() from public, anon;
grant execute on function public.rpc_partner_rescore() to authenticated;
