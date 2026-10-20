import { ImapFlow, type ListResponse, type FetchMessageObject } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { parseMsipHeader } from "@synergy/compliance";
import { type Account, type Endpoint, UserError, onSuiteServer, vetEndpoint } from "./accounts";
import { cleanHtml } from "./sanitize";
import { policy } from "./policy";
import { preserveUids } from "./preserved";

// ---------- connections ----------

async function endpoint(acct: Account, e: Endpoint): Promise<Endpoint> {
  // The suite mail server is ours, on the deployment's private network; outside servers are
  // checked every time we connect.
  return onSuiteServer(acct) ? { ...e, allowPlain: true } : vetEndpoint(e);
}

function tlsOptions(e: Endpoint) {
  return { servername: e.servername, rejectUnauthorized: !e.insecureTls };
}

export async function withImap<T>(acct: Account, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const e = await endpoint(acct, acct.imap);
  const client = new ImapFlow({
    host: e.host,
    port: e.port,
    secure: e.secure,
    servername: e.servername,
    tls: tlsOptions(e),
    doSTARTTLS: !e.secure && !e.allowPlain ? true : undefined,
    auth: acct.auth,
    logger: false,
    disableAutoIdle: true,
  });
  try {
    await client.connect();
  } catch (err) {
    const e = err as Error & { authenticationFailed?: boolean };
    const why = !e.authenticationFailed ? e.message
      : "accessToken" in acct.auth ? "Microsoft refused IMAP access (IMAP may be turned off for this mailbox in the Microsoft 365 admin center)"
      : "the server rejected the username or password";
    throw Object.assign(new UserError(`Couldn't sign in to ${acct.address}: ${why}`, 502), { authFailed: Boolean(e.authenticationFailed) });
  }
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

// ---------- folders ----------

export type Folder = { path: string; name: string; role: string | null; unread: number; total: number; depth: number };

const ROLE_ORDER = ["\\Inbox", "\\Drafts", "\\Sent", "\\Archive", "\\Junk", "\\Trash"];

export async function listFolders(acct: Account): Promise<Folder[]> {
  return withImap(acct, async (c) => {
    const boxes = scopeBoxes(acct, await c.list({ statusQuery: { messages: true, unseen: true } }));
    const folders = boxes
      .filter((b) => !b.flags.has("\\Noselect") && !b.flags.has("\\NonExistent"))
      .map((b) => ({
        path: b.shown,
        name: b.role === "\\Inbox" ? "Inbox" : b.name,
        role: b.role,
        unread: b.status?.unseen ?? 0,
        total: b.status?.messages ?? 0,
        depth: b.depth,
      }));
    const rank = (f: Folder) => (f.role && ROLE_ORDER.includes(f.role) ? ROLE_ORDER.indexOf(f.role) : ROLE_ORDER.length);
    return folders.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
  });
}

async function folderByRole(c: ImapFlow, acct: Account, role: string): Promise<string | null> {
  return scopeBoxes(acct, await c.list()).find((b) => b.role === role)?.path ?? null;
}

// ---------- shared mailboxes ----------

/**
 * A shared mailbox is the folder tree under acct.folderRoot in the member's own login. The
 * browser only sees paths inside it with the root taken off ("INBOX", "Sent Items"), and every
 * path it sends back is put under the root again, so nothing outside the tree can be named.
 * Other accounts pass through unchanged.
 */
export type Box = ListResponse & { shown: string; role: string | null; depth: number };

// imapflow picks one folder per role across the whole login, which is the member's own, so the
// shared tree's roles come from its SPECIAL-USE flags or, failing that, its top-level names.
const ROLE_NAMES: Record<string, string> = {
  inbox: "\\Inbox", sent: "\\Sent", "sent items": "\\Sent", drafts: "\\Drafts", trash: "\\Trash",
  "deleted items": "\\Trash", junk: "\\Junk", "junk email": "\\Junk", spam: "\\Junk", archive: "\\Archive",
};

export function scopeBoxes(acct: Pick<Account, "folderRoot">, boxes: ListResponse[]): Box[] {
  const root = acct.folderRoot;
  if (!root) return boxes.map((b) => ({ ...b, shown: b.path, role: b.specialUse ?? null, depth: b.parent.length }));
  const out: Box[] = [];
  for (const b of boxes) {
    const d = b.delimiter || "/";
    const prefix = root + d;
    if (b.path.length <= prefix.length || b.path.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) continue;
    const shown = b.path.slice(prefix.length);
    const parts = shown.split(d);
    const role = ROLE_ORDER.find((r) => b.flags.has(r)) ?? (parts.length === 1 ? ROLE_NAMES[shown.toLowerCase()] ?? null : null);
    out.push({ ...b, shown, role, depth: parts.length - 1 });
  }
  return out;
}

/** The server's path for a path the browser sent, from a scoped LIST (no LIST needed otherwise). */
export function serverPath(acct: Pick<Account, "folderRoot">, boxes: Box[], shown: string): string {
  if (!acct.folderRoot) return shown;
  const found = boxes.find((b) => b.shown === shown);
  if (found) return found.path;
  // Not there (yet): under the root, spelled as the server spells it.
  const any = boxes[0];
  return (any ? any.path.slice(0, any.path.length - any.shown.length) : `${acct.folderRoot}/`) + shown;
}

async function realPath(c: ImapFlow, acct: Account, shown: string): Promise<string> {
  return acct.folderRoot ? serverPath(acct, scopeBoxes(acct, await c.list()), shown) : shown;
}

// ---------- message lists ----------

export type Person = { name: string; address: string };
export type MessageSummary = {
  uid: number;
  subject: string;
  from: Person | null;
  to: Person[];
  date: string | null;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  hasAttachments: boolean;
  size: number;
};

const person = (a?: { name?: string; address?: string }): Person => ({ name: a?.name || "", address: a?.address || "" });

function hasAttachment(node: FetchMessageObject["bodyStructure"]): boolean {
  if (!node) return false;
  if (node.disposition === "attachment") return true;
  return (node.childNodes ?? []).some(hasAttachment);
}

function summarize(m: FetchMessageObject): MessageSummary {
  const env = m.envelope;
  return {
    uid: m.uid,
    subject: env?.subject || "",
    from: env?.from?.[0] ? person(env.from[0]) : null,
    to: (env?.to ?? []).map(person),
    date: (env?.date ?? m.internalDate) ? new Date(env?.date ?? (m.internalDate as Date)).toISOString() : null,
    seen: m.flags?.has("\\Seen") ?? false,
    flagged: m.flags?.has("\\Flagged") ?? false,
    answered: m.flags?.has("\\Answered") ?? false,
    hasAttachments: hasAttachment(m.bodyStructure),
    size: m.size ?? 0,
  };
}

const SUMMARY_QUERY = { uid: true, envelope: true, flags: true, internalDate: true, size: true, bodyStructure: true } as const;

export async function listMessages(
  acct: Account,
  folder: string,
  opts: { page?: number; pageSize?: number; search?: string } = {},
): Promise<{ total: number; messages: MessageSummary[] }> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200);
  const page = Math.max(opts.page ?? 0, 0);
  return withImap(acct, async (c) => {
    const lock = await c.getMailboxLock(await realPath(c, acct, folder), { readOnly: true });
    try {
      const exists = typeof c.mailbox === "object" ? c.mailbox.exists : 0;
      if (!exists) return { total: 0, messages: [] };
      const term = opts.search?.trim();
      if (term) {
        const uids = ((await c.search({ or: [{ subject: term }, { from: term }, { to: term }, { body: term }] }, { uid: true })) || []) as number[];
        const newest = uids.sort((a, b) => b - a);
        const slice = newest.slice(page * pageSize, (page + 1) * pageSize);
        if (!slice.length) return { total: uids.length, messages: [] };
        const msgs = await c.fetchAll(slice.join(","), SUMMARY_QUERY, { uid: true });
        return { total: uids.length, messages: msgs.map(summarize).sort((a, b) => b.uid - a.uid) };
      }
      // Newest first by sequence number: page 0 is the last pageSize messages.
      const hi = exists - page * pageSize;
      if (hi < 1) return { total: exists, messages: [] };
      const lo = Math.max(1, hi - pageSize + 1);
      const msgs = await c.fetchAll(`${lo}:${hi}`, SUMMARY_QUERY);
      return { total: exists, messages: msgs.map(summarize).sort((a, b) => sortKey(b) - sortKey(a)) };
    } finally {
      lock.release();
    }
  });
}

const sortKey = (m: MessageSummary) => (m.date ? Date.parse(m.date) : 0) || m.uid;

// ---------- one message ----------

export type Attachment = { index: number; filename: string; contentType: string; size: number; inline: boolean; cid?: string };
export type MessageDetail = MessageSummary & {
  cc: Person[];
  replyTo: Person[];
  html: string | null;
  text: string;
  remoteImages: boolean;
  attachments: Attachment[];
  messageId: string | null;
  references: string[];
  /** The sensitivity label named in the msip_labels header, as written (see parseMsipHeader). */
  msipLabel: { id: string; name?: string } | null;
};

const people = (a?: AddressObject | AddressObject[]) =>
  (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value.map((v) => person({ name: v.name, address: v.address })));

async function fetchParsed(c: ImapFlow, uid: number): Promise<{ meta: FetchMessageObject; parsed: ParsedMail }> {
  const meta = await c.fetchOne(String(uid), { ...SUMMARY_QUERY, source: true }, { uid: true });
  if (!meta || !meta.source) throw new UserError("That message no longer exists", 404);
  return { meta, parsed: await simpleParser(meta.source) };
}

export async function getMessage(
  acct: Account,
  folder: string,
  uid: number,
  opts: { allowRemoteImages?: boolean; attachmentUrl: (index: number) => string },
): Promise<MessageDetail> {
  return withImap(acct, async (c) => {
    const lock = await c.getMailboxLock(await realPath(c, acct, folder));
    try {
      const { meta, parsed } = await fetchParsed(c, uid);
      if (!meta.flags?.has("\\Seen")) {
        await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        meta.flags?.add("\\Seen");
      }
      const attachments: Attachment[] = parsed.attachments.map((a, index) => ({
        index,
        filename: a.filename || `attachment-${index + 1}`,
        contentType: a.contentType,
        size: a.size,
        inline: a.contentDisposition === "inline" && Boolean(a.cid),
        cid: a.cid,
      }));
      const cids = new Map(attachments.filter((a) => a.cid).map((a) => [a.cid!, opts.attachmentUrl(a.index)]));
      const cleaned = parsed.html ? cleanHtml(parsed.html, { allowRemoteImages: Boolean(opts.allowRemoteImages), cids }) : null;
      return {
        ...summarize(meta),
        cc: people(parsed.cc),
        replyTo: people(parsed.replyTo),
        html: cleaned?.html ?? null,
        remoteImages: cleaned?.blockedRemote ?? false,
        text: parsed.text ?? "",
        attachments: attachments.filter((a) => !(a.cid && cleaned?.usedCids.has(a.cid))),
        messageId: parsed.messageId ?? null,
        references: ([] as string[]).concat(parsed.references ?? []),
        msipLabel: msipLabelOf(parsed),
      };
    } finally {
      lock.release();
    }
  });
}

/** The sensitivity label a message's msip_labels header names (Outlook and Mail write it). */
export function msipLabelOf(parsed: ParsedMail): { id: string; name?: string } | null {
  const v = parsed.headers.get("msip_labels");
  if (typeof v === "string") return parseMsipHeader(v);
  const line = parsed.headerLines.find((h) => h.key === "msip_labels")?.line;
  return line ? parseMsipHeader(line.slice(line.indexOf(":") + 1).replace(/\r?\n[ \t]+/g, " ")) : null;
}

export async function getAttachment(acct: Account, folder: string, uid: number, index: number) {
  return withImap(acct, async (c) => {
    const lock = await c.getMailboxLock(await realPath(c, acct, folder), { readOnly: true });
    try {
      const { parsed } = await fetchParsed(c, uid);
      const a = parsed.attachments[index];
      if (!a) throw new UserError("No such attachment", 404);
      return { filename: a.filename || `attachment-${index + 1}`, contentType: a.contentType, content: a.content };
    } finally {
      lock.release();
    }
  });
}

// ---------- changes ----------

export type Change =
  | { action: "read" | "unread" | "flag" | "unflag" }
  | { action: "move"; to: string }
  | { action: "delete" }
  | { action: "archive" }
  | { action: "junk" };

export async function changeMessages(acct: Account, folder: string, uids: number[], change: Change): Promise<void> {
  if (!uids.length) return;
  const range = uids.join(",");
  await withImap(acct, async (c) => {
    const boxes = acct.folderRoot ? scopeBoxes(acct, await c.list()) : [];
    const real = (shown: string) => serverPath(acct, boxes, shown);
    const lock = await c.getMailboxLock(real(folder));
    try {
      switch (change.action) {
        case "read": await c.messageFlagsAdd(range, ["\\Seen"], { uid: true }); break;
        case "unread": await c.messageFlagsRemove(range, ["\\Seen"], { uid: true }); break;
        case "flag": await c.messageFlagsAdd(range, ["\\Flagged"], { uid: true }); break;
        case "unflag": await c.messageFlagsRemove(range, ["\\Flagged"], { uid: true }); break;
        case "move": await c.messageMove(range, real(change.to), { uid: true }); break;
        case "archive":
        case "junk": {
          const role = change.action === "archive" ? "\\Archive" : "\\Junk";
          const dest = (await folderByRole(c, acct, role)) ?? (await ensureFolder(c, acct, change.action === "archive" ? "Archive" : "Junk"));
          await c.messageMove(range, dest, { uid: true });
          break;
        }
        case "delete": {
          // Like Outlook: delete moves to Deleted Items; deleting from there removes for good.
          const trash = await folderByRole(c, acct, "\\Trash");
          const forGood = !trash || trash === real(folder);
          // Legal hold: keep a copy first (the server may also empty Deleted Items on its own),
          // in the suite mailbox and in outside accounts alike. The hold sweep copies everything
          // anyway; this covers mail newer than its last pass.
          if (await policy().onHold(acct.owner)) await preserveUids(c, acct, folder, uids, forGood);
          if (trash && !forGood) await c.messageMove(range, trash, { uid: true });
          else await c.messageDelete(range, { uid: true });
          break;
        }
      }
    } finally {
      lock.release();
    }
  });
}

async function ensureFolder(c: ImapFlow, acct: Account, name: string): Promise<string> {
  const boxes = scopeBoxes(acct, await c.list());
  const found = boxes.find((b) => b.shown.toLowerCase() === name.toLowerCase());
  if (found) return found.path;
  return (await c.mailboxCreate(serverPath(acct, boxes, name))).path;
}

export async function createFolder(acct: Account, name: string): Promise<string> {
  const clean = name.trim();
  if (!clean || clean.length > 100) throw new UserError("Folder name must be 1 to 100 characters");
  return withImap(acct, async (c) => {
    const path = (await c.mailboxCreate(await realPath(c, acct, clean))).path;
    return acct.folderRoot ? clean : path;
  });
}

// ---------- sending ----------

export type Outgoing = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: { filename: string; contentType?: string; content: Buffer }[];
  /** Extra headers, e.g. msip_labels for the sensitivity label. */
  headers?: Record<string, string>;
};

/** Providers that file a copy in Sent themselves; for everyone else we append it. */
const SAVES_SENT_ITSELF = [/\.gmail\.com$/i, /\.googlemail\.com$/i, /\.office365\.com$/i, /\.outlook\.com$/i];

export async function sendMessage(acct: Account, m: Outgoing): Promise<{ messageId: string }> {
  if (!m.to.length && !m.cc?.length && !m.bcc?.length) throw new UserError("Add at least one recipient");
  const mail = {
    from: acct.fromName ? { name: acct.fromName, address: acct.address } : acct.address,
    to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject,
    html: m.html, text: m.text,
    inReplyTo: m.inReplyTo, references: m.references,
    attachments: m.attachments,
    headers: m.headers,
  };
  const e = await endpoint(acct, acct.smtp);
  const transport = nodemailer.createTransport({
    host: e.host,
    port: e.port,
    secure: e.secure,
    requireTLS: !e.secure && !e.allowPlain,
    tls: tlsOptions(e),
    auth: "accessToken" in acct.auth
      ? { type: "OAuth2", user: acct.auth.user, accessToken: acct.auth.accessToken }
      : { user: acct.auth.user, pass: acct.auth.pass },
  });
  let info;
  try {
    info = await transport.sendMail(mail);
  } catch (err) {
    const why = (err as Error).message;
    // Microsoft 365 turns SMTP sign-in off per tenant or mailbox ("Authenticated SMTP").
    const hint = "accessToken" in acct.auth && /SmtpClientAuthentication|5\.7\.139|5\.7\.3/i.test(why)
      ? " Turn on Authenticated SMTP for this mailbox in the Microsoft 365 admin center (Users, Mail, Manage email apps)." : "";
    throw new UserError(`Sending failed: ${why}${hint}`, 502);
  }
  if (!SAVES_SENT_ITSELF.some((r) => r.test(acct.smtp.host))) {
    // Keep a copy in Sent. Bcc stays in our copy so the sender can see who was included.
    const raw = await new MailComposer({ ...mail, messageId: info.messageId }).compile().build();
    await withImap(acct, async (c) => {
      const sent = (await folderByRole(c, acct, "\\Sent")) ?? (await ensureFolder(c, acct, "Sent"));
      await c.append(sent, raw, ["\\Seen"]);
    }).catch(() => { /* the mail went out; a missing Sent copy is not worth failing the send */ });
  }
  return { messageId: info.messageId };
}
