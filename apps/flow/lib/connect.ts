import { apps } from "@synergy/config";
import type { Person } from "./engine";
import { text, today, UserError } from "./util";

/**
 * What the Synergy piece can do in the suite. The piece sends { op, input } with the person's
 * Synergy key; Flow calls the app's own API as that person, with the same gateway headers their
 * browser's requests carry, so every app applies its normal access rules.
 */

export interface ConnectOptions {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

type Ctx = { person: Person; opts: ConnectOptions };
type Handler = (input: Record<string, unknown>, ctx: Ctx) => Promise<unknown>;

function overrides(env: NodeJS.ProcessEnv): Record<string, string> {
  try {
    const v = JSON.parse(env.FLOW_APP_URLS || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Where Flow reaches an app: FLOW_APP_URLS, else http://<id>:<port> in production, localhost otherwise. */
export function appInternalUrl(id: string, env: NodeJS.ProcessEnv = process.env): string {
  const o = overrides(env)[id];
  if (typeof o === "string" && o) return o.replace(/\/+$/, "");
  const app = apps.find((a) => a.id === id);
  if (!app) throw new Error(`unknown suite app "${id}"`);
  return env.NODE_ENV === "production" ? `http://${app.id}:${app.port}` : `http://localhost:${app.port}`;
}

/** The headers an app's identify() reads, as the gateway would set them for this person. */
export function personHeaders(person: Person, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const h: Record<string, string> = {
    "x-auth-request-email": person.email,
    "x-auth-request-preferred-username": person.name || person.email,
    "x-auth-request-user": person.subject || person.email,
  };
  if (env.PROXY_SHARED_SECRET) h["x-proxy-auth-secret"] = env.PROXY_SHARED_SECRET;
  return h;
}

const APP_NAMES: Record<string, string> = Object.fromEntries(apps.map((a) => [a.id, a.name]));

/** Calls one app as the person. JSON in and out unless a raw body is given. */
async function appCall<T = any>(app: string, method: string, p: string, ctx: Ctx, body?: { json?: unknown; raw?: BodyInit; contentLength?: number }): Promise<T> {
  const env = ctx.opts.env ?? process.env;
  const f = ctx.opts.fetch ?? fetch;
  const headers = personHeaders(ctx.person, env);
  let payload: BodyInit | undefined;
  if (body?.json !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body.json);
  } else if (body?.raw !== undefined) {
    payload = body.raw;
    if (body.contentLength !== undefined) headers["content-length"] = String(body.contentLength);
  }
  let res: Response;
  try {
    res = await f(`${appInternalUrl(app, env)}${p}`, { method, headers, body: payload, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new UserError(`${APP_NAMES[app] ?? app} isn't answering`, 502);
  }
  const raw = await res.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const why = typeof data?.error === "string" ? data.error : `answered ${res.status}`;
    throw new UserError(`${APP_NAMES[app] ?? app}: ${why}`, res.status >= 500 ? 502 : 400);
  }
  return data as T;
}

const str = (v: unknown, max = 500) => text(v, max);
const opt = (v: unknown, max = 500) => {
  const s = text(v, max);
  return s ? s : undefined;
};
const list = (v: unknown) =>
  (Array.isArray(v) ? v.map(String) : String(v ?? "").split(/[,;\n]/))
    .map((s) => s.trim())
    .filter(Boolean);
const ymd = (v: unknown) => {
  const s = text(v, 40);
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new UserError(`"${s}" isn't a date (use YYYY-MM-DD)`);
  return d.toISOString().slice(0, 10);
};
const need = (v: unknown, what: string, max = 500) => {
  const s = text(v, max);
  if (!s) throw new UserError(`${what} is required`);
  return s;
};

/** Items for a polling trigger: newest first, those with an id above `after` (when given), at most `max`. */
function newest<T extends { id: number }>(items: T[], max = 50): T[] {
  return [...items].sort((a, b) => b.id - a.id).slice(0, max);
}

export const OPS: Record<string, Handler> = {
  whoami: async (_i, { person }) => ({ email: person.email, name: person.name }),

  // Mail
  "mail.send": async (i, ctx) => {
    const to = list(i.to);
    if (!to.length) throw new UserError("Give at least one recipient");
    const form = new URLSearchParams();
    form.set("account", "suite");
    form.set("to", to.join(", "));
    const cc = list(i.cc);
    if (cc.length) form.set("cc", cc.join(", "));
    form.set("subject", str(i.subject, 500));
    const body = String(i.body ?? "").slice(0, 500_000);
    if (i.html === true || i.html === "true") form.set("html", body);
    else form.set("text", body);
    const env = ctx.opts.env ?? process.env;
    const f = ctx.opts.fetch ?? fetch;
    // Mail takes a form post, like its own compose window.
    const res = await f(`${appInternalUrl("mail", env)}/api/send`, {
      method: "POST",
      headers: { ...personHeaders(ctx.person, env), "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    }).catch(() => {
      throw new UserError("Mail isn't answering", 502);
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok) throw new UserError(`Mail: ${data?.error ?? `answered ${res.status}`}`, res.status >= 500 ? 502 : 400);
    return { sent: true, messageId: data?.messageId ?? null, to };
  },
  "mail.inbox": async (_i, ctx) => {
    const { messages } = await appCall<{ messages: any[] }>("mail", "GET", "/api/messages?account=suite&folder=INBOX&page=0", ctx);
    return {
      items: newest(
        (messages ?? []).map((m) => ({
          id: Number(m.uid),
          data: { uid: m.uid, subject: m.subject ?? "", from: m.from ?? null, to: m.to ?? [], date: m.date ?? null, hasAttachments: !!m.hasAttachments },
        })),
      ),
    };
  },

  // Calendar
  "calendar.create": async (i, ctx) => {
    const ev = await appCall("calendar", "POST", "/api/events", ctx, {
      json: {
        title: str(i.title, 300),
        startAt: need(i.start, "Start"),
        endAt: need(i.end, "End"),
        location: opt(i.location, 300),
        description: opt(i.description, 2000),
        attendees: list(i.attendees).slice(0, 50),
        allDay: i.allDay === true,
        calendar: i.calendar === "company" ? "company" : "personal",
      },
    });
    return { id: ev.id, title: ev.title, start: ev.start_at, end: ev.end_at, calendar: ev.calendar };
  },

  // To Do
  "todo.lists": async (_i, ctx) => {
    const { lists } = await appCall<{ lists: any[] }>("todo", "GET", `/api/lists?today=${today()}`, ctx);
    return { options: (lists ?? []).map((l) => ({ label: l.isDefault ? `${l.name} (default)` : l.name, value: l.id })) };
  },
  "todo.create": async (i, ctx) => {
    const day = today();
    const task = await appCall("todo", "POST", "/api/tasks", ctx, {
      json: { today: day, title: need(i.title, "Title", 400), listId: opt(i.listId, 100), due: ymd(i.due), important: i.important === true },
    });
    const notes = opt(i.notes, 20_000);
    if (!notes) return task;
    return appCall("todo", "PATCH", `/api/tasks/${encodeURIComponent(task.id)}`, ctx, { json: { today: day, notes } });
  },

  // Planner (plans are boards, buckets are lists)
  "planner.boards": async (_i, ctx) => {
    const boards = await appCall<any[]>("planner", "GET", "/api/boards", ctx);
    return { options: (boards ?? []).map((b) => ({ label: b.title, value: b.id })) };
  },
  "planner.lists": async (i, ctx) => {
    const snap = await appCall<{ lists: any[] }>("planner", "GET", `/api/boards/${encodeURIComponent(need(i.boardId, "Plan", 100))}`, ctx);
    return { options: (snap.lists ?? []).map((l) => ({ label: l.title ?? l.name, value: l.id })) };
  },
  "planner.create": async (i, ctx) => {
    const priority = ["highest", "high", "medium", "low", "lowest"].includes(String(i.priority)) ? String(i.priority) : undefined;
    const card = await appCall("planner", "POST", "/api/cards", ctx, { json: { listId: need(i.listId, "Bucket", 100), title: need(i.title, "Title", 500), priority } });
    const patch: Record<string, unknown> = {};
    const description = opt(i.description, 20_000);
    if (description) patch.description = description;
    const due = ymd(i.dueDate);
    if (due) patch.dueDate = due;
    if (!Object.keys(patch).length) return card;
    return appCall("planner", "PATCH", `/api/cards/${encodeURIComponent(card.id)}`, ctx, { json: patch });
  },

  // Chat
  "chat.channels": async (_i, ctx) => {
    const me = await appCall<{ workspaces: any[]; channels: any[] }>("chat", "GET", "/api/me", ctx);
    const options: { label: string; value: string }[] = [];
    const add = (ws: any, channels: any[]) => {
      for (const c of channels ?? []) if (c.kind !== "dm") options.push({ label: (me.workspaces?.length ?? 0) > 1 ? `${ws?.name ?? ""} / #${c.name}` : `#${c.name}`, value: String(c.id) });
    };
    const [first, ...rest] = me.workspaces ?? [];
    add(first, me.channels);
    for (const ws of rest) {
      const other = await appCall<{ channels: any[] }>("chat", "GET", `/api/me?ws=${encodeURIComponent(ws.id)}`, ctx);
      add(ws, other.channels);
    }
    return { options };
  },
  "chat.post": async (i, ctx) => {
    const body = need(i.body, "Message", 8000);
    return appCall("chat", "POST", `/api/channels/${encodeURIComponent(need(i.channelId, "Channel", 100))}/messages`, ctx, { json: { body } });
  },

  // Forms
  "forms.list": async (_i, ctx) => {
    const forms = await appCall<any[]>("forms", "GET", "/api/forms", ctx);
    return { options: (forms ?? []).map((f) => ({ label: f.title || "(untitled form)", value: String(f.id) })) };
  },
  "forms.responses": async (i, ctx) => {
    const id = encodeURIComponent(need(i.formId, "Form", 100));
    const [form, subs] = await Promise.all([appCall<any>("forms", "GET", `/api/forms/${id}`, ctx), appCall<any[]>("forms", "GET", `/api/forms/${id}/submissions`, ctx)]);
    const labels = new Map<string, string>((form?.fields ?? []).map((f: any) => [String(f.id), String(f.label || f.id)]));
    return {
      items: newest(
        (subs ?? []).map((s) => {
          const answers: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(s.data ?? {})) answers[labels.get(k) ?? k] = v;
          const summary = Object.entries(answers)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "")}`)
            .join("\n");
          return { id: Number(s.id), data: { id: s.id, formId: form?.id, formTitle: form?.title ?? "", submittedAt: s.submitted_at, answers, summary } };
        }),
      ),
    };
  },

  // Contacts
  "contacts.create": async (i, ctx) => {
    const email = opt(i.email, 300);
    const phone = opt(i.phone, 100);
    return appCall("contacts", "POST", "/api/contacts", ctx, {
      json: {
        firstName: opt(i.firstName, 200),
        lastName: opt(i.lastName, 200),
        company: opt(i.company, 200),
        jobTitle: opt(i.jobTitle, 200),
        notes: opt(i.notes, 5000),
        emails: email ? [{ label: "work", value: email }] : [],
        phones: phone ? [{ label: "work", value: phone }] : [],
      },
    });
  },

  // Drive
  "drive.save": async (i, ctx) => {
    const p = need(i.path, "File name", 1000).replace(/^\/+/, "");
    const bytes = typeof i.base64 === "string" && i.base64 ? Buffer.from(i.base64, "base64") : Buffer.from(String(i.text ?? ""), "utf8");
    if (bytes.length > 100 * 1024 * 1024) throw new UserError("Files over 100 MB can't be saved from a flow");
    const item = await appCall("drive", "PUT", `/api/upload?path=${encodeURIComponent(p)}`, ctx, { raw: new Uint8Array(bytes), contentLength: bytes.length });
    return { id: item.id, name: item.name, size: item.size, version: item.version };
  },

  // Desk
  "desk.create": async (i, ctx) => {
    const priority = ["low", "normal", "high", "urgent"].includes(String(i.priority)) ? String(i.priority) : "normal";
    return appCall("desk", "POST", "/api/tickets", ctx, {
      json: { subject: need(i.subject, "Subject", 300), requesterEmail: need(i.requesterEmail, "Requester email", 300), requesterName: opt(i.requesterName, 200), body: opt(i.body, 20_000), priority },
    });
  },

  // CRM
  "crm.create": async (i, ctx) => {
    const sources = ["web", "referral", "event", "cold_outreach", "partner", "other"];
    return appCall("crm", "POST", "/api/leads", ctx, {
      json: { name: need(i.name, "Name", 200), company: opt(i.company, 200), email: opt(i.email, 300), phone: opt(i.phone, 100), source: sources.includes(String(i.source)) ? String(i.source) : "other" },
    });
  },
};

export async function runOp(op: string, input: unknown, person: Person, opts: ConnectOptions = {}): Promise<unknown> {
  const h = Object.prototype.hasOwnProperty.call(OPS, op) ? OPS[op] : undefined;
  if (!h) throw new UserError(`Unknown operation "${text(op, 60)}"`, 404);
  const i = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return h(i, { person, opts });
}
