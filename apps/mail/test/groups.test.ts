import { beforeEach, describe, expect, it, vi } from "vitest";

// Distribution lists and shared mailboxes on Stalwart (PUT/DELETE /api/svc/groups/<address>),
// against a stand-in for Stalwart's JMAP admin API and an in-memory grants table.

let requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));

const grants: { address: string; member: string; user_id: string }[] = [];
vi.mock("../lib/db", () => ({
  q: async (sql: string, p: unknown[] = []) => {
    if (sql.startsWith("SELECT")) return grants.filter((g) => g.address === p[0]);
    if (sql.startsWith("DELETE")) {
      const members = p[1] as string[] | undefined;
      for (let i = grants.length - 1; i >= 0; i--) if (grants[i].address === p[0] && (!members || members.includes(grants[i].member))) grants.splice(i, 1);
      return [];
    }
    if (sql.startsWith("INSERT INTO shared_mailbox_grants")) {
      const [address, member, user_id] = p as string[];
      const row = grants.find((g) => g.address === address && g.member === member);
      if (row) row.user_id = user_id;
      else grants.push({ address, member, user_id });
      return [];
    }
    throw new Error(`unexpected query ${sql}`);
  },
}));

type Call = [string, Record<string, any>, string];
const calls: Call[] = [];
let accounts: Map<string, { id: string; type: string }>; // "name|domainId" -> account
let lists: Map<string, string>; // "name|domainId" -> list id
let next = 0;

function stalwart([method, args]: Call) {
  const key = args.filter && `${args.filter.name}|${args.filter.domainId}`;
  switch (method) {
    case "x:Domain/query": return { ids: args.filter.name === "example.com" ? ["d1"] : [] };
    case "x:Account/query": return { ids: accounts.has(key) ? [accounts.get(key)!.id] : [] };
    // Like Stalwart: no filter on a list's name, only a text search (which also matches recipients).
    case "x:MailingList/query": return { ids: args.filter.name === undefined ? [...lists.values()].filter(() => /@example\.com$/.test(args.filter.text)) : [] };
    case "x:MailingList/get": return { list: [...lists].filter(([, id]) => args.ids.includes(id)).map(([k, id]) => ({ id, name: k.split("|")[0], domainId: k.split("|")[1] })) };
    case "x:Account/get": return { list: [...accounts.values()].filter((a) => args.ids.includes(a.id)).map((a) => ({ id: a.id, "@type": a.type })) };
    case "x:Account/set":
    case "x:MailingList/set": {
      const store = method === "x:Account/set" ? accounts : lists;
      const ids = () => [...store.values()].map((v) => (typeof v === "string" ? v : v.id));
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries<any>(args.create ?? {})) {
        const id = `${method === "x:Account/set" ? (v["@type"] === "Group" ? "g" : "u") : "l"}${++next}`;
        if (method === "x:Account/set") accounts.set(`${v.name}|${v.domainId}`, { id, type: v["@type"] });
        else lists.set(`${v.name}|${v.domainId}`, id);
        (out.created ??= {})[k] = { id };
      }
      for (const id of Object.keys(args.update ?? {})) (ids().includes(id) ? (out.updated ??= {}) : (out.notUpdated ??= {}))[id] = ids().includes(id) ? null : { type: "notFound" };
      for (const id of args.destroy ?? []) {
        for (const [k, v] of store) if ((typeof v === "string" ? v : v.id) === id) store.delete(k);
        (out.destroyed ??= []).push(id);
      }
      return out;
    }
  }
  throw new Error(`unexpected method ${method}`);
}

vi.stubGlobal("fetch", async (u: string, init: RequestInit) => {
  expect(String(u)).toBe("http://stalwart:8080/jmap/");
  const body = JSON.parse(String(init.body));
  const call = body.methodCalls[0] as Call;
  calls.push(call);
  return new Response(JSON.stringify({ methodResponses: [[call[0], stalwart(call), call[2]]] }));
});

const { putGroup, deleteGroup } = await import("../lib/groups");
const route = await import("../app/api/svc/groups/[address]/route");

/** The calls that change something, in order. */
const changes = () => calls.filter(([m]) => m.endsWith("/set"));

beforeEach(() => {
  process.env.MAIL_ADMIN_URL = "http://stalwart:8080";
  calls.length = 0;
  grants.length = 0;
  accounts = new Map([["ann|d1", { id: "u-ann", type: "User" }], ["carol|d1", { id: "u-carol", type: "User" }]]);
  lists = new Map();
});

describe("distribution lists", () => {
  it("create, then replace the recipients exactly, then destroy", async () => {
    expect(await putGroup("sales@example.com", { kind: "list", name: "Sales", members: ["ann@example.com", "ext@gmail.com"] }))
      .toEqual({ address: "sales@example.com", provisioned: true });
    expect(changes()).toEqual([["x:MailingList/set", {
      create: { l: { name: "sales", domainId: "d1", description: "Sales", recipients: { "ann@example.com": true, "ext@gmail.com": true } } },
    }, "s"]]);

    calls.length = 0;
    await putGroup("sales@example.com", { kind: "list", name: "Sales team", members: ["ext@gmail.com"] });
    const id = lists.get("sales|d1")!;
    expect(changes()).toEqual([["x:MailingList/set", { update: { [id]: { description: "Sales team", recipients: { "ext@gmail.com": true } } } }, "s"]]);

    calls.length = 0;
    expect(await deleteGroup("sales@example.com")).toEqual({ address: "sales@example.com", provisioned: true });
    expect(changes()).toEqual([["x:MailingList/set", { destroy: [id] }, "s"]]);
    expect(lists.size).toBe(0);
  });

  it("refuse a domain the mail server doesn't host", async () => {
    await expect(putGroup("sales@elsewhere.com", { kind: "list", name: "Sales", members: [] })).rejects.toThrow(/doesn't host elsewhere.com/);
  });
});

describe("shared mailboxes", () => {
  it("create the group, add members on the user, skip outside addresses", async () => {
    const out = await putGroup("support@example.com", {
      kind: "shared", name: "Support", members: ["ann@example.com", "bob@example.com", "ext@gmail.com"],
    });
    expect(out).toMatchObject({ address: "support@example.com", provisioned: true, skipped: ["ext@gmail.com"] });
    const g = accounts.get("support|d1")!.id;
    const bob = accounts.get("bob|d1")!.id; // bob had no mailbox yet: ensureMailbox made one
    expect(changes()).toEqual([
      ["x:Account/set", { create: { g: { "@type": "Group", name: "support", domainId: "d1", description: "Support" } } }, "c"],
      ["x:Account/set", { create: { u: expect.objectContaining({ "@type": "User", name: "bob", domainId: "d1" }) } }, "c"],
      ["x:Account/set", { update: { "u-ann": { [`memberGroupIds/${g}`]: true }, [bob]: { [`memberGroupIds/${g}`]: true } } }, "m"],
    ]);
    expect(grants.map((r) => r.member).sort()).toEqual(["ann@example.com", "bob@example.com"]);
  });

  it("re-PUT takes the group away from people no longer listed, and only them", async () => {
    await putGroup("support@example.com", { kind: "shared", name: "Support", members: ["ann@example.com", "carol@example.com"] });
    const g = accounts.get("support|d1")!.id;
    calls.length = 0;
    await putGroup("support@example.com", { kind: "shared", name: "Help desk", members: ["carol@example.com"] });
    expect(changes()).toEqual([
      ["x:Account/set", { update: { [g]: { description: "Help desk" } } }, "s"],
      ["x:Account/set", { update: { "u-carol": { [`memberGroupIds/${g}`]: true }, "u-ann": { [`memberGroupIds/${g}`]: null } } }, "m"],
    ]);
    expect(grants.map((r) => r.member)).toEqual(["carol@example.com"]);

    calls.length = 0;
    await deleteGroup("support@example.com");
    expect(changes()).toEqual([
      ["x:Account/set", { update: { "u-carol": { [`memberGroupIds/${g}`]: null } } }, "m"],
      ["x:Account/set", { destroy: [g] }, "s"],
    ]);
    expect(accounts.has("support|d1")).toBe(false);
    expect(grants).toEqual([]);
  });

  it("never turn a person's mailbox into a shared one, nor delete it", async () => {
    await expect(putGroup("ann@example.com", { kind: "shared", name: "Ann", members: [] })).rejects.toThrow(/person's mailbox/);
    await deleteGroup("ann@example.com");
    expect(changes()).toEqual([]);
    expect(accounts.has("ann|d1")).toBe(true);
  });

  it("answer provisioned: false without the admin API", async () => {
    delete process.env.MAIL_ADMIN_URL;
    expect(await putGroup("support@example.com", { kind: "shared", name: "Support", members: ["ann@example.com"] }))
      .toMatchObject({ address: "support@example.com", provisioned: false, note: expect.stringMatching(/MAIL_ADMIN_URL/) });
    expect(calls).toEqual([]);
  });
});

describe("the service route", () => {
  const ctx = (address: string) => ({ params: Promise.resolve({ address }) });
  const put = (body: unknown) => new Request("http://mail:3200/api/svc/groups/x", { method: "PUT", body: JSON.stringify(body) });

  beforeEach(() => {
    process.env.PROXY_SHARED_SECRET = "gw-secret";
    delete process.env.MAIL_ADMIN_URL;
  });

  it("is not there without the suite's shared secret", async () => {
    for (const h of [{}, { "x-proxy-auth-secret": "wrong" }] as Record<string, string>[]) {
      requestHeaders = new Headers(h);
      const res = await route.PUT(put({ kind: "list", name: "x", members: [] }), ctx("sales@example.com"));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
      expect((await route.DELETE(new Request("http://mail:3200/", { method: "DELETE" }), ctx("sales@example.com"))).status).toBe(404);
    }
  });

  it("checks its input and answers for the Groups app", async () => {
    requestHeaders = new Headers({ "x-proxy-auth-secret": "gw-secret" });
    expect((await route.PUT(put({ kind: "team", members: [] }), ctx("sales@example.com"))).status).toBe(400);
    expect((await route.PUT(put({ kind: "list", members: ["nope"] }), ctx("sales@example.com"))).status).toBe(400);
    expect((await route.PUT(put({ kind: "list", members: [] }), ctx("not-an-address"))).status).toBe(400);
    const res = await route.PUT(put({ kind: "list", name: "Sales", members: [" Ann@Example.com "] }), ctx("Sales%40example.com"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ address: "sales@example.com", provisioned: false });
    const del = await route.DELETE(new Request("http://mail:3200/", { method: "DELETE" }), ctx("sales@example.com"));
    expect(await del.json()).toMatchObject({ address: "sales@example.com", provisioned: false });
  });
});
