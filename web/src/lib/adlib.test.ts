import { describe, expect, it } from "vitest";
import { combo, metricsOf, statusOf, type AdRow } from "./adlib";

const base = { ad_status: "ENABLED", ad_group_status: "ENABLED", campaign_status: "ENABLED", campaign_serving_status: "SERVING", last_served: "2026-10-19" } as unknown as AdRow;

describe("ad status", () => {
  it("running only with recent impressions", () => {
    expect(statusOf(base, "2026-10-20")).toBe("running");
    expect(statusOf({ ...base, last_served: "2026-10-16" }, "2026-10-20")).toBe("idle");
    expect(statusOf({ ...base, last_served: null }, "2026-10-20")).toBe("never");
  });
  it("paused/removed/ended win over recency", () => {
    expect(statusOf({ ...base, campaign_status: "PAUSED" }, "2026-10-20")).toBe("paused");
    expect(statusOf({ ...base, ad_status: "REMOVED" }, "2026-10-20")).toBe("removed");
    expect(statusOf({ ...base, campaign_serving_status: "ENDED" }, "2026-10-20")).toBe("ended");
  });
});

describe("metrics from totals", () => {
  it("computes rates from totals, flags placeholder value", () => {
    const m = metricsOf({ impressions: 1000, clicks: 50, cost: 1000, conversions: 2, conversion_value: 2 });
    expect(m.ctr).toBe(0.05); expect(m.cpc).toBe(20); expect(m.cr).toBe(0.04); expect(m.cpa).toBe(500);
    expect(m.valueState).toBe("placeholder");
  });
  it("no conversions -> null cost/conv, not zero", () => {
    const m = metricsOf({ impressions: 10, clicks: 0, cost: 0, conversions: 0, conversion_value: 0 });
    expect(m.cpa).toBeNull(); expect(m.ctr).toBe(0); expect(m.cpc).toBeNull(); expect(m.valueState).toBe("none");
  });
});

describe("responsive ad combination", () => {
  const H = (text: string, pinned: string | null = null) => ({ text, pinned, label: null, approval: null });
  it("respects pins and fills the rest in order", () => {
    const out = combo([H("A"), H("B", "HEADLINE_1"), H("C"), H("D")], 3, "HEADLINE", 0);
    expect(out).toEqual(["B", "A", "C"]);
  });
  it("rotates unpinned assets with the seed", () => {
    const out = combo([H("A"), H("B"), H("C")], 2, "HEADLINE", 1);
    expect(out).toEqual(["B", "C"]);
  });
  it("empty input gives empty output", () => { expect(combo(null, 3, "HEADLINE", 0)).toEqual([]); });
});
