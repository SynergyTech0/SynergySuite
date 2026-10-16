import { describe, expect, it } from "vitest";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser } from "mailparser";
import { DEFAULT_LABELS, type DlpDecision, evaluateDlp, parseMsipHeader } from "@synergy/compliance";
import { msipLabelOf } from "../lib/mailbox";
import { addressOf, applyLabel, blockedRecipients, dlpIncident, dlpOutcome, isTextAttachment, outgoingText } from "../lib/protection";

const [, general, confidential, highly] = DEFAULT_LABELS;
const decision = (action: DlpDecision["action"], extra: Partial<DlpDecision> = {}): DlpDecision => ({
  action, external: true, outside: ["x@other.example"],
  rules: action === "allow" ? [] : [{ id: "r1", name: "Cards", action: action === "audit" ? "audit" : action, mode: "enforce" }],
  matches: action === "allow" ? [] : [{ type: "credit-card", name: "Credit card number", count: 2, samples: ["•••• 1111", "•••• 4242"] }],
  ...(action === "warn" || action === "block" ? { tip: "Careful" } : {}),
  ...extra,
});

describe("DLP on send", () => {
  it("blocks, warns until a reason is given, and lets audit through", () => {
    expect(dlpOutcome(decision("allow"))).toEqual({ send: true, overridden: false });
    expect(dlpOutcome(decision("audit"))).toEqual({ send: true, overridden: false });
    const block = dlpOutcome(decision("block"), { justification: "please" });
    expect(block).toMatchObject({ send: false, status: 422, body: { error: "Careful", dlp: { action: "block", tip: "Careful", outside: ["x@other.example"] } } });
    for (const o of [undefined, null, {}, { justification: "  " }, { justification: 7 }]) {
      expect(dlpOutcome(decision("warn"), o as never), JSON.stringify(o)).toMatchObject({ send: false, status: 409, body: { dlp: { action: "warn" } } });
    }
    expect(dlpOutcome(decision("warn"), { justification: " Customer asked for it " })).toEqual({ send: true, overridden: true, justification: "Customer asked for it" });
  });

  it("reports matches without the values found", () => {
    const meta = { actor: "Ann@Example.com", title: "Cards", recipients: ["x@other.example"], labelId: null };
    expect(dlpIncident(decision("allow"), dlpOutcome(decision("allow")), meta)).toBeNull();
    const warn = decision("warn");
    const sent = dlpIncident(warn, dlpOutcome(warn, { justification: "ok" }), meta)!;
    expect(sent).toEqual({
      actor: "ann@example.com", title: "Cards", action: "warn", overridden: true, justification: "ok", rules: warn.rules,
      matches: [{ type: "credit-card", name: "Credit card number", count: 2 }], recipients: ["x@other.example"], labelId: null,
    });
    expect(dlpIncident(warn, dlpOutcome(warn), meta)).toMatchObject({ action: "warn", overridden: false });
    expect(dlpIncident(warn, dlpOutcome(warn), meta)).not.toHaveProperty("justification");
    expect(dlpIncident(decision("audit"), dlpOutcome(decision("audit")), meta)).toMatchObject({ action: "audit", overridden: false });
  });

  it("scans the subject, the body and text attachments, not binaries", () => {
    const text = outgoingText({
      subject: "Card", html: "<p>Number <b>4111 1111 1111 1111</b></p>",
      attachments: [
        { filename: "list.csv", contentType: "text/csv", content: Buffer.from("5555555555554444") },
        { filename: "data.json", contentType: "application/json", content: Buffer.from('{"card":"378282246310005"}') },
        { filename: "scan.png", contentType: "image/png", content: Buffer.from("4012888888881881") },
      ],
    });
    expect(text).toContain("Card");
    expect(text).toContain("4111 1111 1111 1111");
    expect(text).not.toContain("<b>");
    expect(text).toContain("5555555555554444");
    expect(text).toContain("378282246310005");
    expect(text).not.toContain("4012888888881881");
    expect(outgoingText({ subject: "s", text: "plain wins", html: "<p>html</p>" })).toBe("s\nplain wins");
    expect(isTextAttachment(undefined, "notes.txt")).toBe(true);
    expect(isTextAttachment("application/pdf", "notes.txt")).toBe(false);

    // End to end with the suite's rules: three cards found, a warn for outside recipients.
    const d = evaluateDlp({ internalDomains: ["example.com"], types: [], rules: [{ id: "r", name: "Cards", enabled: true, mode: "enforce", apps: [], types: [{ type: "credit-card", min: 1 }], labels: [], scope: "external", action: "warn" }] },
      { app: "mail", text, recipients: ["ann@example.com", "x@other.example"] });
    expect(d).toMatchObject({ action: "warn", outside: ["x@other.example"], matches: [{ type: "credit-card", count: 3 }] });
  });
});

describe("labels on send", () => {
  it("keeps labels that block outside sharing to the organization", () => {
    const rcpt = ["Bob <bob@example.com>", "eve@sub.example.com", "Mallory <m@other.example>", "m@other.example"];
    expect(blockedRecipients(highly, rcpt, ["example.com"])).toEqual(["m@other.example"]);
    expect(blockedRecipients(confidential, rcpt, ["example.com"])).toEqual([]);
    expect(blockedRecipients(null, rcpt, [])).toEqual([]);
    expect(addressOf(" Bob Smith <Bob@Example.com> ")).toBe("bob@example.com");
  });

  it("writes the msip_labels header and the marking, and nothing without a label", () => {
    const m = { subject: "s", text: "Hello\n", html: "<p>Hello</p>" };
    expect(applyLabel(m, null)).toEqual({ ...m, headers: {} });
    const g = applyLabel(m, general);
    expect(g.text).toBe(m.text);
    expect(g.html).toBe(m.html);
    expect(parseMsipHeader(g.headers.msip_labels)).toEqual({ id: general.id, name: "General" });
    const c = applyLabel(m, confidential);
    expect(c.text).toBe("Hello\n\nCONFIDENTIAL");
    expect(c.html).toMatch(/^<p>Hello<\/p><p [^>]*>CONFIDENTIAL<\/p>$/);
    expect(applyLabel<{ text?: string; html?: string }>({ html: "<p>x</p>" }, confidential).text).toBeUndefined();
    const odd = applyLabel({ html: "" }, { ...confidential, protection: { blockExternal: false, marking: "<A & B>" } });
    expect(odd.html).toContain("&lt;A &amp; B&gt;");
  });

  it("survives a trip through a real message, folded header and all", async () => {
    const out = applyLabel({ text: "Hi" }, highly);
    const raw = await new MailComposer({ from: "a@example.com", to: "b@example.com", subject: "s", text: out.text, headers: out.headers }).compile().build();
    expect(raw.toString()).toMatch(/^msip_labels: MSIP_Label_/im);
    expect(msipLabelOf(await simpleParser(raw))).toEqual({ id: highly.id, name: "Highly Confidential" });
    expect(msipLabelOf(await simpleParser(Buffer.from("Subject: x\r\n\r\nbody")))).toBeNull();
  });
});
