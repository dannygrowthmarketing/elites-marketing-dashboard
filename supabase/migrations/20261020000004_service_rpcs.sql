-- Service-role-only helpers so Edge Functions can reach the private schema
-- without exposing it through the REST API.

create or replace function public.svc_get_credential(p_provider text)
returns setof private.credentials language sql security definer set search_path = private as $$
  select * from private.credentials where provider = p_provider
$$;

create or replace function public.svc_put_credential(
  p_provider text, p_refresh_token text default null, p_access_token text default null,
  p_access_expires_at timestamptz default null, p_api_token text default null,
  p_scopes text default null, p_account_email text default null)
returns void language sql security definer set search_path = private as $$
  insert into private.credentials (provider, refresh_token, access_token, access_expires_at, api_token, scopes, account_email, updated_at)
  values (p_provider, p_refresh_token, p_access_token, p_access_expires_at, p_api_token, p_scopes, p_account_email, now())
  on conflict (provider) do update set
    refresh_token = coalesce(excluded.refresh_token, credentials.refresh_token),
    access_token = coalesce(excluded.access_token, credentials.access_token),
    access_expires_at = coalesce(excluded.access_expires_at, credentials.access_expires_at),
    api_token = coalesce(excluded.api_token, credentials.api_token),
    scopes = coalesce(excluded.scopes, credentials.scopes),
    account_email = coalesce(excluded.account_email, credentials.account_email),
    updated_at = now()
$$;

create or replace function public.svc_delete_credential(p_provider text)
returns void language sql security definer set search_path = private as $$
  delete from private.credentials where provider = p_provider
$$;

create or replace function public.svc_create_oauth_state(p_provider text, p_created_by text)
returns text language plpgsql security definer set search_path = private, public, extensions as $$
declare v text := encode(gen_random_bytes(24), 'hex');
begin
  delete from private.oauth_states where created_at < now() - interval '30 minutes';
  insert into private.oauth_states (state, provider, created_by) values (v, p_provider, p_created_by);
  return v;
end $$;

create or replace function public.svc_consume_oauth_state(p_state text)
returns text language plpgsql security definer set search_path = private as $$
declare v_provider text;
begin
  delete from private.oauth_states
  where state = p_state and created_at > now() - interval '30 minutes'
  returning provider into v_provider;
  return v_provider;
end $$;

-- Which providers have credentials (no secrets returned) — safe for members.
create or replace function public.credential_status()
returns table (provider text, connected boolean, account_email text, scopes text, updated_at timestamptz)
language sql stable security definer set search_path = private, public as $$
  select provider, (refresh_token is not null or api_token is not null), account_email, scopes, updated_at
  from private.credentials where public.is_member()
$$;

revoke execute on function public.svc_get_credential(text) from public, anon, authenticated;
revoke execute on function public.svc_put_credential(text,text,text,timestamptz,text,text,text) from public, anon, authenticated;
revoke execute on function public.svc_delete_credential(text) from public, anon, authenticated;
revoke execute on function public.svc_create_oauth_state(text,text) from public, anon, authenticated;
revoke execute on function public.svc_consume_oauth_state(text) from public, anon, authenticated;
grant execute on function public.svc_get_credential(text) to service_role;
grant execute on function public.svc_put_credential(text,text,text,timestamptz,text,text,text) to service_role;
grant execute on function public.svc_delete_credential(text) to service_role;
grant execute on function public.svc_create_oauth_state(text,text) to service_role;
grant execute on function public.svc_consume_oauth_state(text) to service_role;
grant execute on function public.credential_status() to authenticated;
