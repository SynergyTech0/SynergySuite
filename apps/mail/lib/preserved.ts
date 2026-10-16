import type { ImapFlow } from "imapflow";
import { q } from "./db";
import { describe, hashOf } from "./maildoc";

/**
 * The preserved store: raw copies of the mail of people on legal hold, in Postgres. Keyed by
 * mailbox and the hash of the raw message, so copying the same message again (another sweep, the
 * same message in two folders, a delete after a sweep) only notes where it was last seen.
 *
 * Raw messages are kept as bytea rather than files: Mail already needs Postgres, the server's
 * message size limit keeps rows to tens of megabytes, a copy and its search fields are written in
 * one statement, and backups and replicas get the store without a shared volume.
 */

export type Where = { folder: string; uidValidity: string | null; uid: number | null };

export async function preserveRaw(
  mailbox: string, raw: Buffer, where: Where, opts: { internalDate?: Date | null; deleted?: boolean } = {},
): Promise<"stored" | "known"> {
  const hash = hashOf(raw);
  const seen = await q(
    `UPDATE preserved_messages
        SET folder = $3, uidvalidity = $4, uid = $5,
            folders = CASE WHEN $3::text = ANY(folders) THEN folders ELSE folders || $3::text END,
            deleted_at = CASE WHEN $6::boolean THEN coalesce(deleted_at, now()) ELSE deleted_at END
      WHERE mailbox = $1 AND hash = $2 RETURNING id`,
    [mailbox, hash, where.folder, where.uidValidity, where.uid, Boolean(opts.deleted)],
  );
  if (seen.length) return "known";
  const d = await describe(raw, opts.internalDate);
  const rows = await q(
    `INSERT INTO preserved_messages (mailbox, hash, message_id, folders, folder, uidvalidity, uid, subject,
                                     from_addrs, to_addrs, cc_addrs, bcc_addrs, sent_at, size, search_text, raw, deleted_at)
     VALUES ($1,$2,$3,ARRAY[$4::text],$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, CASE WHEN $16::boolean THEN now() END)
     ON CONFLICT (mailbox, hash) DO NOTHING RETURNING id`,
    [mailbox, hash, d.messageId, where.folder, where.uidValidity, where.uid, d.subject,
     d.from, d.to, d.cc, d.bcc, d.date, d.size, d.searchText, raw, Boolean(opts.deleted)],
  );
  return rows.length ? "stored" : "known"; // lost a race with another copy of the same message
}

/**
 * Copies messages of the folder `c` has open into the store, before Mail deletes them for a
 * person on hold. Throws if any can't be copied, so the delete doesn't happen.
 */
export async function preserveUids(c: ImapFlow, mailbox: string, folder: string, uids: number[], deleted: boolean): Promise<void> {
  const uidValidity = typeof c.mailbox === "object" ? String(c.mailbox.uidValidity) : null;
  for (let i = 0; i < uids.length; i += 20) {
    const chunk = uids.slice(i, i + 20);
    const msgs = await c.fetchAll(chunk.join(","), { uid: true, source: true, internalDate: true }, { uid: true });
    for (const m of msgs) {
      if (!m.source) throw new Error(`message ${m.uid} has no source`);
      await preserveRaw(mailbox, m.source, { folder, uidValidity, uid: m.uid }, { internalDate: toDate(m.internalDate), deleted });
    }
  }
}

export const toDate = (d: Date | string | undefined) => (d ? new Date(d) : null);
