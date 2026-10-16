import type { SearchObject } from "imapflow";
import { MAX_PAGE, type ParsedQuery, type SearchRequest } from "@synergy/compliance";
import { UserError } from "./accounts";

/**
 * The pure parts of eDiscovery for Mail: checking what the Admin center sends, turning its
 * keyword language into an IMAP SEARCH, and the ids and cursors it passes back. The work itself
 * is in discovery.ts.
 */

export const KIND = "message";

const isDate = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));
const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");

export function parseSearchRequest(body: unknown): SearchRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new UserError("Expected a JSON object");
  const b = body as Record<string, unknown>;
  if (b.query !== undefined && typeof b.query !== "string") throw new UserError("query must be a string");
  if (b.custodians !== undefined && !strings(b.custodians)) throw new UserError("custodians must be a list of emails");
  if (b.kinds !== undefined && !strings(b.kinds)) throw new UserError("kinds must be a list");
  for (const k of ["from", "to"] as const) if (b[k] !== undefined && b[k] !== "" && !isDate(b[k])) throw new UserError(`${k} must be an ISO date`);
  if (b.limit !== undefined && (typeof b.limit !== "number" || !Number.isInteger(b.limit) || b.limit < 1)) throw new UserError("limit must be a positive integer");
  if (b.cursor !== undefined && b.cursor !== "" && (typeof b.cursor !== "string" || !decodeCursor(b.cursor))) throw new UserError("Bad cursor");
  return {
    query: (b.query as string | undefined) ?? "",
    custodians: [...new Set(((b.custodians as string[] | undefined) ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))],
    from: (b.from as string | undefined) || undefined,
    to: (b.to as string | undefined) || undefined,
    kinds: (b.kinds as string[] | undefined) ?? [],
    limit: Math.min((b.limit as number | undefined) ?? 50, MAX_PAGE),
    cursor: (b.cursor as string | undefined) || undefined,
  };
}

/** The request's from/to as an inclusive range of instants; a bare `to` date covers that whole day. */
export function dateBounds(from?: string, to?: string): { from: Date | null; to: Date | null } {
  const end = to ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to) : null;
  return { from: from ? new Date(from) : null, to: end };
}

export function inRange(d: Date, b: { from: Date | null; to: Date | null }): boolean {
  return (!b.from || d >= b.from) && (!b.to || d <= b.to);
}

const DAY = 86_400_000;
const and = (a: SearchObject, b: SearchObject): SearchObject => ({ or: [a], not: { not: b } });

/**
 * The IMAP SEARCH for the query. Dates always go to the server; keywords only when the fast
 * prefilter is turned on (MAIL_COMPLIANCE_PREFILTER=imap), because on a server whose search is
 * word-based, as Stalwart's is, TEXT drops parts of words and attachment names. Whatever comes
 * back is checked again with matchesQuery on the parsed message.
 *  - each word becomes TEXT (headers and body, which covers subject, addresses and attachment
 *    names); words in a group are ORed, groups are ANDed;
 *  - exclusions are not sent, since a server's idea of "contains" may differ from ours;
 *  - dates become SENTSINCE/SENTBEFORE widened by a day, as IMAP compares dates without time or
 *    time zone.
 * imapflow takes one key of each name per object, so groups are chained as
 * `OR (a) NOT NOT (rest)` (a single-operand OR is just its operand), which is plain AND in IMAP.
 * With prefilter=false only the dates are sent, so every message in range is checked here.
 */
export function imapSearch(p: ParsedQuery, bounds: { from: Date | null; to: Date | null }, prefilter = true): SearchObject {
  const parts: SearchObject[] = [];
  if (bounds.from) parts.push({ sentSince: new Date(Math.floor(bounds.from.getTime() / DAY) * DAY - DAY) });
  if (bounds.to) parts.push({ sentBefore: new Date(Math.floor(bounds.to.getTime() / DAY) * DAY + 2 * DAY) });
  if (prefilter) {
    for (const g of p.groups) parts.push(g.length === 1 ? { text: g[0] } : { or: g.map((text) => ({ text })) });
  }
  if (!parts.length) return { all: true };
  return parts.reduceRight((rest, part) => and(part, rest));
}

// ---------- ids ----------

/** The suite mailbox's account id; outside accounts are numbered by the accounts table. */
export const SUITE = "suite";
const ACCOUNT = /^(suite|\d{1,18})$/;
const isAccount = (v: unknown): v is string => typeof v === "string" && ACCOUNT.test(v);

/** The order a person's accounts are searched in: the suite mailbox, then outside accounts by id. */
export function compareAccounts(a: string, b: string): number {
  if (a === b) return 0;
  if (a === SUITE || b === SUITE) return a === SUITE ? -1 : 1;
  return a.length - b.length || (a < b ? -1 : 1);
}

/** Where a live message is: mailbox, account, folder, UIDVALIDITY, UID and the hash of its source. */
export type LiveRef = { kind: "live"; mailbox: string; account: string; folder: string; uidValidity: string; uid: number; hash: string };
/** A message kept in the preserved store, by mailbox, account and hash. */
export type KeptRef = { kind: "kept"; mailbox: string; account: string; hash: string };
export type Ref = LiveRef | KeptRef;

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const unb64 = (s: string): unknown => {
  try {
    return JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  } catch {
    return null;
  }
};
const HASH = /^[0-9a-f]{64}$/;

/**
 * Ids in the suite mailbox look as they did before outside accounts were searched, so ids the
 * Admin center already holds keep working; an outside account's id is appended.
 */
export function encodeId(r: Ref): string {
  const account = r.account === SUITE ? [] : [r.account];
  return r.kind === "live"
    ? `l.${b64([r.mailbox, r.folder, r.uidValidity, r.uid, r.hash, ...account])}`
    : `p.${b64([r.mailbox, r.hash, ...account])}`;
}

export function decodeId(id: unknown): Ref | null {
  if (typeof id !== "string" || id.length > 2000) return null;
  const v = unb64(id.slice(2));
  if (!Array.isArray(v)) return null;
  if (id.startsWith("l.") && (v.length === 5 || v.length === 6)) {
    const [mailbox, folder, uidValidity, uid, hash, account = SUITE] = v;
    if (typeof mailbox === "string" && typeof folder === "string" && typeof uidValidity === "string"
      && Number.isInteger(uid) && uid > 0 && typeof hash === "string" && HASH.test(hash) && isAccount(account)) {
      return { kind: "live", mailbox, account, folder, uidValidity, uid, hash };
    }
  }
  if (id.startsWith("p.") && (v.length === 2 || v.length === 3)) {
    const [mailbox, hash, account = SUITE] = v;
    if (typeof mailbox === "string" && typeof hash === "string" && HASH.test(hash) && isAccount(account)) return { kind: "kept", mailbox, account, hash };
  }
  return null;
}

// ---------- cursors ----------

/**
 * Where the next page starts. Mailboxes are walked in address order; in each, the accounts in
 * compareAccounts order; in each account, the live folders in path order (newest UID first), then
 * the preserved store by row id.
 *   m: the mailbox; a: the account; f: the folder; u: the last UID handed out there; k: the last store row id.
 * Cursors leave out a for the suite mailbox, as they did before outside accounts were searched.
 */
export type Cursor = { m: string; a: string; phase: "live"; f: string; u: number } | { m: string; a: string; phase: "kept"; k: number };

export const encodeCursor = ({ a, ...rest }: Cursor) => b64(a === SUITE ? rest : { a, ...rest });

export function decodeCursor(s: string): Cursor | null {
  const v = unb64(s) as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || typeof v.m !== "string") return null;
  const a = v.a ?? SUITE;
  if (!isAccount(a)) return null;
  if (v.phase === "live" && typeof v.f === "string" && Number.isInteger(v.u)) return { m: v.m, a, phase: "live", f: v.f, u: v.u as number };
  if (v.phase === "kept" && Number.isInteger(v.k)) return { m: v.m, a, phase: "kept", k: v.k as number };
  return null;
}
