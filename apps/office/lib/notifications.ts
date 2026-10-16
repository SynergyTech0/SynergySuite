// In-suite notifications for @mentions in comments. A comment that names
// someone ("@ann@example.com") leaves a notification for them, shown under
// the bell in every Office editor and in the document list, linking to the
// comment. Only people who can open the document are told, never the author,
// and only the first time a thread names them.
import { pool, q } from "@/lib/db";
import { docAccess } from "@/lib/access";
import type { Identity } from "@/lib/identity";
import { mentionsIn } from "@/lib/slides/comments";

declare global {
  // eslint-disable-next-line no-var
  var __officeNotifSchema: Promise<void> | undefined;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS office_notifications (
  id          BIGSERIAL PRIMARY KEY,
  org         TEXT NOT NULL,
  recipient   TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'mention',
  doc_id      TEXT NOT NULL,
  thread_id   TEXT,
  actor_email TEXT NOT NULL,
  actor_name  TEXT NOT NULL,
  excerpt     TEXT NOT NULL DEFAULT '',
  read        BOOLEAN NOT NULL DEFAULT false,
  created_ms  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS office_notifications_recipient_idx ON office_notifications(org, recipient, created_ms DESC);
`;

async function ensure(): Promise<void> {
  await q("SELECT 1");
  if (!global.__officeNotifSchema) {
    global.__officeNotifSchema = pool()
      .query(SCHEMA)
      .then(() => undefined)
      .catch((e) => {
        global.__officeNotifSchema = undefined;
        throw e;
      });
  }
  return global.__officeNotifSchema;
}

/** The people a new message names for the first time in its thread, not counting its author (lower case). */
export function newMentions(body: string, before: string[], author: string): string[] {
  const old = new Set(before.flatMap(mentionsIn));
  return mentionsIn(body).filter((e) => e !== author.toLowerCase() && !old.has(e));
}

/** Leave a notification for each person a comment newly mentions who can open the document. Never throws. */
export async function recordMentions(opts: { docId: string; threadId: string; by: Identity; body: string; before?: string[] }): Promise<string[]> {
  try {
    const named = newMentions(opts.body, opts.before || [], opts.by.email);
    if (!named.length) return [];
    await ensure();
    const told: string[] = [];
    const excerpt = opts.body.replace(/\s+/g, " ").slice(0, 280);
    for (const email of named) {
      if (!(await docAccess(opts.docId, { email, name: "", org: opts.by.org }))) continue;
      await q(
        `INSERT INTO office_notifications (org, recipient, kind, doc_id, thread_id, actor_email, actor_name, excerpt, created_ms)
         VALUES ($1,$2,'mention',$3,$4,$5,$6,$7,$8)`,
        [opts.by.org, email, opts.docId, opts.threadId, opts.by.email, opts.by.name || opts.by.email, excerpt, Date.now()],
      );
      told.push(email);
    }
    return told;
  } catch {
    return [];
  }
}

export type Notification = { id: string; kind: string; doc_id: string; doc_kind: string; doc_title: string; thread_id: string | null; actor_email: string; actor_name: string; excerpt: string; read: boolean; created_ms: string };

/** A person's latest notifications (on documents they can still open) and how many are unread. */
export async function notificationsFor(me: Identity, limit = 30): Promise<{ items: Notification[]; unread: number }> {
  await ensure();
  const rows = await q<Notification>(
    `SELECT n.id::text AS id, n.kind, n.doc_id, d.kind AS doc_kind, d.title AS doc_title, n.thread_id, n.actor_email, n.actor_name, n.excerpt, n.read, n.created_ms
       FROM office_notifications n JOIN documents d ON d.id = n.doc_id AND d.org = n.org
      WHERE n.org = $1 AND n.recipient = $2 ORDER BY n.created_ms DESC LIMIT $3`,
    [me.org, me.email.toLowerCase(), limit],
  );
  const items: Notification[] = [];
  for (const r of rows) if (await docAccess(r.doc_id, me)) items.push(r);
  const [{ n }] = await q<{ n: string }>(`SELECT count(*)::text AS n FROM office_notifications WHERE org = $1 AND recipient = $2 AND NOT read`, [me.org, me.email.toLowerCase()]);
  return { items, unread: Number(n) };
}

export async function markRead(me: Identity, ids: string[] | "all"): Promise<void> {
  await ensure();
  if (ids === "all") await q(`UPDATE office_notifications SET read = true WHERE org = $1 AND recipient = $2`, [me.org, me.email.toLowerCase()]);
  else {
    const nums = ids.filter((x) => /^\d{1,18}$/.test(x));
    if (nums.length) await q(`UPDATE office_notifications SET read = true WHERE org = $1 AND recipient = $2 AND id = ANY($3::bigint[])`, [me.org, me.email.toLowerCase(), nums]);
  }
}
