import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, resetDb } from "../helpers/db";

/**
 * The identity seam decides who every route thinks you are, so its failure modes matter more than
 * its happy path. Two were found in review:
 *   - with no identity header at all it silently authenticated everyone as a fixed "dev-local" user,
 *     in production as well as in dev — failing open exactly where it must not;
 *   - the forwarded headers are trusted with nothing proving the request came through oauth2-proxy.
 */

const headerBag: Record<string, string> = {};

vi.mock("next/headers", () => ({
  headers: async () => new Headers(headerBag),
}));

function setHeaders(h: Record<string, string>) {
  for (const k of Object.keys(headerBag)) delete headerBag[k];
  Object.assign(headerBag, h);
}

beforeEach(async () => {
  await resetDb();
  setHeaders({});
});

afterEach(() => {
  // NODE_ENV is typed read-only, so it is stubbed rather than assigned; unstubbing restores it.
  vi.unstubAllEnvs();
  delete process.env.PROXY_SHARED_SECRET;
});

afterAll(async () => {
  await closeDb();
});

describe("identity from proxy headers", () => {
  it("resolves and provisions the forwarded user", async () => {
    setHeaders({ "x-forwarded-user": "oidc-sub-1", "x-forwarded-email": "person@example.com" });
    const { getCurrentUserOrNull } = await import("@/lib/session");

    const user = await getCurrentUserOrNull();
    expect(user?.authSub).toBe("oidc-sub-1");
    expect(user?.email).toBe("person@example.com");
  });

  it("returns the same row on a second request rather than duplicating the user", async () => {
    setHeaders({ "x-forwarded-user": "oidc-sub-2", "x-forwarded-email": "again@example.com" });
    const { getCurrentUserOrNull } = await import("@/lib/session");

    const first = await getCurrentUserOrNull();
    const second = await getCurrentUserOrNull();
    expect(second?.id).toBe(first?.id);
  });
});

describe("no identity on the request", () => {
  it("falls back to the dev user outside production, so local dev still works", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { getCurrentUserOrNull } = await import("@/lib/session");

    const user = await getCurrentUserOrNull();
    expect(user?.authSub).toBe("dev-local");
  });

  it("refuses in production instead of authenticating as dev-local", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { getCurrentUserOrNull } = await import("@/lib/session");

    expect(await getCurrentUserOrNull()).toBeNull();
  });
});

describe("shared-secret trust boundary", () => {
  it("refuses forwarded identity when the secret is configured but absent from the request", async () => {
    process.env.PROXY_SHARED_SECRET = "s3cret-from-the-proxy";
    setHeaders({ "x-forwarded-user": "attacker-chosen-sub", "x-forwarded-email": "attacker@example.com" });
    const { getCurrentUserOrNull } = await import("@/lib/session");

    expect(await getCurrentUserOrNull()).toBeNull();
  });

  it("refuses a wrong secret", async () => {
    process.env.PROXY_SHARED_SECRET = "s3cret-from-the-proxy";
    setHeaders({
      "x-forwarded-user": "attacker-chosen-sub",
      "x-forwarded-email": "attacker@example.com",
      "x-proxy-auth-secret": "guess",
    });
    const { getCurrentUserOrNull } = await import("@/lib/session");

    expect(await getCurrentUserOrNull()).toBeNull();
  });

  it("accepts the forwarded identity when the secret matches", async () => {
    process.env.PROXY_SHARED_SECRET = "s3cret-from-the-proxy";
    setHeaders({
      "x-forwarded-user": "oidc-sub-3",
      "x-forwarded-email": "trusted@example.com",
      "x-proxy-auth-secret": "s3cret-from-the-proxy",
    });
    const { getCurrentUserOrNull } = await import("@/lib/session");

    const user = await getCurrentUserOrNull();
    expect(user?.authSub).toBe("oidc-sub-3");
  });

  it("leaves behaviour unchanged when no secret is configured, so this ships before the proxy config", async () => {
    // The gateway always sends the email alongside the subject; identity needs both.
    setHeaders({ "x-forwarded-user": "oidc-sub-4", "x-forwarded-email": "four@example.com" });
    const { getCurrentUserOrNull } = await import("@/lib/session");

    expect((await getCurrentUserOrNull())?.authSub).toBe("oidc-sub-4");
  });
});

describe("getCurrentUser (throwing form)", () => {
  it("throws rather than inventing an identity when there is none to trust", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { getCurrentUser } = await import("@/lib/session");

    await expect(getCurrentUser()).rejects.toThrow(/unauthenticated/);
  });
});

describe("first sight of a new user", () => {
  it("provisions once when several requests arrive together, and none of them fails", async () => {
    // A page load fans out: the page, its SSE stream and client fetches all resolve identity at
    // once. Find-then-insert let every one of them miss and insert, and all but one died on
    // users_auth_sub_unique — a 500 on a brand-new invitee's very first visit.
    setHeaders({ "x-forwarded-user": "oidc-sub-burst", "x-forwarded-email": "burst@example.com" });
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    // Warm the pool, or the first request finishes before the others have a connection.
    await Promise.all(Array.from({ length: 8 }, () => db.execute(sql`select pg_sleep(0.05)`)));
    const { getCurrentUserOrNull } = await import("@/lib/session");

    const results = await Promise.allSettled(Array.from({ length: 8 }, () => getCurrentUserOrNull()));

    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<{ id: string } | null>).value?.id));
    expect(ids.size).toBe(1);
  });
});
