-- Revenue: single entry + bulk (Excel/CSV) upload, matched to marketing leads.
-- Safe to re-run. Adds columns/tables/functions; changes or deletes no existing data.
-- Privacy: phone/email in an upload are used only to find the matching lead; they are never stored here.
-- No clinical notes: service is a marketing category (e.g. "Implants", "Aligners").

alter table public.revenue_entries
  add column if not exists invoice_ref text,                  -- clinic's bill / receipt number; blocks double uploads
  add column if not exists entry_source text not null default 'crm',  -- crm | single | bulk
  add column if not exists batch_id uuid,
  add column if not exists match_method text,                 -- phone | email | lead | none
  add column if not exists patient_type text,                 -- new | returning
  add column if not exists channel text,                      -- clinic-reported source, used when no lead matches
  add column if not exists note text;

do $$ begin
  alter table public.revenue_entries add constraint revenue_entry_source_chk check (entry_source in ('crm','single','bulk'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.revenue_entries add constraint revenue_patient_type_chk check (patient_type is null or patient_type in ('new','returning'));
exception when duplicate_object then null; end $$;

create unique index if not exists revenue_invoice_uniq on public.revenue_entries (lower(invoice_ref)) where invoice_ref is not null;
create index if not exists revenue_batch on public.revenue_entries (batch_id);
create index if not exists revenue_collected on public.revenue_entries (collected_on);

create table if not exists public.revenue_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text,
  rows_in_file integer not null default 0,
  inserted integer not null default 0,
  skipped integer not null default 0,
  matched integer not null default 0,
  total_inr numeric(14,2) not null default 0,
  uploaded_by text,
  created_at timestamptz not null default now()
);
alter table public.revenue_batches enable row level security;
drop policy if exists member_read on public.revenue_batches;
create policy member_read on public.revenue_batches for select to authenticated using ((select public.is_member()));
drop policy if exists editor_delete on public.revenue_batches;
create policy editor_delete on public.revenue_batches for delete to authenticated using ((select public.can_edit()));
drop policy if exists editor_insert on public.revenue_batches;
create policy editor_insert on public.revenue_batches for insert to authenticated with check ((select public.can_edit()));
drop policy if exists editor_update on public.revenue_batches;
create policy editor_update on public.revenue_batches for update to authenticated using ((select public.can_edit())) with check ((select public.can_edit()));
grant select, insert, update, delete on public.revenue_batches to authenticated;
revoke all on public.revenue_batches from anon;

-- New columns must show through the view used by every report.
create or replace view public.real_revenue with (security_invoker = true) as
  select r.* from public.revenue_entries r left join public.leads l on l.id = r.lead_id
  where coalesce(l.is_test, false) = false;

-- Marketing channel for a first-touch source/medium (same buckets the clinic uses when reporting a source).
create or replace function public.channel_label(p_source text, p_medium text)
returns text language sql immutable as $$
  select case
    when s in ('google','adwords','googleads') and m in ('cpc','ppc','paid','paidsearch') then 'Google Ads'
    when s in ('facebook','instagram','meta','fb','ig') and m in ('paid','cpc','paid_social','paidsocial') then 'Meta Ads'
    when s in ('gbp','gmb','google_business','googlebusiness','business.google.com') or m in ('gbp','gmb','local') then 'Google Business Profile'
    when m = 'organic' then 'Organic search'
    when s in ('facebook','instagram','m.facebook.com','l.facebook.com','lm.facebook.com','l.instagram.com') then 'Social (organic)'
    when s in ('whatsapp','wa.me') then 'WhatsApp'
    when m = 'referral' then 'Website referral'
    when s = '(direct)' or s = '' then 'Direct / unknown'
    else initcap(s)
  end
  from (select lower(coalesce(nullif(trim(p_source),''),'(direct)')) s, lower(coalesce(nullif(trim(p_medium),''),'(none)')) m) x
$$;

-- '98450 12345', '+91 98450-12345', '919845012345' -> '+919845012345'
create or replace function public.normalize_phone_in(p text)
returns text language sql immutable as $$
  select case
    when d is null or length(d) < 10 then null
    when length(d) = 10 then '+91' || d
    when length(d) = 11 and left(d,1) = '0' then '+91' || right(d,10)
    when length(d) = 12 and left(d,2) = '91' then '+' || d
    else '+' || d end
  from (select nullif(regexp_replace(coalesce(p,''), '\D', '', 'g'), '') d) x
$$;

-- Import one or many revenue rows. p_rows: [{date, amount, invoice, service, patient_type, channel, phone, email, note, lead_id}]
-- Rows whose invoice number already exists are skipped (not overwritten). Returns a summary.
create or replace function public.rpc_revenue_import(p_rows jsonb, p_file_name text default null, p_source text default 'bulk')
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_batch uuid := gen_random_uuid();
  v_user text := auth.jwt() ->> 'email';
  r jsonb; v_lead uuid; v_method text; v_phone text; v_inv text; v_amt numeric; v_date date;
  n_in int := 0; n_skip int := 0; n_match int := 0; v_total numeric := 0;
  skipped jsonb := '[]'::jsonb; i int := 0;
begin
  if not public.can_edit() then raise exception 'Only owners and editors can add revenue'; end if;
  if p_source not in ('single','bulk') then raise exception 'bad source'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'No rows to import'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Upload at most 5,000 rows at a time'; end if;

  if p_source = 'bulk' then
    insert into revenue_batches (id, file_name, rows_in_file, uploaded_by) values (v_batch, p_file_name, jsonb_array_length(p_rows), v_user);
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_date := nullif(r->>'date','')::date;
    v_amt := nullif(r->>'amount','')::numeric;
    v_inv := nullif(trim(r->>'invoice'),'');
    if v_date is null or v_amt is null or v_amt < 0 then
      n_skip := n_skip + 1; skipped := skipped || jsonb_build_object('row', i, 'reason', 'missing date or amount'); continue;
    end if;
    if v_inv is not null and exists (select 1 from revenue_entries where lower(invoice_ref) = lower(v_inv)) then
      n_skip := n_skip + 1; skipped := skipped || jsonb_build_object('row', i, 'reason', 'invoice ' || v_inv || ' already added'); continue;
    end if;

    v_lead := null; v_method := 'none';
    if nullif(r->>'lead_id','') is not null then
      select id into v_lead from leads where id = (r->>'lead_id')::uuid;
      if v_lead is not null then v_method := 'lead'; end if;
    end if;
    v_phone := public.normalize_phone_in(r->>'phone');
    if v_lead is null and v_phone is not null then
      select id into v_lead from leads where phone_e164 = v_phone and not is_test order by first_inquiry_at limit 1;
      if v_lead is not null then v_method := 'phone'; end if;
    end if;
    if v_lead is null and nullif(trim(r->>'email'),'') is not null then
      select id into v_lead from leads where lower(email) = lower(trim(r->>'email')) and not is_test order by first_inquiry_at limit 1;
      if v_lead is not null then v_method := 'email'; end if;
    end if;

    insert into revenue_entries (lead_id, collected_on, amount_inr, service_category, entered_by, invoice_ref,
      entry_source, batch_id, match_method, patient_type, channel, note)
    values (v_lead, v_date, round(v_amt, 2), nullif(trim(r->>'service'),''), v_user, v_inv,
      p_source, case when p_source = 'bulk' then v_batch end, v_method,
      case lower(trim(coalesce(r->>'patient_type',''))) when 'new' then 'new' when 'returning' then 'returning' when 'existing' then 'returning' when 'old' then 'returning' end,
      nullif(trim(r->>'channel'),''), left(nullif(trim(r->>'note'),''), 300));
    n_in := n_in + 1; v_total := v_total + round(v_amt, 2);
    if v_lead is not null then n_match := n_match + 1; end if;
  end loop;

  if p_source = 'bulk' then
    update revenue_batches set inserted = n_in, skipped = n_skip, matched = n_match, total_inr = v_total where id = v_batch;
  end if;
  return jsonb_build_object('batch_id', case when p_source = 'bulk' then v_batch end, 'inserted', n_in, 'skipped', n_skip,
    'matched', n_match, 'total', v_total, 'skipped_rows', skipped);
end $$;

-- Undo an upload: removes the batch and every entry it added.
create or replace function public.rpc_revenue_undo_batch(p_batch uuid)
returns integer language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  if not public.can_edit() then raise exception 'Only owners and editors can remove revenue'; end if;
  delete from revenue_entries where batch_id = p_batch;
  get diagnostics n = row_count;
  delete from revenue_batches where id = p_batch;
  return n;
end $$;

-- Everything the Revenue page shows for a range, plus the 12 months ending at p_end.
create or replace function public.rpc_revenue_summary(p_start date, p_end date)
returns jsonb language sql stable security invoker set search_path = public as $$
  with e as (
    select r.*, l.name lead_name,
      case when r.lead_id is not null then public.channel_label(l.first_source, l.first_medium)
           else coalesce(nullif(r.channel,''), 'Not recorded') end ch,
      (r.lead_id is not null) matched
    from real_revenue r left join leads l on l.id = r.lead_id
  ),
  cur as (select * from e where collected_on between p_start and p_end),
  gads as (select round(sum(cost_micros)/1e6, 2) s from ads_daily_campaign where device = 'ALL' and date between p_start and p_end),
  meta as (select sum(spend) s from meta_daily_ad where date between p_start and p_end),
  months as (select generate_series(date_trunc('month', p_end) - interval '11 months', date_trunc('month', p_end), interval '1 month')::date m)
  select jsonb_build_object(
    'total', (select coalesce(sum(amount_inr),0) from cur),
    'entries', (select count(*) from cur),
    'matched_total', (select coalesce(sum(amount_inr),0) from cur where matched),
    'matched_entries', (select count(*) from cur where matched),
    'new_total', (select coalesce(sum(amount_inr),0) from cur where patient_type = 'new'),
    'returning_total', (select coalesce(sum(amount_inr),0) from cur where patient_type = 'returning'),
    'google_ads_revenue', (select coalesce(sum(amount_inr),0) from cur where ch = 'Google Ads'),
    'google_ads_spend', (select s from gads),
    'meta_revenue', (select coalesce(sum(amount_inr),0) from cur where ch = 'Meta Ads'),
    'meta_spend', (select s from meta),
    'all_time_entries', (select count(*) from e),
    'first_date', (select min(collected_on) from e),
    'by_month', (select jsonb_agg(jsonb_build_object('date', m, 'revenue', coalesce(x.amt,0), 'entries', coalesce(x.n,0)) order by m)
                 from months left join (select date_trunc('month', collected_on)::date mm, sum(amount_inr) amt, count(*) n from e group by 1) x on x.mm = months.m),
    'by_channel', coalesce((select jsonb_agg(jsonb_build_object('channel', ch, 'revenue', amt, 'entries', n, 'from_leads', ml) order by amt desc)
                 from (select ch, sum(amount_inr) amt, count(*) n, bool_or(matched) ml from cur group by ch) x), '[]'::jsonb),
    'by_service', coalesce((select jsonb_agg(jsonb_build_object('service', s, 'revenue', amt, 'entries', n) order by amt desc)
                 from (select coalesce(nullif(service_category,''),'Not recorded') s, sum(amount_inr) amt, count(*) n from cur group by 1) x), '[]'::jsonb),
    'entries_list', coalesce((select jsonb_agg(to_jsonb(x) order by x.collected_on desc, x.created_at desc) from (
                 select id, collected_on, amount_inr, invoice_ref, service_category, patient_type, ch channel, lead_id, lead_name,
                        match_method, entry_source, batch_id, note, entered_by, created_at
                 from cur order by collected_on desc, created_at desc limit 500) x), '[]'::jsonb)
  )
$$;

grant execute on function public.rpc_revenue_import(jsonb, text, text) to authenticated;
grant execute on function public.rpc_revenue_undo_batch(uuid) to authenticated;
grant execute on function public.rpc_revenue_summary(date, date) to authenticated;
grant execute on function public.channel_label(text, text) to authenticated;
grant execute on function public.normalize_phone_in(text) to authenticated;
revoke execute on function public.rpc_revenue_import(jsonb, text, text) from anon;
revoke execute on function public.rpc_revenue_undo_batch(uuid) from anon;
revoke execute on function public.rpc_revenue_summary(date, date) from anon;
