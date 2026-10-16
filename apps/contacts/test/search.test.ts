import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "@synergy/db";
import type { SearchResults } from "@synergy/search";

// Suite search through the app's normal sign-in: the gateway headers, checked by identify().
// Runs against a real Postgres when TEST_DATABASE_URL is set, in a database of its own
// ("<name>_search"), so it can run alongside the other test files.
const base = process.env.TEST_DATABASE_URL;
process.env.PROXY_SHARED_SECRET = "gateway-secret";
delete process.env.DIRECTORY_SCIM_TOKEN;

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

describe.skipIf(!base)("contacts suite search", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const contacts = await import("../lib/contacts");
  const directory = await import("../lib/directory");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const route = await import("../app/api/search/route");

  const call = (email: string | null, body: unknown, secret = "gateway-secret") => {
    incoming = new Headers(email ? { "x-auth-request-email": email, "x-proxy-auth-secret": secret } : {});
    return route.POST(
      new Request("http://contacts/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    );
  };
  const search = async (email: string, body: Record<string, unknown>) => {
    const res = await call(email, body);
    expect(res.status).toBe(200);
    return (await res.json()) as SearchResults;
  };
  const names = (r: SearchResults) => r.results.map((h) => h.title).sort();

  let ada: Awaited<ReturnType<typeof contacts.create>>;

  beforeAll(async () => {
    setPolicy({ onHold: async () => false, retention: async () => [], retentionDays: async () => null, invalidate() {} });
    await q("TRUNCATE contacts, groups, profiles CASCADE");
    ada = await contacts.create(alice, {
      firstName: "Ada", lastName: "Lovelace", company: "Analytical Engines",
      emails: [{ label: "work", value: "ada@example.com" }], notes: "Met at the difference engine demo",
    });
    const old = await contacts.create(alice, { firstName: "Charles", lastName: "Babbage", company: "Engines Ltd" });
    await q("UPDATE contacts SET modified_at = '2020-01-01T12:00:00Z' WHERE id = $1", [old.id]);
    await contacts.create(bob, { firstName: "Alan", lastName: "Turing", notes: "engine of thought" });
    const gone = await contacts.create(alice, { firstName: "Gone", lastName: "Engineer" });
    await q("UPDATE contacts SET held_deleted_at = now() WHERE id = $1", [gone.id]);
    // The directory (without a SCIM token: people who have used Contacts) and their profiles.
    await directory.touch(bob, "Bob Builder");
    await directory.saveProfile(bob, { name: "Bob Builder", jobTitle: "Engine designer", department: "Research" });
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("needs the gateway's sign-in", async () => {
    expect((await call(null, { query: "engine" })).status).toBe(401);
    expect((await call(alice, { query: "engine" }, "wrong")).status).toBe(401);
  });

  it("refuses an empty query", async () => {
    expect((await call(alice, { query: "" })).status).toBe(400);
    expect((await call(alice, { query: "-engine" })).status).toBe(400);
  });

  it("finds the person's own cards, newest first, with links that open them", async () => {
    const r = await search(alice, { query: "lovelace OR babbage" });
    expect(r.app).toBe("contacts");
    expect(r.results.map((h) => h.title)).toEqual(["Ada Lovelace", "Charles Babbage"]);
    expect(r.results[0]).toMatchObject({ id: ada.id, kind: "contact", url: `/?id=${ada.id}`, person: "ada@example.com" });
    expect(r.results[0].snippet).toContain("Lovelace");
    expect(names(await search(alice, { query: "difference" }))).toEqual(["Ada Lovelace"]);
    const withText = await search(alice, { query: "difference", text: true });
    expect(withText.results[0].text).toContain("Met at the difference engine demo");
  });

  it("includes the organization directory, and never another person's address book", async () => {
    const r = await search(alice, { query: "engine" });
    // Not Bob's Alan Turing card, not the card deleted under a hold.
    expect(names(r)).toEqual(["Ada Lovelace", "Bob Builder", "Charles Babbage"]);
    const entry = r.results.find((h) => h.title === "Bob Builder")!;
    expect(entry).toMatchObject({ id: `directory:${bob}`, kind: "contact", person: bob, url: `/?person=${encodeURIComponent(bob)}` });
    expect(entry.snippet).toContain("Engine designer");
    const forBob = await search(bob, { query: "engine" });
    expect(names(forBob)).toEqual(["Alan Turing", "Bob Builder"]);
  });

  it("honours limit and kinds", async () => {
    expect((await search(alice, { query: "engine", limit: 2 })).results).toHaveLength(2);
    expect((await search(alice, { query: "engine", kinds: ["file"] })).results).toEqual([]);
    expect((await search(alice, { query: "engine", kinds: ["contact"] })).results).toHaveLength(3);
  });
});
