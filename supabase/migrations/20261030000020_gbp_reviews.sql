-- Business Profile reviews (My Business API v4). Reviewer names and photos are not stored:
-- only the star rating, the review text, dates and the owner's reply.
create table if not exists public.gbp_reviews (
  review_id    text primary key,
  star         smallint not null check (star between 1 and 5),
  comment      text,
  created_at   timestamptz not null,
  updated_at   timestamptz,
  reply        text,
  reply_at     timestamptz,
  synced_at    timestamptz not null default now()
);
create index if not exists gbp_reviews_created on public.gbp_reviews (created_at desc);

-- Google's own headline numbers, one row per sync day.
create table if not exists public.gbp_review_snapshot (
  date            date primary key,
  average_rating  numeric(3,2),
  total_reviews   integer,
  review_parent   text,
  last_error      text
);

alter table public.gbp_reviews enable row level security;
alter table public.gbp_review_snapshot enable row level security;
create policy member_read on public.gbp_reviews for select to authenticated using ((select public.is_member()));
create policy member_read on public.gbp_review_snapshot for select to authenticated using ((select public.is_member()));
revoke all on public.gbp_reviews, public.gbp_review_snapshot from anon;

-- Aggregates for the Business Profile page. p_themes: [{"label":"Staff","re":"staff|team|friendly"}, ...]
create or replace function public.rpc_gbp_reviews(p_start date, p_end date, p_themes jsonb default '[]'::jsonb)
returns jsonb language sql stable set search_path = public as $$
  with s as (select * from gbp_review_snapshot order by date desc limit 1),
  p as (
    select * from gbp_reviews
    where (created_at at time zone 'Asia/Kolkata')::date between p_start and p_end
  ),
  pv as (
    select * from gbp_reviews
    where (created_at at time zone 'Asia/Kolkata')::date between p_start - (p_end - p_start + 1) and p_start - 1
  ),
  tot as (
    select count(*) n, round(avg(star)::numeric, 2) avg,
      count(*) filter (where star >= 4) good, count(*) filter (where star = 3) neutral, count(*) filter (where star <= 2) bad,
      count(*) filter (where reply is not null) replied,
      count(*) filter (where star <= 2 and reply is null) bad_unreplied,
      count(*) filter (where coalesce(btrim(comment), '') <> '') with_text,
      percentile_cont(0.5) within group (order by extract(epoch from (reply_at - created_at)) / 3600)
        filter (where reply_at is not null and reply_at >= created_at) median_reply_h
    from p
  ),
  ptot as (select count(*) n, round(avg(star)::numeric, 2) avg, count(*) filter (where star <= 2) bad from pv),
  allt as (select count(*) n, round(avg(star)::numeric, 2) avg, min(created_at) first_at from gbp_reviews),
  dist as (
    select jsonb_agg(jsonb_build_object('star', g, 'n', coalesce(n, 0), 'all', coalesce(a, 0)) order by g desc) j
    from generate_series(1, 5) g
    left join (select star, count(*) n from p group by 1) x on x.star = g
    left join (select star, count(*) a from gbp_reviews group by 1) y on y.star = g
  ),
  mon as (
    select jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'n', coalesce(n, 0), 'avg', avg, 'good', coalesce(good, 0),
      'neutral', coalesce(neutral, 0), 'bad', coalesce(bad, 0), 'replied', coalesce(replied, 0)) order by m) j
    from generate_series(date_trunc('month', p_end::timestamp) - interval '17 months', date_trunc('month', p_end::timestamp), interval '1 month') m
    left join (
      select date_trunc('month', created_at at time zone 'Asia/Kolkata') mm, count(*) n, round(avg(star)::numeric, 2) avg,
        count(*) filter (where star >= 4) good, count(*) filter (where star = 3) neutral, count(*) filter (where star <= 2) bad,
        count(*) filter (where reply is not null) replied
      from gbp_reviews group by 1
    ) r on r.mm = m
  ),
  dow as (
    select jsonb_agg(jsonb_build_object('dow', d, 'n', coalesce(n, 0), 'avg', avg) order by d) j
    from generate_series(1, 7) d
    left join (select extract(isodow from created_at at time zone 'Asia/Kolkata')::int dd, count(*) n, round(avg(star)::numeric, 2) avg from p group by 1) x on x.dd = d
  ),
  th as (
    select jsonb_agg(jsonb_build_object('label', t->>'label',
      'good', (select count(*) from p where star >= 4 and comment ~* (t->>'re')),
      'bad', (select count(*) from p where star <= 2 and comment ~* (t->>'re')),
      'all', (select count(*) from p where comment ~* (t->>'re')),
      'avg', (select round(avg(star)::numeric, 2) from p where comment ~* (t->>'re'))) order by ord) j
    from jsonb_array_elements(p_themes) with ordinality as e(t, ord)
  )
  select jsonb_build_object(
    'google', (select jsonb_build_object('average_rating', average_rating, 'total_reviews', total_reviews, 'date', date, 'error', last_error) from s),
    'period', (select to_jsonb(tot) from tot),
    'prev', (select to_jsonb(ptot) from ptot),
    'all_time', (select to_jsonb(allt) from allt),
    'stars', (select j from dist),
    'monthly', (select j from mon),
    'weekday', (select j from dow),
    'themes', coalesce((select j from th), '[]'::jsonb)
  )
$$;

-- Review list with filters (newest first).
create or replace function public.rpc_gbp_review_list(p_start date, p_end date, p_stars int[] default null,
  p_replied boolean default null, p_q text default null, p_limit int default 100, p_offset int default 0)
returns table (review_id text, star smallint, comment text, created_at timestamptz, reply text, reply_at timestamptz, total bigint)
language sql stable set search_path = public as $$
  select review_id, star, comment, created_at, reply, reply_at, count(*) over () total
  from gbp_reviews
  where (created_at at time zone 'Asia/Kolkata')::date between p_start and p_end
    and (p_stars is null or star = any(p_stars))
    and (p_replied is null or (reply is not null) = p_replied)
    and (p_q is null or p_q = '' or comment ilike '%' || p_q || '%' or reply ilike '%' || p_q || '%')
  order by created_at desc
  limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)
$$;

-- Search terms: per keyword across the months in range, with month-on-month trend.
create or replace function public.rpc_gbp_keywords(p_start date, p_end date)
returns jsonb language sql stable set search_path = public as $$
  with inrange as (
    select * from gbp_monthly_keywords where month between date_trunc('month', p_start)::date and p_end
  ),
  -- Google publishes a month's terms after it ends; for short or current ranges fall back to the latest full month.
  fb as (select max(month) m from gbp_monthly_keywords where month <= p_end),
  k as (
    select * from inrange
    union all
    select g.* from gbp_monthly_keywords g where not exists (select 1 from inrange) and g.month = (select m from fb)
  ),
  agg as (
    select keyword, sum(impressions) impressions, count(*) months, count(*) filter (where impressions is null) thresholded
    from k group by 1
  ),
  lm as (select max(month) m from k),
  last2 as (
    select g.keyword,
      sum(g.impressions) filter (where g.month = (select m from lm)) last_m,
      sum(g.impressions) filter (where g.month = ((select m from lm) - interval '1 month')::date) prev_m
    from gbp_monthly_keywords g
    where g.month in ((select m from lm), ((select m from lm) - interval '1 month')::date)
    group by 1
  ),
  bymonth as (
    select jsonb_agg(jsonb_build_object('month', to_char(month, 'YYYY-MM'), 'impressions', imp, 'terms', terms) order by month) j
    from (select month, sum(impressions) imp, count(*) terms from k group by 1) x
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('keyword', a.keyword, 'impressions', a.impressions, 'months', a.months,
       'thresholded', a.thresholded, 'last_m', l.last_m, 'prev_m', l.prev_m) order by a.impressions desc nulls last)
       from agg a left join last2 l using (keyword)), '[]'::jsonb),
    'monthly', coalesce((select j from bymonth), '[]'::jsonb),
    'last_month', (select to_char(m, 'YYYY-MM') from lm),
    'fallback', not exists (select 1 from inrange)
  )
$$;

grant execute on function public.rpc_gbp_reviews(date, date, jsonb), public.rpc_gbp_review_list(date, date, int[], boolean, text, int, int),
  public.rpc_gbp_keywords(date, date) to authenticated;
