import { describe, expect, it } from "vitest";
import { BRIDGE_COOKIE, MB_SESSION_COOKIE, bridgeCookies, bridgeMatches, embedUrl, readCookie, safeReturn, signJwt } from "@/lib/bridge";
import { config, embeddingKey, isAdmin, isAnalyst, personPassword } from "@/lib/config";
import { createHmac } from "node:crypto";

const c = config({ INSIGHTS_SECRET: "s3cret", SUITE_DOMAIN: "example.com", ADMIN_EMAILS: "Boss@Example.com", INSIGHTS_ANALYST_EMAILS: "ana@example.com" });

function cookieHeader(set: string[]): string {
  return set.map((s) => s.split(";")[0]).join("; ");
}

describe("sign-in bridge", () => {
  it("accepts the session it opened for the same person only", () => {
    const header = cookieHeader(bridgeCookies(c, "jane@example.com", "sess-1", true));
    expect(bridgeMatches(c, "jane@example.com", header)).toBe(true);
    expect(bridgeMatches(c, "JANE@example.com", header)).toBe(true);
    expect(bridgeMatches(c, "bob@example.com", header)).toBe(false);
  });

  it("refuses a swapped session, a missing proof and another deployment's proof", () => {
    const header = cookieHeader(bridgeCookies(c, "jane@example.com", "sess-1", true));
    expect(bridgeMatches(c, "jane@example.com", header.replace("sess-1", "sess-2"))).toBe(false);
    expect(bridgeMatches(c, "jane@example.com", `${MB_SESSION_COOKIE}=sess-1`)).toBe(false);
    const other = config({ INSIGHTS_SECRET: "other" });
    expect(bridgeMatches(other, "jane@example.com", header)).toBe(false);
    expect(bridgeMatches(c, "jane@example.com", null)).toBe(false);
  });

  it("sets HttpOnly cookies, Secure on https", () => {
    const set = bridgeCookies(c, "jane@example.com", "abc", true);
    expect(set[0]).toMatch(/^metabase\.SESSION=abc; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
    expect(set[1].startsWith(`${BRIDGE_COOKIE}=`)).toBe(true);
    expect(bridgeCookies(c, "jane@example.com", "abc", false)[0]).not.toContain("Secure");
  });

  it("reads cookies", () => {
    expect(readCookie("a=1; metabase.SESSION=x%20y; b=2", "metabase.SESSION")).toBe("x y");
    expect(readCookie("a=1", "metabase.SESSION")).toBeNull();
  });

  it("only returns to paths inside the designer", () => {
    expect(safeReturn(c, "/studio/question/1?x=1#h")).toBe("/studio/question/1?x=1#h");
    expect(safeReturn(c, "/studio")).toBe("/studio");
    expect(safeReturn(c, "https://evil.example/studio/x")).toBe("/studio/x");
    expect(safeReturn(c, "//evil.example/x")).toBe("/studio/");
    expect(safeReturn(c, "/studiox")).toBe("/studio/");
    expect(safeReturn(c, "/api/sources")).toBe("/studio/");
    expect(safeReturn(c, "/studio/..%2f..%2fapi")).toBe("/studio/..%2f..%2fapi");
    expect(safeReturn(c, "/studio/../api/sources")).toBe("/studio/");
    expect(safeReturn(c, null)).toBe("/studio/");
  });
});

describe("derived secrets and roles", () => {
  it("gives each person a stable, distinct, strong password", () => {
    const a = personPassword(c, "jane@example.com");
    expect(a).toBe(personPassword(c, "JANE@example.com"));
    expect(a).not.toBe(personPassword(c, "bob@example.com"));
    expect(a).toMatch(/^Sy1!.{40,}$/);
  });

  it("makes a 64-hex-character embedding key", () => {
    expect(embeddingKey(c)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("knows admins and analysts", () => {
    expect(isAdmin(c, "boss@example.com")).toBe(true);
    expect(isAnalyst(c, "boss@example.com")).toBe(true);
    expect(isAnalyst(c, "ana@example.com")).toBe(true);
    expect(isAnalyst(c, "joe@example.com")).toBe(false);
    expect(isAnalyst(config({ INSIGHTS_ANALYST_EMAILS: "*" }), "joe@example.com")).toBe(true);
  });

  it("reads the Postgres connection and defaults", () => {
    const x = config({ INSIGHTS_PG_URL: "postgres://postgres:pw@db.internal:6543/whatever" });
    expect(x.pgUrl).toBe("postgres://postgres:pw@db.internal:6543");
    expect(x.pgHost).toBe("db.internal");
    expect(x.pgPort).toBe(6543);
    expect(x.sources).toContain("books");
    expect(x.sources).not.toContain("mail");
    expect(config({ INSIGHTS_SOURCES: "crm, bad-name;desk" }).sources).toEqual(["crm", "desk"]);
  });
});

describe("embedding", () => {
  it("signs an HS256 token Metabase can check", () => {
    const t = signJwt({ a: 1 }, "k");
    const [h, b, s] = t.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
    expect(s).toBe(createHmac("sha256", "k").update(`${h}.${b}`).digest("base64url"));
  });

  it("builds a dashboard address under the designer path", () => {
    const now = Date.UTC(2026, 0, 1);
    const { url, expires } = embedUrl(c, 7, now);
    expect(url).toMatch(/^\/studio\/embed\/dashboard\/[\w-]+\.[\w-]+\.[\w-]+#bordered=false&titled=false$/);
    const payload = JSON.parse(Buffer.from(url.split("/")[4].split(".")[1], "base64url").toString());
    expect(payload).toEqual({ resource: { dashboard: 7 }, params: {}, exp: now / 1000 + 8 * 3600 });
    expect(expires).toBe(now + 8 * 3600 * 1000);
  });
});
