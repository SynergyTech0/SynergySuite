import { describe, expect, it } from "vitest";
import { DEFAULT_LABELS, type DlpRule, type DlpSettings, evaluateDlp } from "@synergy/compliance";
import { decideShare, incidentFor, internalDomainsFor, justificationOf, outsiders } from "../lib/protection";

const label = (name: string) => DEFAULT_LABELS.find((l) => l.name === name)!;
const highly = label("Highly Confidential");
const confidential = label("Confidential");

const rule = (r: Partial<DlpRule>): DlpRule => ({
  id: r.name ?? "r", name: "Rule", enabled: true, mode: "enforce", apps: [], types: [], labels: [], scope: "external", action: "warn", ...r,
});
const settings = (rules: DlpRule[]): DlpSettings => ({ rules, types: [], internalDomains: ["example.com"] });
const card = "Card on file: 4111 1111 1111 1111";

/** One share through the same steps lib/drive.ts takes. */
function check(p: { rules: DlpRule[]; text?: string; labelId?: string | null; kind: "link" | "people"; recipients?: string[]; override?: unknown; blockedBy?: typeof highly | null; own?: boolean }) {
  const recipients = p.recipients ?? [];
  const outside = outsiders(recipients, ["example.com"]);
  const external = p.kind === "link" || outside.length > 0;
  const decision = evaluateDlp(settings(p.rules), { app: "drive", text: p.text, labelId: p.labelId, recipients, external });
  const blockedBy = p.blockedBy === undefined ? (DEFAULT_LABELS.find((l) => l.id === p.labelId) ?? null) : p.blockedBy;
  const outcome = decideShare({ name: "plan.docx", kind: p.kind, external, outside, blockedBy, own: p.own ?? true, decision, override: p.override as never });
  return { outcome, decision, incident: incidentFor({ actor: "alice@example.com", name: "plan.docx", itemId: "i1", labelId: p.labelId ?? null, recipients, decision, outcome }) };
}

describe("share decisions", () => {
  it("keeps labeled files inside: no view links, no outside people", () => {
    const link = check({ rules: [], labelId: highly.id, kind: "link" });
    expect(link.outcome).toMatchObject({ allow: false, status: 422 });
    expect(!link.outcome.allow && link.outcome.error).toMatch(/labeled Highly Confidential.*can't have a view link/);
    const out = check({ rules: [], labelId: highly.id, kind: "people", recipients: ["eve@other.org"] });
    expect(!out.outcome.allow && out.outcome.error).toMatch(/Highly Confidential.*eve@other\.org/);
    expect(check({ rules: [], labelId: highly.id, kind: "people", recipients: ["bob@sub.example.com"] }).outcome.allow).toBe(true);
    expect(check({ rules: [], labelId: confidential.id, kind: "link" }).outcome.allow).toBe(true);
  });

  it("names the folder when a file inside it keeps it in", () => {
    const r = check({ rules: [], labelId: null, kind: "link", blockedBy: highly, own: false });
    expect(!r.outcome.allow && r.outcome.error).toMatch(/"plan\.docx" holds files labeled Highly Confidential/);
  });

  it("blocks, warns and audits by the DLP rules", () => {
    const blocked = check({ rules: [rule({ types: [{ type: "credit-card", min: 1 }], action: "block", tip: "No cards outside." })], text: card, kind: "link" });
    expect(blocked.outcome).toMatchObject({ allow: false, status: 422, error: "No cards outside." });
    expect(!blocked.outcome.allow && blocked.outcome.dlp?.matches[0]).toMatchObject({ type: "credit-card", count: 1 });
    expect(blocked.incident).toMatchObject({ action: "block", target: "i1", title: "plan.docx", matches: [{ type: "credit-card", name: "Credit card number", count: 1 }] });
    expect(blocked.incident?.matches[0]).not.toHaveProperty("samples");

    const audited = check({ rules: [rule({ types: [{ type: "credit-card", min: 1 }], action: "block", mode: "test" })], text: card, kind: "link" });
    expect(audited.outcome).toEqual({ allow: true, overridden: false });
    expect(audited.incident?.action).toBe("audit");

    const clean = check({ rules: [rule({ types: [{ type: "credit-card", min: 1 }] })], text: "nothing here", kind: "link" });
    expect(clean.outcome.allow).toBe(true);
    expect(clean.incident).toBeNull();
  });

  it("lets a warning through only with a reason, and records it", () => {
    const rules = [rule({ types: [{ type: "credit-card", min: 1 }], action: "warn" })];
    const warned = check({ rules, text: card, kind: "people", recipients: ["eve@other.org"] });
    expect(warned.outcome).toMatchObject({ allow: false, status: 409 });
    expect(warned.incident).toMatchObject({ action: "warn", overridden: false, recipients: ["eve@other.org"] });
    expect(check({ rules, text: card, kind: "people", recipients: ["eve@other.org"], override: { justification: "  " } }).outcome.allow).toBe(false);
    const went = check({ rules, text: card, kind: "people", recipients: ["eve@other.org"], override: { justification: " Customer asked for it " } });
    expect(went.outcome).toEqual({ allow: true, overridden: true, justification: "Customer asked for it" });
    expect(went.incident).toMatchObject({ overridden: true, justification: "Customer asked for it" });
    // Inside the organization an external-only rule doesn't apply.
    expect(check({ rules, text: card, kind: "people", recipients: ["bob@example.com"] }).outcome.allow).toBe(true);
  });

  it("matches DLP rules on the label too", () => {
    const r = check({ rules: [rule({ labels: [confidential.id], action: "block", scope: "anyone" })], labelId: confidential.id, kind: "people", recipients: ["bob@example.com"] });
    expect(r.outcome).toMatchObject({ allow: false, status: 422 });
    expect(r.incident?.labelId).toBe(confidential.id);
  });

  it("refuses by label before DLP has a say", () => {
    const r = check({ rules: [rule({ types: [{ type: "credit-card", min: 1 }], action: "warn" })], text: card, labelId: highly.id, kind: "link", override: { justification: "please" } });
    expect(r.outcome).toMatchObject({ allow: false, status: 422 });
    expect(!r.outcome.allow && r.outcome.dlp).toBeUndefined();
  });
});

describe("share helpers", () => {
  it("counts the sharer's own domain as inside until the Admin center lists some", () => {
    expect(internalDomainsFor([], "alice@contoso.com")).toEqual(["contoso.com"]);
    expect(internalDomainsFor([" "], "alice@contoso.com")).toEqual(["contoso.com"]);
    expect(internalDomainsFor(["fabrikam.com"], "alice@contoso.com")).toEqual(["fabrikam.com"]);
    expect(outsiders(["Bob@Contoso.com", "eve@evil.com"], ["contoso.com"])).toEqual(["eve@evil.com"]);
  });

  it("keeps a reason short and drops empty ones", () => {
    expect(justificationOf({ justification: "x".repeat(600) })).toHaveLength(500);
    expect(justificationOf({ justification: 5 })).toBeUndefined();
    expect(justificationOf(null)).toBeUndefined();
  });
});
