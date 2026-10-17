import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListResponse } from "imapflow";

// Shared mailboxes as extra accounts: who may open one (the Groups app decides), and how the
// "Shared Folders/<address>/" tree in the member's own login becomes the account's folders.
vi.mock("imapflow", async () => ({ ImapFlow: (await import("./fake-imap")).FakeImapFlow }));
vi.mock("../lib/db", () => ({ q: async () => [] })); // no outside accounts
const sent: Record<string, unknown>[] = [];
vi.mock("nodemailer", () => ({
  default: { createTransport: (opts: unknown) => ({ sendMail: async (m: Record<string, unknown>) => (sent.push({ ...m, transport: opts }), { messageId: "<m1@example.com>" }) }) },
}));
const fake = await import("./fake-imap");

Object.assign(process.env, {
  MAIL_IMAP_HOST: "imap.example.com", MAIL_SUITE_AUTH: "shared-password", MAIL_DEV_PASSWORD: "x",
  GROUPS_INTERNAL_URL: "http://groups:3830", PROXY_SHARED_SECRET: "gw-secret",
});
delete process.env.MAIL_ADMIN_URL;

// What Groups says; null = unreachable.
let groups: unknown[] | null = [];
const asked: string[] = [];
vi.stubGlobal("fetch", async (u: string, init?: RequestInit) => {
  expect((init?.headers as Record<string, string>)["x-proxy-auth-secret"]).toBe("gw-secret");
  asked.push(String(u));
  if (!groups) throw new Error("connect ECONNREFUSED");
  return new Response(JSON.stringify({ groups }));
});

const { getAccount, listAccounts } = await import("../lib/accounts");
const { forgetMemberships } = await import("../lib/memberships");
const { listFolders, listMessages, createFolder, sendMessage, scopeBoxes, serverPath } = await import("../lib/mailbox");

const ann = "ann@example.com";
const support = { id: "g1", kind: "shared_mailbox", name: "Support", email: "Support@Example.com", role: "member" };

beforeEach(() => {
  forgetMemberships();
  fake.reset();
  sent.length = 0;
  asked.length = 0;
  groups = [support, { id: "g2", kind: "team", name: "Design", email: "design@example.com", role: "owner" },
    { id: "g3", kind: "team", name: "No mailbox", email: null, role: "member" }, { id: "g4", kind: "security", name: "Sec", email: "sec@example.com", role: "member" }];
});

describe("who may open a shared mailbox", () => {
  it("lists the shared mailboxes and team mailboxes the person belongs to", async () => {
    expect(await listAccounts(ann)).toEqual([
      { id: "suite", label: "Mailbox", address: ann, kind: "suite" },
      { id: "shared:support@example.com", label: "Support", address: "support@example.com", kind: "shared" },
      { id: "shared:design@example.com", label: "Design", address: "design@example.com", kind: "shared" },
    ]);
    expect(asked).toEqual([`http://groups:3830/api/svc/memberships?email=${encodeURIComponent(ann)}`]);
    await listAccounts(ann);
    expect(asked).toHaveLength(1); // remembered for a while
  });

  it("opens one for a current member only, through their own login, sending as the group", async () => {
    const acct = await getAccount(ann, "shared:support@example.com", "Ann");
    expect(acct).toMatchObject({
      id: "shared:support@example.com", address: "support@example.com", fromName: "Support",
      auth: { user: ann }, folderRoot: "Shared Folders/support@example.com",
    });
    expect(await getAccount(ann, "shared:sec@example.com")).toBeNull();
    expect(await getAccount(ann, "shared:other@example.com")).toBeNull();
    forgetMemberships();
    groups = [];
    expect(await getAccount(ann, "shared:support@example.com")).toBeNull(); // removed from the group
  });

  it("shows none when Groups can't be reached", async () => {
    groups = null;
    expect((await listAccounts(ann)).map((a) => a.id)).toEqual(["suite"]);
    expect(await getAccount(ann, "shared:support@example.com")).toBeNull();
  });
});

describe("the shared folder tree", () => {
  const box = (path: string, flags: string[] = [], specialUse?: string) =>
    ({ path, name: path.split("/").pop(), delimiter: "/", flags: new Set(flags), specialUse, parent: path.split("/").slice(0, -1) }) as unknown as ListResponse;
  const boxes = [
    box("INBOX", [], "\\Inbox"), box("Sent", [], "\\Sent"), box("Shared Folders", ["\\Noselect"]),
    box("Shared Folders/support@example.com", ["\\Noselect"]), box("Shared Folders/support@example.com/INBOX"),
    box("Shared Folders/support@example.com/Sent Items"), box("Shared Folders/support@example.com/Trash", ["\\Trash"]),
    box("Shared Folders/support@example.com/Projects/2026"), box("Shared Folders/support@example.comx/INBOX"),
    box("Shared Folders/design@example.com/INBOX"),
  ];

  it("keeps only the group's folders, without the prefix, with their roles", () => {
    const scoped = scopeBoxes({ folderRoot: "Shared Folders/support@example.com" }, boxes);
    expect(scoped.map((b) => [b.shown, b.role, b.depth])).toEqual([
      ["INBOX", "\\Inbox", 0], ["Sent Items", "\\Sent", 0], ["Trash", "\\Trash", 0], ["Projects/2026", null, 1],
    ]);
  });

  it("puts every path the browser sends back under the prefix", () => {
    const acct = { folderRoot: "Shared Folders/support@example.com" };
    const scoped = scopeBoxes(acct, boxes);
    expect(serverPath(acct, scoped, "INBOX")).toBe("Shared Folders/support@example.com/INBOX");
    expect(serverPath(acct, scoped, "New")).toBe("Shared Folders/support@example.com/New");
    expect(serverPath(acct, scoped, "../design@example.com/INBOX")).toBe("Shared Folders/support@example.com/../design@example.com/INBOX");
    // The person's own mailbox is untouched.
    expect(scopeBoxes({}, boxes).map((b) => b.shown)).toEqual(boxes.map((b) => b.path));
    expect(serverPath({}, [], "INBOX")).toBe("INBOX");
  });

  it("reads, files and sends through the member's login", async () => {
    const m = fake.mailbox(ann, {
      INBOX: "\\Inbox", Sent: "\\Sent", "Shared Folders/support@example.com/INBOX": undefined, "Shared Folders/support@example.com/Sent Items": undefined,
    });
    m.get("Shared Folders/support@example.com/Sent Items")!.flags = ["\\Sent"];
    fake.deliver(ann, "INBOX", fake.message({ subject: "Mine", from: "x@example.org", to: ann, body: "a" }));
    fake.deliver(ann, "Shared Folders/support@example.com/INBOX", fake.message({ subject: "Help please", from: "x@example.org", to: "support@example.com", body: "b" }));
    const acct = (await getAccount(ann, "shared:support@example.com", "Ann"))!;

    expect((await listFolders(acct)).map((f) => [f.path, f.name, f.role])).toEqual([["INBOX", "Inbox", "\\Inbox"], ["Sent Items", "Sent Items", "\\Sent"]]);
    expect((await listMessages(acct, "INBOX")).messages.map((x) => x.subject)).toEqual(["Help please"]);
    expect(await createFolder(acct, "Escalated")).toBe("Escalated");
    expect(m.has("Shared Folders/support@example.com/Escalated")).toBe(true);

    await sendMessage(acct, { to: ["x@example.org"], subject: "Re: Help please", text: "On it" });
    expect(sent[0]).toMatchObject({ from: { name: "Support", address: "support@example.com" }, transport: { auth: { user: ann } } });
    expect(m.get("Shared Folders/support@example.com/Sent Items")!.msgs).toHaveLength(1);
    expect(m.get("Sent")!.msgs).toHaveLength(0);
  });
});
