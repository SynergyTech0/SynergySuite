import { internalUrl } from "../apps";

/**
 * Writing into the suite's apps on a person's behalf. Each call goes to the app's normal API
 * with the gateway headers that person's own browser request would carry (and
 * PROXY_SHARED_SECRET), exactly as Search does, so every app applies its usual checks, quotas
 * and legal holds. MIGRATION_APP_URLS ({"mail":"http://..."}) points an app elsewhere.
 */

export type Who = { email: string; name?: string };
export type MailPlace = { role?: string | null; path: string[] };
export type MailState = { seen: boolean; flagged: boolean; date?: string | null };
export type DriveTarget = { parent?: string | null; library?: string | null };
export type EventInput = {
  title: string; description: string; location: string; startAt: string; endAt: string; allDay: boolean; attendees: string[];
};
export type ContactInput = {
  firstName: string; lastName: string; middleName: string; nickname: string; company: string; jobTitle: string; department: string;
  emails: { label: string; value: string }[]; phones: { label: string; value: string }[];
  addresses: { label: string; street: string; city: string; region: string; postcode: string; country: string }[];
  websites: { label: string; value: string }[]; birthday: string; notes: string;
};
export type TaskInput = {
  title: string; notes: string; important: boolean; due: string | null; reminderAt: string | null;
  repeat: string | null; completed: boolean; steps: { title: string; done: boolean }[];
};

/** What the importers need from the suite. Tests swap in their own. */
export interface Suite {
  provisionMailbox(who: Who): Promise<void>;
  mailAppend(who: Who, raw: Buffer, place: MailPlace, state: MailState): Promise<{ folder: string; uid: number | null }>;
  mailUpdate(who: Who, at: { folder: string; uid: number }, state: MailState, moveTo?: MailPlace | null): Promise<{ folder: string; uid: number | null } | null>;
  driveFolder(who: Who, at: DriveTarget, name: string): Promise<string>;
  driveUpload(who: Who, at: DriveTarget, name: string, body: ReadableStream<Uint8Array> | Buffer | null, size: number | null, modifiedAt: string | null): Promise<string>;
  driveRename(who: Who, id: string, name: string): Promise<void>;
  driveMove(who: Who, id: string, to: DriveTarget): Promise<void>;
  driveTrash(who: Who, id: string): Promise<void>;
  driveLibrary(who: Who, name: string, description: string): Promise<string>;
  driveMember(who: Who, library: string, email: string, role: "owner" | "editor" | "viewer"): Promise<void>;
  eventCreate(who: Who, e: EventInput): Promise<string>;
  eventUpdate(who: Who, id: string, e: EventInput): Promise<void>;
  eventDelete(who: Who, id: string): Promise<void>;
  contactCreate(who: Who, c: ContactInput): Promise<string>;
  contactUpdate(who: Who, id: string, c: ContactInput): Promise<void>;
  contactDelete(who: Who, id: string): Promise<void>;
  todoList(who: Who, name: string): Promise<string>;
  taskCreate(who: Who, listId: string | null, t: TaskInput): Promise<string>;
  taskUpdate(who: Who, id: string, t: TaskInput): Promise<void>;
  taskDelete(who: Who, id: string): Promise<void>;
}

/** An app refused or failed a write. `status` is its HTTP answer (0 when it couldn't be reached). */
export class SuiteError extends Error {
  constructor(public app: string, public status: number, message: string) {
    super(message);
  }
  get notFound() {
    return this.status === 404;
  }
  get tooLarge() {
    return this.status === 413;
  }
  get conflict() {
    return this.status === 409;
  }
}

function overrides(env: NodeJS.ProcessEnv): Record<string, string> {
  try {
    const v = JSON.parse(env.MIGRATION_APP_URLS || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    console.error("[admin] MIGRATION_APP_URLS is not valid JSON; ignoring it");
    return {};
  }
}

export function appBase(app: string, env: NodeJS.ProcessEnv = process.env): string {
  const o = overrides(env)[app];
  return typeof o === "string" && o ? o.replace(/\/+$/, "") : internalUrl(app, env);
}

/** The headers the gateway would set for this person. */
export function gatewayHeaders(who: Who, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const h: Record<string, string> = {
    "x-auth-request-email": who.email,
    "x-auth-request-user": who.email,
    "x-auth-request-preferred-username": who.name || who.email,
  };
  if (env.PROXY_SHARED_SECRET) h["x-proxy-auth-secret"] = env.PROXY_SHARED_SECRET;
  return h;
}

const today = () => new Date().toISOString().slice(0, 10);

export class HttpSuite implements Suite {
  constructor(private readonly opts: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}) {}

  private async call<T>(app: string, who: Who, method: string, path: string, body?: unknown, extra: RequestInit = {}): Promise<T> {
    const env = this.opts.env ?? process.env;
    const f = this.opts.fetch ?? fetch;
    const raw = body instanceof Buffer || body instanceof ReadableStream || body === null;
    let res: Response;
    try {
      res = await f(`${appBase(app, env)}${path}`, {
        method,
        headers: { ...gatewayHeaders(who, env), Accept: "application/json", ...(body !== undefined && !raw ? { "Content-Type": "application/json" } : {}), ...(extra.headers as Record<string, string>) },
        body: body === undefined ? undefined : raw ? (body as BodyInit | null) : JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10 * 60_000),
        ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
      } as RequestInit);
    } catch (e) {
      throw new SuiteError(app, 0, `Couldn't reach ${app}: ${(e as Error).name === "TimeoutError" ? "no answer in time" : "connection failed"}`);
    }
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) throw new SuiteError(app, res.status, data?.error ? `${app}: ${data.error}` : `${app} answered ${res.status}`);
    return (data ?? {}) as T;
  }

  async provisionMailbox(who: Who): Promise<void> {
    await this.call("mail", who, "GET", "/api/folders?account=suite");
  }

  mailAppend(who: Who, raw: Buffer, place: MailPlace, state: MailState) {
    const p = new URLSearchParams({ path: JSON.stringify(place.path) });
    if (place.role) p.set("role", place.role);
    if (state.seen) p.set("seen", "1");
    if (state.flagged) p.set("flagged", "1");
    if (state.date) p.set("date", state.date);
    return this.call<{ folder: string; uid: number | null }>("mail", who, "PUT", `/api/import?${p}`, raw, { headers: { "Content-Type": "message/rfc822" } });
  }

  async mailUpdate(who: Who, at: { folder: string; uid: number }, state: MailState, moveTo?: MailPlace | null) {
    const r = await this.call<{ folder?: string; uid?: number | null; gone?: boolean }>("mail", who, "POST", "/api/import", {
      folder: at.folder, uid: at.uid, seen: state.seen, flagged: state.flagged, moveTo: moveTo ?? undefined,
    });
    return r.gone ? null : { folder: r.folder ?? at.folder, uid: r.uid ?? null };
  }

  private where(at: DriveTarget): string {
    const p = new URLSearchParams();
    if (at.parent) p.set("parent", at.parent);
    else if (at.library) p.set("library", at.library);
    return p.toString();
  }

  async driveFolder(who: Who, at: DriveTarget, name: string): Promise<string> {
    try {
      return (await this.call<{ id: string }>("drive", who, "POST", "/api/items", { name, parent: at.parent ?? undefined, library: at.parent ? undefined : at.library ?? undefined })).id;
    } catch (e) {
      if (!(e instanceof SuiteError) || !e.conflict) throw e;
      // Already there (a re-run after a crash, or a folder of that name made by hand): use it.
      const list = await this.call<{ items: { id: string; name: string; kind: string }[] }>("drive", who, "GET", `/api/items?${this.where(at)}`);
      const found = list.items.find((i) => i.kind === "folder" && i.name.toLowerCase() === name.toLowerCase());
      if (!found) throw e;
      return found.id;
    }
  }

  async driveUpload(who: Who, at: DriveTarget, name: string, body: ReadableStream<Uint8Array> | Buffer | null, size: number | null, modifiedAt: string | null) {
    const p = new URLSearchParams(this.where(at));
    p.set("path", name);
    if (modifiedAt) p.set("modifiedAt", modifiedAt);
    const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
    if (size !== null) headers["Content-Length"] = String(size);
    return (await this.call<{ id: string }>("drive", who, "PUT", `/api/upload?${p}`, body ?? Buffer.alloc(0), { headers })).id;
  }

  async driveRename(who: Who, id: string, name: string) {
    await this.call("drive", who, "PATCH", `/api/items/${encodeURIComponent(id)}`, { name });
  }

  async driveMove(who: Who, id: string, to: DriveTarget) {
    await this.call("drive", who, "POST", "/api/actions", { action: "move", ids: [id], target: { parent: to.parent ?? null, library: to.library ?? null } });
  }

  async driveTrash(who: Who, id: string) {
    await this.call("drive", who, "POST", "/api/actions", { action: "trash", ids: [id] });
  }

  async driveLibrary(who: Who, name: string, description: string) {
    return (await this.call<{ id: string }>("drive", who, "POST", "/api/libraries", { name, description })).id;
  }

  async driveMember(who: Who, library: string, email: string, role: "owner" | "editor" | "viewer") {
    await this.call("drive", who, "POST", `/api/libraries/${encodeURIComponent(library)}/members`, { email, role });
  }

  async eventCreate(who: Who, e: EventInput) {
    return String((await this.call<{ id: string | number }>("calendar", who, "POST", "/api/events", e)).id);
  }

  async eventUpdate(who: Who, id: string, e: EventInput) {
    await this.call("calendar", who, "PATCH", `/api/events/${encodeURIComponent(id)}`, e);
  }

  async eventDelete(who: Who, id: string) {
    await this.call("calendar", who, "DELETE", `/api/events/${encodeURIComponent(id)}`);
  }

  async contactCreate(who: Who, c: ContactInput) {
    return (await this.call<{ id: string }>("contacts", who, "POST", "/api/contacts", c)).id;
  }

  async contactUpdate(who: Who, id: string, c: ContactInput) {
    await this.call("contacts", who, "PATCH", `/api/contacts/${encodeURIComponent(id)}`, c);
  }

  async contactDelete(who: Who, id: string) {
    await this.call("contacts", who, "DELETE", `/api/contacts/${encodeURIComponent(id)}`);
  }

  async todoList(who: Who, name: string) {
    return (await this.call<{ id: string }>("todo", who, "POST", "/api/lists", { name })).id;
  }

  async taskCreate(who: Who, listId: string | null, t: TaskInput) {
    const made = await this.call<{ id: string }>("todo", who, "POST", "/api/tasks", {
      listId: listId ?? undefined, title: t.title, important: t.important, due: t.due ?? undefined, today: today(),
    });
    await this.finishTask(who, made.id, t, []);
    return made.id;
  }

  async taskUpdate(who: Who, id: string, t: TaskInput) {
    const cur = await this.call<{ steps: { id: string; title: string; done: boolean }[] }>("todo", who, "GET", `/api/tasks/${encodeURIComponent(id)}?today=${today()}`);
    await this.call("todo", who, "PATCH", `/api/tasks/${encodeURIComponent(id)}`, { title: t.title, important: t.important, due: t.due ?? null, today: today() });
    await this.finishTask(who, id, t, cur.steps ?? []);
  }

  /** Notes, reminder, repeat, completion and steps. A completed task is completed before it gets a repeat, so no next copy is made. */
  private async finishTask(who: Who, id: string, t: TaskInput, have: { id: string; title: string; done: boolean }[]) {
    const path = `/api/tasks/${encodeURIComponent(id)}`;
    await this.call("todo", who, "PATCH", path, { notes: t.notes, reminderAt: t.reminderAt ?? "", completed: t.completed, today: today() });
    if (!t.completed) await this.call("todo", who, "PATCH", path, { repeat: t.repeat ?? "", today: today() });
    const left = [...have];
    for (const s of t.steps) {
      const i = left.findIndex((h) => h.title === s.title);
      if (i >= 0) {
        const h = left.splice(i, 1)[0];
        if (h.done !== s.done) await this.call("todo", who, "PATCH", `${path}/steps/${encodeURIComponent(h.id)}`, { done: s.done });
        continue;
      }
      await this.call("todo", who, "POST", `${path}/steps`, { title: s.title });
      if (s.done) {
        const now = await this.call<{ steps: { id: string; title: string; done: boolean }[] }>("todo", who, "GET", `${path}?today=${today()}`);
        const made = now.steps.find((x) => x.title === s.title && !x.done);
        if (made) await this.call("todo", who, "PATCH", `${path}/steps/${encodeURIComponent(made.id)}`, { done: true });
      }
    }
  }

  async taskDelete(who: Who, id: string) {
    await this.call("todo", who, "DELETE", `/api/tasks/${encodeURIComponent(id)}`);
  }
}
