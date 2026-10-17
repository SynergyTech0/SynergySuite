import { appUrl } from "@synergy/config";
import type { Viewer } from "../api";
import { type Action, ActionError, isEmail, todayIn, zonedToUtc } from "./actions";
import { type AppDeps, callApp } from "./client";

/**
 * Where an action lands, looked up in the app as the person (the Chat channel they're in, the
 * Planner board they can write to), and how it is carried out once they confirm. Looked up again
 * at confirm time, so a membership that changed in between is noticed.
 */

export interface Prepared {
  action: Action;
  /** What the confirmation card shows: a label per line, in order. */
  summary: [string, string][];
  /** Ids found in the app; never taken from the model. */
  target: Record<string, string>;
}

export interface Done {
  message: string;
  /** Where to see the result, on the app's public address. */
  url?: string;
  /** Mail: the compose window to open. Nothing is sent. */
  open?: string;
}

export interface TargetOptions extends AppDeps {
  tz: string;
  now?: number;
}

const norm = (s: string) => s.toLowerCase().replace(/^#/, "").replace(/\s+/g, " ").trim();

/** The single best name match: exact, then a unique prefix, then a unique substring. */
export function pick<T>(items: T[], name: string, nameOf: (t: T) => string): T | null | "ambiguous" {
  const want = norm(name);
  if (!want) return null;
  const exact = items.filter((i) => norm(nameOf(i)) === want);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return "ambiguous";
  for (const test of [(n: string) => n.startsWith(want), (n: string) => n.includes(want)]) {
    const hits = items.filter((i) => test(norm(nameOf(i))));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return "ambiguous";
  }
  return null;
}

function fmtLocal(local: string): string {
  const d = new Date(`${local}:00Z`);
  return d.toLocaleString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// ---- Chat --------------------------------------------------------------------------------------

type ChatUser = { id: number | string; email: string; name: string };
type ChatChannel = { id: number | string; kind: string; name: string | null; member_ids?: (number | string)[] | null };
type ChatMe = { me: ChatUser; workspaces: { id: number | string; name: string }[]; activeWorkspace: number | string | null; users: ChatUser[]; channels: ChatChannel[] };

async function chatTarget(viewer: Viewer, to: string, deps: AppDeps): Promise<{ channel: string; ws: string; label: string }> {
  const first = await callApp<ChatMe>("chat", viewer, "GET", "/api/me", null, deps);
  const spaces = (first.workspaces ?? []).slice(0, 10);
  const all = await Promise.all(
    spaces.map((w) => (String(w.id) === String(first.activeWorkspace) ? first : callApp<ChatMe>("chat", viewer, "GET", `/api/me?ws=${encodeURIComponent(String(w.id))}`, null, deps))),
  );
  const options: { channel: string; ws: string; label: string; name: string }[] = [];
  all.forEach((d, i) => {
    const ws = spaces[i];
    const users = new Map((d.users ?? []).map((u) => [String(u.id), u]));
    for (const c of d.channels ?? []) {
      if (c.kind === "dm") {
        const other = (c.member_ids ?? []).map(String).find((id) => id !== String(d.me?.id));
        const u = other ? users.get(other) : undefined;
        if (u) options.push({ channel: String(c.id), ws: String(ws.id), name: u.email, label: `Direct message with ${u.name || u.email}` });
        if (u?.name) options.push({ channel: String(c.id), ws: String(ws.id), name: u.name, label: `Direct message with ${u.name}` });
      } else if (c.name) {
        options.push({ channel: String(c.id), ws: String(ws.id), name: c.name, label: `#${c.name}${spaces.length > 1 ? ` in ${ws.name}` : ""}` });
      }
    }
  });
  const want = to.trim();
  const isDm = isEmail(want.toLowerCase());
  const pool = isDm ? options.filter((o) => o.name.toLowerCase() === want.toLowerCase()) : options;
  const found = isDm ? (pool.length === 1 ? pool[0] : pool.length ? "ambiguous" : null) : pick(pool, want, (o) => o.name);
  if (found === "ambiguous") throw new ActionError(`More than one Chat conversation matches "${want}". Name the channel exactly.`);
  if (!found) {
    throw new ActionError(isDm
      ? `You don't have a direct message with ${want} in Chat yet. Start one in Chat first.`
      : `You aren't in a Chat channel called "${want}".`);
  }
  return found;
}

// ---- Planner -----------------------------------------------------------------------------------

type Board = { id: string; title: string };
type Snapshot = { board: Board; lists: { id: string; title: string; statusCategory?: string }[] };

async function plannerTarget(viewer: Viewer, board: string | undefined, deps: AppDeps): Promise<{ board: string; list: string; label: string }> {
  const boards = await callApp<Board[]>("planner", viewer, "GET", "/api/boards", null, deps);
  if (!Array.isArray(boards) || !boards.length) throw new ActionError("You don't have a Planner board yet. Create one in Planner first.");
  let b: Board | null | "ambiguous";
  if (board) b = pick(boards, board, (x) => x.title);
  else b = boards.length === 1 ? boards[0] : "ambiguous";
  if (b === "ambiguous") throw new ActionError(board ? `More than one Planner board matches "${board}".` : "Which Planner board? Name the board in your request.");
  if (!b) throw new ActionError(`You don't have a Planner board called "${board}".`);
  const snap = await callApp<Snapshot>("planner", viewer, "GET", `/api/boards/${encodeURIComponent(b.id)}`, null, deps);
  const lists = snap?.lists ?? [];
  const list = lists.find((l) => l.statusCategory === "todo") ?? lists[0];
  if (!list) throw new ActionError(`The board "${b.title}" has no lists to put a card in.`);
  return { board: b.id, list: list.id, label: `${b.title} › ${list.title}` };
}

// ---- To Do -------------------------------------------------------------------------------------

async function todoList(viewer: Viewer, name: string | undefined, deps: AppDeps): Promise<{ id: string; label: string } | null> {
  if (!name) return null;
  const out = await callApp<{ lists: { id: string; name: string }[] }>("todo", viewer, "GET", "/api/lists", null, deps);
  const l = pick(out?.lists ?? [], name, (x) => x.name);
  if (l === "ambiguous") throw new ActionError(`More than one To Do list matches "${name}".`);
  if (!l) throw new ActionError(`You don't have a To Do list called "${name}".`);
  return { id: l.id, label: l.name };
}

// ---- prepare / execute ---------------------------------------------------------------------------

export async function prepare(action: Action, viewer: Viewer, opts: TargetOptions): Promise<Prepared> {
  switch (action.kind) {
    case "todo.task": {
      const list = await todoList(viewer, action.list, opts);
      return {
        action,
        summary: [["Task", action.title], ["Due", action.due ?? "No due date"], ["List", list?.label ?? "Your default list"]],
        target: list ? { list: list.id } : {},
      };
    }
    case "calendar.event":
      return {
        action,
        summary: [
          ["Event", action.title],
          ["When", `${fmtLocal(action.start)} – ${fmtLocal(action.end)} (${opts.tz})`],
          ["Attendees", action.attendees.join(", ") || "Just you"],
          ...(action.location ? [["Where", action.location] as [string, string]] : []),
          ...(action.description ? [["Notes", action.description] as [string, string]] : []),
        ],
        target: {},
      };
    case "mail.draft":
      return {
        action,
        summary: [
          ["To", action.to.join(", ")],
          ...(action.cc.length ? [["Cc", action.cc.join(", ")] as [string, string]] : []),
          ["Subject", action.subject || "(no subject)"],
          ["Body", action.body],
        ],
        target: {},
      };
    case "chat.message": {
      const t = await chatTarget(viewer, action.to, opts);
      return { action, summary: [["Post to", t.label], ["Message", action.text]], target: { channel: t.channel, ws: t.ws } };
    }
    case "planner.card": {
      const t = await plannerTarget(viewer, action.board, opts);
      return { action, summary: [["Card", action.title], ["Board", t.label]], target: { board: t.board, list: t.list } };
    }
  }
}

/** base64url of UTF-8 JSON, for Mail's #draft= link. */
export function draftFragment(a: { to: string[]; cc: string[]; subject: string; body: string }): string {
  return Buffer.from(JSON.stringify({ to: a.to.join(", "), cc: a.cc.join(", "), subject: a.subject, body: a.body }), "utf8").toString("base64url");
}

export async function execute(p: Prepared, viewer: Viewer, opts: TargetOptions): Promise<Done> {
  const env = opts.env ?? process.env;
  const a = p.action;
  switch (a.kind) {
    case "todo.task": {
      const task = await callApp<{ id: string; listId: string }>("todo", viewer, "POST", "/api/tasks", {
        title: a.title,
        ...(a.due ? { due: a.due } : {}),
        ...(p.target.list ? { listId: p.target.list } : {}),
        today: todayIn(opts.tz, opts.now),
      }, opts);
      return { message: `Added "${a.title}" to To Do.`, url: `${appUrl("todo", env)}/?${new URLSearchParams({ list: String(task?.listId ?? ""), task: String(task?.id ?? "") })}` };
    }
    case "calendar.event": {
      const startAt = zonedToUtc(a.start, opts.tz).toISOString();
      const ev = await callApp<{ id: number | string }>("calendar", viewer, "POST", "/api/events", {
        title: a.title,
        startAt,
        endAt: zonedToUtc(a.end, opts.tz).toISOString(),
        attendees: a.attendees,
        location: a.location ?? "",
        description: a.description ?? "",
      }, opts);
      return { message: `Added "${a.title}" to your calendar.`, url: `${appUrl("calendar", env)}/?${new URLSearchParams({ event: String(ev?.id ?? ""), at: startAt })}` };
    }
    case "mail.draft":
      // Mail opens compose with these fields filled in. Only the person pressing Send there sends it.
      return { message: "Your draft is open in Mail. Review it and press Send when you're ready.", open: `${appUrl("mail", env)}/#draft=${draftFragment(a)}` };
    case "chat.message": {
      const msg = await callApp<{ id: number | string }>("chat", viewer, "POST", `/api/channels/${encodeURIComponent(p.target.channel)}/messages`, { body: a.text }, opts);
      return { message: "Posted in Chat.", url: `${appUrl("chat", env)}/?${new URLSearchParams({ ws: p.target.ws, channel: p.target.channel, msg: String(msg?.id ?? "") })}` };
    }
    case "planner.card": {
      const card = await callApp<{ id: string }>("planner", viewer, "POST", "/api/cards", { listId: p.target.list, title: a.title }, opts);
      return { message: `Created the card "${a.title}".`, url: `${appUrl("planner", env)}/b/${encodeURIComponent(p.target.board)}?card=${encodeURIComponent(String(card?.id ?? ""))}` };
    }
  }
}
