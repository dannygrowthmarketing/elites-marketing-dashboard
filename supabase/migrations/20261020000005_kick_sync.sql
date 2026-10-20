-- Lets Edge Functions trigger an immediate sync (after connecting a source) through the same cron path.
create or replace function public.svc_kick_sync(p_sources text[])
returns void language plpgsql security definer set search_path = private, public as $$
declare s text;
begin
  foreach s in array p_sources loop
    perform private.invoke_sync(s, 'incremental');
  end loop;
end $$;
revoke execute on function public.svc_kick_sync(text[]) from public, anon, authenticated;
grant execute on function public.svc_kick_sync(text[]) to service_role;
