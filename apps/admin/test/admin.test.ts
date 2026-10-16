import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Me } from "../lib/types";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) {
  process.env.DATABASE_URL = url;
  process.env.ADMIN_DATABASE_URL = url;
}
process.env.ADMIN_EMAILS = "admin@example.com";
process.env.COMPLIANCE_TOKEN = "test-token";
process.env.ADMIN_EXPORT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "admin-exports-"));
delete process.env.ADMIN_SCIM_TOKEN;
delete process.env.DIRECTORY_SCIM_TOKEN;

const admin: Me = { email: "admin@example.com", name: "Admin", role: "admin" };
const ed: Me = { email: "ed@example.com", name: "Ed", role: "ediscovery" };
const other: Me = { email: "other@example.com", name: "Other", role: "ediscovery" };

describe.skipIf(!url)("admin center", async () => {
  const matters = await import("../lib/matters");
  const searches = await import("../lib/searches");
  const exportsLib = await import("../lib/exports");
  const retention = await import("../lib/retention");
  const roles = await import("../lib/roles");
  const audit = await import("../lib/audit");
  const { access } = await import("../lib/access");
  const { currentPolicy } = await import("../lib/policy");
  const search = await import("../lib/search");
  const { q, db } = await import("../lib/db");
  const { startFakeApp } = await import("./fake-compliance.mjs");

  let fake: { server: import("node:http").Server; url: string };

  beforeAll(async () => {
    await q("SELECT 1");
    await q("TRUNCATE exports, searches, holds, matters, retention_rules, roles, audit RESTART IDENTITY CASCADE");
    fake = await startFakeApp({ token: "test-token", behave: { calendar: "broken" } });
    process.env.COMPLIANCE_APP_URLS = JSON.stringify({ mail: `${fake.url}/mail`, drive: `${fake.url}/drive`, calendar: `${fake.url}/calendar` });
  });
  afterAll(async () => {
    fake?.server.close();
    await db().close();
  });

  let matterId = "";
  let holdId = "";

  it("opens a matter, places a hold and serves it in the policy", async () => {
    const m = await matters.create(ed, { name: "Northwind dispute", description: "Contract case", members: ["helper@example.com"] });
    matterId = m.id;
    expect(m).toMatchObject({ owner: ed.email, members: ["helper@example.com"], status: "open" });
    const before = (await currentPolicy()).updatedAt;
    const h = await matters.createHold(ed, m.id, { custodians: ["Alice@example.com", "bob@example.com", "alice@example.com"], apps: ["mail", "drive"] });
    holdId = h.id;
    expect(h.custodians).toEqual(["alice@example.com", "bob@example.com"]);
    const p = await currentPolicy();
    expect(p.holds).toEqual([{ id: h.id, name: "Northwind dispute hold", custodians: ["alice@example.com", "bob@example.com"], apps: ["drive", "mail"] }]);
    expect(p.updatedAt >= before).toBe(true);
    await expect(matters.createHold(ed, m.id, { custodians: [] })).rejects.toThrow(/at least one custodian/);
    await expect(matters.createHold(ed, m.id, { custodians: ["nope"] })).rejects.toThrow(/not an email/);
    await expect(matters.createHold(ed, m.id, { custodians: ["a@example.com"], apps: ["nosuchapp"] })).rejects.toThrow(/Unknown app/);
  });

  it("shows a matter only to admins, its owner and members", async () => {
    expect((await matters.list(admin)).map((m) => m.id)).toEqual([matterId]);
    expect((await matters.list(other)).length).toBe(0);
    await expect(matters.get(other, matterId)).rejects.toThrow(/not found/);
    await expect(matters.releaseHold(other, holdId)).rejects.toThrow(/not found/);
    const helper: Me = { email: "helper@example.com", name: "H", role: "ediscovery" };
    expect((await matters.get(helper, matterId)).activeHolds).toBe(1);
    expect((await matters.allHolds(admin, { custodian: "bob@example.com" })).map((h) => h.id)).toEqual([holdId]);
    expect(await matters.allHolds(admin, { custodian: "carol@example.com" })).toEqual([]);
  });

  it("edits a hold, and closing the matter lifts its holds until it reopens", async () => {
    const h = await matters.updateHold(ed, holdId, { custodians: ["alice@example.com", "carol@example.com"], apps: [] });
    expect(h.apps).toEqual([]);
    expect((await currentPolicy()).holds[0]).toMatchObject({ custodians: ["alice@example.com", "carol@example.com"], apps: [] });
    await matters.update(ed, matterId, { status: "closed" });
    expect((await currentPolicy()).holds).toEqual([]);
    await expect(matters.createHold(ed, matterId, { custodians: ["a@example.com"] })).rejects.toThrow(/Reopen/);
    const re = await matters.update(ed, matterId, { status: "open" });
    expect(re.closedAt).toBe(null);
    expect((await currentPolicy()).holds.length).toBe(1);
  });

  it("releases a hold but keeps its record", async () => {
    const r = await matters.releaseHold(ed, holdId);
    expect(r).toMatchObject({ active: false, releasedBy: ed.email });
    expect(r.releasedAt).not.toBe(null);
    expect((await currentPolicy()).holds).toEqual([]);
    const all = await matters.allHolds(admin, {});
    expect(all.map((x) => x.id)).toEqual([holdId]);
    await expect(matters.updateHold(ed, holdId, { name: "x" })).rejects.toThrow(/released/);
    expect((await matters.counts()).activeHolds).toBe(0);
  });

  it("keeps retention rules, one per app and kind", async () => {
    await retention.upsert(admin, { app: "mail", days: 30 });
    await retention.upsert(admin, { app: "crm", kind: "Lead", days: 400 });
    const again = await retention.upsert(admin, { app: "mail", days: 60 });
    await expect(retention.upsert(admin, { app: "mail", days: 0 })).rejects.toThrow(/Days/);
    await expect(retention.upsert(admin, { app: "nope", days: 3 })).rejects.toThrow(/Pick an app/);
    const p = await currentPolicy();
    expect(p.retention).toEqual([{ id: expect.any(String), app: "crm", kind: "lead", days: 400 }, { id: again.id, app: "mail", days: 60 }]);
    await retention.remove(admin, again.id);
    expect((await currentPolicy()).retention.map((r) => r.app)).toEqual(["crm"]);
  });

  it("grants and revokes the eDiscovery manager role", async () => {
    expect(await access("ed@example.com")).toEqual({ kind: "none" });
    await roles.grant(admin, { email: "Ed@Example.com" });
    expect(await access("ed@example.com")).toEqual({ kind: "ok", role: "ediscovery" });
    expect(await access("admin@example.com")).toEqual({ kind: "ok", role: "admin" });
    await expect(roles.grant(admin, { email: "admin@example.com" })).rejects.toThrow(/already an admin/);
    await expect(roles.grant(admin, { email: "x@example.com", role: "admin" })).rejects.toThrow(/ADMIN_EMAILS/);
    expect((await roles.list()).grants.map((g) => g.email)).toEqual(["ed@example.com"]);
    await roles.revoke(admin, "ed@example.com");
    expect(await access("ed@example.com")).toEqual({ kind: "none" });
  });

  it("searches the apps, saves the search and exports it to a zip", async () => {
    const s = search.cleanSearch({ query: "contract", custodians: ["alice@example.com"], apps: ["mail", "drive", "calendar"] });
    const r = await search.run(admin, s);
    const by = Object.fromEntries(r.results.map((x) => [x.app, x]));
    expect(by.mail.ok && by.drive.ok).toBe(true);
    expect(by.calendar.error).toMatch(/answered 500/);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.every((h) => h.title.toLowerCase().includes("contract") || h.snippet.toLowerCase().includes("contract"))).toBe(true);
    expect(r.hits.some((h) => h.deleted)).toBe(true);

    const item = await search.viewItem(admin, "mail", r.hits.find((h) => h.app === "mail")!.id);
    expect(item.text).toMatch(/contract/i);

    const saved = await searches.save(admin, matterId, { name: "Contract mail", ...s, counts: r.counts });
    expect((await searches.getSearch(ed, saved.id)).name).toBe("Contract mail");
    await expect(searches.getSearch(other, saved.id)).rejects.toThrow(/not found/);

    const e = await exportsLib.startExport(admin, saved.id);
    expect(e.status).toBe("pending");
    await (globalThis as unknown as { __adminLastExport: Promise<void> }).__adminLastExport;
    const done = await exportsLib.getExport(admin, e.id);
    expect(done.status).toBe("done");
    expect(done.counts.mail.items).toBe(r.counts.mail);
    expect(done.counts.calendar.error).toMatch(/500/);

    const f = await exportsLib.exportFile(admin, e.id);
    expect(f.name).toMatch(/^Northwind-dispute-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.zip$/);
    const files = unzipSync(fs.readFileSync(f.path));
    const summary = JSON.parse(strFromU8(files["summary.json"]));
    expect(summary).toMatchObject({ exportedBy: admin.email, search: { query: "contract", custodians: ["alice@example.com"] }, matter: { name: "Northwind dispute" } });
    expect(Object.keys(files).some((n) => n.startsWith("drive/") && n.endsWith(".txt"))).toBe(true);
    const rows = strFromU8(files["manifest.csv"]).trim().split("\r\n");
    expect(rows.length - 1).toBe(summary.totals.items);
    expect(done.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("writes everything to an audit log that can't be changed", async () => {
    const { entries } = await audit.list({ limit: 500 });
    const ids = entries.map((e) => Number(e.id));
    expect(ids.length).toBeGreaterThan(10);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const actions = new Set(entries.map((e) => e.action));
    for (const a of ["matter.create", "hold.create", "hold.update", "matter.close", "matter.reopen", "hold.release", "retention.create",
      "retention.update", "retention.delete", "role.grant", "role.revoke", "search.run", "search.view_item", "search.save", "export.create", "export.finish"]) {
      expect(actions, a).toContain(a);
    }
    expect((await audit.list({ action: "hold" })).entries.every((e) => e.action.startsWith("hold."))).toBe(true);
    expect((await audit.list({ q: "carol@example.com" })).entries.some((e) => e.action === "hold.update")).toBe(true);
    expect((await audit.list({ actor: "ed@" })).entries.every((e) => e.actor === ed.email)).toBe(true);
    await expect(q("UPDATE audit SET actor = 'x'")).rejects.toThrow(/append-only/);
    await expect(q("DELETE FROM audit")).rejects.toThrow(/append-only/);
  });
});
