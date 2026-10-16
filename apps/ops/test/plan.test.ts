import { describe, expect, it } from "vitest";
import { type PlanBom, type PlanItem, PlanError, addDays, componentQty, explode, lowLevelCodes, operationMinutes, rollUpCost, runMrp } from "../lib/plan";
import { advance, bookValue, dueReason, monthsBetween } from "../lib/schedule";

const item = (id: number, sku: string, p: Partial<PlanItem> = {}): PlanItem => ({
  id, sku, source: "buy", onHand: 0, safetyStock: 0, reorderPoint: 0, lotSize: 0, leadDays: 0, unitCost: 0, ...p,
});

// A table (1) is a top (2) plus four legs (3); a top is 0.5 sheet of board (4) and 8 screws (5).
const TABLE = 1, TOP = 2, LEG = 3, BOARD = 4, SCREW = 5;
const boms = () =>
  new Map<number, PlanBom>([
    [TABLE, { itemId: TABLE, outputQty: 1, lines: [{ componentId: TOP, qty: 1, scrapPct: 0 }, { componentId: LEG, qty: 4, scrapPct: 0 }], operations: [{ workCenterId: 1, setupMinutes: 30, runMinutes: 15 }] }],
    [TOP, { itemId: TOP, outputQty: 2, lines: [{ componentId: BOARD, qty: 1, scrapPct: 0 }, { componentId: SCREW, qty: 16, scrapPct: 25 }], operations: [] }],
  ]);

describe("bill of materials maths", () => {
  it("scales components by batch size and scrap", () => {
    const top = boms().get(TOP)!;
    expect(componentQty(top.lines[0], top, 2)).toBe(1);
    expect(componentQty(top.lines[1], top, 1)).toBe(10); // 16 per 2, plus 25% scrap
  });

  it("charges setup once per order and run time per unit", () => {
    expect(operationMinutes(boms().get(TABLE)!.operations[0], 3)).toBe(30 + 15 * 3);
  });

  it("puts each item at its deepest level", () => {
    const b = boms();
    // Screws also go straight into the table: still level 2 because the top uses them.
    b.get(TABLE)!.lines.push({ componentId: SCREW, qty: 2, scrapPct: 0 });
    const codes = lowLevelCodes([TABLE, TOP, LEG, BOARD, SCREW], b);
    expect(Object.fromEntries(codes)).toEqual({ [TABLE]: 0, [TOP]: 1, [LEG]: 1, [BOARD]: 2, [SCREW]: 2 });
  });

  it("refuses a bill that contains itself", () => {
    const b = boms();
    b.set(BOARD, { itemId: BOARD, outputQty: 1, lines: [{ componentId: TABLE, qty: 1, scrapPct: 0 }], operations: [] });
    expect(() => lowLevelCodes([TABLE], b)).toThrow(PlanError);
  });

  it("explodes every level and sums repeated parts", () => {
    const parts = explode(TABLE, 2, boms());
    expect(parts).toEqual([
      { itemId: TOP, level: 1, qty: 2 },
      { itemId: LEG, level: 1, qty: 8 },
      { itemId: BOARD, level: 2, qty: 1 },
      { itemId: SCREW, level: 2, qty: 20 },
    ]);
  });

  it("rolls cost up through the levels with labor at the work center rate", () => {
    const items = new Map([[LEG, { unitCost: 5 }], [BOARD, { unitCost: 40 }], [SCREW, { unitCost: 0.1 }]]);
    const c = rollUpCost(TABLE, items, boms(), new Map([[1, 60]]));
    // top = (40 + 16 * 1.25 * 0.10) / 2 = 21; table = 21 + 4 * 5 = 41 material, (30 + 15) min at 60/h = 45 labor
    expect(c.material).toBeCloseTo(41);
    expect(c.labor).toBeCloseTo(45);
    expect(c.total).toBeCloseTo(86);
  });
});

describe("MRP", () => {
  const today = "2026-10-16";
  const base = () => [
    item(TABLE, "TABLE", { source: "make", leadDays: 2 }),
    item(TOP, "TOP", { source: "make", leadDays: 1 }),
    item(LEG, "LEG", { leadDays: 5, onHand: 10 }),
    item(BOARD, "BOARD", { leadDays: 3, lotSize: 5 }),
    item(SCREW, "SCREW", { leadDays: 1, onHand: 1000 }),
  ];

  it("plans builds and buys level by level, offset by lead time", () => {
    const orders = runMrp({ items: base(), boms: boms(), receipts: [], requirements: [{ itemId: TABLE, qty: 3, date: "2026-11-01", reason: "SO-1" }], today });
    const by = (id: number) => orders.filter((o) => o.itemId === id);
    expect(by(TABLE)).toEqual([{ itemId: TABLE, kind: "make", qty: 3, needDate: "2026-11-01", startDate: "2026-10-30", late: false, reason: "SO-1" }]);
    // The table build starts on the 30th, so its top must be there then.
    expect(by(TOP)).toMatchObject([{ kind: "make", qty: 3, needDate: "2026-10-30", startDate: "2026-10-29", reason: "For TABLE" }]);
    // 12 legs needed, 10 on hand.
    expect(by(LEG)).toMatchObject([{ kind: "buy", qty: 2, needDate: "2026-10-30", startDate: "2026-10-25" }]);
    // 1.5 boards needed, bought in lots of 5.
    expect(by(BOARD)).toMatchObject([{ kind: "buy", qty: 5, needDate: "2026-10-29" }]);
    // Plenty of screws.
    expect(by(SCREW)).toEqual([]);
  });

  it("counts open orders before planning new ones", () => {
    const orders = runMrp({
      items: base(), boms: boms(), today,
      receipts: [{ itemId: TABLE, qty: 2, date: "2026-10-25" }],
      requirements: [{ itemId: TABLE, qty: 3, date: "2026-11-01", reason: "SO-1" }],
    });
    expect(orders.find((o) => o.itemId === TABLE)?.qty).toBe(1);
  });

  it("flags orders that should already have started", () => {
    const orders = runMrp({ items: base(), boms: boms(), receipts: [], requirements: [{ itemId: LEG, qty: 20, date: "2026-10-18", reason: "rush" }], today });
    expect(orders).toEqual([{ itemId: LEG, kind: "buy", qty: 10, needDate: "2026-10-18", startDate: today, late: true, reason: "rush" }]);
  });

  it("keeps safety stock and refills below the reorder point", () => {
    const items = [item(LEG, "LEG", { onHand: 10, safetyStock: 4, reorderPoint: 8, leadDays: 2 })];
    const orders = runMrp({ items, boms: new Map(), receipts: [], requirements: [{ itemId: LEG, qty: 7, date: "2026-10-20", reason: "x" }], today });
    // 10 - 4 safety - 7 = -1 short on the 20th, so buy 1; that leaves 4, under the reorder point of 8, so buy 4 more.
    expect(orders.map((o) => [o.qty, o.reason])).toEqual([[1, "x"], [4, "Below reorder point"]]);
    expect(orders[1].needDate).toBe(addDays(today, 2));
  });
});

describe("assets", () => {
  it("is due by date or by meter", () => {
    const plan = { intervalDays: 90, intervalMeter: 250, nextDue: "2026-10-20", nextMeter: 1250 };
    expect(dueReason(plan, "2026-10-16", 1000)).toBeNull();
    expect(dueReason(plan, "2026-10-20", 1000)).toBe("Due 2026-10-20");
    expect(dueReason(plan, "2026-10-16", 1250)).toBe("Meter reached 1250");
  });

  it("moves the next due date and meter on from when the work was done", () => {
    expect(advance({ intervalDays: 30, intervalMeter: 100 }, "2026-10-16", 540)).toEqual({ nextDue: "2026-11-15", nextMeter: 640 });
    expect(advance({ intervalDays: null, intervalMeter: 100 }, "2026-10-16", null)).toEqual({ nextDue: null, nextMeter: null });
  });

  it("depreciates straight line by month down to salvage", () => {
    expect(monthsBetween("2026-01-15", "2026-10-14")).toBe(8);
    expect(monthsBetween("2026-01-15", "2026-10-15")).toBe(9);
    expect(bookValue(12000, 0, 60, "2026-01-15", "2026-10-15")).toEqual({ monthly: 200, accumulated: 1800, value: 10200 });
    expect(bookValue(12000, 2000, 10, "2020-01-01", "2026-10-15")?.value).toBe(2000);
    expect(bookValue(null, 0, 60, "2026-01-01", "2026-10-15")).toBeNull();
  });
});
