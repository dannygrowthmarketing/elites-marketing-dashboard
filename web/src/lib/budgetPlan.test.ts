import { describe, expect, it } from "vitest";
import { allocate, byChannel, DEFAULT_ASSUMPTIONS, phase, project } from "./budgetPlan";

describe("budget plan", () => {
  it("allocates exactly the total", () => {
    for (const [t, m] of [[200000, 6], [500000, 6], [1000000, 12], [2000000, 3]] as const) {
      for (const g of ["patients", "balanced", "brand"] as const) {
        const p = allocate(t, m, g);
        expect(p.lines.reduce((a, l) => a + l.total, 0)).toBeCloseTo(t, 0);
        expect(p.monthTotals.reduce((a, x) => a + x, 0)).toBeCloseTo(t, 0);
      }
    }
  });
  it("drops video for small budgets and keeps it for large ones", () => {
    expect(allocate(300000, 6, "brand").lines.some((l) => l.item.key === "video")).toBe(false);
    expect(allocate(1000000, 6, "brand").lines.some((l) => l.item.key === "video")).toBe(true);
  });
  it("respects the search cap", () => {
    const p = allocate(6000000, 6, "patients");
    expect(p.lines.find((l) => l.item.key === "search")!.monthly).toBeLessThanOrEqual(120000 + 1e-6);
  });
  it("front-loads set-up items", () => {
    const w = phase(100, 5, "front");
    expect(w[0]).toBeCloseTo(40); expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100);
  });
  it("more budget gives more patients, at a higher cost each", () => {
    const a = project(allocate(500000, 6, "patients"), DEFAULT_ASSUMPTIONS), b = project(allocate(1000000, 6, "patients"), DEFAULT_ASSUMPTIONS);
    expect(b.patients).toBeGreaterThan(a.patients);
    expect(b.costPerPatient!).toBeGreaterThan(a.costPerPatient!);
  });
});

describe("small budgets", () => {
  it("works from ₹50K", () => {
    for (const m of [1, 3, 6]) {
      const p = allocate(50000, m, "patients");
      expect(p.lines.reduce((a, l) => a + l.total, 0)).toBeCloseTo(50000, 0);
      expect(p.lines.some((l) => l.item.key === "search")).toBe(true);
    }
  });
  it("includes influencer and WhatsApp at ₹1L/month", () => {
    const keys = allocate(300000, 3, "balanced").lines.map((l) => l.item.key);
    expect(keys).toContain("influencer"); expect(keys).toContain("whatsapp"); expect(keys).toContain("email");
  });
  it("rolls lines up into channels", () => {
    const c = byChannel(allocate(500000, 6, "balanced"));
    expect(c.reduce((a, x) => a + x.total, 0)).toBeCloseTo(500000, 0);
    expect(c.map((x) => x.key)).toContain("google");
  });
});
