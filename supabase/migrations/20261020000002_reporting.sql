-- Reporting RPCs. All run as the caller (security invoker), so RLS applies.
-- Every function takes an inclusive date range [p_start, p_end] in clinic-local dates.

create or replace view public.real_appointments with (security_invoker = true) as
  select a.* from public.appointments a left join public.leads l on l.id = a.lead_id
  where coalesce(l.is_test, false) = false;
create or replace view public.real_revenue with (security_invoker = true) as
  select r.* from public.revenue_entries r left join public.leads l on l.id = r.lead_id
  where coalesce(l.is_test, false) = false;

-- Unified daily series for charts. One row per date; nulls where a source has no row.
create or replace function public.rpc_daily_series(p_start date, p_end date)
returns table (
  date date,
  gsc_clicks bigint, gsc_impressions bigint, gsc_position numeric,
  ga4_sessions bigint, ga4_engaged bigint, ga4_users bigint,
  gbp_views bigint, gbp_calls bigint, gbp_directions bigint, gbp_website bigint,
  ads_impressions bigint, ads_clicks bigint, ads_cost numeric, ads_conversions numeric,
  meta_spend numeric, meta_clicks bigint,
  leads bigint, bookings bigint, completed bigint, revenue numeric
) language sql stable set search_path = public as $$
  with d as (select generate_series(p_start, p_end, interval '1 day')::date as date),
  gsc as (select date, sum(clicks) c, sum(impressions) i, sum(position_weighted) pw
          from gsc_daily_totals where device='ALL' and country='ALL' and date between p_start and p_end group by date),
  ga as (select date, sum(sessions) s, sum(engaged_sessions) e, sum(total_users) u
         from ga4_daily_traffic where date between p_start and p_end group by date),
  gbp as (select date,
            sum(value) filter (where metric like 'BUSINESS_IMPRESSIONS_%') v,
            sum(value) filter (where metric='CALL_CLICKS') calls,
            sum(value) filter (where metric='BUSINESS_DIRECTION_REQUESTS') dirs,
            sum(value) filter (where metric='WEBSITE_CLICKS') web
          from gbp_daily_metrics where date between p_start and p_end group by date),
  ads as (select date, sum(impressions) i, sum(clicks) c, sum(cost_micros)/1e6 cost, sum(conversions) conv
          from ads_daily_campaign where device='ALL' and date between p_start and p_end group by date),
  meta as (select date, sum(spend) s, sum(clicks) c from meta_daily_ad where date between p_start and p_end group by date),
  l as (select (first_inquiry_at at time zone 'Asia/Kolkata')::date date, count(*) n
        from leads where not is_test group by 1),
  b as (select (booked_at at time zone 'Asia/Kolkata')::date date,
               count(*) filter (where status <> 'cancelled') n,
               count(*) filter (where status = 'completed') done
        from real_appointments group by 1),
  r as (select collected_on date, sum(amount_inr) amt from real_revenue group by 1)
  select d.date,
    gsc.c, gsc.i, case when gsc.i > 0 then round(gsc.pw / gsc.i, 2) end,
    ga.s, ga.e, ga.u,
    gbp.v, gbp.calls, gbp.dirs, gbp.web,
    ads.i, ads.c, round(ads.cost::numeric, 2), ads.conv,
    meta.s, meta.c,
    l.n, b.n, b.done, r.amt
  from d
  left join gsc using (date) left join ga using (date) left join gbp using (date)
  left join ads using (date) left join meta using (date)
  left join l using (date) left join b using (date) left join r using (date)
  order by d.date
$$;

-- Search Console: queries with previous-period comparison
create or replace function public.rpc_gsc_queries(p_start date, p_end date, p_prev_start date, p_prev_end date, p_limit int default 500)
returns table (query text, is_branded boolean, clicks bigint, impressions bigint, ctr numeric, avg_position numeric,
               prev_clicks bigint, prev_impressions bigint, prev_position numeric, top_page text)
language sql stable set search_path = public as $$
  with cur as (
    select query, bool_or(is_branded) b, sum(clicks) c, sum(impressions) i, sum(position_weighted) pw
    from gsc_daily_query_page where date between p_start and p_end group by query),
  prev as (
    select query, sum(clicks) c, sum(impressions) i, sum(position_weighted) pw
    from gsc_daily_query_page where date between p_prev_start and p_prev_end group by query),
  tp as (
    select distinct on (query) query, page from (
      select query, page, sum(impressions) i from gsc_daily_query_page
      where date between p_start and p_end group by query, page) x
    order by query, i desc)
  select cur.query, cur.b, cur.c, cur.i,
    case when cur.i > 0 then round(cur.c::numeric / cur.i, 4) end,
    case when cur.i > 0 then round(cur.pw / cur.i, 2) end,
    prev.c, prev.i, case when prev.i > 0 then round(prev.pw / prev.i, 2) end,
    tp.page
  from cur left join prev using (query) left join tp using (query)
  order by cur.i desc
  limit p_limit
$$;

create or replace function public.rpc_gsc_pages(p_start date, p_end date, p_prev_start date, p_prev_end date)
returns table (page text, clicks bigint, impressions bigint, ctr numeric, avg_position numeric,
               prev_clicks bigint, prev_impressions bigint, queries bigint)
language sql stable set search_path = public as $$
  with cur as (
    select page, sum(clicks) c, sum(impressions) i, sum(position_weighted) pw, count(distinct query) q
    from gsc_daily_query_page where date between p_start and p_end group by page),
  prev as (
    select page, sum(clicks) c, sum(impressions) i
    from gsc_daily_query_page where date between p_prev_start and p_prev_end group by page)
  select cur.page, cur.c, cur.i,
    case when cur.i > 0 then round(cur.c::numeric / cur.i, 4) end,
    case when cur.i > 0 then round(cur.pw / cur.i, 2) end,
    prev.c, prev.i, cur.q
  from cur left join prev using (page) order by cur.i desc
$$;

-- GA4 acquisition
create or replace function public.rpc_ga4_acquisition(p_start date, p_end date)
returns table (channel_group text, source text, medium text, campaign text,
               sessions bigint, engaged_sessions bigint, users bigint, new_users bigint,
               page_views bigint, engagement_seconds numeric, key_events numeric)
language sql stable set search_path = public as $$
  select channel_group, source, medium, campaign,
    sum(sessions), sum(engaged_sessions), sum(total_users), sum(new_users),
    sum(page_views), sum(engagement_seconds), sum(key_events)
  from ga4_daily_traffic where date between p_start and p_end
  group by 1,2,3,4 order by 5 desc
$$;

create or replace function public.rpc_ga4_devices(p_start date, p_end date)
returns table (device text, sessions bigint, engaged_sessions bigint, users bigint, key_events numeric)
language sql stable set search_path = public as $$
  select device, sum(sessions), sum(engaged_sessions), sum(total_users), sum(key_events)
  from ga4_daily_traffic where date between p_start and p_end group by 1 order by 2 desc
$$;

create or replace function public.rpc_ga4_landing(p_start date, p_end date, p_prev_start date, p_prev_end date)
returns table (landing_page text, sessions bigint, engaged_sessions bigint, users bigint, key_events numeric,
               prev_sessions bigint, prev_key_events numeric)
language sql stable set search_path = public as $$
  with cur as (select landing_page, sum(sessions) s, sum(engaged_sessions) e, sum(total_users) u, sum(key_events) k
               from ga4_daily_landing where date between p_start and p_end group by 1),
  prev as (select landing_page, sum(sessions) s, sum(key_events) k
           from ga4_daily_landing where date between p_prev_start and p_prev_end group by 1)
  select cur.landing_page, cur.s, cur.e, cur.u, cur.k, prev.s, prev.k
  from cur left join prev using (landing_page) order by cur.s desc
$$;

create or replace function public.rpc_ga4_events(p_start date, p_end date)
returns table (event_name text, channel_group text, source text, medium text, campaign text, page_path text, event_count bigint)
language sql stable set search_path = public as $$
  select event_name, channel_group, source, medium, campaign, page_path, sum(event_count)
  from ga4_daily_events where date between p_start and p_end group by 1,2,3,4,5,6 order by 7 desc
$$;

-- Google Ads
create or replace function public.rpc_ads_campaigns(p_start date, p_end date)
returns table (campaign_id text, campaign_name text, campaign_status text, impressions bigint, clicks bigint,
               cost numeric, conversions numeric, conversion_value numeric)
language sql stable set search_path = public as $$
  select campaign_id, max(campaign_name), max(campaign_status), sum(impressions), sum(clicks),
    round(sum(cost_micros)/1e6, 2), sum(conversions), sum(conversion_value)
  from ads_daily_campaign where device='ALL' and date between p_start and p_end
  group by 1 order by 6 desc
$$;

create or replace function public.rpc_ads_devices(p_start date, p_end date)
returns table (device text, impressions bigint, clicks bigint, cost numeric, conversions numeric)
language sql stable set search_path = public as $$
  select device, sum(impressions), sum(clicks), round(sum(cost_micros)/1e6, 2), sum(conversions)
  from ads_daily_campaign where device <> 'ALL' and date between p_start and p_end group by 1 order by 4 desc
$$;

create or replace function public.rpc_ads_search_terms(p_start date, p_end date, p_limit int default 500)
returns table (search_term text, campaign_id text, impressions bigint, clicks bigint, cost numeric, conversions numeric)
language sql stable set search_path = public as $$
  select search_term, max(campaign_id), sum(impressions), sum(clicks), round(sum(cost_micros)/1e6, 2), sum(conversions)
  from ads_daily_search_term where date between p_start and p_end group by 1 order by 5 desc limit p_limit
$$;

create or replace function public.rpc_ads_keywords(p_start date, p_end date)
returns table (keyword text, match_type text, ad_group_id text, impressions bigint, clicks bigint, cost numeric, conversions numeric)
language sql stable set search_path = public as $$
  select keyword, match_type, ad_group_id, sum(impressions), sum(clicks), round(sum(cost_micros)/1e6, 2), sum(conversions)
  from ads_daily_keyword where date between p_start and p_end group by 1,2,3 order by 6 desc
$$;

create or replace function public.rpc_ads_landing(p_start date, p_end date)
returns table (landing_page text, impressions bigint, clicks bigint, cost numeric, conversions numeric)
language sql stable set search_path = public as $$
  select landing_page, sum(impressions), sum(clicks), round(sum(cost_micros)/1e6, 2), sum(conversions)
  from ads_daily_landing where date between p_start and p_end group by 1 order by 4 desc
$$;

-- GBP
create or replace function public.rpc_gbp_metrics(p_start date, p_end date)
returns table (metric text, value bigint)
language sql stable set search_path = public as $$
  select metric, sum(value) from gbp_daily_metrics where date between p_start and p_end group by 1 order by 1
$$;

-- Attribution: CRM leads by first-touch source/medium, with spend only where it is unambiguous.
-- Google Ads spend joins google/cpc; Meta spend joins facebook|instagram/paid. Never split across campaigns.
create or replace function public.rpc_attribution(p_start date, p_end date)
returns table (source text, medium text, leads bigint, qualified bigint, booked bigint,
               completed bigint, revenue numeric, spend numeric)
language sql stable set search_path = public as $$
  with lw as (
    select l.id, lower(coalesce(nullif(l.first_source,''),'(direct)')) src,
           lower(coalesce(nullif(l.first_medium,''),'(none)')) med, l.status,
           exists (select 1 from appointments a where a.lead_id = l.id and a.status <> 'cancelled') has_appt,
           exists (select 1 from appointments a where a.lead_id = l.id and a.status = 'completed') has_done,
           (select coalesce(sum(r.amount_inr),0) from revenue_entries r where r.lead_id = l.id) rev
    from leads l
    where not l.is_test and (l.first_inquiry_at at time zone 'Asia/Kolkata')::date between p_start and p_end),
  agg as (
    select src, med, count(*) n,
      count(*) filter (where status in ('qualified','appointment_booked','completed')) q,
      count(*) filter (where status in ('appointment_booked','completed') or has_appt) bk,
      count(*) filter (where status = 'completed' or has_done) dn,
      sum(rev) rev
    from lw group by src, med),
  gspend as (select round(sum(cost_micros)/1e6, 2) s from ads_daily_campaign
             where device='ALL' and date between p_start and p_end),
  mspend as (select sum(spend) s from meta_daily_ad where date between p_start and p_end)
  select src, med, n, q, bk, dn, rev,
    case when src = 'google' and med in ('cpc','ppc','paid') then (select s from gspend)
         when src in ('facebook','instagram','meta','fb','ig') and med in ('paid','cpc','paid_social') then (select s from mspend)
    end
  from agg order by n desc
$$;

create or replace function public.rpc_attribution_campaigns(p_start date, p_end date)
returns table (source text, medium text, campaign text, term text, landing_page text, leads bigint, booked bigint, completed bigint, revenue numeric)
language sql stable set search_path = public as $$
  select lower(coalesce(nullif(first_source,''),'(direct)')), lower(coalesce(nullif(first_medium,''),'(none)')),
    coalesce(nullif(first_campaign,''),'(not set)'), coalesce(nullif(first_term,''),'(not set)'),
    coalesce(nullif(first_landing_page,''),'(not set)'),
    count(*),
    count(*) filter (where status in ('appointment_booked','completed') or exists (select 1 from appointments a where a.lead_id = l.id and a.status <> 'cancelled')),
    count(*) filter (where status = 'completed' or exists (select 1 from appointments a where a.lead_id = l.id and a.status = 'completed')),
    sum((select coalesce(sum(r.amount_inr),0) from revenue_entries r where r.lead_id = l.id))
  from leads l
  where not is_test and (first_inquiry_at at time zone 'Asia/Kolkata')::date between p_start and p_end
  group by 1,2,3,4,5 order by 6 desc
$$;

-- Funnel counts for a range: kept separate per system, never summed together.
create or replace function public.rpc_funnel(p_start date, p_end date)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'ga4_book_clicks', (select coalesce(sum(event_count),0) from ga4_daily_events where event_name='book_appointment_click' and date between p_start and p_end),
    'ga4_phone_clicks', (select coalesce(sum(event_count),0) from ga4_daily_events where event_name='phone_call_click' and date between p_start and p_end),
    'ga4_whatsapp_clicks', (select coalesce(sum(event_count),0) from ga4_daily_events where event_name in ('whatsapp_click','joinchat') and date between p_start and p_end),
    'ga4_directions_clicks', (select coalesce(sum(event_count),0) from ga4_daily_events where event_name='directions_click' and date between p_start and p_end),
    'ga4_email_clicks', (select coalesce(sum(event_count),0) from ga4_daily_events where event_name='email_click' and date between p_start and p_end),
    'ga4_video_consult', (select coalesce(sum(event_count),0) from ga4_daily_events where event_name in ('video_consult_request','video_consult_form_submit') and date between p_start and p_end),
    'ga4_bookings_confirmed', (select coalesce(sum(event_count),0) from ga4_daily_events where event_name='appointment_confirmed' and date between p_start and p_end),
    'ads_conversions', (select coalesce(sum(conversions),0) from ads_daily_campaign where device='ALL' and date between p_start and p_end),
    'crm_leads', (select count(*) from leads where not is_test and (first_inquiry_at at time zone 'Asia/Kolkata')::date between p_start and p_end),
    'crm_qualified', (select count(*) from leads where not is_test and status in ('qualified','appointment_booked','completed') and (first_inquiry_at at time zone 'Asia/Kolkata')::date between p_start and p_end),
    'crm_booked', (select count(*) from real_appointments where status <> 'cancelled' and (booked_at at time zone 'Asia/Kolkata')::date between p_start and p_end),
    'crm_completed', (select count(*) from real_appointments where status = 'completed' and (booked_at at time zone 'Asia/Kolkata')::date between p_start and p_end),
    'revenue', (select coalesce(sum(amount_inr),0) from real_revenue where collected_on between p_start and p_end),
    'manual_calls', (select coalesce(sum(value),0) from manual_daily_counts where metric='calls_answered' and date between p_start and p_end)
  )
$$;

-- Earliest date with any data, for "All available time"
create or replace function public.rpc_data_bounds()
returns table (earliest date, latest date) language sql stable set search_path = public as $$
  select least(
      (select min(date) from gsc_daily_totals), (select min(date) from ga4_daily_traffic),
      (select min(date) from gbp_daily_metrics), (select min(date) from ads_daily_campaign),
      (select min(date) from meta_daily_ad), (select min((first_inquiry_at at time zone 'Asia/Kolkata')::date) from leads)),
    greatest(
      (select max(date) from gsc_daily_totals), (select max(date) from ga4_daily_traffic),
      (select max(date) from gbp_daily_metrics), (select max(date) from ads_daily_campaign),
      (select max(date) from meta_daily_ad), (select max((first_inquiry_at at time zone 'Asia/Kolkata')::date) from leads))
$$;

grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema public from anon;
