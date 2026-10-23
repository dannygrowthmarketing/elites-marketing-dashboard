import { describe, expect, it } from "vitest";
import { anomalies, biggestLeak, channelOfGa4, channelOfLead, contributions, curve, forecast, marginalCostPerBooking, simulate, stoppedSince, withRates, type Baseline } from "./funnel";

const base: Baseline = { days: 30.4, spend: 14000, clicks: 700, visits: 350, actions: 350, calls: 100, bookings: 8 };
const x = { monthlyBudget: 14000, elasticity: 0.85, callToBooking: 0.3, showRate: 0.75, revenuePerPatient: 3500 };

describe("funnel maths", () => {
  it("maps GA4 and CRM channels", () => {
    expect(channelOfGa4("Paid Search")).toBe("Paid search");
    expect(channelOfGa4("Organic Search", "google", "gbp_booking")).toBe("Business Profile");
    expect(channelOfGa4("Organic Social")).toBe("Social");
    expect(channelOfGa4("AI Assistant")).toBe("Referral & other");
    expect(channelOfLead("google", "cpc")).toBe("Paid search");
    expect(channelOfLead(null, null)).toBe("Direct");
  });
  it("computes step rates and finds the biggest leak", () => {
    const s = withRates([
      { key: "a", label: "Visits", value: 1000, source: "" }, { key: "b", label: "Actions", value: 200, source: "" },
      { key: "c", label: "CRM", value: null, source: "" }, { key: "d", label: "Booked", value: 10, source: "" },
    ]);
    expect(s[1].rateFromPrev).toBe(0.2); expect(s[2].rateFromPrev).toBeNull(); expect(s[3].rateFromPrev).toBe(0.05);
    expect(biggestLeak(s)?.to.key).toBe("d");
  });
  it("reproduces the baseline at the baseline budget", () => {
    const r = simulate(base, x);
    expect(r.clicks).toBeCloseTo(700); expect(r.visits).toBeCloseTo(350); expect(r.actions).toBeCloseTo(350);
    expect(r.onlineBookings).toBeCloseTo(8); expect(r.callBookings).toBeCloseTo(30); expect(r.bookings).toBeCloseTo(38);
    expect(r.patients).toBeCloseTo(28.5); expect(r.cpc).toBeCloseTo(20);
    expect(r.low).toBeLessThan(r.patients); expect(r.high).toBeGreaterThan(r.patients);
  });
  it("gets more expensive per booking as budget grows (elasticity < 1)", () => {
    const dbl = simulate(base, { ...x, monthlyBudget: 28000 });
    expect(dbl.clicks).toBeLessThan(1400); expect(dbl.costPerBooking!).toBeGreaterThan(simulate(base, x).costPerBooking!);
    expect(marginalCostPerBooking(base, x)!).toBeGreaterThan(simulate(base, x).costPerBooking!);
    expect(simulate(base, { ...x, monthlyBudget: 0 }).clicks).toBe(0);
    expect(curve(base, x).length).toBe(25);
  });
  it("forecasts with a weekly pattern and flags anomalies", () => {
    const days = Array.from({ length: 70 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);
      return { date: d, value: 10 + (new Date(d).getUTCDay() === 0 ? -5 : 0) + (i === 60 ? 40 : 0) };
    });
    const f = forecast(days, 14)!;
    expect(f.points.filter((p) => p.forecast != null)).toHaveLength(14);
    expect(f.total).toBeGreaterThan(100); expect(f.total).toBeLessThan(160);
    expect(anomalies(days).map((a) => a.date)).toContain(days[60].date);
    expect(forecast(days.slice(0, 10))).toBeNull();
  });
  it("detects a stop and splits a change by segment", () => {
    expect(stoppedSince([{ date: "a", value: 5 }, { date: "b", value: 0 }, { date: "c", value: 0 }, { date: "d", value: 0 }])).toBe("b");
    expect(stoppedSince([{ date: "a", value: 0 }, { date: "b", value: 0 }, { date: "c", value: 0 }])).toBeNull();
    const c = contributions({ Paid: 300, Direct: 100 }, { Paid: 200, Direct: 150 });
    expect(c[0]).toMatchObject({ key: "Paid", delta: 100, share: 2 });
  });
});
