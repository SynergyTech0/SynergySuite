import { describe, expect, it } from "vitest";
import { cleanPage } from "../lib/chat";
import { WIDGET } from "../lib/widget-script";
import { cleanColor, cleanDomain, originAllowed, snippet } from "../lib/widgets";

describe("widget settings", () => {
  it("accepts only #rrggbb colours", () => {
    expect(cleanColor("#AABBCC")).toBe("#aabbcc");
    expect(cleanColor("")).toBe("#0f6cbd");
    for (const c of ["red", "#fff", "#000000;}body{display:none", "url(x)"]) expect(() => cleanColor(c), c).toThrow();
  });
  it("cleans domains and limits origins to them", () => {
    expect(cleanDomain("https://www.Example.com/contact")).toBe("www.example.com");
    expect(() => cleanDomain("exa mple.com")).toThrow();
    expect(originAllowed("https://example.com", "www.example.com")).toBe(true);
    expect(originAllowed("https://help.example.com", "example.com")).toBe(true);
    expect(originAllowed("https://example.com.evil.net", "example.com")).toBe(false);
    expect(originAllowed(null, "example.com")).toBe(false);
    expect(originAllowed(null, "")).toBe(true);
  });
  it("keeps only the page address without its query", () => {
    expect(cleanPage("https://example.com/pricing?email=a@b.com#x")).toBe("https://example.com/pricing");
    expect(cleanPage("javascript:alert(1)")).toBe("");
  });
  it("builds the snippet the way Sites embeds it", () => {
    expect(snippet("wc_abc", "example.org")).toBe('<script defer src="https://livechat.example.org/widget.js" data-widget="wc_abc"></script>');
  });
});

describe("widget script", () => {
  it("is valid JavaScript that never writes message text as HTML", () => {
    expect(() => new Function(WIDGET)).not.toThrow();
    // The only innerHTML is the fixed icon.
    expect(WIDGET.match(/innerHTML/g)).toHaveLength(1);
    expect(WIDGET).toMatch(/textContent/);
    expect(WIDGET).not.toMatch(/synergytech/i);
  });
});
