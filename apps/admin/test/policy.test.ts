import { describe, expect, it } from "vitest";
import { buildPolicy, type PolicyHoldRow } from "../lib/policy";

const hold = (over: Partial<PolicyHoldRow>): PolicyHoldRow => ({
  id: "h1", name: "Hold", custodians: ["alice@example.com"], apps: [], active: true, matter_status: "open", ...over,
});

describe("policy", () => {
  it("keeps only active holds in open matters", () => {
    const p = buildPolicy(
      [hold({ id: "a" }), hold({ id: "released", active: false }), hold({ id: "closed", matter_status: "closed" })],
      [],
      "2026-10-01T00:00:00Z",
    );
    expect(p.holds.map((h) => h.id)).toEqual(["a"]);
    expect(p.updatedAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("lower-cases and de-duplicates custodians and apps, and drops holds with nobody on them", () => {
    const p = buildPolicy(
      [hold({ custodians: [" Bob@Example.com", "alice@example.com", "bob@example.com"], apps: ["mail", "drive", "mail"] }), hold({ id: "empty", custodians: [] })],
      [],
      new Date(0),
    );
    expect(p.holds).toEqual([{ id: "h1", name: "Hold", custodians: ["alice@example.com", "bob@example.com"], apps: ["drive", "mail"] }]);
  });

  it("passes retention rules through, leaving kind out for whole-app rules", () => {
    const p = buildPolicy([], [{ id: "r1", app: "mail", kind: "", days: 30 }, { id: "r2", app: "crm", kind: "lead", days: 365 }, { id: "bad", app: "x", kind: "", days: 0 }], new Date(0));
    expect(p.retention).toEqual([{ id: "r1", app: "mail", days: 30 }, { id: "r2", app: "crm", kind: "lead", days: 365 }]);
  });

  it("is what the apps' policy client understands", async () => {
    const { createPolicyClient } = await import("@synergy/compliance");
    const policy = buildPolicy([hold({ apps: ["mail"] }), hold({ id: "h2", custodians: ["carol@example.com"] })], [{ id: "r", app: "drive", kind: "", days: 7 }], new Date());
    const fake = (async () => new Response(JSON.stringify(policy))) as unknown as typeof fetch;
    const mail = createPolicyClient({ app: "mail", url: "http://admin", token: "t", fetch: fake });
    const drive = createPolicyClient({ app: "drive", url: "http://admin", token: "t", fetch: fake });
    expect(await mail.onHold("ALICE@example.com")).toBe(true);
    expect(await drive.onHold("alice@example.com")).toBe(false);
    expect(await drive.onHold("carol@example.com")).toBe(true);
    expect(await drive.retentionDays("file")).toBe(7);
    expect(await mail.retentionDays("message")).toBe(null);
  });
});
