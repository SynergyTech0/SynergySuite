import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";
import type { PolicyClient, SearchResponse } from "@synergy/compliance";

// Runs against a real Postgres when TEST_DATABASE_URL is set. It uses a database of its own next
// to that one ("<name>_compliance"), so it can run alongside contracts.test.ts.
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

const alice = { email: "alice@example.com", name: "Alice", subject: "a" };
const bob = { email: "bob@example.com", name: "Bob", subject: "b" };
const fakePolicy: PolicyClient = { onHold: async () => true, retention: async () => [], retentionDays: async () => null, invalidate() {} };

describe.skipIf(!base)("contracts compliance", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const c = await import("../lib/contracts");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const searchRoute = await import("../app/api/compliance/search/route");
  const exportRoute = await import("../app/api/compliance/export/route");

  const call = (route: { POST: (req: Request) => Promise<Response> }, body: unknown, token: string | null = "test-token") =>
    route.POST(
      new Request("http://contracts/api/compliance", {
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

  let id = "";
  let fileId = "";

  beforeAll(async () => {
    setPolicy(fakePolicy);
    await q("TRUNCATE contracts CASCADE");
    const x = await c.createContract(alice, { title: "Warehouse lease", counterparty: "Dockside Properties", body: "Rent is due on the first of the month." });
    id = x.id;
    await c.share(alice, id, { email: bob.email });
    await c.addObligation(alice, id, { title: "Pay rent", assignee: bob.email });
    fileId = (await c.addFile(alice, id, { name: "floorplan.pdf", type: "application/pdf", bytes: Buffer.from("%PDF") })).id;
    await c.submitForApproval(alice, id, { approvers: [bob.email] });
    await c.decide(bob, id, { decision: "approve", comment: "Fine by me" });
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("answers only the Admin center's token", async () => {
    expect((await call(searchRoute, {}, null)).status).toBe(401);
    expect((await call(exportRoute, { ids: [] }, "nope")).status).toBe(401);
  });

  it("finds contracts, obligations, files and approvals by person and words", async () => {
    expect(kinds(await search({}))).toEqual(["approval", "contract", "file", "obligation"]);
    expect(kinds(await search({ custodians: [bob.email] }))).toEqual(["approval", "contract", "obligation"]);
    expect(kinds(await search({ query: "rent" }))).toEqual(["contract", "obligation"]);
  });

  it("exports a contract with its versions and history, and a file with its bytes", async () => {
    const { items } = await (await call(exportRoute, { ids: [id, fileId] })).json();
    expect(items[0]).toMatchObject({ app: "contracts", kind: "contract", owner: alice.email, metadata: { counterparty: "Dockside Properties", status: "approved" } });
    expect(items[0].text).toContain("Rent is due");
    expect(items[0].metadata.versions).toHaveLength(1);
    expect(items[1].attachments[0]).toMatchObject({ name: "floorplan.pdf", base64: Buffer.from("%PDF").toString("base64") });
  });

  it("keeps a contract deleted under a hold, hidden but found", async () => {
    expect(await c.deleteContract(alice, id)).toEqual({ held: true });
    expect(await c.listContracts(alice)).toEqual([]);
    expect((await search({ kinds: ["contract"] })).hits[0].deleted).toBe(true);
  });
});
