// POST /api/search against a real Postgres. Runs when TEST_DATABASE_URL is set; skipped
// otherwise. Each run uses its own throwaway database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { workbookText } from "../lib/search";

const url = process.env.TEST_DATABASE_URL;

test("workbook text is sheet names and cell text, not formatting", () => {
  const text = workbookText({
    sheets: {
      s1: { name: "Budget", cellData: { 0: { 0: { v: "Rent", s: "boldStyle" }, 1: { v: 1200 } }, 1: { 0: { p: { body: { dataStream: "Rich note\r\n" } } } } } },
    },
    styles: { boldStyle: { bl: 1 } },
  });
  assert.deepEqual(text.split("\n"), ["Budget", "Rent", "1200", "Rich note"]);
  assert.equal(workbookText(null), "");
});

test("office search", { skip: !url && "TEST_DATABASE_URL not set" }, async (t) => {
  const name = `office_search_${process.pid}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  process.env.DATABASE_URL = Object.assign(new URL(url!), { pathname: `/${name}` }).toString();
  process.env.PROXY_SHARED_SECRET = "test-proxy-secret";
  delete process.env.DEV_USER_EMAIL;
  delete process.env.DEV_EMAIL;
  delete process.env.DOCS_ORG;
  const { q, pool } = await import("../lib/db");
  const { handleSearch } = await import("../lib/search");
  t.after(async () => {
    await pool().end();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();
  });

  const alice = "alice@example.com";
  const bob = "bob@example.com";
  const carol = "carol@example.com";
  const doc = (id: string, owner: string, kind: string, title: string, extra: { snippet?: string; scope?: string; role?: string; snapshot?: unknown; at?: string } = {}) =>
    q(
      `INSERT INTO documents (id, org, owner_email, kind, title, snippet, scope, company_role, snapshot, updated_at)
       VALUES ($1, 'synergy', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, owner, kind, title, extra.snippet ?? "", extra.scope ?? "private", extra.role ?? null, extra.snapshot ? JSON.stringify(extra.snapshot) : null, extra.at ?? new Date().toISOString()],
    );
  await doc("a-doc", alice, "doc", "Osprey launch plan", { snippet: "We launch the osprey line in May", at: "2026-10-01T00:00:00Z" });
  await doc("a-sheet", alice, "sheet", "Q4 numbers", {
    at: "2026-10-02T00:00:00Z",
    snapshot: { sheets: { s1: { name: "Costs", cellData: { 0: { 0: { v: "osprey freight", s: "x" } } } } } },
  });
  await doc("b-private", bob, "doc", "Osprey salaries", { snippet: "Private to Bob", at: "2026-10-03T00:00:00Z" });
  await doc("b-granted", bob, "slide", "Osprey pitch", { snippet: "Presentation · 4 slides", at: "2026-10-04T00:00:00Z" });
  await q(`INSERT INTO doc_grants (doc_id, org, email, role, granted_by, created_ms) VALUES ('b-granted', 'synergy', $1, 'viewer', $2, 0)`, [alice, bob]);
  await doc("b-company", bob, "doc", "Osprey handbook", { scope: "company", role: "viewer", at: "2026-10-05T00:00:00Z" });
  await doc("c-other-org", carol, "doc", "Osprey elsewhere", { scope: "company", role: "editor", at: "2026-10-06T00:00:00Z" });
  await q(`UPDATE documents SET org = 'other' WHERE id = 'c-other-org'`);

  const search = async (as: string | null, body: unknown, secret = "test-proxy-secret") => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (as) headers["x-auth-request-email"] = as;
    if (secret) headers["x-proxy-auth-secret"] = secret;
    const res = await handleSearch(new Request("http://localhost/api/search", { method: "POST", headers, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  const ids = (r: { body: { results: { id: string }[] } }) => r.body.results.map((x) => x.id);

  await t.test("401 without a trusted identity", async () => {
    assert.equal((await search(null, { query: "osprey" })).status, 401);
    assert.equal((await search(alice, { query: "osprey" }, "wrong")).status, 401);
  });

  await t.test("400 on an empty query", async () => {
    const r = await search(alice, { query: "" });
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
  });

  await t.test("finds own documents and sheet cells, newest first, with deep links", async () => {
    const r = await search(alice, { query: "osprey", kinds: ["doc", "sheet"] });
    assert.equal(r.body.app, "office");
    assert.deepEqual(ids(r), ["b-company", "a-sheet", "a-doc"]);
    const sheet = r.body.results.find((x: { id: string }) => x.id === "a-sheet");
    assert.equal(sheet.url, "/sheet/a-sheet");
    assert.match(sheet.snippet, /osprey freight/);
    assert.equal(r.body.results.find((x: { id: string }) => x.id === "a-doc").url, "/doc/a-doc");
    assert.deepEqual(ids(await search(alice, { query: "freight" })), ["a-sheet"]);
  });

  await t.test("never returns another person's private document, or another org's", async () => {
    const r = await search(alice, { query: "osprey" });
    assert.ok(!ids(r).includes("b-private"));
    assert.ok(!ids(r).includes("c-other-org"));
    // Carol is in this org: she sees only what is shared with the company.
    assert.deepEqual(ids(await search(carol, { query: "osprey" })), ["b-company"]);
  });

  await t.test("returns documents shared with the person or with the company", async () => {
    const r = await search(alice, { query: "osprey", text: true });
    assert.deepEqual(ids(r), ["b-company", "b-granted", "a-sheet", "a-doc"]);
    assert.equal(r.body.results[1].url, "/slides/b-granted");
    assert.equal(r.body.results[1].person, bob);
    assert.match(r.body.results[3].text, /launch the osprey line/);
  });

  await t.test("does not match formatting in the snapshot; honours -words and limit", async () => {
    assert.deepEqual(ids(await search(alice, { query: "cellData" })), []);
    assert.deepEqual(ids(await search(alice, { query: "osprey -freight -handbook -pitch" })), ["a-doc"]);
    assert.equal((await search(alice, { query: "osprey", limit: 2 })).body.results.length, 2);
  });
});
