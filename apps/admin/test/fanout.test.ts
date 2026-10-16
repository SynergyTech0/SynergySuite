import { describe, expect, it } from "vitest";
import { collectAll, exportItems, fanOut, mergeHits, type Caller } from "../lib/fanout";

type Handler = (app: string, path: string, body: Record<string, unknown>, signal?: AbortSignal | null) => Promise<Response> | Response;

function caller(handler: Handler, timeoutMs = 200): Caller & { seen: { app: string; path: string; body: Record<string, unknown>; auth: string }[] } {
  const seen: { app: string; path: string; body: Record<string, unknown>; auth: string }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const [, app, ...rest] = u.pathname.split("/");
    const body = JSON.parse(String(init.body));
    seen.push({ app, path: "/" + rest.join("/"), body, auth: String((init.headers as Record<string, string>).Authorization) });
    return handler(app, "/" + rest.join("/"), body, init.signal);
  }) as unknown as typeof fetch;
  return { fetch: f, urlFor: (a) => `http://fake/${a}`, token: "secret", timeoutMs, seen };
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const hit = (id: string, date: string) => ({ id, kind: "message", title: id, owner: "A@Example.com", date, snippet: "" });

describe("fan-out", () => {
  it("searches every app in parallel with the token, merging hits newest first", async () => {
    const c = caller((app) => json({ app, hits: app === "mail" ? [hit("m1", "2026-01-02"), hit("m2", "2026-01-05")] : [hit("d1", "2026-01-03")], total: app === "mail" ? 2 : 1 }));
    const r = await fanOut(["mail", "drive"], { query: "x" }, c);
    expect(r.hits.map((h) => `${h.app}:${h.id}`)).toEqual(["mail:m2", "drive:d1", "mail:m1"]);
    expect(r.hits[0].owner).toBe("a@example.com");
    expect(r.results.every((x) => x.ok)).toBe(true);
    expect(c.seen.every((s) => s.auth === "Bearer secret" && s.path === "/api/compliance/search" && s.body.query === "x")).toBe(true);
  });

  it("reports a slow, refusing, missing or broken app beside the others' results", async () => {
    const c = caller(async (app, _p, _b, signal) => {
      if (app === "slow") {
        await new Promise((ok, no) => {
          const t = setTimeout(ok, 2000);
          signal?.addEventListener("abort", () => { clearTimeout(t); no(Object.assign(new Error("timeout"), { name: "TimeoutError" })); });
        });
      }
      if (app === "token") return json({ error: "no" }, 401);
      if (app === "old") return json({ error: "no" }, 404);
      if (app === "bad") return new Response("<html>", { status: 200 });
      return json({ app, hits: [hit("ok1", "2026-01-01")] });
    }, 100);
    const start = Date.now();
    const r = await fanOut(["mail", "slow", "token", "old", "bad"], {}, c);
    expect(Date.now() - start).toBeLessThan(1500);
    const by = Object.fromEntries(r.results.map((x) => [x.app, x]));
    expect(by.mail.ok).toBe(true);
    expect(by.slow.error).toMatch(/No answer within/);
    expect(by.token.error).toMatch(/compliance token/);
    expect(by.old.error).toMatch(/doesn't take part/);
    expect(by.bad.error).toMatch(/isn't JSON/);
    expect(r.hits.map((h) => h.id)).toEqual(["ok1"]);
  });

  it("continues only the apps that have a cursor", async () => {
    const c = caller((app, _p, body) => json({ app, hits: [hit(`${app}-${body.cursor ?? "0"}`, "2026-01-01")] }));
    const r = await fanOut(["mail", "drive"], {}, c, { drive: "c2" });
    expect(r.results.map((x) => x.app)).toEqual(["drive"]);
    expect(r.hits[0].id).toBe("drive-c2");
  });

  it("collects every page up to a limit and says when it was cut short", async () => {
    const all = Array.from({ length: 450 }, (_, i) => hit(`h${i}`, "2026-01-01"));
    const c = caller((_a, _p, body) => {
      const off = Number(body.cursor ?? 0);
      const lim = Number(body.limit);
      const page = all.slice(off, off + lim);
      return json({ app: "mail", hits: page, nextCursor: off + lim < all.length ? String(off + lim) : undefined });
    });
    const full = await collectAll("mail", {}, c, 5000);
    expect(full.hits.length).toBe(450);
    expect(full.truncated).toBe(false);
    expect(c.seen.map((s) => s.body.limit)).toEqual([200, 200, 200]);
    const cut = await collectAll("mail", {}, c, 300);
    expect(cut.hits.length).toBe(300);
    expect(cut.truncated).toBe(true);
  });

  it("exports in batches of at most 100 ids", async () => {
    const c = caller((app, _p, body) => json({ items: (body.ids as string[]).map((id) => ({ ...hit(id, ""), app: "other", metadata: {} })) }));
    const ids = Array.from({ length: 250 }, (_, i) => `i${i}`);
    const got: string[] = [];
    await exportItems("drive", ids, c, (items) => {
      for (const it of items) {
        expect(it.app).toBe("drive");
        got.push(it.id);
      }
    });
    expect(got).toEqual(ids);
    expect(c.seen.map((s) => (s.body.ids as string[]).length)).toEqual([100, 100, 50]);
  });

  it("orders hits with bad dates last", () => {
    const merged = mergeHits([{ app: "a", ok: true, ms: 0, hits: [{ ...hit("x", "nope"), app: "a" }, { ...hit("y", "2026-01-01"), app: "a" }] }]);
    expect(merged.map((h) => h.id)).toEqual(["y", "x"]);
  });
});
