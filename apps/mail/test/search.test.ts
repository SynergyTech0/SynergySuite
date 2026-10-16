import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImapFlow } from "imapflow";
import { searchCompiler } from "imapflow/lib/search-compiler.js";
import { parseQuery } from "@synergy/search";

// POST /api/search through Mail's normal sign-in, with imapflow replaced by an in-memory mail
// server at the IMAP boundary (test/fake-imap.ts) and the outside-accounts table in memory.
vi.mock("imapflow", async () => ({ ImapFlow: (await import("./fake-imap")).FakeImapFlow }));
let requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));

type Row = Record<string, unknown> & { id: string; owner_email: string };
const rows: Row[] = [];
vi.mock("../lib/db", () => ({
  q: async (sql: string, params: unknown[] = []) => {
    if (/FROM accounts WHERE owner_email = \$1/.test(sql)) return rows.filter((r) => r.owner_email === params[0]);
    if (/FROM accounts WHERE id = \$1 AND owner_email = \$2/.test(sql)) return rows.filter((r) => r.id === params[0] && r.owner_email === params[1]);
    return [];
  },
}));

const fake = await import("./fake-imap");
const { seal } = await import("../lib/secret");
const { POST } = await import("../app/api/search/route");
const { personalImapSearch, messageUrl } = await import("../lib/search");

Object.assign(process.env, {
  MAIL_IMAP_HOST: "imap.example.com", MAIL_SUITE_AUTH: "shared-password", MAIL_DEV_PASSWORD: "x",
  PROXY_SHARED_SECRET: "gw-secret", MAIL_ALLOW_PRIVATE_HOSTS: "1",
});
delete process.env.DEV_USER_EMAIL;
delete process.env.DEV_EMAIL;

const ann = "ann@example.com";
const bob = "bob@example.com";

const as = (email: string | null) => {
  requestHeaders = new Headers(email ? { "x-auth-request-email": email, "x-proxy-auth-secret": "gw-secret" } : {});
};
const search = async (body: unknown) => {
  const res = await POST(new Request("http://mail.example.com/api/search", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const msg = (subject: string, body: string, o: { from?: string; to?: string; date?: string; extra?: string } = {}) =>
  fake.message({ subject, from: o.from ?? "Carol Jones <carol@example.com>", to: o.to ?? ann, body, date: o.date })
    .replace("MIME-Version", `${o.extra ? o.extra + "\r\n" : ""}MIME-Version`);

function outside(id: string, owner: string, login: string) {
  rows.push({
    id, owner_email: owner, label: `${login} (outside)`, address: login,
    imap_host: "imap.outside.example", imap_port: 993, imap_secure: true,
    smtp_host: "smtp.outside.example", smtp_port: 465, smtp_secure: true, username: login, secret: seal("pw"),
  });
}

beforeEach(() => {
  fake.reset();
  rows.length = 0;
  fake.mailbox(ann, { INBOX: "\\Inbox", Sent: "\\Sent", Trash: "\\Trash", Junk: "\\Junk", Projects: undefined });
  fake.mailbox(bob);
  as(ann);
});

describe("POST /api/search", () => {
  it("needs the gateway sign-in", async () => {
    as(null);
    expect((await search({ query: "invoice" })).status).toBe(401);
    requestHeaders = new Headers({ "x-auth-request-email": ann, "x-proxy-auth-secret": "wrong" });
    expect((await search({ query: "invoice" })).status).toBe(401);
  });

  it("refuses an empty query", async () => {
    for (const body of [{ query: "" }, { query: "   " }, {}, "not json", { query: "-only" }]) {
      const r = await search(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error).toBeTruthy();
    }
  });

  it("finds the person's own mail across folders, newest first, with deep links", async () => {
    const old = fake.deliver(ann, "INBOX", msg("Invoice March", "Please pay the invoice.", { date: "Sun, 01 Mar 2026 10:00:00 +0000" }));
    const sent = fake.deliver(ann, "Sent", msg("Re: invoice", "Paid it.", { from: "Ann <ann@example.com>", to: "carol@example.com", date: "Wed, 04 Mar 2026 10:00:00 +0000" }));
    const proj = fake.deliver(ann, "Projects", msg("Budget", "The INVOICE for the build is attached.", { date: "Tue, 03 Mar 2026 10:00:00 +0000" }));
    fake.deliver(ann, "INBOX", msg("Lunch", "Nothing to see"));
    const r = await search({ query: "invoice" });
    expect(r.status).toBe(200);
    expect(r.body.app).toBe("mail");
    expect(r.body.results.map((x: { title: string }) => x.title)).toEqual(["Re: invoice", "Budget", "Invoice March"]);
    const [first, second, third] = r.body.results;
    expect(first).toMatchObject({ kind: "message", person: "Ann", url: messageUrl("suite", "Sent", sent), date: "2026-03-04T10:00:00.000Z" });
    expect(first.id).toBe(`suite:Sent:1:${sent}`);
    expect(second).toMatchObject({ url: `/?account=suite&folder=Projects&uid=${proj}`, person: "Carol Jones" });
    expect(second.snippet).toContain("INVOICE");
    expect(third.url).toBe(messageUrl("suite", "INBOX", old));
    expect(first.text).toBeUndefined();
  });

  it("leaves out Deleted Items and Junk", async () => {
    fake.deliver(ann, "Trash", msg("Old invoice", "deleted"));
    fake.deliver(ann, "Junk", msg("Cheap invoice", "spam"));
    expect((await search({ query: "invoice" })).body.results).toEqual([]);
  });

  it("never returns someone else's mail", async () => {
    fake.deliver(bob, "INBOX", msg("Bob's invoice", "private to bob", { to: bob }));
    fake.deliver(ann, "INBOX", msg("Ann's invoice", "hers"));
    const r = await search({ query: "invoice" });
    expect(r.body.results.map((x: { title: string }) => x.title)).toEqual(["Ann's invoice"]);
    as(bob);
    expect((await search({ query: "invoice" })).body.results.map((x: { title: string }) => x.title)).toEqual(["Bob's invoice"]);
  });

  it("includes the outside accounts the person connected, and only theirs", async () => {
    fake.mailbox("ann@outside.example");
    fake.mailbox("bob@outside.example");
    outside("7", ann, "ann@outside.example");
    outside("8", bob, "bob@outside.example");
    const uid = fake.deliver("ann@outside.example", "INBOX", msg("Outside invoice", "from elsewhere", { to: "ann@outside.example" }));
    fake.deliver("bob@outside.example", "INBOX", msg("Bob outside invoice", "not ann's", { to: "bob@outside.example" }));
    fake.deliver(ann, "INBOX", msg("Suite invoice", "here", { date: "Mon, 02 Mar 2026 10:00:00 +0000" }));
    const r = await search({ query: "invoice" });
    expect(r.body.results.map((x: { title: string }) => x.title)).toEqual(["Suite invoice", "Outside invoice"]);
    expect(r.body.results[1]).toMatchObject({ id: `7:INBOX:1:${uid}`, url: messageUrl("7", "INBOX", uid) });
  });

  it("drops what the server matched but the query doesn't (no false hits)", async () => {
    // The fake server's TEXT matches anywhere in the raw message, headers included.
    fake.deliver(ann, "INBOX", msg("Hello", "nothing here", { extra: "X-Tracking: zebracode" }));
    expect((await search({ query: "zebracode" })).body.results).toEqual([]);
  });

  it("applies OR, phrases and exclusions", async () => {
    fake.deliver(ann, "INBOX", msg("Contract draft", "the big deal"));
    fake.deliver(ann, "INBOX", msg("Contract final", "the big deal"));
    fake.deliver(ann, "INBOX", msg("Proposal", "a small deal"));
    const titles = async (query: string) => (await search({ query })).body.results.map((x: { title: string }) => x.title).sort();
    expect(await titles('"big deal" -draft')).toEqual(["Contract final"]);
    expect(await titles("proposal OR contract -final")).toEqual(["Contract draft", "Proposal"]);
  });

  it("honours limit, kinds and text", async () => {
    for (let i = 1; i <= 5; i++) fake.deliver(ann, "INBOX", msg(`Report ${i}`, `weekly report number ${i}`, { date: `Sun, 0${i} Mar 2026 10:00:00 +0000` }));
    const r = await search({ query: "report", limit: 2, text: true });
    expect(r.body.results.map((x: { title: string }) => x.title)).toEqual(["Report 5", "Report 4"]);
    expect(r.body.results[0].text).toBe("weekly report number 5");
    expect(fake.server.fetched).toBeLessThanOrEqual(2);
    expect((await search({ query: "report", kinds: ["file"] })).body.results).toEqual([]);
    expect((await search({ query: "report", kinds: ["message"] })).body.results).toHaveLength(5);
  });

  it("still answers when the suite mailbox can't be opened", async () => {
    fake.reset();
    const r = await search({ query: "invoice" });
    expect(r).toEqual({ status: 200, body: { app: "mail", results: [] } });
  });
});

describe("query to IMAP SEARCH", () => {
  const conn = { enabled: new Set(), capabilities: new Set() } as unknown as ImapFlow;
  type Attr = { type: string; value: unknown } | Attr[];
  const flat = (a: Attr[]): string => a.map((x) => (Array.isArray(x) ? `(${flat(x)})` : String(x.value))).join(" ");
  const imap = (q: string) => flat(searchCompiler(conn, personalImapSearch(parseQuery(q))) as Attr[]);

  it("sends words, OR and exclusions to the server", () => {
    expect(imap("invoice")).toBe("TEXT invoice");
    expect(imap("invoice -draft")).toBe("TEXT invoice NOT NOT NOT TEXT draft");
    expect(imap('"big deal" OR contract march')).toBe("OR TEXT big deal TEXT contract NOT NOT TEXT march");
  });
});
