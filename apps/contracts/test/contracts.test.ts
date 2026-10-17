import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PolicyClient } from "@synergy/compliance";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.CONTRACTS_ADMIN_EMAILS = "lee@example.com";
process.env.CONTRACTS_SIGN_TOKEN = "sign-token";

const alice = { email: "alice@example.com", name: "Alice", subject: "a" }; // owner
const bob = { email: "bob@example.com", name: "Bob", subject: "b" }; // approver
const carol = { email: "carol@example.com", name: "Carol", subject: "c" }; // second approver
const dan = { email: "dan@example.com", name: "Dan", subject: "d" }; // nobody
const lee = { email: "lee@example.com", name: "Lee", subject: "l" }; // legal

const held = new Set<string>();
const fakePolicy: PolicyClient = { onHold: async (e) => held.has(e), retention: async () => [], retentionDays: async () => null, invalidate() {} };

describe.skipIf(!url)("contracts", async () => {
  const c = await import("../lib/contracts");
  const lib = await import("../lib/library");
  const sign = await import("../lib/sign");
  const { searchFor } = await import("../lib/search");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");

  beforeAll(async () => {
    setPolicy(fakePolicy);
    await q("SELECT 1");
    await q("TRUNCATE contracts, templates, clauses, sign_events_seen CASCADE");
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  let id = "";

  it("makes a draft from a template with fields and library clauses filled in", async () => {
    await expect(lib.saveClause(alice, null, { title: "Nope", body: "x" })).rejects.toThrow(/legal team/);
    await lib.saveClause(lee, null, { title: "Confidentiality", body: "Each party keeps the other's secrets.", required: true, guidance: "Mutual, five years." });
    const t = await lib.saveTemplate(lee, null, {
      name: "Services agreement", type: "MSA", body: "# {{Title}}\nWith {{Counterparty}} from {{Start date}}. Hours: {{Hours}}.\n\n{{clause: Confidentiality}}",
    });
    const made = await lib.createFromTemplate(alice, t.id, {
      title: "Acme services", counterparty: "Acme Ltd", counterpartyEmail: "legal@acme.test", startDay: "2026-11-01", endDay: "2027-10-31",
      value: "12,000", values: { Hours: "40" },
    });
    id = made.id;
    expect(made.number).toMatch(/^CTR-\d{4}$/);
    const got = await c.getContract(alice, id);
    expect(got).toMatchObject({ status: "draft", type: "MSA", value_cents: 1200000, role: "owner", counterparty: "Acme Ltd" });
    expect(got.body).toBe("# Acme services\nWith Acme Ltd from 2026-11-01. Hours: 40.\n\nEach party keeps the other's secrets.");
    expect(got.versions).toHaveLength(1);
  });

  it("keeps a contract to its people and the legal team", async () => {
    await expect(c.getContract(dan, id)).rejects.toThrow("Not found");
    expect((await c.getContract(lee, id)).role).toBe("admin");
    expect(await c.listContracts(dan)).toEqual([]);
    expect((await searchFor(dan, { query: "acme" })).results).toEqual([]);
    expect((await searchFor(alice, { query: "acme" })).results.map((r) => r.kind)).toEqual(["contract"]);
    await c.share(alice, id, { email: dan.email, role: "viewer" });
    expect((await c.getContract(dan, id)).role).toBe("viewer");
    await expect(c.updateContract(dan, id, { title: "x" })).rejects.toThrow(/not change/);
    await c.unshare(alice, id, dan.email);
  });

  it("versions every text change while it's a draft", async () => {
    await c.updateContract(alice, id, { body: "# Acme services\nWith Acme Ltd.\n\nEach party keeps the other's secrets.", versionNote: "Shorter" });
    await c.updateContract(alice, id, { body: "# Acme services\nWith Acme Ltd.\n\nEach party keeps the other's secrets." }); // no change, no version
    const got = await c.getContract(alice, id);
    expect(got.versions.map((v: Record<string, unknown>) => v.n)).toEqual([2, 1]);
    expect((await c.version(alice, id, 1)).body).toContain("Hours: 40");
  });

  it("runs approvals in order, and a rejection sends it back to draft", async () => {
    await expect(c.submitForApproval(alice, id, { approvers: [] })).rejects.toThrow(/approver/);
    await c.submitForApproval(alice, id, { approvers: [bob.email, carol.email] });
    await expect(c.updateContract(alice, id, { body: "changed" })).rejects.toThrow(/locked/);
    expect((await c.getContract(bob, id)).role).toBe("approver");
    await expect(c.decide(carol, id, { decision: "approve" })).rejects.toThrow(/your turn/);
    expect((await c.dashboard(bob)).approvals.map((a) => a.id)).toEqual([id]);
    expect((await c.dashboard(carol)).approvals).toEqual([]);
    expect(await c.decide(bob, id, { decision: "approve" })).toEqual({ status: "review" });
    await expect(c.decide(carol, id, { decision: "reject" })).rejects.toThrow(/why/);
    expect(await c.decide(carol, id, { decision: "reject", comment: "Cap liability" })).toEqual({ status: "draft" });
    await c.submitForApproval(alice, id, { approvers: [bob.email, carol.email] });
    await c.decide(bob, id, { decision: "approve" });
    expect(await c.decide(carol, id, { decision: "approve" })).toEqual({ status: "approved" });
    const got = await c.getContract(alice, id);
    expect(got.approvals.map((a: Record<string, unknown>) => a.status)).toEqual(["approved", "approved"]);
  });

  it("goes out for signature and comes back signed through Sign's events", async () => {
    const out = await sign.sendForSignature(alice, id, { signers: [{ email: "legal@acme.test", name: "Acme" }], signUrl: "https://sign.example.test/d/1" });
    expect(out.sent).toBe(false);
    expect((await c.getContract(alice, id)).status).toBe("signing");
    const event = (ev: string, ref = `sign:doc1:${ev}:document`) => ({ type: "contract.event", ref, at: new Date().toISOString(), data: { documentId: "doc1", dealRef: `contract:${id}`, event: ev } });
    expect((await sign.applySignEvent("wrong", event("completed"))).status).toBe(401);
    expect((await sign.applySignEvent("sign-token", { ...event("completed"), data: { dealRef: "deal:9", event: "completed" } })).status).toBe(202);
    expect((await sign.applySignEvent("sign-token", event("signer_signed", "sign:doc1:signer_signed:s1"))).status).toBe(200);
    expect((await sign.applySignEvent("sign-token", event("completed"))).status).toBe(200);
    expect(await sign.applySignEvent("sign-token", event("completed"))).toEqual({ status: 200, json: { ok: true, duplicate: true } });
    const got = await c.getContract(alice, id);
    expect(got.status).toBe("active");
    expect(got.signed_at).toBeTruthy();
    expect(got.events.map((e: Record<string, unknown>) => e.kind)).toContain("signer signed");
  });

  it("renews by itself past its end date, or expires when it doesn't", async () => {
    const auto = await c.createContract(alice, { title: "Hosting", startDay: "2024-01-01", endDay: "2025-01-31", autoRenew: true, renewalMonths: 12 });
    const plain = await c.createContract(alice, { title: "Old lease", endDay: "2025-06-30" });
    await q(`UPDATE contracts SET status = 'active' WHERE id = ANY($1::uuid[])`, [[auto.id, plain.id]]);
    expect(await c.sweep(true)).toEqual({ renewed: 1, expired: 1 });
    const a = await c.getContract(alice, auto.id);
    expect(a.status).toBe("active");
    expect(a.end_day! >= new Date().toISOString().slice(0, 10)).toBe(true);
    expect(a.end_day!.slice(5)).toBe("01-31");
    expect((await c.getContract(alice, plain.id)).status).toBe("expired");
    const r = await c.renew(alice, plain.id, { months: 6 });
    expect((await c.getContract(alice, plain.id)).status).toBe("active");
    expect(r.endDay > "2025-06-30").toBe(true);
  });

  it("puts notice deadlines and due obligations on the overview", async () => {
    const soon = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    const n = await c.createContract(alice, { title: "Software licence", endDay: soon, noticeDays: 30 });
    await q(`UPDATE contracts SET status = 'active' WHERE id = $1`, [n.id]);
    const o = await c.addObligation(alice, n.id, { title: "Send usage report", dueDay: soon, assignee: bob.email });
    const d = await c.dashboard(alice);
    expect(d.alerts.map((x) => x.id)).toContain(n.id);
    expect(d.obligations.map((x) => x.id)).toEqual([o.id]);
    // The assignee can tick it off without edit rights on the contract.
    await expect(c.updateObligation(bob, o.id, { done: true })).rejects.toThrow("Not found");
    await c.share(alice, n.id, { email: bob.email });
    await c.updateObligation(bob, o.id, { done: true });
    await expect(c.updateObligation(bob, o.id, { title: "x" })).rejects.toThrow(/not change/);
    expect((await c.dashboard(alice)).obligations).toEqual([]);
  });

  it("marks a contract signed when the signed copy is uploaded, and keeps files under a hold", async () => {
    const x = await c.createContract(alice, { title: "NDA with Beta" });
    await q(`UPDATE contracts SET status = 'approved' WHERE id = $1`, [x.id]);
    const f = await c.addFile(alice, x.id, { name: "signed.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.4"), kind: "executed" });
    expect((await c.getContract(alice, x.id)).status).toBe("active");
    expect((await c.getFile(alice, f.id)).bytes.toString()).toBe("%PDF-1.4");
    held.add(alice.email);
    await c.deleteFile(alice, f.id);
    await expect(c.getFile(alice, f.id)).rejects.toThrow("Not found");
    expect((await q(`SELECT held_deleted_at FROM contract_files WHERE id = $1`, [f.id]))[0].held_deleted_at).toBeTruthy();
    expect(await c.deleteContract(alice, x.id)).toEqual({ held: true });
    await expect(c.getContract(alice, x.id)).rejects.toThrow("Not found");
    held.clear();
    const y = await c.createContract(alice, { title: "Scratch" });
    expect(await c.deleteContract(alice, y.id)).toEqual({ held: false });
    expect(await q(`SELECT 1 FROM contracts WHERE id = $1`, [y.id])).toEqual([]);
  });
});
