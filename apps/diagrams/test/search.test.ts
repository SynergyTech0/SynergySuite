import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "@synergy/db";
import type { SearchResults } from "@synergy/search";

// Suite search through the app's normal sign-in: the gateway headers, checked by identify().
// Runs against a real Postgres when TEST_DATABASE_URL is set, in a database of its own
// ("<name>_search"), so it can run alongside the other test files.
const base = process.env.TEST_DATABASE_URL;
process.env.PROXY_SHARED_SECRET = "gateway-secret";

let incoming = new Headers();
vi.mock("next/headers", () => ({ headers: async () => incoming }));

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_search`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const alice = "alice@example.com";
const bob = "bob@example.com";
const carol = "carol@example.com";

const page = (...labels: string[]) =>
  `<mxfile><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${labels
    .map((l, i) => `<mxCell id="c${i}" value="${l}" vertex="1" parent="1"/>`)
    .join("")}</root></mxGraphModel></diagram></mxfile>`;

describe.skipIf(!base)("diagrams suite search", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const d = await import("../lib/diagrams");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const route = await import("../app/api/search/route");

  const call = (email: string | null, body: unknown, secret = "gateway-secret") => {
    incoming = new Headers(email ? { "x-auth-request-email": email, "x-proxy-auth-secret": secret } : {});
    return route.POST(
      new Request("http://diagrams/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    );
  };
  const search = async (email: string, body: Record<string, unknown>) => {
    const res = await call(email, body);
    expect(res.status).toBe(200);
    return (await res.json()) as SearchResults;
  };
  const names = (r: SearchResults) => r.results.map((h) => h.title).sort();

  let network: { id: string };

  beforeAll(async () => {
    setPolicy({ onHold: async () => false, retention: async () => [], retentionDays: async () => null, invalidate() {} });
    await q("TRUNCATE diagrams CASCADE");
    network = await d.create(alice, { name: "Office network", xml: page("Core firewall", "Guest Wi-Fi") });
    await d.share(alice, network.id, bob, "view");
    const old = await d.create(alice, { name: "Old firewall plan", xml: page("Retired") });
    await q("UPDATE diagrams SET modified_at = '2020-01-01T12:00:00Z' WHERE id = $1", [old.id]);
    await d.create(carol, { name: "Carol's firewall notes" });
    const gone = await d.create(alice, { name: "Deleted firewall" });
    await q("UPDATE diagrams SET held_deleted_at = now() WHERE id = $1", [gone.id]);
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("needs the gateway's sign-in", async () => {
    expect((await call(null, { query: "firewall" })).status).toBe(401);
    expect((await call(alice, { query: "firewall" }, "wrong")).status).toBe(401);
  });

  it("refuses an empty query", async () => {
    expect((await call(alice, { query: " " })).status).toBe(400);
  });

  it("finds the person's diagrams by name and by the words on their shapes, newest first", async () => {
    const r = await search(alice, { query: "firewall" });
    expect(r.app).toBe("diagrams");
    expect(r.results.map((h) => h.title)).toEqual(["Office network", "Old firewall plan"]);
    expect(r.results[0]).toMatchObject({ id: network.id, kind: "diagram", person: alice, url: `/d/${network.id}` });
    expect(r.results[0].snippet).toContain("Core firewall");
    expect(names(await search(alice, { query: "guest" }))).toEqual(["Office network"]);
    expect((await search(alice, { query: "guest", text: true })).results[0].text).toContain("Guest Wi-Fi");
  });

  it("returns diagrams shared with the person, and nothing private", async () => {
    expect(names(await search(bob, { query: "firewall" }))).toEqual(["Office network"]);
    expect(names(await search(carol, { query: "firewall" }))).toEqual(["Carol's firewall notes"]);
  });

  it("honours limit and kinds", async () => {
    expect((await search(alice, { query: "firewall", limit: 1 })).results).toHaveLength(1);
    expect((await search(alice, { query: "firewall", kinds: ["file"] })).results).toEqual([]);
    expect((await search(alice, { query: "firewall", kinds: ["diagram"] })).results).toHaveLength(2);
  });
});
