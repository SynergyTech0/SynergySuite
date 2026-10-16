import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "@synergy/compliance";

// Legal hold and eDiscovery against a real Postgres when TEST_DATABASE_URL is set (skipped
// otherwise), with imapflow replaced by an in-memory mail server at the IMAP boundary.
vi.mock("imapflow", async () => ({ ImapFlow: (await import("./fake-imap")).FakeImapFlow }));
const fake = await import("./fake-imap");

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
Object.assign(process.env, {
  MAIL_IMAP_HOST: "imap.example.com", MAIL_SUITE_AUTH: "shared-password", MAIL_DEV_PASSWORD: "x",
  ADMIN_INTERNAL_URL: "http://admin.example.com", COMPLIANCE_TOKEN: "t0ken",
});
delete process.env.MAIL_ADMIN_URL;

const ann = "ann@example.com";
const bob = "bob@example.com";

// What the Admin center says; null = unreachable.
let holds: string[] | null = [ann];
vi.stubGlobal("fetch", async (u: string, init?: RequestInit) => {
  if (!String(u).endsWith("/api/svc/policy") || (init?.headers as Record<string, string>).Authorization !== "Bearer t0ken") throw new Error("unexpected fetch");
  if (!holds) throw new Error("connect ECONNREFUSED");
  return new Response(JSON.stringify({ holds: [{ id: "h1", name: "Matter", custodians: holds, apps: [] }], retention: [], updatedAt: "" }));
});

describe.skipIf(!url)("legal hold", async () => {
  const { q, db } = await import("../lib/db");
  const { sweep, sweepMailbox } = await import("../lib/preserver");
  const { preserveRaw } = await import("../lib/preserved");
  const { search, exportItems } = await import("../lib/discovery");
  const { decodeId } = await import("../lib/compliance");
  const { changeMessages } = await import("../lib/mailbox");
  const { getAccount } = await import("../lib/accounts");
  const { policy } = await import("../lib/policy");

  const count = async (mailbox = ann) => Number((await q<{ n: string }>("SELECT count(*) n FROM preserved_messages WHERE mailbox = $1", [mailbox]))[0].n);
  const msg = (id: string, subject: string, body = "hello", extra: Partial<Parameters<typeof fake.message>[0]> = {}) =>
    fake.message({ id: `${id}@example.com`, subject, from: "Carol <carol@example.com>", to: ann, body, ...extra });
  const all = async (req: Parameters<typeof search>[0]) => {
    const hits: SearchHit[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 100; i++) {
      const page = await search({ ...req, cursor });
      hits.push(...page.hits);
      if (!page.nextCursor) return hits;
      cursor = page.nextCursor;
    }
    throw new Error("cursor never ended");
  };

  beforeAll(async () => {
    await q("SELECT 1");
  });
  beforeEach(async () => {
    await q("TRUNCATE preserved_messages, preserve_mailboxes, preserve_folders, mail_users");
    fake.reset();
    holds = [ann];
    policy().invalidate();
    fake.mailbox(ann);
    fake.mailbox(bob);
    fake.deliver(ann, "INBOX", msg("m1", "Quarterly invoice", "Please pay the invoice by Friday."));
    fake.deliver(ann, "INBOX", msg("m2", "Lunch", "Tacos?"));
    fake.deliver(ann, "Sent", fake.message({ id: "m3@example.com", subject: "Re: invoice", from: ann, to: "carol@example.com", bcc: "dave@example.com", body: "Paid the invoice." }));
    fake.deliver(bob, "INBOX", msg("b1", "Bob's invoice", "Invoice for bob", { to: bob }));
  });
  afterAll(async () => {
    await db().close();
  });

  it("preserves every folder of people on hold, idempotently and incrementally", async () => {
    expect(await sweep()).toEqual([ann]);
    expect(await count()).toBe(3);
    expect(await count(bob)).toBe(0);
    const [row] = await q<{ subject: string; bcc_addrs: string[]; folders: string[]; raw: Buffer }>("SELECT * FROM preserved_messages WHERE message_id = '<m3@example.com>'");
    expect(row).toMatchObject({ subject: "Re: invoice", bcc_addrs: ["dave@example.com"], folders: ["Sent"] });
    expect(row.raw.toString()).toContain("Paid the invoice.");

    // Nothing new: nothing fetched.
    fake.server.fetched = 0;
    expect(await sweepMailbox(ann)).toEqual({ stored: 0, known: 0 });
    expect(fake.server.fetched).toBe(0);

    // One new message: only it is fetched.
    fake.deliver(ann, "INBOX", msg("m4", "New"));
    expect(await sweepMailbox(ann)).toEqual({ stored: 1, known: 0 });
    expect(fake.server.fetched).toBe(1);

    // A message filed into another folder is the same message, now known in both.
    const inbox = fake.server.boxes.get(ann)!.get("INBOX")!;
    fake.deliver(ann, "Trash", inbox.msgs[0].raw);
    expect(await sweepMailbox(ann)).toEqual({ stored: 0, known: 1 });
    expect((await q<{ folders: string[] }>("SELECT folders FROM preserved_messages WHERE message_id = '<m1@example.com>'"))[0].folders).toEqual(["INBOX", "Trash"]);

    // UIDVALIDITY changed: the folder is copied again, which changes nothing.
    inbox.uidValidity = 2n;
    expect(await sweepMailbox(ann)).toEqual({ stored: 0, known: 3 });
    expect(await count()).toBe(4);

    // Directly, too.
    expect(await preserveRaw(ann, inbox.msgs[0].raw, { folder: "INBOX", uidValidity: "2", uid: 1 })).toBe("known");
    expect(await preserveRaw(bob, inbox.msgs[0].raw, { folder: "INBOX", uidValidity: "2", uid: 1 })).toBe("stored");
  });

  it("keeps sweeping known holds while the Admin center is unreachable, and stops when a hold ends", async () => {
    await sweep();
    holds = null;
    fake.deliver(ann, "INBOX", msg("m5", "During outage"));
    expect(await sweep()).toEqual([ann]);
    expect(await count()).toBe(4);
    holds = [bob];
    expect(await sweep({ onlyNew: true })).toEqual([bob]);
    expect(await count(bob)).toBe(1);
    fake.deliver(ann, "INBOX", msg("m6", "After release"));
    expect(await sweep()).toEqual([bob]);
    expect(await count()).toBe(4);
  });

  it("copies before Mail deletes for good, only for people on hold", async () => {
    const annAcct = (await getAccount(ann, "suite"))!;
    const uid = fake.deliver(ann, "INBOX", msg("m7", "Shred me", "secret plan"));
    await changeMessages(annAcct, "INBOX", [uid], { action: "delete" }); // to Trash: copied, not marked deleted
    const trashUid = fake.server.boxes.get(ann)!.get("Trash")!.msgs[0].uid;
    await changeMessages(annAcct, "Trash", [trashUid], { action: "delete" }); // for good
    expect(fake.server.boxes.get(ann)!.get("Trash")!.msgs).toHaveLength(0);
    const rows = await q<{ deleted_at: Date | null }>("SELECT deleted_at FROM preserved_messages WHERE message_id = '<m7@example.com>'");
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_at).toBeInstanceOf(Date);

    const bobAcct = (await getAccount(bob, "suite"))!;
    await changeMessages(bobAcct, "INBOX", [1], { action: "delete" });
    expect(await count(bob)).toBe(0);
  });

  it("refuses to delete when the copy can't be made", async () => {
    const annAcct = (await getAccount(ann, "suite"))!;
    const box = fake.server.boxes.get(ann)!;
    box.delete("Trash");
    vi.spyOn(fake.FakeImapFlow.prototype, "fetchAll").mockRejectedValueOnce(new Error("connection lost"));
    await expect(changeMessages(annAcct, "INBOX", [1], { action: "delete" })).rejects.toThrow();
    expect(box.get("INBOX")!.msgs).toHaveLength(2);
  });

  it("searches live mail and what was deleted while on hold", async () => {
    await sweep();
    // Deleted from a phone, straight on the server.
    const inbox = fake.server.boxes.get(ann)!.get("INBOX")!;
    inbox.msgs.splice(0, 1);

    const hits = await all({ query: "invoice", custodians: [ann] });
    expect(hits.map((h) => [h.title, h.deleted ?? false]).sort()).toEqual([["Quarterly invoice", true], ["Re: invoice", false]]);
    const sent = hits.find((h) => h.title === "Re: invoice")!;
    expect(sent).toMatchObject({ kind: "message", owner: ann, participants: ["carol@example.com", "dave@example.com"] });
    expect(sent.snippet).toContain("Paid the invoice");

    // The same with the fast IMAP prefilter, and exact semantics on top of it.
    process.env.MAIL_COMPLIANCE_PREFILTER = "imap";
    expect((await all({ query: "invoice", custodians: [ann] })).map((h) => h.title).sort()).toEqual(["Quarterly invoice", "Re: invoice"]);
    delete process.env.MAIL_COMPLIANCE_PREFILTER;
    expect((await all({ query: "invoice -friday", custodians: [ann] })).map((h) => h.title)).toEqual(["Re: invoice"]);
    expect((await all({ query: '"pay the invoice"', custodians: [ann] })).map((h) => h.title)).toEqual(["Quarterly invoice"]);
    expect(await all({ query: "invoice", custodians: [ann], kinds: ["file"] })).toEqual([]);
    expect(await all({ query: "invoice", custodians: [ann], to: "2026-02-28" })).toEqual([]);

    // Pages of one give the same hits as one page.
    const paged = await all({ custodians: [ann], limit: 1 });
    const whole = (await search({ custodians: [ann], limit: 200 })).hits;
    expect(paged.map((h) => h.id)).toEqual(whole.map((h) => h.id));
    expect(whole).toHaveLength(3);
  });

  it("finds mailboxes on its own without custodians, and searches preserved mail of mailboxes that are gone", async () => {
    await sweep();
    await q("INSERT INTO mail_users (email) VALUES ($1)", [bob]);
    fake.server.boxes.delete(ann); // account removed from the mail server
    const res = await search({ query: "invoice" });
    expect(res.hits.map((h) => [h.owner, h.deleted ?? false]).sort()).toEqual([[ann, true], [ann, true], [bob, false]]);
    expect(res.notes.join(" ")).toMatch(/Couldn't open the mailbox of ann@example.com/);
    expect(res.notes.join(" ")).toMatch(/outside IMAP accounts/);
  });

  it("exports the raw message and its parts, from the mailbox or the preserved store", async () => {
    await sweep();
    const live = (await search({ query: "tacos", custodians: [ann] })).hits[0];
    const [item] = await exportItems([decodeId(live.id)!]);
    const raw = fake.server.boxes.get(ann)!.get("INBOX")!.msgs[1].raw;
    expect(item).toMatchObject({ app: "mail", title: "Lunch", owner: ann, metadata: { source: "mailbox", folder: "INBOX", messageId: "<m2@example.com>" } });
    expect(item.text).toContain("Tacos?");
    expect(item.attachments![0]).toMatchObject({ name: "Lunch.eml", type: "message/rfc822", size: raw.length });
    expect(Buffer.from(item.attachments![0].base64!, "base64").equals(raw)).toBe(true);
    expect((item.metadata.headers as string[]).some((h) => h.startsWith("Subject: Lunch"))).toBe(true);

    // Gone from the mailbox since the search: the preserved copy is exported instead.
    fake.server.boxes.get(ann)!.get("INBOX")!.msgs.splice(1, 1);
    const [kept] = await exportItems([decodeId(live.id)!]);
    expect(kept).toMatchObject({ deleted: true, metadata: { source: "preserved", folder: "INBOX" } });
    expect(Buffer.from(kept.attachments![0].base64!, "base64").equals(raw)).toBe(true);
  });
});
