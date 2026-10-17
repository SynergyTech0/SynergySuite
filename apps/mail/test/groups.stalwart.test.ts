import { beforeAll, describe, expect, it, vi } from "vitest";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

/**
 * Distribution lists and shared mailboxes against a real Stalwart, skipped unless
 * STALWART_TEST_URL (its HTTP admin API, e.g. http://127.0.0.1:8080) is set. The server is set up
 * like deploy/stalwart/plan.template.ndjson: STALWART_TEST_DOMAIN (default example.test) with
 * an admin STALWART_TEST_ADMIN ("postmaster@example.test:<password>") and a service login with
 * the impersonate permission STALWART_TEST_MASTER ("webmail@example.test:<password>"), IMAPS on
 * STALWART_TEST_IMAP_PORT (993) and submission over TLS on STALWART_TEST_SMTP_PORT (465), self-signed
 * certificates are fine. Each run creates uniquely named lists, groups and users.
 */
const url = process.env.STALWART_TEST_URL;
const domain = process.env.STALWART_TEST_DOMAIN || "example.test";
const [adminUser, adminPass] = splitLogin(process.env.STALWART_TEST_ADMIN || `postmaster@${domain}:`);
const [masterUser, masterPass] = splitLogin(process.env.STALWART_TEST_MASTER || `webmail@${domain}:`);
const host = url ? new URL(url).hostname : "";
const imapPort = Number(process.env.STALWART_TEST_IMAP_PORT || 993);
const smtpPort = Number(process.env.STALWART_TEST_SMTP_PORT || 465);

function splitLogin(s: string): [string, string] {
  const i = s.indexOf(":");
  return [s.slice(0, i), s.slice(i + 1)];
}

const grants: { address: string; member: string; user_id: string }[] = [];
vi.mock("../lib/db", () => ({
  q: async (sql: string, p: unknown[] = []) => {
    if (sql.startsWith("SELECT") && sql.includes("shared_mailbox_grants")) return grants.filter((g) => g.address === p[0]);
    if (sql.startsWith("SELECT")) return []; // no outside accounts
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

describe.skipIf(!url)("groups on a real Stalwart", async () => {
  Object.assign(process.env, {
    MAIL_ADMIN_URL: url, MAIL_ADMIN_USER: adminUser, MAIL_ADMIN_PASSWORD: adminPass,
    MAIL_IMAP_HOST: host, MAIL_IMAP_PORT: String(imapPort), MAIL_IMAP_SECURE: "true",
    MAIL_SMTP_PORT: String(smtpPort), MAIL_SMTP_SECURE: "true", MAIL_SUITE_TLS_INSECURE: "true",
    MAIL_SUITE_AUTH: "master", MAIL_MASTER_USER: masterUser, MAIL_MASTER_PASSWORD: masterPass,
    GROUPS_INTERNAL_URL: "http://groups.test",
  });
  delete process.env.MAIL_MASTER_LOGIN;

  // What Groups says each person belongs to; everything else goes to the real server.
  const memberOf = new Map<string, { id: string; kind: string; name: string; email: string; role: string }[]>();
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (u: string | URL | Request, init?: RequestInit) => {
    const s = String(u);
    if (!s.startsWith("http://groups.test/")) return realFetch(u, init);
    return new Response(JSON.stringify({ groups: memberOf.get(new URL(s).searchParams.get("email")!) ?? [] }));
  });

  const { putGroup, deleteGroup } = await import("../lib/groups");
  const { ensureMailbox, call } = await import("../lib/provision");
  const { getAccount, listAccounts } = await import("../lib/accounts");
  const { forgetMemberships } = await import("../lib/memberships");
  const { listFolders, listMessages, getMessage, sendMessage } = await import("../lib/mailbox");

  const tag = `t${Date.now().toString(36)}`;
  const ann = `ann-${tag}@${domain}`;
  const bob = `bob-${tag}@${domain}`;
  const carol = `carol-${tag}@${domain}`;
  const admin = (method: string, args: object) => call(url!, [[method, args, "0"]]);
  let domainId = "";
  beforeAll(async () => {
    for (const u of [ann, bob, carol]) await ensureMailbox(u, "");
    domainId = (await admin("x:Domain/query", { filter: { name: domain } })).ids[0];
  });
  const accountId = async (email: string): Promise<string | undefined> =>
    (await admin("x:Account/query", { filter: { name: email.split("@")[0], domainId } })).ids[0];
  const groupsOf = async (email: string) =>
    Object.keys((await admin("x:Account/get", { ids: [await accountId(email)], properties: ["memberGroupIds"] })).list[0].memberGroupIds ?? {});
  const mailingList = async (address: string) => {
    const ids = (await admin("x:MailingList/query", { filter: { text: address } })).ids;
    const lists = ids.length ? (await admin("x:MailingList/get", { ids })).list : [];
    return lists.find((l: { emailAddress: string }) => l.emailAddress === address) as { recipients: Record<string, boolean>; description: string } | undefined;
  };

  const login = (email: string) => ({ user: `${email}%${masterUser}`, pass: masterPass });
  async function submit(as: string, from: string, to: string, subject: string) {
    const t = nodemailer.createTransport({ host, port: smtpPort, secure: true, tls: { rejectUnauthorized: false }, auth: login(as) });
    return t.sendMail({ from, to, subject, text: `body of ${subject}` });
  }
  async function inbox(email: string, folder = "INBOX"): Promise<string[]> {
    const c = new ImapFlow({ host, port: imapPort, secure: true, tls: { rejectUnauthorized: false }, auth: login(email), logger: false });
    await c.connect();
    try {
      const lock = await c.getMailboxLock(folder, { readOnly: true });
      try {
        const exists = typeof c.mailbox === "object" ? c.mailbox.exists : 0;
        return exists ? (await c.fetchAll("1:*", { envelope: true })).map((m) => m.envelope?.subject ?? "") : [];
      } finally {
        lock.release();
      }
    } finally {
      await c.logout();
    }
  }
  async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
    let v = await fn();
    for (let i = 0; i < 40 && !ok(v); i++) v = (await new Promise((r) => setTimeout(r, 250)), await fn());
    return v;
  }

  it("makes, changes and removes a distribution list", async () => {
    const list = `list-${tag}@${domain}`;
    expect(await putGroup(list, { kind: "list", name: "Sales", members: [ann, "ext@outside.example"] })).toEqual({ address: list, provisioned: true });
    expect(await mailingList(list)).toMatchObject({ description: "Sales", recipients: { [ann]: true, "ext@outside.example": true } });

    await putGroup(list, { kind: "list", name: "Sales team", members: [bob, "ext@outside.example"] });
    const now = await mailingList(list);
    expect(now?.description).toBe("Sales team");
    expect(Object.keys(now?.recipients ?? {}).sort()).toEqual([bob, "ext@outside.example"]);

    await submit(carol, carol, list, `to the list ${tag}`);
    expect(await eventually(() => inbox(bob), (s) => s.length > 0)).toContain(`to the list ${tag}`);

    await deleteGroup(list);
    expect(await mailingList(list)).toBeUndefined();
    await deleteGroup(list); // already gone is fine
  }, 30_000);

  it("makes a shared mailbox, keeps its members exact and removes it", async () => {
    const shared = `shared-${tag}@${domain}`;
    const res = await putGroup(shared, { kind: "shared", name: "Support", members: [ann, bob, carol, "ext@outside.example"] });
    expect(res).toMatchObject({ provisioned: true, skipped: ["ext@outside.example"] });
    const gid = await accountId(shared);
    expect(gid).toBeTruthy();
    for (const m of [ann, bob, carol]) expect(await groupsOf(m)).toContain(gid);

    await putGroup(shared, { kind: "shared", name: "Support", members: [ann] });
    expect(await groupsOf(ann)).toContain(gid);
    expect(await groupsOf(bob)).not.toContain(gid);
    expect(await groupsOf(carol)).not.toContain(gid);

    // Someone added on the server itself, whom Mail never granted: still removed, then the group goes.
    await admin("x:Account/set", { update: { [(await accountId(bob))!]: { [`memberGroupIds/${gid}`]: true } } });
    expect(await deleteGroup(shared)).toEqual({ address: shared, provisioned: true });
    expect(await accountId(shared)).toBeUndefined();
    expect(await groupsOf(ann)).not.toContain(gid);
    expect(await groupsOf(bob)).not.toContain(gid);
  }, 30_000);

  it("opens a shared mailbox as one of its members, reads it and sends as it", async () => {
    const shared = `desk-${tag}@${domain}`;
    await putGroup(shared, { kind: "shared", name: "Help Desk", members: [ann] });
    memberOf.set(ann, [{ id: "g1", kind: "shared_mailbox", name: "Help Desk", email: shared, role: "member" }]);
    forgetMemberships();

    expect(await listAccounts(ann)).toContainEqual({ id: `shared:${shared}`, label: "Help Desk", address: shared, kind: "shared" });
    expect(await getAccount(bob, `shared:${shared}`)).toBeNull();
    const acct = (await getAccount(ann, `shared:${shared}`, "Ann"))!;

    const folders = await listFolders(acct);
    expect(folders.map((f) => [f.path, f.role])).toEqual([
      ["INBOX", "\\Inbox"], ["Drafts", "\\Drafts"], ["Sent Items", "\\Sent"], ["Junk Mail", "\\Junk"], ["Deleted Items", "\\Trash"],
    ]);
    expect(folders[0].name).toBe("Inbox");

    await submit(bob, bob, shared, `for the desk ${tag}`);
    const got = await eventually(() => listMessages(acct, "INBOX"), (r) => r.total > 0);
    expect(got.messages.map((m) => m.subject)).toEqual([`for the desk ${tag}`]);
    const msg = await getMessage(acct, "INBOX", got.messages[0].uid, { attachmentUrl: (i) => `/a/${i}` });
    expect(msg.text.trim()).toBe(`body of for the desk ${tag}`);
    expect(await inbox(ann)).toEqual([]); // not in the member's own mailbox

    await sendMessage(acct, { to: [bob], subject: `from the desk ${tag}`, text: "hello" });
    expect(await eventually(() => inbox(bob), (s) => s.includes(`from the desk ${tag}`))).toContain(`from the desk ${tag}`);
    const sent = await listMessages(acct, "Sent Items");
    expect(sent.messages.map((m) => [m.subject, m.from?.address])).toEqual([[`from the desk ${tag}`, shared]]);
    expect(await inbox(ann, "Sent Items")).toEqual([]); // the copy went to the shared tree, not ann's own

    await deleteGroup(shared);
  }, 60_000);
});
