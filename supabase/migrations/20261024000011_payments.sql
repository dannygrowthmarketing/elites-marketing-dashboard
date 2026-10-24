-- Payment gateways: Razorpay, PhonePe PG, Cashfree. Successful payments land in Revenue automatically.
-- Safe to re-run. Needs 20261021000008_revenue.sql first. Adds columns/tables/functions; deletes nothing.
-- Privacy: the payer's phone is used only to find the matching lead and is never stored. UPI IDs are never stored —
-- only the app family (Google Pay / PhonePe / Paytm / other), worked out from the UPI handle.

insert into public.integrations (source, label, status, external_id, sync_frequency, limitations) values
 ('razorpay', 'Razorpay (UPI, cards, GPay, PhonePe)', 'not_configured', null, 'Real time (webhook)',
  'Receives payment.captured and refund.processed webhooks. Google Pay, PhonePe and Paytm UPI payments made through Razorpay show up here with the app worked out from the UPI handle.'),
 ('phonepe', 'PhonePe Payment Gateway', 'not_configured', null, 'Real time (webhook)',
  'PhonePe PG (business) webhooks for completed orders and refunds. The PhonePe Business app''s QR payments to a bank account have no data API — upload those from the bank statement instead.'),
 ('cashfree', 'Cashfree Payments', 'not_configured', null, 'Real time (webhook)',
  'Cashfree PG payment success and refund webhooks.')
on conflict (source) do nothing;

alter table public.revenue_entries
  add column if not exists gateway text,          -- razorpay | phonepe | cashfree
  add column if not exists pay_method text,       -- upi | card | netbanking | wallet | other
  add column if not exists upi_app text,          -- Google Pay | PhonePe | Paytm | BHIM / other UPI
  add column if not exists gross_inr numeric(12,2); -- amount before refunds (gateway entries)

alter table public.revenue_entries drop constraint if exists revenue_entry_source_chk;
alter table public.revenue_entries add constraint revenue_entry_source_chk check (entry_source in ('crm','single','bulk','gateway'));

create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  gateway text not null,
  event_key text not null,            -- gateway event id, or gateway:type:payment id
  event_type text not null,           -- payment | refund | failed
  payment_id text,
  status text,
  amount_inr numeric(12,2),
  pay_method text,
  upi_app text,
  paid_at timestamptz,
  revenue_entry_id uuid references public.revenue_entries(id) on delete set null,
  lead_matched boolean not null default false,
  note text,
  received_at timestamptz not null default now(),
  unique (gateway, event_key)
);
create index if not exists payment_events_time on public.payment_events (received_at desc);
alter table public.payment_events enable row level security;
drop policy if exists member_read on public.payment_events;
create policy member_read on public.payment_events for select to authenticated using ((select public.is_member()));
revoke all on public.payment_events from anon;
grant select on public.payment_events to authenticated;

-- UPI handle -> app family. Handles are documented per PSP; anything unknown is "Other UPI".
create or replace function public.upi_app_of(p_vpa text)
returns text language sql immutable as $$
  select case
    when h is null then null
    when h in ('okaxis','okhdfcbank','okicici','oksbi') then 'Google Pay'
    when h in ('ybl','ibl','axl') then 'PhonePe'
    when h in ('paytm','ptyes','ptaxis','pthdfc','ptsbi') then 'Paytm'
    when h in ('upi') then 'BHIM'
    when h in ('apl','yapl','rapl') then 'Amazon Pay'
    else 'Other UPI' end
  from (select lower(nullif(split_part(coalesce(p_vpa,''), '@', 2), '')) h) x
$$;

-- Called only by the payments-webhook Edge Function (service role). p:
-- {gateway, event_key, type: payment|refund|failed, payment_id, amount, paid_at, method, vpa, upi_app, phone, note}
create or replace function public.svc_payment_ingest(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_gw text := lower(p->>'gateway');
  v_type text := p->>'type';
  v_pid text := nullif(p->>'payment_id','');
  v_amt numeric := round(nullif(p->>'amount','')::numeric, 2);
  v_at timestamptz := coalesce(nullif(p->>'paid_at','')::timestamptz, now());
  v_method text := case lower(coalesce(p->>'method',''))
      when 'upi' then 'upi' when 'card' then 'card' when 'credit_card' then 'card' when 'debit_card' then 'card'
      when 'netbanking' then 'netbanking' when 'net_banking' then 'netbanking' when 'wallet' then 'wallet' when 'app' then 'wallet'
      when '' then null else case when lower(p->>'method') like 'upi%' then 'upi' when lower(p->>'method') like '%card%' then 'card' else 'other' end end;
  v_app text := coalesce(nullif(p->>'upi_app',''), public.upi_app_of(p->>'vpa'));
  v_phone text := public.normalize_phone_in(p->>'phone');
  v_ref text; v_lead uuid; v_entry uuid; v_ev bigint; v_ch text;
begin
  if v_gw not in ('razorpay','phonepe','cashfree') then raise exception 'unknown gateway'; end if;
  if v_type not in ('payment','refund','failed') then raise exception 'unknown event type'; end if;
  if v_method = 'upi' and v_app is null then v_app := 'Other UPI'; end if;
  -- Gateways resend the same payment under new event ids; one payment = one revenue entry.
  if v_type = 'payment' and v_pid is not null and exists (select 1 from revenue_entries where lower(invoice_ref) = lower(v_gw || ':' || v_pid)) then
    return jsonb_build_object('ok', true, 'duplicate_payment', true);
  end if;

  insert into payment_events (gateway, event_key, event_type, payment_id, status, amount_inr, pay_method, upi_app, paid_at, note)
  values (v_gw, coalesce(nullif(p->>'event_key',''), v_gw || ':' || v_type || ':' || coalesce(v_pid, md5(p::text))), v_type, v_pid,
          left(p->>'status', 40), v_amt, v_method, v_app, v_at, left(nullif(p->>'note',''), 200))
  on conflict (gateway, event_key) do nothing
  returning id into v_ev;
  if v_ev is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if v_pid is null or v_amt is null then return jsonb_build_object('ok', true, 'recorded', 'event only'); end if;
  v_ref := v_gw || ':' || v_pid;

  if v_type = 'payment' then
    if v_phone is not null then
      select id into v_lead from leads where phone_e164 = v_phone and not is_test order by first_inquiry_at limit 1;
    end if;
    v_ch := case when v_lead is null then 'Not recorded' end;
    insert into revenue_entries (lead_id, collected_on, amount_inr, gross_inr, entered_by, invoice_ref, entry_source, match_method,
                                 gateway, pay_method, upi_app, channel, note)
    values (v_lead, (v_at at time zone 'Asia/Kolkata')::date, v_amt, v_amt, v_gw, v_ref, 'gateway',
            case when v_lead is not null then 'phone' else 'none' end, v_gw, v_method, v_app, v_ch, left(nullif(p->>'note',''), 300))
    returning id into v_entry;
    update payment_events set revenue_entry_id = v_entry, lead_matched = v_lead is not null where id = v_ev;
    update integrations set status = 'connected', last_success_at = now(), last_error = null,
           records_total = coalesce(records_total, 0) + 1,
           earliest_imported = least(coalesce(earliest_imported, (v_at at time zone 'Asia/Kolkata')::date), (v_at at time zone 'Asia/Kolkata')::date),
           latest_imported = greatest(coalesce(latest_imported, (v_at at time zone 'Asia/Kolkata')::date), (v_at at time zone 'Asia/Kolkata')::date)
     where source = v_gw;
    return jsonb_build_object('ok', true, 'revenue_entry', v_entry, 'lead_matched', v_lead is not null);
  elsif v_type = 'refund' then
    update revenue_entries set amount_inr = greatest(0, amount_inr - v_amt),
           note = left(concat_ws(' · ', note, 'Refunded ₹' || v_amt::text), 300)
     where lower(invoice_ref) = lower(v_ref) returning id into v_entry;
    update payment_events set revenue_entry_id = v_entry where id = v_ev;
    return jsonb_build_object('ok', true, 'refund_applied', v_entry is not null);
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.svc_payment_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.svc_payment_ingest(jsonb) to service_role;

-- Gateway view for the Revenue page.
create or replace function public.rpc_payment_summary(p_start date, p_end date)
returns jsonb language sql stable security invoker set search_path = public as $$
  with e as (select * from payment_events where (coalesce(paid_at, received_at) at time zone 'Asia/Kolkata')::date between p_start and p_end),
  pay as (select * from e where event_type = 'payment')
  select jsonb_build_object(
    'payments', (select count(*) from pay),
    'collected', (select coalesce(sum(amount_inr),0) from pay),
    'refunded', (select coalesce(sum(amount_inr),0) from e where event_type = 'refund'),
    'failed', (select count(*) from e where event_type = 'failed'),
    'matched', (select count(*) from pay where lead_matched),
    'by_gateway', coalesce((select jsonb_agg(jsonb_build_object('gateway', gateway, 'amount', a, 'n', n) order by a desc)
        from (select gateway, sum(amount_inr) a, count(*) n from pay group by 1) x), '[]'::jsonb),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', m, 'amount', a, 'n', n) order by a desc)
        from (select coalesce(case when pay_method = 'upi' then upi_app end, initcap(pay_method), 'Unknown') m, sum(amount_inr) a, count(*) n from pay group by 1) x), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'amount', a, 'n', n) order by d)
        from (select (coalesce(paid_at, received_at) at time zone 'Asia/Kolkata')::date d, sum(amount_inr) a, count(*) n from pay group by 1) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select gateway, event_type, status, amount_inr, pay_method, upi_app, paid_at, received_at, lead_matched, right(coalesce(payment_id,''), 6) ref_tail
        from e order by received_at desc limit 50) x), '[]'::jsonb)
  )
$$;
grant execute on function public.rpc_payment_summary(date, date) to authenticated;

create or replace function public.credential_status()
returns table (provider text, connected boolean, account_email text, scopes text, updated_at timestamptz)
language sql stable security definer set search_path = private, public as $$
  select provider, (refresh_token is not null or api_token is not null), account_email, scopes, updated_at
  from private.credentials where public.is_member()
    and provider in ('google','clarity','meta','mailchimp','whatsapp','razorpay','phonepe','cashfree')
$$;
