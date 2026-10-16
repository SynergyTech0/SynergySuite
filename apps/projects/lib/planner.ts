import { appUrl } from "@synergy/config";
import { q, tx } from "./db";
import { dayOf } from "./dates";
import type { Me } from "./api";
import { listTasks, requireManager, roleOn } from "./projects";
import type { Task } from "./types";
import { UserError } from "./util";

/**
 * Planner boards in a project. Projects asks Planner as the signed-in person, with the same
 * gateway headers their browser carries (and PROXY_SHARED_SECRET), so it only ever sees the
 * boards and cards that person can open in Planner.
 */

export function plannerInternalUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PLANNER_INTERNAL_URL) return env.PLANNER_INTERNAL_URL.replace(/\/+$/, "");
  return env.NODE_ENV === "production" ? "http://planner:3600" : "http://localhost:3600";
}

export function plannerCardUrl(boardId: string, cardId: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${appUrl("planner", env)}/b/${boardId}?card=${cardId}`;
}

export function plannerBoardUrl(boardId: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${appUrl("planner", env)}/b/${boardId}`;
}

const g = globalThis as unknown as { __projectsPlannerFetch?: typeof fetch };

/** Swaps the fetch used to reach Planner, for tests. */
export function setPlannerFetch(f: typeof fetch | undefined): void {
  g.__projectsPlannerFetch = f;
}

function viewerHeaders(me: Me, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const h: Record<string, string> = {
    "x-auth-request-email": me.email,
    "x-auth-request-preferred-username": me.name,
    "x-auth-request-user": me.subject || me.email,
  };
  if (env.PROXY_SHARED_SECRET) h["x-proxy-auth-secret"] = env.PROXY_SHARED_SECRET;
  return h;
}

async function plannerGet<T>(me: Me, path: string): Promise<T> {
  const f = g.__projectsPlannerFetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${plannerInternalUrl()}${path}`, { headers: viewerHeaders(me), signal: AbortSignal.timeout(8000), redirect: "manual" });
  } catch {
    throw new UserError("Planner didn't answer. Try again in a moment.", 502);
  }
  if (res.status === 404) throw new UserError("That Planner board isn't there, or you aren't on it", 404);
  if (!res.ok) throw new UserError(`Planner answered ${res.status}`, 502);
  return (await res.json()) as T;
}

export type PlannerBoard = { id: string; title: string };

export async function plannerBoards(me: Me): Promise<PlannerBoard[]> {
  const rows = await plannerGet<{ id: string; title: string }[]>(me, "/api/boards");
  return Array.isArray(rows) ? rows.map((b) => ({ id: String(b.id), title: String(b.title ?? "") })) : [];
}

type PlannerCard = {
  id: string; title: string; description?: string | null; startDate?: string | null; dueDate?: string | null;
  isComplete?: boolean; originalEstimate?: number | null; issueKey?: string | null; listId?: string;
};
type Snapshot = { board?: { id: string; title: string }; lists?: { id: string; title: string }[]; cards?: PlannerCard[] };

/**
 * Brings a linked board's cards into the plan as tasks, one per card, under a summary task per
 * Planner list. Run again, it updates the tasks it made (title, dates, estimate, done) and adds
 * new cards; tasks are never deleted from here. Progress set in Projects is kept unless the card
 * was completed in Planner.
 */
export async function syncFromPlanner(me: Me, projectId: string): Promise<{ added: number; updated: number; tasks: Task[] }> {
  await requireManager(me.email, projectId);
  const [p] = await q<{ planner_board_id: string | null }>(`SELECT planner_board_id FROM projects WHERE id = $1::uuid`, [projectId]);
  if (!p.planner_board_id) throw new UserError("Link a Planner board first");
  const snap = await plannerGet<Snapshot>(me, `/api/boards/${encodeURIComponent(p.planner_board_id)}`);
  const cards = Array.isArray(snap.cards) ? snap.cards : [];
  const lists = new Map((snap.lists ?? []).map((l) => [String(l.id), String(l.title ?? "")]));
  let added = 0;
  let updated = 0;
  await tx(async (tq) => {
    const [m] = await tq<{ p: number | null }>(`SELECT max(position) AS p FROM tasks WHERE project_id = $1::uuid`, [projectId]);
    let position = (m.p ?? -1) + 1;
    const phase = new Map<string, string>();
    for (const card of cards) {
      const title = String(card.title ?? "").trim().slice(0, 300) || "(untitled card)";
      const due = dayOf(card.dueDate ?? null);
      const start = dayOf(card.startDate ?? null) ?? due;
      const finish = due && start && due < start ? start : due ?? start;
      const est = typeof card.originalEstimate === "number" && card.originalEstimate > 0 ? card.originalEstimate : null;
      const name = card.issueKey ? `${card.issueKey} ${title}` : title;
      const [existing] = await tq<{ id: string }>(
        `SELECT id FROM tasks WHERE project_id = $1::uuid AND planner_card_id = $2 AND held_deleted_at IS NULL`,
        [projectId, String(card.id)],
      );
      if (existing) {
        await tq(
          `UPDATE tasks SET title = $2, start_day = $3, finish_day = $4, estimate_minutes = COALESCE($5, estimate_minutes),
             percent_done = CASE WHEN $6 THEN 100 WHEN percent_done = 100 THEN 0 ELSE percent_done END, modified_at = now()
           WHERE id = $1::uuid`,
          [existing.id, name, start, finish, est, card.isComplete === true],
        );
        updated++;
        continue;
      }
      // New cards go under a summary task named after their Planner list.
      const listName = (card.listId && lists.get(String(card.listId))) || "";
      let parent: string | null = null;
      if (listName) {
        if (!phase.has(listName)) {
          const [found] = await tq<{ id: string }>(
            `SELECT id FROM tasks WHERE project_id = $1::uuid AND parent_id IS NULL AND planner_card_id IS NULL AND title = $2 AND held_deleted_at IS NULL LIMIT 1`,
            [projectId, listName],
          );
          const id = found?.id ?? (await tq<{ id: string }>(
            `INSERT INTO tasks (project_id, created_by, position, title) VALUES ($1::uuid, $2, $3, $4) RETURNING id`,
            [projectId, me.email, position++, listName],
          ))[0].id;
          phase.set(listName, id);
        }
        parent = phase.get(listName)!;
      }
      await tq(
        `INSERT INTO tasks (project_id, created_by, position, title, notes, parent_id, start_day, finish_day, estimate_minutes, percent_done, planner_card_id)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [projectId, me.email, position++, name, String(card.description ?? "").slice(0, 10000), parent, start, finish, est,
          card.isComplete === true ? 100 : 0, String(card.id)],
      );
      added++;
    }
  });
  return { added, updated, tasks: await listTasks(me.email, projectId) };
}

/** The Planner links for a project's tasks: board and cards. */
export async function plannerLinks(email: string, projectId: string): Promise<{ board: string | null; cards: Record<string, string> }> {
  await roleOn(email, projectId);
  const [p] = await q<{ planner_board_id: string | null }>(`SELECT planner_board_id FROM projects WHERE id = $1::uuid`, [projectId]);
  if (!p.planner_board_id) return { board: null, cards: {} };
  const rows = await q<{ id: string; planner_card_id: string }>(
    `SELECT id, planner_card_id FROM tasks WHERE project_id = $1::uuid AND planner_card_id IS NOT NULL AND held_deleted_at IS NULL`,
    [projectId],
  );
  return {
    board: plannerBoardUrl(p.planner_board_id),
    cards: Object.fromEntries(rows.map((r) => [r.id, plannerCardUrl(p.planner_board_id!, r.planner_card_id)])),
  };
}
