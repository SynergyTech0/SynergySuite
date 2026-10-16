import type { ImapFlow } from "imapflow";
import {
  MAX_ATTACHMENT_BYTES, MAX_EXPORT_IDS, type ExportAttachment, type ExportItem, matchesQuery, parseQuery,
  type ParsedQuery, queryToSql, type SearchHit, type SearchRequest, type SearchResponse,
} from "@synergy/compliance";
import { type Account, UserError, getAccount } from "./accounts";
import {
  type Cursor, KIND, type LiveRef, type Ref, SUITE, compareAccounts, dateBounds, decodeCursor, decodeId, encodeCursor, encodeId,
  imapSearch, inRange,
} from "./compliance";
import { q } from "./db";
import { describe, participants, snippet } from "./maildoc";
import { withImap } from "./mailbox";
import { toDate } from "./preserved";
import { listMailboxes } from "./provision";

/**
 * eDiscovery for the Admin center: searching and exporting each custodian's suite mailbox (opened
 * with the master login) and the outside IMAP accounts they connected to Mail (opened with the
 * password they saved), live and in the preserved store. A message found only in the store is one
 * its owner deleted while on hold: it comes back with deleted: true. Hits from an outside account
 * belong to the custodian; the export's metadata names the account.
 *
 * An outside account that no longer signs in (the person revoked or changed the password) or that
 * the person removed from Mail is searched in the preserved store only, with a note saying so.
 */

const SCOPE = "Suite mailboxes and the outside IMAP accounts custodians connected to Mail. An outside account that no longer signs in, or that was removed from Mail, is searched only in what was preserved while its owner was on hold.";
const MAX_MAILBOXES = 1000;
/** Work one request may do before it hands back a cursor, even with fewer hits than asked for. */
const MAX_SCAN = 1500;
const BUDGET_MS = 20_000;

type Response = SearchResponse & { notes: string[] };
/** One account of one mailbox: who it belongs to, and the addresses that are its owner on a message. */
type Box = { mailbox: string; account: string; self: string[] };
type Run = { p: ParsedQuery; bounds: ReturnType<typeof dateBounds>; limit: number; hits: SearchHit[]; scanned: number; deadline: number; notes: string[] };

/**
 * Whether to narrow with IMAP SEARCH TEXT first. Off by default: Stalwart answers TEXT from a
 * word index, so it misses parts of words ("nvoice"), unaccented spellings and attachment names,
 * all of which the suite's keyword language matches. Without it every message in the date range
 * is fetched and matched here: slower, but nothing is silently missed.
 */
const prefilter = () => process.env.MAIL_COMPLIANCE_PREFILTER === "imap";
const spent = (r: Run) => r.scanned >= MAX_SCAN || Date.now() > r.deadline;
const authFailed = (err: unknown) => Boolean((err as { authFailed?: boolean }).authFailed);

export async function search(req: SearchRequest): Promise<Response> {
  const notes = [SCOPE];
  if (req.kinds?.length && !req.kinds.includes(KIND)) return { app: "mail", hits: [], notes };
  const cur = req.cursor ? decodeCursor(req.cursor) : null;
  const run: Run = {
    p: parseQuery(req.query), bounds: dateBounds(req.from, req.to), limit: req.limit ?? 50,
    hits: [], scanned: 0, deadline: Date.now() + BUDGET_MS, notes,
  };
  const all = req.custodians?.length ? [...req.custodians].sort() : await everyMailbox(notes);
  for (const mailbox of all.filter((m) => !cur || m >= cur.m)) {
    const next = await searchMailbox(mailbox, cur?.m === mailbox ? cur : null, run);
    if (next) return { app: "mail", hits: run.hits, nextCursor: encodeCursor(next), notes };
  }
  return { app: "mail", hits: run.hits, notes };
}

/** Without custodians: every mailbox the mail server's admin API lists, everyone who has used Mail or connected an account, and everyone preserved. */
async function everyMailbox(notes: string[]): Promise<string[]> {
  const found = new Set(await listMailboxes(MAX_MAILBOXES) ?? []);
  if (!process.env.MAIL_ADMIN_URL) notes.push("MAIL_ADMIN_URL is not set: searched people who have used Mail and preserved mailboxes.");
  for (const r of await q<{ email: string }>("SELECT email FROM mail_users")) found.add(r.email);
  for (const r of await q<{ owner_email: string }>("SELECT DISTINCT owner_email FROM accounts")) found.add(r.owner_email);
  for (const r of await q<{ mailbox: string }>("SELECT DISTINCT mailbox FROM preserved_messages")) found.add(r.mailbox);
  const sorted = [...found].sort();
  if (sorted.length > MAX_MAILBOXES) notes.push(`Searched the first ${MAX_MAILBOXES} of ${sorted.length} mailboxes; name custodians to search the rest.`);
  return sorted.slice(0, MAX_MAILBOXES);
}

/** Searches one mailbox, account by account, from `resume`; returns where to carry on, or null when the mailbox is done. */
async function searchMailbox(mailbox: string, resume: Cursor | null, run: Run): Promise<Cursor | null> {
  for (const account of (await accountsOf(mailbox)).filter((a) => !resume || compareAccounts(a, resume.a) >= 0)) {
    const next = await searchAccount(mailbox, account, resume?.a === account ? resume : null, run);
    if (next) return next;
  }
  return null;
}

/** The suite mailbox, the outside accounts connected now, and those removed since with mail preserved. */
async function accountsOf(mailbox: string): Promise<string[]> {
  const rows = await q<{ account: string }>(
    "SELECT id::text AS account FROM accounts WHERE owner_email = $1 UNION SELECT account FROM preserve_accounts WHERE mailbox = $1",
    [mailbox],
  );
  return [...new Set([SUITE, ...rows.map((r) => r.account)])].sort(compareAccounts);
}

/** An account's address and name, from Mail if it's still connected, else from when its mail was preserved. */
async function accountInfo(mailbox: string, account: string, acct?: Account | null): Promise<{ id: string; address: string; label: string; removed?: boolean }> {
  if (account === SUITE) return { id: SUITE, address: mailbox, label: "Suite mailbox" };
  if (acct) return { id: account, address: acct.address, label: acct.label };
  const [r] = await q<{ address: string; label: string; connected: boolean }>(
    `SELECT p.address, p.label, EXISTS (SELECT 1 FROM accounts a WHERE a.id::text = p.account AND a.owner_email = p.mailbox) AS connected
       FROM preserve_accounts p WHERE p.mailbox = $1 AND p.account = $2`,
    [mailbox, account],
  );
  return { id: account, address: r?.address ?? "", label: r?.label ?? "", ...(r && !r.connected ? { removed: true } : {}) };
}

/** Searches one account of a mailbox; falls back to the preserved store when it can't be opened. */
async function searchAccount(mailbox: string, account: string, resume: Cursor | null, run: Run): Promise<Cursor | null> {
  const from = resume?.phase === "kept" ? resume.k : 0;
  // A password that can't be decrypted any more is as good as a revoked one.
  const acct = await getAccount(mailbox, account).catch(() => null);
  if (!acct) {
    if (account === SUITE) {
      if (!run.notes.some((n) => n.startsWith("The suite mail server"))) run.notes.push("The suite mail server isn't configured: searched the preserved store only.");
      return searchKept({ mailbox, account, self: [mailbox] }, from, null, run);
    }
    const info = await accountInfo(mailbox, account);
    run.notes.push(`The outside account ${info.address || `#${account}`} of ${mailbox} is no longer connected to Mail; searched what was preserved.`);
    return searchKept({ mailbox, account, self: [mailbox, info.address] }, from, null, run);
  }
  const box: Box = { mailbox, account, self: [mailbox, acct.address.toLowerCase()] };
  let opened = false;
  try {
    return await withImap(acct, async (c) => {
      opened = true;
      if (resume?.phase !== "kept") {
        const next = await searchLive(c, box, resume?.phase === "live" ? resume : null, run);
        if (next) return next;
      }
      return searchKept(box, from, c, run);
    });
  } catch (err) {
    // Failing part-way is an error (the admin searches again); failing to sign in is not. Outside
    // servers may also be unreachable or refused: whatever was preserved is then all there is.
    if (opened || (account === SUITE && !authFailed(err))) throw err;
    run.notes.push(account === SUITE
      ? `Couldn't open the mailbox of ${mailbox}; searched what was preserved.`
      : `Couldn't open ${acct.address}, an outside account of ${mailbox} (${(err as Error).message}); searched what was preserved.`);
    return searchKept(box, from, null, run);
  }
}

async function selectable(c: ImapFlow): Promise<string[]> {
  return (await c.list()).filter((b) => !b.flags.has("\\Noselect") && !b.flags.has("\\NonExistent")).map((b) => b.path).sort();
}

async function searchLive(c: ImapFlow, box: Box, resume: { f: string; u: number } | null, run: Run): Promise<Cursor | null> {
  const { mailbox, account: a } = box;
  const criteria = imapSearch(run.p, run.bounds, prefilter());
  for (const folder of (await selectable(c)).filter((f) => !resume || f >= resume.f)) {
    // u: hand out UIDs below this one (0: from the newest).
    const below = resume?.f === folder ? resume.u : 0;
    if (spent(run)) return { m: mailbox, a, phase: "live", f: folder, u: below };
    const lock = await c.getMailboxLock(folder, { readOnly: true });
    try {
      if (typeof c.mailbox !== "object" || !c.mailbox.exists) continue;
      const uidValidity = String(c.mailbox.uidValidity);
      const uids = (((await c.search(criteria, { uid: true })) || []) as number[])
        .filter((u) => !below || u < below).sort((a, b) => b - a);
      for (let i = 0; i < uids.length; i += 25) {
        const chunk = uids.slice(i, i + 25);
        const msgs = (await c.fetchAll(chunk.join(","), { uid: true, source: true, internalDate: true }, { uid: true })).sort((a, b) => b.uid - a.uid);
        for (const m of msgs) {
          run.scanned++;
          if (m.source) {
            const d = await describe(m.source, toDate(m.internalDate));
            const date = d.date ?? new Date(0);
            if (inRange(date, run.bounds) && matchesQuery(d.searchText, run.p)) {
              run.hits.push({
                id: encodeId({ kind: "live", mailbox, account: a, folder, uidValidity, uid: m.uid, hash: d.hash }),
                kind: KIND, title: d.subject || "(no subject)", owner: mailbox, participants: participants(d, box.self),
                date: date.toISOString(), snippet: snippet(d.body, run.p), size: d.size,
              });
            }
          }
          if (run.hits.length >= run.limit || spent(run)) return { m: mailbox, a, phase: "live", f: folder, u: m.uid };
        }
      }
    } finally {
      lock.release();
    }
  }
  return null;
}

type KeptRow = {
  id: string; hash: string; message_id: string | null; folder: string; uidvalidity: string | null; uid: string | null;
  subject: string; from_addrs: string[]; to_addrs: string[]; cc_addrs: string[]; bcc_addrs: string[];
  sent_at: Date | null; preserved_at: Date; size: number; search_text: string;
};

/** The preserved store, by row id, skipping what is still in the live account (already handed out above). */
async function searchKept(box: Box, after: number, c: ImapFlow | null, run: Run): Promise<Cursor | null> {
  const { mailbox, account: a } = box;
  const where = queryToSql(run.p, ["search_text"], 6);
  const folders = c ? await selectable(c) : [];
  for (;;) {
    const rows = await q<KeptRow>(
      `SELECT id, hash, message_id, folder, uidvalidity, uid, subject, from_addrs, to_addrs, cc_addrs, bcc_addrs,
              sent_at, preserved_at, size, search_text
         FROM preserved_messages
        WHERE mailbox = $1 AND account = $2 AND id > $3
          AND ($4::timestamptz IS NULL OR coalesce(sent_at, to_timestamp(0)) >= $4)
          AND ($5::timestamptz IS NULL OR coalesce(sent_at, to_timestamp(0)) <= $5)
          AND ${where.sql}
        ORDER BY id LIMIT 50`,
      [mailbox, a, after, run.bounds.from, run.bounds.to, ...where.params],
    );
    if (!rows.length) return null;
    const live = c ? await stillLive(c, folders, rows) : new Set<string>();
    for (const r of rows) {
      after = Number(r.id);
      run.scanned++;
      if (!live.has(r.id)) {
        const d = { from: r.from_addrs, to: r.to_addrs, cc: r.cc_addrs, bcc: r.bcc_addrs };
        run.hits.push({
          id: encodeId({ kind: "kept", mailbox, account: a, hash: r.hash }),
          kind: KIND, title: r.subject || "(no subject)", owner: mailbox, participants: participants(d, box.self),
          date: (r.sent_at ?? new Date(0)).toISOString(), snippet: snippet(r.search_text, run.p), size: r.size, deleted: true,
        });
      }
      if (run.hits.length >= run.limit || spent(run)) return { m: mailbox, a, phase: "kept", k: after };
    }
  }
}

/**
 * Which preserved rows are still in the mailbox: by Message-ID in any folder (so a message moved
 * from a phone still counts), or for mail without one, by the folder and UID it was last seen at.
 * Message-IDs come from fetching each folder's envelopes: Stalwart's SEARCH HEADER doesn't match
 * Message-ID at all, so asking the server to look them up would call everything deleted.
 */
async function stillLive(c: ImapFlow, folders: string[], rows: KeptRow[]): Promise<Set<string>> {
  const live = new Set<string>();
  const byMessageId = new Map<string, string[]>();
  for (const r of rows) if (r.message_id) byMessageId.set(r.message_id, [...(byMessageId.get(r.message_id) ?? []), r.id]);
  const byPlace = new Map<string, string>();
  for (const r of rows) if (!r.message_id && r.uid && r.uidvalidity) byPlace.set(`${r.folder}\n${r.uidvalidity}\n${r.uid}`, r.id);
  for (const folder of folders) {
    if (!byMessageId.size && !byPlace.size) break;
    await inFolder(c, folder, async () => {
      if (typeof c.mailbox !== "object" || !c.mailbox.exists) return;
      const uidValidity = String(c.mailbox.uidValidity);
      for await (const m of c.fetch("1:*", { uid: true, envelope: true })) {
        const id = m.envelope?.messageId;
        if (id && byMessageId.has(id)) {
          byMessageId.get(id)!.forEach((rowId) => live.add(rowId));
          byMessageId.delete(id);
        }
        const place = byPlace.get(`${folder}\n${uidValidity}\n${m.uid}`);
        if (place) live.add(place);
      }
    });
  }
  return live;
}

/** Runs fn with the folder open read-only; a folder that no longer exists is skipped. */
async function inFolder(c: ImapFlow, folder: string, fn: () => Promise<void>): Promise<void> {
  let lock;
  try {
    lock = await c.getMailboxLock(folder, { readOnly: true });
  } catch {
    return;
  }
  try {
    await fn();
  } finally {
    lock.release();
  }
}

// ---------- export ----------

export function parseExportRequest(body: unknown): Ref[] {
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || !ids.length) throw new UserError("ids must be a non-empty list");
  if (ids.length > MAX_EXPORT_IDS) throw new UserError(`At most ${MAX_EXPORT_IDS} ids per export`);
  return ids.map((id) => {
    const ref = decodeId(id);
    if (!ref) throw new UserError(`Bad id: ${String(id).slice(0, 80)}`);
    return ref;
  });
}

type Source = {
  raw: Buffer; internalDate: Date | null; deleted: boolean;
  where: Record<string, unknown>;
};
type AccountInfo = Awaited<ReturnType<typeof accountInfo>>;

/**
 * Full copies of messages, in the order asked. A live message that has since gone (or changed
 * under the same UID), or whose outside account can't be opened any more, is taken from the
 * preserved store when it's there; ids found nowhere are left out.
 */
export async function exportItems(refs: Ref[]): Promise<ExportItem[]> {
  const sources = new Map<Ref, Source>();
  const accounts = new Map<string, AccountInfo>();
  const byAccount = new Map<string, Ref[]>();
  for (const r of refs) {
    const key = `${r.mailbox}\n${r.account}`;
    byAccount.set(key, [...(byAccount.get(key) ?? []), r]);
  }
  for (const [key, list] of byAccount) {
    const { mailbox, account } = list[0];
    const live = list.filter((r): r is LiveRef => r.kind === "live");
    const acct = await getAccount(mailbox, account).catch(() => null);
    accounts.set(key, await accountInfo(mailbox, account, acct));
    if (acct && live.length) {
      await withImap(acct, async (c) => {
        for (const r of live) {
          await inFolder(c, r.folder, async () => {
            if (typeof c.mailbox !== "object" || String(c.mailbox.uidValidity) !== r.uidValidity) return;
            const m = await c.fetchOne(String(r.uid), { uid: true, source: true, internalDate: true, flags: true }, { uid: true });
            if (!m || !m.source) return;
            const d = await describe(m.source);
            if (d.hash !== r.hash) return;
            sources.set(r, {
              raw: m.source, internalDate: toDate(m.internalDate), deleted: false,
              where: { source: "mailbox", folder: r.folder, uid: r.uid, uidValidity: r.uidValidity, flags: [...(m.flags ?? [])] },
            });
          });
        }
      }).catch((err) => {
        // An outside account that can't be opened (or drops) leaves the preserved store to answer.
        if (account === SUITE && !authFailed(err)) throw err;
      });
    }
    const missing = list.filter((r) => !sources.has(r));
    if (!missing.length) continue;
    const rows = await q<{ hash: string; raw: Buffer; folder: string; folders: string[]; preserved_at: Date; deleted_at: Date | null }>(
      "SELECT hash, raw, folder, folders, preserved_at, deleted_at FROM preserved_messages WHERE mailbox = $1 AND account = $2 AND hash = ANY($3::text[])",
      [mailbox, account, missing.map((r) => r.hash)],
    );
    const byHash = new Map(rows.map((r) => [r.hash, r]));
    for (const r of missing) {
      const row = byHash.get(r.hash);
      if (!row) continue;
      sources.set(r, {
        raw: row.raw, internalDate: null, deleted: true,
        where: { source: "preserved", folder: row.folder, folders: row.folders, preservedAt: row.preserved_at.toISOString(), deletedAt: row.deleted_at?.toISOString() ?? null },
      });
    }
  }
  const out: ExportItem[] = [];
  for (const r of refs) {
    const s = sources.get(r);
    if (s) out.push(await toItem(r, s, accounts.get(`${r.mailbox}\n${r.account}`)!));
  }
  return out;
}

const attachment = (name: string, type: string, content: Buffer): ExportAttachment =>
  content.length > MAX_ATTACHMENT_BYTES
    ? { name, type, size: content.length, skipped: `larger than ${MAX_ATTACHMENT_BYTES} bytes` }
    : { name, type, size: content.length, base64: content.toString("base64") };

async function toItem(ref: Ref, s: Source, account: AccountInfo): Promise<ExportItem> {
  const d = await describe(s.raw, s.internalDate);
  const p = d.parsed;
  const date = d.date ?? new Date(0);
  const addresses = (a: typeof p.from | typeof p.to) => (Array.isArray(a) ? a : a ? [a] : []).map((x) => x.text);
  const emlName = `${(d.subject || "message").replace(/[^\w .-]+/g, "_").slice(0, 80).trim() || "message"}.eml`;
  return {
    app: "mail",
    id: encodeId(ref),
    kind: KIND,
    title: d.subject || "(no subject)",
    owner: ref.mailbox,
    participants: participants(d, [ref.mailbox, account.address.toLowerCase()]),
    date: date.toISOString(),
    snippet: snippet(d.body, { groups: [], none: [] }),
    size: d.size,
    ...(s.deleted ? { deleted: true } : {}),
    metadata: {
      ...s.where,
      mailbox: ref.mailbox,
      // Which of the custodian's accounts it came from: the suite mailbox or an outside account.
      account,
      subject: d.subject,
      messageId: d.messageId,
      inReplyTo: p.inReplyTo ?? null,
      references: ([] as string[]).concat(p.references ?? []),
      from: addresses(p.from), to: addresses(p.to), cc: addresses(p.cc), bcc: addresses(p.bcc), replyTo: addresses(p.replyTo),
      sha256: d.hash,
      headers: p.headerLines.map((h) => h.line),
      scope: SCOPE,
    },
    text: p.text ?? "",
    html: p.html || undefined,
    attachments: [
      attachment(emlName, "message/rfc822", s.raw),
      ...p.attachments.map((a, i) => attachment(a.filename || `attachment-${i + 1}`, a.contentType, a.content)),
    ],
  };
}
