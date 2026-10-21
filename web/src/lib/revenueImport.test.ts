import { describe, expect, it } from "vitest";
import { guessMapping, parseAmount, parseDate, prepareRows } from "./revenueImport";

describe("revenue import", () => {
  it("guesses columns from common clinic headers", () => {
    const m = guessMapping(["Bill No", "Bill Date", "Patient Name", "Mobile No.", "Treatment Category", "Amount (Rs)", "Remarks", "New/Returning"]);
    expect(m).toEqual({ invoice: 0, date: 1, phone: 3, service: 4, amount: 5, note: 6, patient_type: 7 });
  });
  it("reads Indian date formats day-first", () => {
    expect(parseDate("05/10/2026")).toBe("2026-10-05");
    expect(parseDate("5-10-26")).toBe("2026-10-05");
    expect(parseDate("2026-10-05")).toBe("2026-10-05");
    expect(parseDate("5 Oct 2026")).toBe("2026-10-05");
    expect(parseDate("05-Oct-2026")).toBe("2026-10-05");
    expect(parseDate("Oct 5, 2026")).toBe("2026-10-05");
    expect(parseDate(new Date(2026, 9, 5))).toBe("2026-10-05");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("tomorrow")).toBeNull();
  });
  it("reads rupee amounts", () => {
    expect(parseAmount("₹12,500")).toBe(12500);
    expect(parseAmount("Rs. 1,20,000.50")).toBe(120000.5);
    expect(parseAmount("800 INR")).toBe(800);
    expect(parseAmount(450)).toBe(450);
    expect(parseAmount("abc")).toBeNull();
  });
  it("validates rows and drops clinical notes", () => {
    const rows = [
      ["INV-1", "05/10/2026", "₹12,000", "98450 12345", "implant follow-up"],
      ["INV-1", "06/10/2026", "500", "", ""],
      ["", "", "", "", ""],
      ["INV-3", "01/12/2026", "x", "123", "root canal pain"],
    ];
    const p = prepareRows(rows, { invoice: 0, date: 1, amount: 2, phone: 3, note: 4 }, "2026-10-21");
    expect(p).toHaveLength(3);
    expect(p[0].errors).toEqual([]); expect(p[0].data).toMatchObject({ date: "2026-10-05", amount: 12000, phone: "9845012345", note: "implant follow-up" });
    expect(p[1].errors).toEqual(["Same invoice as row 2"]);
    expect(p[2].row).toBe(5);
    expect(p[2].errors).toEqual(["Date is in the future", 'Can\'t read amount "x"']);
    expect(p[2].warnings).toContain("Note looks clinical — it will be left out");
    expect(p[2].data.note).toBeUndefined();
  });
});
