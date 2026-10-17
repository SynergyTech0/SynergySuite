import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";
import type { Ctx } from "../lib/types";

// The SynergyRoutes importer (scripts/import-hub.mjs) run as run.sh runs it, on the fixture in
// test/fixtures. Runs against a real Postgres when TEST_DATABASE_URL is set, in a database of
// its own next to that one ("<name>_import"), so it can run alongside the other suites.
const base = process.env.TEST_DATABASE_URL;
const here = import.meta.dirname;
const FIXTURE = readFileSync(path.join(here, "fixtures/routes-export.ndjson"), "utf8");
const MAP = ["--map-email", "shane@routes.example=ada@example.com"];

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_import`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

/** Runs the importer with `input` on stdin; resolves with what it printed, rejects with its error. */
function runImport(input: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [path.join(here, "../scripts/import-hub.mjs"), ...args],
      { cwd: path.join(here, ".."), env: { ...process.env, CRM_DATABASE_URL: process.env.CRM_DATABASE_URL } },
      (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)),
    );
    child.stdin!.end(input);
  });
}

const ACCT = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;

describe.skipIf(!base)("SynergyRoutes import", async () => {
  if (base) process.env.DATABASE_URL = process.env.CRM_DATABASE_URL = await ownDatabase(base);
  const members = await import("../lib/members");
  const accounts = await import("../lib/accounts");
  const contacts = await import("../lib/contacts");
  const opps = await import("../lib/opportunities");
  const { q, db } = await import("../lib/db");
  let ada: Ctx;

  const count = async (table: string) => (await q<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`))[0].n;

  beforeAll(async () => {
    await q("TRUNCATE members, accounts, contacts, opportunities, leads, activities, ai_calls, held_records, crm_settings, record_shares CASCADE");
  });
  afterAll(async () => {
    await db().close();
  });

  it("refuses to run before anyone has opened the CRM", async () => {
    await expect(runImport(FIXTURE)).rejects.toThrow(/Nobody has opened the CRM yet/);
    expect(await count("accounts")).toBe(0);
  });

  it("writes nothing on a dry run, but says what it would do", async () => {
    ada = await members.join("ada@example.com", "Ada Admin");
    const out = await runImport(FIXTURE, ["--dry-run", ...MAP]);
    expect(out).toContain("[dry run] accounts: 3 added");
    expect(out).toContain("contacts: 3 added, 0 updated, 0 already up to date, 1 skipped");
    expect(out).toContain("Dry run: nothing was written.");
    for (const t of ["accounts", "contacts", "opportunities", "activities"]) expect(await count(t)).toBe(0);
    expect((await members.list()).map((m) => m.email)).toEqual(["ada@example.com"]);
  });

  it("imports accounts with their address, type and every detail, readable", async () => {
    const out = await runImport(FIXTURE, MAP);
    expect(out).toContain("accounts: 3 added");
    expect(out).toContain("Left behind (route planning and other SynergyRoutes data): territories 52, routes 12, route_stops 340.");
    const a = await accounts.get(ada, ACCT(1));
    expect(a).toMatchObject({
      name: "Main Street Pharmacy", industry: "Pharmacy", type: "prospect", address: "12 Main St\nSuite 4", city: "Austin",
      state: "TX", postalCode: "78701", lat: 30.2672, lng: -97.7431, phone: "(512) 555-0100", owner: "ada@example.com",
      createdAt: "2025-01-02T10:00:00.000Z",
    });
    expect(a.details).toEqual({
      County: "Travis", "License Number": "PH-12345", "Offers Delivery Services": "Yes", "Primary Specialties": "Compounding, Vaccines",
      Priority: "2", "Visit every": "30 days", "Last visited": "2026-03-04", "Next action": "2026-04-01",
    });
    expect((await accounts.get(ada, ACCT(2))).details).toEqual({ "Certified Beds": "120", "Five Star": "4", "Ownership Type": "For profit - Corporation" });
    expect((await accounts.get(ada, ACCT(3))).details).toEqual({ Priority: "1", "Visit every": "14 days", "Synced from": "hubspot HS-77" });
  });

  it("matches owners by email, adds missing people as reps, and gives the unowned to the admin", async () => {
    expect((await accounts.get(ada, ACCT(2))).owner).toBe("newrep@example.com");
    expect((await accounts.get(ada, ACCT(3))).owner).toBe("ada@example.com"); // no owner in SynergyRoutes
    const people = await members.list();
    expect(people.map((m) => [m.email, m.role]).sort()).toEqual([["ada@example.com", "admin"], ["newrep@example.com", "rep"], ["rex@example.com", "rep"]]);
    // Their first visit keeps the row (and its records) and fills in the name.
    expect(await members.join("Rex@Example.com", "Rex Rep")).toEqual({ email: "rex@example.com", name: "Rex Rep", role: "rep" });
  });

  it("brings contacts under their account's owner, skipping those whose account didn't come", async () => {
    const list = await contacts.list(ada, { accountId: ACCT(2) });
    expect(list.map((c) => [c.name, c.phone, c.owner])).toEqual([["Main line", "(214) 555-0101", "newrep@example.com"]]);
    expect((await contacts.list(ada, { q: "dana" })).map((c) => [c.name, c.title, c.email, c.accountName]))
      .toEqual([["Dana Director", "Administrator", "dana@hillcountry.example", "Hill Country Hospice"]]);
    expect(await count("contacts")).toBe(3);
  });

  it("brings deals and activities across", async () => {
    const deal = await opps.get(ada, "30000000-0000-4000-8000-000000000001");
    expect(deal).toMatchObject({ name: "Delivery program", amount: "12500.50", stage: "proposal", probability: 60, closeDate: "2026-06-30", owner: "ada@example.com" });
    expect((await opps.get(ada, "30000000-0000-4000-8000-000000000002")).owner).toBe("rex@example.com");
    const acts = await q<Record<string, unknown>>("SELECT type, subject, body, status, assignee, related_type, related_id, due_at FROM activities ORDER BY subject");
    expect(acts).toEqual([
      // Its contact isn't in the export, so it goes on the account.
      { type: "call", subject: "Intro call", body: "", status: "completed", assignee: "rex@example.com", related_type: "account", related_id: ACCT(3), due_at: new Date("2026-03-01T12:00:00Z") },
      { type: "event", subject: "Pitch delivery program", body: "Bring samples.\n\nWhere: 12 Main St\nLength: 45 minutes", status: "open", assignee: "ada@example.com", related_type: "opportunity", related_id: "30000000-0000-4000-8000-000000000001", due_at: new Date("2026-05-05T14:00:00Z") },
    ]);
  });

  it("filters and searches the imported accounts", async () => {
    expect((await accounts.list(ada, { industry: "Hospice" })).map((a) => a.name)).toEqual(["Hill Country Hospice"]);
    expect((await accounts.list(ada, { state: "TX" })).length).toBe(3);
    expect((await accounts.list(ada, { q: "kerrville" })).map((a) => a.name)).toEqual(["Hill Country Hospice"]);
    expect((await accounts.list(ada, { q: "78701" })).map((a) => a.name)).toEqual(["Main Street Pharmacy"]);
    expect((await accounts.list(ada, { limit: 1, offset: 1 })).map((a) => a.name)).toEqual(["Main Street Pharmacy"]);
    expect(await accounts.facets(ada)).toEqual({
      industries: [{ value: "Hospice", count: 1 }, { value: "Pharmacy", count: 1 }, { value: "Skilled Nursing Facility", count: 1 }],
      states: [{ value: "TX", count: 3 }],
    });
  });

  it("is idempotent: a second run changes nothing, and keeps what was set here", async () => {
    await accounts.update(ada, ACCT(1), { type: "customer", website: "mainstreet.example" });
    const before = await q("SELECT id, updated_at FROM accounts ORDER BY id");
    const out = await runImport(FIXTURE, MAP);
    expect(out).toContain("accounts: 0 added, 0 updated, 3 already up to date");
    expect(out).toContain("contacts: 0 added, 0 updated, 3 already up to date, 1 skipped");
    expect(out).toContain("opportunities: 0 added, 0 updated, 2 already up to date");
    expect(out).toContain("activities: 0 added, 0 updated, 2 already up to date");
    expect(await q("SELECT id, updated_at FROM accounts ORDER BY id")).toEqual(before);
    for (const [t, n] of [["accounts", 3], ["contacts", 3], ["opportunities", 2], ["activities", 2]] as const) expect(await count(t)).toBe(n);
    expect(await accounts.get(ada, ACCT(1))).toMatchObject({ type: "customer", website: "https://mainstreet.example/" });
  });

  it("updates rows that changed in SynergyRoutes since the last run", async () => {
    const changed = FIXTURE.replace('"name":"Sunrise Skilled Nursing"', '"name":"Sunrise Skilled Nursing & Rehab"')
      .replace('"Certified Beds":120', '"Certified Beds":150');
    const out = await runImport(changed, MAP);
    expect(out).toContain("accounts: 0 added, 1 updated, 2 already up to date");
    expect(await accounts.get(ada, ACCT(2))).toMatchObject({ name: "Sunrise Skilled Nursing & Rehab", details: { "Certified Beds": "150" } });
    expect(await count("accounts")).toBe(3);
  });

  it("takes --owner for records with no owner", async () => {
    await q("DELETE FROM accounts WHERE id = $1", [ACCT(3)]);
    await expect(runImport(FIXTURE, [...MAP, "--owner", "nobody@example.com"])).rejects.toThrow(/hasn't opened the CRM yet/);
    await runImport(FIXTURE, [...MAP, "--owner", "rex@example.com"]);
    expect((await accounts.get(ada, ACCT(3))).owner).toBe("rex@example.com");
  });

  it("reads a whole-document export too", async () => {
    await q("DELETE FROM accounts");
    const rows = FIXTURE.trim().split("\n").map((l) => JSON.parse(l));
    const doc = {
      users: rows.filter((r) => r.kind === "user"),
      accounts: rows.filter((r) => r.kind === "account"),
      contacts: rows.filter((r) => r.kind === "contact"),
    };
    const out = await runImport(JSON.stringify(doc), MAP);
    expect(out).toContain("accounts: 3 added");
    expect(await count("contacts")).toBe(3);
  });
});
