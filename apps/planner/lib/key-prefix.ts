import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { boards } from "@/db/schema";

/**
 * Issue-key prefixes (the PL in PL-42). Jira project keys are unique, and a key that names two
 * different issues defeats the point of having keys, so a prefix is unique within its workspace.
 *
 * Deliberately not a database constraint: every board on the live database was created with the old
 * default "SYN", so a unique index cannot be added without re-keying boards whose keys are already
 * quoted in commits, chats and the mind's refs. New and renamed prefixes are checked here instead.
 */
export const PREFIX = /^[A-Z][A-Z0-9]{1,9}$/;

export function normalisePrefix(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const p = v.trim().toUpperCase();
  return PREFIX.test(p) ? p : null;
}

/** "Product Launch" → "PL", "marketing" → "MAR"; always 2+ characters starting with a letter. */
export function prefixFromTitle(title: string): string {
  const words = title.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => /^[A-Z]/.test(w));
  let p = words.length >= 2 ? words.slice(0, 4).map((w) => w[0]).join("") : (words[0] ?? "").slice(0, 3);
  if (p.length < 2) p = (p + (words[0] ?? "").slice(1) + "BRD").slice(0, 3);
  return p;
}

export async function prefixTaken(workspaceId: string, prefix: string, exceptBoardId?: string) {
  const [row] = await db.select({ id: boards.id }).from(boards).where(
    exceptBoardId
      ? and(eq(boards.workspaceId, workspaceId), eq(boards.keyPrefix, prefix), ne(boards.id, exceptBoardId))
      : and(eq(boards.workspaceId, workspaceId), eq(boards.keyPrefix, prefix)),
  );
  return Boolean(row);
}

/** The title-derived prefix, suffixed with the lowest free number if another board already has it. */
export async function uniquePrefixFor(workspaceId: string, title: string) {
  const base = prefixFromTitle(title);
  if (!(await prefixTaken(workspaceId, base))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base.slice(0, 10 - String(n).length)}${n}`;
    if (!(await prefixTaken(workspaceId, candidate))) return candidate;
  }
  throw new Error("no free key prefix");
}
