import { describe, expect, it } from "vitest";
import { DEFAULT_LABELS, createPolicyClient } from "@synergy/compliance";
import { buildPolicy } from "../lib/policy";
import { cleanDomains, cleanIncident, cleanLabel, cleanRule, cleanType, envDomains, feedDlp } from "../lib/protection";

const known = { types: new Set(["credit-card", "us-ssn"]), labels: new Set([DEFAULT_LABELS[3].id]) };

describe("information protection", () => {
  it("checks DLP rules", () => {
    const r = cleanRule({ name: " Cards ", types: [{ type: "credit-card", min: 2 }], action: "block", apps: ["mail"] }, known);
    expect(r).toEqual({ name: "Cards", enabled: true, mode: "test", apps: ["mail"], types: [{ type: "credit-card", min: 2 }], labels: [], scope: "external", action: "block", tip: "" });
    expect(() => cleanRule({ name: "x", types: [], action: "block" }, known)).toThrow(/at least one/);
    expect(() => cleanRule({ name: "x", types: [{ type: "nope" }], action: "block" }, known)).toThrow(/Unknown sensitive/);
    expect(() => cleanRule({ name: "x", types: [{ type: "us-ssn" }], action: "explode" }, known)).toThrow(/Action/);
    expect(() => cleanRule({ name: "x", labels: ["d1e9c4f5-0000-0000-0000-000000000000"], action: "warn" }, known)).toThrow(/Unknown label/);
    expect(() => cleanRule({ name: "x", types: [{ type: "us-ssn" }], action: "warn", apps: ["nowhere"] }, known)).toThrow(/Unknown app/);
    expect(cleanRule({ name: "HC", labels: [DEFAULT_LABELS[3].id.toUpperCase()], action: "block", mode: "enforce" }, known).labels).toEqual([DEFAULT_LABELS[3].id]);
  });

  it("checks labels, types and domains", () => {
    expect(cleanLabel({ name: "Secret", color: "#ABCDEF", protection: { blockExternal: true, marking: " SECRET " } })).toEqual({ name: "Secret", color: "#abcdef", protection: { blockExternal: true, marking: "SECRET" } });
    expect(() => cleanLabel({ name: "x", color: "red" })).toThrow(/color/);
    expect(cleanType({ name: "Project Falcon", keywords: "falcon\nhawk, falcon" })).toEqual({ id: "custom-project-falcon", name: "Project Falcon", keywords: ["falcon", "hawk"] });
    expect(() => cleanType({ name: "Bad", pattern: "(" })).toThrow(/valid pattern/);
    expect(() => cleanType({ name: "Empty" })).toThrow(/keywords or a pattern/);
    expect(cleanDomains("Example.com\n@sub.example.org example.com")).toEqual(["example.com", "sub.example.org"]);
    expect(() => cleanDomains("not a domain")).toThrow(/not a domain/);
    expect(envDomains({ MAIL_DOMAIN: "Mail.example", SUITE_DOMAIN: "mail.example" } as unknown as NodeJS.ProcessEnv)).toEqual(["mail.example"]);
  });

  it("checks incidents apps report", () => {
    const i = cleanIncident({ app: "mail", actor: "Pat@Example.com", action: "warn", overridden: true, justification: "customer asked", title: "Invoice", rules: [{ id: "r", name: "Cards", action: "warn" }], matches: [{ type: "credit-card", name: "Credit card number", count: 2, samples: ["•••• 1111"] }], recipients: ["a@b.co", "junk"] });
    expect(i).toMatchObject({ app: "mail", actor: "pat@example.com", action: "warn", overridden: true, recipients: ["a@b.co"] });
    expect(i.matches[0]).toEqual({ type: "credit-card", name: "Credit card number", count: 2 });
    expect(cleanIncident({ app: "mail", actor: "p@x.io", action: "block", overridden: true }).overridden).toBe(false);
    expect(() => cleanIncident({ app: "nowhere", actor: "p@x.io", action: "block" })).toThrow(/Unknown app/);
  });

  it("puts labels and live DLP rules in the feed apps read", async () => {
    const dlp = {
      rules: [
        { id: "a", name: "On", enabled: true, mode: "enforce" as const, apps: [], types: [{ type: "credit-card", min: 1 }], labels: [], scope: "anyone" as const, action: "block" as const, tip: "" },
        { id: "b", name: "Off", enabled: false, mode: "enforce" as const, apps: [], types: [{ type: "credit-card", min: 1 }], labels: [], scope: "anyone" as const, action: "block" as const, tip: "" },
      ],
      types: [],
      internalDomains: ["example.com"],
    };
    expect(feedDlp(dlp).rules.map((r) => r.id)).toEqual(["a"]);
    const policy = buildPolicy([], [], new Date(), { labels: { labels: DEFAULT_LABELS, defaultLabelId: DEFAULT_LABELS[1].id }, dlp });
    const fake = (async () => new Response(JSON.stringify(policy))) as unknown as typeof fetch;
    const mail = createPolicyClient({ app: "mail", url: "http://admin", token: "t", fetch: fake });
    expect((await mail.labels()).defaultLabelId).toBe(DEFAULT_LABELS[1].id);
    expect((await mail.checkDlp({ text: "4111 1111 1111 1111" })).action).toBe("block");
  });
});
