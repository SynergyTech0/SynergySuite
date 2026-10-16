import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const alice = "alice@example.com"; // manager
const bob = "bob@example.com"; // team member
const carol = "carol@example.com"; // not on the project
const today = "2026-10-16"; // a Friday

describe.skipIf(!url)("projects", async () => {
  const projects = await import("../lib/projects");
  const time = await import("../lib/time");
  const billing = await import("../lib/billing");
  const books = await import("../lib/books");
  const reports = await import("../lib/reports");
  const { searchFor } = await import("../lib/search");
  const { q, db } = await import("../lib/db");

  beforeAll(async () => {
    await q("SELECT 1");
    await q("TRUNCATE projects CASCADE");
    await q("DELETE FROM timers");
  });
  afterAll(async () => {
    await db().close();
  });

  let projectId = "";

  it("makes a project with its maker as manager and keeps rates from members", async () => {
    const p = await projects.createProject(alice, { name: "Website rebuild", clientName: "Acme", clientEmail: "ap@acme.test", defaultRate: "150", start: "2026-10-12" });
    projectId = p.id;
    expect(p.code).toMatch(/^PRJ-\d{4}$/);
    expect(p.myRole).toBe("manager");
    expect(p.defaultRateCents).toBe(15000);
    await projects.setMember(alice, p.id, { email: bob, billRate: "120", costRate: "60.50", weeklyHours: "32" });
    const asBob = await projects.getProject(bob, p.id);
    expect(asBob.myRole).toBe("member");
    expect(asBob.defaultRateCents).toBeNull();
    expect(asBob.members.find((m) => m.email === bob)).toEqual({ email: bob, role: "member", weeklyMinutes: 32 * 60 });
    const asAlice = await projects.getProject(alice, p.id);
    expect(asAlice.members.find((m) => m.email === bob)).toMatchObject({ billRateCents: 12000, costRateCents: 6050 });
    await expect(projects.getProject(carol, p.id)).rejects.toThrow(/not found/);
    await expect(projects.updateProject(bob, p.id, { name: "Mine" })).rejects.toThrow(/managers/);
    await expect(projects.removeMember(alice, p.id, alice)).rejects.toThrow(/at least one manager/);
  });

  it("numbers the outline, rolls summaries up and pushes successors later", async () => {
    const design = await projects.createTask(alice, projectId, { title: "Design" });
    const wire = await projects.createTask(alice, projectId, { title: "Wireframes", parentId: design.id, start: "2026-10-12", durationDays: 3, estimateHours: 12 });
    const mock = await projects.createTask(alice, projectId, { title: "Mockups", parentId: design.id, start: "2026-10-12", durationDays: 2, estimateHours: 8, dependsOn: [wire.id] });
    const build = await projects.createTask(bob, projectId, { title: "Build", start: "2026-10-01", durationDays: 5, dependsOn: [design.id], assignedTo: bob });
    let tasks = await projects.listTasks(alice, projectId);
    const by = (id: string) => tasks.find((t) => t.id === id)!;
    expect(tasks.map((t) => [t.wbs, t.title])).toEqual([["1", "Design"], ["1.1", "Wireframes"], ["1.2", "Mockups"], ["2", "Build"]]);
    // Wireframes Mon-Wed, so Mockups Thu-Fri, and Build after the whole Design phase: Mon 19 to Fri 23.
    expect([by(wire.id).start, by(wire.id).finish]).toEqual(["2026-10-12", "2026-10-14"]);
    expect([by(mock.id).start, by(mock.id).finish]).toEqual(["2026-10-15", "2026-10-16"]);
    expect([by(design.id).start, by(design.id).finish, by(design.id).summary, by(design.id).estimateMinutes]).toEqual(["2026-10-12", "2026-10-16", true, 20 * 60]);
    expect([by(build.id).start, by(build.id).finish]).toEqual(["2026-10-19", "2026-10-23"]);

    // Wireframes running a day longer moves both successors.
    tasks = await projects.updateTask(alice, projectId, wire.id, { finish: "2026-10-15", percentDone: 100 });
    expect([by(mock.id).start, by(mock.id).finish]).toEqual(["2026-10-16", "2026-10-19"]);
    expect(by(build.id).start).toBe("2026-10-20");
    expect(by(design.id).percentDone).toBe(60); // 12 of 20 estimated hours done

    await expect(projects.updateTask(alice, projectId, wire.id, { dependsOn: [mock.id] })).rejects.toThrow(/circle/);
    await expect(projects.updateTask(alice, projectId, design.id, { parentId: wire.id })).rejects.toThrow(/own subtasks/);
    await expect(projects.createTask(alice, projectId, { title: "x", assignedTo: carol })).rejects.toThrow(/team/);
    // Build now runs Tue 20 to Mon 26, so a milestone after it lands on Tue 27.
    const ms = await projects.createTask(alice, projectId, { title: "Launch", milestone: true, start: "2026-10-21", dependsOn: [build.id] });
    expect([ms.start, ms.finish]).toEqual(["2026-10-27", "2026-10-27"]);
    await projects.deleteTask(alice, projectId, ms.id);
    expect((await projects.listTasks(alice, projectId)).length).toBe(4);
  });

  it("keeps one row per timesheet cell and locks it once submitted", async () => {
    const tasks = await projects.listTasks(bob, projectId);
    const build = tasks.find((t) => t.title === "Build")!;
    await time.setCell(bob, { projectId, taskId: build.id, day: "2026-10-12", hours: "7.5" });
    await time.setCell(bob, { projectId, taskId: build.id, day: "2026-10-13", hours: "1:30", notes: "Kickoff" });
    await time.setCell(bob, { projectId, taskId: null, day: "2026-10-13", hours: "1h 15m" });
    const again = await time.setCell(bob, { projectId, taskId: build.id, day: "2026-10-12", hours: 8 });
    expect(again).toMatchObject({ minutes: 480, billable: true, status: "draft" });
    const sheet = await time.timesheet(bob, "2026-10-14");
    expect(sheet.week).toBe("2026-10-12");
    expect(sheet.rows.length).toBe(2);
    expect(sheet.totalMinutes).toBe(480 + 90 + 75);
    expect(sheet.choices.map((c) => c.name)).toEqual(["Website rebuild"]);
    await expect(time.setCell(carol, { projectId, day: "2026-10-12", hours: 1 })).rejects.toThrow(/not found/);
    await expect(time.setCell(bob, { projectId, day: "2026-10-12", hours: "25" })).rejects.toThrow(/24 hours/);

    expect(await time.submitWeek(bob, "2026-10-12")).toBe(3);
    await expect(time.setCell(bob, { projectId, taskId: build.id, day: "2026-10-12", hours: 2 })).rejects.toThrow(/submitted/);
    expect(await time.recallWeek(bob, "2026-10-12")).toBe(3);
    expect(await time.submitWeek(bob, "2026-10-12")).toBe(3);
  });

  it("lets managers approve with today's rates or send time back with a reason", async () => {
    const pending = await time.pendingApprovals(alice);
    expect(pending.time.length).toBe(3);
    expect((await time.pendingApprovals(bob)).time).toEqual([]);
    const general = pending.time.find((t) => !t.taskId)!;
    await expect(time.decide(alice, { time: [general.id], approve: false })).rejects.toThrow(/why/);
    await time.decide(alice, { time: [general.id], approve: false, reason: "Which task?" });
    await expect(time.decide(bob, { time: pending.time.filter((t) => t.taskId).map((t) => t.id), approve: true })).rejects.toThrow(/no longer waiting/);
    expect(await time.decide(alice, { time: pending.time.filter((t) => t.taskId).map((t) => t.id), approve: true })).toEqual({ time: 2, expenses: 0 });
    const [rate] = await q<{ rate_cents: string; cost_cents: string }>(`SELECT rate_cents, cost_cents FROM time_entries WHERE status = 'approved' LIMIT 1`);
    expect([Number(rate.rate_cents), Number(rate.cost_cents)]).toEqual([12000, 6050]);
    // Sent back time is the person's to fix; changing it makes it a draft again.
    const fixed = await time.setCell(bob, { projectId, taskId: null, day: "2026-10-13", hours: 1 });
    expect(fixed).toMatchObject({ status: "draft", rejectReason: null });
  });

  it("files expenses with receipts that only the person and managers can open", async () => {
    const x = await time.createExpense(bob, { projectId, day: "2026-10-14", category: "Travel", description: "Train to Acme", amount: "84.20" });
    expect(x).toMatchObject({ amountCents: 8420, billable: true, status: "draft" });
    await time.setReceipt(bob, x.id, { name: "ticket.png", type: "image/png", bytes: Buffer.from("png") });
    await expect(time.setReceipt(bob, x.id, { name: "a.html", type: "text/html", bytes: Buffer.from("<b>") })).rejects.toThrow(/picture or a PDF/);
    expect((await time.getReceipt(alice, x.id))?.name).toBe("ticket.png");
    await expect(time.getReceipt(carol, x.id)).rejects.toThrow(/not found/);
    await time.updateExpense(bob, x.id, { status: "submitted" });
    await expect(time.updateExpense(bob, x.id, { amount: "1" })).rejects.toThrow(/submitted/);
    await time.decide(alice, { expenses: [x.id], approve: true });
    expect((await time.myExpenses(bob))[0].status).toBe("approved");
  });

  it("bills approved time and expenses into a Books draft, once", async () => {
    const preview = await billing.previewBilling(alice, projectId, { through: today });
    expect(preview.lines.map((l) => [l.description, l.quantity, l.unitCents, l.amountCents])).toEqual([
      ["Build", 9.5, 12000, 114000],
      ["Travel: Train to Acme (2026-10-14)", 1, 8420, 8420],
    ]);
    expect(preview.totalCents).toBe(122420);
    await expect(billing.previewBilling(bob, projectId, { through: today })).rejects.toThrow(/managers/);

    // Books down: nothing is marked billed.
    process.env.BOOKS_SVC_TOKEN = "svc";
    books.setBooksFetch((async () => new Response(JSON.stringify({ message: "Customer not allowed" }), { status: 400 })) as typeof fetch);
    await expect(billing.bill(alice, projectId, { through: today })).rejects.toThrow(/Customer not allowed/);
    expect((await billing.previewBilling(alice, projectId, { through: today })).totalCents).toBe(122420);

    const sent: unknown[] = [];
    books.setBooksFetch((async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "inv-1", number: "INV-0007" }), { status: 201 });
    }) as typeof fetch);
    const inv = await billing.bill(alice, projectId, { through: today });
    expect(inv).toMatchObject({ status: "sent", booksNumber: "INV-0007", totalCents: 122420 });
    expect(sent[0]).toMatchObject({ customer: { name: "Acme", email: "ap@acme.test" }, reference: expect.stringMatching(/^PRJ-/), lines: [{ quantity: 9.5, unitPrice: 120 }, { unitPrice: 84.2 }] });
    expect((await billing.previewBilling(alice, projectId, { through: today })).lines).toEqual([]);
    await expect(billing.bill(alice, projectId, { through: today })).rejects.toThrow(/nothing to bill/);
    expect(billing.invoiceCsv(inv)).toContain("Build,9.5,120.00,1140.00,USD");

    // Cancelling puts it all back to unbilled.
    await billing.cancelInvoice(alice, projectId, inv.id);
    expect((await billing.previewBilling(alice, projectId, { through: today })).totalCents).toBe(122420);
    delete process.env.BOOKS_SVC_TOKEN;
    const recorded = await billing.bill(alice, projectId, { through: today, groupBy: "person" });
    expect(recorded).toMatchObject({ status: "recorded", booksNumber: null });
    expect(recorded.lines[0].description).toBe(bob);
    books.setBooksFetch(undefined);
  });

  it("bills a fixed fee in parts", async () => {
    const p = await projects.createProject(alice, { name: "Audit", billing: "fixed", fixedFee: "5000", clientName: "Beta" });
    expect((await billing.previewBilling(alice, p.id, { through: today })).lines).toEqual([{ description: "Fixed fee", quantity: 1, unitCents: 500000, amountCents: 500000, kind: "fee" }]);
    await billing.bill(alice, p.id, { through: today, fee: "2000" });
    const rest = await billing.previewBilling(alice, p.id, { through: today });
    expect([rest.feeBilledCents, rest.totalCents]).toEqual([200000, 300000]);
  });

  it("reports progress, hours and money, with money for managers only", async () => {
    const r = await reports.projectReport(alice, projectId, today);
    expect(r.hours).toMatchObject({ approved: 570, draft: 60, total: 630 });
    expect(r.tasks).toMatchObject({ total: 3, done: 1 });
    expect(r.money).toMatchObject({ billedCents: 122420, unbilledCents: 0, expensesCents: 8420 });
    const bobRow = r.people.find((x) => x.email === bob)!;
    expect(bobRow).toMatchObject({ minutes: 630, weeklyMinutes: 1920, costCents: Math.round((630 * 6050) / 60) });
    const asBob = await reports.projectReport(bob, projectId, today);
    expect(asBob.money).toBeUndefined();
    expect(asBob.people[0].costCents).toBeUndefined();
  });

  it("runs one timer at a time into today's cell", async () => {
    await time.startTimer(bob, { projectId, notes: "Call" });
    await expect(time.startTimer(bob, { projectId })).rejects.toThrow(/already running/);
    const started = new Date((await time.getTimer(bob))!.startedAt);
    const entry = await time.stopTimer(bob, "2026-10-19", new Date(started.getTime() + 25 * 60000));
    expect(entry).toMatchObject({ minutes: 25, notes: "Call", day: "2026-10-19" });
    expect(await time.getTimer(bob)).toBeNull();
  });

  it("finds projects and tasks in suite search for the team only", async () => {
    const me = (email: string) => ({ email, name: email, subject: email });
    const hits = await searchFor(me(bob), { query: "wireframes" });
    expect(hits.results.map((r) => [r.kind, r.title])).toEqual([["task", "Wireframes"]]);
    expect((await searchFor(me(bob), { query: "acme" })).results.map((r) => r.kind)).toEqual(["project"]);
    expect((await searchFor(me(carol), { query: "acme" })).results).toEqual([]);
  });

  it("lists projects with progress, and drafts a plan in order", async () => {
    const list = await projects.listProjects(alice, today);
    expect(list.map((p) => p.name)).toEqual(["Audit", "Website rebuild"]);
    const plan = await projects.addPlan(alice, list[0].id, "2026-10-17", [
      { title: "Fieldwork", tasks: [{ title: "Interviews", durationDays: 2 }, { title: "Sign-off", durationDays: 1, milestone: true }] },
    ]);
    expect(plan.map((t) => [t.wbs, t.title, t.start, t.finish])).toEqual([
      ["1", "Fieldwork", "2026-10-19", "2026-10-21"],
      ["1.1", "Interviews", "2026-10-19", "2026-10-20"],
      ["1.2", "Sign-off", "2026-10-21", "2026-10-21"],
    ]);
  });
});
