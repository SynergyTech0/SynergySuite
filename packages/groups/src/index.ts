/**
 * Groups for every suite app. The Groups app (apps/groups) is where Microsoft 365-style groups
 * live: teams, distribution lists, shared mailboxes and security groups, each with owners and
 * members (people, or other groups). Apps ask it over the internal network who is in what, with
 * PROXY_SHARED_SECRET like every other server-to-server call; the gateway never forwards
 * /api/svc/ on groups.<domain>, so a browser can't ask.
 *
 * Access lists that grant a group store it as the principal "group:<id>" next to plain emails.
 * principalsFor(email) gives everything one person matches, so a check is one array overlap.
 */

export type GroupKind = "team" | "distribution" | "shared_mailbox" | "security";

export type Membership = {
  id: string;
  kind: GroupKind;
  name: string;
  /** The group's address; empty for a group with none (security groups, teams without mail). */
  email: string;
  /** "owner" when the person owns the group itself; membership through a nested group is "member". */
  role: "owner" | "member";
};

export type GroupDetail = {
  id: string;
  kind: GroupKind;
  name: string;
  email: string;
  privacy: "private" | "public";
  /** Lower-case emails. Nested groups are flattened; members include the owners. */
  owners: string[];
  members: string[];
};

export type GroupsClientOptions = {
  /** The Groups app on the internal network. Default GROUPS_INTERNAL_URL, else http://groups:3830 in production, http://localhost:3830 otherwise. */
  url?: string;
  secret?: string;
  /** How long answers are reused, in milliseconds (default 30 s). 0 turns caching off. */
  ttlMs?: number;
  fetch?: typeof fetch;
};

export const GROUP_PREFIX = "group:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "group:<id>" for an access list. */
export function groupPrincipal(id: string): string {
  if (!UUID.test(id)) throw new Error(`not a group id: ${id}`);
  return GROUP_PREFIX + id.toLowerCase();
}

/** The group id in a "group:<id>" principal, or null for anything else (a person's email). */
export function groupIdOf(principal: string): string | null {
  if (!principal.startsWith(GROUP_PREFIX)) return null;
  const id = principal.slice(GROUP_PREFIX.length);
  return UUID.test(id) ? id.toLowerCase() : null;
}

export function groupsInternalUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.GROUPS_INTERNAL_URL) return env.GROUPS_INTERNAL_URL.replace(/\/+$/, "");
  return env.NODE_ENV === "production" ? "http://groups:3830" : "http://localhost:3830";
}

export class GroupsUnavailable extends Error {}

export type GroupsClient = {
  /** Every group the person is in, directly or through a nested group. */
  groupsOf(email: string): Promise<Membership[]>;
  /** A group's owners and flattened members; null when there is no such group. */
  groupMembers(id: string): Promise<GroupDetail | null>;
  isGroupMember(id: string, email: string): Promise<boolean>;
  /** The person's email and "group:<id>" for each of their groups, for matching access lists. */
  principalsFor(email: string): Promise<string[]>;
  /** Forget cached answers, e.g. right after changing a group. */
  clear(): void;
};

export function createGroupsClient(opts: GroupsClientOptions = {}): GroupsClient {
  const ttl = opts.ttlMs ?? 30_000;
  const cache = new Map<string, { at: number; value: Promise<unknown> }>();

  async function get<T>(path: string): Promise<T | null> {
    const base = opts.url ?? groupsInternalUrl();
    const secret = opts.secret ?? process.env.PROXY_SHARED_SECRET ?? "";
    const f = opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(`${base}${path}`, {
        headers: secret ? { "x-proxy-auth-secret": secret } : {},
        signal: AbortSignal.timeout(5000),
        redirect: "manual",
      });
    } catch {
      throw new GroupsUnavailable("The Groups app didn't answer");
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new GroupsUnavailable(`The Groups app answered ${res.status}`);
    return (await res.json()) as T;
  }

  function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (ttl > 0 && hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
    const value = load();
    cache.set(key, { at: Date.now(), value });
    // A failed answer is not kept, so the next call asks again.
    value.catch(() => cache.get(key)?.value === value && cache.delete(key));
    return value;
  }

  const client: GroupsClient = {
    groupsOf(email) {
      const e = email.trim().toLowerCase();
      return cached(`of:${e}`, async () => (await get<{ groups: Membership[] }>(`/api/svc/memberships?email=${encodeURIComponent(e)}`))?.groups ?? []);
    },
    groupMembers(id) {
      if (!UUID.test(id)) return Promise.resolve(null);
      return cached(`g:${id.toLowerCase()}`, () => get<GroupDetail>(`/api/svc/groups/${id.toLowerCase()}`));
    },
    async isGroupMember(id, email) {
      const g = await client.groupMembers(id);
      return !!g && g.members.includes(email.trim().toLowerCase());
    },
    async principalsFor(email) {
      const e = email.trim().toLowerCase();
      return [e, ...(await client.groupsOf(e)).map((g) => GROUP_PREFIX + g.id)];
    },
    clear() {
      cache.clear();
    },
  };
  return client;
}

let shared: GroupsClient | undefined;

/** One client per process, configured from the environment. */
export function groups(): GroupsClient {
  return (shared ??= createGroupsClient());
}

export const groupsOf = (email: string) => groups().groupsOf(email);
export const groupMembers = (id: string) => groups().groupMembers(id);
export const isGroupMember = (id: string, email: string) => groups().isGroupMember(id, email);
export const principalsFor = (email: string) => groups().principalsFor(email);
