import { describe, expect, it } from "vitest";
import { cleanHtml } from "../lib/sanitize";

const clean = (html: string, allowRemoteImages = false, cids = new Map<string, string>()) =>
  cleanHtml(html, { allowRemoteImages, cids });

describe("cleanHtml", () => {
  it("removes scripts, event handlers and javascript: links", () => {
    const out = clean('<p onclick="x()">hi<script>alert(1)</script><a href="javascript:alert(1)">a</a><iframe src="https://e.x"></iframe></p>').html;
    expect(out).not.toMatch(/script|onclick|javascript:|iframe/i);
    expect(out).toContain("hi");
  });

  it("opens links in a new tab without an opener", () => {
    expect(clean('<a href="https://example.com">x</a>').html)
      .toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>');
  });

  it("holds back remote images and remote CSS until allowed", () => {
    const html = '<img src="https://t.example/o.gif"><div style="background:url(https://t.example/b.png)">x</div><style>@import "https://t.example/a.css";</style>';
    const blocked = clean(html);
    expect(blocked.blockedRemote).toBe(true);
    expect(blocked.html).not.toContain("t.example");
    const allowed = clean(html, true);
    expect(allowed.blockedRemote).toBe(false);
    expect(allowed.html).toContain("https://t.example/o.gif");
  });

  it("points cid: images at the attachment url and reports which were used", () => {
    const out = clean('<img src="cid:logo@x">', false, new Map([["logo@x", "/api/attachment?index=0"]]));
    expect(out.html).toContain('src="/api/attachment?index=0"');
    expect(out.usedCids.has("logo@x")).toBe(true);
  });
});
