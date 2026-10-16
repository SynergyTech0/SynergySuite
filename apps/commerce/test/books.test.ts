import { describe, expect, it } from "vitest";
import { adjustmentLines, balanced, receiptLines, refundLines, retryDue, saleLines, wire } from "../lib/books";
import { DEFAULTS } from "../lib/settings";

const s = DEFAULTS;
const sum = (lines: { debit: number; credit: number }[]) => [lines.reduce((a, l) => a + l.debit, 0), lines.reduce((a, l) => a + l.credit, 0)];

describe("Books postings", () => {
  it("books a sale: money by tender, sales, tax and cost of goods", () => {
    const lines = saleLines(s, "S-000001", {
      payments: [{ method: "cash", amount: 1000 }, { method: "card", amount: 1175 }, { method: "cash", amount: 100 }],
      net: 2000, tax: 275, cost: 800,
    });
    expect(balanced(lines)).toBe(true);
    expect(sum(lines)).toEqual([3075, 3075]);
    expect(lines.find((l) => l.description.includes("(cash)"))).toMatchObject({ account: "1010", debit: 1100 });
    expect(lines.find((l) => l.account === "4010")).toMatchObject({ credit: 2000 });
    expect(lines.find((l) => l.account === "2300")).toMatchObject({ credit: 275 });
    expect(lines.find((l) => l.account === "5000")).toMatchObject({ debit: 800 });
    expect(lines.find((l) => l.account === "1200")).toMatchObject({ credit: 800 });
  });

  it("leaves out empty lines, like tax on an untaxed sale", () => {
    const lines = saleLines(s, "S-2", { payments: [{ method: "card", amount: 500 }], net: 500, tax: 0, cost: 0 });
    expect(lines).toHaveLength(2);
    expect(balanced(lines)).toBe(true);
  });

  it("books refunds, with and without putting goods back", () => {
    const back = refundLines(s, "S-1-1", { method: "cash", net: 1000, tax: 80, cost: 400, restock: true });
    expect(balanced(back)).toBe(true);
    expect(back.find((l) => l.account === "4200")).toMatchObject({ debit: 1000 });
    expect(back.find((l) => l.account === "1200")).toMatchObject({ debit: 400 });
    const gone = refundLines(s, "S-1-2", { method: "card", net: 1000, tax: 80, cost: 400, restock: false });
    expect(gone.some((l) => l.account === "1200")).toBe(false);
    expect(balanced(gone)).toBe(true);
  });

  it("books deliveries and adjustments both ways", () => {
    expect(receiptLines(s, "PO-1-R1", 12345)).toEqual([
      { account: "1200", debit: 12345, credit: 0, description: "Received PO-1-R1" },
      { account: "2000", debit: 0, credit: 12345, description: "Received PO-1-R1" },
    ]);
    const lost = adjustmentLines(s, "SKU1", -300, "Damaged");
    expect(lost.find((l) => l.account === "1200")).toMatchObject({ credit: 300 });
    const found = adjustmentLines(s, "SKU1", 300, "");
    expect(found.find((l) => l.account === "1200")).toMatchObject({ debit: 300 });
    expect(adjustmentLines(s, "SKU1", 0, "")).toEqual([]);
  });

  it("sends amounts the way Books' journal takes them", () => {
    const w = wire({ reference: "r", kind: "receipt", date: "2026-10-16", description: "d", lines: receiptLines(s, "x", 1005) });
    expect(w.lines[0]).toMatchObject({ debit: 10.05, credit: 0 });
  });

  it("backs off between retries", () => {
    const now = Date.now();
    expect(retryDue(0, null, now)).toBe(true);
    expect(retryDue(1, new Date(now - 30_000), now)).toBe(false);
    expect(retryDue(1, new Date(now - 61_000), now)).toBe(true);
    expect(retryDue(4, new Date(now - 7 * 60_000), now)).toBe(false);
    expect(retryDue(20, new Date(now - 61 * 60_000), now)).toBe(true);
  });
});
