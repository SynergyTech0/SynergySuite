import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";

// Runs against a real Postgres when TEST_DATABASE_URL is set, in a database of its own ("<name>_hr").
const base = process.env.TEST_DATABASE_URL;
const ann = "ann@example.com"; // HR and payroll admin
const mo = "mo@example.com"; // manages Eve
const eve = "eve@example.com"; // manages Zed
const zed = "zed@example.com";
process.env.HR_ADMIN_EMAILS = ann;
process.env.PAYROLL_ADMIN_EMAILS = "";
process.env.BOOKS_SVC_TOKEN = "books-token";
process.env.COMPLIANCE_TOKEN = "test-token";

async function ownDatabase(url: string, suffix: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_${suffix}`;
  const admin = createDb({ connectionString: url, max: 1 });
  await admin.q(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

describe.skipIf(!base)("hr against Postgres", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base, "hr");
  const hr = await import("../lib/hr");
  const runs = await import("../lib/payroll/runs");
  const { searchFor } = await import("../lib/search");
  const { db, q } = await import("../lib/db");
  const searchRoute = await import("../app/api/compliance/search/route");
  const exportRoute = await import("../app/api/compliance/export/route");

  const as = (email: string) => hr.viewer({ email, name: email.split("@")[0] });
  const ids: Record<string, string> = {};
  const posted: { url: string; body: Record<string, unknown> }[] = [];
  let booksUp = true;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    posted.push({ url, body: JSON.parse(String(init.body)) });
    if (!booksUp) return new Response(JSON.stringify({ message: "Books is down" }), { status: 503 });
    return new Response(JSON.stringify({ id: "j1", journalNumber: "GJ-2026-000042" }), { status: 200 });
  }) as unknown as typeof fetch;

  beforeAll(async () => {
    const a = await as(ann);
    for (const [email, name, manager, extra] of [
      [ann, "Ann Admin", "", {}],
      [mo, "Mo Manager", ann, { department: "Sales" }],
      [eve, "Eve Lead", mo, { department: "Sales", title: "Team lead", startDate: "2025-01-06" }],
      [zed, "Zed New", eve, { department: "Sales", startDate: "2026-10-26" }],
    ] as const) {
      ids[email] = (await hr.createEmployee(a, { email, name, managerEmail: manager, ...extra })).id;
    }
  });
  afterAll(async () => {
    await db().close();
  });

  it("refuses duplicates and non-admin writes", async () => {
    await expect(hr.createEmployee(await as(ann), { email: eve, name: "Again" })).rejects.toThrow(/already/);
    await expect(hr.createEmployee(await as(mo), { email: "x@example.com", name: "X" })).rejects.toThrow(/Only HR admins/);
    await expect(hr.updateEmployee(await as(zed), ids[eve], { phone: "1" })).rejects.toThrow(/Only HR admins/);
  });

  it("shows each viewer only what they may see", async () => {
    const zedView = await hr.getEmployee(await as(zed), ids[eve]);
    expect(zedView.tier).toBe("directory");
    expect(zedView).not.toHaveProperty("start_date");
    const moView = await hr.getEmployee(await as(mo), ids[zed]); // an indirect report
    expect(moView.tier).toBe("team");
    expect(moView.start_date).toBe("2026-10-26");
    expect(moView).not.toHaveProperty("home_address");
    expect((await hr.getEmployee(await as(eve), ids[eve])).tier).toBe("self");
    expect((await hr.getEmployee(await as(ann), ids[eve])).tier).toBe("hr");
  });

  it("lets people keep their own contact details, but not their job", async () => {
    const e = await hr.updateEmployee(await as(eve), ids[eve], { title: "CEO", emergencyContact: "Sam, 555-0100", homeAddress: "1 Main St" });
    expect(e.title).toBe("Team lead");
    expect(e.emergency_contact).toBe("Sam, 555-0100");
  });

  it("refuses a reporting loop", async () => {
    await expect(hr.updateEmployee(await as(ann), ids[mo], { managerEmail: zed })).rejects.toThrow(/loop/);
  });

  it("runs time off: request, overlap, who may decide, balances and privacy", async () => {
    await hr.setHoliday(await as(ann), { day: "2026-10-21", name: "Founders day" });
    const r = await hr.requestTimeOff(await as(eve), { kind: "vacation", startDate: "2026-10-19", endDate: "2026-10-23", note: "Trip" });
    expect(r.days).toBe(4);
    await expect(hr.requestTimeOff(await as(eve), { kind: "sick", startDate: "2026-10-23", endDate: "2026-10-23" })).rejects.toThrow(/already have time off/);
    await expect(hr.decideTimeOff(await as(eve), r.id, { status: "approved" })).rejects.toThrow(/Someone else/);
    await expect(hr.decideTimeOff(await as(zed), r.id, { status: "approved" })).rejects.toThrow(/manager or HR/);
    expect((await hr.listTimeOff(await as(mo), "approvals")).map((x) => x.id)).toEqual([r.id]);
    expect(await hr.listTimeOff(await as(zed), "approvals")).toEqual([]);
    await hr.decideTimeOff(await as(mo), r.id, { status: "approved", note: "Enjoy" });
    await expect(hr.decideTimeOff(await as(ann), r.id, { status: "denied" })).rejects.toThrow(/already decided/);
    const bal = await hr.balances(eve, 2026);
    expect(bal?.find((b) => b.kind === "vacation")).toMatchObject({ allowance: 15, used: 4, remaining: 11 });
    const seenByZed = (await hr.listTimeOff(await as(zed), "calendar", "2026-10-01", "2026-10-31")).find((x) => x.id === r.id)!;
    expect(seenByZed.kind).toBeNull();
    expect(seenByZed.note).toBe("");
    const seenByMo = (await hr.listTimeOff(await as(mo), "calendar", "2026-10-01", "2026-10-31")).find((x) => x.id === r.id)!;
    expect(seenByMo.kind).toBe("vacation");
  });

  it("starts an onboarding checklist and gives each task to the right person", async () => {
    const a = await as(ann);
    const [tpl] = (await hr.listTemplates()).filter((t) => t.kind === "onboarding");
    await hr.startChecklist(a, { employeeId: ids[zed], templateId: tpl.id });
    const zedTasks = await hr.myTasks(await as(zed));
    const eveTasks = await hr.myTasks(await as(eve));
    const annTasks = await hr.myTasks(a);
    expect(zedTasks.every((t) => t.owner === "employee")).toBe(true);
    expect(eveTasks.every((t) => t.owner === "manager")).toBe(true);
    expect(annTasks.every((t) => t.owner === "hr")).toBe(true);
    expect(zedTasks.length + eveTasks.length + annTasks.length).toBe(tpl.tasks.length);
    expect(eveTasks.find((t) => t.title.startsWith("Order a laptop"))!.due).toBe("2026-10-19"); // a week before the start date
    await expect(hr.setTaskDone(await as(mo), zedTasks[0].id, true)).rejects.toThrow(/someone else/);
    await hr.setTaskDone(await as(zed), zedTasks[0].id, true);
    expect((await hr.myTasks(await as(zed))).length).toBe(zedTasks.length - 1);
    expect((await hr.listChecklists(await as(mo))).length).toBe(1); // Zed is on Mo's team
    expect(await hr.listChecklists(await as("nobody@example.com"))).toEqual([]);
  });

  it("keeps payroll to payroll admins", async () => {
    await expect(runs.saveSettings(await as(eve), { frequency: "weekly" })).rejects.toThrow(/payroll admins/);
    await expect(runs.getProfile(await as(mo), ids[eve])).rejects.toThrow(/payroll admins/);
    await expect(runs.listRuns(await as(mo))).rejects.toThrow(/payroll admins/);
  });

  let firstRun = "";
  it("creates a pay run from pay details, time off, holidays and start dates", async () => {
    const a = await as(ann);
    await expect(runs.createRun(a, { periodStart: "2026-10-19", periodEnd: "2026-11-01", payDate: "2026-11-06" })).rejects.toThrow(/Nobody is set up/);
    await runs.saveSettings(a, { companyName: "Example Co", frequency: "biweekly", sutaRatePercent: 2.7, sutaWageBase: "7000" });
    await runs.saveProfile(a, ids[eve], { payType: "salary", annualSalary: "52,000", filingStatus: "single", workState: "TX" });
    await runs.addDeduction(a, ids[eve], { name: "401(k)", kind: "pretax_retirement", percent: 5, matchPercent: 100, matchCapPercent: 4 });
    await runs.saveProfile(a, ids[zed], { payType: "hourly", hourlyRate: "25", workState: "CA", stateRatePercent: 4 });
    await expect(runs.saveProfile(a, ids[mo], { payType: "hourly" })).rejects.toThrow(/hourly rate/);

    firstRun = (await runs.createRun(a, { periodStart: "2026-10-19", periodEnd: "2026-11-01", payDate: "2026-11-06" })).id;
    const { run, paychecks } = await runs.getRun(a, firstRun);
    expect(run.status).toBe("draft");
    expect(paychecks.map((p) => p.employeeName)).toEqual(["Eve Lead", "Zed New"]);
    const e = paychecks[0];
    expect(e.hours).toMatchObject({ regular: 80, pto: 32, holiday: 8, salaryFraction: 1 });
    expect(e.grossCents).toBe(200_000);
    // Zed starts Monday Oct 26: 5 of the 10 working days, no holiday in his part.
    const z = paychecks[1];
    expect(z.hours).toMatchObject({ regular: 40, holiday: 0, pto: 0 });
    expect(z.grossCents).toBe(100_000);
    expect(run.totals.grossCents).toBe(300_000);

    await expect(runs.createRun(a, { periodStart: "2026-10-26", periodEnd: "2026-11-08", payDate: "2026-11-13" })).rejects.toThrow(/already covers/);
  });

  it("edits hours in a draft and recalculates", async () => {
    const a = await as(ann);
    const z = (await runs.getRun(a, firstRun)).paychecks[1];
    const after = await runs.updatePaycheck(a, z.id, { overtime: 2, bonus: "100" });
    expect(after.grossCents).toBe(100_000 + 2 * 3_750 + 10_000);
    expect((await runs.getRun(a, firstRun)).run.totals.grossCents).toBe(200_000 + after.grossCents);
  });

  it("approves, pays and posts a balanced journal to Books; stubs appear only once paid", async () => {
    const a = await as(ann);
    await runs.approveRun(a, firstRun);
    const eveStub = (await runs.getRun(a, firstRun)).paychecks[0].id;
    expect(await runs.myStubs(eve)).toEqual([]);
    await expect(runs.getStub(await as(eve), eveStub)).rejects.toThrow(/Not found/);
    await expect(runs.updatePaycheck(a, eveStub, { overtime: 1 })).rejects.toThrow(/Only a draft/);

    booksUp = false;
    const failed = await runs.payRun(a, firstRun, { fetch: fakeFetch });
    expect(failed.status).toBe("paid");
    expect(failed.booksStatus).toBe("failed");
    expect(failed.booksError).toMatch(/Books is down/);
    booksUp = true;
    const ok = await runs.postRun(a, firstRun, { fetch: fakeFetch });
    expect(ok.booksStatus).toBe("posted");
    expect(ok.booksJournal).toBe("GJ-2026-000042");
    const sent = posted[posted.length - 1];
    expect(sent.url).toMatch(/\/api\/svc\/journals$/);
    expect(sent.body.reference).toBe(`HR-PAYRUN-${ok.number}`);
    const lines = sent.body.lines as { debit: string; credit: string }[];
    const sum = (k: "debit" | "credit") => lines.reduce((s, l) => s + Math.round(Number(l[k]) * 100), 0);
    expect(sum("debit")).toBe(sum("credit"));

    const stubs = await runs.myStubs(eve);
    expect(stubs).toHaveLength(1);
    const stub = await runs.getStub(await as(eve), stubs[0].id);
    expect(stub.companyName).toBe("Example Co");
    expect(stub.ytd.grossCents).toBe(200_000);
    await expect(runs.getStub(await as(zed), stubs[0].id)).rejects.toThrow(/Not found/);
    await expect(runs.reopenRun(a, firstRun)).rejects.toThrow(/paid pay run/);
  });

  it("carries year-to-date into the next run and sums quarters", async () => {
    const a = await as(ann);
    const id = (await runs.createRun(a, { periodStart: "2026-11-02", periodEnd: "2026-11-15", payDate: "2026-11-20" })).id;
    const eveCheck = (await runs.getRun(a, id)).paychecks.find((p) => p.employeeEmail === eve)!;
    // 401(k) year to date counts toward the next stub; FUTA has $7,000 − $2,000 of room left for Eve.
    expect(eveCheck.result.employerTaxes.find((t) => t.code === "futa")!.amountCents).toBe(1_200);
    await runs.approveRun(a, id);
    await runs.payRun(a, id, { fetch: fakeFetch });
    const stub = await runs.getStub(await as(eve), eveCheck.id);
    expect(stub.ytd.grossCents).toBe(400_000);
    expect(stub.ytd.deductions[eveCheck.result.deductions[0].code]).toBe(20_000);
    const q4 = (await runs.taxSummary(a, 2026))[3];
    expect(q4.runs).toBe(2);
    expect(q4.grossCents).toBe(400_000 + (await runs.getRun(a, firstRun)).paychecks[1].grossCents + (await runs.getRun(a, id)).paychecks[1].grossCents);
  });

  it("finds people and time off in suite search, each person seeing only theirs", async () => {
    const people = await searchFor(await as(zed), { query: "eve" });
    expect(people.results.map((r) => r.kind)).toEqual(["person"]);
    expect((await searchFor(await as(zed), { query: "trip", kinds: ["timeoff"] })).results).toEqual([]);
    expect((await searchFor(await as(mo), { query: "trip", kinds: ["timeoff"] })).results).toHaveLength(1);
  });

  it("answers the Admin center: a person's HR file by custodian, with full export", async () => {
    const call = (route: { POST: (r: Request) => Promise<Response> }, body: unknown, token = "test-token") =>
      route.POST(new Request("http://hr/api/compliance", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect((await call(searchRoute, {}, "wrong")).status).toBe(401);
    const res = (await (await call(searchRoute, { custodians: [eve] })).json()) as { hits: { id: string; kind: string; owner: string }[]; total: number };
    const kinds = res.hits.filter((h) => h.owner === eve).map((h) => h.kind).sort();
    expect(kinds).toEqual(["employee", "paycheck", "paycheck", "timeoff"]);
    // Eve also shows up as the manager on Zed's record and as Zed's checklist manager.
    expect(res.hits.some((h) => h.owner === zed && h.kind === "employee")).toBe(true);
    const onlyPay = (await (await call(searchRoute, { custodians: [eve], kinds: ["paycheck"] })).json()) as { hits: { id: string }[] };
    const exp = (await (await call(exportRoute, { ids: onlyPay.hits.map((h) => h.id) })).json()) as { items: { metadata: { paycheck: { result: { grossCents: number } } } }[] };
    expect(exp.items.map((i) => i.metadata.paycheck.result.grossCents)).toEqual([200_000, 200_000]);
    const word = (await (await call(searchRoute, { query: "Founders" })).json()) as { total: number };
    expect(word.total).toBe(0); // holidays aren't anyone's content
  });

  it("writes an audit trail without pay amounts", async () => {
    const rows = await q<{ action: string; detail: Record<string, unknown> }>("SELECT action, detail FROM audit");
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["employee.create", "timeoff.approved", "payroll.profile", "payroll.run.paid", "payroll.run.books"]));
    expect(JSON.stringify(rows.filter((r) => r.action === "payroll.profile"))).not.toMatch(/52,000|5200000/);
  });
});
