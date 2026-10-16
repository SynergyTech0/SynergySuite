import type { ImapFlow } from "imapflow";
import { getAccount } from "./accounts";
import { db, q } from "./db";
import { withImap } from "./mailbox";
import { heldMailboxes } from "./policy";
import { preserveRaw, toDate } from "./preserved";

/**
 * Legal hold for mail. People also read and delete their mail with desktop and phone clients that
 * talk to the mail server directly, so Mail can't rely on catching deletes. Instead, for everyone
 * on hold, this copies every message in every folder into the preserved store (preserved.ts):
 * every few minutes (MAIL_PRESERVE_INTERVAL_MINUTES, default 5), and within a minute of a new hold
 * appearing. Each folder remembers its UIDVALIDITY and the last UID copied, so later passes fetch
 * only new mail; a folder whose UIDVALIDITY changed is copied again (copies are idempotent).
 *
 * Started once per server from instrumentation.ts. Holds are read from the Admin center once per
 * check; when it can't be reached, everyone already being swept stays swept (fails closed).
 * Only one replica sweeps at a time (a Postgres advisory lock). Outside IMAP accounts people
 * connect are not covered: they belong to other providers.
 */

const CHECK_MS = 60_000;
const g = globalThis as unknown as { __mailPreserver?: { timer: NodeJS.Timeout; running: boolean; lastFull: number } };

export function startPreserver(): void {
  if (g.__mailPreserver || !process.env.ADMIN_INTERNAL_URL || !process.env.MAIL_IMAP_HOST) return;
  const state = { running: false, lastFull: 0, timer: setInterval(() => void tick(), CHECK_MS) };
  state.timer.unref();
  g.__mailPreserver = state;
  setTimeout(() => void tick(), 5_000).unref();
}

async function tick(): Promise<void> {
  const state = g.__mailPreserver;
  if (!state || state.running) return;
  state.running = true;
  try {
    const intervalMs = Math.max(1, Number(process.env.MAIL_PRESERVE_INTERVAL_MINUTES) || 5) * 60_000;
    // Half a check of slack, so a 5-minute interval sweeps every 5 checks rather than 6.
    const full = Date.now() - state.lastFull >= intervalMs - CHECK_MS / 2;
    const swept = await sweep({ onlyNew: !full });
    if (full && swept !== null) state.lastFull = Date.now();
  } catch (err) {
    console.error("[mail] hold sweep failed:", (err as Error).message);
  } finally {
    state.running = false;
  }
}

/**
 * Brings the list of held mailboxes up to date and copies their mail. With onlyNew, copies only
 * mailboxes that just went on hold. Returns the mailboxes swept, or null when another replica
 * holds the lock.
 */
export async function sweep(opts: { onlyNew?: boolean; fetchPolicy?: typeof fetch } = {}): Promise<string[] | null> {
  await q("SELECT 1"); // schema
  const lock = await db().pool.connect();
  try {
    const got = await lock.query("SELECT pg_try_advisory_lock(hashtext('mail-preserve')) AS ok");
    if (!got.rows[0].ok) return null;
    try {
      const fresh = await enrol(opts.fetchPolicy);
      const rows = await q<{ mailbox: string }>("SELECT mailbox FROM preserve_mailboxes WHERE released_at IS NULL ORDER BY mailbox");
      const todo = opts.onlyNew ? rows.filter((r) => fresh.includes(r.mailbox)) : rows;
      for (const { mailbox } of todo) {
        try {
          await sweepMailbox(mailbox);
          await q("UPDATE preserve_mailboxes SET swept_at = now() WHERE mailbox = $1", [mailbox]);
        } catch (err) {
          console.error(`[mail] couldn't preserve ${mailbox}:`, (err as Error).message);
        }
      }
      return todo.map((r) => r.mailbox);
    } finally {
      await lock.query("SELECT pg_advisory_unlock(hashtext('mail-preserve'))");
    }
  } finally {
    lock.release();
  }
}

/** Records who is on hold; returns those not already being swept. Keeps everyone when the Admin center can't say. */
async function enrol(doFetch?: typeof fetch): Promise<string[]> {
  const held = await heldMailboxes(doFetch);
  if (!held.ok) return [];
  const before = new Set((await q<{ mailbox: string }>("SELECT mailbox FROM preserve_mailboxes WHERE released_at IS NULL")).map((r) => r.mailbox));
  if (held.mailboxes.length) {
    await q(
      `INSERT INTO preserve_mailboxes (mailbox) SELECT unnest($1::text[])
       ON CONFLICT (mailbox) DO UPDATE SET released_at = NULL, held_since = CASE WHEN preserve_mailboxes.released_at IS NULL THEN preserve_mailboxes.held_since ELSE now() END`,
      [held.mailboxes],
    );
  }
  await q("UPDATE preserve_mailboxes SET released_at = now() WHERE released_at IS NULL AND NOT (mailbox = ANY($1::text[]))", [held.mailboxes]);
  return held.mailboxes.filter((m) => !before.has(m));
}

/** Copies every message of one suite mailbox not copied yet. */
export async function sweepMailbox(mailbox: string): Promise<{ stored: number; known: number }> {
  const acct = await getAccount(mailbox, "suite");
  if (!acct) throw new Error("the suite mail server isn't configured");
  return withImap(acct, async (c) => {
    const count = { stored: 0, known: 0 };
    const boxes = await c.list();
    for (const b of boxes) {
      if (b.flags.has("\\Noselect") || b.flags.has("\\NonExistent")) continue;
      await sweepFolder(c, mailbox, b.path, count);
    }
    return count;
  });
}

async function sweepFolder(c: ImapFlow, mailbox: string, folder: string, count: { stored: number; known: number }): Promise<void> {
  const lock = await c.getMailboxLock(folder, { readOnly: true });
  try {
    if (typeof c.mailbox !== "object") return;
    const uidValidity = String(c.mailbox.uidValidity);
    const [cur] = await q<{ uidvalidity: string; last_uid: string }>(
      "SELECT uidvalidity, last_uid FROM preserve_folders WHERE mailbox = $1 AND folder = $2", [mailbox, folder]);
    let last = cur && cur.uidvalidity === uidValidity ? Number(cur.last_uid) : 0;
    const save = () => q(
      `INSERT INTO preserve_folders (mailbox, folder, uidvalidity, last_uid) VALUES ($1,$2,$3,$4)
       ON CONFLICT (mailbox, folder) DO UPDATE SET uidvalidity = EXCLUDED.uidvalidity, last_uid = EXCLUDED.last_uid`,
      [mailbox, folder, uidValidity, last]);
    // "n:*" also matches the newest message when nothing is newer than n, hence the filter.
    const uids = c.mailbox.exists ? (((await c.search({ uid: `${last + 1}:*` }, { uid: true })) || []) as number[]).filter((u) => u > last).sort((a, b) => a - b) : [];
    for (let i = 0; i < uids.length; i += 20) {
      const chunk = uids.slice(i, i + 20);
      const msgs = (await c.fetchAll(chunk.join(","), { uid: true, source: true, internalDate: true }, { uid: true })).sort((a, b) => a.uid - b.uid);
      const unreadable = msgs.find((m) => !m.source);
      for (const m of msgs) {
        if (!m.source) break;
        count[await preserveRaw(mailbox, m.source, { folder, uidValidity, uid: m.uid }, { internalDate: toDate(m.internalDate) })]++;
      }
      // Messages that vanished between SEARCH and FETCH are gone anyway; one the server
      // wouldn't hand over is tried again next pass.
      last = unreadable ? Math.max(last, unreadable.uid - 1) : chunk[chunk.length - 1];
      await save();
      if (unreadable) return;
    }
    if (!cur || cur.uidvalidity !== uidValidity || !uids.length) await save();
  } finally {
    lock.release();
  }
}
