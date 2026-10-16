import { scrub } from "../util";

/**
 * What Copilot may do inside the suite, and the checks every proposed action passes before the
 * person sees it and again before it runs. The model's output is untrusted data: only the fields
 * listed here are read, each is cleaned and bounded, and anything that doesn't fit is refused.
 */

export const ACTION_KINDS = ["todo.task", "calendar.event", "mail.draft", "chat.message", "planner.card"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type TodoTask = { kind: "todo.task"; title: string; due?: string; list?: string };
export type CalendarEvent = {
  kind: "calendar.event";
  title: string;
  /** Local wall-clock time in the person's time zone, YYYY-MM-DDTHH:mm. */
  start: string;
  end: string;
  attendees: string[];
  location?: string;
  description?: string;
};
export type MailDraft = { kind: "mail.draft"; to: string[]; cc: string[]; subject: string; body: string };
/** `to` is a channel name ("#general") or, for a direct message, the other person's email. */
export type ChatMessage = { kind: "chat.message"; to: string; text: string };
export type PlannerCard = { kind: "planner.card"; title: string; board?: string };

export type Action = TodoTask | CalendarEvent | MailDraft | ChatMessage | PlannerCard;

export const KIND_LABEL: Record<ActionKind, string> = {
  "todo.task": "Create a To Do task",
  "calendar.event": "Create a Calendar event",
  "mail.draft": "Draft an email in Mail",
  "chat.message": "Post a Chat message",
  "planner.card": "Create a Planner card",
};

export const MAX_ACTIONS = 3;
const MAX_PEOPLE = 20;
const MAX_TITLE = 200;

export class ActionError extends Error {}

/** The JSON Schema the model fills in. Flat on purpose: many OpenAI-compatible servers handle oneOf badly. */
export const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "One or two sentences to the person about what you propose, or why you can't." },
    actions: {
      type: "array",
      maxItems: MAX_ACTIONS,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...ACTION_KINDS] },
          title: { type: "string", description: "todo.task, calendar.event, planner.card: a short title" },
          due: { type: "string", description: "todo.task: due date YYYY-MM-DD, if the person gave one" },
          list: { type: "string", description: "todo.task: the To Do list name, only if the person named one" },
          start: { type: "string", description: "calendar.event: start, local time YYYY-MM-DDTHH:mm" },
          end: { type: "string", description: "calendar.event: end, local time YYYY-MM-DDTHH:mm" },
          attendees: { type: "array", items: { type: "string" }, description: "calendar.event: attendee email addresses" },
          location: { type: "string", description: "calendar.event: place or meeting link" },
          description: { type: "string", description: "calendar.event: agenda or notes" },
          to: {
            description: "mail.draft: recipient email addresses (array). chat.message: the channel name like #general, or the email of the person to message directly (string).",
            anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          },
          cc: { type: "array", items: { type: "string" }, description: "mail.draft: cc email addresses" },
          subject: { type: "string", description: "mail.draft: subject line" },
          body: { type: "string", description: "mail.draft: the email body as plain text" },
          text: { type: "string", description: "chat.message: the message to post" },
          board: { type: "string", description: "planner.card: the board name, if the person named one" },
        },
        required: ["kind"],
      },
    },
  },
  required: ["reply", "actions"],
} as const;

// ---- field checks ------------------------------------------------------------------------------

function str(v: unknown, max: number, field: string, required = false): string {
  if (v === undefined || v === null || v === "") {
    if (required) throw new ActionError(`The ${field} is missing.`);
    return "";
  }
  if (typeof v !== "string") throw new ActionError(`The ${field} isn't text.`);
  // One line: no control characters, zero-width or direction tricks.
  const s = scrub(v, max * 2).replace(/\s+/g, " ").trim();
  if (!s && required) throw new ActionError(`The ${field} is missing.`);
  if (s.length > max) throw new ActionError(`The ${field} is longer than ${max} characters.`);
  return s;
}

function longText(v: unknown, max: number, field: string, required = false): string {
  if (v === undefined || v === null || v === "") {
    if (required) throw new ActionError(`The ${field} is missing.`);
    return "";
  }
  if (typeof v !== "string") throw new ActionError(`The ${field} isn't text.`);
  const s = scrub(v, max * 2).replace(/\r\n?/g, "\n").trim();
  if (!s && required) throw new ActionError(`The ${field} is missing.`);
  if (s.length > max) throw new ActionError(`The ${field} is longer than ${max} characters.`);
  return s;
}

const EMAIL = /^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[^\s@<>()[\],;:"\\]+$/;

export function isEmail(v: string): boolean {
  return v.length <= 254 && EMAIL.test(v);
}

/** "Ann <ann@x.com>" or "ann@x.com" to "ann@x.com"; anything else is refused. */
function email(v: unknown, field: string): string {
  if (typeof v !== "string") throw new ActionError(`A ${field} address isn't text.`);
  const raw = scrub(v, 400).trim();
  const inner = raw.match(/<([^<>]+)>\s*$/)?.[1] ?? raw;
  const e = inner.trim().toLowerCase();
  if (!isEmail(e)) throw new ActionError(`"${raw.slice(0, 80)}" isn't an email address.`);
  return e;
}

function emails(v: unknown, field: string): string[] {
  if (v === undefined || v === null || v === "") return [];
  const list = typeof v === "string" ? v.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : v;
  if (!Array.isArray(list)) throw new ActionError(`The ${field} list isn't a list.`);
  const out: string[] = [];
  for (const item of list) {
    const e = email(item, field);
    if (!out.includes(e)) out.push(e);
  }
  if (out.length > MAX_PEOPLE) throw new ActionError(`That's more than ${MAX_PEOPLE} ${field} addresses.`);
  return out;
}

export function isDay(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** A wall-clock time, YYYY-MM-DDTHH:mm (seconds and any offset are dropped: times are in the person's zone). */
export function localTime(v: unknown, field: string): string {
  if (typeof v !== "string") throw new ActionError(`The ${field} time is missing.`);
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(v.trim());
  if (!m || !isDay(m[1]) || +m[2] > 23 || +m[3] > 59) throw new ActionError(`The ${field} time "${String(v).slice(0, 40)}" isn't a date and time.`);
  return `${m[1]}T${m[2]}:${m[3]}`;
}

/** Checks an IANA time zone name; unknown or missing ones read as UTC. */
export function timeZone(v: unknown): string {
  if (typeof v !== "string" || !v || v.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return v;
  } catch {
    return "UTC";
  }
}

/** The UTC instant of a wall-clock time in a time zone. */
export function zonedToUtc(local: string, tz: string): Date {
  const [d, t] = local.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  // The zone's offset at the guess, then again at the corrected instant (for DST edges).
  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - ms;
  };
  let ms = guess - offsetAt(guess);
  ms = guess - offsetAt(ms);
  return new Date(ms);
}

/** Today's date in a time zone, YYYY-MM-DD. */
export function todayIn(tz: string, now = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const YEAR_MS = 365 * 86400_000;

export interface ValidateOptions {
  tz?: string;
  now?: number;
}

/**
 * One proposed action, checked and reduced to the fields its kind uses. Throws ActionError with a
 * sentence a person can read when anything is wrong.
 */
export function validateAction(raw: unknown, opts: ValidateOptions = {}): Action {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ActionError("The action isn't an object.");
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (typeof kind !== "string" || !(ACTION_KINDS as readonly string[]).includes(kind)) {
    throw new ActionError(`Copilot can't do "${String(kind).slice(0, 40)}".`);
  }
  const now = opts.now ?? Date.now();
  const tz = timeZone(opts.tz);

  switch (kind as ActionKind) {
    case "todo.task": {
      const due = str(r.due, 10, "due date");
      if (due && !isDay(due)) throw new ActionError(`The due date "${due}" isn't a date.`);
      if (due && Math.abs(Date.parse(due) - now) > 5 * YEAR_MS) throw new ActionError("The due date is too far away.");
      const list = str(r.list, 100, "list name");
      return { kind: "todo.task", title: str(r.title, MAX_TITLE, "task title", true), ...(due ? { due } : {}), ...(list ? { list } : {}) };
    }
    case "calendar.event": {
      const start = localTime(r.start, "start");
      let end = r.end === undefined || r.end === null || r.end === "" ? "" : localTime(r.end, "end");
      const s = zonedToUtc(start, tz).getTime();
      if (!end) {
        const e = new Date(Date.parse(`${start}:00Z`) + 30 * 60_000).toISOString().slice(0, 16);
        end = e;
      }
      const e = zonedToUtc(end, tz).getTime();
      if (!(e > s)) throw new ActionError("The event has to end after it starts.");
      if (e - s > 7 * 86400_000) throw new ActionError("The event is longer than a week.");
      if (Math.abs(s - now) > 5 * YEAR_MS) throw new ActionError("The event is too far away.");
      const location = str(r.location, 300, "location");
      const description = longText(r.description, 2000, "description");
      return {
        kind: "calendar.event",
        title: str(r.title, MAX_TITLE, "event title", true),
        start, end,
        attendees: emails(r.attendees, "attendee"),
        ...(location ? { location } : {}),
        ...(description ? { description } : {}),
      };
    }
    case "mail.draft": {
      const to = emails(r.to, "recipient");
      if (!to.length) throw new ActionError("The email needs at least one recipient.");
      return {
        kind: "mail.draft",
        to,
        cc: emails(r.cc, "cc"),
        subject: str(r.subject, 300, "subject"),
        body: longText(r.body, 8000, "email body", true),
      };
    }
    case "chat.message": {
      if (Array.isArray(r.to)) throw new ActionError("A Chat message goes to one channel or one person.");
      const to = str(r.to, 120, "channel or person", true);
      return { kind: "chat.message", to, text: longText(r.text ?? r.body, 4000, "message", true) };
    }
    case "planner.card": {
      const board = str(r.board, 200, "board name");
      return { kind: "planner.card", title: str(r.title, MAX_TITLE, "card title", true), ...(board ? { board } : {}) };
    }
  }
}

/** Fields a person may change on the confirmation card, per kind. Anything else in an edit is ignored. */
export const EDITABLE: Record<ActionKind, string[]> = {
  "todo.task": ["title", "due", "list"],
  "calendar.event": ["title", "start", "end", "attendees", "location", "description"],
  "mail.draft": ["to", "cc", "subject", "body"],
  "chat.message": ["to", "text"],
  "planner.card": ["title", "board"],
};

/** The proposal with the person's edits laid over it, checked again. The kind never changes. */
export function applyEdits(action: Action, edits: unknown, opts: ValidateOptions = {}): Action {
  if (edits === undefined || edits === null) return action;
  if (typeof edits !== "object" || Array.isArray(edits)) throw new ActionError("The changes aren't an object.");
  const merged: Record<string, unknown> = { ...action };
  for (const k of EDITABLE[action.kind]) {
    if (k in (edits as Record<string, unknown>)) merged[k] = (edits as Record<string, unknown>)[k];
  }
  merged.kind = action.kind;
  return validateAction(merged, opts);
}

/** Email addresses an action would reach. */
export function recipients(a: Action): string[] {
  if (a.kind === "calendar.event") return a.attendees;
  if (a.kind === "mail.draft") return [...a.to, ...a.cc];
  if (a.kind === "chat.message" && isEmail(a.to.toLowerCase())) return [a.to.toLowerCase()];
  return [];
}
