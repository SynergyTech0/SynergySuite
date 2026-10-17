import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for Microsoft's sign-in service and Graph v1.0, for the migration tests: the token
 * endpoint, users, mailbox usage report, mail folders and messages (with $value and delta),
 * OneDrive and library items (content download and delta), calendar view delta, contacts,
 * To Do, sites and groups. Every collection read through delta keeps a revision per item, so a
 * delta link returns exactly what changed since it was handed out. It can throttle: every Nth
 * Graph request is answered 429 with Retry-After.
 */

type Rec = Record<string, unknown> & { id: string };
type Versioned = { item: Rec; rev: number; deleted: boolean };

export class Tenant {
  rev = 1;
  private sets = new Map<string, Map<string, Versioned>>();
  users: Rec[] = [];
  raw = new Map<string, Buffer>(); // message id → MIME
  content = new Map<string, Buffer>(); // drive item id → bytes
  drives = new Map<string, string>(); // user id → drive id
  folders = new Map<string, Rec[]>(); // `${user}` or `${user}/${folder}` → child folders
  wellKnown = new Map<string, string>(); // `${user}/${name}` → folder id
  events = new Map<string, Rec>(); // series masters by id
  contactFolders = new Map<string, Rec[]>();
  todoLists = new Map<string, Rec[]>();
  checklist = new Map<string, Rec[]>();
  sites: Rec[] = [];
  siteDrives = new Map<string, Rec[]>();
  groups: { id: string; siteId: string; owners: string[]; members: string[] }[] = [];
  reportCsv: string | null = null;

  set(key: string): Map<string, Versioned> {
    let s = this.sets.get(key);
    if (!s) this.sets.set(key, (s = new Map()));
    return s;
  }

  /** Adds or changes an item in a delta collection. */
  put(key: string, item: Rec): Rec {
    this.set(key).set(item.id, { item, rev: ++this.rev, deleted: false });
    return item;
  }

  remove(key: string, id: string): void {
    const v = this.set(key).get(id);
    if (v) this.set(key).set(id, { ...v, rev: ++this.rev, deleted: true });
  }

  /** Moves an item between collections (a message to another folder keeps its immutable id). */
  move(from: string, to: string, id: string, patch: Record<string, unknown> = {}): void {
    const v = this.set(from).get(id)!;
    this.remove(from, id);
    this.put(to, { ...v.item, ...patch });
  }

  get(key: string, id: string): Rec | undefined {
    const v = this.set(key).get(id);
    return v && !v.deleted ? v.item : undefined;
  }

  live(key: string): Rec[] {
    return [...this.set(key).values()].filter((v) => !v.deleted).map((v) => v.item);
  }

  changes(key: string, since: number): { item: Rec; deleted: boolean }[] {
    return [...this.set(key).values()].filter((v) => v.rev > since && !(since === 0 && v.deleted)).sort((a, b) => a.rev - b.rev);
  }
}

export type FakeGraph = {
  url: string;
  loginUrl: string;
  graphUrl: string;
  tenant: Tenant;
  requests: string[];
  /** Answer every Nth Graph request with 429 (0 = never). */
  throttleEvery: number;
  retryAfter: string;
  throttled: number;
  secret: string;
  close: () => Promise<void>;
};

export async function startFakeGraph(opts: { clientId: string; secret: string; pageSize?: number }): Promise<FakeGraph> {
  const tenant = new Tenant();
  const pageSize = opts.pageSize ?? 2;
  let n = 0;
  const state: FakeGraph = {
    url: "", loginUrl: "", graphUrl: "", tenant, requests: [], throttleEvery: 0, retryAfter: "1", throttled: 0, secret: opts.secret,
    close: async () => {},
  };
  const tokens = new Set<string>();

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString();
    const u = new URL(req.url!, state.url);
    const send = (status: number, data: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(data));
    };
    const fail = (status: number, code: string, message = code) => send(status, { error: { code, message } });

    // ----- sign-in -----
    const tok = u.pathname.match(/^\/login\/([^/]+)\/oauth2\/v2\.0\/token$/);
    if (tok) {
      const p = new URLSearchParams(body);
      if (p.get("grant_type") !== "client_credentials" || p.get("scope") !== `${new URL(state.url).origin}/.default`) return send(400, { error: "invalid_request" });
      if (p.get("client_id") !== opts.clientId) return send(400, { error: "unauthorized_client", error_description: "AADSTS700016: Application not found" });
      if (p.get("client_secret") !== state.secret) return send(401, { error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided." });
      const t = `tok-${Math.random().toString(36).slice(2)}`;
      tokens.add(t);
      return send(200, { token_type: "Bearer", expires_in: 3599, access_token: t });
    }
    if (u.pathname.startsWith("/download/")) {
      const id = decodeURIComponent(u.pathname.slice("/download/".length));
      const b = tenant.content.get(id);
      if (!b) return fail(404, "itemNotFound");
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(b.length) });
      return res.end(b);
    }
    if (!u.pathname.startsWith("/v1.0/")) return fail(404, "notFound");
    const auth = String(req.headers.authorization ?? "");
    if (!tokens.has(auth.replace(/^Bearer /, ""))) return fail(401, "InvalidAuthenticationToken");
    state.requests.push(`${req.method} ${u.pathname}${u.search}`);
    n++;
    if (state.throttleEvery && n % state.throttleEvery === 0) {
      state.throttled++;
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": state.retryAfter });
      return res.end(JSON.stringify({ error: { code: "TooManyRequests", message: "Slow down" } }));
    }
    const path = decodeURIComponent(u.pathname.slice("/v1.0".length));
    const base = `${state.graphUrl}`;

    /** A page of a plain list, with a nextLink while more remain. */
    const list = (items: unknown[]) => {
      const skip = Number(u.searchParams.get("$skiptoken") || 0);
      const out: Record<string, unknown> = { value: items.slice(skip, skip + pageSize) };
      if (skip + pageSize < items.length) {
        const next = new URL(u.toString());
        next.searchParams.set("$skiptoken", String(skip + pageSize));
        out["@odata.nextLink"] = `${base}${next.pathname.slice(5)}${next.search}`;
      }
      return send(200, out);
    };
    /** A page of a delta query over the collection `key`. */
    const delta = (key: string, map: (it: Rec) => Rec = (x) => x) => {
      const since = Number(u.searchParams.get("$deltatoken") || 0);
      const skip = Number(u.searchParams.get("$skiptoken") || 0);
      const all = tenant.changes(key, since).map((c) => (c.deleted ? { id: c.item.id, "@removed": { reason: "deleted" } } : map(c.item)));
      const out: Record<string, unknown> = { value: all.slice(skip, skip + pageSize) };
      const link = new URL(u.toString());
      link.searchParams.delete("$skiptoken");
      link.searchParams.delete("$deltatoken");
      if (skip + pageSize < all.length) {
        link.searchParams.set("$deltatoken", String(since));
        link.searchParams.set("$skiptoken", String(skip + pageSize));
        // Remember the revision this enumeration started at, so changes during paging are not lost.
        link.searchParams.set("$deltatoken", String(since));
        out["@odata.nextLink"] = `${base}${link.pathname.slice(5)}${link.search}`;
      } else {
        link.searchParams.set("$deltatoken", String(tenant.rev));
        out["@odata.deltaLink"] = `${base}${link.pathname.slice(5)}${link.search}`;
      }
      return send(200, out);
    };

    let m: RegExpMatchArray | null;
    if (path === "/users") return list(tenant.users);
    if ((m = path.match(/^\/users\/([^/]+)$/))) {
      const user = tenant.users.find((x) => x.id === m![1]);
      return user ? send(200, user) : fail(404, "Request_ResourceNotFound");
    }
    if (path === "/reports/getMailboxUsageDetail(period='D7')") {
      if (tenant.reportCsv === null) return fail(403, "Forbidden");
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      return res.end(tenant.reportCsv);
    }
    // ----- mail -----
    if ((m = path.match(/^\/users\/([^/]+)\/mailFolders$/))) {
      if (!tenant.folders.has(m[1])) return fail(404, "MailboxNotEnabledForRESTAPI");
      return list(tenant.folders.get(m[1])!);
    }
    if ((m = path.match(/^\/users\/([^/]+)\/mailFolders\/([^/]+)\/childFolders$/))) return list(tenant.folders.get(`${m[1]}/${m[2]}`) ?? []);
    if ((m = path.match(/^\/users\/([^/]+)\/mailFolders\/([^/]+)\/messages\/delta$/))) return delta(`mail/${m[1]}/${m[2]}`);
    if ((m = path.match(/^\/users\/([^/]+)\/mailFolders\/([^/]+)$/))) {
      const id = tenant.wellKnown.get(`${m[1]}/${m[2]}`);
      return id ? send(200, { id }) : fail(404, "ErrorFolderNotFound");
    }
    if ((m = path.match(/^\/users\/([^/]+)\/messages\/([^/]+)\/\$value$/))) {
      const raw = tenant.raw.get(m[2]);
      if (!raw) return fail(404, "ErrorItemNotFound");
      res.writeHead(200, { "Content-Type": "message/rfc822", "Content-Length": String(raw.length) });
      return res.end(raw);
    }
    // ----- files -----
    if ((m = path.match(/^\/users\/([^/]+)\/drive$/))) {
      const d = tenant.drives.get(m[1]);
      if (!d) return fail(404, "ResourceNotFound");
      const used = tenant.live(`drive/${d}`).reduce((s, it) => s + Number(it.size ?? 0), 0);
      return send(200, { id: d, quota: { used } });
    }
    if ((m = path.match(/^\/drives\/([^/]+)\/root\/delta$/))) return delta(`drive/${m[1]}`);
    if ((m = path.match(/^\/drives\/([^/]+)\/items\/([^/]+)\/content$/))) {
      if (!tenant.get(`drive/${m[1]}`, m[2])) return fail(404, "itemNotFound");
      res.writeHead(302, { Location: `${new URL(state.url).origin}/download/${encodeURIComponent(m[2])}` });
      return res.end();
    }
    if ((m = path.match(/^\/drives\/([^/]+)\/items\/([^/]+)$/))) {
      const it = tenant.get(`drive/${m[1]}`, m[2]);
      return it ? send(200, it) : fail(404, "itemNotFound");
    }
    // ----- calendar, contacts, To Do -----
    if ((m = path.match(/^\/users\/([^/]+)\/calendarView\/delta$/))) {
      if (!u.searchParams.get("$deltatoken") && (!u.searchParams.get("startDateTime") || !u.searchParams.get("endDateTime"))) return fail(400, "ErrorInvalidParameter");
      return delta(`cal/${m[1]}`);
    }
    if ((m = path.match(/^\/users\/([^/]+)\/events\/([^/]+)$/))) {
      const e = tenant.events.get(m[2]);
      return e ? send(200, e) : fail(404, "ErrorItemNotFound");
    }
    if ((m = path.match(/^\/users\/([^/]+)\/contacts\/delta$/))) return delta(`contacts/${m[1]}/default`);
    if ((m = path.match(/^\/users\/([^/]+)\/contactFolders$/))) return list(tenant.contactFolders.get(m[1]) ?? []);
    if ((m = path.match(/^\/users\/([^/]+)\/contactFolders\/([^/]+)\/contacts\/delta$/))) return delta(`contacts/${m[1]}/${m[2]}`);
    if ((m = path.match(/^\/users\/([^/]+)\/todo\/lists$/))) return list(tenant.todoLists.get(m[1]) ?? []);
    if ((m = path.match(/^\/users\/([^/]+)\/todo\/lists\/([^/]+)\/tasks\/delta$/))) return delta(`todo/${m[1]}/${m[2]}`);
    if ((m = path.match(/^\/users\/([^/]+)\/todo\/lists\/([^/]+)\/tasks\/([^/]+)\/checklistItems$/))) return list(tenant.checklist.get(m[3]) ?? []);
    // ----- sites and groups -----
    if (path === "/sites") return list(tenant.sites);
    if ((m = path.match(/^\/sites\/([^/]+)\/drives$/))) return list(tenant.siteDrives.get(m[1]) ?? []);
    if (path === "/groups") return list(tenant.groups.map((g) => ({ id: g.id })));
    if ((m = path.match(/^\/groups\/([^/]+)\/sites\/root$/))) {
      const g = tenant.groups.find((x) => x.id === m![1]);
      return g ? send(200, { id: g.siteId }) : fail(404, "itemNotFound");
    }
    if ((m = path.match(/^\/groups\/([^/]+)\/(owners|members)$/))) {
      const g = tenant.groups.find((x) => x.id === m![1]);
      return list((m[2] === "owners" ? g?.owners : g?.members)?.map((mail) => ({ mail })) ?? []);
    }
    return fail(404, "notFound", `fake Graph has no ${path}`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  state.url = `http://127.0.0.1:${port}`;
  state.loginUrl = `${state.url}/login`;
  state.graphUrl = `${state.url}/v1.0`;
  state.close = () => new Promise((r) => server.close(() => r()));
  return state;
}
