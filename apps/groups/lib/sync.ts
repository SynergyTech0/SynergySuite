import { appUrl } from "@synergy/config";
import { q } from "./db";
import { flatMembers, owners, parentsOf } from "./groups";
import type { Kind } from "./types";

/**
 * Groups is where membership is decided; the other apps keep their own copy so their access checks
 * stay plain SQL. After every change Groups tells each app "these are the people now" (an
 * idempotent PUT per app), and a sweep every 15 minutes repeats it for every group, so an app that
 * was down catches up. Each call's outcome is kept in `resources`, which the group's page shows.
 *
 *   team            Chat workspace + channels, Drive library, group calendar, shared mailbox (if it has an address)
 *   shared_mailbox  Mail: a shared mailbox
 *   distribution    Mail: a mailing list
 *   security        nothing to push; apps ask through @synergy/groups
 *
 * Chat, Drive and Mail are called on the internal network with PROXY_SHARED_SECRET (their gateways
 * never forward /api/svc/); Calendar with its own CAL_SVC_TOKEN.
 */

type Env = NodeJS.ProcessEnv;

function internal(name: string, host: string, port: number, env: Env): string {
  const v = env[`${name}_INTERNAL_URL`];
  if (v) return v.replace(/\/+$/, "");
  return env.NODE_ENV === "production" ? `http://${host}:${port}` : `http://localhost:${port}`;
}

export const urls = {
  chat: (env: Env = process.env) => internal("CHAT", "chat", 3080, env),
  drive: (env: Env = process.env) => internal("DRIVE", "drive", 3180, env),
  calendar: (env: Env = process.env) => internal("CALENDAR", "calendar", 3130, env),
  mail: (env: Env = process.env) => internal("MAIL", "mail", 3200, env),
};

const g = globalThis as unknown as { __groupsFetch?: typeof fetch };

/** Swaps the fetch used to reach the other apps, for tests. */
export function setAppFetch(f: typeof fetch | undefined): void {
  g.__groupsFetch = f;
}

export class AppError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export type AppName = "chat" | "drive" | "calendar" | "mail";

const LABEL: Record<AppName, string> = { chat: "Chat", drive: "Drive", calendar: "Calendar", mail: "Mail" };

/** One call to another app. Throws AppError with a sentence a person can read. */
export async function callApp<T = unknown>(app: AppName, method: string, path: string, body?: unknown, env: Env = process.env): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (app === "calendar") {
    if (!env.CAL_SVC_TOKEN) throw new AppError("Calendar isn't linked (set CAL_SVC_TOKEN on Groups and Calendar)", 503);
    headers.authorization = `Bearer ${env.CAL_SVC_TOKEN}`;
  } else if (env.PROXY_SHARED_SECRET) {
    headers["x-proxy-auth-secret"] = env.PROXY_SHARED_SECRET;
  }
  const f = g.__groupsFetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${urls[app](env)}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    });
  } catch {
    throw new AppError(`${LABEL[app]} didn't answer`);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new AppError(data?.error ? `${LABEL[app]}: ${data.error}` : `${LABEL[app]} answered ${res.status}`, res.status === 404 ? 404 : 502);
  return data;
}

/** The key every app files a group's things under. */
export function sourceOf(groupId: string): string {
  return `groups:${groupId}`;
}

type GroupRow = { id: string; kind: Kind; name: string; description: string; email: string | null; allow_external: boolean; deleted_at: Date | null };

async function record(groupId: string, app: string, r: { ref?: string; name?: string; url?: string; status: "ok" | "error" | "off"; error?: string }): Promise<void> {
  await q(
    `INSERT INTO resources (group_id, app, ref, name, url, status, error, synced_at) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (group_id, app) DO UPDATE SET
       ref = CASE WHEN $6 = 'error' THEN resources.ref ELSE EXCLUDED.ref END,
       name = CASE WHEN $6 = 'error' THEN resources.name ELSE EXCLUDED.name END,
       url = CASE WHEN $6 = 'error' THEN resources.url ELSE EXCLUDED.url END,
       status = EXCLUDED.status, error = EXCLUDED.error, synced_at = now()`,
    [groupId, app, r.ref ?? "", r.name ?? "", r.url ?? "", r.status, (r.error ?? "").slice(0, 500)],
  );
}

async function step(groupId: string, app: string, fn: () => Promise<{ ref?: string; name?: string; url?: string }>): Promise<boolean> {
  try {
    const out = await fn();
    await record(groupId, app, { ...out, status: "ok" });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!(err instanceof AppError)) console.error(`[groups] sync ${app}`, err);
    await record(groupId, app, { status: "error", error: msg });
    return false;
  }
}

type ChatOut = { workspaceId: number | string; url: string; channels: { key: string; id: number | string; name: string; url: string }[] };
type MailOut = { address: string; provisioned: boolean; note?: string; skipped?: string[] };

async function provision(gr: GroupRow): Promise<void> {
  const source = sourceOf(gr.id);
  const people = await flatMembers(gr.id);
  const own = new Set(await owners(gr.id));
  const withRoles = people.map((email) => ({ email, role: own.has(email) ? ("owner" as const) : ("member" as const) }));

  if (gr.kind === "team") {
    const channels = await q<{ key: string; name: string; topic: string }>(
      `SELECT key, name, topic FROM channels WHERE group_id = $1::uuid ORDER BY position, created_at`,
      [gr.id],
    );
    await step(gr.id, "chat", async () => {
      const out = await callApp<ChatOut>("chat", "PUT", `/api/svc/teams/${source}`, {
        name: gr.name, description: gr.description, members: withRoles, channels,
      });
      return {
        ref: JSON.stringify({ workspaceId: out.workspaceId, channels: Object.fromEntries(out.channels.map((c) => [c.key, c.url])) }),
        name: gr.name,
        url: out.url,
      };
    });
    await step(gr.id, "drive", async () => {
      const out = await callApp<{ id: string; url: string }>("drive", "PUT", `/api/svc/libraries/${source}`, {
        name: gr.name, description: gr.description,
        members: withRoles.map((m) => ({ email: m.email, role: m.role === "owner" ? "owner" : "editor" })),
      });
      return { ref: out.id, name: gr.name, url: out.url };
    });
    await step(gr.id, "calendar", async () => {
      const out = await callApp<{ source: string; url?: string }>("calendar", "PUT", `/api/svc/group-calendars/${source}`, {
        name: gr.name, members: withRoles,
      });
      return { ref: source, name: gr.name, url: out.url || appUrl("calendar") };
    });
  }

  // Mail: a team with an address and a shared mailbox both get a shared mailbox; a distribution
  // list gets a mailing list. A changed address removes the old one first.
  const mailKind = gr.kind === "distribution" ? "list" : gr.kind === "shared_mailbox" || gr.kind === "team" ? "shared" : null;
  const [prev] = await q<{ ref: string; status: string }>(`SELECT ref, status FROM resources WHERE group_id = $1::uuid AND app = 'mail'`, [gr.id]);
  if (prev?.ref && prev.status !== "off" && (!mailKind || !gr.email || prev.ref.toLowerCase() !== gr.email.toLowerCase())) {
    await callApp("mail", "DELETE", `/api/svc/groups/${encodeURIComponent(prev.ref)}`).catch((e) => console.error("[groups] mail remove", e));
    await record(gr.id, "mail", { status: "off" });
  }
  if (mailKind && gr.email) {
    await step(gr.id, "mail", async () => {
      const out = await callApp<MailOut>("mail", "PUT", `/api/svc/groups/${encodeURIComponent(gr.email!)}`, {
        kind: mailKind, name: gr.name, members: people, allowExternalSenders: gr.allow_external,
      });
      if (!out.provisioned) throw new AppError(out.note || "Mail didn't set up the address");
      return { ref: gr.email!, name: gr.email!, url: appUrl("mail") };
    });
  }
}

async function deprovision(gr: GroupRow): Promise<void> {
  const live = await q<{ app: string; ref: string }>(`SELECT app, ref FROM resources WHERE group_id = $1::uuid AND status <> 'off' AND app IN ('chat', 'drive', 'calendar', 'mail')`, [gr.id]);
  const source = sourceOf(gr.id);
  for (const r of live) {
    const path =
      r.app === "chat" ? `/api/svc/teams/${source}`
      : r.app === "drive" ? `/api/svc/libraries/${source}`
      : r.app === "calendar" ? `/api/svc/group-calendars/${source}`
      : r.app === "mail" && r.ref ? `/api/svc/groups/${encodeURIComponent(r.ref)}`
      : null;
    if (!path) continue;
    try {
      await callApp(r.app as AppName, "DELETE", path);
      await q(`UPDATE resources SET status = 'off', error = '', synced_at = now() WHERE group_id = $1::uuid AND app = $2`, [gr.id, r.app]);
    } catch (err) {
      if (err instanceof AppError && err.status === 404) {
        await q(`UPDATE resources SET status = 'off', error = '', synced_at = now() WHERE group_id = $1::uuid AND app = $2`, [gr.id, r.app]);
      } else {
        await q(`UPDATE resources SET status = 'error', error = $3, synced_at = now() WHERE group_id = $1::uuid AND app = $2`, [
          gr.id, r.app, (err instanceof Error ? err.message : String(err)).slice(0, 500),
        ]);
      }
    }
  }
}

/**
 * Brings every app in line with the group as it is now, then the groups that hold it (a
 * distribution list that includes a team must pick up the team's new member). Never throws:
 * failures are recorded on the group for its owners to see.
 */
export async function syncGroup(groupId: string, seen = new Set<string>()): Promise<void> {
  if (seen.has(groupId)) return;
  seen.add(groupId);
  const [gr] = await q<GroupRow>(
    `SELECT id, kind, name, description, email, allow_external, deleted_at FROM groups WHERE id = $1::uuid`,
    [groupId],
  );
  if (!gr) return;
  try {
    if (gr.deleted_at) await deprovision(gr);
    else await provision(gr);
    await q(`UPDATE groups SET synced_at = now() WHERE id = $1::uuid`, [groupId]);
  } catch (err) {
    console.error("[groups] sync", groupId, err);
  }
  for (const parent of await parentsOf(groupId)) await syncGroup(parent, seen);
}

/** The 15-minute sweep: every live group, and deleted groups still present somewhere. */
export async function syncAll(): Promise<number> {
  const rows = await q<{ id: string }>(
    `SELECT id FROM groups WHERE deleted_at IS NULL
        OR EXISTS (SELECT 1 FROM resources r WHERE r.group_id = groups.id AND r.status <> 'off' AND r.app IN ('chat', 'drive', 'calendar', 'mail'))
     ORDER BY synced_at NULLS FIRST LIMIT 1000`,
  );
  const seen = new Set<string>();
  for (const r of rows) await syncGroup(r.id, seen);
  return rows.length;
}
