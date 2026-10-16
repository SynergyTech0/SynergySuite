/**
 * POST /api/search against a real Postgres (TEST_DATABASE_URL): only databases the person is a
 * member of, their tables, and the text columns of their records.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

// The gateway's identity headers, as the Search app forwards them.
const gateway: Record<string, string> = {};
vi.mock("next/headers", () => ({ headers: async () => new Headers(gateway) }));
const actAs = (email: string | null) => {
  for (const k of Object.keys(gateway)) delete gateway[k];
  if (email) gateway["x-auth-request-email"] = email;
};

suite("search", () => {
  let cat: typeof import("@/lib/catalog");
  let rows: typeof import("@/lib/rows");
  let sharing: typeof import("@/lib/sharing");
  let pg: typeof import("@/lib/db");
  let POST: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
  const owner = "search-owner@example.com";
  const viewer = "search-viewer@example.com";
  const outsider = "search-outsider@example.com";
  const made: string[] = [];
  let shared: { id: string };
  let secret: { id: string };
  let tableId = "";

  const search = async (as: string | null, body: unknown) => {
    actAs(as);
    const res = await POST(
      new Request("http://localhost/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({}) },
    );
    return { status: res.status, body: await res.json() };
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    delete process.env.DEV_USER_EMAIL;
    delete process.env.DEV_EMAIL;
    delete process.env.PROXY_SHARED_SECRET;
    cat = await import("@/lib/catalog");
    rows = await import("@/lib/rows");
    sharing = await import("@/lib/sharing");
    pg = await import("@/lib/db");
    ({ POST } = await import("@/app/api/search/route"));

    shared = await cat.createDatabase(owner, { name: "Kestrel Inventory", description: "Stock for the kestrel shop" });
    secret = await cat.createDatabase(owner, { name: "Payroll", description: "Private salaries" });
    made.push(shared.id, secret.id);
    await sharing.shareDatabase(shared.id, owner, { email: viewer, role: "viewer" });

    const t = await cat.createTable(shared.id, owner, {
      name: "Parts",
      fields: [
        { name: "Title", type: "text" },
        { name: "Notes", type: "longtext" },
        { name: "Tags", type: "multichoice", options: { choices: ["fragile", "bulky"] } },
        { name: "Count", type: "number" },
      ],
    });
    tableId = t.id;
    const T = await cat.getTable(t.id, owner);
    const f = Object.fromEntries(T.fields.map((x) => [x.name, x.id]));
    await rows.insertRows(T, owner, [
      { [f.Title]: "Brass hinge", [f.Notes]: "Order from the quillfeather supplier", [f.Tags]: ["fragile"], [f.Count]: "424242" },
      { [f.Title]: "Oak plank", [f.Notes]: "Plain stock" },
    ]);

    const p = await cat.createTable(secret.id, owner, { name: "Salaries" });
    const P = await cat.getTable(p.id, owner);
    await rows.insertRows(P, owner, [{ [P.fields[1].id]: "quillfeather bonus" }]);
  });

  afterAll(async () => {
    for (const id of made) await cat.deleteDatabase(id, owner).catch(() => {});
    await pg.db().close();
  });

  it("401 without a signed-in person", async () => {
    expect((await search(null, { query: "kestrel" })).status).toBe(401);
  });

  it("400 on an empty query", async () => {
    const r = await search(owner, { query: "  " });
    expect(r.status).toBe(400);
    expect(r.body.error).toBeTruthy();
  });

  it("finds the owner's databases, tables and record text", async () => {
    const r = await search(owner, { query: "quillfeather" });
    expect(r.status).toBe(200);
    expect(r.body.app).toBe("base");
    const kinds = r.body.results.map((x: { kind: string }) => x.kind);
    expect(kinds).toEqual(["record", "record"]); // one in each of the owner's databases
    const hinge = r.body.results.find((x: { title: string }) => x.title.startsWith("Brass hinge"));
    expect(hinge.url).toBe(`/d/${shared.id}?table=${tableId}&record=1`);
    expect(hinge.snippet).toMatch(/quillfeather/);
    expect(hinge.person).toBe(owner);

    const db = await search(owner, { query: "kestrel", kinds: ["database"] });
    expect(db.body.results.map((x: { id: string }) => x.id)).toEqual([`database:${shared.id}`]);
    const tbl = await search(owner, { query: "parts" });
    expect(tbl.body.results.map((x: { id: string }) => x.id)).toEqual([`table:${tableId}`]);
  });

  it("searches only text columns, multiple choice included", async () => {
    expect((await search(owner, { query: "424242" })).body.results).toEqual([]);
    expect((await search(owner, { query: "fragile" })).body.results.map((x: { kind: string }) => x.kind)).toEqual(["record"]);
  });

  it("returns a shared database to a viewer, but not the owner's other databases", async () => {
    const r = await search(viewer, { query: "quillfeather", text: true });
    expect(r.body.results).toHaveLength(1);
    expect(r.body.results[0].title).toMatch(/^Brass hinge/);
    expect(r.body.results[0].text).toMatch(/Notes: Order from the quillfeather supplier/);
    expect((await search(viewer, { query: "payroll OR salaries" })).body.results).toEqual([]);
  });

  it("returns nothing to someone who is not a member", async () => {
    expect((await search(outsider, { query: "quillfeather OR kestrel OR payroll" })).body.results).toEqual([]);
  });

  it("honours -words and limit", async () => {
    expect((await search(owner, { query: "quillfeather -bonus" })).body.results).toHaveLength(1);
    expect((await search(owner, { query: "quillfeather", limit: 1 })).body.results).toHaveLength(1);
  });
});
