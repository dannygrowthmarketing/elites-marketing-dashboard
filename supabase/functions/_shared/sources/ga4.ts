import { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { googleAccessToken, googleJson } from "../google.ts";
import { upsertBatched } from "../util.ts";

// Events worth tracking for this site (see WPCode snippets 18950, 19055, Joinchat, Elementor forms).
export const GA4_EVENTS = [
  "appointment_confirmed", "book_appointment_click", "phone_call_click", "whatsapp_click", "directions_click",
  "email_click", "video_consult_request", "video_consult_form_submit", "psych_block_click",
  "form_start", "form_submit", "generate_lead", "joinchat", "click", "file_download",
];

const ymd = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

async function runReport(propertyId: string, token: string, body: Record<string, unknown>) {
  const rows: any[] = [];
  let offset = 0;
  const limit = 100000;
  while (true) {
    const res = await googleJson(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, token,
      { method: "POST", body: JSON.stringify({ ...body, limit, offset, keepEmptyRows: false }) },
    );
    rows.push(...(res.rows ?? []));
    const total = res.rowCount ?? 0;
    offset += limit;
    if (offset >= total) break;
  }
  return rows;
}

const dv = (r: any, i: number) => r.dimensionValues[i].value || "(not set)";
const mv = (r: any, i: number) => Number(r.metricValues[i].value || 0);

export async function syncGa4(db: SupabaseClient, propertyId: string, start: string, end: string): Promise<number> {
  const token = await googleAccessToken();
  const dateRanges = [{ startDate: start, endDate: end }];
  let n = 0;

  // 1) Traffic by channel/source/medium/campaign/device
  const traffic = await runReport(propertyId, token, {
    dateRanges,
    dimensions: ["date", "sessionDefaultChannelGroup", "sessionSource", "sessionMedium", "sessionCampaignName", "deviceCategory"]
      .map((name) => ({ name })),
    metrics: ["sessions", "engagedSessions", "totalUsers", "newUsers", "screenPageViews", "userEngagementDuration", "keyEvents"]
      .map((name) => ({ name })),
  });
  n += await upsertBatched(db, "ga4_daily_traffic", traffic.map((r) => ({
    date: ymd(r.dimensionValues[0].value), channel_group: dv(r, 1), source: dv(r, 2), medium: dv(r, 3),
    campaign: dv(r, 4), device: dv(r, 5),
    sessions: mv(r, 0), engaged_sessions: mv(r, 1), total_users: mv(r, 2), new_users: mv(r, 3),
    page_views: mv(r, 4), engagement_seconds: mv(r, 5), key_events: mv(r, 6),
  })), "date,channel_group,source,medium,campaign,device");

  // 2) Landing pages
  const landing = await runReport(propertyId, token, {
    dateRanges,
    dimensions: ["date", "landingPage", "sessionDefaultChannelGroup"].map((name) => ({ name })),
    metrics: ["sessions", "engagedSessions", "totalUsers", "keyEvents"].map((name) => ({ name })),
  });
  n += await upsertBatched(db, "ga4_daily_landing", landing.map((r) => ({
    date: ymd(r.dimensionValues[0].value), landing_page: dv(r, 1), channel_group: dv(r, 2),
    sessions: mv(r, 0), engaged_sessions: mv(r, 1), total_users: mv(r, 2), key_events: mv(r, 3),
  })), "date,landing_page,channel_group");

  // 3) Lead-related events with attribution
  const events = await runReport(propertyId, token, {
    dateRanges,
    dimensions: ["date", "eventName", "sessionDefaultChannelGroup", "sessionSource", "sessionMedium", "sessionCampaignName", "pagePath"]
      .map((name) => ({ name })),
    metrics: [{ name: "eventCount" }],
    dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: GA4_EVENTS } } },
  });
  n += await upsertBatched(db, "ga4_daily_events", events.map((r) => ({
    date: ymd(r.dimensionValues[0].value), event_name: dv(r, 1), channel_group: dv(r, 2), source: dv(r, 3),
    medium: dv(r, 4), campaign: dv(r, 5), page_path: dv(r, 6), event_count: mv(r, 0),
  })), "date,event_name,channel_group,source,medium,campaign,page_path");

  // 4) Geography
  const geo = await runReport(propertyId, token, {
    dateRanges,
    dimensions: ["date", "country", "city"].map((name) => ({ name })),
    metrics: ["sessions", "totalUsers"].map((name) => ({ name })),
  });
  n += await upsertBatched(db, "ga4_daily_geo", geo.map((r) => ({
    date: ymd(r.dimensionValues[0].value), country: dv(r, 1), city: dv(r, 2), sessions: mv(r, 0), total_users: mv(r, 1),
  })), "date,country,city");

  return n;
}
