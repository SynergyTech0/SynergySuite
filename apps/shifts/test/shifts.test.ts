import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SHIFTS_ADMIN_EMAILS = "lee@example.com";

const lee = { email: "lee@example.com", name: "Lee", subject: "l" }; // scheduler
const ann = { email: "ann@example.com", name: "Ann", subject: "a" }; // on the roster
const bob = { email: "bob@example.com", name: "Bob", subject: "b" }; // on the roster
const zed = { email: "zed@example.com", name: "Zed", subject: "z" }; // not on the roster

/** A Monday well in the future, so claims are never "in the past". */
const MON = "2099-06-01";
const TUE = "2099-06-02";

describe.skipIf(!url)("shifts", async () => {
  const s = await import("../lib/shifts");
  const { searchFor } = await import("../lib/search");
  const { q, db } = await import("../lib/db");

  let cashier = "";
  let annId = "";
  let bobId = "";

  beforeAll(async () => {
    await q("SELECT 1");
    await q("TRUNCATE shifts, employees, positions RESTART IDENTITY CASCADE");
  });
  afterAll(async () => {
    await db().close();
  });

  it("lets only schedulers keep the roster", async () => {
    await expect(s.createPosition(ann, { name: "Cashier" })).rejects.toMatchObject({ status: 403 });
    cashier = (await s.createPosition(lee, { name: "Cashier", color: "#FF0000" })).id;
    await expect(s.createPosition(lee, { name: "cashier" })).rejects.toMatchObject({ code: "23505" });
    const a = await s.createEmployee(lee, { name: "Ann", email: "ANN@example.com", positionId: cashier });
    expect(a).toMatchObject({ name: "Ann", email: "ann@example.com", position_name: "Cashier", position_color: "#ff0000", active: true });
    annId = a.id;
    bobId = (await s.createEmployee(lee, { name: "Bob", email: "bob@example.com" })).id;
    await expect(s.createEmployee(lee, { name: "Bob 2", email: "Bob@example.com" })).rejects.toMatchObject({ code: "23505" });
    await expect(s.createEmployee(lee, { name: "X", email: "not-an-email" })).rejects.toThrow(/email/);
    expect((await s.rosterEntry("Ann@Example.com"))?.id).toBe(annId);
  });

  it("schedules shifts and refuses overlaps for the same person", async () => {
    await expect(s.createShift(ann, { date: MON, start: "09:00", end: "17:00" })).rejects.toMatchObject({ status: 403 });
    await s.createShift(lee, { date: MON, start: "09:00", end: "13:00", employeeId: annId, positionId: cashier, location: "Front" });
    await expect(s.createShift(lee, { date: MON, start: "12:00", end: "18:00", employeeId: annId })).rejects.toMatchObject({ status: 409 });
    // Back to back is fine, and so is the same time for someone else.
    await s.createShift(lee, { date: MON, start: "13:00", end: "15:00", employeeId: annId });
    await s.createShift(lee, { date: MON, start: "12:00", end: "18:00", employeeId: bobId });
    await expect(s.createShift(lee, { date: MON, start: "18:00", end: "09:00" })).rejects.toThrow(/end after/);
    await expect(s.createShift(lee, { date: "2099-02-30", start: "09:00", end: "10:00" })).rejects.toThrow(/date/);
  });

  it("moves shifts, still checking overlaps", async () => {
    const sched = await s.schedule(lee, MON);
    const bobs = sched.shifts.find((x) => x.employee_id === bobId)!;
    await expect(s.updateShift(lee, bobs.id, { employeeId: annId })).rejects.toMatchObject({ status: 409 });
    const moved = await s.updateShift(lee, bobs.id, { date: TUE, start: "08:00" });
    expect(moved).toMatchObject({ shift_date: TUE, start_min: 480, end_min: 1080, employee_id: bobId });
    // Changing its own times never clashes with itself.
    await s.updateShift(lee, bobs.id, { end: "17:00" });
  });

  it("hides drafts from everyone but schedulers until the week is published", async () => {
    const open = await s.createShift(lee, { date: TUE, start: "10:00", end: "14:00", positionId: cashier, notes: "Inventory count" });
    expect(open.employee_id).toBeNull();
    const draft = await s.schedule(lee, TUE);
    expect(draft).toMatchObject({ weekOf: MON, weekEnd: "2099-06-07", drafts: 4, admin: true });
    expect(draft.hours[annId]).toBe(6);
    expect((await s.schedule(ann, MON)).shifts).toEqual([]);
    await expect(s.claim(ann, open.id)).rejects.toMatchObject({ status: 404 });
    expect(await s.myShifts(ann)).toEqual([]);

    await expect(s.publish(ann, MON)).rejects.toMatchObject({ status: 403 });
    expect(await s.publish(lee, "2099-06-05")).toEqual({ published: 4 });
    const seen = await s.schedule(ann, MON);
    expect(seen).toMatchObject({ drafts: 0, admin: false, me: annId });
    expect(seen.shifts).toHaveLength(4);
    expect((await s.myShifts(ann)).map((x) => [x.shift_date, x.start_min])).toEqual([
      [MON, 540],
      [MON, 780],
    ]);
  });

  it("lets people on the roster claim open shifts they are free for", async () => {
    const [open] = (await s.schedule(ann, MON)).shifts.filter((x) => !x.employee_id);
    await expect(s.claim(zed, open.id)).rejects.toMatchObject({ status: 403 });
    await expect(s.claim(bob, open.id)).rejects.toMatchObject({ status: 409 }); // Bob works 08:00-17:00 Tuesday
    const taken = await s.claim(ann, open.id);
    expect(taken).toMatchObject({ employee_id: annId, employee_name: "Ann" });
    await expect(s.claim(ann, open.id)).rejects.toThrow(/already taken/);
  });

  it("keeps a person's shifts when they leave the roster, but schedules no more", async () => {
    await s.updateEmployee(lee, bobId, { active: false });
    expect((await s.listEmployees()).map((e) => e.name)).toEqual(["Ann"]);
    expect((await s.listEmployees(true)).map((e) => e.name)).toEqual(["Ann", "Bob"]);
    expect((await s.schedule(lee, MON)).shifts.filter((x) => x.employee_id === bobId)).toHaveLength(1);
    await expect(s.createShift(lee, { date: "2099-06-03", start: "09:00", end: "10:00", employeeId: bobId })).rejects.toThrow(/no longer/);
    expect(await s.myShifts(bob)).toEqual([]);
  });

  it("answers suite search, with drafts only for schedulers", async () => {
    await s.createShift(lee, { date: "2099-06-03", start: "09:00", end: "10:00", notes: "Inventory recount" });
    const forAnn = await searchFor(ann, { query: "inventory" });
    expect(forAnn.results.map((r) => r.title)).toEqual(["Ann, 2099-06-02"]);
    const forLee = await searchFor(lee, { query: "inventory" });
    expect(forLee.results.map((r) => r.title)).toEqual(["Open shift, 2099-06-03", "Ann, 2099-06-02"]);
    expect(forLee.results[0].snippet).toContain("draft");
    expect(forLee.results[0].url).toBe("/?week=2099-06-03");
  });

  it("deletes a position without losing shifts", async () => {
    await s.deletePosition(lee, cashier);
    const sched = await s.schedule(lee, MON);
    expect(sched.shifts.length).toBe(5);
    expect(sched.shifts.every((x) => x.position_id === null)).toBe(true);
  });
});
