import type { Me } from "./api";
import { q } from "./db";
import { requireMember } from "./groups";
import { AppError, callApp, sourceOf } from "./sync";
import { UserError, text } from "./util";

/**
 * A team's space: its conversations (Chat), files (Drive) and calendar, read through each app's
 * service API after Groups has checked that the viewer is in the team. Each part fails on its own:
 * Drive being down leaves the conversations showing.
 */

async function team(me: Me, groupId: string) {
  const { g } = await requireMember(me.email, groupId);
  if (g.kind !== "team") throw new UserError("Only teams have a space", 400);
  return g;
}

function softly<T>(p: Promise<T>, empty: T): Promise<T | { error: string } & Partial<T>> {
  return p.catch((err) => {
    if (err instanceof AppError) return { ...empty, error: err.status === 404 ? "Not set up yet" : err.message };
    throw err;
  });
}

export type Post = {
  id: number; channelKey: string; channelName: string; author: { email: string; name: string }; body: string;
  createdAt: string; replyCount: number; url: string;
};

export async function activity(me: Me, groupId: string, limit = 20) {
  await team(me, groupId);
  const n = Math.min(Math.max(1, limit), 50);
  return softly(callApp<{ messages: Post[] }>("chat", "GET", `/api/svc/teams/${sourceOf(groupId)}/activity?limit=${n}`), { messages: [] as Post[] });
}

export async function post(me: Me, groupId: string, channelKey: unknown, body: unknown) {
  await team(me, groupId);
  const key = String(channelKey ?? "general");
  const [c] = await q(`SELECT 1 FROM channels WHERE group_id = $1::uuid AND key = $2`, [groupId, key]);
  if (!c) throw new UserError("That channel isn't there", 404);
  const msg = text(body, 8000);
  if (!msg) throw new UserError("Write something first");
  try {
    return await callApp<Post>("chat", "POST", `/api/svc/teams/${sourceOf(groupId)}/messages`, { channelKey: key, email: me.email, body: msg });
  } catch (err) {
    if (err instanceof AppError) throw new UserError(err.message, 502);
    throw err;
  }
}

export type FileItem = { id: string; name: string; kind: "file" | "folder"; mime: string; size: number; modifiedAt: string; modifiedBy: string; url: string };

export async function files(me: Me, groupId: string, limit = 12) {
  await team(me, groupId);
  const n = Math.min(Math.max(1, limit), 50);
  return softly(callApp<{ items: FileItem[] }>("drive", "GET", `/api/svc/libraries/${sourceOf(groupId)}/recent?limit=${n}`), { items: [] as FileItem[] });
}

export type CalEvent = {
  id: number; title: string; description: string; location: string; start_at: string; end_at: string; all_day: boolean; owner_email: string;
};

export async function events(me: Me, groupId: string, from: Date, to: Date) {
  await team(me, groupId);
  const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return softly(callApp<{ events: CalEvent[] }>("calendar", "GET", `/api/svc/group-calendars/${sourceOf(groupId)}/events?${qs}`), { events: [] as CalEvent[] });
}

export type NewEvent = { title?: unknown; startAt?: unknown; endAt?: unknown; allDay?: unknown; location?: unknown; description?: unknown };

/** A meeting on the team's calendar, organised by the person adding it. */
export async function addEvent(me: Me, groupId: string, b: NewEvent) {
  const g = await team(me, groupId);
  const start = new Date(String(b.startAt ?? ""));
  const end = new Date(String(b.endAt ?? ""));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(start < end)) throw new UserError("Pick a start before the end");
  try {
    return await callApp<{ id: number }>("calendar", "POST", "/api/svc/events", {
      ownerEmail: me.email,
      calendar: "group",
      groupSource: sourceOf(groupId),
      title: text(b.title, 300) || `${g.name} meeting`,
      description: text(b.description, 2000),
      location: text(b.location, 300),
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      allDay: b.allDay === true,
      source: "groups",
    });
  } catch (err) {
    if (err instanceof AppError) throw new UserError(err.message, 502);
    throw err;
  }
}
