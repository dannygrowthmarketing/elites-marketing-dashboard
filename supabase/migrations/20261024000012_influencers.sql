-- Influencer contacts and collaborations. Safe to re-run; adds a table and functions, deletes nothing.
-- Business contact details of creators only (no patient data).

create table if not exists public.influencers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  handle text,                          -- @handle without the @
  platform text not null default 'instagram' check (platform in ('instagram','youtube','facebook','x','linkedin','moj','sharechat','other')),
  profile_url text,
  phone text,
  email text,
  followers integer check (followers is null or followers >= 0),
  niche text,                           -- parenting, food, lifestyle, fitness, beauty, local news …
  area text,                            -- locality / neighbourhood
  language text,
  status text not null default 'prospect' check (status in ('prospect','contacted','negotiating','agreed','posted','declined','not_fit')),
  rate_inr numeric(12,2) check (rate_inr is null or rate_inr >= 0),
  paid_inr numeric(12,2) check (paid_inr is null or paid_inr >= 0),
  collab_type text,                     -- barter, paid reel, story, visit + review …
  promo_code text,                      -- unique code / UTM so bookings can be traced
  post_url text,
  posted_on date,
  views integer, enquiries integer, patients integer,
  rating smallint check (rating is null or rating between 1 and 5),
  notes text,
  added_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists influencers_handle_uniq on public.influencers (platform, lower(handle)) where handle is not null and handle <> '';
create index if not exists influencers_status on public.influencers (status);

alter table public.influencers enable row level security;
drop policy if exists member_read on public.influencers;
create policy member_read on public.influencers for select to authenticated using ((select public.is_member()));
drop policy if exists editor_insert on public.influencers;
create policy editor_insert on public.influencers for insert to authenticated with check ((select public.can_edit()));
drop policy if exists editor_update on public.influencers;
create policy editor_update on public.influencers for update to authenticated using ((select public.can_edit())) with check ((select public.can_edit()));
drop policy if exists editor_delete on public.influencers;
create policy editor_delete on public.influencers for delete to authenticated using ((select public.can_edit()));
revoke all on public.influencers from anon;
grant select, insert, update, delete on public.influencers to authenticated;

create or replace function public.influencers_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists influencers_touch on public.influencers;
create trigger influencers_touch before update on public.influencers for each row execute function public.influencers_touch();

-- Bulk add from a spreadsheet. Existing handles (same platform) are updated with any filled-in fields, never blanked.
create or replace function public.rpc_influencer_import(p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare r jsonb; v_handle text; v_platform text; v_id uuid; n_new int := 0; n_upd int := 0; n_skip int := 0; i int := 0; skipped jsonb := '[]';
begin
  if not public.can_edit() then raise exception 'Only owners and editors can add influencers'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'No rows'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Upload at most 2,000 rows at a time'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    if nullif(trim(r->>'name'),'') is null and nullif(trim(r->>'handle'),'') is null then
      n_skip := n_skip + 1; skipped := skipped || jsonb_build_object('row', i, 'reason', 'no name or handle'); continue;
    end if;
    v_handle := nullif(regexp_replace(trim(coalesce(r->>'handle','')), '^@', ''), '');
    v_platform := coalesce(nullif(lower(trim(r->>'platform')),''), 'instagram');
    if v_platform not in ('instagram','youtube','facebook','x','linkedin','moj','sharechat','other') then v_platform := 'other'; end if;
    v_id := null;
    if v_handle is not null then select id into v_id from influencers where platform = v_platform and lower(handle) = lower(v_handle); end if;
    if v_id is null then
      insert into influencers (name, handle, platform, profile_url, phone, email, followers, niche, area, language, rate_inr, notes, added_by)
      values (coalesce(nullif(trim(r->>'name'),''), v_handle), v_handle, v_platform, nullif(trim(r->>'profile_url'),''), nullif(trim(r->>'phone'),''),
              nullif(trim(r->>'email'),''), nullif(regexp_replace(coalesce(r->>'followers',''), '[^0-9]', '', 'g'),'')::int,
              nullif(trim(r->>'niche'),''), nullif(trim(r->>'area'),''), nullif(trim(r->>'language'),''),
              nullif(regexp_replace(coalesce(r->>'rate_inr',''), '[^0-9.]', '', 'g'),'')::numeric, left(nullif(trim(r->>'notes'),''), 1000), auth.jwt() ->> 'email');
      n_new := n_new + 1;
    else
      update influencers set
        name = coalesce(nullif(trim(r->>'name'),''), name), profile_url = coalesce(nullif(trim(r->>'profile_url'),''), profile_url),
        phone = coalesce(nullif(trim(r->>'phone'),''), phone), email = coalesce(nullif(trim(r->>'email'),''), email),
        followers = coalesce(nullif(regexp_replace(coalesce(r->>'followers',''), '[^0-9]', '', 'g'),'')::int, followers),
        niche = coalesce(nullif(trim(r->>'niche'),''), niche), area = coalesce(nullif(trim(r->>'area'),''), area),
        language = coalesce(nullif(trim(r->>'language'),''), language),
        rate_inr = coalesce(nullif(regexp_replace(coalesce(r->>'rate_inr',''), '[^0-9.]', '', 'g'),'')::numeric, rate_inr),
        notes = coalesce(nullif(trim(r->>'notes'),''), notes)
      where id = v_id;
      n_upd := n_upd + 1;
    end if;
  end loop;
  return jsonb_build_object('added', n_new, 'updated', n_upd, 'skipped', n_skip, 'skipped_rows', skipped);
end $$;
grant execute on function public.rpc_influencer_import(jsonb) to authenticated;
