import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "../lib/types";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
delete process.env.BOOKS_INTERNAL_URL;

const admin: Ctx = { email: "ann@example.com", name: "Ann", role: "admin" };
const staff: Ctx = { email: "sam@example.com", name: "Sam", role: "staff" };

describe("settle", async () => {
  const { settle } = await import("../lib/sales");
  it("applies card first and gives change from cash", () => {
    const out = settle(2575, [{ method: "cash", amount: "20" }, { method: "card", amount: "10" }]);
    expect(out).toEqual([
      { method: "card", amount: 1000, tendered: null, change: null, ref: "" },
      { method: "cash", amount: 1575, tendered: 2000, change: 425, ref: "" },
    ]);
  });
  it("refuses short payment and card over the total", () => {
    expect(() => settle(1000, [{ method: "cash", amount: "5" }])).toThrow(/5.00 still to pay/);
    expect(() => settle(1000, [{ method: "card", amount: "11" }])).toThrow(/more than is owed/);
    expect(() => settle(1000, [{ method: "online", amount: "10" }])).toThrow(/payment provider/);
  });
});

describe.skipIf(!url)("commerce", async () => {
  const { q, db } = await import("../lib/db");
  const members = await import("../lib/members");
  const settings = await import("../lib/settings");
  const catalog = await import("../lib/catalog");
  const stock = await import("../lib/stock");
  const purchasing = await import("../lib/purchasing");
  const sales = await import("../lib/sales");
  const store = await import("../lib/store");
  const search = await import("../lib/search");
  const ediscovery = await import("../lib/ediscovery");
  const { parseSearch } = await import("../lib/compliance");
  const { balanced } = await import("../lib/books");
  const svc = await import("../lib/svc");

  let loc: string;
  let register: string;
  let widget: string;
  let gadget: string;
  let service: string;
  let vendor: string;

  beforeAll(async () => {
    await q("SELECT 1");
    await q(`TRUNCATE members, settings, postings, refunds, payments, order_lines, orders, shifts, registers, receipt_lines, receipts,
      po_lines, purchase_orders, svc_moves, movements, stock, products, vendors, locations CASCADE`);
    (globalThis as { __commerceSetup?: unknown }).__commerceSetup = undefined;
  });
  afterAll(async () => {
    await db().close();
  });

  it("makes the first person admin and sets up a store and register", async () => {
    expect((await members.join("ann@example.com", "Ann")).role).toBe("admin");
    expect((await members.join("sam@example.com", "Sam")).role).toBe("staff");
    const s = await settings.getSettings();
    const locs = await catalog.locations();
    expect(locs).toHaveLength(1);
    loc = locs[0].id;
    expect(s.store.locationId).toBe(loc);
    const regs = await sales.registers();
    expect(regs).toHaveLength(1);
    register = regs[0].id;
    await settings.saveSettings(admin, { defaultTaxRate: 10, store: { enabled: true, shipping: true, shippingFee: "5" } });
    await expect(settings.saveSettings(staff, { storeName: "X" })).rejects.toThrow(/admin/);
  });

  it("keeps the catalog to managers and refuses duplicate SKUs", async () => {
    vendor = (await catalog.saveVendor(admin, null, { name: "Acme Supply", email: "orders@acme.test" })).id;
    widget = (await catalog.saveProduct(admin, null, { sku: "W-1", name: "Widget", price: "10", reorderPoint: 5, reorderQty: 20, vendorId: vendor, online: true, barcode: "0123456789012" })).id;
    gadget = (await catalog.saveProduct(admin, null, { sku: "G-1", name: "Gadget", price: "25.50", taxRate: "0", vendorId: vendor, online: true })).id;
    service = (await catalog.saveProduct(admin, null, { sku: "GIFTWRAP", name: "Gift wrap", price: "2", trackStock: false })).id;
    await expect(catalog.saveProduct(staff, null, { sku: "S-1", name: "Nope", price: "1" })).rejects.toThrow(/manager/);
    await expect(catalog.saveProduct(admin, null, { sku: "w-1", name: "Dupe", price: "1" })).rejects.toMatchObject({ code: "23505" });
    expect((await catalog.lookup("0123456789012"))?.sku).toBe("W-1");
    expect((await catalog.lookup("g-1"))?.sku).toBe("G-1");
  });

  it("suggests reordering and receives deliveries at average cost, booking a bill", async () => {
    const sugg = await stock.reorderSuggestions();
    expect(sugg.map((x) => x.sku)).toEqual(["W-1"]);
    expect(sugg[0].suggest).toBe(20);
    const [po] = await purchasing.draftFromSuggestions(admin, { productIds: [widget], locationId: loc });
    expect(po.status).toBe("draft");
    expect(po.lines[0]).toMatchObject({ qty: 20 });
    const withGadget = await purchasing.updatePo(admin, po.id, {
      lines: [{ productId: widget, qty: 20, unitCost: "4" }, { productId: gadget, qty: 10, unitCost: "12" }],
    });
    expect(withGadget.total).toBe("200.00");
    await expect(purchasing.receive(staff, po.id, { all: true })).rejects.toThrow(/Place the order/);
    await purchasing.placePo(admin, po.id);
    // Staff receive at the door: 10 widgets now at a better price, the rest later.
    const part = await purchasing.receive(staff, po.id, { lines: [{ lineId: withGadget.lines[0].id, qty: 10, unitCost: "3" }], vendorRef: "INV-77" });
    expect(part.status).toBe("partial");
    await expect(purchasing.receive(staff, po.id, { lines: [{ lineId: withGadget.lines[0].id, qty: 11 }] })).rejects.toThrow(/More W-1/);
    const done = await purchasing.receive(staff, po.id, { all: true });
    expect(done.status).toBe("received");
    expect(done.receipts.map((r) => r.total)).toEqual(["30.00", "160.00"]);
    const w = await catalog.product(widget);
    expect(w.onHand).toBe(20);
    expect(w.cost).toBe("3.50");
    const posts = await q<{ reference: string; payload: { lines: { debit: number; credit: number }[]; bill?: { vendor: { name: string } } } }>(
      "SELECT reference, payload FROM postings WHERE kind = 'receipt' ORDER BY id",
    );
    expect(posts.map((p) => p.reference)).toEqual([`commerce:receipt:${po.number}-R1`, `commerce:receipt:${po.number}-R2`]);
    expect(posts[1].payload.bill?.vendor.name).toBe("Acme Supply");
    expect(posts.every((p) => balanced(p.payload.lines as never))).toBe(true);
    expect(await stock.reorderSuggestions()).toEqual([]);
  });

  it("rings up a register sale with discounts, split tender and change", async () => {
    await expect(sales.registerSale(staff, { registerId: register, items: [{ productId: widget, qty: 1 }], payments: [{ method: "cash", amount: "20" }] })).rejects.toThrow(/Open the register/);
    await sales.openShift(staff, register, { float: "100" });
    const { order, change } = await sales.registerSale(staff, {
      registerId: register,
      items: [{ productId: widget, qty: 3 }, { productId: gadget, qty: 1 }, { productId: service, qty: 1 }],
      orderDiscount: "5",
      payments: [{ method: "card", amount: "20" }, { method: "cash", amount: "50" }],
    });
    // 30 + 25.50 + 2 = 57.50, less 5 shared; tax 10% on widgets and wrap, none on the gadget.
    expect(order).toMatchObject({ subtotal: "57.50", discount: "5.00", status: "paid", channel: "pos", cashier: staff.email });
    expect(Number(order.total)).toBeCloseTo(52.5 + Number(order.tax), 2);
    expect(order.lines.reduce((a, l) => a + Number(l.total), 0).toFixed(2)).toBe(order.total);
    expect(change).toBe((70 - Number(order.total)).toFixed(2));
    expect((await catalog.product(widget)).onHand).toBe(17);
    const [post] = await q<{ payload: { lines: { account: string; debit: number; credit: number }[] } }>(
      "SELECT payload FROM postings WHERE reference = $1",
      [`commerce:sale:${order.number}`],
    );
    expect(balanced(post.payload.lines as never)).toBe(true);
    // Three widgets and a gadget left the shelf at average cost: 3 x 3.50 + 13.27 (gadget's average after both receipts).
    expect(post.payload.lines.find((l) => l.account === "5000")?.debit).toBeGreaterThan(0);
  });

  it("refunds part of a sale, puts it back and closes the drawer", async () => {
    const [o] = await sales.orders({ channel: "pos" });
    const full = await sales.order(o.id);
    const widgetLine = full.lines.find((l) => l.sku === "W-1")!;
    await expect(sales.refund(staff, o.id, { lines: [{ lineId: widgetLine.id, qty: 1 }] })).rejects.toThrow(/manager/);
    const first = await sales.refund(admin, o.id, { lines: [{ lineId: widgetLine.id, qty: 1 }], method: "cash", registerId: register });
    const second = await sales.refund(admin, o.id, { lines: [{ lineId: widgetLine.id, qty: 2 }], method: "cash", registerId: register, restock: false });
    expect((Number(first.amount) + Number(second.amount)).toFixed(2)).toBe(widgetLine.total);
    expect(second.order.status).toBe("partially_refunded");
    await expect(sales.refund(admin, o.id, { lines: [{ lineId: widgetLine.id, qty: 1 }] })).rejects.toThrow(/can still be refunded/);
    expect((await catalog.product(widget)).onHand).toBe(18);
    const closed = await sales.closeShift(staff, register, { counted: "130" });
    const cashIn = Number(full.payments.find((p) => p.method === "cash")!.amount) - Number(first.amount) - Number(second.amount);
    expect(closed.expectedCash).toBe((100 + cashIn).toFixed(2));
    expect(closed.over).toBe((130 - 100 - cashIn).toFixed(2));
  });

  it("takes an online order, holds the stock, and books it when paid at pickup", async () => {
    const listed = await store.storeProducts();
    expect(listed.map((p) => p.sku).sort()).toEqual(["G-1", "W-1"]);
    expect(listed.find((p) => p.sku === "W-1")).not.toHaveProperty("cost");
    await expect(sales.placeOnlineOrder({ items: [{ productId: service, qty: 1 }], name: "Pat", email: "pat@example.com" })).rejects.toThrow(/no longer for sale/);
    await expect(sales.placeOnlineOrder({ items: [{ productId: widget, qty: 99 }], name: "Pat", email: "pat@example.com" })).rejects.toThrow(/Only 18/);
    const placed = await sales.placeOnlineOrder({ items: [{ productId: widget, qty: 2 }], name: "Pat", email: "Pat@Example.com", delivery: "ship", address: "1 Main Street, Springfield" });
    const o = (await sales.orderByToken(placed.token))!;
    expect(o).toMatchObject({ status: "pending", fulfillment: "unfulfilled", delivery: "ship", customerEmail: "pat@example.com" });
    expect(o.lines.map((l) => l.sku)).toEqual(["W-1", "DELIVERY"]);
    expect(o.total).toBe("27.00");
    expect((await catalog.product(widget)).onHand).toBe(16);
    expect(await q("SELECT 1 FROM postings WHERE reference = $1", [`commerce:sale:${o.number}`])).toHaveLength(0);
    await expect(sales.fulfil(staff, o.id, "fulfilled")).rejects.toThrow(/Take payment/);
    await sales.fulfil(staff, o.id, "ready");
    await sales.openShift(staff, register, {});
    const paid = await sales.takePayment(staff, o.id, { registerId: register, payments: [{ method: "card", amount: "27" }] });
    expect(paid.order.status).toBe("paid");
    expect((await sales.fulfil(staff, o.id, "fulfilled")).fulfillment).toBe("fulfilled");
    expect(await q("SELECT 1 FROM postings WHERE reference = $1", [`commerce:sale:${o.number}`])).toHaveLength(1);
  });

  it("records a provider's payment once and cancels unpaid orders back onto the shelf", async () => {
    const a = await sales.placeOnlineOrder({ items: [{ productId: gadget, qty: 1 }], name: "Lee", email: "lee@example.com" });
    await expect(sales.onlinePaid({ order: a.number, amount: "1", ref: "pay_1" })).rejects.toThrow(/does not match/);
    expect(await sales.onlinePaid({ order: a.number, amount: a.total, ref: "pay_1" })).toEqual({ ok: true, status: "paid" });
    expect(await sales.onlinePaid({ order: a.number, amount: a.total, ref: "pay_1" })).toEqual({ ok: true, status: "paid" });
    const before = (await catalog.product(widget)).onHand;
    const b = await sales.placeOnlineOrder({ items: [{ productId: widget, qty: 3 }], name: "Lee", email: "lee@example.com" });
    expect((await catalog.product(widget)).onHand).toBe(before - 3);
    await sales.cancelOrder(staff, b.id, "Changed mind");
    expect((await catalog.product(widget)).onHand).toBe(before);
    await expect(sales.cancelOrder(staff, a.id)).rejects.toThrow(/refund a paid one/);
  });

  it("counts and moves stock, posting gains and losses", async () => {
    const w = await catalog.saveLocation(admin, null, { name: "Back room", kind: "warehouse" });
    await stock.transfer(admin, { productId: widget, from: loc, to: w.id, qty: 4 });
    const lv = await catalog.levels(widget);
    expect(lv.find((l) => l.locationId === w.id)?.onHand).toBe(4);
    const counted = await stock.adjust(admin, { productId: widget, locationId: w.id, mode: "count", qty: 3, note: "Shelf count" });
    expect(counted).toEqual({ onHand: 3, change: -1 });
    const [p] = await q<{ payload: { lines: { account: string; credit: number }[] } }>("SELECT payload FROM postings WHERE kind = 'adjustment' ORDER BY id DESC LIMIT 1");
    expect(p.payload.lines.find((l) => l.account === "1200")?.credit).toBe(350);
    await expect(stock.adjust(staff, { productId: widget, locationId: loc, qty: 1 })).rejects.toThrow(/manager/);
    await expect(stock.adjust(admin, { productId: service, locationId: loc, qty: 1 })).rejects.toThrow(/isn't stock-tracked/);
    const sheet = await stock.stockSheet();
    expect(sheet.rows.find((r) => r.sku === "W-1")?.levels[w.id]).toBe(3);
  });

  it("archives products with history instead of deleting them", async () => {
    expect(await catalog.deleteProduct(admin, widget)).toEqual({ archived: true });
    const tmp = await catalog.saveProduct(admin, null, { sku: "TMP", name: "Temp", price: "1" });
    expect(await catalog.deleteProduct(admin, tmp.id)).toEqual({ archived: false });
    await catalog.saveProduct(admin, widget, { ...(await catalog.product(widget)), active: true, online: true });
  });

  it("answers suite search and eDiscovery", async () => {
    const found = await search.searchAll({ query: "widget" });
    expect(found.results.some((r) => r.kind === "product" && r.url === `/#/products/${widget}`)).toBe(true);
    const lee = await search.searchAll({ query: "lee", kinds: ["order"] });
    expect(lee.results.length).toBe(2);
    const ed = await ediscovery.search(parseSearch({ custodians: ["pat@example.com"] }, ediscovery.KINDS));
    expect(ed.total).toBe(1);
    expect(ed.hits[0]).toMatchObject({ kind: "order", owner: "pat@example.com" });
    expect(ed.hits[0].participants).toBeUndefined();
    const bySam = await ediscovery.search(parseSearch({ custodians: [staff.email], kinds: ["order"] }, ediscovery.KINDS));
    expect(bySam.total).toBe(1);
    const pos = await ediscovery.search(parseSearch({ query: "acme" }, ediscovery.KINDS));
    expect(pos.hits.map((h) => h.kind)).toEqual(["purchase_order"]);
    const ex = await ediscovery.exportItems([ed.hits[0].id, pos.hits[0].id]);
    expect(ex.items.map((i) => i.kind)).toEqual(["order", "purchase_order"]);
    expect((ex.items[0].metadata.lines as unknown[]).length).toBe(2);
  });

  it("moves stock for Operations through the service API, once per reference", async () => {
    expect(svc.svcAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(svc.svcAuthorized("Bearer nope", "s3cret")).toBe(false);
    expect(svc.svcAuthorized("Bearer ", "")).toBe(false);
    const [g] = await svc.svcItems({ skus: ["G-1"] });
    expect(g).toMatchObject({ sku: "G-1", cost: "12.0000" });
    expect(g.byLocation).toEqual([{ locationId: loc, onHand: g.onHand }]);
    expect((await svc.svcLocations())[0].id).toBe(loc);

    const issue = { reference: "ops:wo-issue:1", sku: "G-1", qty: -2, kind: "mfg_issue", account: "1300" };
    const first = await svc.stockMove(issue);
    expect(first).toEqual({ onHand: g.onHand - 2, unitCost: "12.0000" });
    expect(await svc.stockMove(issue)).toEqual({ duplicate: true, onHand: g.onHand - 2, unitCost: "12.0000" });
    const [p] = await q<{ payload: { kind: string; lines: { account: string; debit: number; credit: number }[] } }>(
      "SELECT payload FROM postings WHERE reference = 'commerce:svc:ops:wo-issue:1'",
    );
    expect(p.payload.kind).toBe("adjustment");
    expect(p.payload.lines).toMatchObject([{ account: "1300", debit: 2400 }, { account: "1200", credit: 2400 }]);

    // Made at a different cost, which moves the average; no account given uses the adjustment account.
    const made = await svc.stockMove({ reference: "ops:wo-receipt:1", sku: "G-1", qty: 2, unitCost: "15", kind: "mfg_receipt" });
    expect(made).toEqual({ onHand: g.onHand, unitCost: "15.0000" });
    expect((await svc.svcItems({ q: "gadget" }))[0].cost).not.toBe("12.0000");
    const [r] = await q<{ payload: { lines: { account: string; debit: number; credit: number }[] } }>(
      "SELECT payload FROM postings WHERE reference = 'commerce:svc:ops:wo-receipt:1'",
    );
    expect(r.payload.lines).toMatchObject([{ account: "1200", debit: 3000 }, { account: "5000", credit: 3000 }]);

    await expect(svc.stockMove({ reference: "ops:x:1", sku: "G-1", qty: -(g.onHand + 1), kind: "maint_issue" })).rejects.toMatchObject({ status: 409 });
    await expect(svc.stockMove({ reference: "ops:x:2", sku: "G-1", qty: 1, kind: "mfg_issue" })).rejects.toThrow(/negative qty/);
    await expect(svc.stockMove({ reference: "ops:x:3", sku: "NOPE", qty: -1, kind: "mfg_issue" })).rejects.toMatchObject({ status: 404 });
    await expect(svc.stockMove({ reference: "ops:x:4", sku: "GIFTWRAP", qty: -1, kind: "mfg_issue" })).rejects.toThrow(/stock-tracked/);
    await expect(svc.stockMove({ reference: "ops:x:5", sku: "G-1", qty: -1, kind: "sale" })).rejects.toThrow(/kind must be/);
    expect((await svc.svcItems({ skus: ["G-1"] }))[0].onHand).toBe(g.onHand);
  });

  it("keeps every queued posting balanced", async () => {
    const rows = await q<{ payload: { lines: { debit: number; credit: number }[] } }>("SELECT payload FROM postings");
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) expect(balanced(r.payload.lines as never)).toBe(true);
  });
});
