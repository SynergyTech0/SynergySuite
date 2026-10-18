import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.CONTACTS_INTERNAL_URL = "http://127.0.0.1:9";
process.env.SUITE_DOMAIN = "example.com";
delete process.env.BOOKINGS_SMTP_HOST;

const alice = { email: "alice@example.com", name: "Alice Admin" };
const bob = { email: "bob@example.com", name: "Bob Staff" };
const eve = { email: "eve@example.com", name: "Eve Outsider" };

/** A stand-in for Calendar's service API: one busy block, and the events Bookings adds. */
const calendar = { busy: [] as { email: string; start: string; end: string }[], events: new Map<string, Record<string, unknown>>(), next: 1 };
let server: Server;

describe.skipIf(!url)("bookings", async () => {
  const pages = await import("../lib/pages");
  const appts = await import("../lib/appointments");
  const { outbox } = await import("../lib/mailer");
  const { q, db } = await import("../lib/db");
  const { searchFor } = await import("../lib/search");
  const ed = await import("../lib/ediscovery");
  const { parseSearch } = await import("../lib/compliance");

  const sent: { to: string; subject: string; ics?: { method: string } }[] = [];
  outbox.send = async (m) => {
    sent.push(m);
    return { sent: true };
  };

  // Mondays to Fridays 9-5 in New York, booked from a Friday noon.
  const now = Date.parse("2026-10-16T16:00:00Z");
  const monday = "2026-10-19";
  const at = (hhmm: string) => new Date(`${monday}T${hhmm}:00-04:00`).toISOString();
  let page: Awaited<ReturnType<typeof pages.createPage>>;
  let service: Awaited<ReturnType<typeof pages.createService>>;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.headers.authorization !== "Bearer cal-token") return void res.writeHead(401).end();
      const u = new URL(req.url!, "http://x");
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const json = (v: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(v));
        if (u.pathname === "/api/svc/freebusy") return json({ busy: calendar.busy.filter((b) => b.email === u.searchParams.get("email")) });
        if (u.pathname === "/api/svc/events" && req.method === "POST") {
          const id = String(calendar.next++);
          calendar.events.set(id, JSON.parse(body));
          return json({ id });
        }
        const m = u.pathname.match(/^\/api\/svc\/events\/(\d+)$/);
        if (m && req.method === "PATCH") {
          calendar.events.set(m[1], { ...calendar.events.get(m[1]), ...JSON.parse(body) });
          return json({ ok: true });
        }
        if (m && req.method === "DELETE") {
          calendar.events.delete(m[1]);
          return json({ ok: true });
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    process.env.CALENDAR_INTERNAL_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.CAL_SVC_TOKEN = "cal-token";
    await q("SELECT 1");
    await q("TRUNCATE pages CASCADE");
  });
  afterAll(async () => {
    server.close();
    await db().close();
  });
  beforeEach(() => {
    sent.length = 0;
  });

  it("makes a page with its maker as admin and a first service", async () => {
    page = await pages.createPage(alice, { name: "Contoso Clinic", timeZone: "America/New_York" });
    expect(page.slug).toBe("contoso-clinic");
    expect(page.staff).toMatchObject([{ email: alice.email, role: "admin" }]);
    expect(page.services.map((s) => s.name)).toEqual(["Consultation"]);
    expect((await pages.createPage(alice, { name: "Contoso Clinic" })).slug).toBe("contoso-clinic-2");
    await expect(pages.createPage(alice, { name: "x", timeZone: "Mars/Olympus" })).rejects.toThrow(/time zone/);
  });

  it("lets only admins change a page, and nobody else see it", async () => {
    page = await pages.setStaff(alice, page.id, [
      { email: alice.email, name: alice.name, role: "admin" },
      { email: bob.email, name: bob.name, role: "staff" },
    ]);
    expect(page.staff.map((s) => s.email).sort()).toEqual([alice.email, bob.email]);
    await expect(pages.updatePage(bob, page.id, { name: "Mine now" })).rejects.toThrow(/admins/);
    await expect(pages.pageFor(eve, page.id)).rejects.toThrow(/not found/);
    await expect(pages.setStaff(alice, page.id, [{ email: bob.email, role: "staff" }])).rejects.toThrow(/admin/);
    expect((await pages.myPages(bob)).map((p) => p.id)).toEqual([page.id]);
  });

  it("keeps unpublished pages private", async () => {
    await expect(appts.bookPublic(page.slug, {}, now)).rejects.toThrow(/not found/);
    page = await pages.updatePage(alice, page.id, { published: true, minNoticeMin: 60 });
    service = await pages.createService(alice, page.id, {
      name: "Check-up", durationMin: 30, bufferAfterMin: 15, questions: [{ label: "Reason for visit", required: true }],
      reminderHours: [24, 1],
    });
    page = (await pages.pageById(page.id))!;
  });

  it("offers each person's free times, minus their calendar", async () => {
    calendar.busy = [{ email: bob.email, start: at("09:00"), end: at("12:00") }];
    const slots = await appts.availability(page, service, monday, monday, { now });
    const nine = slots.find((s) => s.start === at("09:00"))!;
    expect(nine.staffIds).toEqual([page.staff.find((s) => s.email === alice.email)!.id]);
    expect(slots.find((s) => s.start === at("13:00"))!.staffIds.length).toBe(2);
    // 4:30 would end at 5:00 but its buffer runs past closing: still fine, buffers only guard other bookings.
    expect(slots.at(-1)!.start).toBe(at("16:30"));
  });

  it("books, puts it on the calendar and emails both sides", async () => {
    await expect(appts.bookPublic(page.slug, { serviceId: service.id, start: at("09:00"), name: "Carol", email: "carol@example.org" }, now))
      .rejects.toThrow(/Reason for visit/);
    const { token, appointment } = await appts.bookPublic(page.slug, {
      serviceId: service.id, start: at("09:00"), name: "Carol Customer", email: "Carol@Example.org", phone: "555 0100",
      answers: { q1: "Sore knee" },
    }, now);
    expect(appointment.staff_email).toBe(alice.email); // Bob is busy on his calendar
    expect(appointment.customer_email).toBe("carol@example.org");
    expect(appointment.meet_room).toMatch(/^b-[0-9a-f]{12}$/);
    expect(appointment.location).toBe(`https://meet.example.com/room/${appointment.meet_room}`);
    const ev = calendar.events.get(appointment.calendar_event_id!)!;
    expect(ev).toMatchObject({ ownerEmail: alice.email, attendees: ["carol@example.org"], source: "booking" });
    expect(String(ev.description)).toContain("Reason for visit: Sore knee");
    expect(sent.map((m) => m.to).sort()).toEqual([alice.email, "carol@example.org"]);
    expect(sent.find((m) => m.to === "carol@example.org")!.ics!.method).toBe("REQUEST");

    const view = (await appts.forCustomer(token, now))!;
    expect(view).toMatchObject({ serviceName: "Check-up", staffName: alice.name, status: "confirmed", canChange: true });
  });

  it("never double-books a person, even when two customers race", async () => {
    calendar.busy = [];
    const book = (name: string, staffId: string) => appts.bookPublic(page.slug, {
      serviceId: service.id, staffId, start: at("10:00"), name, email: `${name}@example.org`, answers: { q1: "x" },
    }, now);
    const bobId = page.staff.find((s) => s.email === bob.email)!.id;
    const results = await Promise.allSettled([book("dan", bobId), book("erin", bobId), book("fay", bobId)]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    // The 10:30 slot is gone too: the 15-minute buffer after 10:00-10:30 runs into it. 10:45 isn't on the grid.
    const left = (await appts.availability(page, service, monday, monday, { staffId: bobId, now })).map((s) => s.start);
    expect(left).not.toContain(at("10:00"));
    expect(left).not.toContain(at("09:30"));
    expect(left).toContain(at("11:00"));
  });

  it("lets the customer move and cancel with their link", async () => {
    const { token, appointment } = await appts.bookPublic(page.slug, {
      serviceId: service.id, start: at("14:00"), name: "Gus", email: "gus@example.org", answers: { q1: "x" },
    }, now);
    sent.length = 0;
    await expect(appts.moveByCustomer(token, at("09:00"), now)).rejects.toThrow(/isn't free/);
    await appts.moveByCustomer(token, at("15:00"), now);
    const [moved] = await q<{ start_at: Date; sequence: number }>(`SELECT start_at, sequence FROM appointments WHERE id = $1`, [appointment.id]);
    expect(moved.start_at.toISOString()).toBe(at("15:00"));
    expect(moved.sequence).toBe(1);
    expect(calendar.events.get(appointment.calendar_event_id!)!.startAt).toBe(at("15:00"));
    expect(sent.map((m) => m.subject)).toContain("New time: Check-up with Contoso Clinic");

    // Too close to the start: the page's 60-minute notice applies to changes too.
    await expect(appts.cancelByCustomer(token, "", Date.parse(at("14:30")))).rejects.toThrow(/too late/);
    sent.length = 0;
    await appts.cancelByCustomer(token, "Feeling better", now);
    expect((await appts.forCustomer(token, now))!.status).toBe("cancelled");
    expect(calendar.events.has(appointment.calendar_event_id!)).toBe(false);
    expect(sent.find((m) => m.to === "gus@example.org")!.ics!.method).toBe("CANCEL");
    await expect(appts.cancelByCustomer(token, "", now)).rejects.toThrow(/too late|already/);
    // The time is free again.
    expect((await appts.availability(page, service, monday, monday, { now })).map((s) => s.start)).toContain(at("15:00"));
  });

  it("lets staff book outside hours but not over a clash", async () => {
    const a = await appts.bookForCustomer(bob, {
      pageId: page.id, serviceId: service.id, start: at("18:00"), name: "Hal", email: "hal@example.org",
    });
    expect(a).toMatchObject({ staffEmail: bob.email, bookedBy: bob.email });
    await expect(appts.bookForCustomer(bob, {
      pageId: page.id, serviceId: service.id, start: at("18:15"), name: "Ivy", email: "ivy@example.org",
    })).rejects.toThrow(/already has/);
    await expect(appts.bookForCustomer(eve, { pageId: page.id, serviceId: service.id, start: at("19:00"), name: "x", email: "x@example.org" }))
      .rejects.toThrow(/not found/);
    await expect(appts.cancelByStaff(eve, a.id, "")).rejects.toThrow(/not found/);
    const c = await appts.cancelByStaff(bob, a.id, "Closed");
    expect(c.status).toBe("cancelled");
  });

  it("lists appointments and customers for the page's staff only", async () => {
    const mine = await appts.list(alice, { from: at("00:00"), to: at("23:59"), status: "confirmed" });
    expect(mine.map((a) => a.customerName)).toContain("Carol Customer");
    expect(await appts.list(eve, {})).toEqual([]);
    const people = await appts.customers(bob, page.id);
    expect(people.find((p) => p.email === "carol@example.org")).toMatchObject({ name: "Carol Customer", phone: "555 0100", upcoming: 1 });
  });

  it("sends each reminder once, and not one that was due before the booking", async () => {
    // Carol booked on Friday for Monday 9:00: the 24-hour reminder is due Sunday 9:00.
    // created_at comes from the real clock, so pin it to the test's Friday.
    await q("UPDATE appointments SET created_at = $1", [new Date(now)]);
    sent.length = 0;
    const sunday = Date.parse(at("09:30")) - 24 * 3_600_000;
    expect(await appts.sendDueReminders(sunday)).toBe(1);
    expect(await appts.sendDueReminders(sunday)).toBe(0);
    expect(sent.map((m) => m.subject)).toEqual(["Reminder: Check-up with Contoso Clinic"]);
    expect(sent[0].ics).toBeUndefined();
    sent.length = 0;
    expect(await appts.sendDueReminders(Date.parse(at("08:30")))).toBeGreaterThanOrEqual(1);
    expect(sent.every((m) => m.subject.startsWith("Reminder"))).toBe(true);
  });

  it("is found by suite search and eDiscovery", async () => {
    const r = await searchFor(bob, { query: "knee" });
    expect(r.results.map((x) => x.title)).toEqual(["Carol Customer: Check-up"]);
    expect((await searchFor(eve, { query: "knee" })).results).toEqual([]);
    const hits = await ed.search(parseSearch({ query: "knee", custodians: ["carol@example.org"] }, ed.KINDS));
    expect(hits.hits).toHaveLength(1);
    expect(hits.hits[0]).toMatchObject({ owner: alice.email, participants: ["carol@example.org"] });
    const { items } = await ed.exportItems([hits.hits[0].id]);
    expect(items[0].metadata).toMatchObject({ customer: { email: "carol@example.org" }, status: "confirmed" });
  });

  it("only hides a page deleted while someone on it is on hold", async () => {
    await pages.deletePage(alice, page.id, async (e) => e === "carol@example.org");
    expect(await pages.pageById(page.id)).toBeNull();
    const hits = await ed.search(parseSearch({ query: "knee" }, ed.KINDS));
    expect(hits.hits[0].deleted).toBe(true);
    const other = await pages.createPage(alice, { name: "Scratch" });
    await pages.deletePage(alice, other.id, async () => false);
    expect((await q(`SELECT 1 FROM pages WHERE id = $1`, [other.id])).length).toBe(0);
  });
});
