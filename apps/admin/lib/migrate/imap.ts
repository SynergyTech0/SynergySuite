import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ImapFlow, type ListResponse } from "imapflow";
import { UserError } from "../util";
import { isFatal, type JobContext } from "./context";
import { SuiteError, type MailPlace } from "./suite";

/**
 * Mail from any IMAP server (Google Workspace, another host, an old Exchange) into a suite
 * mailbox, through the same append path as Microsoft 365. Each folder remembers the last UID
 * copied (per UIDVALIDITY), so a re-run copies only new mail and brings read and flag changes.
 */

export type ImapServer = { host: string; port: number; secure: boolean };

const MAIL_PORTS = new Set([143, 993]);
const ROLE_OF: Record<string, string> = {
  "\\Inbox": "inbox", "\\Sent": "sent", "\\Drafts": "drafts", "\\Trash": "trash", "\\Junk": "junk", "\\Archive": "archive",
};

export function isPrivate(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

const allowPrivate = (env: NodeJS.ProcessEnv = process.env) => env.MIGRATION_ALLOW_PRIVATE_HOSTS === "1";

/** Checks a server before connecting: a mail port, and a public address unless MIGRATION_ALLOW_PRIVATE_HOSTS=1 (an old server on your own network). */
export async function vet(s: ImapServer): Promise<{ host: string; servername?: string }> {
  if (!/^[A-Za-z0-9.:-]{1,253}$/.test(s.host)) throw new UserError("Enter the server's host name");
  if (allowPrivate()) return { host: s.host };
  if (!MAIL_PORTS.has(s.port)) throw new UserError(`Port ${s.port} is not an IMAP port (993 or 143)`);
  const { address } = isIP(s.host) ? { address: s.host } : await lookup(s.host).catch(() => {
    throw new UserError(`Can't find the server ${s.host}`);
  });
  if (isPrivate(address)) throw new UserError(`${s.host} is on a private network; set MIGRATION_ALLOW_PRIVATE_HOSTS=1 to allow that`);
  return { host: address, servername: isIP(s.host) ? undefined : s.host };
}

export async function withSource<T>(s: ImapServer, user: string, pass: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const at = await vet(s);
  const insecure = allowPrivate() && process.env.NODE_ENV !== "production";
  const c = new ImapFlow({
    host: at.host, port: s.port, secure: s.secure, servername: at.servername,
    tls: { servername: at.servername, rejectUnauthorized: !insecure },
    doSTARTTLS: s.secure ? undefined : insecure ? undefined : true,
    auth: { user, pass }, logger: false, disableAutoIdle: true,
  });
  try {
    await c.connect();
  } catch (err) {
    const e = err as Error & { authenticationFailed?: boolean };
    throw new UserError(`Couldn't sign in to ${s.host} as ${user}: ${e.authenticationFailed ? "the server refused the username or password (use an app password if the account has two-step sign-in)" : e.message}`, 502);
  }
  try {
    return await fn(c);
  } finally {
    await c.logout().catch(() => c.close());
  }
}

type SourceFolder = { path: string; place: MailPlace };

/** The folders worth copying, each with where it goes in the suite mailbox. */
export function placeFolders(boxes: ListResponse[]): SourceFolder[] {
  const live = boxes.filter((b) => !b.flags.has("\\Noselect") && !b.flags.has("\\NonExistent") && b.specialUse !== "\\All" && b.specialUse !== "\\Flagged");
  const byPath = new Map(boxes.map((b) => [b.path, b]));
  return live.map((b) => {
    const delim = b.delimiter || "/";
    const parts = b.path.split(delim);
    // The nearest folder up the tree with a role (INBOX/Projects goes under Inbox).
    for (let i = parts.length; i > 0; i--) {
      const anc = byPath.get(parts.slice(0, i).join(delim));
      const role = anc && (anc.specialUse ? ROLE_OF[anc.specialUse] : anc.path.toUpperCase() === "INBOX" ? "inbox" : undefined);
      if (role) return { path: b.path, place: { role, path: parts.slice(i) } };
    }
    // Gmail's "[Gmail]/Important" and friends: drop the "[Gmail]" level.
    const rest = parts[0].startsWith("[") && parts.length > 1 ? parts.slice(1) : parts;
    return { path: b.path, place: { role: null, path: rest } };
  });
}

const flagsKey = (flags: Set<string> | undefined) => `${flags?.has("\\Seen") ? 1 : 0}${flags?.has("\\Flagged") ? 1 : 0}`;

/** Counts a mailbox's messages, for discovery (and to test the login). */
export async function countMessages(s: ImapServer, user: string, pass: string): Promise<{ items: number; folders: number }> {
  return withSource(s, user, pass, async (c) => {
    const boxes = await c.list({ statusQuery: { messages: true } });
    const folders = placeFolders(boxes);
    const set = new Set(folders.map((f) => f.path));
    return { items: boxes.filter((b) => set.has(b.path)).reduce((n, b) => n + (b.status?.messages ?? 0), 0), folders: folders.length };
  });
}

export async function importImapMail(ctx: JobContext, server: ImapServer, login: string, pass: string): Promise<void> {
  await ctx.step("mail", "Reading folders");
  await ctx.suite.provisionMailbox(ctx.who);
  await withSource(server, login, pass, async (c) => {
    const folders = placeFolders(await c.list());
    for (const f of folders) {
      await ctx.step("mail", f.path);
      const lock = await c.getMailboxLock(f.path, { readOnly: true });
      try {
        const mb = c.mailbox;
        if (typeof mb !== "object" || !mb) continue;
        const validity = String(mb.uidValidity);
        const cur = await ctx.cursors.get<{ validity: string; last: number }>("mail", f.path);
        let last = cur.validity === validity ? cur.last ?? 0 : 0;
        const key = (uid: number) => `${f.path}\n${validity}\n${uid}`;

        // Read and flag changes on what was copied before.
        if (last > 0 && mb.exists > 0) {
          for await (const m of c.fetch(`1:${last}`, { uid: true, flags: true }, { uid: true })) {
            const have = await ctx.items.get("mail", key(m.uid));
            if (!have?.target_id || have.version === flagsKey(m.flags)) continue;
            const info = have.info as { folder: string; uid: number | null };
            if (!info.uid) continue;
            try {
              const now = await ctx.suite.mailUpdate(ctx.who, { folder: info.folder, uid: info.uid }, { seen: !!m.flags?.has("\\Seen"), flagged: !!m.flags?.has("\\Flagged") });
              await ctx.items.put("mail", key(m.uid), have.target_id, flagsKey(m.flags), now ? { folder: now.folder, uid: now.uid } : { ...info, goneHere: true });
              if (now) await ctx.copied("mail", "updated");
            } catch (e) {
              if (isFatal(e)) throw e;
              await ctx.failed("mail", `${f.path} #${m.uid}`, e);
            }
          }
        }

        if (!mb.exists) {
          await ctx.cursors.put("mail", f.path, { validity, last });
          continue;
        }
        const fresh: { uid: number; size: number; flags?: Set<string>; date?: Date; subject: string }[] = [];
        for await (const m of c.fetch(`${last + 1}:*`, { uid: true, flags: true, size: true, internalDate: true, envelope: true }, { uid: true })) {
          if (m.uid > last) fresh.push({ uid: m.uid, size: m.size ?? 0, flags: m.flags, date: m.internalDate instanceof Date ? m.internalDate : undefined, subject: m.envelope?.subject ?? "" });
        }
        fresh.sort((a, b) => a.uid - b.uid);
        for (const m of fresh) {
          const label = m.subject || `${f.path} #${m.uid}`;
          if (await ctx.items.get("mail", key(m.uid))) {
            last = m.uid;
            continue;
          }
          try {
            if (m.size > ctx.limits.maxMessageBytes) {
              await ctx.skipped("mail", label, `Larger than ${Math.round(ctx.limits.maxMessageBytes / 1048576)} MB`);
            } else {
              const one = await c.fetchOne(String(m.uid), { source: true }, { uid: true });
              if (!one || !one.source) throw new Error("The server didn't send the message");
              try {
                const at = await ctx.suite.mailAppend(ctx.who, one.source, f.place, {
                  seen: !!m.flags?.has("\\Seen"), flagged: !!m.flags?.has("\\Flagged"), date: m.date?.toISOString() ?? null,
                });
                await ctx.items.put("mail", key(m.uid), `${at.folder}:${at.uid ?? ""}`, flagsKey(m.flags), { folder: at.folder, uid: at.uid });
                await ctx.copied("mail");
              } catch (e) {
                if (!(e instanceof SuiteError && e.tooLarge)) throw e;
                await ctx.skipped("mail", label, "Too large for the suite mailbox");
              }
            }
          } catch (e) {
            if (isFatal(e)) throw e;
            await ctx.failed("mail", label, e);
          }
          last = m.uid;
          await ctx.cursors.put("mail", f.path, { validity, last });
        }
        await ctx.cursors.put("mail", f.path, { validity, last });
      } finally {
        lock.release();
      }
    }
  });
}
