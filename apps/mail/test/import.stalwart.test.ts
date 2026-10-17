import { describe, expect, it, vi } from "vitest";
import { ImapFlow } from "imapflow";

/**
 * The migration import endpoint against a real mail server (Stalwart set up as in
 * deploy/compose.yml), skipped unless MAIL_TEST_MASTER_USER is set. It needs Stalwart's IMAPS
 * at MAIL_TEST_IMAP_HOST:MAIL_TEST_IMAP_PORT, its admin API at MAIL_TEST_ADMIN_URL with
 * MAIL_TEST_ADMIN_USER / _PASSWORD (postmaster), and the master login MAIL_TEST_MASTER_USER /
 * _PASSWORD (webmail, allowed to impersonate). Each run creates a new mailbox at MAIL_TEST_DOMAIN.
 */
const host = process.env.MAIL_TEST_IMAP_HOST;
const master = process.env.MAIL_TEST_MASTER_USER;
const port = Number(process.env.MAIL_TEST_IMAP_PORT || 993);
const domain = process.env.MAIL_TEST_DOMAIN || "suite.test";

let requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("../lib/db", () => ({ q: async () => [] }));

describe.skipIf(!host || !master)("importing mail into a suite mailbox (real Stalwart)", async () => {
  Object.assign(process.env, {
    MAIL_IMAP_HOST: host, MAIL_IMAP_PORT: String(port), MAIL_IMAP_SECURE: "true", MAIL_SUITE_TLS_INSECURE: "true",
    MAIL_SUITE_AUTH: "master", MAIL_MASTER_USER: master, MAIL_MASTER_PASSWORD: process.env.MAIL_TEST_MASTER_PASSWORD,
    MAIL_ADMIN_URL: process.env.MAIL_TEST_ADMIN_URL, MAIL_ADMIN_USER: process.env.MAIL_TEST_ADMIN_USER, MAIL_ADMIN_PASSWORD: process.env.MAIL_TEST_ADMIN_PASSWORD,
    PROXY_SHARED_SECRET: "gw-secret",
  });
  const { PUT, POST } = await import("../app/api/import/route");
  const user = `mig${Date.now().toString(36)}@${domain}`;
  const as = (email: string, secret = "gw-secret") => {
    requestHeaders = new Headers({ "x-auth-request-email": email, "x-proxy-auth-secret": secret });
  };
  const raw = (subject: string) => Buffer.from([
    "From: Old Colleague <old@contoso.test>", `To: ${user}`, `Subject: ${subject}`, "Date: Tue, 02 Jan 2024 10:00:00 +0000",
    `Message-ID: <${Math.random().toString(36).slice(2)}@contoso.test>`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", `Body of ${subject}`, "",
  ].join("\r\n"));
  const put = (body: Buffer, q: Record<string, string>) =>
    PUT(new Request(`http://mail.example.com/api/import?${new URLSearchParams(q)}`, { method: "PUT", body: new Uint8Array(body), headers: { "content-type": "message/rfc822" } }));
  const post = (b: unknown) => POST(new Request("http://mail.example.com/api/import", { method: "POST", body: JSON.stringify(b) }));
  const imap = async <T,>(fn: (c: ImapFlow) => Promise<T>) => {
    const c = new ImapFlow({ host: host!, port, secure: true, tls: { rejectUnauthorized: false }, auth: { user: `${user}%${master}`, pass: process.env.MAIL_TEST_MASTER_PASSWORD! }, logger: false });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.logout();
    }
  };

  it("needs the person's gateway identity", async () => {
    requestHeaders = new Headers();
    expect((await put(raw("x"), {})).status).toBe(401);
    as(user, "wrong");
    expect((await put(raw("x"), {})).status).toBe(401);
  });

  it("creates the mailbox, then appends into the folder tree with the original date and state", async () => {
    as(user);
    const res = await put(raw("Budget"), { role: "inbox", path: JSON.stringify(["Projects", "2024"]), seen: "1", flagged: "1", date: "2024-01-02T10:00:05Z" });
    expect(res.status).toBe(200);
    const at = await res.json();
    expect(at.folder).toMatch(/^INBOX.Projects.2024$/);
    expect(at.uid).toBeGreaterThan(0);
    const sent = await (await put(raw("Re: Budget"), { role: "sent", path: "[]", seen: "1" })).json();
    const own = await (await put(raw("Receipt"), { path: JSON.stringify(["Receipts/2023"]) })).json();
    expect(own.folder).toBe("Receipts-2023");

    const seen = await imap(async (c) => {
      const boxes = await c.list();
      const lock = await c.getMailboxLock(at.folder);
      try {
        const m = await c.fetchOne(String(at.uid), { flags: true, internalDate: true, envelope: true }, { uid: true });
        return { boxes: boxes.map((b) => b.path), m, sentRole: boxes.find((b) => b.path === sent.folder)?.specialUse };
      } finally {
        lock.release();
      }
    });
    expect(seen.m && seen.m.envelope?.subject).toBe("Budget");
    expect(seen.m && [...(seen.m.flags ?? [])].sort()).toEqual(["\\Flagged", "\\Seen"]);
    expect(seen.m && new Date(seen.m.internalDate as Date).toISOString()).toBe("2024-01-02T10:00:05.000Z");
    expect(seen.sentRole).toBe("\\Sent");
    expect(seen.boxes).toContain("Receipts-2023");

    // Read and flag changes, then a move to Archive (its UID changes there).
    const moved = await (await post({ folder: at.folder, uid: at.uid, seen: false, flagged: false, moveTo: { role: "archive", path: [] } })).json();
    expect(moved.folder).not.toBe(at.folder);
    expect(moved.uid).toBeGreaterThan(0);
    const after = await imap(async (c) => {
      const lock = await c.getMailboxLock(moved.folder);
      try {
        return await c.fetchOne(String(moved.uid), { flags: true, envelope: true }, { uid: true });
      } finally {
        lock.release();
      }
    });
    expect(after && after.envelope?.subject).toBe("Budget");
    expect(after && [...(after.flags ?? [])]).toEqual([]);
    expect(await (await post({ folder: at.folder, uid: at.uid, seen: true, flagged: false })).json()).toEqual({ gone: true });
  }, 30_000);

  it("refuses bad places", async () => {
    as(user);
    expect((await put(raw("x"), { role: "nope" })).status).toBe(400);
    expect((await put(raw("x"), { path: JSON.stringify([""]) })).status).toBe(400);
    expect((await put(Buffer.alloc(0), {})).status).toBe(400);
  });
});
