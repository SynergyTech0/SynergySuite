import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";
import type { PolicyClient, SearchResponse } from "@synergy/compliance";

// Runs against a real Postgres when TEST_DATABASE_URL is set. It uses a database of its own next
// to that one ("<name>_compliance"), so it can run alongside contacts.test.ts.
const base = process.env.TEST_DATABASE_URL;
process.env.COMPLIANCE_TOKEN = "test-token";
delete process.env.DIRECTORY_SCIM_TOKEN;

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
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

const held = new Set<string>();
const fakePolicy: PolicyClient = {
  onHold: async (e) => held.has(e),
  retention: async () => [],
  retentionDays: async () => null,
  invalidate() {},
};

describe.skipIf(!base)("contacts compliance", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const contacts = await import("../lib/contacts");
  const directory = await import("../lib/directory");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const searchRoute = await import("../app/api/compliance/search/route");
  const exportRoute = await import("../app/api/compliance/export/route");

  const call = (route: { POST: (req: Request) => Promise<Response> }, body: unknown, token: string | null = "test-token") =>
    route.POST(
      new Request("http://contacts/api/compliance", {
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

  let ada: Awaited<ReturnType<typeof contacts.create>>;
  let grace: Awaited<ReturnType<typeof contacts.create>>;

  beforeAll(async () => {
    setPolicy(fakePolicy);
    await q("TRUNCATE contacts, groups, profiles CASCADE");
    const team = await contacts.createGroup(alice, "Engines");
    ada = await contacts.create(alice, {
      firstName: "Ada", lastName: "Lovelace", company: "Analytical Engines",
      emails: [{ label: "work", value: "ada@example.com" }], notes: "Met at the difference engine demo",
    }, [team.id]);
    await contacts.setPhoto(alice, ada.id, PNG);
    grace = await contacts.create(alice, { firstName: "Grace", lastName: "Hopper", company: "Navy" });
    await contacts.create(bob, { firstName: "Alan", lastName: "Turing", notes: "engine of thought" });
    await q("UPDATE contacts SET modified_at = '2020-01-01T12:00:00Z' WHERE id = $1", [grace.id]);
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("answers only the Admin center's token", async () => {
    expect((await call(searchRoute, {}, null)).status).toBe(401);
    expect((await call(exportRoute, { ids: [] }, "nope")).status).toBe(401);
    expect((await call(searchRoute, { custodians: "x" })).status).toBe(400);
    expect((await call(searchRoute, { limit: 0 })).status).toBe(400);
  });

  it("searches by keywords, custodians, dates and kinds", async () => {
    expect(names(await search({}))).toEqual(["Ada Lovelace", "Alan Turing", "Grace Hopper"]);
    expect(names(await search({ query: "engine" }))).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(names(await search({ query: "engine -thought" }))).toEqual(["Ada Lovelace"]);
    expect(names(await search({ query: "ada@example.com OR navy" }))).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(names(await search({ custodians: [bob] }))).toEqual(["Alan Turing"]);
    expect(names(await search({ from: "2021-01-01", custodians: [alice] }))).toEqual(["Ada Lovelace"]);
    expect(names(await search({ to: "2020-01-01" }))).toEqual(["Grace Hopper"]);
    expect(names(await search({ kinds: ["file"] }))).toEqual([]);
    const page = await search({ limit: 2 });
    expect(page.hits).toHaveLength(2);
    expect((await search({ limit: 2, cursor: page.nextCursor })).hits).toHaveLength(1);
    const [hit] = (await search({ query: "difference" })).hits;
    expect(hit).toMatchObject({ id: ada.id, kind: "contact", owner: alice });
    expect(hit.snippet).toContain("difference engine");
  });

  it("exports a card's fields, vCard and photo", async () => {
    const { items } = await (await call(exportRoute, { ids: [ada.id, "x"] })).json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ app: "contacts", id: ada.id, owner: alice, title: "Ada Lovelace" });
    expect(items[0].metadata).toMatchObject({ company: "Analytical Engines", groups: ["Engines"] });
    const [vcf, photo] = items[0].attachments;
    expect(Buffer.from(vcf.base64, "base64").toString()).toContain("FN:Ada Lovelace");
    expect(photo).toMatchObject({ type: "image/png", size: PNG.length, base64: PNG.toString("base64") });
  });

  it("keeps what a held person deletes, hidden but found", async () => {
    held.add(alice);
    expect(await contacts.remove(alice, [ada.id])).toBe(1);
    expect((await contacts.list(alice)).map((c) => c.id)).toEqual([grace.id]);
    await expect(contacts.get(alice, ada.id)).rejects.toThrow(/not found/);
    expect(await contacts.photo(alice, ada.id)).toBeNull();
    expect((await contacts.groups(alice))[0].count).toBe(0);
    expect(await directory.suggest(alice, "ada")).toEqual([]);
    expect((await search({ query: "lovelace" })).hits).toEqual([expect.objectContaining({ id: ada.id, deleted: true })]);
    // The same person can be added again, and deleting twice does nothing more.
    expect((await contacts.importContacts(alice, [{ ...contacts.clean({ firstName: "Ada", emails: [{ label: "", value: "ada@example.com" }] }), groups: [] }])).added).toBe(1);
    expect(await contacts.remove(alice, [ada.id])).toBe(0);

    // Others are deleted for good; once the hold is lifted Alice's next delete clears what it kept.
    const [alan] = await contacts.list(bob);
    await contacts.remove(bob, [alan.id]);
    expect(names(await search({ custodians: [bob] }))).toEqual([]);
    held.clear();
    await contacts.remove(alice, [grace.id]);
    expect(await q("SELECT 1 FROM contacts WHERE held_deleted_at IS NOT NULL")).toEqual([]);
    expect(names(await search({ custodians: [alice] }))).toEqual(["Ada"]);
  });
});
