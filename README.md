# Elites Dental Care — Marketing Intelligence Dashboard

One place for discovery → visits → leads → bookings → revenue for Elites Dental Care (TC Palya, Bengaluru).

**Stack:** React + Vite (static, hosted on Vercel) · Supabase (Postgres + RLS, Auth, Edge Functions, pg_cron) · Google APIs (GA4 Data, Search Console, Business Profile Performance, Google Ads) · Microsoft Clarity Data Export · Meta Marketing API (ready, awaiting access).

```
web/                      Dashboard (React). Publishable Supabase key only.
supabase/migrations/      Schema, RLS, reporting RPCs, cron schedules
supabase/functions/
  sync/                   Pulls each source (incremental, backfill, manual). Auth: cron secret or editor JWT
  google-oauth/           One Google consent → refresh token stored server-side
  credentials/            Owner-only: save Clarity / Meta tokens
  lead-ingest/            HMAC-signed webhook from WordPress (forms + Click4Appointment bookings)
  _shared/                Source connectors, sync planning, lead normalisation
wordpress/                WPCode snippets (attribution cookie + server-side lead relay). Not installed yet.
tests/                    PGlite migration/RLS tests + sync/lead unit tests
```

## Where things live
- Supabase project: `pymwnsjjztahucqzlqkl` (ap-south-1, free tier) — https://pymwnsjjztahucqzlqkl.supabase.co
- Secrets: `private.credentials` (not exposed via the API) and Edge Function env vars. Nothing secret is in this repo or the browser bundle.

## Edge Function secrets to set (Supabase → Edge Functions → Secrets)
| Name | What |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client (Web application). Redirect URI: `https://pymwnsjjztahucqzlqkl.supabase.co/functions/v1/google-oauth` |
| `APP_URL` | Live dashboard URL (where Google sends you back) |
| `APP_ORIGIN` | Same origin, to lock CORS |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Once Basic access is approved |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Only if access is via a manager (MCC) account |

## Data rules
- Dates are IST. Ranges are inclusive.
- Missing inputs show **Not available**, never 0. ROAS needs real revenue and real spend for the same channel.
- GA4 conversions, Google Ads conversions and CRM bookings are shown side by side, never summed.
- Test leads (`is_test`) and their appointments/revenue are excluded everywhere.
- Every metric's formula is on Settings → Metric definitions (`web/src/lib/metrics.ts`).

## Run / test
```bash
cd web && npm i && npm run dev          # local
cd web && npx vitest run                 # date, metric, insight, CSV tests
cd tests && npm i && node db.test.mjs    # migrations + RLS + RPCs on PGlite
cd tests && npx tsx logic.test.ts        # sync windows + lead normalisation
```

## Deploy (Vercel)
Import this repo in Vercel → Root directory `web` → Framework Vite. No env vars needed (publishable key has a default; override with `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` if the project changes). Then in Supabase → Authentication → URL Configuration set **Site URL** to the Vercel URL so sign-in links return there.
