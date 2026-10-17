import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";
import type { PolicyClient, SearchResponse } from "@synergy/compliance";

// Runs against a real Postgres when TEST_DATABASE_URL is set. It uses a database of its own next
// to that one ("<name>_compliance"), so it can run alongside law.test.ts.
const base = process.env.TEST_DATABASE_URL;
process.env.COMPLIANCE_TOKEN = "test-token";
process.env.LAW_TRUST_EMAILS = "keeper@example.com";

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_compliance`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const lee = { email: "lee@example.com", name: "Lee", subject: "l" };
const pat = { email: "pat@example.com", name: "Pat", subject: "p" };
const keeper = { email: "keeper@example.com", name: "Kim", subject: "k" };
const fakePolicy: PolicyClient = { onHold: async () => true, retention: async () => [], retentionDays: async () => null, invalidate() {} };

describe.skipIf(!base)("law compliance", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const law = await import("../lib/law");
  const billing = await import("../lib/billing");
  const trust = await import("../lib/trust");
  const docs = await import("../lib/documents");
  const conflicts = await import("../lib/conflicts");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const searchRoute = await import("../app/api/compliance/search/route");
  const exportRoute = await import("../app/api/compliance/export/route");

  const call = (route: { POST: (req: Request) => Promise<Response> }, body: unknown, token: string | null = "test-token") =>
    route.POST(
      new Request("http://law/api/compliance", {
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
  const kinds = (r: SearchResponse) => r.hits.map((h) => h.kind).sort();

  let matterId = "";
  let docId = "";

  beforeAll(async () => {
    setPolicy(fakePolicy);
    await q("TRUNCATE clients, matters, conflict_checks, trust_accounts, reconciliations, bills CASCADE");
    const check = await conflicts.runCheck(lee, { names: ["Bayside Shipping Co"] });
    matterId = (await law.createMatter(lee, { title: "Harbor lease dispute", client: { name: "Bayside Shipping Co", kind: "organization" }, conflictCheckId: check.id })).id;
    await law.addPerson(lee, matterId, { email: pat.email, role: "paralegal" });
    await billing.addEntry(pat, matterId, { hours: "2", description: "Review the warehouse lease" });
    const account = (await trust.createAccount(keeper, { name: "IOLTA" })).id;
    await trust.record(keeper, { kind: "deposit", accountId: account, matterId, amount: "2500", party: "Bayside Shipping Co" });
    docId = (await docs.uploadDocument(pat, matterId, new File(["The lease runs to 2030 and the rent is due monthly."], "lease.txt", { type: "text/plain" }))).id;
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("answers only the Admin center's token", async () => {
    expect((await call(searchRoute, {}, null)).status).toBe(401);
    expect((await call(exportRoute, { ids: [] }, "nope")).status).toBe(401);
  });

  it("finds every kind by person and words", async () => {
    expect(kinds(await search({}))).toEqual(["client", "conflict_check", "document", "matter", "time", "trust"]);
    expect(kinds(await search({ custodians: [pat.email] }))).toEqual(["document", "matter", "time"]);
    expect(kinds(await search({ query: "lease" }))).toEqual(["document", "matter", "time"]);
  });

  it("exports a matter with its team and history, and a document with its bytes", async () => {
    const { items } = await (await call(exportRoute, { ids: [matterId, docId] })).json();
    expect(items[0]).toMatchObject({ app: "law", kind: "matter", owner: lee.email, metadata: { client: "Bayside Shipping Co", status: "open" } });
    expect(items[0].metadata.people).toHaveLength(1);
    expect(items[0].metadata.events.length).toBeGreaterThan(0);
    expect(items[1].text).toContain("rent is due monthly");
    expect(items[1].attachments[0]).toMatchObject({ name: "lease.txt", base64: Buffer.from("The lease runs to 2030 and the rent is due monthly.").toString("base64") });
  });

  it("keeps a document deleted under a hold, hidden but found", async () => {
    await docs.deleteDocument(lee, docId);
    expect(await docs.listDocuments(lee, matterId)).toEqual([]);
    expect((await search({ kinds: ["document"] })).hits[0].deleted).toBe(true);
  });
});
