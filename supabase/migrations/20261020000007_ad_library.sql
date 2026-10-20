-- Google Ads Visual Ad Library: creatives, per-ad daily metrics and linked assets.
-- Written only by the sync Edge Function (service role); members read through RLS.

-- One row per ad in an ad group (current state as reported by the API at last sync).
create table if not exists public.ads_ads (
  ad_group_id text not null,
  ad_id text not null,
  campaign_id text not null,
  campaign_name text,
  campaign_status text,           -- ENABLED | PAUSED | REMOVED
  campaign_serving_status text,   -- SERVING | ENDED | PENDING | SUSPENDED | NONE
  campaign_channel text,          -- SEARCH | DISPLAY | PERFORMANCE_MAX ...
  ad_group_name text,
  ad_group_status text,
  ad_type text,                   -- RESPONSIVE_SEARCH_AD | RESPONSIVE_DISPLAY_AD | ...
  ad_name text,
  ad_status text,                 -- ENABLED | PAUSED | REMOVED
  approval_status text,           -- APPROVED | APPROVED_LIMITED | DISAPPROVED | AREA_OF_INTEREST_ONLY | UNKNOWN
  review_status text,             -- REVIEWED | REVIEW_IN_PROGRESS | ELIGIBLE_MAY_SERVE ...
  policy_topics jsonb,            -- [{topic,type}]
  ad_strength text,               -- EXCELLENT | GOOD | AVERAGE | POOR | PENDING | UNSPECIFIED
  headlines jsonb,                -- [{text,pinned,label,approval}]
  descriptions jsonb,             -- [{text,pinned,label,approval}]
  long_headline text,
  business_name text,
  path1 text,
  path2 text,
  final_urls jsonb,
  final_mobile_urls jsonb,
  display_url text,
  image_assets jsonb,             -- asset resource names referenced by the ad (display/demand gen)
  logo_assets jsonb,
  video_assets jsonb,
  synced_at timestamptz not null default now(),
  primary key (ad_group_id, ad_id)
);

-- Daily metrics per ad.
create table if not exists public.ads_daily_ad (
  date date not null,
  ad_group_id text not null,
  ad_id text not null,
  campaign_id text not null,
  impressions integer not null default 0,
  clicks integer not null default 0,
  cost_micros bigint not null default 0,
  conversions numeric not null default 0,
  conversion_value numeric not null default 0,
  primary key (date, ad_group_id, ad_id)
);
create index if not exists ads_daily_ad_ad_idx on public.ads_daily_ad (ad_id, date);

-- Assets linked at account, campaign or ad group level (sitelinks, callouts, business name, logo, images, calls...).
create table if not exists public.ads_assets (
  level text not null check (level in ('customer','campaign','ad_group')),
  owner_id text not null,         -- customer id, campaign id or ad group id
  asset_id text not null,
  field_type text not null,       -- SITELINK | CALLOUT | BUSINESS_NAME | BUSINESS_LOGO | AD_IMAGE | CALL | ...
  asset_type text,                -- TEXT | IMAGE | SITELINK | CALLOUT | CALL | YOUTUBE_VIDEO | ...
  asset_name text,
  text_value text,
  image_url text,
  image_width integer,
  image_height integer,
  youtube_id text,
  youtube_title text,
  link_text text,
  description1 text,
  description2 text,
  final_urls jsonb,
  phone text,
  snippet_header text,
  snippet_values jsonb,
  link_status text,               -- ENABLED | PAUSED | REMOVED (the link, not the asset)
  approval_status text,
  synced_at timestamptz not null default now(),
  primary key (level, owner_id, asset_id, field_type)
);

-- Search terms: keep which match types triggered them (comma list), without changing the key.
alter table public.ads_daily_search_term add column if not exists match_types text;

do $$
declare t text;
begin
  foreach t in array array['ads_ads','ads_daily_ad','ads_assets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists member_read on public.%I', t);
    execute format('create policy member_read on public.%I for select to authenticated using ((select public.is_member()))', t);
  end loop;
end $$;

-- Ad list with metrics for a date range. Ratios are left to the client and always
-- computed from these totals (never averaged across ads).
create or replace function public.rpc_ads_ad_library(p_start date, p_end date)
returns table (
  ad_group_id text, ad_id text, campaign_id text, campaign_name text, campaign_status text,
  campaign_serving_status text, campaign_channel text, ad_group_name text, ad_group_status text,
  ad_type text, ad_name text, ad_status text, approval_status text, review_status text,
  policy_topics jsonb, ad_strength text, headlines jsonb, descriptions jsonb, long_headline text,
  business_name text, path1 text, path2 text, final_urls jsonb, final_mobile_urls jsonb, display_url text,
  image_assets jsonb, logo_assets jsonb, video_assets jsonb, synced_at timestamptz,
  impressions bigint, clicks bigint, cost numeric, conversions numeric, conversion_value numeric,
  has_rows boolean, first_served date, last_served date
)
language sql stable set search_path = public as $$
  with m as (
    select ad_group_id, ad_id, sum(impressions) imp, sum(clicks) clk, round(sum(cost_micros)/1e6, 2) cost,
           sum(conversions) conv, sum(conversion_value) val, count(*) n
    from ads_daily_ad where date between p_start and p_end group by 1, 2
  ), life as (
    select ad_group_id, ad_id, min(date) filter (where impressions > 0) f, max(date) filter (where impressions > 0) l
    from ads_daily_ad group by 1, 2
  )
  select a.ad_group_id, a.ad_id, a.campaign_id, a.campaign_name, a.campaign_status, a.campaign_serving_status,
         a.campaign_channel, a.ad_group_name, a.ad_group_status, a.ad_type, a.ad_name, a.ad_status,
         a.approval_status, a.review_status, a.policy_topics, a.ad_strength, a.headlines, a.descriptions,
         a.long_headline, a.business_name, a.path1, a.path2, a.final_urls, a.final_mobile_urls, a.display_url,
         a.image_assets, a.logo_assets, a.video_assets, a.synced_at,
         coalesce(m.imp, 0), coalesce(m.clk, 0), coalesce(m.cost, 0), coalesce(m.conv, 0), coalesce(m.val, 0),
         m.n is not null, life.f, life.l
  from ads_ads a
  left join m using (ad_group_id, ad_id)
  left join life using (ad_group_id, ad_id)
  order by coalesce(m.cost, 0) desc, a.campaign_name, a.ad_group_name
$$;

-- Keywords and search terms for one campaign (optionally one ad group) in a date range.
create or replace function public.rpc_ads_terms_for(p_start date, p_end date, p_campaign_id text, p_ad_group_id text default null)
returns jsonb
language sql stable set search_path = public as $$
  with groups as (
    select distinct ad_group_id from ads_ads where campaign_id = p_campaign_id
    union select distinct ad_group_id from ads_daily_ad_group where campaign_id = p_campaign_id
  )
  select jsonb_build_object(
    'keywords', coalesce((
      select jsonb_agg(k order by k.cost desc) from (
        select keyword, match_type, ad_group_id, sum(impressions) impressions, sum(clicks) clicks,
               round(sum(cost_micros)/1e6, 2) cost, sum(conversions) conversions
        from ads_daily_keyword
        where date between p_start and p_end
          and ad_group_id in (select ad_group_id from groups)
          and (p_ad_group_id is null or ad_group_id = p_ad_group_id)
        group by 1, 2, 3
      ) k), '[]'::jsonb),
    'terms', coalesce((
      select jsonb_agg(s order by s.cost desc) from (
        select search_term, string_agg(distinct nullif(match_types, ''), ',') match_types,
               sum(impressions) impressions, sum(clicks) clicks, round(sum(cost_micros)/1e6, 2) cost, sum(conversions) conversions
        from ads_daily_search_term
        where date between p_start and p_end and campaign_id = p_campaign_id
          and (p_ad_group_id is null or ad_group_id = p_ad_group_id)
        group by 1 limit 1000
      ) s), '[]'::jsonb),
    -- Clicks in the campaign that Google reports without a visible search term (privacy thresholds).
    'campaign_clicks', (select coalesce(sum(clicks), 0) from ads_daily_campaign
                        where campaign_id = p_campaign_id and device = 'ALL' and date between p_start and p_end),
    'term_clicks', (select coalesce(sum(clicks), 0) from ads_daily_search_term
                    where campaign_id = p_campaign_id and date between p_start and p_end
                      and (p_ad_group_id is null or ad_group_id = p_ad_group_id))
  )
$$;

grant execute on function public.rpc_ads_ad_library(date, date) to authenticated;
grant execute on function public.rpc_ads_terms_for(date, date, text, text) to authenticated;
