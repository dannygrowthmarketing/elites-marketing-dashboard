-- Appointments and revenue tied to test leads must not count; credential_status lists only user-facing providers.
create or replace view public.real_appointments with (security_invoker = true) as
  select a.* from public.appointments a left join public.leads l on l.id = a.lead_id
  where coalesce(l.is_test, false) = false;
create or replace view public.real_revenue with (security_invoker = true) as
  select r.* from public.revenue_entries r left join public.leads l on l.id = r.lead_id
  where coalesce(l.is_test, false) = false;
grant select on public.real_appointments, public.real_revenue to authenticated;
revoke all on public.real_appointments, public.real_revenue from anon;

create or replace function public.credential_status()
returns table (provider text, connected boolean, account_email text, scopes text, updated_at timestamptz)
language sql stable security definer set search_path = private, public as $$
  select provider, (refresh_token is not null or api_token is not null), account_email, scopes, updated_at
  from private.credentials where public.is_member() and provider in ('google','clarity','meta')
$$;
-- rpc_daily_series and rpc_funnel: see 20261020000002_reporting.sql (now read real_appointments / real_revenue).
