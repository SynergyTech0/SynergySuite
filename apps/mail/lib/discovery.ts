import type { ImapFlow } from "imapflow";
import {
  MAX_ATTACHMENT_BYTES, MAX_EXPORT_IDS, type ExportAttachment, type ExportItem, matchesQuery, parseQuery,
  type ParsedQuery, queryToSql, type SearchHit, type SearchRequest, type SearchResponse,
} from "@synergy/compliance";
import { UserError, getAccount } from "./accounts";
import {
  type Cursor, KIND, type LiveRef, type Ref, dateBounds, decodeCursor, decodeId, encodeCursor, encodeId, imapSearch, inRange,
} from "./compliance";
import { q } from "./db";
import { describe, participants, snippet } from "./maildoc";
import { withImap } from "./mailbox";
import { toDate } from "./preserved";
import { listMailboxes } from "./provision";

/**
 * eDiscovery for the Admin center: searching and exporting suite mailboxes, live on the mail
 * server (opened with the master login) and in the preserved store. A message found only in the
 * store is one its owner deleted while on hold: it comes back with deleted: true.
 *
 * Outside IMAP accounts people connect to Mail are not searched: that mail lives with other
 * providers, and Mail holds only a password the person can revoke.
 */

const SCOPE = "Suite mailboxes only; outside IMAP accounts people connected to Mail are not searched.";
const MAX_MAILBOXES = 1000;
/** Work one request may do before it hands back a cursor, even with fewer hits than asked for. */
const MAX_SCAN = 1500;
const BUDGET_MS = 20_000;

type Response = SearchResponse & { notes: string[] };
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

/** Without custodians: every mailbox the mail server's admin API lists, everyone who has used Mail, and everyone preserved. */
async function everyMailbox(notes: string[]): Promise<string[]> {
  const found = new Set(await listMailboxes(MAX_MAILBOXES) ?? []);
  if (!process.env.MAIL_ADMIN_URL) notes.push("MAIL_ADMIN_URL is not set: searched people who have used Mail and preserved mailboxes.");
  for (const r of await q<{ email: string }>("SELECT email FROM mail_users")) found.add(r.email);
  for (const r of await q<{ mailbox: string }>("SELECT DISTINCT mailbox FROM preserved_messages")) found.add(r.mailbox);
  const sorted = [...found].sort();
  if (sorted.length > MAX_MAILBOXES) notes.push(`Searched the first ${MAX_MAILBOXES} of ${sorted.length} mailboxes; name custodians to search the rest.`);
  return sorted.slice(0, MAX_MAILBOXES);
}

/** Searches one mailbox from `resume`; returns where to carry on, or null when the mailbox is done. */
async function searchMailbox(mailbox: string, resume: Cursor | null, run: Run): Promise<Cursor | null> {
  const acct = await getAccount(mailbox, "suite");
  if (!acct) {
    if (!run.notes.some((n) => n.startsWith("The suite mail server"))) run.notes.push("The suite mail server isn't configured: searched the preserved store only.");
    return searchKept(mailbox, resume?.phase === "kept" ? resume.k : 0, null, run);
  }
  try {
    return await withImap(acct, async (c) => {
      if (resume?.phase !== "kept") {
        const next = await searchLive(c, mailbox, resume?.phase === "live" ? resume : null, run);
        if (next) return next;
      }
      return searchKept(mailbox, resume?.phase === "kept" ? resume.k : 0, c, run);
    });
  } catch (err) {
    // Not (or no longer) a mailbox on the mail server; whatever was preserved is all there is.
    if (!authFailed(err)) throw err;
    run.notes.push(`Couldn't open the mailbox of ${mailbox}; searched what was preserved.`);
    return searchKept(mailbox, resume?.phase === "kept" ? resume.k : 0, null, run);
  }
}

async function selectable(c: ImapFlow): Promise<string[]> {
  return (await c.list()).filter((b) => !b.flags.has("\\Noselect") && !b.flags.has("\\NonExistent")).map((b) => b.path).sort();
}

async function searchLive(c: ImapFlow, mailbox: string, resume: { f: string; u: number } | null, run: Run): Promise<Cursor | null> {
  const criteria = imapSearch(run.p, run.bounds, prefilter());
  for (const folder of (await selectable(c)).filter((f) => !resume || f >= resume.f)) {
    // u: hand out UIDs below this one (0: from the newest).
    const below = resume?.f === folder ? resume.u : 0;
    if (spent(run)) return { m: mailbox, phase: "live", f: folder, u: below };
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
                id: encodeId({ kind: "live", mailbox, folder, uidValidity, uid: m.uid, hash: d.hash }),
                kind: KIND, title: d.subject || "(no subject)", owner: mailbox, participants: participants(d, mailbox),
                date: date.toISOString(), snippet: snippet(d.body, run.p), size: d.size,
              });
            }
          }
          if (run.hits.length >= run.limit || spent(run)) return { m: mailbox, phase: "live", f: folder, u: m.uid };
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

/** The preserved store, by row id, skipping what is still in the live mailbox (already handed out above). */
async function searchKept(mailbox: string, after: number, c: ImapFlow | null, run: Run): Promise<Cursor | null> {
  const where = queryToSql(run.p, ["search_text"], 5);
  const folders = c ? await selectable(c) : [];
  for (;;) {
    const rows = await q<KeptRow>(
      `SELECT id, hash, message_id, folder, uidvalidity, uid, subject, from_addrs, to_addrs, cc_addrs, bcc_addrs,
              sent_at, preserved_at, size, search_text
         FROM preserved_messages
        WHERE mailbox = $1 AND id > $2
          AND ($3::timestamptz IS NULL OR coalesce(sent_at, to_timestamp(0)) >= $3)
          AND ($4::timestamptz IS NULL OR coalesce(sent_at, to_timestamp(0)) <= $4)
          AND ${where.sql}
        ORDER BY id LIMIT 50`,
      [mailbox, after, run.bounds.from, run.bounds.to, ...where.params],
    );
    if (!rows.length) return null;
    const live = c ? await stillLive(c, folders, rows) : new Set<string>();
    for (const r of rows) {
      after = Number(r.id);
      run.scanned++;
      if (!live.has(r.id)) {
        const d = { from: r.from_addrs, to: r.to_addrs, cc: r.cc_addrs, bcc: r.bcc_addrs };
        run.hits.push({
          id: encodeId({ kind: "kept", mailbox, hash: r.hash }),
          kind: KIND, title: r.subject || "(no subject)", owner: mailbox, participants: participants(d, mailbox),
          date: (r.sent_at ?? new Date(0)).toISOString(), snippet: snippet(r.search_text, run.p), size: r.size, deleted: true,
        });
      }
      if (run.hits.length >= run.limit || spent(run)) return { m: mailbox, phase: "kept", k: after };
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

/**
 * Full copies of messages, in the order asked. A live message that has since gone (or changed
 * under the same UID) is taken from the preserved store when it's there; ids found nowhere are left out.
 */
export async function exportItems(refs: Ref[]): Promise<ExportItem[]> {
  const sources = new Map<Ref, Source>();
  const byMailbox = new Map<string, Ref[]>();
  for (const r of refs) byMailbox.set(r.mailbox, [...(byMailbox.get(r.mailbox) ?? []), r]);
  for (const [mailbox, list] of byMailbox) {
    const live = list.filter((r): r is LiveRef => r.kind === "live");
    const acct = live.length ? await getAccount(mailbox, "suite") : null;
    if (acct) {
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
        if (!authFailed(err)) throw err;
      });
    }
    const missing = list.filter((r) => !sources.has(r));
    if (!missing.length) continue;
    const rows = await q<{ hash: string; raw: Buffer; folder: string; folders: string[]; preserved_at: Date; deleted_at: Date | null }>(
      "SELECT hash, raw, folder, folders, preserved_at, deleted_at FROM preserved_messages WHERE mailbox = $1 AND hash = ANY($2::text[])",
      [mailbox, missing.map((r) => r.hash)],
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
    if (s) out.push(await toItem(r, s));
  }
  return out;
}

const attachment = (name: string, type: string, content: Buffer): ExportAttachment =>
  content.length > MAX_ATTACHMENT_BYTES
    ? { name, type, size: content.length, skipped: `larger than ${MAX_ATTACHMENT_BYTES} bytes` }
    : { name, type, size: content.length, base64: content.toString("base64") };

async function toItem(ref: Ref, s: Source): Promise<ExportItem> {
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
    participants: participants(d, ref.mailbox),
    date: date.toISOString(),
    snippet: snippet(d.body, { groups: [], none: [] }),
    size: d.size,
    ...(s.deleted ? { deleted: true } : {}),
    metadata: {
      ...s.where,
      mailbox: ref.mailbox,
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
