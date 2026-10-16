import { describe, expect, it } from "vitest";
import { slugify } from "../lib/kb";
import { escapeHtml, excerpt, renderMarkdown } from "../lib/markdown";
import { formatNumber, normalizeMessageId, replySubject, stripQuoted, threadIds, ticketTag } from "../lib/threading";

describe("ticket numbers and tags", () => {
  it("formats numbers", () => {
    expect(formatNumber(2026, 1)).toBe("T-2026-0001");
    expect(formatNumber(2026, 42)).toBe("T-2026-0042");
    expect(formatNumber(2026, 12345)).toBe("T-2026-12345");
  });

  it("finds the tag in a subject", () => {
    expect(ticketTag("Re: Printer jam [T-2026-0042]")).toBe("T-2026-0042");
    expect(ticketTag("RE: AW: T-2025-0007 still broken")).toBe("T-2025-0007");
    expect(ticketTag("[T-2026-10001] big year")).toBe("T-2026-10001");
    expect(ticketTag("Order T-26-1 please")).toBeNull();
    expect(ticketTag("XT-2026-0001")).toBeNull();
    expect(ticketTag(undefined)).toBeNull();
  });

  it("builds reply subjects without piling up Re: or tags", () => {
    expect(replySubject("Printer jam", "T-2026-0042")).toBe("Re: Printer jam [T-2026-0042]");
    expect(replySubject("RE: Fwd: Printer jam [T-2026-0042]", "T-2026-0042")).toBe("Re: Printer jam [T-2026-0042]");
    expect(replySubject("", "T-2026-0001")).toBe("Re: (no subject) [T-2026-0001]");
  });

  it("collects the ids an email answers", () => {
    expect(normalizeMessageId("abc@x")).toBe("<abc@x>");
    expect(normalizeMessageId(" <abc@x> ")).toBe("<abc@x>");
    expect(normalizeMessageId("")).toBeNull();
    expect(threadIds("<c@x>", "<a@x> <b@x> <c@x>")).toEqual(["<c@x>", "<b@x>", "<a@x>"]);
    expect(threadIds(null, ["<a@x>", "b@x"])).toEqual(["b@x", "a@x"].map((x) => normalizeMessageId(x)));
    expect(threadIds(undefined, undefined)).toEqual([]);
  });
});

describe("quote stripping", () => {
  it("cuts Gmail-style quotes, also when the header wraps", () => {
    expect(stripQuoted("Thanks, that worked!\n\nOn Tue, Oct 6, 2026 at 9:14 AM Support <help@example.com> wrote:\n> Try restarting it.\n")).toBe("Thanks, that worked!");
    expect(stripQuoted("Still broken.\n\nOn Tue, Oct 6, 2026 at 9:14 AM Support Desk\n<help@example.com> wrote:\n> old")).toBe("Still broken.");
  });

  it("cuts Outlook-style quotes", () => {
    expect(stripQuoted("New info below.\r\n\r\n________________________________\r\nFrom: Support\r\nSent: Monday\r\nOld text")).toBe("New info below.");
    expect(stripQuoted("Ok\n-----Original Message-----\nFrom: x")).toBe("Ok");
    expect(stripQuoted("Answer\n\nFrom: Support <help@example.com>\nSent: Monday, October 5\nSubject: Re: x")).toBe("Answer");
  });

  it("keeps a From: line that isn't a quote header, and trailing > lines go", () => {
    expect(stripQuoted("From: the office printer\nit prints blank pages")).toBe("From: the office printer\nit prints blank pages");
    expect(stripQuoted("Yes please\n\n> Shall we replace it?\n>\n> Thanks")).toBe("Yes please");
    expect(stripQuoted("> only a quote")).toBe("> only a quote");
  });
});

describe("knowledge-base rendering", () => {
  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    const html = renderMarkdown(`<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>`);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("only makes safe links", () => {
    expect(renderMarkdown("[ok](https://example.com/a?b=1&c=2)")).toBe(`<p><a href="https://example.com/a?b=1&amp;c=2" rel="nofollow noopener">ok</a></p>`);
    expect(renderMarkdown("[bad](javascript:alert(1))")).not.toContain("<a");
    expect(renderMarkdown(`[x](https://e.com/" onmouseover="alert(1))`)).not.toMatch(/"\s+onmouseover/);
  });

  it("renders the Markdown subset", () => {
    expect(renderMarkdown("# Title\n\nSome **bold** and *it* and `<b>`.\nNext line\n\n- one\n- two\n\n1. a\n2. b"))
      .toBe([
        "<h2>Title</h2>",
        "<p>Some <strong>bold</strong> and <em>it</em> and <code>&lt;b&gt;</code>.<br>Next line</p>",
        "<ul><li>one</li><li>two</li></ul>",
        "<ol><li>a</li><li>b</li></ol>",
      ].join("\n"));
    expect(renderMarkdown("```\n<div>\n```")).toBe("<pre><code>&lt;div&gt;</code></pre>");
  });

  it("makes excerpts and slugs", () => {
    expect(excerpt("# Head\n\nReset it from **Settings** > [Account](https://x).\n\nMore")).toBe("Reset it from Settings Account.");
    expect(slugify("How do I reset my password?")).toBe("how-do-i-reset-my-password");
    expect(slugify("Café & Crème")).toBe("cafe-creme");
    expect(slugify("!!!")).toBe("article");
  });
});

describe("reading a raw email", () => {
  it("pulls out the sender, threading headers and text", async () => {
    const { simpleParser } = await import("mailparser");
    const { toInbound } = await import("../lib/poller");
    const raw = [
      "From: Pat Doe <Pat@Example.org>",
      "To: help@example.com",
      "Subject: Re: Printer jam [T-2026-0042]",
      "Message-ID: <in-9@mail.example.org>",
      "In-Reply-To: <out-1@desk.test>",
      "References: <a@x> <out-1@desk.test>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Works now, thanks!",
      "",
      "On Mon, Oct 5, 2026, Support <help@example.com> wrote:",
      "> Try tray 2.",
      "",
    ].join("\r\n");
    const m = toInbound(await simpleParser(raw));
    expect(m.from).toBe("Pat@Example.org");
    expect(m.fromName).toBe("Pat Doe");
    expect(ticketTag(m.subject)).toBe("T-2026-0042");
    expect(m.messageId).toBe("<in-9@mail.example.org>");
    expect(threadIds(m.inReplyTo, m.references)).toEqual(["<out-1@desk.test>", "<a@x>"]);
    expect(stripQuoted(m.text!)).toBe("Works now, thanks!");
  });
});
