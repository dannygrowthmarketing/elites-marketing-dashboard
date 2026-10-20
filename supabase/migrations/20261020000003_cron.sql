-- Scheduled syncs via pg_cron + pg_net.
-- The cron secret and project URL live in private.credentials (generated in-database, never in code).
-- Times are UTC; IST = UTC+5:30.
create extension if not exists pg_cron;
create extension if not exists pg_net;

insert into private.credentials (provider, api_token)
values ('cron', encode(extensions.gen_random_bytes(32), 'hex')),
       ('lead_webhook', encode(extensions.gen_random_bytes(32), 'hex')),
       ('project_url', 'https://pymwnsjjztahucqzlqkl.supabase.co')  -- this project's API URL
on conflict (provider) do nothing;

create or replace function private.invoke_sync(p_source text, p_kind text default 'incremental')
returns bigint language plpgsql security definer set search_path = private, public as $$
declare
  v_url text;
  v_secret text;
  v_id bigint;
begin
  select api_token into v_url from private.credentials where provider = 'project_url';
  select api_token into v_secret from private.credentials where provider = 'cron';
  if v_url is null or v_secret is null then
    raise warning 'invoke_sync: project_url or cron secret missing';
    return null;
  end if;
  select net.http_post(
    url := v_url || '/functions/v1/sync',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
    body := jsonb_build_object('source', p_source, 'kind', p_kind),
    timeout_milliseconds := 150000
  ) into v_id;
  return v_id;
end $$;
revoke execute on function private.invoke_sync(text, text) from public;

select cron.schedule('sync-google-ads', '30 0 * * *', $$ select private.invoke_sync('google_ads') $$);
select cron.schedule('sync-meta-ads',   '45 0 * * *', $$ select private.invoke_sync('meta_ads') $$);
select cron.schedule('sync-ga4',        '0 1 * * *',  $$ select private.invoke_sync('ga4') $$);
select cron.schedule('sync-gsc',        '30 1 * * *', $$ select private.invoke_sync('gsc') $$);
select cron.schedule('sync-gbp',        '0 2 * * *',  $$ select private.invoke_sync('gbp') $$);
select cron.schedule('sync-clarity',    '30 2 * * *', $$ select private.invoke_sync('clarity') $$);
-- Backfill continuation: each tick pulls the next historical chunk for connected sources.
select cron.schedule('backfill-step',   '*/15 * * * *', $$
  select private.invoke_sync(source, 'backfill') from public.integrations
  where status = 'connected' and not backfill_complete and source in ('ga4','gsc','gbp','google_ads','meta_ads')
$$);
