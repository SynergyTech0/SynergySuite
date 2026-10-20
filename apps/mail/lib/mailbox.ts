import { ImapFlow, type ListResponse, type FetchMessageObject } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { parseMsipHeader } from "@synergy/compliance";
import { type Account, type Endpoint, UserError, onSuiteServer, vetEndpoint } from "./accounts";
import { cleanHtml } from "./sanitize";
import { policy } from "./policy";
import { preserveRaw, preserveUids } from "./preserved";
import * as g from "./graph";

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
  if (acct.graph) throw new UserError(`${acct.address} is opened through Microsoft Graph, which this doesn't support yet`, 501);
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
  if (acct.graph) return graphCall(() => g.listGraphFolders(acct.graph!.mailbox).then((f) => sortFolders(f, true)));
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
    return sortFolders(folders);
  });
}

/** tree: folders come parent before children (Graph), so each subtree moves with its top folder. */
function sortFolders(folders: Folder[], tree = false): Folder[] {
  const rank = (f: Folder) => (f.role && ROLE_ORDER.includes(f.role) ? ROLE_ORDER.indexOf(f.role) : ROLE_ORDER.length);
  // Top-level folders by role then name; a subfolder stays right under its parent (Graph lists them in tree order).
  if (tree) {
    const tops: Folder[][] = [];
    for (const f of folders) (f.depth === 0 || !tops.length ? tops.push([f]) : tops[tops.length - 1].push(f));
    return tops.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].name.localeCompare(b[0].name)).flat();
  }
  return folders.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
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
  if (acct.graph) return graphCall(() => graphMessages(acct.graph!.mailbox, folder, page, pageSize, opts.search?.trim()));
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
  if (acct.graph) return graphCall(() => graphDetail(acct.graph!.mailbox, uid, opts));
  return withImap(acct, async (c) => {
    const lock = await c.getMailboxLock(await realPath(c, acct, folder));
    try {
      const { meta, parsed } = await fetchParsed(c, uid);
      if (!meta.flags?.has("\\Seen")) {
        await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        meta.flags?.add("\\Seen");
      }
      return detailOf(summarize(meta), parsed, opts);
    } finally {
      lock.release();
    }
  });
}

/** What the reading pane shows of a parsed message: sanitized HTML, inline images, attachments, label. */
function detailOf(summary: MessageSummary, parsed: ParsedMail, opts: { allowRemoteImages?: boolean; attachmentUrl: (index: number) => string }): MessageDetail {
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
    ...summary,
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
}

/** The sensitivity label a message's msip_labels header names (Outlook and Mail write it). */
export function msipLabelOf(parsed: ParsedMail): { id: string; name?: string } | null {
  const v = parsed.headers.get("msip_labels");
  if (typeof v === "string") return parseMsipHeader(v);
  const line = parsed.headerLines.find((h) => h.key === "msip_labels")?.line;
  return line ? parseMsipHeader(line.slice(line.indexOf(":") + 1).replace(/\r?\n[ \t]+/g, " ")) : null;
}

export async function getAttachment(acct: Account, folder: string, uid: number, index: number) {
  if (acct.graph) {
    const mailbox = acct.graph.mailbox;
    return graphCall(async () => pickAttachment(await simpleParser(await g.getGraphMime(mailbox, await g.idFor(mailbox, uid))), index));
  }
  return withImap(acct, async (c) => {
    const lock = await c.getMailboxLock(await realPath(c, acct, folder), { readOnly: true });
    try {
      return pickAttachment((await fetchParsed(c, uid)).parsed, index);
    } finally {
      lock.release();
    }
  });
}

function pickAttachment(parsed: ParsedMail, index: number) {
  const a = parsed.attachments[index];
  if (!a) throw new UserError("No such attachment", 404);
  return { filename: a.filename || `attachment-${index + 1}`, contentType: a.contentType, content: a.content };
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
  if (acct.graph) return graphCall(() => graphChange(acct, folder, uids, change));
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
  if (acct.graph) return graphCall(() => g.createGraphFolder(acct.graph!.mailbox, clean));
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
  if (acct.graph) {
    // Graph sends the MIME as composed (headers such as msip_labels included) and files it in Sent Items.
    const raw = await new MailComposer(mail).compile().build();
    await graphCall(() => g.sendGraphMime(acct.graph!.mailbox, raw), "Sending failed: ");
    return { messageId: (await simpleParser(raw)).messageId ?? "" };
  }
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

// ---------- Microsoft Graph mailboxes ----------

/** Graph's errors as errors the user can read. */
async function graphCall<T>(fn: () => Promise<T>, prefix = ""): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof g.GraphError) throw new UserError(prefix + err.message, err.status);
    throw err;
  }
}

function graphSummary(m: g.GraphMessage, uid: number): MessageSummary {
  return {
    uid,
    subject: m.subject || "",
    from: m.from ? g.toPerson(m.from) : null,
    to: (m.toRecipients ?? []).map(g.toPerson),
    date: m.receivedDateTime ?? null,
    seen: Boolean(m.isRead),
    flagged: m.flag?.flagStatus === "flagged",
    answered: false, // Graph doesn't say without an extended property
    hasAttachments: Boolean(m.hasAttachments),
    size: 0,
  };
}

async function graphMessages(mailbox: string, folder: string, page: number, pageSize: number, search?: string) {
  const { total, messages } = await g.listGraphMessages(mailbox, folder, page, pageSize, search);
  const uids = await g.uidsFor(mailbox, messages.map((m) => m.id));
  return { total, messages: messages.map((m, i) => graphSummary(m, uids[i])) };
}

async function graphDetail(mailbox: string, uid: number, opts: { allowRemoteImages?: boolean; attachmentUrl: (index: number) => string }): Promise<MessageDetail> {
  const id = await g.idFor(mailbox, uid);
  const [meta, raw] = await Promise.all([g.getGraphMessage(mailbox, id), g.getGraphMime(mailbox, id)]);
  if (!meta.isRead) {
    await g.patchGraphMessage(mailbox, id, { isRead: true });
    meta.isRead = true;
  }
  return detailOf(graphSummary(meta, uid), await simpleParser(raw), opts);
}

async function graphChange(acct: Account, folder: string, uids: number[], change: Change): Promise<void> {
  const mailbox = acct.graph!.mailbox;
  const ids = await g.idsFor(mailbox, uids);
  const each = (fn: (id: string) => Promise<void>) => Promise.all(ids.map(fn)).then(() => undefined);
  switch (change.action) {
    case "read": case "unread":
      return each((id) => g.patchGraphMessage(mailbox, id, { isRead: change.action === "read" }));
    case "flag": case "unflag":
      return each((id) => g.patchGraphMessage(mailbox, id, { flag: { flagStatus: change.action === "flag" ? "flagged" : "notFlagged" } }));
    case "move":
      return each((id) => g.moveGraphMessage(mailbox, id, change.to));
    case "archive": case "junk":
      // Graph's well-known names work as move destinations.
      return each((id) => g.moveGraphMessage(mailbox, id, change.action === "archive" ? "archive" : "junkemail"));
    case "delete": {
      const trash = (await g.roleIds(mailbox)).get("\\Trash");
      const forGood = !trash || trash === folder;
      // Legal hold: keep a copy first, as for IMAP accounts.
      if (await policy().onHold(acct.owner)) {
        for (const id of ids) {
          await preserveRaw(acct.owner, await g.getGraphMime(mailbox, id), { account: acct.id, folder, uidValidity: null, uid: null }, { deleted: forGood });
        }
      }
      return each((id) => (forGood ? g.deleteGraphMessage(mailbox, id) : g.moveGraphMessage(mailbox, id, "deleteditems")));
    }
  }
}
