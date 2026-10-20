import { describe, expect, it } from "vitest";
import { autoGrain, bucketKey, compareRange, daysBetween, isIncomplete, presetRange, todayLocal, addMonths } from "./dates";
import { cpm, ctr, fmt, pctChange, ratio, roas, sum, weightedPosition } from "./metrics";
import { buildInsights, expectedCtr, type InsightInput } from "./insights";
import { toCsv } from "./csv";

const T = "2026-10-20"; // Tuesday

describe("date presets", () => {
  it("covers every preset correctly", () => {
    expect(presetRange("today", T)).toEqual({ start: T, end: T });
    expect(presetRange("yesterday", T)).toEqual({ start: "2026-10-19", end: "2026-10-19" });
    expect(presetRange("last7", T)).toEqual({ start: "2026-10-14", end: T });
    expect(presetRange("last30", T)).toEqual({ start: "2026-09-21", end: T });
    expect(presetRange("thisWeek", T)).toEqual({ start: "2026-10-19", end: T });
    expect(presetRange("lastWeek", T)).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(presetRange("thisMonth", T)).toEqual({ start: "2026-10-01", end: T });
    expect(presetRange("lastMonth", T)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(presetRange("thisQuarter", T)).toEqual({ start: "2026-10-01", end: T });
    expect(presetRange("lastQuarter", T)).toEqual({ start: "2026-07-01", end: "2026-09-30" });
    expect(presetRange("thisYear", T)).toEqual({ start: "2026-01-01", end: T });
    expect(presetRange("lastYear", T)).toEqual({ start: "2025-01-01", end: "2025-12-31" });
    expect(presetRange("all", T, "2019-02-01")).toEqual({ start: "2019-02-01", end: T });
  });
  it("handles month-end and leap years", () => {
    expect(presetRange("lastMonth", "2026-03-31")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(presetRange("lastMonth", "2028-03-15")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(presetRange("lastQuarter", "2026-02-10")).toEqual({ start: "2025-10-01", end: "2025-12-31" });
    expect(presetRange("lastWeek", "2026-10-19")).toEqual({ start: "2026-10-12", end: "2026-10-18" }); // Monday
  });
  it("builds comparison windows", () => {
    expect(compareRange({ start: "2026-10-14", end: T }, "previous")).toEqual({ start: "2026-10-07", end: "2026-10-13" });
    expect(compareRange({ start: "2026-09-01", end: "2026-09-30" }, "previous")).toEqual({ start: "2026-08-02", end: "2026-08-31" });
    expect(compareRange({ start: "2026-10-01", end: T }, "yoy")).toEqual({ start: "2025-10-01", end: "2025-10-20" });
    expect(compareRange({ start: T, end: T }, "none")).toBeNull();
  });
  it("knows incomplete periods, grains and buckets", () => {
    expect(isIncomplete({ start: "2026-10-01", end: T }, T)).toBe(true);
    expect(isIncomplete({ start: "2026-09-01", end: "2026-09-30" }, T)).toBe(false);
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(31);
    expect(autoGrain({ start: "2026-10-01", end: "2026-10-31" })).toBe("day");
    expect(autoGrain({ start: "2026-01-01", end: "2026-10-31" })).toBe("month");
    expect(bucketKey("2026-10-22", "week")).toBe("2026-10-19");
    expect(bucketKey("2026-11-22", "quarter")).toBe("2026-10-01");
  });
  it("uses IST, not UTC, for today", () => {
    expect(todayLocal(new Date("2026-10-19T19:00:00Z"))).toBe("2026-10-20"); // 00:30 IST
    expect(todayLocal(new Date("2026-10-19T18:00:00Z"))).toBe("2026-10-19"); // 23:30 IST
  });
});

describe("metrics", () => {
  it("returns null instead of fake zeros", () => {
    expect(ratio(5, 0)).toBeNull();
    expect(ctr(null, 100)).toBeNull();
    expect(roas(null, 1000)).toBeNull();
    expect(roas(5000, 0)).toBeNull();
    expect(roas(0, 1000)).toBe(0);
    expect(pctChange(10, 0)).toBeNull();
    expect(sum([{ v: null }, { v: undefined }], (r) => r.v)).toBeNull();
  });
  it("calculates correctly", () => {
    expect(ctr(7, 100)).toBeCloseTo(0.07);
    expect(cpm(500, 2000)).toBe(250);
    expect(pctChange(120, 100)).toBeCloseTo(0.2);
    expect(pctChange(80, 100)).toBeCloseTo(-0.2);
    expect(weightedPosition([{ impressions: 100, position: 2 }, { impressions: 300, position: 6 }])).toBe(5);
    expect(fmt.delta(-0.123)).toBe("−12.3%");
    expect(fmt.pct(null)).toBe("—");
    expect(fmt.compact(4000)).toBe("4K");
    expect(fmt.compact(350000)).toBe("3.5L");
    expect(fmt.compact(27054)).toBe("27.1K");
    expect(fmt.compact(950)).toBe("950");
  });
});

describe("insights", () => {
  const base: InsightInput = {
    periodLabel: "Last 30 days", compareLabel: "previous 30 days", queries: [], landing: [], campaigns: [], prevCampaigns: [],
    days: [], prevDays: [], integrations: [], attribution: [], funnel: null, ga4KeyEventsTotal: null, now: new Date("2026-10-20T06:00:00Z"),
  };
  it("expected CTR curve is monotonic", () => {
    expect(expectedCtr(1)).toBeGreaterThan(expectedCtr(3));
    expect(expectedCtr(3)).toBeGreaterThan(expectedCtr(8));
  });
  it("flags high-impression low-CTR non-brand queries only", () => {
    const res = buildInsights({ ...base, queries: [
      { query: "dental clinic near me", is_branded: false, clicks: 3, impressions: 488, ctr: 0.006, avg_position: 3, prev_clicks: null, prev_impressions: null },
      { query: "elites dental care", is_branded: true, clicks: 2, impressions: 238, ctr: 0.008, avg_position: 2.3, prev_clicks: null, prev_impressions: null },
    ] });
    const f = res.find((i) => i.id === "seo-lowctr")!;
    expect(f).toBeTruthy();
    expect(f.evidence).toContain("dental clinic near me");
    expect(f.evidence).not.toContain("elites dental care");
  });
  it("flags GA4 events with no key events", () => {
    const res = buildInsights({ ...base, ga4KeyEventsTotal: 0, funnel: { ga4_bookings_confirmed: 3, ga4_phone_clicks: 2, crm_booked: 0, ads_conversions: 0 } });
    expect(res.some((i) => i.id === "trk-key-events")).toBe(true);
  });
  it("flags rising CPA with enough volume", () => {
    const res = buildInsights({ ...base,
      campaigns: [{ campaign_id: "1", campaign_name: "EDC Search", cost: 10000, conversions: 5, clicks: 200 }],
      prevCampaigns: [{ campaign_id: "1", campaign_name: "EDC Search", cost: 10000, conversions: 10, clicks: 200 }] });
    expect(res.find((i) => i.id === "paid-cpa-1")?.severity).toBe("high");
  });
  it("does not flag CPA on tiny numbers", () => {
    const res = buildInsights({ ...base,
      campaigns: [{ campaign_id: "1", campaign_name: "x", cost: 1000, conversions: 1, clicks: 20 }],
      prevCampaigns: [{ campaign_id: "1", campaign_name: "x", cost: 1000, conversions: 2, clicks: 20 }] });
    expect(res.some((i) => i.id.startsWith("paid-cpa"))).toBe(false);
  });
  it("reports pending and failing sources, high first", () => {
    const res = buildInsights({ ...base, integrations: [
      { source: "ga4", label: "GA4", status: "error", last_success_at: null, last_error: "boom" },
      { source: "meta_ads", label: "Meta Ads", status: "pending_authorization", last_success_at: null, last_error: null },
    ] });
    expect(res[0].id).toBe("data-err-ga4");
    expect(res.some((i) => i.id === "data-pending")).toBe(true);
  });
  it("detects a spike", () => {
    const days = Array.from({ length: 20 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, ga4_sessions: 30 + (i % 3), ads_cost: null, leads: 0, gsc_clicks: null }));
    days[19].ga4_sessions = 400;
    const res = buildInsights({ ...base, days });
    expect(res.some((i) => i.id.startsWith("anom-ga4_sessions"))).toBe(true);
  });
});

describe("csv", () => {
  it("escapes and neutralises formulas", () => {
    const s = toCsv([{ a: "x,y", b: '=HYPERLINK("evil")', c: null }]);
    expect(s).toBe('a,b,c\r\n"x,y","\'=HYPERLINK(""evil"")",');
  });
});
