import { describe, expect, it } from "vitest";
import { allocate, changeDue, fromCents, movingAverage, price, refundShare, toCents } from "../lib/money";

describe("money", () => {
  it("converts between cents and amounts", () => {
    expect(toCents("12.34")).toBe(1234);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(fromCents(1234)).toBe("12.34");
    expect(fromCents(-5)).toBe("-0.05");
    expect(fromCents(0)).toBe("0.00");
  });

  it("shares an order discount out to the cent", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(7, [0, 0])).toEqual([0, 0]);
    const parts = allocate(999, [333, 1000, 17]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(999);
  });

  it("prices a cart: line discounts, an order discount, then tax per line", () => {
    const t = price(
      [
        { qty: 2, unitPrice: 1000, taxRate: 10 },
        { qty: 1, unitPrice: 500, discount: 100, taxRate: 0 },
      ],
      300,
    );
    // 2000 + 400 left after the line discount; 300 shared 250 / 50.
    expect(t.lines.map((l) => l.discount)).toEqual([250, 150]);
    expect(t.lines[0].tax).toBe(175);
    expect(t).toMatchObject({ subtotal: 2500, discount: 400, tax: 175, total: 2275 });
    expect(t.lines.reduce((a, l) => a + l.total, 0)).toBe(t.total);
  });

  it("never discounts a line below zero", () => {
    const t = price([{ qty: 1, unitPrice: 500, discount: 900, taxRate: 8 }], 1000);
    expect(t.total).toBe(0);
    expect(t.discount).toBe(500);
  });

  it("averages cost on receipt, ignoring stock that ran negative", () => {
    expect(movingAverage(10, 2, 10, 4)).toBe(3);
    expect(movingAverage(0, 2, 5, 4)).toBe(4);
    expect(movingAverage(-3, 2, 5, 4)).toBe(4);
    expect(movingAverage(5, 2, 0, 9)).toBe(2);
  });

  it("gives change and refunds a line exactly over several goes", () => {
    expect(changeDue(1550, 2000)).toBe(450);
    expect(changeDue(1550, 1000)).toBe(0);
    const line = { qty: 3, total: 1000, tax: 91 };
    const a = refundShare(line, 0, 1);
    const b = refundShare(line, 1, 1);
    const c = refundShare(line, 2, 1);
    expect(a.total + b.total + c.total).toBe(1000);
    expect(a.tax + b.tax + c.tax).toBe(91);
  });
});
