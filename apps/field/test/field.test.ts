import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PolicyClient } from "@synergy/compliance";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.COMPLIANCE_TOKEN = "test-token";
process.env.COMMERCE_SVC_TOKEN = "commerce-token";
process.env.BOOKS_SVC_TOKEN = "books-token";
process.env.DESK_API_TOKEN = "desk-token";
process.env.OPS_API_TOKEN = "ops-token";

const dana = "dana@example.com"; // first in: dispatcher
const tom = "tom@example.com"; // technician
const tia = "tia@example.com"; // technician
const eve = "eve@example.com"; // not on the team

const held = new Set<string>();
const fakePolicy: PolicyClient = {
  onHold: async (e) => held.has(e),
  retention: async () => [],
  retentionDays: async () => null,
  invalidate() {},
};

type Call = { method: string; url: string; body: Record<string, unknown> | null };
const calls: Call[] = [];
let commerceDown = false;

/** Stands in for Commerce, Books, Desk and Ops. */
const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
  const u = new URL(String(input));
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ method: init?.method ?? "GET", url: u.pathname + u.search, body });
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  if (u.port === "3730") {
    if (commerceDown) return json({ error: "down" }, 503);
    if (u.pathname === "/api/svc/items") {
      const all = [{ id: "p1", sku: "FLT-20", name: "Air filter 20in", unit: "each", cost: "4.0000", price: "12.50", onHand: 30 }];
      const sku = u.searchParams.get("sku");
      return json(sku ? all.filter((i) => i.sku.toLowerCase() === sku.toLowerCase()) : all);
    }
    if (u.pathname === "/api/svc/stock-moves") return json({ onHand: 28, unitCost: "4.0000" });
  }
  if (u.port === "3055" && u.pathname === "/api/svc/invoices") return json({ id: "inv-1", number: "INV-0042" });
  if (u.port === "3105") {
    if (u.pathname === "/api/svc/tickets/T-2026-0007") {
      return json({ number: "T-2026-0007", subject: "Boiler won't light", status: "open", priority: "high", requesterEmail: "pat@cafe.test", requesterName: "Pat's Cafe", firstMessage: "Pilot goes out." });
    }
    if (u.pathname.endsWith("/notes")) return json({ ok: true });
    return json({ error: "No ticket" }, 404);
  }
  if (u.port === "3760" && u.pathname === "/api/svc/assets") {
    return json([{ tag: "AST-0009", name: "Rooftop unit", category: "HVAC", location: "Roof", make: "Carrier", model: "48TC", serial: "C123", status: "active", purchaseDate: "2024-03-01" }]);
  }
  return json({ error: "unexpected" }, 500);
}) as typeof fetch;

describe.skipIf(!url)("field service", async () => {
  const staff = await import("../lib/staff");
  const customers = await import("../lib/customers");
  const wos = await import("../lib/workorders");
  const schedule = await import("../lib/schedule");
  const parts = await import("../lib/parts");
  const billing = await import("../lib/billing");
  const desk = await import("../lib/desk");
  const ops = await import("../lib/ops");
  const { searchFor } = await import("../lib/search");
  const { setLinkFetch } = await import("../lib/links");
  const { setPolicy } = await import("../lib/compliance");
  const { q, db } = await import("../lib/db");
  const searchRoute = await import("../app/api/compliance/search/route");
  const exportRoute = await import("../app/api/compliance/export/route");

  const post = (route: { POST: (r: Request) => Promise<Response> }, body: unknown) =>
    route.POST(new Request("http://field/api", { method: "POST", headers: { authorization: "Bearer test-token" }, body: JSON.stringify(body) }));

  beforeAll(async () => {
    await q("SELECT 1");
    await q("TRUNCATE staff, settings, customers, work_orders CASCADE");
    setLinkFetch(fakeFetch);
    setPolicy(fakePolicy);
  });
  afterAll(async () => {
    setLinkFetch(undefined);
    setPolicy(undefined);
    await db().close();
  });

  let customerId = "";
  let assetId = "";
  let woId = "";

  it("makes the first person in a dispatcher and keeps everyone else out until added", async () => {
    expect(await staff.roleOf(dana, "Dana")).toBe("dispatcher");
    expect(await staff.roleOf(eve)).toBeNull();
    await expect(staff.requireStaff(eve)).rejects.toThrow(/not on the field service team/);
    await staff.saveStaff(dana, { email: tom, name: "Tom", role: "technician", skills: "HVAC, boilers", billRate: "110" });
    await staff.saveStaff(dana, { email: tia, name: "Tia", role: "technician", skills: ["electrical"] });
    expect(await staff.roleOf(tom)).toBe("technician");
    await expect(staff.saveStaff(tom, { email: eve, role: "dispatcher" })).rejects.toThrow(/Only dispatchers/);
    await expect(staff.saveStaff(dana, { email: dana, role: "technician" })).rejects.toThrow(/at least one dispatcher/);
    await staff.saveSettings(dana, { laborRate: "95", tripFee: "40", timeZone: "America/Chicago" });
    expect((await staff.getSettings()).tripFeeCents).toBe(4000);
    expect(await staff.rateFor(tom)).toBe(11000);
    expect(await staff.rateFor(tia)).toBe(9500);
  });

  it("keeps customers and their equipment, and brings assets in from Ops by tag", async () => {
    const c = await customers.saveCustomer(dana, null, { name: "Acme Bakery", email: "ops@acme.test", address: "1 Main St" });
    customerId = c.id;
    const a = await customers.saveAsset(dana, null, { customerId, name: "Oven 2", make: "Rational", serial: "R-77", warrantyUntil: "2099-01-01" });
    assetId = a.id;
    expect(a.underWarranty).toBe(true);
    const imported = await ops.importOpsAsset(dana, customerId, "ast-0009");
    expect(imported).toMatchObject({ name: "Rooftop unit", make: "Carrier", serial: "C123", opsTag: "AST-0009", installedOn: "2024-03-01" });
    await expect(ops.importOpsAsset(dana, customerId, "AST-0009")).rejects.toThrow(/already on this customer/);
    expect((await customers.getCustomer(tom, customerId)).assets).toHaveLength(2);
    await expect(customers.saveCustomer(tom, customerId, { name: "Mine" })).rejects.toThrow(/Only dispatchers/);
  });

  it("opens a work order with a starter checklist and the customer's address", async () => {
    const w = await wos.createWorkOrder(dana, { customerId, assetId, title: "Oven not heating", kind: "repair", priority: "high", skill: "HVAC", estimateHours: "2" });
    woId = w.id;
    expect(w.number).toMatch(/^WO-\d{5}$/);
    expect(w).toMatchObject({ status: "new", address: "1 Main St", skill: "hvac", estimateMinutes: 120, assetName: "Oven 2" });
    expect(w.checklist.length).toBeGreaterThan(2);
    // Technicians only see jobs booked to them.
    await expect(wos.getWorkOrder(tom, woId)).rejects.toThrow(/doesn't exist/);
    expect(await wos.listWorkOrders(tom)).toEqual([]);
  });

  it("suggests the technician with the skill and the earliest gap", async () => {
    const now = new Date("2026-10-19T13:00:00Z"); // Mon 8:00 in Chicago
    const s = await schedule.suggest(dana, woId, "2026-10-19", now);
    expect(s[0]).toMatchObject({ technician: tom, skillMatch: true, start: "2026-10-19T13:00:00.000Z", end: "2026-10-19T15:00:00.000Z" });
    expect(s.find((x) => x.technician === tia)?.skillMatch).toBe(false);
    // Friday evening: the next slot is Monday morning, not the weekend.
    const fri = await schedule.suggest(dana, woId, "2026-10-16", new Date("2026-10-16T23:00:00Z"));
    expect(fri[0].start).toBe("2026-10-19T13:00:00.000Z");
  });

  it("books, and refuses double-booking unless forced", async () => {
    const b = await schedule.book(dana, { workOrderId: woId, technician: tom, start: "2026-10-19T13:00:00Z", end: "2026-10-19T15:00:00Z" });
    expect(b.status).toBe("scheduled");
    expect((await wos.getWorkOrder(tom, woId)).status).toBe("scheduled");
    const other = await wos.createWorkOrder(dana, { customerId, title: "Check fridge" });
    await expect(schedule.book(dana, { workOrderId: other.id, technician: tom, start: "2026-10-19T14:00:00Z", end: "2026-10-19T16:00:00Z" })).rejects.toThrow(/overlaps WO-/);
    const forced = await schedule.book(dana, { workOrderId: other.id, technician: tom, start: "2026-10-19T14:00:00Z", end: "2026-10-19T16:00:00Z", force: true });
    await schedule.cancelBooking(dana, forced.id);
    expect((await wos.getWorkOrder(dana, other.id)).status).toBe("new");
    const s = await schedule.suggest(dana, woId, "2026-10-19", new Date("2026-10-19T13:00:00Z"));
    expect(s.find((x) => x.technician === tom)?.start).toBe("2026-10-19T15:00:00.000Z");

    const board = await schedule.board(dana, "2026-10-19T05:00:00Z", "2026-10-20T05:00:00Z");
    expect(board.bookings.map((x) => x.id)).toEqual([b.id]);
    expect(board.unscheduled.map((x) => x.id)).toContain(other.id);
    expect(board.timeZone).toBe("America/Chicago");
    expect((await wos.listWorkOrders(dana, { open: true })).map((x) => x.number).sort()).toEqual([other.number, (await wos.getWorkOrder(dana, woId)).number].sort());
    expect(await wos.listWorkOrders(tom, { open: true })).toHaveLength(1);
    await expect(schedule.board(tom, "2026-10-19T05:00:00Z", "2026-10-20T05:00:00Z")).rejects.toThrow(/Only dispatchers/);
  });

  it("walks a visit from on the way to done and records the time on site", async () => {
    const mine = await schedule.myVisits(tom, "2026-10-19T05:00:00Z", "2026-10-20T05:00:00Z");
    expect(mine.visits).toHaveLength(1);
    const visit = mine.visits[0];
    await expect(schedule.step(tia, visit.id, "travel")).rejects.toThrow(/doesn't exist/);
    await expect(schedule.step(tom, visit.id, "finish")).rejects.toThrow(/Arrive on site/);
    await schedule.step(tom, visit.id, "travel");
    await schedule.step(tom, visit.id, "arrive");
    expect((await wos.getWorkOrder(tom, woId)).status).toBe("in_progress");
    await q("UPDATE bookings SET arrived_at = now() - interval '90 minutes' WHERE id = $1", [visit.id]);
    await schedule.step(tom, visit.id, "finish");
    const w = await wos.getWorkOrder(tom, woId);
    expect(w.status).toBe("on_hold"); // no other visit booked
    expect(w.labor).toHaveLength(1);
    expect(w.labor[0]).toMatchObject({ technician: tom, minutes: 90, rateCents: 11000 });
  });

  it("takes parts from Commerce stock and retries ones that didn't arrive", async () => {
    expect(await parts.searchCatalog(tom, "filter")).toEqual([{ sku: "FLT-20", name: "Air filter 20in", unit: "each", priceCents: 1250, onHand: 30 }]);
    calls.length = 0;
    await parts.addPart(tom, woId, { sku: "flt-20", qty: 2 });
    const move = calls.find((c) => c.url === "/api/svc/stock-moves");
    expect(move?.body).toMatchObject({ sku: "FLT-20", qty: -2, kind: "service_issue", account: "5000" });
    expect(String(move?.body?.reference)).toMatch(/^field-part-\d+$/);
    let w = await wos.getWorkOrder(tom, woId);
    expect(w.parts[0]).toMatchObject({ name: "Air filter 20in", qty: 2, unitPriceCents: 1250, syncStatus: "synced" });
    await expect(parts.removePart(tom, woId, w.parts[0].id)).rejects.toThrow(/Return it in Commerce/);

    commerceDown = true;
    await expect(parts.addPart(tom, woId, { sku: "FLT-20", qty: 1 })).rejects.toThrow(/Commerce/);
    commerceDown = false;
    // Lookup failed, so nothing was recorded; now one goes in but its send fails.
    const realFetch = fakeFetch;
    setLinkFetch((async (input: string | URL, init?: RequestInit) =>
      String(input).includes("stock-moves") ? new Response(JSON.stringify({ error: "down" }), { status: 503 }) : realFetch(input, init)) as typeof fetch);
    await parts.addPart(tom, woId, { sku: "FLT-20", qty: 1 });
    setLinkFetch(fakeFetch);
    expect(await parts.partsLink()).toMatchObject({ linked: true, failed: 1 });
    expect(await parts.syncParts()).toEqual({ synced: 1, failed: 0 });
    w = await wos.getWorkOrder(tom, woId);
    expect(w.parts.map((p) => p.syncStatus)).toEqual(["synced", "synced"]);
  });

  it("completes the job with a signature and bills it to Books once", async () => {
    await expect(billing.bill(dana, woId)).rejects.toThrow(/Complete the job/);
    const sig = `data:image/png;base64,${Buffer.from("png").toString("base64")}`;
    await expect(schedule.complete(tom, woId, { resolution: "" })).rejects.toThrow(/Say what was done/);
    await schedule.complete(tom, woId, { resolution: "Replaced the element and filters", signedBy: "Sam", signature: sig });
    const w = await wos.getWorkOrder(dana, woId);
    expect(w).toMatchObject({ status: "completed", signedBy: "Sam", signature: sig, completedBy: tom });
    await expect(wos.addCheck(tom, woId, "late step")).rejects.toThrow(/complete/);

    const p = await billing.preview(dana, woId);
    // 1.5 h at 110, 3 filters at 12.50, one visit at 40.
    expect(p.lines.map((l) => [l.kind, l.quantity, l.amountCents])).toEqual([["labor", 1.5, 16500], ["part", 3, 3750], ["trip", 1, 4000]]);
    expect(p.totalCents).toBe(24250);
    expect(p.warranty).toBe(true);
    calls.length = 0;
    const done = await billing.bill(dana, woId);
    expect(done).toMatchObject({ status: "sent", booksNumber: "INV-0042", totalCents: 24250 });
    const inv = calls.find((c) => c.url === "/api/svc/invoices")!;
    expect(inv.body).toMatchObject({ customer: { name: "Acme Bakery", email: "ops@acme.test" }, reference: w.number, currency: "USD" });
    expect((inv.body!.lines as unknown[])[0]).toEqual({ description: "Labor: Tom (1.5 h)", quantity: 1.5, unitPrice: 110 });
    await expect(billing.bill(dana, woId)).rejects.toThrow(/already been billed/);
    await expect(wos.updateWorkOrder(dana, woId, { status: "in_progress" })).rejects.toThrow(/billed/);
    await expect(wos.deleteWorkOrder(dana, woId)).rejects.toThrow(/stays on record/);
  });

  it("turns a Desk case into a work order and keeps the case posted", async () => {
    calls.length = 0;
    const id = await desk.workOrderFromTicket(dana, { number: "t-2026-0007" });
    const w = await wos.getWorkOrder(dana, id);
    expect(w).toMatchObject({ title: "Boiler won't light", priority: "high", deskTicket: "T-2026-0007", customerName: "Pat's Cafe", customerEmail: "pat@cafe.test" });
    expect(calls.some((c) => c.url === "/api/svc/tickets/T-2026-0007/notes" && String(c.body?.body).includes(w.number))).toBe(true);
    await expect(desk.workOrderFromTicket(dana, { number: "T-2026-0007" })).rejects.toThrow(/already has work order/);
    await expect(desk.workOrderFromTicket(dana, { number: "T-2026-9999" })).rejects.toThrow(/Desk/);
    calls.length = 0;
    await schedule.book(dana, { workOrderId: id, technician: tia, start: "2026-10-20T15:00:00Z", end: "2026-10-20T16:00:00Z" });
    expect(calls.find((c) => c.url.endsWith("/notes"))?.body?.body).toMatch(/technician is booked for Tue, Oct 20, 10:00 AM/);
  });

  it("finds jobs for the people who can see them in suite search", async () => {
    const me = (email: string) => ({ email, name: "", subject: email });
    const asDana = await searchFor(me(dana), { query: "oven" });
    expect(asDana.results.map((r) => r.kind).sort()).toEqual(["asset", "work_order"]);
    const asTom = await searchFor(me(tom), { query: "oven" });
    expect(asTom.results.map((r) => r.kind).sort()).toEqual(["asset", "work_order"]);
    expect((await searchFor(me(tia), { query: "oven" })).results).toEqual([]);
    expect((await searchFor(me(tia), { query: "boiler" })).results.map((r) => r.kind)).toEqual(["work_order"]);
    expect((await searchFor(me(eve), { query: "oven" })).results).toEqual([]);
  });

  it("answers eDiscovery and keeps deleted things under hold", async () => {
    const other = await wos.createWorkOrder(dana, { customerId, title: "Quote for new fryer" });
    await wos.addNote(dana, other.id, "Customer wants a gas fryer");
    held.add(dana);
    await wos.deleteWorkOrder(dana, other.id);
    await expect(wos.getWorkOrder(dana, other.id)).rejects.toThrow(/doesn't exist/);
    const res = await (await post(searchRoute, { query: "fryer", custodians: [dana] })).json();
    expect(res.hits.map((h: { kind: string; deleted?: boolean }) => [h.kind, !!h.deleted]).sort()).toEqual([["note", true], ["work_order", true]]);
    const tomHits = await (await post(searchRoute, { query: "element", custodians: [tom] })).json();
    expect(tomHits.hits.map((h: { kind: string }) => h.kind)).toEqual(["work_order"]);
    const ex = await (await post(exportRoute, { ids: [woId] })).json();
    expect(ex.items[0].metadata).toMatchObject({ signed_by: "Sam", invoice_status: "sent" });
    expect(ex.items[0].metadata.parts).toHaveLength(2);
    expect(ex.items[0].attachments[0]).toMatchObject({ name: "signature.png", type: "image/png" });
    const bad = await searchRoute.POST(new Request("http://field/api", { method: "POST", body: "{}" }));
    expect(bad.status).toBe(401);
    held.clear();
  });
});
