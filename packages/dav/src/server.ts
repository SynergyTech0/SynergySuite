// CalDAV (RFC 4791) and CardDAV (RFC 6352) over an app's own storage. The app supplies a
// backend: the collections a person has and their objects as iCalendar or vCard text; this
// module speaks the protocol: discovery (/.well-known, current-user-principal, home sets),
// PROPFIND, REPORT (calendar-query, multiget, sync-collection), GET/PUT/DELETE with ETags and
// If-Match/If-None-Match, and Basic sign-in. It is framework-free: Express and Next both hand
// it a plain request and send back what it returns.
import { NS, XNode, child, childrenOf, clark, document, el, esc, parseXml } from "./xml";

export type DavKind = "calendar" | "addressbook";

export type Collection = {
  id: string;
  displayName: string;
  description?: string;
  /** "#RRGGBB" */
  color?: string;
  readOnly: boolean;
  /** Changes whenever anything in the collection changes; a non-negative integer as a string. */
  syncToken: string;
};

export type ObjectMeta = { name: string; etag: string; lastModified?: Date };
export type DavObject = ObjectMeta & { data: string };
export type Changes = { token: string; changed: ObjectMeta[]; removed: string[] };

export interface DavBackend {
  collections(user: string): Promise<Collection[]>;
  /** Every object, or (calendars) the ones with an occurrence overlapping the range. */
  list(user: string, collection: string, range?: { start?: Date; end?: Date }): Promise<ObjectMeta[]>;
  get(user: string, collection: string, names: string[]): Promise<DavObject[]>;
  /** Stores `data` under `name`; `existing` is what is there now (null for a new object). */
  put(user: string, collection: string, name: string, data: string, existing: ObjectMeta | null): Promise<ObjectMeta>;
  remove(user: string, collection: string, name: string): Promise<void>;
  /** What changed after `since` (a token this collection handed out), or null if it is unknown. */
  changes(user: string, collection: string, since: string): Promise<Changes | null>;
}

/** Thrown by a backend to answer with a status, e.g. 403 for a read-only object, 415 for bad data. */
export class DavError extends Error {
  constructor(public status: number, message: string, public precondition?: string) {
    super(message);
  }
}

export type DavRequest = {
  method: string;
  /** Path and query, as received. */
  url: string;
  /** Lower-case header names. */
  headers: Record<string, string | string[] | undefined>;
  body: string;
  ip?: string;
};
export type DavResponse = { status: number; headers: Record<string, string>; body: string };

export type DavOptions = {
  kind: DavKind;
  backend: DavBackend;
  /** Checks a Basic sign-in; returns the person's email, or null. */
  authenticate(username: string, password: string, ip: string): Promise<string | null>;
  realm: string;
  /** Where the DAV tree lives (default "/dav"). */
  root?: string;
};

const SYNC_PREFIX = "urn:synergy:sync:";
const STATUS: Record<number, string> = {
  200: "OK", 201: "Created", 204: "No Content", 207: "Multi-Status", 301: "Moved Permanently", 400: "Bad Request",
  401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 409: "Conflict",
  412: "Precondition Failed", 413: "Payload Too Large", 415: "Unsupported Media Type", 500: "Internal Server Error",
  501: "Not Implemented", 507: "Insufficient Storage",
};
const statusLine = (n: number) => `HTTP/1.1 ${n} ${STATUS[n] ?? ""}`.trim();

/** Methods a DAV handler answers; anything else on its paths gets 405. */
export const DAV_METHODS = ["OPTIONS", "PROPFIND", "PROPPATCH", "REPORT", "GET", "HEAD", "PUT", "DELETE", "MKCOL", "MKCALENDAR", "MOVE", "COPY", "LOCK", "UNLOCK"];

type Target =
  | { type: "root" }
  | { type: "principals" }
  | { type: "principal"; email: string }
  | { type: "home"; email: string }
  | { type: "collection"; email: string; coll: string }
  | { type: "object"; email: string; coll: string; name: string };

const header = (req: DavRequest, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

const encEmail = (e: string) => encodeURIComponent(e).replace(/%40/g, "@");

export function createDavHandler(opts: DavOptions) {
  const root = (opts.root ?? "/dav").replace(/\/$/, "");
  const cal = opts.kind === "calendar";
  const homeSeg = cal ? "calendars" : "addressbooks";
  const wellKnown = cal ? "/.well-known/caldav" : "/.well-known/carddav";
  const contentType = cal ? "text/calendar; charset=utf-8" : "text/vcard; charset=utf-8";

  const principalHref = (e: string) => `${root}/principals/${encEmail(e)}/`;
  const homeHref = (e: string) => `${root}/${homeSeg}/${encEmail(e)}/`;
  const collHref = (e: string, c: string) => `${homeHref(e)}${encodeURIComponent(c)}/`;
  const objHref = (e: string, c: string, n: string) => `${collHref(e, c)}${encodeURIComponent(n)}`;

  /** Does this request belong to the DAV handler? */
  function matches(method: string, path: string): boolean {
    const p = path.split("?")[0];
    if (p === wellKnown || p === `${root}` || p.startsWith(`${root}/`)) return true;
    // Clients that are given only the server name ask the root for the principal.
    return p === "/" && (method === "PROPFIND" || method === "REPORT");
  }

  function parsePath(path: string): Target | null {
    const p = path.split("?")[0];
    if (p === "/" || p === root || p === `${root}/`) return { type: "root" };
    if (!p.startsWith(`${root}/`)) return null;
    let segs: string[];
    try {
      segs = p.slice(root.length + 1).split("/").filter(Boolean).map(decodeURIComponent);
    } catch {
      return null;
    }
    if (segs[0] === "principals") {
      if (segs.length === 1) return { type: "principals" };
      if (segs.length === 2) return { type: "principal", email: segs[1].toLowerCase() };
      return null;
    }
    if (segs[0] !== homeSeg || segs.length < 2 || segs.length > 4) return null;
    const email = segs[1].toLowerCase();
    if (segs.length === 2) return { type: "home", email };
    if (segs.length === 3) return { type: "collection", email, coll: segs[2] };
    return { type: "object", email, coll: segs[2], name: segs[3] };
  }

  function respond(status: number, body = "", headers: Record<string, string> = {}): DavResponse {
    return { status, body, headers: body && !headers["content-type"] ? { "content-type": "text/plain; charset=utf-8", ...headers } : headers };
  }
  function multistatus(responses: string[], extra = ""): DavResponse {
    return {
      status: 207,
      headers: { "content-type": "application/xml; charset=utf-8" },
      body: document(el("{DAV:}multistatus", responses.join("") + extra)),
    };
  }
  function errorXml(status: number, precondition: string): DavResponse {
    return { status, headers: { "content-type": "application/xml; charset=utf-8" }, body: document(el("{DAV:}error", el(precondition))) };
  }

  const davHeader = cal ? "1, 3, access-control, calendar-access" : "1, 3, access-control, addressbook";
  const allow = "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT";

  async function signIn(req: DavRequest): Promise<string | null> {
    const auth = header(req, "authorization") ?? "";
    const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(auth);
    if (!m) return null;
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon < 1) return null;
    const user = decoded.slice(0, colon).trim().toLowerCase();
    const pass = decoded.slice(colon + 1);
    if (!user || !pass || user.length > 320 || pass.length > 200) return null;
    const email = await opts.authenticate(user, pass, req.ip ?? "");
    return email ? email.toLowerCase() : null;
  }

  // ---- properties ----

  type PropValues = Map<string, string>;
  const privileges = (readOnly: boolean) =>
    el("{DAV:}privilege", el("{DAV:}read")) +
    (readOnly ? "" : el("{DAV:}privilege", el("{DAV:}write")) + el("{DAV:}privilege", el("{DAV:}write-content")) +
      el("{DAV:}privilege", el("{DAV:}write-properties")) + el("{DAV:}privilege", el("{DAV:}bind")) + el("{DAV:}privilege", el("{DAV:}unbind"))) +
    el("{DAV:}privilege", el("{DAV:}read-current-user-privilege-set"));
  const reports = (names: string[]) =>
    names.map((n) => el("{DAV:}supported-report", el("{DAV:}report", el(n)))).join("");
  const href = (h: string) => el("{DAV:}href", esc(h));

  function common(me: string): PropValues {
    return new Map([
      ["{DAV:}current-user-principal", href(principalHref(me))],
      ["{DAV:}principal-collection-set", href(`${root}/principals/`)],
    ]);
  }

  function rootProps(me: string): PropValues {
    const p = common(me);
    p.set("{DAV:}resourcetype", el("{DAV:}collection"));
    p.set("{DAV:}displayname", "");
    return p;
  }

  function principalProps(me: string): PropValues {
    const p = common(me);
    p.set("{DAV:}resourcetype", el("{DAV:}principal") + el("{DAV:}collection"));
    p.set("{DAV:}displayname", esc(me));
    p.set("{DAV:}principal-URL", href(principalHref(me)));
    p.set("{DAV:}owner", href(principalHref(me)));
    p.set("{DAV:}alternate-URI-set", href(`mailto:${me}`));
    p.set("{DAV:}group-membership", "");
    p.set("{DAV:}supported-report-set", reports(["{DAV:}expand-property", "{DAV:}principal-property-search"]));
    p.set("{DAV:}current-user-privilege-set", privileges(true));
    p.set(`{${NS.CS}}email-address-set`, el(`{${NS.CS}}email-address`, esc(me)));
    if (cal) {
      p.set(`{${NS.CALDAV}}calendar-home-set`, href(homeHref(me)));
      p.set(`{${NS.CALDAV}}calendar-user-address-set`, href(`mailto:${me}`));
      p.set(`{${NS.CALDAV}}calendar-user-type`, "INDIVIDUAL");
    } else {
      p.set(`{${NS.CARDDAV}}addressbook-home-set`, href(homeHref(me)));
      p.set(`{${NS.CARDDAV}}principal-address`, "");
    }
    return p;
  }

  function homeProps(me: string): PropValues {
    const p = common(me);
    p.set("{DAV:}resourcetype", el("{DAV:}collection"));
    p.set("{DAV:}displayname", esc(me));
    p.set("{DAV:}owner", href(principalHref(me)));
    p.set("{DAV:}current-user-privilege-set", privileges(true));
    if (cal) p.set(`{${NS.CALDAV}}calendar-home-set`, href(homeHref(me)));
    else p.set(`{${NS.CARDDAV}}addressbook-home-set`, href(homeHref(me)));
    return p;
  }

  function collectionProps(me: string, c: Collection): PropValues {
    const p = common(me);
    const token = SYNC_PREFIX + c.syncToken;
    p.set("{DAV:}resourcetype", el("{DAV:}collection") + (cal ? el(`{${NS.CALDAV}}calendar`) : el(`{${NS.CARDDAV}}addressbook`)));
    p.set("{DAV:}displayname", esc(c.displayName));
    p.set("{DAV:}owner", href(principalHref(me)));
    p.set("{DAV:}current-user-privilege-set", privileges(c.readOnly));
    p.set("{DAV:}sync-token", esc(token));
    p.set(`{${NS.CS}}getctag`, esc(token));
    p.set("{DAV:}supported-report-set", reports(cal
      ? [`{${NS.CALDAV}}calendar-query`, `{${NS.CALDAV}}calendar-multiget`, "{DAV:}sync-collection"]
      : [`{${NS.CARDDAV}}addressbook-query`, `{${NS.CARDDAV}}addressbook-multiget`, "{DAV:}sync-collection"]));
    if (cal) {
      p.set(`{${NS.CALDAV}}supported-calendar-component-set`, `<cal:comp name="VEVENT"/>`);
      p.set(`{${NS.CALDAV}}supported-calendar-data`, `<cal:calendar-data content-type="text/calendar" version="2.0"/>`);
      p.set(`{${NS.CALDAV}}calendar-description`, esc(c.description ?? ""));
      p.set(`{${NS.CALDAV}}max-resource-size`, String(1024 * 1024));
      if (c.color) p.set(`{${NS.ICAL}}calendar-color`, esc(c.color));
    } else {
      p.set(`{${NS.CARDDAV}}supported-address-data`, `<card:address-data-type content-type="text/vcard" version="3.0"/>`);
      p.set(`{${NS.CARDDAV}}addressbook-description`, esc(c.description ?? ""));
      p.set(`{${NS.CARDDAV}}max-resource-size`, String(4 * 1024 * 1024));
    }
    return p;
  }

  function objectProps(me: string, o: ObjectMeta, data?: string): PropValues {
    const p = common(me);
    p.set("{DAV:}resourcetype", "");
    p.set("{DAV:}getetag", esc(o.etag));
    p.set("{DAV:}getcontenttype", esc(cal ? "text/calendar; charset=utf-8; component=VEVENT" : "text/vcard; charset=utf-8"));
    if (o.lastModified) p.set("{DAV:}getlastmodified", o.lastModified.toUTCString());
    if (data != null) {
      p.set(cal ? `{${NS.CALDAV}}calendar-data` : `{${NS.CARDDAV}}address-data`, esc(data));
      p.set("{DAV:}getcontentlength", String(Buffer.byteLength(data)));
    }
    return p;
  }

  /** The property names a PROPFIND or REPORT asked for; null for allprop. */
  function requested(container: XNode | undefined): string[] | null {
    const prop = child(container, NS.DAV, "prop");
    if (!prop) return null;
    return prop.children.map(clark);
  }

  const ALLPROP = ["{DAV:}resourcetype", "{DAV:}displayname", "{DAV:}getetag", "{DAV:}getcontenttype", "{DAV:}sync-token", "{DAV:}getlastmodified"];

  function response(h: string, values: PropValues, names: string[] | null, brief: boolean, propname = false): string {
    const want = names ?? ALLPROP.filter((n) => values.has(n));
    if (propname) {
      return el("{DAV:}response", href(h) + el("{DAV:}propstat", el("{DAV:}prop", [...values.keys()].map((n) => el(n)).join("")) + el("{DAV:}status", statusLine(200))));
    }
    const found: string[] = [];
    const missing: string[] = [];
    for (const n of want) {
      if (values.has(n)) found.push(el(n, values.get(n)!));
      else missing.push(el(n));
    }
    let body = href(h);
    if (found.length) body += el("{DAV:}propstat", el("{DAV:}prop", found.join("")) + el("{DAV:}status", statusLine(200)));
    if (missing.length && !brief) body += el("{DAV:}propstat", el("{DAV:}prop", missing.join("")) + el("{DAV:}status", statusLine(404)));
    if (!found.length && (!missing.length || brief)) body += el("{DAV:}propstat", el("{DAV:}prop", "") + el("{DAV:}status", statusLine(200)));
    return el("{DAV:}response", body);
  }

  const notFound = (h: string) => el("{DAV:}response", href(h) + el("{DAV:}status", statusLine(404)));

  // ---- handlers ----

  async function collectionOf(me: string, id: string): Promise<Collection | undefined> {
    return (await opts.backend.collections(me)).find((c) => c.id === id);
  }

  async function propfind(req: DavRequest, me: string, t: Target, path: string): Promise<DavResponse> {
    const body = parseXml(req.body);
    if (req.body.trim() && !body) return respond(400, "Bad XML");
    const names = body && body.name === "propfind" ? requested(body) : null;
    const propname = Boolean(body && child(body, NS.DAV, "propname"));
    const depth = (header(req, "depth") ?? "1").trim() === "0" ? 0 : 1;
    const brief = /^t$/i.test(header(req, "brief") ?? "") || /return=minimal/i.test(header(req, "prefer") ?? "");
    const out: string[] = [];
    const self = path.split("?")[0];

    switch (t.type) {
      case "root":
        out.push(response(self.endsWith("/") ? self : `${self}/`, rootProps(me), names, brief, propname));
        if (depth && self !== "/") out.push(response(`${root}/principals/`, rootProps(me), names, brief, propname));
        break;
      case "principals":
        out.push(response(`${root}/principals/`, rootProps(me), names, brief, propname));
        if (depth) out.push(response(principalHref(me), principalProps(me), names, brief, propname));
        break;
      case "principal":
        out.push(response(principalHref(t.email), principalProps(me), names, brief, propname));
        break;
      case "home": {
        out.push(response(homeHref(me), homeProps(me), names, brief, propname));
        if (depth) for (const c of await opts.backend.collections(me)) out.push(response(collHref(me, c.id), collectionProps(me, c), names, brief, propname));
        break;
      }
      case "collection": {
        const c = await collectionOf(me, t.coll);
        if (!c) return respond(404, "No such collection");
        out.push(response(collHref(me, c.id), collectionProps(me, c), names, brief, propname));
        if (depth) {
          for (const o of await opts.backend.list(me, c.id)) out.push(response(objHref(me, c.id, o.name), objectProps(me, o), names, brief, propname));
        }
        break;
      }
      case "object": {
        const c = await collectionOf(me, t.coll);
        const [o] = c ? await opts.backend.get(me, c.id, [t.name]) : [];
        if (!o) return respond(404, "Not found");
        out.push(response(objHref(me, t.coll, o.name), objectProps(me, o, names?.some((n) => /calendar-data|address-data/.test(n)) ? o.data : undefined), names, brief, propname));
        break;
      }
    }
    return multistatus(out);
  }

  /** The object name an href in a multiget points at, if it is in this collection. */
  function nameFromHref(h: string, me: string, coll: string): string | null {
    let p = h.trim();
    try {
      if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
    } catch {
      return null;
    }
    const t = parsePath(p);
    return t && t.type === "object" && t.email === me && t.coll === coll ? t.name : null;
  }

  function wantsData(names: string[] | null): boolean {
    return !names || names.some((n) => n === `{${NS.CALDAV}}calendar-data` || n === `{${NS.CARDDAV}}address-data`);
  }

  async function objectsResponse(me: string, c: Collection, metas: ObjectMeta[], names: string[] | null, brief: boolean): Promise<string[]> {
    const props = names ?? ["{DAV:}getetag"];
    if (!wantsData(props)) return metas.map((o) => response(objHref(me, c.id, o.name), objectProps(me, o), props, brief));
    const out: string[] = [];
    for (let i = 0; i < metas.length; i += 200) {
      const objs = await opts.backend.get(me, c.id, metas.slice(i, i + 200).map((m) => m.name));
      for (const o of objs) out.push(response(objHref(me, c.id, o.name), objectProps(me, o, o.data), props, brief));
    }
    return out;
  }

  function parseIcalUtc(v: string | undefined): Date | undefined {
    if (!v) return undefined;
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(v.trim());
    if (!m) return undefined;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
  }

  async function report(req: DavRequest, me: string, t: Target): Promise<DavResponse> {
    const body = parseXml(req.body);
    if (!body) return respond(400, "Bad XML");
    const brief = /^t$/i.test(header(req, "brief") ?? "") || /return=minimal/i.test(header(req, "prefer") ?? "");
    const kind = clark(body);

    if (kind === "{DAV:}principal-property-search" || kind === "{DAV:}expand-property") return multistatus([]);
    if (t.type !== "collection") return errorXml(403, "{DAV:}supported-report");
    const c = await collectionOf(me, t.coll);
    if (!c) return respond(404, "No such collection");
    const names = requested(body);

    if (kind === `{${NS.CALDAV}}calendar-multiget` || kind === `{${NS.CARDDAV}}addressbook-multiget`) {
      if ((kind === `{${NS.CALDAV}}calendar-multiget`) !== cal) return errorXml(403, "{DAV:}supported-report");
      const hrefs = childrenOf(body, NS.DAV, "href").map((h) => h.text.trim());
      const wanted = hrefs.map((h) => ({ h, name: nameFromHref(h, me, c.id) }));
      const objs = new Map<string, DavObject>();
      const valid = wanted.filter((w) => w.name).map((w) => w.name!) ;
      for (let i = 0; i < valid.length; i += 200) {
        for (const o of await opts.backend.get(me, c.id, valid.slice(i, i + 200))) objs.set(o.name, o);
      }
      const props = names ?? ["{DAV:}getetag"];
      return multistatus(wanted.map((w) => {
        const o = w.name ? objs.get(w.name) : undefined;
        return o ? response(objHref(me, c.id, o.name), objectProps(me, o, wantsData(props) ? o.data : undefined), props, brief) : notFound(w.h);
      }));
    }

    if (kind === `{${NS.CALDAV}}calendar-query`) {
      if (!cal) return errorXml(403, "{DAV:}supported-report");
      const filter = child(body, NS.CALDAV, "filter");
      const vcal = child(filter, NS.CALDAV, "comp-filter");
      const comp = child(vcal, NS.CALDAV, "comp-filter");
      // Only events are stored: a query for to-dos or journals finds nothing.
      if (comp && comp.attrs.name && comp.attrs.name.toUpperCase() !== "VEVENT") return multistatus([]);
      const tr = child(comp, NS.CALDAV, "time-range");
      const range = tr ? { start: parseIcalUtc(tr.attrs.start), end: parseIcalUtc(tr.attrs.end) } : undefined;
      const metas = await opts.backend.list(me, c.id, range);
      return multistatus(await objectsResponse(me, c, metas, names, brief));
    }

    if (kind === `{${NS.CARDDAV}}addressbook-query`) {
      if (cal) return errorXml(403, "{DAV:}supported-report");
      // Filters are not applied: every card is returned, which clients treat as a superset.
      const metas = await opts.backend.list(me, c.id);
      return multistatus(await objectsResponse(me, c, metas, names, brief));
    }

    if (kind === "{DAV:}sync-collection") {
      const given = (child(body, NS.DAV, "sync-token")?.text ?? "").trim();
      let changed: ObjectMeta[];
      let removed: string[] = [];
      let token: string;
      if (!given) {
        changed = await opts.backend.list(me, c.id);
        token = c.syncToken;
      } else {
        if (!given.startsWith(SYNC_PREFIX) || !/^\d+$/.test(given.slice(SYNC_PREFIX.length))) return errorXml(403, "{DAV:}valid-sync-token");
        const ch = await opts.backend.changes(me, c.id, given.slice(SYNC_PREFIX.length));
        if (!ch) return errorXml(403, "{DAV:}valid-sync-token");
        ({ changed, removed, token } = ch);
      }
      const out = await objectsResponse(me, c, changed, names, brief);
      for (const n of removed) out.push(notFound(objHref(me, c.id, n)));
      return multistatus(out, el("{DAV:}sync-token", esc(SYNC_PREFIX + token)));
    }

    if (kind === `{${NS.CALDAV}}free-busy-query`) return respond(501, "Free/busy queries are answered by the web app's free/busy API");
    return errorXml(403, "{DAV:}supported-report");
  }

  async function handleAuthed(req: DavRequest, me: string, t: Target, path: string): Promise<DavResponse> {
    if ("email" in t && t.email !== me) return respond(403, "This is someone else's collection");
    const method = req.method.toUpperCase();
    switch (method) {
      case "PROPFIND":
        return propfind(req, me, t, path);
      case "REPORT":
        return report(req, me, t);
      case "PROPPATCH": {
        // Names, colors and order are set in the web app; say so for each property asked.
        const body = parseXml(req.body);
        const props = childrenOf(body).flatMap((s) => childrenOf(child(s, NS.DAV, "prop")));
        return multistatus([el("{DAV:}response", href(path.split("?")[0]) +
          el("{DAV:}propstat", el("{DAV:}prop", props.map((p) => el(clark(p))).join("")) + el("{DAV:}status", statusLine(403))))]);
      }
      case "GET":
      case "HEAD": {
        if (t.type !== "object") return respond(200, method === "HEAD" ? "" : `This is a ${cal ? "CalDAV" : "CardDAV"} address. Add it to your calendar or contacts app.\n`);
        const c = await collectionOf(me, t.coll);
        const [o] = c ? await opts.backend.get(me, c.id, [t.name]) : [];
        if (!o) return respond(404, "Not found");
        const h: Record<string, string> = { "content-type": contentType, etag: o.etag };
        if (o.lastModified) h["last-modified"] = o.lastModified.toUTCString();
        return { status: 200, headers: h, body: method === "HEAD" ? "" : o.data };
      }
      case "PUT": {
        if (t.type !== "object") return respond(405, "Only objects can be written");
        const c = await collectionOf(me, t.coll);
        if (!c) return respond(409, "No such collection");
        if (c.readOnly) return errorXml(403, "{DAV:}need-privileges");
        if (!/^[A-Za-z0-9._~@+=%-]{1,200}$/.test(t.name)) return respond(400, "Pick a simpler name for the object");
        const [cur] = await opts.backend.get(me, c.id, [t.name]);
        const ifMatch = header(req, "if-match");
        const ifNone = header(req, "if-none-match");
        if (ifNone && ifNone.trim() === "*" && cur) return respond(412, "Already exists");
        if (ifMatch && (!cur || (ifMatch.trim() !== "*" && !ifMatch.split(",").map((s) => s.trim()).includes(cur.etag)))) return respond(412, "Changed since you last read it");
        const saved = await opts.backend.put(me, c.id, t.name, req.body, cur ?? null);
        // No ETag: what is stored is re-written from the parsed data, so the client fetches it again.
        return respond(cur ? 204 : 201, "", saved && !cur ? { location: objHref(me, c.id, saved.name) } : {});
      }
      case "DELETE": {
        if (t.type !== "object") return respond(403, "Collections are managed in the web app");
        const c = await collectionOf(me, t.coll);
        if (!c) return respond(404, "No such collection");
        const [cur] = await opts.backend.get(me, c.id, [t.name]);
        if (!cur) return respond(404, "Not found");
        if (c.readOnly) return errorXml(403, "{DAV:}need-privileges");
        const ifMatch = header(req, "if-match");
        if (ifMatch && ifMatch.trim() !== "*" && !ifMatch.split(",").map((s) => s.trim()).includes(cur.etag)) return respond(412, "Changed since you last read it");
        await opts.backend.remove(me, c.id, t.name);
        return respond(204);
      }
      case "MKCOL":
      case "MKCALENDAR":
        return respond(403, `New ${cal ? "calendars" : "address books"} are made in the web app`);
      default:
        return respond(405, "Not supported", { allow });
    }
  }

  async function handle(req: DavRequest): Promise<DavResponse> {
    const path = req.url;
    const p = path.split("?")[0];
    const method = req.method.toUpperCase();
    if (p === wellKnown) return { status: 301, headers: { location: `${root}/` }, body: "" };
    if (method === "OPTIONS") return { status: 200, headers: { dav: davHeader, allow, "content-length": "0" }, body: "" };
    const t = parsePath(path);
    if (!t) return respond(404, "Not found");
    const me = await signIn(req);
    if (!me) {
      return respond(401, "Sign in with your email and an app password from your Account page.", {
        "www-authenticate": `Basic realm="${opts.realm.replace(/"/g, "")}", charset="UTF-8"`,
      });
    }
    try {
      const res = await handleAuthed(req, me, t, path);
      res.headers.dav ??= davHeader;
      return res;
    } catch (e) {
      if (e instanceof DavError) return e.precondition ? errorXml(e.status, e.precondition) : respond(e.status, e.message);
      throw e;
    }
  }

  return { handle, matches, hrefs: { principal: principalHref, home: homeHref, collection: collHref, object: objHref } };
}
