import { describe, expect, it } from "vitest";
import { cleanDomain, cleanPath, deviceFor, isBot, originMatches, refHost, visitorHash } from "../lib/collect";
import { SCRIPT, snippet } from "../lib/script";

describe("cleaning what a beacon sends", () => {
  it("keeps only the path of a page, never its query or fragment", () => {
    expect(cleanPath("https://example.com/pricing?email=a@b.com#x")).toBe("/pricing");
    expect(cleanPath("/docs?token=1")).toBe("/docs");
    expect(cleanPath("")).toBe("/");
    expect(cleanPath("x".repeat(400)).length).toBe(300);
  });
  it("keeps only the referring host", () => {
    expect(refHost("https://www.google.com/search?q=secret")).toBe("google.com");
    expect(refHost("")).toBe("");
    expect(refHost("not a url")).toBe("");
  });
  it("buckets screen width into a device type", () => {
    expect(deviceFor(390)).toBe("mobile");
    expect(deviceFor(1024)).toBe("tablet");
    expect(deviceFor(1920)).toBe("desktop");
    expect(deviceFor("x")).toBe("");
  });
  it("spots bots and empty user agents", () => {
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBot("curl/8.0")).toBe(true);
    expect(isBot("")).toBe(true);
    expect(isBot("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15")).toBe(false);
  });
  it("matches a site's domain, www and subdomains only", () => {
    expect(cleanDomain("https://www.Example.com:443/path")).toBe("www.example.com");
    expect(originMatches("https://example.com", "example.com")).toBe(true);
    expect(originMatches("https://www.example.com", "example.com")).toBe(true);
    expect(originMatches("https://shop.example.com", "www.example.com")).toBe(true);
    expect(originMatches("https://example.com.evil.net", "example.com")).toBe(false);
    expect(originMatches("https://notexample.com", "example.com")).toBe(false);
    expect(originMatches(null, "example.com")).toBe(false);
    expect(originMatches(null, "")).toBe(true);
  });
  it("hashes visitors differently each day", () => {
    const a = visitorHash("salt-1", "1", "203.0.113.5", "UA");
    expect(a).toHaveLength(24);
    expect(visitorHash("salt-1", "1", "203.0.113.5", "UA")).toBe(a);
    expect(visitorHash("salt-2", "1", "203.0.113.5", "UA")).not.toBe(a);
    expect(visitorHash("salt-1", "2", "203.0.113.5", "UA")).not.toBe(a);
  });
});

describe("tracking script", () => {
  it("is valid JavaScript and names no particular deployment", () => {
    expect(() => new Function(SCRIPT)).not.toThrow();
    expect(SCRIPT).not.toMatch(/synergytech|https?:\/\/[a-z]/i);
  });
  it("builds the snippet from the suite domain", () => {
    expect(snippet("sy_abc", "example.org")).toBe('<script defer src="https://analytics.example.org/script.js" data-site="sy_abc"></script>');
  });
});
