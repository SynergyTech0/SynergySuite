import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";
import type { PolicyClient, SearchResponse } from "@synergy/compliance";

// Runs against a real Postgres when TEST_DATABASE_URL is set. It uses a database of its own next
// to that one ("<name>_compliance"), so it can run alongside diagrams.test.ts.
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

const alice = "alice@example.com";
const bob = "bob@example.com";
const carol = "carol@example.com";

const page = (label: string) =>
  `<mxfile><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${label}" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>`;

const held = new Set<string>();
const fakePolicy: PolicyClient = {
  onHold: async (e) => held.has(e),
  retention: async () => [],
  retentionDays: async () => null,
  invalidate() {},
};

describe.skipIf(!base)("diagrams compliance", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const d = await import("../lib/diagrams");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const searchRoute = await import("../app/api/compliance/search/route");
  const exportRoute = await import("../app/api/compliance/export/route");

  const call = (route: { POST: (req: Request) => Promise<Response> }, body: unknown, token: string | null = "test-token") =>
    route.POST(
      new Request("http://diagrams/api/compliance", {
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
  const names = (r: SearchResponse) => r.hits.map((h) => h.title).sort();

  let merger: { id: string };
  let budget: { id: string };

  beforeAll(async () => {
    setPolicy(fakePolicy);
    await q("TRUNCATE diagrams CASCADE");
    merger = await d.create(alice, { name: "Merger structure", xml: page("Holdco") });
    await d.share(alice, merger.id, bob, "edit");
    await d.save(bob, merger.id, { xml: page("Holdco and Opco"), baseVersion: 1 });
    budget = await d.create(alice, { name: "Budget", xml: page("Capex") });
    await q("UPDATE diagrams SET modified_at = '2020-01-01T12:00:00Z' WHERE id = $1", [budget.id]);
    await d.create(carol, { name: "Carol's sketch", xml: page("Draft") });
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("answers only the Admin center's token", async () => {
    expect((await call(searchRoute, {}, null)).status).toBe(401);
    expect((await call(exportRoute, { ids: [] }, "nope")).status).toBe(401);
    expect((await call(searchRoute, { to: 5 })).status).toBe(400);
  });

  it("searches by keywords, custodians, dates and kinds", async () => {
    expect(names(await search({}))).toEqual(["Budget", "Carol's sketch", "Merger structure"]);
    expect(names(await search({ query: "opco" }))).toEqual(["Merger structure"]);
    const forBob = await search({ custodians: [bob] });
    expect(forBob.hits.map((h) => [h.title, h.owner, h.participants])).toEqual([["Merger structure", alice, [bob]]]);
    expect(names(await search({ custodians: [alice], to: "2020-12-31" }))).toEqual(["Budget"]);
    expect(names(await search({ kinds: ["message"] }))).toEqual([]);
    const first = await search({ limit: 2 });
    expect(first.total).toBe(3);
    expect((await search({ limit: 2, cursor: first.nextCursor })).hits).toHaveLength(1);
  });

  it("exports a diagram with its words, people, versions and the .drawio file", async () => {
    const { items } = await (await call(exportRoute, { ids: [merger.id] })).json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ app: "diagrams", kind: "diagram", title: "Merger structure", owner: alice, text: "Merger structure\nHoldco and Opco" });
    expect(items[0].metadata).toMatchObject({ pages: 1, modifiedBy: bob, sharedWith: [{ email: bob, role: "edit" }] });
    expect(items[0].metadata.versions).toHaveLength(1);
    expect(items[0].attachments[0]).toMatchObject({ name: "Merger structure.drawio", type: "application/vnd.jgraph.mxfile" });
    expect(Buffer.from(items[0].attachments[0].base64, "base64").toString()).toContain("Holdco and Opco");
  });

  it("keeps a diagram deleted while someone on it is held, hidden but found", async () => {
    held.add(bob);
    await d.remove(alice, merger.id);
    await expect(d.get(alice, merger.id)).rejects.toThrow(/not found/);
    expect((await d.list(bob)).map((x) => x.name)).not.toContain("Merger structure");
    expect((await search({ query: "holdco" })).hits).toEqual([expect.objectContaining({ id: merger.id, deleted: true })]);
    held.clear();
    // Nobody on Budget is held: it goes for good.
    await d.remove(alice, budget.id);
    expect(names(await search({ query: "capex" }))).toEqual([]);
  });

  it("keeps every version while someone on the diagram is held", async () => {
    process.env.DIAGRAMS_VERSIONS = "1";
    held.add(carol);
    try {
      const x = await d.create(carol, { name: "Held history", xml: page("0") });
      for (let i = 1; i <= 3; i++) {
        await q("UPDATE diagram_versions SET saved_at = saved_at - interval '1 hour' WHERE diagram_id = $1", [x.id]);
        await d.save(carol, x.id, { xml: page(String(i)), baseVersion: i });
      }
      expect(await d.versions(carol, x.id)).toHaveLength(3);
    } finally {
      held.clear();
      delete process.env.DIAGRAMS_VERSIONS;
    }
  });
});
