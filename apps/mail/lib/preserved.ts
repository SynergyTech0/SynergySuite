import type { ImapFlow } from "imapflow";
import type { Account } from "./accounts";
import { q } from "./db";
import { describe, hashOf } from "./maildoc";

/**
 * The preserved store: raw copies of the mail of people on legal hold, in Postgres. Keyed by
 * mailbox (the person), account (their suite mailbox, "suite", or an outside account's id) and the
 * hash of the raw message, so copying the same message again (another sweep, the same message in
 * two folders, a delete after a sweep) only notes where it was last seen.
 *
 * Raw messages are kept as bytea rather than files: Mail already needs Postgres, the server's
 * message size limit keeps rows to tens of megabytes, a copy and its search fields are written in
 * one statement, and backups and replicas get the store without a shared volume.
 */

/** Where a message was seen; account defaults to the suite mailbox. */
export type Where = { account?: string; folder: string; uidValidity: string | null; uid: number | null };

export async function preserveRaw(
  mailbox: string, raw: Buffer, where: Where, opts: { internalDate?: Date | null; deleted?: boolean } = {},
): Promise<"stored" | "known"> {
  const hash = hashOf(raw);
  const account = where.account ?? "suite";
  const seen = await q(
    `UPDATE preserved_messages
        SET folder = $3, uidvalidity = $4, uid = $5,
            folders = CASE WHEN $3::text = ANY(folders) THEN folders ELSE folders || $3::text END,
            deleted_at = CASE WHEN $6::boolean THEN coalesce(deleted_at, now()) ELSE deleted_at END
      WHERE mailbox = $1 AND hash = $2 AND account = $7 RETURNING id`,
    [mailbox, hash, where.folder, where.uidValidity, where.uid, Boolean(opts.deleted), account],
  );
  if (seen.length) return "known";
  const d = await describe(raw, opts.internalDate);
  const rows = await q(
    `INSERT INTO preserved_messages (mailbox, hash, message_id, folders, folder, uidvalidity, uid, subject,
                                     from_addrs, to_addrs, cc_addrs, bcc_addrs, sent_at, size, search_text, raw, deleted_at, account)
     VALUES ($1,$2,$3,ARRAY[$4::text],$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, CASE WHEN $16::boolean THEN now() END, $17)
     ON CONFLICT (mailbox, account, hash) DO NOTHING RETURNING id`,
    [mailbox, hash, d.messageId, where.folder, where.uidValidity, where.uid, d.subject,
     d.from, d.to, d.cc, d.bcc, d.date, d.size, d.searchText, raw, Boolean(opts.deleted), account],
  );
  return rows.length ? "stored" : "known"; // lost a race with another copy of the same message
}

/** Remembers an outside account's address and name, so its preserved mail can be named after it's removed. */
export async function noteAccount(acct: Account): Promise<void> {
  if (acct.id === "suite") return;
  await q(
    `INSERT INTO preserve_accounts (mailbox, account, address, label) VALUES ($1,$2,$3,$4)
     ON CONFLICT (mailbox, account) DO UPDATE SET address = EXCLUDED.address, label = EXCLUDED.label, removed_at = NULL`,
    [acct.owner, acct.id, acct.address, acct.label],
  );
}

/**
 * Copies messages of the folder `c` has open into the store, before Mail deletes them for a
 * person on hold (the account's owner). Throws if any can't be copied, so the delete doesn't happen.
 */
export async function preserveUids(c: ImapFlow, acct: Account, folder: string, uids: number[], deleted: boolean): Promise<void> {
  const uidValidity = typeof c.mailbox === "object" ? String(c.mailbox.uidValidity) : null;
  await noteAccount(acct);
  for (let i = 0; i < uids.length; i += 20) {
    const chunk = uids.slice(i, i + 20);
    const msgs = await c.fetchAll(chunk.join(","), { uid: true, source: true, internalDate: true }, { uid: true });
    for (const m of msgs) {
      if (!m.source) throw new Error(`message ${m.uid} has no source`);
      await preserveRaw(acct.owner, m.source, { account: acct.id, folder, uidValidity, uid: m.uid }, { internalDate: toDate(m.internalDate), deleted });
    }
  }
}

export const toDate = (d: Date | string | undefined) => (d ? new Date(d) : null);
