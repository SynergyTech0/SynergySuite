import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "@synergy/db";
import type { SearchResults } from "@synergy/search";
import type { Ctx } from "../lib/types";

// Runs against a real Postgres when TEST_DATABASE_URL is set, in a database of its own next to
// that one ("<name>_search"), so it can run alongside the other suites.
const base = process.env.TEST_DATABASE_URL;
process.env.PROXY_SHARED_SECRET = "gateway-secret";

// Route handlers read the request's headers through next/headers; the test sets them per call.
let current = new Headers();
vi.mock("next/headers", () => ({ headers: async () => current }));

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_search`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const held = new Set<string>();

describe.skipIf(!base)("crm search", async () => {
  if (base) process.env.DATABASE_URL = process.env.CRM_DATABASE_URL = await ownDatabase(base);
  const members = await import("../lib/members");
  const accounts = await import("../lib/accounts");
  const contacts = await import("../lib/contacts");
  const leads = await import("../lib/leads");
  const opps = await import("../lib/opportunities");
  const activities = await import("../lib/activities");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const searchRoute = await import("../app/api/search/route");

  const call = (email: string | null, body: unknown) => {
    current = new Headers(email ? { "x-auth-request-email": email, "x-proxy-auth-secret": "gateway-secret" } : {});
    return searchRoute.POST(
      new Request("http://crm/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    );
  };
  const search = async (email: string, body: Record<string, unknown>) => {
    const res = await call(email, body);
    expect(res.status).toBe(200);
    return (await res.json()) as SearchResults;
  };
  const titles = (r: SearchResults) => r.results.map((h) => `${h.kind}:${h.title}`).sort();

  let rex: Ctx, rita: Ctx;
  let northwind: { id: string }, deal: { id: string }, lead: { id: string };

  beforeAll(async () => {
    setPolicy({ onHold: async (e) => held.has(e), retention: async () => [], retentionDays: async () => null, invalidate() {} });
    await q("TRUNCATE members, accounts, contacts, opportunities, leads, activities, ai_calls, held_records CASCADE");
    await members.join("ada@example.com", "Ada Admin");
    rex = await members.join("rex@example.com", "Rex Rep");
    rita = await members.join("rita@example.com", "Rita Rep");
    northwind = await accounts.create(rex, { name: "Northwind", industry: "Shipping", type: "customer" });
    await contacts.create(rex, { accountId: northwind.id, name: "Grace Hopper", email: "grace@northwind.example" });
    deal = await opps.create(rex, { accountId: northwind.id, name: "Fleet renewal", amount: "50000" });
    await activities.create(rex, { relatedType: "opportunity", relatedId: deal.id, type: "call", subject: "Pricing call", body: "Discussed the volume discount" });
    lead = await leads.create(rita, { name: "Alan Turing", company: "Bletchley Ltd", email: "alan@bletchley.example" });
    await q("UPDATE leads SET updated_at = '2020-01-01T12:00:00Z' WHERE id = $1", [lead.id]);
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("finds the person's own records, newest first, with deep links", async () => {
    const r = await search(rex.email, { query: "northwind" });
    expect(r.app).toBe("crm");
    expect(titles(r)).toEqual(["account:Northwind", "contact:Grace Hopper", "opportunity:Fleet renewal"]);
    const dates = r.results.map((h) => h.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    const acct = r.results.find((h) => h.kind === "account")!;
    expect(acct).toMatchObject({ id: northwind.id, url: `/#/accounts/${northwind.id}`, person: "Rex" });
    const [call1] = (await search(rex.email, { query: "volume", text: true })).results;
    expect(call1).toMatchObject({ kind: "activity", url: `/#/opportunities/${deal.id}`, snippet: expect.stringContaining("volume discount") });
    expect(call1.text).toContain("Discussed the volume discount");
  });

  it("shows every member the organization's records, as the CRM's own lists do", async () => {
    // Reads are open to the whole organization in the CRM: Rita sees Rex's account and Rex her lead.
    expect(titles(await search(rita.email, { query: "northwind", kinds: ["account"] }))).toEqual(["account:Northwind"]);
    expect(titles(await search(rex.email, { query: "bletchley" }))).toEqual(["lead:Alan Turing"]);
    // A newcomer becomes a member on first visit, like opening the CRM.
    expect(titles(await search("new@example.com", { query: "turing" }))).toEqual(["lead:Alan Turing"]);
  });

  it("honours kinds and limit", async () => {
    expect(titles(await search(rex.email, { query: "northwind", kinds: ["contact", "opportunity"] }))).toEqual(["contact:Grace Hopper", "opportunity:Fleet renewal"]);
    expect((await search(rex.email, { query: "northwind", kinds: ["file"] })).results).toEqual([]);
    expect((await search(rex.email, { query: "northwind", limit: 1 })).results).toHaveLength(1);
  });

  it("never returns what was deleted, even when a hold keeps it for eDiscovery", async () => {
    held.add(rex.email);
    const other = await accounts.create(rex, { name: "Contoso Held" });
    await accounts.remove(rex, other.id);
    expect((await q("SELECT 1 FROM held_records WHERE id = $1", [other.id])).length).toBe(1);
    expect((await search(rex.email, { query: "contoso" })).results).toEqual([]);
    held.clear();
  });

  it("needs a signed-in person and a query", async () => {
    expect((await call(null, { query: "northwind" })).status).toBe(401);
    current = new Headers({ "x-auth-request-email": rex.email, "x-proxy-auth-secret": "wrong" });
    expect((await searchRoute.POST(new Request("http://crm/api/search", { method: "POST", body: JSON.stringify({ query: "x" }) }))).status).toBe(401);
    const empty = await call(rex.email, { query: "  " });
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toBeTruthy();
    expect((await call(rex.email, {})).status).toBe(400);
  });
});
