import { describe, expect, it } from "vitest";
import { daily, explode, fmtSecs, isTestUrl, overall, pagePath, segments, testVisits, type Snap } from "./clarity";

const d = "2026-10-21";
const S = (metric: string, dimension: string, dimension_value: string, payload: any): Snap => ({ captured_on: d, metric, dimension, dimension_value, payload });

const snaps: Snap[] = [
  S("Traffic", "Device", "PC", { Device: "PC", totalSessionCount: 3, totalBotSessionCount: 1, distinctUserCount: 2 }),
  S("Traffic", "Device", "Mobile", { Device: "Mobile", totalSessionCount: 1, totalBotSessionCount: 0, distinctUserCount: 1 }),
  S("ScrollDepth", "Device", "PC", { Device: "PC", averageScrollDepth: 40 }),
  S("ScrollDepth", "Device", "Mobile", { Device: "Mobile", averageScrollDepth: 80 }),
  S("EngagementTime", "Device", "PC", { Device: "PC", totalTime: 100, activeTime: 60 }),
  S("EngagementTime", "Device", "Mobile", { Device: "Mobile", totalTime: 20, activeTime: 20 }),
  S("RageClickCount", "Device", "PC", { Device: "PC", subTotal: 2, sessionsCount: 3, sessionsWithMetricPercentage: 33.3333 }),
  S("RageClickCount", "Device", "Mobile", { Device: "Mobile", subTotal: 0, sessionsCount: 1, sessionsWithMetricPercentage: 0 }),
  S("Traffic", "URL", "(unknown)", { items: [
    { Url: "https://elitesdental.com/", totalSessionCount: 2, totalBotSessionCount: 1 },
    { Url: "https://elitesdental.com/?utm_source=google", totalSessionCount: 1, totalBotSessionCount: 0 },
    { Url: "https://elitesdental.com/contact-us/?utm_source=claude_test", totalSessionCount: 1, totalBotSessionCount: 0 },
  ] }),
];

describe("clarity", () => {
  it("explodes merged rows and reads the Url field whatever its casing", () => {
    expect(explode(snaps[8]).map((x) => x.value)).toEqual([
      "https://elitesdental.com/", "https://elitesdental.com/?utm_source=google", "https://elitesdental.com/contact-us/?utm_source=claude_test"]);
  });
  it("flags test and preview visits", () => {
    expect(isTestUrl("https://x/contact-us/?elementor-preview=1")).toBe(true);
    expect(isTestUrl("https://x/?utm_source=claude_test")).toBe(true);
    expect(isTestUrl("https://x/?utm_source=google")).toBe(false);
    expect(pagePath("https://elitesdental.com/?a=1")).toBe("/");
  });
  it("weights averages and shares by sessions", () => {
    const o = overall(snaps)!;
    expect(o.sessions).toBe(4); expect(o.bots).toBe(1);
    expect(o.scroll).toBeCloseTo((3 * 40 + 1 * 80) / 4 / 100);
    expect(o.active).toBeCloseTo((3 * 60 + 1 * 20) / 4);
    expect(o.rage).toBeCloseTo(1 / 4, 3);
    expect(o.rageClicks).toBe(2);
  });
  it("groups pages by path and drops test visits", () => {
    const p = segments(snaps, "URL", (u) => (isTestUrl(u) ? null : pagePath(u)));
    expect(p.map((x) => [x.key, x.sessions])).toEqual([["/", 3]]);
    expect(testVisits(snaps)).toBe(1);
  });
  it("builds a daily series and formats seconds", () => {
    expect(daily(snaps)).toEqual([{ date: d, sessions: 4, bots: 1 }]);
    expect(fmtSecs(45)).toBe("45s"); expect(fmtSecs(125)).toBe("2m 05s"); expect(fmtSecs(null)).toBe("—");
  });
});
