import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PolicyClient } from "@synergy/compliance";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.LAW_ADMIN_EMAILS = "admin@example.com";
process.env.LAW_TRUST_EMAILS = "keeper@example.com";
delete process.env.BOOKS_SVC_TOKEN;
delete process.env.LAW_BOOKS_TOKEN;

const lee = { email: "lee@example.com", name: "Lee", subject: "l" }; // responsible lawyer
const pat = { email: "pat@example.com", name: "Pat", subject: "p" }; // paralegal on the team
const dan = { email: "dan@example.com", name: "Dan", subject: "d" }; // another lawyer, not on it
const keeper = { email: "keeper@example.com", name: "Kim", subject: "k" }; // trust account keeper
const admin = { email: "admin@example.com", name: "Ada", subject: "a" };

const held = new Set<string>();
const fakePolicy: PolicyClient = { onHold: async (e) => held.has(e), retention: async () => [], retentionDays: async () => null, invalidate() {} };

describe.skipIf(!url)("law", async () => {
  const law = await import("../lib/law");
  const conflicts = await import("../lib/conflicts");
  const billing = await import("../lib/billing");
  const trust = await import("../lib/trust");
  const docs = await import("../lib/documents");
  const books = await import("../lib/books");
  const { searchFor } = await import("../lib/search");
  const { dashboard } = await import("../lib/dashboard");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");

  beforeAll(async () => {
    setPolicy(fakePolicy);
    await q("SELECT 1");
    await q("TRUNCATE clients, matters, conflict_checks, trust_accounts, reconciliations, bills CASCADE");
  });
  afterAll(async () => {
    setPolicy(undefined);
    books.setBooksFetch(undefined);
    await db().close();
  });

  let roe = "";
  let matterA = "";
  let matterB = "";
  let account = "";

  it("opens a matter only after its conflict check is decided", async () => {
    const first = await law.createMatter(lee, { title: "Roe v. Acme", client: { name: "Robert Roe", email: "robert@roe.test" }, jurisdiction: "NY", rate: "300" });
    matterA = first.id;
    expect(first.number).toMatch(/^\d{4}-\d{4}$/);
    await law.addParty(lee, matterA, { name: "Acme Holdings, Inc. d/b/a Acme Supply", role: "adverse" });
    const m = await law.getMatter(lee, matterA);
    roe = m.client_id;
    expect(m).toMatchObject({ role: "responsible", client_name: "Robert Roe", jurisdiction: "NY" });

    // Acme comes in as a prospective client: the check finds them as the other side on Roe's matter.
    const check = await conflicts.runCheck(dan, { names: ["ACME SUPPLY", "Someone Else"] });
    expect(check.decision).toBe("pending");
    expect(check.hits[0]).toMatchObject({ name: "Acme Holdings, Inc. d/b/a Acme Supply", source: "party", role: "adverse", matterId: matterA, score: 100 });
    await expect(law.createMatter(dan, { title: "Acme general", client: { name: "Acme Holdings", kind: "organization" }, conflictCheckId: check.id })).rejects.toThrow(/Clear or waive/);
    await expect(conflicts.decideCheck(dan, check.id, { decision: "waived" })).rejects.toThrow(/consented/);
    await expect(conflicts.decideCheck(pat, check.id, { decision: "cleared" })).rejects.toThrow(/Only the person/);
    await conflicts.decideCheck(dan, check.id, { decision: "waived", note: "Both clients consented in writing" });
    const second = await law.createMatter(dan, { title: "Acme general", client: { name: "Acme Holdings", kind: "organization" }, conflictCheckId: check.id, feeType: "flat", flatFee: "1500" });
    matterB = second.id;
    const b = await law.getMatter(dan, matterB);
    expect(b.conflictChecks[0]).toMatchObject({ decision: "waived" });

    // A clean check clears itself.
    expect((await conflicts.runCheck(dan, { names: ["Nobody Known Here"] })).decision).toBe("cleared");
  });

  it("keeps a matter to its team and the administrators", async () => {
    await expect(law.getMatter(dan, matterA)).rejects.toThrow("Not found");
    await expect(law.getMatter(pat, matterA)).rejects.toThrow("Not found");
    await law.addPerson(lee, matterA, { email: pat.email, role: "paralegal", rate: "120" });
    expect((await law.getMatter(pat, matterA)).role).toBe("paralegal");
    expect((await law.getMatter(admin, matterA)).role).toBe("admin");
    await expect(law.updateMatter(pat, matterA, { title: "x" })).rejects.toThrow(/responsible lawyer/);
    expect((await law.listMatters(dan, { view: "all" })).map((m) => m.id)).toEqual([matterB]);
    expect((await law.listMatters(admin, { view: "all" })).map((m) => m.id).sort()).toEqual([matterA, matterB].sort());
    expect((await law.getClient(admin, roe)).name).toBe("Robert Roe");
  });

  it("checks fee terms against the state's rules", async () => {
    const m = await law.updateMatter(lee, matterA, { feeType: "contingency", contingencyPct: 33 });
    expect(m.rules.map((r) => r.rule)).toEqual(["Contingency fee in writing"]);
    const fixed = await law.updateMatter(lee, matterA, { engagementSignedOn: "2026-10-01", feeType: "hourly" });
    expect(fixed.rules).toEqual([]);
  });

  it("records time at each person's rate and bills it", async () => {
    await billing.addEntry(lee, matterA, { day: "2026-10-05", hours: "1.5", description: "Draft complaint" });
    await billing.addEntry(pat, matterA, { day: "2026-10-06", hours: "1:30", description: "Assemble exhibits" });
    await billing.addEntry(pat, matterA, { kind: "expense", day: "2026-10-06", amount: "405", description: "Filing fee" });
    await expect(billing.addEntry(pat, matterA, { who: dan.email, hours: 1, description: "x" })).rejects.toThrow(/responsible lawyer/);
    const entries = await billing.listEntries(lee, matterA);
    expect(entries.map((e) => [e.who, e.minutes, Number(e.value_cents)])).toEqual([
      [pat.email, 0, 40500],
      [pat.email, 90, 18000],
      [lee.email, 90, 45000],
    ]);
    const preview = await billing.previewBill(lee, matterA, "2026-10-05");
    expect(preview.totalCents).toBe(45000);
    await expect(billing.createBill(pat, matterA, { through: "2026-10-31" })).rejects.toThrow(/responsible lawyer/);
    const bill = await billing.createBill(lee, matterA, { through: "2026-10-31" });
    expect(bill.number).toMatch(/^B-\d{5}$/);
    const [b] = await billing.listBills(lee, matterA);
    expect(b).toMatchObject({ status: "recorded", total_cents: "103500" });
    await expect(billing.deleteEntry(lee, entries[0].id)).rejects.toThrow(/on a bill/);
    await expect(billing.createBill(lee, matterA, { through: "2026-10-31" })).rejects.toThrow(/nothing to bill/);
  });

  it("sends a bill to Books as a draft invoice when connected", async () => {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    books.setBooksFetch((async (u: string, init: RequestInit) => {
      sent.push({ url: u, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ id: "inv-1", number: "INV-0042" }), { status: 201 });
    }) as typeof fetch);
    process.env.BOOKS_SVC_TOKEN = "books-token";
    try {
      const bill = await billing.createBill(dan, matterB, { through: "2026-10-31" });
      const [b] = (await billing.listBills(dan, matterB)).filter((x) => x.id === bill.id);
      expect(b).toMatchObject({ status: "sent", books_number: "INV-0042", total_cents: "150000" });
      expect(sent[0].url).toMatch(/\/api\/svc\/invoices$/);
      expect(sent[0].body).toMatchObject({ customer: { name: "Acme Holdings" }, lines: [{ description: "Flat fee: Acme general", quantity: 1, unitPrice: 1500 }] });
    } finally {
      delete process.env.BOOKS_SVC_TOKEN;
      books.setBooksFetch(undefined);
    }
  });

  it("never lets a client's trust money go below zero", async () => {
    await expect(trust.createAccount(lee, { name: "IOLTA" })).rejects.toThrow(/keepers/);
    account = (await trust.createAccount(keeper, { name: "IOLTA", bank: "First Bank", jurisdiction: "NY" })).id;
    const dep = await trust.record(keeper, { kind: "deposit", accountId: account, matterId: matterA, amount: "5000", day: "2026-10-09", receivedOn: "2026-10-02", party: "Robert Roe", reference: "1001" });
    expect(dep.late).toMatch(/business days after it arrived; New York allows 1/);
    await expect(trust.record(keeper, { kind: "disbursement", accountId: account, matterId: matterA, amount: "6000", party: "Court" })).rejects.toThrow(/only has 5,000.00/);
    await expect(trust.record(keeper, { kind: "disbursement", accountId: account, matterId: matterB, amount: "1", party: "x" })).rejects.toThrow(/only has 0.00/);
    await expect(trust.record(lee, { kind: "deposit", accountId: account, matterId: matterA, amount: "1" })).rejects.toThrow(/keepers/);
    await trust.record(keeper, { kind: "disbursement", accountId: account, matterId: matterA, amount: "405", day: "2026-10-10", party: "County Clerk" });
    const [bill] = await billing.listBills(lee, matterA);
    await expect(trust.record(keeper, { kind: "fee_transfer", accountId: account, matterId: matterA, amount: "2000", billId: bill.id })).rejects.toThrow(/more than is left on the bill/);
    const fee = await trust.record(keeper, { kind: "fee_transfer", accountId: account, matterId: matterA, amount: "1035", day: "2026-10-12", billId: bill.id });
    expect(fee.bill_number).toBe(bill.number);
    expect((await billing.listBills(lee, matterA))[0].paidFromTrustCents).toBe(103500);
    await expect(billing.cancelBill(lee, bill.id)).rejects.toThrow(/Void that transfer first/);

    const ledger = await trust.ledger(lee, { matterId: matterA });
    expect(ledger.map((l) => l.runningCents)).toEqual([500000, 459500, 356000]);
    await expect(trust.ledger(lee, { accountId: account })).rejects.toThrow(/keepers/);
    expect((await trust.balances(keeper, account)).map((b) => [b.client_name, Number(b.cents)])).toEqual([["Robert Roe", 356000]]);

    // Voiding the deposit would leave the client below zero, since some of it was paid out.
    await expect(trust.voidTxn(keeper, dep.id, { reason: "wrong" })).rejects.toThrow(/below zero/);
    await expect(trust.voidTxn(keeper, fee.id, {})).rejects.toThrow(/why/);
    await trust.voidTxn(keeper, fee.id, { reason: "Client disputes the bill" });
    expect((await trust.ledger(lee, { matterId: matterA })).at(-1)!.runningCents).toBe(459500);
    await expect(law.updateMatter(lee, matterA, { status: "closed" })).rejects.toThrow(/still holds money in trust/);
  });

  it("reconciles three ways", async () => {
    const ok = await trust.reconcile(keeper, account, { statementDay: "2026-10-31", statementBalance: "4,800.00", outstandingChecks: "205", depositsInTransit: "0" });
    expect(ok).toMatchObject({ adjustedCents: 459500, bookCents: 459500, clientsCents: 459500, balanced: true });
    const off = await trust.reconcile(keeper, account, { statementDay: "2026-10-31", statementBalance: "4,800.00" });
    expect(off.balanced).toBe(false);
    const accounts = await trust.listAccounts(keeper);
    expect(accounts[0]).toMatchObject({ balanceCents: 459500, last_reconciled: "2026-10-31" });
  });

  it("posts trust entries to Books and keeps a failure to retry", async () => {
    const posted: Record<string, unknown>[] = [];
    let fail = true;
    books.setBooksFetch((async (_u: string, init: RequestInit) => {
      if (fail) return new Response(JSON.stringify({ message: "Books has no active account 1015" }), { status: 400 });
      posted.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "j1", journalNumber: "JE-1" }), { status: 200 });
    }) as typeof fetch);
    process.env.BOOKS_SVC_TOKEN = "books-token";
    try {
      const t = await trust.record(keeper, { kind: "deposit", accountId: account, matterId: matterA, amount: "100", party: "Robert Roe" });
      expect(t).toMatchObject({ books_status: "failed", books_error: expect.stringMatching(/no active account 1015/) });
      fail = false;
      expect(await trust.retryBooks(keeper, t.id)).toMatchObject({ books_status: "posted", books_error: "" });
      expect(posted[0]).toMatchObject({ reference: `law-trust:${t.id}`, kind: "adjustment", lines: [{ account: "1015", debit: 100 }, { account: "2150", credit: 100 }] });
      await trust.voidTxn(keeper, t.id, { reason: "Bounced" });
      expect(posted[1]).toMatchObject({ reference: `law-trust-void:${t.id}`, lines: [{ account: "1015", credit: 100 }, { account: "2150", debit: 100 }] });
    } finally {
      delete process.env.BOOKS_SVC_TOKEN;
      books.setBooksFetch(undefined);
    }
  });

  it("keeps deadlines and shows what's due", async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const d = await law.addDeadline(pat, matterA, { title: "Answer due", dueDay: soon, basis: "FRCP 12(a)(1)(A)(i)" });
    await expect(law.addDeadline(dan, matterA, { title: "x", dueDay: soon })).rejects.toThrow("Not found");
    const dash = await dashboard(lee);
    expect(dash.deadlines.map((x) => (x as { title: string }).title)).toEqual(["Answer due"]);
    expect(dash.myMatters).toBe(1);
    await law.updateDeadline(pat, d.id, { done: true });
    expect(await law.listDeadlines(lee, { upcoming: true })).toEqual([]);
    expect((await law.listDeadlines(admin, { matterId: matterA })).map((x) => x.title)).toEqual(["Answer due"]);
    expect((await dashboard(keeper)).trust).toMatchObject({ totalCents: 459500, overdue: [] });
  });

  it("reads text out of documents, searches them, and asks before any AI", async () => {
    const file = new File(["MOTION TO DISMISS\nDefendant Acme moves to dismiss for lack of personal jurisdiction."], "motion.txt", { type: "text/plain" });
    const up = await docs.uploadDocument(pat, matterA, file);
    expect(up.textLength).toBeGreaterThan(20);
    await expect(docs.uploadDocument(dan, matterA, file)).rejects.toThrow("Not found");
    const found = await searchFor(lee, { query: "personal jurisdiction" });
    expect(found.results.map((r) => [r.kind, r.title])).toEqual([["document", expect.stringMatching(/^motion\.txt \(/)]]);
    expect((await searchFor(dan, { query: "personal jurisdiction" })).results).toEqual([]);
    expect((await searchFor(admin, { query: "personal jurisdiction" })).results).toHaveLength(1);
    expect((await searchFor(dan, { query: "Roe", kinds: ["client"] })).results.map((r) => r.title)).toEqual(["Robert Roe"]);
    delete process.env.AI_PROVIDER;
    delete process.env.AI_API_KEY;
    await expect(docs.analyzeDocument(lee, up.id)).rejects.toThrow(/AI is off/);
    // A document removed while its uploader is on hold is only hidden.
    held.add(pat.email);
    await docs.deleteDocument(lee, up.id);
    const [row] = await q<{ held_deleted_at: Date | null }>(`SELECT held_deleted_at FROM documents WHERE id = $1`, [up.id]);
    expect(row.held_deleted_at).not.toBeNull();
    expect(await docs.listDocuments(lee, matterA)).toEqual([]);
    held.clear();
  });

  it("refuses to delete what has history, and removes what doesn't", async () => {
    await expect(law.deleteMatter(lee, matterA)).rejects.toThrow(/Close it instead/);
    await expect(law.deleteClient(admin, roe)).rejects.toThrow(/stays/);
    const spare = await law.createMatter(lee, { title: "Spare", clientId: roe });
    await expect(law.deleteMatter(pat, spare.id)).rejects.toThrow("Not found");
    await law.deleteMatter(lee, spare.id);
    const c = await law.createClient(lee, { name: "Temp Client" });
    await expect(law.deleteClient(lee, c.id)).rejects.toThrow(/administrator/);
    await law.deleteClient(admin, c.id);
    expect((await law.listClients("Temp")).length).toBe(0);
  });
});
