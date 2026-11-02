-- Contact lists for marketing: which people the clinic may message, and on what basis.
-- Patients are full CRM leads (name + phone live in public.leads). Third-party lists are stored
-- only as a one-way hash of the phone number: enough to recognise the person when they reach the
-- clinic on their own, never enough to message them.
create table if not exists public.contact_lists (
  id            bigint generated always as identity primary key,
  list          text not null,                 -- 'patients_c4a', 'oil_shop_partner'
  contact_hash  text not null,                 -- sha256 of 'p:+91XXXXXXXXXX' (same basis as leads.dedupe_key)
  lead_id       uuid references public.leads(id) on delete set null,
  consent       text not null check (consent in ('existing_patient', 'opted_in', 'no_consent')),
  external_ref  text,                          -- id in the source file (e.g. GL12345)
  first_visit   date,
  last_visit    date,
  visits        integer,
  opted_out_at  timestamptz,
  added_at      timestamptz not null default now(),
  unique (list, contact_hash)
);
create index if not exists contact_lists_hash on public.contact_lists (contact_hash);

alter table public.contact_lists enable row level security;
create policy member_read on public.contact_lists for select to authenticated using ((select public.is_member()));
create policy editor_update on public.contact_lists for update to authenticated using ((select public.can_edit())) with check ((select public.can_edit()));
revoke all on public.contact_lists from anon;

-- Who may receive a WhatsApp/SMS campaign. Third-party (no_consent) contacts never qualify, even if
-- someone adds a phone later, until they opt in themselves.
create or replace function public.can_message(p_list_row public.contact_lists)
returns boolean language sql immutable as $$
  select p_list_row.consent in ('existing_patient', 'opted_in') and p_list_row.opted_out_at is null
$$;

-- Segments for the CRM / campaigns page.
create or replace function public.rpc_contact_segments(p_today date default (now() at time zone 'Asia/Kolkata')::date)
returns jsonb language sql stable set search_path = public as $$
  with p as (select * from contact_lists where list = 'patients_c4a'),
  o as (select * from contact_lists where list = 'oil_shop_partner'),
  -- An oil-shop contact "arrived" when a CRM lead with the same phone hash was created after the list was added.
  arrived as (
    select o.id, min(l.first_inquiry_at) at from o join leads l on l.dedupe_key = o.contact_hash and l.first_inquiry_at >= o.added_at and not l.is_test
    group by o.id
  )
  select jsonb_build_object(
    'patients', (select count(*) from p),
    'messageable', (select count(*) from p where public.can_message(p)),
    'opted_out', (select count(*) from p where opted_out_at is not null),
    'recent_90', (select count(*) from p where last_visit >= p_today - 90),
    'recall_due', (select count(*) from p where last_visit < p_today - 180 and last_visit >= p_today - 365),
    'lapsed', (select count(*) from p where last_visit < p_today - 365),
    'repeat', (select count(*) from p where visits > 1),
    'one_visit', (select count(*) from p where visits = 1),
    'first_visit_min', (select min(first_visit) from p),
    'last_visit_max', (select max(last_visit) from p),
    'by_month', (select jsonb_agg(jsonb_build_object('month', m, 'new', n) order by m) from (
        select to_char(first_visit, 'YYYY-MM') m, count(*) n from p group by 1) x),
    'oil_shop', (select count(*) from o),
    'oil_shop_patients', (select count(*) from o where exists (select 1 from p where p.contact_hash = o.contact_hash)),
    'oil_shop_arrived', (select count(*) from arrived),
    'oil_shop_booked', (select count(*) from arrived a join o on o.id = a.id join leads l on l.dedupe_key = o.contact_hash
                         where l.status in ('appointment_booked', 'completed'))
  )
$$;

-- Recall list for staff: patients by segment, with name and phone from the CRM.
create or replace function public.rpc_contact_list(p_segment text, p_today date default (now() at time zone 'Asia/Kolkata')::date, p_limit int default 200)
returns table (lead_id uuid, name text, phone_e164 text, first_visit date, last_visit date, visits int, opted_out boolean)
language sql stable set search_path = public as $$
  select l.id, l.name, l.phone_e164, c.first_visit, c.last_visit, c.visits, c.opted_out_at is not null
  from contact_lists c join leads l on l.id = c.lead_id
  where c.list = 'patients_c4a'
    and case p_segment
      when 'recall_due' then c.last_visit < p_today - 180 and c.last_visit >= p_today - 365
      when 'lapsed' then c.last_visit < p_today - 365
      when 'recent_90' then c.last_visit >= p_today - 90
      when 'repeat' then c.visits > 1
      when 'one_visit' then c.visits = 1
      else true end
  order by c.last_visit desc
  limit least(greatest(p_limit, 1), 1000)
$$;

grant execute on function public.rpc_contact_segments(date), public.rpc_contact_list(text, date, int), public.can_message(public.contact_lists) to authenticated;
