import { beforeAll, describe, expect, it, vi } from "vitest";
import { ImapFlow } from "imapflow";

/**
 * POST /api/search against a real mail server (Stalwart), skipped unless MAIL_TEST_IMAP_HOST is
 * set. The server needs two users, MAIL_TEST_USERS (default ann@example.test,bob@example.test),
 * both with the password MAIL_TEST_PASSWORD, on IMAPS at MAIL_TEST_IMAP_PORT (default 993; a
 * self-signed certificate is fine). Each run adds a few uniquely tagged messages to their mailboxes.
 */
const host = process.env.MAIL_TEST_IMAP_HOST;
const port = Number(process.env.MAIL_TEST_IMAP_PORT || 993);
const pass = process.env.MAIL_TEST_PASSWORD || "";
const [ann, bob] = (process.env.MAIL_TEST_USERS || "ann@example.test,bob@example.test").split(",");

let requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("../lib/db", () => ({ q: async () => [] })); // no outside accounts

describe.skipIf(!host)("search on a real mail server", async () => {
  Object.assign(process.env, {
    MAIL_IMAP_HOST: host, MAIL_IMAP_PORT: String(port), MAIL_IMAP_SECURE: "true", MAIL_SUITE_TLS_INSECURE: "true",
    MAIL_SUITE_AUTH: "shared-password", MAIL_DEV_PASSWORD: pass, PROXY_SHARED_SECRET: "gw-secret",
  });
  const { POST } = await import("../app/api/search/route");
  const tag = `zq${Date.now().toString(36)}`;

  const as = (email: string) => {
    requestHeaders = new Headers({ "x-auth-request-email": email, "x-proxy-auth-secret": "gw-secret" });
  };
  const search = async (body: unknown) => {
    const res = await POST(new Request("http://mail.example.com/api/search", { method: "POST", body: JSON.stringify(body) }));
    expect(res.status).toBe(200);
    return (await res.json()).results as { title: string; url: string; person?: string; text?: string; date: string }[];
  };
  const raw = (subject: string, body: string, to: string, date: string) => [
    "From: Carol Jones <carol@example.test>", `To: ${to}`, `Subject: ${subject}`, `Date: ${date}`,
    `Message-ID: <${Math.random().toString(36).slice(2)}@example.test>`,
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", body, "",
  ].join("\r\n");

  async function seed(user: string, items: { role: string; subject: string; body: string; date: string }[]) {
    const c = new ImapFlow({ host: host!, port, secure: true, tls: { rejectUnauthorized: false }, auth: { user, pass }, logger: false });
    await c.connect();
    try {
      const boxes = await c.list();
      for (const it of items) {
        const path = boxes.find((b) => b.specialUse === it.role)?.path ?? "INBOX";
        await c.append(path, raw(it.subject, it.body, user, it.date));
      }
    } finally {
      await c.logout();
    }
  }

  beforeAll(async () => {
    await seed(ann, [
      { role: "\\Inbox", subject: `Invoice ${tag} March`, body: `Please pay invoice ${tag} soon.`, date: "Sun, 01 Mar 2026 10:00:00 +0000" },
      { role: "\\Sent", subject: `Re: ${tag}`, body: `Paid ${tag} today, the draft is attached.`, date: "Wed, 04 Mar 2026 10:00:00 +0000" },
      { role: "\\Trash", subject: `Deleted ${tag}`, body: `old ${tag}`, date: "Thu, 05 Mar 2026 10:00:00 +0000" },
      { role: "\\Junk", subject: `Spam ${tag}`, body: `cheap ${tag}`, date: "Thu, 05 Mar 2026 10:00:00 +0000" },
    ]);
    await seed(bob, [{ role: "\\Inbox", subject: `Bob ${tag}`, body: `private ${tag}`, date: "Fri, 06 Mar 2026 10:00:00 +0000" }]);
    // The server indexes new mail for TEXT search shortly after it arrives.
    as(ann);
    for (let i = 0; i < 40 && (await search({ query: tag })).length < 2; i++) await new Promise((r) => setTimeout(r, 250));
  }, 30_000);

  it("finds the person's own mail, newest first, outside Deleted Items and Junk", async () => {
    as(ann);
    const hits = await search({ query: tag, text: true });
    expect(hits.map((h) => h.title)).toEqual([`Re: ${tag}`, `Invoice ${tag} March`]);
    expect(hits[0]).toMatchObject({ person: "Carol Jones", date: "2026-03-04T10:00:00.000Z" });
    expect(hits[0].url).toMatch(/^\/\?account=suite&folder=.+&uid=\d+$/);
    expect(hits[0].text).toBe(`Paid ${tag} today, the draft is attached.`);
  });

  it("applies exclusions and OR on the server and here", async () => {
    as(ann);
    expect((await search({ query: `${tag} -draft` })).map((h) => h.title)).toEqual([`Invoice ${tag} March`]);
    expect((await search({ query: `${tag} march OR today` })).map((h) => h.title)).toEqual([`Re: ${tag}`, `Invoice ${tag} March`]);
  });

  it("never returns someone else's mail", async () => {
    as(bob);
    expect((await search({ query: tag })).map((h) => h.title)).toEqual([`Bob ${tag}`]);
    as(ann);
    expect((await search({ query: `bob ${tag}` }))).toEqual([]);
  });
});
