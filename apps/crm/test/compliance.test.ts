import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";
import type { PolicyClient, SearchResponse } from "@synergy/compliance";
import type { Ctx } from "../lib/types";

// Runs against a real Postgres when TEST_DATABASE_URL is set. It uses a database of its own next
// to that one ("<name>_compliance"), so it can run alongside crm.test.ts.
const base = process.env.TEST_DATABASE_URL;
process.env.COMPLIANCE_TOKEN = "test-token";

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_compliance`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const held = new Set<string>();
const fakePolicy: PolicyClient = {
  onHold: async (e) => held.has(e),
  retention: async () => [],
  retentionDays: async () => null,
  invalidate() {},
};

describe.skipIf(!base)("crm compliance", async () => {
  if (base) process.env.DATABASE_URL = process.env.CRM_DATABASE_URL = await ownDatabase(base);
  const members = await import("../lib/members");
  const accounts = await import("../lib/accounts");
  const contacts = await import("../lib/contacts");
  const leads = await import("../lib/leads");
  const opps = await import("../lib/opportunities");
  const activities = await import("../lib/activities");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const searchRoute = await import("../app/api/compliance/search/route");
  const exportRoute = await import("../app/api/compliance/export/route");

  const call = (route: { POST: (req: Request) => Promise<Response> }, body: unknown, token: string | null = "test-token") =>
    route.POST(
      new Request("http://crm/api/compliance", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
  const search = async (body: Record<string, unknown>) => {
    const res = await call(searchRoute, body);
    expect(res.status).toBe(200);
    return (await res.json()) as SearchResponse;
  };
  const titles = (r: SearchResponse) => r.hits.map((h) => `${h.kind}:${h.title}`).sort();

  let admin: Ctx, rex: Ctx, rita: Ctx;
  let northwind: { id: string }, grace: { id: string }, deal: { id: string }, lead: { id: string }, call1: { id: string };

  beforeAll(async () => {
    setPolicy(fakePolicy);
    await q("TRUNCATE members, accounts, contacts, opportunities, leads, activities, ai_calls, held_records CASCADE");
    admin = await members.join("ada@example.com", "Ada Admin");
    rex = await members.join("rex@example.com", "Rex Rep");
    rita = await members.join("rita@example.com", "Rita Rep");
    northwind = await accounts.create(rex, { name: "Northwind", industry: "Shipping", type: "customer" });
    grace = await contacts.create(rex, { accountId: northwind.id, name: "Grace Hopper", email: "grace@northwind.example" });
    deal = await opps.create(rex, { accountId: northwind.id, name: "Fleet renewal", amount: "50000" });
    call1 = await activities.create(rex, { relatedType: "opportunity", relatedId: deal.id, type: "call", subject: "Pricing call", body: "Discussed the volume discount" });
    lead = await leads.create(rita, { name: "Alan Turing", company: "Bletchley Ltd", email: "alan@bletchley.example" });
    await activities.create(rita, { relatedType: "lead", relatedId: lead.id, type: "note", subject: "Intro note", body: "Met at the conference" });
    await q("UPDATE leads SET updated_at = '2020-01-01T12:00:00Z' WHERE id = $1", [lead.id]);
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("answers only the Admin center's token", async () => {
    expect((await call(searchRoute, {}, null)).status).toBe(401);
    expect((await call(exportRoute, { ids: [] }, "nope")).status).toBe(401);
    expect((await call(searchRoute, { cursor: "%%%" })).status).toBe(400);
    expect((await call(exportRoute, {})).status).toBe(400);
  });

  it("searches by keywords, custodians, dates and kinds", async () => {
    expect((await search({})).total).toBe(6);
    expect(titles(await search({ query: "northwind" }))).toEqual(["account:Northwind", "contact:Grace Hopper", "opportunity:Fleet renewal"]);
    expect(titles(await search({ query: "discount OR conference" }))).toEqual(["activity:Intro note", "activity:Pricing call"]);
    expect(titles(await search({ query: "northwind -shipping", kinds: ["account", "contact"] }))).toEqual(["contact:Grace Hopper"]);
    expect(titles(await search({ custodians: ["rita@example.com"] }))).toEqual(["activity:Intro note", "lead:Alan Turing"]);
    expect(titles(await search({ to: "2020-06-01" }))).toEqual(["lead:Alan Turing"]);
    expect((await search({ from: "2021-01-01" })).total).toBe(5);
    expect(titles(await search({ kinds: ["lead"] }))).toEqual(["lead:Alan Turing"]);
    expect((await search({ kinds: ["file"] })).hits).toEqual([]);
    const page = await search({ limit: 4 });
    expect(page.hits).toHaveLength(4);
    expect((await search({ limit: 4, cursor: page.nextCursor })).hits).toHaveLength(2);
    const [pricing] = (await search({ query: "volume" })).hits;
    expect(pricing).toMatchObject({ id: call1.id, kind: "activity", owner: rex.email });
    expect(pricing.snippet).toContain("volume discount");
  });

  it("exports records with their activity timeline", async () => {
    const { items } = await (await call(exportRoute, { ids: [deal.id, call1.id, "nope"] })).json();
    expect(items.map((i: { kind: string }) => i.kind)).toEqual(["opportunity", "activity"]);
    expect(items[0]).toMatchObject({ app: "crm", title: "Fleet renewal", owner: rex.email });
    expect(items[0].metadata).toMatchObject({ account_name: "Northwind", amount: 50000, stage: "prospecting" });
    expect(items[0].metadata.activities).toEqual([expect.objectContaining({ subject: "Pricing call", type: "call" })]);
    expect(items[1].metadata).toMatchObject({ related_name: "Fleet renewal", body: "Discussed the volume discount" });
  });

  it("keeps what a held owner's deletes take, hidden but found", async () => {
    held.add(rex.email);
    await accounts.remove(admin, northwind.id);
    expect(await accounts.list(admin)).toEqual([]);
    expect(await contacts.list(admin)).toEqual([]);
    await expect(opps.get(admin, deal.id)).rejects.toThrow(/not found/);
    const found = await search({ custodians: [rex.email] });
    expect(titles(found)).toEqual(["account:Northwind", "activity:Pricing call", "contact:Grace Hopper", "opportunity:Fleet renewal"]);
    expect(found.hits.every((h) => h.deleted)).toBe(true);
    const { items } = await (await call(exportRoute, { ids: [grace.id] })).json();
    expect(items[0]).toMatchObject({ deleted: true, title: "Grace Hopper" });
    expect(items[0].metadata).toMatchObject({ email: "grace@northwind.example", account_name: "Northwind" });

    // Rita isn't held: her lead and its note go for good.
    await leads.remove(rita, lead.id);
    expect(await search({ custodians: [rita.email] })).toMatchObject({ hits: [], total: 0 });
    // An activity is kept when whoever logged it is held, even if it is someone else's.
    const other = await accounts.create(rita, { name: "Contoso" });
    const note = await activities.create(rex, { relatedType: "account", relatedId: other.id, type: "note", subject: "Rex's note", assignee: rex.email });
    await q("UPDATE activities SET assignee = $2 WHERE id = $1", [note.id, rita.email]);
    await activities.remove(admin, note.id);
    expect((await search({ query: "rex's" })).hits).toEqual([expect.objectContaining({ id: note.id, owner: rita.email, deleted: true })]);
    await accounts.remove(rita, other.id);
    expect((await search({ query: "contoso", kinds: ["account"] })).hits).toEqual([]);
    held.clear();
  });
});
