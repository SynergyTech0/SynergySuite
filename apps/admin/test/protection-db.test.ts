import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Me } from "../lib/types";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) {
  process.env.DATABASE_URL = url;
  process.env.ADMIN_DATABASE_URL = url;
}
process.env.MAIL_DOMAIN = "example.com";

const admin: Me = { email: "admin@example.com", name: "Admin", role: "admin" };

describe.skipIf(!url)("information protection", async () => {
  const p = await import("../lib/protection");
  const { currentPolicy } = await import("../lib/policy");
  const audit = await import("../lib/audit");
  const { q, db } = await import("../lib/db");

  beforeAll(async () => {
    await q("SELECT 1");
    await q("TRUNCATE dlp_rules, dlp_types, dlp_incidents");
    await q("UPDATE dlp_settings SET internal_domains = '[]'");
  });
  afterAll(async () => {
    await db().close();
  });

  it("seeds the four default labels once and serves them in the policy", async () => {
    const s = await p.labelSettings();
    expect(s.labels.map((l) => l.name).slice(0, 4)).toEqual(["Public", "General", "Confidential", "Highly Confidential"]);
    expect((await currentPolicy()).labels?.labels.length).toBe(s.labels.length);
  });

  it("creates, changes, orders and deletes labels, recording each change", async () => {
    const before = (await currentPolicy()).updatedAt;
    const l = await p.createLabel(admin, { name: "Board only", color: "#7c3aed", protection: { blockExternal: true } });
    expect(l.priority).toBeGreaterThan(3);
    const changed = await p.updateLabel(admin, l.id, { name: "Board only", color: "#7c3aed", protection: { blockExternal: true, marking: "BOARD" } });
    expect(changed.protection.marking).toBe("BOARD");
    let s = await p.saveLabelSettings(admin, { defaultLabelId: l.id });
    expect(s.defaultLabelId).toBe(l.id);
    const order = [l.id, ...s.labels.filter((x) => x.id !== l.id).map((x) => x.id)];
    s = await p.saveLabelSettings(admin, { order });
    expect(s.labels[0].id).toBe(l.id);
    await expect(p.saveLabelSettings(admin, { order: [l.id] })).rejects.toThrow(/every label/);
    await expect(p.createLabel(admin, { name: "board ONLY", color: "#7c3aed" })).rejects.toMatchObject({ code: "23505" });
    await p.removeLabel(admin, l.id);
    s = await p.labelSettings();
    expect(s.defaultLabelId).toBeUndefined();
    expect(s.labels.some((x) => x.id === l.id)).toBe(false);
    expect((await currentPolicy()).updatedAt > before).toBe(true);
    const log = await audit.list({ action: "label" });
    expect(log.entries.map((e) => e.action)).toEqual(expect.arrayContaining(["label.create", "label.update", "label.settings", "label.delete"]));
    // Put the defaults back in their usual order for the rest of the suite.
    await p.saveLabelSettings(admin, { order: s.labels.map((x) => x.id) });
  });

  it("keeps DLP rules, custom types and domains, and feeds only live rules", async () => {
    const t = await p.createType(admin, { name: "Employee ID", pattern: "EMP-\\d{6}" });
    const r = await p.createRule(admin, { name: "IDs out", types: [{ type: t.id, min: 1 }], action: "block", mode: "enforce" });
    await p.createRule(admin, { name: "Off", types: [{ type: "credit-card", min: 1 }], action: "block", enabled: false });
    await expect(p.removeType(admin, t.id)).rejects.toThrow(/IDs out/);
    expect(await p.saveDomains(admin, "partner.example")).toEqual(["partner.example"]);
    const feed = (await currentPolicy()).dlp!;
    expect(feed.rules.map((x) => x.name)).toEqual(["IDs out"]);
    expect(feed.internalDomains).toEqual(["example.com", "partner.example"]);
    expect(feed.types.map((x) => x.id)).toEqual([t.id]);
    const d = await p.testDlp({ text: "badge EMP-123456", recipients: "x@gmail.com" });
    expect(d.action).toBe("block");
    expect((await p.testDlp({ text: "badge EMP-123456", recipients: "x@partner.example" })).action).toBe("allow");
    const u = await p.updateRule(admin, r.id, { name: "IDs out", types: [{ type: t.id, min: 1 }], action: "warn", mode: "enforce", scope: "anyone" });
    expect(u.action).toBe("warn");
    await p.removeRule(admin, r.id);
  });

  it("stores incidents apps report and lets admins work them", async () => {
    const { id } = await p.addIncident({ app: "mail", actor: "pat@example.com", action: "block", title: "Card list", rules: [{ id: "r", name: "Cards", action: "block" }], matches: [{ type: "credit-card", name: "Credit card number", count: 3 }], recipients: ["x@gmail.com"] });
    let list = await p.listIncidents({ status: "open" });
    expect(list.open).toBe(1);
    expect(list.incidents[0]).toMatchObject({ id, app: "mail", actor: "pat@example.com", title: "Card list", status: "open" });
    const done = await p.updateIncident(admin, id, { status: "resolved", note: "Talked to Pat" });
    expect(done).toMatchObject({ status: "resolved", note: "Talked to Pat", resolvedBy: admin.email });
    list = await p.listIncidents({ status: "open" });
    expect(list.open).toBe(0);
    expect((await p.listIncidents({ q: "gmail" })).incidents.length).toBe(1);
  });
});
