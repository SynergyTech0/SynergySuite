import { afterEach, describe, expect, it, vi } from "vitest";
import { graph, graphMailboxesOf, listGraphFolders } from "../lib/graph";
import { getAccount } from "../lib/accounts";

const env = {
  MAIL_GRAPH_TENANT: "company.com", MAIL_GRAPH_CLIENT_ID: "app", MAIL_GRAPH_CLIENT_SECRET: "shh",
  MAIL_GRAPH_MAILBOXES: "boss@suite.test=support@company.com, Boss@suite.test=boss@company.com,bad",
  MAIL_GRAPH_DOMAINS: "company.com",
};
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("which Graph mailboxes a suite user gets", () => {
  it("gives the admin's pairs and each employee's own company address, and nothing without the app", () => {
    expect(graphMailboxesOf("boss@suite.test", env)).toEqual(["support@company.com", "boss@company.com"]);
    expect(graphMailboxesOf("Ann@Company.com", env)).toEqual(["ann@company.com"]);
    expect(graphMailboxesOf("ann@elsewhere.com", env)).toEqual([]);
    expect(graphMailboxesOf("ann@company.com", { ...env, MAIL_GRAPH_CLIENT_SECRET: "" })).toEqual([]);
  });

  it("opens only mailboxes given to that person", async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    expect(await getAccount("ann@company.com", "graph:ann@company.com")).toMatchObject({ address: "ann@company.com", graph: { mailbox: "ann@company.com" } });
    expect(await getAccount("ann@company.com", "graph:support@company.com")).toBeNull();
    expect(await getAccount("ann@elsewhere.com", "graph:ann@company.com")).toBeNull();
  });
});

describe("Graph calls", () => {
  it("signs in as the app once and asks for immutable ids", async () => {
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return url.includes("/oauth2/") ? json({ access_token: "tok", expires_in: 3600 }) : json({ value: [] });
    }));
    const c = { tenant: "company.com", clientId: "app", clientSecret: "shh" };
    await graph("ann@company.com", "/mailFolders", {}, c);
    await graph("ann@company.com", "/mailFolders", {}, c);
    expect(calls.filter(([u]) => u.includes("/oauth2/"))).toHaveLength(1);
    const [url, init] = calls[1];
    expect(url).toBe("https://graph.microsoft.com/v1.0/users/ann%40company.com/mailFolders");
    expect(init.headers).toMatchObject({ authorization: "Bearer tok", prefer: 'IdType="ImmutableId"' });
  });

  it("keeps at most 3 calls open per mailbox, so Exchange's limit of 4 is never hit", async () => {
    let open = 0, most = 0, other = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/oauth2/")) return json({ access_token: "tok4", expires_in: 3600 });
      if (url.includes("bob%40")) { other++; return json({ value: [] }); }
      most = Math.max(most, ++open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return json({ value: [] });
    }));
    const c = { tenant: "t4", clientId: "a", clientSecret: "b" };
    await Promise.all([
      ...Array.from({ length: 10 }, () => graph("ann@company.com", "/mailFolders", {}, c)),
      graph("bob@company.com", "/mailFolders", {}, c),
    ]);
    expect(most).toBe(3);
    expect(other).toBe(1);
  });

  it("waits out Microsoft's throttling and tries again", async () => {
    let tries = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/oauth2/")) return json({ access_token: "tok5", expires_in: 3600 });
      if (++tries < 3) return new Response(JSON.stringify({ error: { code: "ApplicationThrottled", message: "Application is over its MailboxConcurrency limit." } }), { status: 429, headers: { "retry-after": "0.01" } });
      return json({ value: [1] });
    }));
    expect(await graph("ann@company.com", "/mailFolders", {}, { tenant: "t5", clientId: "a", clientSecret: "b" })).toEqual({ value: [1] });
    expect(tries).toBe(3);
  });

  it("explains a refused mailbox", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/oauth2/") ? json({ access_token: "tok2", expires_in: 3600 }) : json({ error: { code: "ErrorAccessDenied", message: "Access is denied." } }, 403)));
    await expect(graph("x@company.com", "/mailFolders", {}, { tenant: "t2", clientId: "a", clientSecret: "b" }))
      .rejects.toMatchObject({ status: 403, message: "Microsoft didn't let the mail app open x@company.com: Access is denied." });
  });

  it("lists folders as a tree with roles from the well-known names", async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const folder = (id: string, name: string, children = 0) => ({ id, displayName: name, childFolderCount: children, unreadItemCount: 1, totalItemCount: 2 });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/oauth2/")) return json({ access_token: "tok3", expires_in: 3600 });
      const path = decodeURIComponent(new URL(url).pathname);
      if (path.endsWith("/mailFolders/inbox")) return json({ id: "IN" });
      if (path.endsWith("/mailFolders/sentitems")) return json({ id: "SENT" });
      if (/mailFolders\/(drafts|deleteditems|junkemail|archive)$/.test(path)) return json({ error: { code: "NotFound" } }, 404);
      if (path.endsWith("/mailFolders/IN/childFolders")) return json({ value: [folder("KID", "Clients")] });
      if (path.endsWith("/mailFolders")) return json({ value: [folder("IN", "Inbox", 1), folder("SENT", "Sent Items")] });
      return json({}, 500);
    }));
    expect(await listGraphFolders("ann@company.com")).toEqual([
      { path: "IN", name: "Inbox", role: "\\Inbox", unread: 1, total: 2, depth: 0 },
      { path: "KID", name: "Clients", role: null, unread: 1, total: 2, depth: 1 },
      { path: "SENT", name: "Sent Items", role: "\\Sent", unread: 1, total: 2, depth: 0 },
    ]);
  });
});
