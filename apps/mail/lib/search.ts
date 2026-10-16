import type { ImapFlow, SearchObject } from "imapflow";
import { type ParsedQuery, type SearchResult, type SearchResults, clipText, matchesQuery, snippet } from "@synergy/search";
import { type Account, getAccount, listAccounts } from "./accounts";
import { KIND } from "./compliance";
import { describe } from "./maildoc";
import { withImap } from "./mailbox";
import { toDate } from "./preserved";

/**
 * Suite search for the signed-in person: their own suite mailbox and the outside IMAP accounts
 * they connected to Mail, every folder but Deleted Items and Junk, newest first. Nothing here
 * opens anyone else's mail: each account is opened exactly as Mail opens it for that person.
 *
 * The mail server narrows first (IMAP SEARCH TEXT/OR/NOT from the query), then every candidate
 * is checked with matchesQuery on its subject, people and text, so a server whose idea of a
 * match is looser (stemming, say) never adds a false hit. A word-based server such as Stalwart
 * misses parts of words; that's accepted for personal search (eDiscovery scans everything).
 */

const BUDGET_MS = 3000;
/** Enough of each message for its headers and the start of its text; attachments are cut off. */
const HEAD_BYTES = 64 * 1024;
const SKIP_ROLES = new Set(["\\Trash", "\\Junk"]);

type Hit = SearchResult & { at: number };
type Opts = { parsed: ParsedQuery; limit: number; text: boolean; kinds: string[] };

export async function personalSearch(user: string, name: string, o: Opts): Promise<SearchResults> {
  if (o.kinds.length && !o.kinds.includes(KIND)) return { app: "mail", results: [] };
  const deadline = Date.now() + BUDGET_MS;
  const accounts = await myAccounts(user, name);
  const hits: Hit[] = [];
  const runs = accounts.map((acct) =>
    searchAccount(acct, o, deadline, hits).catch((err) => console.error(`[mail] search skipped ${acct.address}:`, (err as Error).message)));
  // Whatever has come back by the deadline; a slow outside server doesn't hold up the rest.
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([Promise.all(runs), new Promise((r) => (timer = setTimeout(r, BUDGET_MS + 200)))]);
  clearTimeout(timer);
  const results = hits.sort((a, b) => b.at - a.at).slice(0, o.limit).map(({ at: _, ...r }) => r);
  return { app: "mail", results };
}

/** The suite mailbox, then outside accounts. If the account list can't be read, the suite mailbox alone. */
async function myAccounts(user: string, name: string): Promise<Account[]> {
  const suite = await getAccount(user, "suite", name);
  const outside = await listAccounts(user).catch((err) => {
    console.error("[mail] search: couldn't list outside accounts:", (err as Error).message);
    return [];
  });
  const rest = await Promise.all(outside.filter((a) => a.kind === "imap").map((a) => getAccount(user, a.id, name).catch(() => null)));
  return [suite, ...rest].filter((a): a is Account => Boolean(a));
}

const and = (a: SearchObject, b: SearchObject): SearchObject => ({ or: [a], not: { not: b } });

/**
 * The query as an IMAP SEARCH: each group is TEXT (ORed within the group), groups are ANDed, and
 * exclusions are NOT TEXT. imapflow takes one key of each name per object, so parts are chained
 * as `OR (a) NOT NOT (rest)`, which is plain AND.
 */
export function personalImapSearch(p: ParsedQuery): SearchObject {
  const parts: SearchObject[] = [
    ...p.groups.map((g): SearchObject => (g.length === 1 ? { text: g[0] } : { or: g.map((text) => ({ text })) })),
    ...p.none.map((text): SearchObject => ({ not: { text } })),
  ];
  if (!parts.length) return { all: true };
  return parts.reduceRight((rest, part) => and(part, rest));
}

export function messageUrl(account: string, folder: string, uid: number): string {
  return `/?${new URLSearchParams({ account, folder, uid: String(uid) })}`;
}

async function searchAccount(acct: Account, o: Opts, deadline: number, hits: Hit[]): Promise<void> {
  const criteria = personalImapSearch(o.parsed);
  await withImap(acct, async (c) => {
    const folders = (await c.list())
      .filter((b) => !b.flags.has("\\Noselect") && !b.flags.has("\\NonExistent") && !SKIP_ROLES.has(b.specialUse ?? ""))
      .map((b) => b.path);
    for (const folder of folders) {
      if (Date.now() > deadline) return;
      await searchFolder(c, acct, folder, criteria, o, deadline, hits);
    }
  });
}

async function searchFolder(c: ImapFlow, acct: Account, folder: string, criteria: SearchObject, o: Opts, deadline: number, hits: Hit[]) {
  let lock;
  try {
    lock = await c.getMailboxLock(folder, { readOnly: true });
  } catch {
    return; // gone since it was listed
  }
  try {
    if (typeof c.mailbox !== "object" || !c.mailbox.exists) return;
    const uidValidity = String(c.mailbox.uidValidity);
    // Highest UID first is newest arrival first; a folder never needs more than `limit` hits.
    const uids = (((await c.search(criteria, { uid: true })) || []) as number[]).sort((a, b) => b - a);
    let found = 0;
    for (let i = 0; i < uids.length && found < o.limit && Date.now() <= deadline; i += o.limit) {
      const chunk = uids.slice(i, i + o.limit);
      const msgs = await c.fetchAll(chunk.join(","), { uid: true, internalDate: true, source: { maxLength: HEAD_BYTES } }, { uid: true });
      for (const m of msgs.sort((a, b) => b.uid - a.uid)) {
        if (!m.source || found >= o.limit) continue;
        const d = await describe(m.source, toDate(m.internalDate));
        if (!matchesQuery(d.searchText, o.parsed)) continue;
        found++;
        const from = d.parsed.from?.value[0];
        const date = d.date ?? new Date(0);
        hits.push({
          id: `${acct.id}:${folder}:${uidValidity}:${m.uid}`,
          kind: KIND,
          title: d.subject || "(no subject)",
          snippet: snippet(d.body || d.subject, o.parsed),
          date: date.toISOString(),
          url: messageUrl(acct.id, folder, m.uid),
          ...(from ? { person: from.name || from.address || "" } : {}),
          ...(o.text ? { text: clipText(d.body) } : {}),
          at: date.getTime(),
        });
      }
    }
  } finally {
    lock.release();
  }
}
