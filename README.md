# Elites Dental Care — Marketing Intelligence Dashboard & CRM

Live: **https://elites-marketing-dashboard.vercel.app** (sign-in required)

One place for the whole patient journey at Elites Dental Care, TC Palya, Bengaluru: seen on Google → website visit → enquiry → appointment → payment. Built and run by Danny (performance marketing), Oct 2026.

## What's built

| Area | Page | What it does |
|---|---|---|
| Overview | `#/` | Headline numbers, trends, top findings |
| **Funnel Analytics** | `#/funnel` | Interactive funnel diagram, drop-off per step, by-channel results, drill-downs to campaigns, landing pages and leads |
| **Budget Simulator** | `#/budget` | Projects patients, revenue and cost per patient for any Google Ads budget from the clinic's own rates; assumptions editable |
| **AI Intelligence** | `#/ai` | Written briefing, health scores, 30-day forecast, what changed, unusual days, prioritised actions (statistics + rules, no LLM) |
| Insights | `#/insights` | Rule-based findings with evidence and suggested actions |
| SEO · AEO · GEO | `#/seo`, `?tab=aeo`, `?tab=geo` | Search Console; answer-engine readiness; AI-assistant visits and crawler access; live site check |
| Business Profile | `#/gbp` | Views, calls, directions, search terms (awaiting Google API approval) |
| Website | `#/website` | GA4 traffic, lead actions, landing pages + Microsoft Clarity behaviour |
| Paid ads | `#/paid`, `?tab=ads` | Google Ads performance; **Ad Library** with reconstructed mobile/desktop previews and per-ad results |
| **Leads & CRM** | `#/crm` | Every enquiry with first-touch source; website forms and bookings arrive automatically; calls/WhatsApp/walk-ins added by staff; status, follow-ups, appointments, notes |
| Revenue | `#/revenue` | Single entry or Excel/CSV upload, matched to leads by phone/email (not stored), revenue by channel and service, undo per upload |
| Attribution | `#/attribution` | Leads, bookings, revenue and spend by first-touch source/campaign |
| Partnerships | `#/partnerships` | Agent that finds, audits and scores local partners (schools, workplaces, gyms, pharmacies, labs) from Overture Maps open data; review status per place; run history |
| Integrations · Settings | `#/integrations`, `#/settings` | Source status, coverage, sync log; users and roles |

## Stack
React + Vite + TypeScript (Vercel) · Supabase (Postgres + RLS, Auth magic link, Edge Functions, pg_cron) · Google APIs (GA4 Data, Search Console, Business Profile Performance, Google Ads v26) · Microsoft Clarity Data Export · Overture Maps (DuckDB) · Meta Marketing API (ready, awaiting access).

```
web/                      Dashboard (React). Publishable Supabase key only.
supabase/migrations/      Schema, RLS, reporting RPCs, cron, ad library, revenue, partnerships
supabase/functions/
  sync/                   Pulls each source (incremental, backfill, manual). Auth: cron secret or editor JWT
  google-oauth/           One Google consent → refresh token stored server-side
  credentials/            Owner-only: save Clarity / Meta tokens
  lead-ingest/            HMAC-signed webhook from WordPress (forms + Click4Appointment bookings)
  partners-ingest/        Partnerships agent ingest (secret in private.credentials)
  site-check/             Live read of elitesdental.com for AEO/GEO (robots, schema, headings)
  _shared/                Source connectors, sync planning, helpers
agents/partners/          Overture fetcher for the partnerships agent
wordpress/                WPCode snippets: attribution cookie + server-side lead relay
tests/                    PGlite migration/RLS/RPC tests
```

## Where things live
- Supabase project `pymwnsjjztahucqzlqkl` (ap-south-1, free tier).
- Secrets live in `private.credentials` (not reachable through the API) and Edge Function env. **Nothing secret is in this repo or the browser bundle.**
- Daily syncs 06:00–08:00 IST via pg_cron.

## Data rules
- Dates are IST; ranges inclusive.
- Missing inputs show **Not available**, never 0. Assumptions are labelled.
- GA4 events, Google Ads conversions and CRM bookings are shown side by side, never summed.
- Test leads (`is_test`) and their appointments/revenue are excluded everywhere.
- No clinical notes or ID numbers stored. Phone/email in revenue uploads are used only for matching.

## Run, test, deploy
```bash
cd web && npm ci && npm run dev          # local dashboard
cd web && npx vitest run                 # frontend logic tests
cd tests && npm ci && node db.test.mjs   # all migrations + RLS + RPCs on PGlite
cd web && npx vercel --prod              # deploy (or push to main once Vercel Git is connected)
```
Database changes: add a new file in `supabase/migrations/` (idempotent, add-only) and run it in the Supabase SQL editor. Edge Functions deploy with the Supabase CLI or MCP.

## Change log
- **20 Oct 2026** — Dashboard live: GA4, Search Console, Google Ads with full history; website leads into CRM; roles and sign-in. Ad Library.
- **21 Oct 2026** — Clarity connected; Revenue uploads; AEO/GEO tabs with live site check; Partnerships agent.
- **23 Oct 2026** — Funnel Analytics, Budget Simulator, AI Intelligence.
