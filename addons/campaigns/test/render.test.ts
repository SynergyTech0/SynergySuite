import { describe, expect, it } from "vitest";
import { readReport } from "../lib/bounces";
import { cleanBlocks } from "../lib/blocks";
import { csvPeople } from "../lib/csv";
import { compose, mergeUrl, personalize, safeUrl } from "../lib/render";
import { cleanRules, compileRules } from "../lib/segments";

const r = { email: "ann@example.com", firstName: "Ann", lastName: "Lee", company: "<Acme>", fields: { plan: "pro" } };
const footer = { orgName: "Synergy", postalAddress: "1 Main St", unsubscribeUrl: "https://c.example.com/u/tok" };

describe("render", () => {
  it("escapes block text and merge values, and keeps its own markup", () => {
    const c = compose(cleanBlocks([{ type: "text", text: "Hi {{first_name}} from {{company}} <script>x</script> **bold** [site](https://a.example/?x=1&y=2)" }]));
    const out = personalize(c, r, { footer, linkUrl: (i) => `https://t/${i}` });
    expect(out.html).toContain("Hi Ann from &lt;Acme&gt;");
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("<strong>bold</strong>");
    expect(out.html).toContain('href="https://t/0"');
    expect(c.links).toEqual(["https://a.example/?x=1&y=2"]);
    expect(out.html).toContain("Unsubscribe");
    expect(out.text).toContain("Unsubscribe: https://c.example.com/u/tok");
  });

  it("numbers each distinct link once and drops unsafe ones", () => {
    const c = compose(cleanBlocks([
      { type: "button", text: "Go", url: "https://x.example/a" },
      { type: "button", text: "Again", url: "https://x.example/a" },
      { type: "button", text: "Bad", url: "javascript:alert(1)" },
      { type: "image", url: "https://img.example/p.png", link: "https://x.example/b" },
    ]));
    expect(c.links).toEqual(["https://x.example/a", "https://x.example/b"]);
    expect(c.html).not.toContain("javascript");
    expect(safeUrl("data:text/html,hi")).toBe("");
  });

  it("uses defaults and URL-encodes merges in links", () => {
    const c = compose(cleanBlocks([{ type: "heading", text: "Hello {{nickname|default: friend}}" }]));
    expect(personalize(c, r, { footer, linkUrl: () => "" }).html).toContain("Hello friend");
    expect(mergeUrl("https://x.example/?e={{email}}&p={{fields.plan}}", r)).toBe("https://x.example/?e=ann%40example.com&p=pro");
  });

  it("adds the open pixel only when asked", () => {
    const c = compose([{ type: "text", text: "x" }]);
    expect(personalize(c, r, { footer, linkUrl: () => "" }).html).not.toContain("width=\"1\"");
    expect(personalize(c, r, { footer, linkUrl: () => "", pixelUrl: "https://t/o/x" }).html).toContain('src="https://t/o/x"');
  });
});

describe("segments", () => {
  it("compiles rules to parameterized SQL", () => {
    const rules = cleanRules({
      match: "all",
      conditions: [
        { field: "tag", op: "is", value: "VIP" },
        { field: "company", op: "contains", value: "50%" },
        { field: "opened", op: "within_days", value: "30" },
        { field: "field", key: "plan", op: "is", value: "pro" },
      ],
    });
    const c = compileRules(rules, 3);
    expect(c.params).toEqual(["vip", "%50\\%%", 30, "plan", "pro"]);
    expect(c.sql).toContain("$3 = ANY(s.tags)");
    expect(c.sql).not.toContain("VIP");
  });

  it("refuses conditions it doesn't know", () => {
    expect(() => cleanRules({ conditions: [{ field: "email; DROP", op: "is", value: "" }] })).toThrow();
    expect(() => cleanRules({ conditions: [{ field: "tag", op: "before", value: "x" }] })).toThrow();
    expect(() => cleanRules({ conditions: [{ field: "field", key: "a b", op: "is", value: "x" }] })).toThrow();
  });
});

describe("csv", () => {
  it("maps common headers and keeps the rest as fields", () => {
    const people = csvPeople('﻿E-mail,Name,Company,Plan,Tags\r\nann@example.com,Ann Lee,"Acme, Inc",pro,"a;b"\n');
    expect(people).toEqual([{ email: "ann@example.com", firstName: "Ann", lastName: "Lee", company: "Acme, Inc", tags: ["a", "b"], fields: { Plan: "pro" } }]);
  });
  it("takes a bare list of addresses", () => {
    expect(csvPeople("a@x.com\nb@x.com").map((p) => p.email)).toEqual(["a@x.com", "b@x.com"]);
  });
});

describe("bounce reports", () => {
  const tok = "abcdefghijklmnopqrstuvwx";
  it("reads a permanent DSN", () => {
    const raw = `Content-Type: multipart/report; report-type=delivery-status; boundary=b\r\n\r\n--b\r\nContent-Type: message/delivery-status\r\n\r\nFinal-Recipient: rfc822; ann@example.com\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 5.1.1 No such user\r\n\r\n--b\r\nContent-Type: text/rfc822-headers\r\n\r\nMessage-ID: <${tok}@example.com>\r\nX-Campaign-Delivery: ${tok}\r\n--b--`;
    expect(readReport(raw)).toEqual({ kind: "bounce", token: tok, detail: "5.1.1 smtp; 550 5.1.1 No such user" });
  });
  it("ignores delays and unrelated mail", () => {
    expect(readReport(`Content-Type: multipart/report; report-type=delivery-status\r\nAction: delayed\r\nStatus: 4.4.1\r\nX-Campaign-Delivery: ${tok}`)).toBeNull();
    expect(readReport("Subject: hello\r\n\r\nhi")).toBeNull();
  });
  it("reads a spam complaint", () => {
    expect(readReport(`Content-Type: multipart/report; report-type=feedback-report\r\n\r\nFeedback-Type: abuse\r\nX-Campaign-Delivery: ${tok}`)).toEqual({ kind: "complaint", token: tok });
  });
});
