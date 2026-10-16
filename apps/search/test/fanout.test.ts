import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fanOut, safeLink, SEARCHABLE, viewerHeaders } from "../lib/fanout";

const viewer = { email: "ann@example.com", name: "Ann Lee", subject: "sub-ann" };

type Seen = { app: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> };
const seen: Seen[] = [];
let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const app = (req.url ?? "").split("/")[1];
      seen.push({ app, headers: req.headers, body: JSON.parse(raw || "{}") });
      const send = (status: number, v: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(v));
      };
      if (app === "old") return send(404, { error: "Not found" });
      if (app === "slow") return void setTimeout(() => send(200, { app, results: [] }), 1500);
      if (app === "broken") return send(500, { error: "boom" });
      if (app === "drive") {
        return send(200, {
          app,
          results: [
            { id: "f1", kind: "file", title: "Budget 2027.xlsx", snippet: "the budget", date: "2026-10-01T10:00:00Z", url: "/files/f1", person: "Ann Lee" },
            { id: "f2", kind: "file", title: "Evil", snippet: "", date: "2026-10-01T10:00:00Z", url: "javascript:alert(1)" },
            { id: "f3", kind: "file", title: "Data", snippet: "", date: "2026-10-01T10:00:00Z", url: "data:text/html,hi" },
            { id: "f4", kind: "file", title: "Protocol-relative", snippet: "", date: "2026-10-01T10:00:00Z", url: "//evil.example/x" },
            { id: "f5", kind: "file", title: "Elsewhere", snippet: "", date: "not a date", url: "https://files.example.com/f5" },
          ],
        });
      }
      send(200, { app, results: [{ id: `${app}-1`, kind: "message", title: "Budget review", snippet: "about the budget", date: "2026-10-02T09:00:00Z", url: "/?id=1" }] });
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server?.close();
});

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    SUITE_DOMAIN: "suite.test",
    PROXY_SHARED_SECRET: "gateway-secret",
    SEARCH_APP_URLS: JSON.stringify({
      mail: `${base}/mail`,
      drive: `${base}/drive`,
      chat: `${base}/old`,
      calendar: "http://127.0.0.1:1",
      notes: `${base}/slow`,
      forms: `${base}/broken`,
      ...extra,
    }),
  } as NodeJS.ProcessEnv;
}

describe("fan-out", () => {
  it("asks each app as the viewer, with the gateway secret, and tolerates dead, slow, old and broken apps", async () => {
    seen.length = 0;
    const start = Date.now();
    const r = await fanOut(viewer, { query: "budget", limit: 5 }, { env: env(), timeoutMs: 400, apps: ["mail", "drive", "chat", "calendar", "notes", "forms"] });
    expect(Date.now() - start).toBeLessThan(1400);

    const mail = seen.find((s) => s.app === "mail")!;
    expect(mail.headers["x-auth-request-email"]).toBe("ann@example.com");
    expect(mail.headers["x-auth-request-preferred-username"]).toBe("Ann Lee");
    expect(mail.headers["x-auth-request-user"]).toBe("sub-ann");
    expect(mail.headers["x-proxy-auth-secret"]).toBe("gateway-secret");
    expect(mail.headers["content-type"]).toMatch(/application\/json/);
    expect(mail.body).toEqual({ query: "budget", limit: 5 });

    const by = Object.fromEntries(r.apps.map((a) => [a.app, a]));
    expect(by.mail).toMatchObject({ status: "ok", count: 1, name: "Mail" });
    expect(by.drive).toMatchObject({ status: "ok", count: 2 });
    expect(by.chat.status).toBe("not-supported");
    expect(by.calendar.status).toBe("unavailable");
    expect(by.notes.status).toBe("unavailable");
    expect(by.notes.detail).toMatch(/No answer within/);
    expect(by.forms.status).toBe("error");

    expect(r.hits.find((h) => h.app === "mail")).toMatchObject({ appName: "Mail", url: "https://mail.suite.test/?id=1", date: "2026-10-02T09:00:00.000Z" });
    const drive = r.hits.filter((h) => h.app === "drive");
    expect(drive.map((h) => h.id)).toEqual(["f1", "f5"]);
    expect(drive[0]).toMatchObject({ url: "https://drive.suite.test/files/f1", person: "Ann Lee", kind: "file" });
    expect(drive[1]).toMatchObject({ url: "https://files.example.com/f5", date: "" });
  });

  it("sends no secret header when none is configured", async () => {
    seen.length = 0;
    const e = env();
    delete e.PROXY_SHARED_SECRET;
    await fanOut(viewer, { query: "x" }, { env: e, apps: ["mail"] });
    expect(seen[0].headers["x-proxy-auth-secret"]).toBeUndefined();
    expect(viewerHeaders({ ...viewer, subject: "" }, e)["x-auth-request-user"]).toBe("ann@example.com");
  });

  it("covers every searchable app by default", async () => {
    const urls = Object.fromEntries(SEARCHABLE.map((a) => [a, `${base}/${a}`]));
    const r = await fanOut(viewer, { query: "x" }, { env: { ...env(), SEARCH_APP_URLS: JSON.stringify(urls) } as NodeJS.ProcessEnv });
    expect(r.apps.map((a) => a.app)).toEqual([...SEARCHABLE]);
    expect(r.apps.every((a) => a.status === "ok")).toBe(true);
  });

  it("only links to http(s) or paths in the app", () => {
    const e = { NODE_ENV: "test", SUITE_DOMAIN: "suite.test" } as NodeJS.ProcessEnv;
    expect(safeLink("notes", "/?page=1", e)).toBe("https://notes.suite.test/?page=1");
    expect(safeLink("notes", "https://x.example/a", e)).toBe("https://x.example/a");
    for (const bad of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x", "vbscript:x", "//evil.example", "/\\evil.example", "relative/path", "", "/a b", 42]) {
      expect(safeLink("notes", bad, e)).toBeNull();
    }
    expect(safeLink("notes", "/x", { NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe("http://localhost:3135/x");
  });
});
