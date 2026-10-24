-- Email (Mailchimp) and WhatsApp Business (Meta Cloud API) campaign data.
-- Safe to re-run. Adds rows/tables/functions only; changes or deletes no existing data.
-- No subscriber or recipient details are stored — campaign and day totals only.

insert into public.integrations (source, label, status, external_id, sync_frequency, limitations) values
 ('mailchimp', 'Mailchimp (email campaigns)', 'not_configured', null, 'Daily 07:45 IST',
  'Campaign reports and audience size via the Mailchimp Marketing API (API key). Last 18 months of sent campaigns. Opens are inflated by Apple Mail Privacy Protection; clicks are the reliable signal. No subscriber details are stored.'),
 ('whatsapp', 'WhatsApp Business (campaigns)', 'not_configured', null, 'Daily 07:50 IST',
  'Needs the WhatsApp Business Platform (Cloud API) — the ordinary WhatsApp Business app has no data API. Daily sent/delivered per number and template sent/delivered/read/clicked (template analytics must be switched on). No message content or recipient numbers are stored.')
on conflict (source) do nothing;

create table if not exists public.email_audiences (
  list_id text primary key,
  name text,
  member_count integer,
  unsubscribe_count integer,
  cleaned_count integer,
  campaign_count integer,
  avg_open_rate numeric,
  avg_click_rate numeric,
  last_sub_date timestamptz,
  synced_at timestamptz not null default now()
);

create table if not exists public.email_campaigns (
  campaign_id text primary key,
  list_id text,
  title text,
  subject text,
  campaign_type text,
  send_time timestamptz,
  emails_sent integer not null default 0,
  opens integer not null default 0,
  unique_opens integer not null default 0,
  open_rate numeric,
  clicks integer not null default 0,
  unique_clicks integer not null default 0,
  click_rate numeric,
  unsubscribed integer not null default 0,
  hard_bounces integer not null default 0,
  soft_bounces integer not null default 0,
  abuse_reports integer not null default 0,
  synced_at timestamptz not null default now()
);
create index if not exists email_campaigns_sent on public.email_campaigns (send_time desc);

create table if not exists public.whatsapp_daily (
  date date not null,
  phone_number text not null,          -- the business's own sending number, as Meta reports it
  sent integer not null default 0,
  delivered integer not null default 0,
  primary key (date, phone_number)
);

create table if not exists public.whatsapp_template_daily (
  date date not null,
  template_id text not null,
  template_name text,
  category text,
  sent integer not null default 0,
  delivered integer not null default 0,
  read integer not null default 0,
  clicked integer not null default 0,
  primary key (date, template_id)
);

do $$
declare t text;
begin
  foreach t in array array['email_audiences','email_campaigns','whatsapp_daily','whatsapp_template_daily'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists member_read on public.%I', t);
    execute format('create policy member_read on public.%I for select to authenticated using ((select public.is_member()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- The Integrations page shows which tokens are saved (never the tokens themselves).
create or replace function public.credential_status()
returns table (provider text, connected boolean, account_email text, scopes text, updated_at timestamptz)
language sql stable security definer set search_path = private, public as $$
  select provider, (refresh_token is not null or api_token is not null), account_email, scopes, updated_at
  from private.credentials where public.is_member() and provider in ('google','clarity','meta','mailchimp','whatsapp')
$$;

-- Daily syncs (UTC). Do nothing until a token is saved.
select cron.schedule('sync-mailchimp', '15 2 * * *', $$ select private.invoke_sync('mailchimp') $$);
select cron.schedule('sync-whatsapp',  '20 2 * * *', $$ select private.invoke_sync('whatsapp') $$);
