import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) {
  process.env.DATABASE_URL = url;
  process.env.OPS_DATABASE_URL = url;
}
delete process.env.OPS_BOOKS_URL;
delete process.env.ADMIN_INTERNAL_URL;

const me = "planner@example.com";
const tech = "tech@example.com";

describe.skipIf(!url)("ops", async () => {
  const stock = await import("../lib/stock");
  const mfg = await import("../lib/mfg");
  const assets = await import("../lib/assets");
  const books = await import("../lib/books");
  const { searchFor } = await import("../lib/search");
  const ed = await import("../lib/ediscovery");
  const { parseSearch } = await import("../lib/compliance");
  const { q, db } = await import("../lib/db");

  beforeAll(async () => {
    await q("SELECT 1");
    await q(`TRUNCATE counters, items, stock_moves, work_centers, boms, bom_lines, bom_operations, work_orders, wo_materials, wo_operations,
      demands, mrp_runs, planned_orders, purchase_requests, assets, meter_readings, maint_plans, maint_orders, maint_parts RESTART IDENTITY CASCADE`);
  });
  afterAll(async () => {
    await db().close();
  });

  const year = new Date().getUTCFullYear();
  let leg: number, board: number, table: number, bench: number, bomId: number, woId: number;

  it("keeps items and refuses to take stock it doesn't have", async () => {
    leg = (await stock.createItem({ sku: "LEG-01", name: "Oak leg", unitCost: 5, onHand: 10, leadDays: 5 }, me)).id;
    board = (await stock.createItem({ sku: "BRD-01", name: "Oak board", unitCost: 40, onHand: 1, lotSize: 5, leadDays: 3 }, me)).id;
    table = (await stock.createItem({ sku: "TBL-01", name: "Oak table", source: "make", leadDays: 2 }, me)).id;
    await expect(stock.createItem({ sku: "leg-01", name: "dupe" }, me)).rejects.toMatchObject({ code: "23505" });
    await expect(stock.createItem({ sku: "BAD SKU", name: "x" }, me)).rejects.toThrow(/spaces/);
    await expect(stock.adjust(leg, { kind: "adjust", qty: -11 }, me)).rejects.toThrow(/Not enough LEG-01/);
    // A receipt at a new price moves the average cost.
    const after = await stock.adjust(leg, { kind: "receipt", qty: 10, unitCost: 7 }, me);
    expect(after.onHand).toBe(20);
    expect(after.unitCost).toBe(6);
    expect((await stock.listMoves({ itemId: leg })).map((m) => [m.kind, m.qty, m.booksStatus])).toEqual([["receipt", 10, "off"], ["adjust", 10, "off"]]);
  });

  it("versions bills of materials and keeps one active", async () => {
    const wc = await mfg.saveWorkCenter(null, { code: "ASM", name: "Assembly", ratePerHour: 60 });
    const bom = await mfg.saveBom(null, {
      itemId: table, outputQty: 1,
      lines: [{ componentId: leg, qty: 4 }, { componentId: board, qty: 1, scrapPct: 0 }],
      operations: [{ seq: 10, name: "Assemble", workCenterId: wc.id, setupMinutes: 30, runMinutes: 30 }],
    }, me);
    bomId = bom.id;
    expect(bom).toMatchObject({ version: 1, status: "draft", lines: [{ sku: "LEG-01", qty: 4 }, { sku: "BRD-01", qty: 1 }] });
    await expect(mfg.saveBom(bom.id, { lines: [{ componentId: table, qty: 1 }] }, me)).rejects.toThrow(/component of itself/);
    await mfg.setBomStatus(bom.id, "active");
    const cost = await mfg.costing(table);
    // 4 legs at 6 + a board at 40, and an hour of assembly at 60.
    expect(cost).toMatchObject({ material: 64, labor: 60, total: 124 });

    // A second version replaces the first when it goes live.
    const v2 = await mfg.copyBom(bom.id, me);
    expect(v2.version).toBe(2);
    await mfg.setBomStatus(v2.id, "active");
    expect((await mfg.getBom(bom.id)).status).toBe("obsolete");
    await expect(mfg.saveBom(bom.id, { lines: [] }, me)).rejects.toThrow(/Only a draft/);
    bomId = v2.id;

    // A bench made from tables would loop if a table were made from benches.
    bench = (await stock.createItem({ sku: "BEN-01", name: "Bench" }, me)).id;
    const benchBom = await mfg.saveBom(null, { itemId: bench, lines: [{ componentId: table, qty: 1 }] }, me);
    await mfg.setBomStatus(benchBom.id, "active");
    const v3 = await mfg.copyBom(bomId, me);
    await mfg.saveBom(v3.id, { lines: [{ componentId: bench, qty: 1 }] }, me);
    await expect(mfg.setBomStatus(v3.id, "active")).rejects.toThrow(/its own item/);
    await mfg.deleteBom(v3.id);
  });

  it("runs a work order from release to finished stock at actual cost", async () => {
    const wo = await mfg.getWorkOrder(await mfg.createWorkOrder({ itemId: table, qty: 2, dueDate: "2099-01-10", assignee: tech, notes: "Walnut stain" }, me));
    woId = wo.id;
    expect(wo).toMatchObject({ number: `WO-${year}-0001`, status: "planned", startDate: "2099-01-08", materials: [] });
    await expect(mfg.actOnWorkOrder(wo.id, { action: "issue" }, me)).rejects.toThrow(/Release/);

    const released = await mfg.actOnWorkOrder(wo.id, { action: "release" }, me);
    expect(released.materials.map((m) => [m.sku, m.required])).toEqual([["LEG-01", 8], ["BRD-01", 2]]);
    expect(released.operations).toMatchObject([{ name: "Assemble", plannedMinutes: 90, ratePerHour: 60 }]);
    // Only 1 board on hand: completing now would take 2.
    await expect(mfg.actOnWorkOrder(wo.id, { action: "complete" }, me)).rejects.toThrow(/Not enough BRD-01/);
    await stock.adjust(board, { kind: "receipt", qty: 1, unitCost: 40 }, me);

    const legMat = released.materials.find((m) => m.sku === "LEG-01")!;
    const part = await mfg.actOnWorkOrder(wo.id, { action: "issue", materialId: legMat.id, qty: 8 }, me);
    expect(part.status).toBe("in_progress");
    expect(part.materialCost).toBe(48);
    await mfg.actOnWorkOrder(wo.id, { action: "operation", operationId: released.operations[0].id, minutes: 120 }, tech);
    const done = await mfg.actOnWorkOrder(wo.id, { action: "complete" }, tech);
    expect(done).toMatchObject({ status: "done", qtyDone: 2, materialCost: 128, laborCost: 120 });
    const t = await stock.getItem(table);
    expect(t.onHand).toBe(2);
    expect(t.unitCost).toBe(124); // (128 + 120) / 2
    expect((await stock.getItem(board)).onHand).toBe(0);
    await expect(mfg.actOnWorkOrder(wo.id, { action: "cancel" }, me)).rejects.toThrow(/closed/);
  });

  it("plans what to build and buy, and firms suggestions into orders", async () => {
    await mfg.addDemand({ itemId: table, qty: 5, dueDate: "2099-02-01", reference: "SO-77" }, me);
    const plan = await mfg.runPlanning(me);
    const find = (sku: string) => plan.orders.filter((o) => o.sku === sku);
    // 2 tables on hand, 3 to build; 12 legs needed, 12 on hand; 3 boards, bought in lots of 5.
    expect(find("TBL-01")).toMatchObject([{ kind: "make", qty: 3, needDate: "2099-02-01", startDate: "2099-01-30", reason: "SO-77" }]);
    expect(find("LEG-01")).toEqual([]);
    expect(find("BRD-01")).toMatchObject([{ kind: "buy", qty: 5, needDate: "2099-01-30", startDate: "2099-01-27" }]);

    const made = await mfg.firmPlanned(find("TBL-01")[0].id, me);
    expect(made).toMatchObject({ kind: "make", ref: `WO-${year}-0002` });
    const bought = await mfg.firmPlanned(find("BRD-01")[0].id, me);
    expect(bought).toMatchObject({ kind: "buy", ref: `PR-${year}-0001` });
    await expect(mfg.firmPlanned(find("BRD-01")[0].id, me)).rejects.toThrow(/already handled/);

    // Run again: the firmed orders now cover the demand, so nothing new is suggested.
    const again = await mfg.runPlanning(me);
    expect(again.orders).toEqual([]);

    // Receiving the purchase request puts the boards in stock at the price paid.
    await mfg.actOnPurchaseRequest(bought.id, { action: "ordered", vendor: "Timber Co" }, me);
    await mfg.actOnPurchaseRequest(bought.id, { action: "receive", unitCost: 42 }, me);
    expect(await stock.getItem(board)).toMatchObject({ onHand: 5, unitCost: 42 });
    expect((await mfg.listPurchaseRequests({ status: "received" }))[0]).toMatchObject({ number: `PR-${year}-0001`, vendor: "Timber Co" });

    // Demand from another app arrives by SKU.
    await mfg.addDemandBySku({ sku: "tbl-01", qty: 1, dueDate: "2099-03-01", reference: "WEB-1" }, "api");
    await expect(mfg.addDemandBySku({ sku: "NOPE", qty: 1, dueDate: "2099-03-01" }, "api")).rejects.toThrow(/No item/);
    expect((await mfg.listDemands()).map((d) => [d.reference, d.source])).toEqual([["SO-77", "manual"], ["WEB-1", "api"]]);
  });

  let pressId: number, planId: number;

  it("opens preventive maintenance by meter, once, and moves the plan on when done", async () => {
    const press = await assets.createAsset({ name: "Hydraulic press", category: "Machinery", location: "Bay 2", meterUnit: "hours", meterValue: 900, purchaseDate: "2024-01-01", purchaseCost: 60000, usefulLifeMonths: 120 }, me);
    pressId = press.id;
    expect(press.tag).toBe(`AST-${year}-0001`);
    expect(press.bookValue).toBeLessThan(60000);
    const plan = await assets.savePlan(null, { assetId: press.id, title: "Change hydraulic oil", intervalMeter: 250, assignee: tech }, me);
    planId = plan.id;
    expect(plan).toMatchObject({ nextMeter: 1150, nextDue: null, due: null });
    await expect(assets.savePlan(null, { assetId: press.id, title: "x" }, me)).rejects.toThrow(/how often/);

    expect((await assets.scheduleDue()).created).toEqual([]);
    await expect(assets.addReading(press.id, { value: 800 }, tech)).rejects.toThrow(/backwards/);
    await assets.addReading(press.id, { value: 1160 }, tech); // reading schedules on its own
    const open = await assets.listOrders({ status: "active" });
    expect(open).toMatchObject([{ number: `MO-${year}-0001`, kind: "preventive", title: "Change hydraulic oil", assignee: tech, requestedBy: "scheduler" }]);
    expect((await assets.scheduleDue()).created).toEqual([]); // one open order per plan

    const mo = open[0].id;
    await assets.updateOrder(mo, { status: "in_progress" }, tech);
    expect((await assets.getAsset(press.id)).status).toBe("in_repair");
    // Spare parts come out of stock at cost.
    const oil = (await stock.createItem({ sku: "OIL-46", name: "Hydraulic oil 46", unit_cost: 0, unitCost: 8, onHand: 50, uom: "l" }, me)).id;
    await assets.addPart(mo, { itemId: oil, qty: 40 }, tech);
    await expect(assets.addPart(mo, { itemId: oil, qty: 40 }, tech)).rejects.toThrow(/Not enough OIL-46/);
    await assets.updateOrder(mo, { laborMinutes: 90, laborRate: 50, resolution: "Drained and refilled; filter replaced", status: "done" }, tech);
    const got = await assets.getOrder(mo);
    expect(got).toMatchObject({ status: "done", partsCost: 320, laborMinutes: 90 });
    expect((await assets.getAsset(press.id)).status).toBe("active");
    expect((await assets.listPlans({ assetId: press.id }))[0]).toMatchObject({ nextMeter: 1410, lastDone: expect.any(String) });
    await expect(assets.updateOrder(mo, { status: "open" }, tech)).rejects.toThrow(/closed/);
    // Notes can still be added to closed work.
    await assets.updateOrder(mo, { resolution: "Drained and refilled; filter replaced. Check seal at next service." }, tech);
  });

  it("files reported faults and keeps the asset tree free of loops", async () => {
    const pump = await assets.createAsset({ name: "Pump", parentId: pressId, assignee: tech }, me);
    await expect(assets.updateAsset(pressId, { parentId: pump.id })).rejects.toThrow(/inside itself/);
    const mo = await assets.createOrder({ assetId: pump.id, title: "Leaking seal", description: "Puddle under the pump", priority: "high" }, "operator@example.com");
    expect((await assets.getOrder(mo)).priority).toBe("high");
    void planId;
  });

  it("answers suite search and eDiscovery", async () => {
    const s = await searchFor({ email: me, name: "" }, { query: "hydraulic" });
    expect(s.results.map((r) => r.kind).sort()).toEqual(["asset", "item", "maintenance"]);
    const w = await searchFor({ email: me, name: "" }, { query: "walnut", kinds: ["work_order"] });
    expect(w.results).toMatchObject([{ kind: "work_order", url: `/?wo=${woId}`, person: tech }]);

    const byTech = await ed.search(parseSearch({ custodians: [tech] }, ed.KINDS));
    expect(byTech.hits.map((h) => h.kind).sort()).toEqual(["asset", "maintenance", "work_order"]);
    const seal = await ed.search(parseSearch({ query: "seal", kinds: ["maintenance"] }, ed.KINDS));
    expect(seal.hits.map((h) => h.owner).sort()).toEqual(["operator@example.com", tech]);
    const out = await ed.exportItems([byTech.hits.find((h) => h.kind === "maintenance")!.id, "bogus:1"]);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].metadata).toMatchObject({ parts: [{ sku: "OIL-46" }] });
  });

  it("queues stock for Books when linked and sends it in order", async () => {
    process.env.OPS_BOOKS_URL = "http://books.test";
    process.env.BOOKS_SVC_TOKEN = "t0ken";
    const sent: { path: string; body: Record<string, unknown> }[] = [];
    let fail = false;
    books.setBooksFetch((async (u: string, init: RequestInit) => {
      if (fail) return new Response(JSON.stringify({ message: "Books has no company yet" }), { status: 400 });
      sent.push({ path: new URL(u).pathname, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true, id: "fa_1" }), { status: 200 });
    }) as typeof fetch);
    try {
      await stock.adjust(leg, { kind: "receipt", qty: 4, unitCost: 6 }, me);
      await stock.adjust(leg, { kind: "adjust", qty: -1 }, me);
      fail = true;
      expect(await books.syncStockMoves()).toEqual({ synced: 0, failed: 1 });
      expect((await books.booksStatus()).lastError).toMatch(/no company/);
      fail = false;
      expect(await books.syncStockMoves()).toEqual({ synced: 2, failed: 0 });
      expect(sent.map((s) => [s.body.sku, s.body.qty, s.body.kind])).toEqual([["LEG-01", 4, "receipt"], ["LEG-01", -1, "adjust"]]);
      expect(sent[0].path).toBe("/api/svc/stock-moves");

      await expect(books.sendAsset((await assets.createAsset({ name: "Laptop" }, me)).id)).rejects.toThrow(/purchase date, cost and useful life/);
      const r = await books.sendAsset(pressId);
      expect(r.booksAssetId).toBe("fa_1");
      expect(sent.at(-1)).toMatchObject({ path: "/api/svc/fixed-assets", body: { tag: `AST-${year}-0001`, cost: 60000, lifeMonths: 120, acquisitionDate: "2024-01-01" } });
    } finally {
      books.setBooksFetch(undefined);
      delete process.env.OPS_BOOKS_URL;
      delete process.env.BOOKS_SVC_TOKEN;
    }
  });
});
