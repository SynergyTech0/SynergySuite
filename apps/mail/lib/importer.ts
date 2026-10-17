import type { ImapFlow, ListResponse } from "imapflow";
import { type Account, UserError } from "./accounts";
import { withImap } from "./mailbox";

/**
 * Copying mail into a person's suite mailbox for the Admin center's migrations (Microsoft 365 or
 * another IMAP server). The Admin center sends one raw message at a time, on the person's behalf,
 * with where it goes and its read and flag state; this appends it over IMAP keeping the original
 * date, and answers the folder and UID it landed at so later syncs can update or move it.
 */

/** Well-known folders, found by their IMAP special-use flag (created with these names if missing). */
export const ROLES = {
  inbox: { flag: "\\Inbox", name: "INBOX" },
  sent: { flag: "\\Sent", name: "Sent Items" },
  drafts: { flag: "\\Drafts", name: "Drafts" },
  trash: { flag: "\\Trash", name: "Deleted Items" },
  junk: { flag: "\\Junk", name: "Junk Email" },
  archive: { flag: "\\Archive", name: "Archive" },
} as const;
export type Role = keyof typeof ROLES;

/** Where a message goes: under a well-known folder (role), then the folder names below it, top down. */
export type Place = { role?: Role | null; path: string[] };

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ROLES, v);
}

/** Checks a place sent by the caller: at most 20 levels of 1 to 200 characters. */
export function cleanPlace(role: unknown, path: unknown): Place {
  const r = role === undefined || role === null || role === "" ? null : role;
  if (r !== null && !isRole(r)) throw new UserError("Unknown folder role");
  const parts = Array.isArray(path) ? path : [];
  if (parts.length > 20) throw new UserError("Folders nest too deep");
  const clean = parts.map((p) => String(p ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 200));
  if (clean.some((p) => !p)) throw new UserError("A folder name is empty");
  if (!r && !clean.length) return { role: "inbox", path: [] };
  return { role: r, path: clean };
}

/** A folder name can't contain the server's hierarchy separator, so it is replaced. */
export function safeName(name: string, delimiter: string): string {
  return delimiter ? name.split(delimiter).join(delimiter === "-" ? "_" : "-") : name;
}

async function resolve(c: ImapFlow, place: Place): Promise<string> {
  const boxes: ListResponse[] = await c.list();
  const delimiter = boxes.find((b) => b.delimiter)?.delimiter ?? "/";
  const byPath = new Map(boxes.map((b) => [b.path.toLowerCase(), b.path]));
  const ensure = async (path: string): Promise<string> => {
    const have = byPath.get(path.toLowerCase());
    if (have) return have;
    const made = (await c.mailboxCreate(path)).path;
    byPath.set(made.toLowerCase(), made);
    return made;
  };
  let base = "";
  const rest = [...place.path];
  if (place.role) {
    const role = ROLES[place.role];
    base = boxes.find((b) => b.specialUse === role.flag)?.path ?? (await ensure(role.name));
  } else {
    base = await ensure(safeName(rest.shift()!, delimiter));
  }
  for (const name of rest) base = await ensure(`${base}${delimiter}${safeName(name, delimiter)}`);
  return base;
}

export type Imported = { folder: string; uid: number | null };

function flagList(seen: boolean, flagged: boolean, draft = false): string[] {
  return [...(seen ? ["\\Seen"] : []), ...(flagged ? ["\\Flagged"] : []), ...(draft ? ["\\Draft"] : [])];
}

/** Appends one message where it belongs, keeping its date and read/flag state. */
export async function appendMessage(
  acct: Account,
  raw: Buffer,
  place: Place,
  state: { seen: boolean; flagged: boolean; date?: Date | null },
): Promise<Imported> {
  if (!raw.length) throw new UserError("The message is empty");
  if (raw.length > MAX_IMPORT_BYTES) throw new UserError("The message is too large", 413);
  return withImap(acct, async (c) => {
    const folder = await resolve(c, place);
    const date = state.date && !Number.isNaN(state.date.getTime()) ? state.date : undefined;
    const res = await c.append(folder, raw, flagList(state.seen, state.flagged, place.role === "drafts"), date);
    if (!res) throw new UserError("The mail server refused the message", 502);
    return { folder: res.destination || folder, uid: res.uid ?? null };
  });
}

/**
 * Brings a copied message up to date: its read and flag state, and its folder when it was moved
 * at the source. Answers where it is now (the UID changes when it moves); null when it is gone.
 */
export async function updateMessage(
  acct: Account,
  at: { folder: string; uid: number },
  state: { seen: boolean; flagged: boolean },
  moveTo?: Place | null,
): Promise<Imported | null> {
  return withImap(acct, async (c) => {
    const target = moveTo ? await resolve(c, moveTo) : null;
    const lock = await c.getMailboxLock(at.folder);
    try {
      const found = (await c.search({ uid: String(at.uid) }, { uid: true })) || [];
      if (!found.length) return null;
      const range = String(at.uid);
      const want = flagList(state.seen, state.flagged);
      await c.messageFlagsRemove(range, ["\\Seen", "\\Flagged"].filter((f) => !want.includes(f)), { uid: true });
      if (want.length) await c.messageFlagsAdd(range, want, { uid: true });
      if (target && target !== at.folder) {
        const moved = await c.messageMove(range, target, { uid: true });
        return { folder: target, uid: (moved ? moved.uidMap?.get(at.uid) : undefined) ?? null };
      }
      return { folder: at.folder, uid: at.uid };
    } finally {
      lock.release();
    }
  });
}
