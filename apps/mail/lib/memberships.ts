/**
 * The shared mailboxes a person may open, from the Groups app: every shared mailbox and team
 * they belong to (directly or through another group) that has an address. Asked server to
 * server with PROXY_SHARED_SECRET and remembered for half a minute; when Groups isn't
 * reachable, nobody has shared mailboxes until it is.
 */
export type SharedMailbox = { address: string; name: string };
type Membership = { id: string; kind: string; name: string; email?: string | null; role: string };

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; list: SharedMailbox[] }>();

export async function sharedMailboxesOf(email: string): Promise<SharedMailbox[]> {
  const me = email.trim().toLowerCase();
  const hit = cache.get(me);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.list;
  const list = await fetchMemberships(me);
  cache.set(me, { at: Date.now(), list });
  return list;
}

export async function isSharedMailboxMember(email: string, address: string): Promise<SharedMailbox | null> {
  const a = address.trim().toLowerCase();
  return (await sharedMailboxesOf(email)).find((m) => m.address === a) ?? null;
}

/** For tests. */
export function forgetMemberships(): void {
  cache.clear();
}

async function fetchMemberships(email: string): Promise<SharedMailbox[]> {
  const base = process.env.GROUPS_INTERNAL_URL || (process.env.NODE_ENV === "production" ? "http://groups:3830" : "http://localhost:3830");
  const headers: Record<string, string> = {};
  if (process.env.PROXY_SHARED_SECRET) headers["x-proxy-auth-secret"] = process.env.PROXY_SHARED_SECRET;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/svc/memberships?${new URLSearchParams({ email })}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { groups?: Membership[] };
    const seen = new Set<string>();
    const out: SharedMailbox[] = [];
    for (const g of Array.isArray(body.groups) ? body.groups : []) {
      if ((g.kind !== "shared_mailbox" && g.kind !== "team") || typeof g.email !== "string") continue;
      const address = g.email.trim().toLowerCase();
      if (!/^[^@\s/]+@[^@\s/]+$/.test(address) || address === email || seen.has(address)) continue;
      seen.add(address);
      out.push({ address, name: typeof g.name === "string" && g.name.trim() ? g.name.trim() : address });
    }
    return out;
  } catch (err) {
    console.error("[mail] couldn't ask Groups for shared mailboxes:", (err as Error).message);
    return [];
  }
}
