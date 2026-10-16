import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, workspaces, boards, lists, cards, comments } from "@/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterLast } from "@/lib/position";
import { publish } from "@/lib/bus";
import { logActivity, recordCardChanges } from "@/lib/activity";
import { notifyCardChanges } from "@/lib/card-notifications";
import { completionOnMove, inferCategory } from "@/lib/workflow";
import { notify, plainMentions, watcherIds } from "@/lib/notify";

/**
 * The mind's governed ingest. The Synergy mind POSTs here (shared token) to FILE its proposals /
 * goals / code-review findings as first-class cards (origin='mind', mindRef = source id, idempotent),
 * MOVE them between lists, and COMMENT on them. This is the AI-native wedge: the board partly runs
 * itself. It can only create/move/comment cards — never money/PHI/irreversible actions (there's no
 * such capability here); those stay in the exec-portal governance path.
 */
// This route skips the sign-in gateway, so the token is its only lock. Production without a
// MIND_TOKEN gets no token at all (every request refused) rather than the public dev default.
const TOKEN = process.env.MIND_TOKEN || (process.env.NODE_ENV === "production" ? "" : "dev-mind-token");
const DEFAULT_LISTS = ["Proposed", "Doing", "Review", "Done", "Goals"];

async function mindUser() {
  const u = await db.query.users.findFirst({ where: eq(users.isMind, true) });
  if (u) return u;
  const [n] = await db.insert(users).values({ name: "Synergy Mind", isMind: true, email: "mind@localhost" }).returning();
  return n;
}

async function ensureBoard(title: string) {
  let b = await db.query.boards.findFirst({ where: eq(boards.title, title) });
  if (!b) {
    let ws = await db.query.workspaces.findFirst();
    if (!ws) [ws] = await db.insert(workspaces).values({ name: "Synergy", slug: "synergy" }).returning();
    [b] = await db.insert(boards).values({ workspaceId: ws.id, title }).returning();
    await db.insert(lists).values(DEFAULT_LISTS.map((t, i) => ({ boardId: b!.id, title: t, position: (i + 1) * 1024, statusCategory: inferCategory(t) })));
  }
  return b;
}

async function ensureList(boardId: string, name: string) {
  const ls = await db.select().from(lists).where(and(eq(lists.boardId, boardId), eq(lists.title, name)));
  if (ls[0]) return ls[0];
  const all = await db.select({ position: lists.position }).from(lists).where(eq(lists.boardId, boardId));
  const [l] = await db.insert(lists).values({ boardId, title: name, position: afterLast(all.map((x) => x.position)), statusCategory: inferCategory(name) }).returning();
  return l;
}

export async function POST(req: Request) {
  if (!TOKEN || (req.headers.get("X-Mind-Token") || "") !== TOKEN)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const action = String(body.action || "file");
  const mind = await mindUser();
  const board = await ensureBoard(String(body.board || "Mind Ops"));
  const ping = () => publish(board.id, { type: "changed" });

  // find an existing mind card by its source ref (idempotency)
  const findByRef = async (ref: string) =>
    (await db.select().from(cards).where(and(eq(cards.boardId, board.id), eq(cards.mindRef, ref))))[0];

  if (action === "file") {
    const ref = String(body.ref || "");
    if (!ref || !body.title) return NextResponse.json({ error: "ref + title required" }, { status: 400 });
    const list = await ensureList(board.id, String(body.list || "Proposed"));
    const iss = {
      ...(body.issueType ? { issueType: String(body.issueType) as "epic" | "story" | "task" | "bug" | "subtask" } : {}),
      ...(body.priority ? { priority: String(body.priority) as "highest" | "high" | "medium" | "low" | "lowest" } : {}),
      ...(body.points != null ? { points: Number(body.points) } : {}),
    };
    const existing = await findByRef(ref);
    if (existing) {
      const [c] = await db.update(cards)
        .set({ title: String(body.title), description: body.detail ?? existing.description, ...iss, updatedAt: new Date() })
        .where(eq(cards.id, existing.id)).returning();
      await recordCardChanges(mind.id, existing, c);
      ping();
      return NextResponse.json({ ...c, created: false });
    }
    const pos = await db.select({ position: cards.position }).from(cards).where(eq(cards.listId, list.id));
    const [b2] = await db.update(boards).set({ seq: sql`${boards.seq} + 1` }).where(eq(boards.id, board.id)).returning();
    const issueKey = b2 ? `${b2.keyPrefix}-${b2.seq}` : null;
    const [c] = await db.insert(cards).values({
      listId: list.id, boardId: board.id, title: String(body.title), description: body.detail ?? null,
      position: afterLast(pos.map((p) => p.position)), origin: "mind", mindRef: ref, createdBy: mind.id,
      issueKey, issueType: (iss.issueType ?? "task"), priority: (iss.priority ?? "medium"), points: iss.points ?? null,
    }).returning();
    await logActivity({ boardId: board.id, cardId: c.id, userId: mind.id, type: "card_created", data: { title: c.title, ref } });
    ping();
    return NextResponse.json({ ...c, created: true }, { status: 201 });
  }

  if (action === "comment") {
    // Scope the cardId lookup to THIS board. A bare lookup by primary key reaches every card in
    // every workspace, so anyone holding the one shared MIND_TOKEN could post a comment stamped
    // origin:"mind" onto another tenant's card just by knowing its uuid.
    const card = body.cardId
      ? (await db.select().from(cards)
          .where(and(eq(cards.id, String(body.cardId)), eq(cards.boardId, board.id))))[0]
      : await findByRef(String(body.ref || ""));
    if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });
    const [c] = await db.insert(comments)
      .values({ cardId: card.id, userId: mind.id, origin: "mind", body: String(body.body || "") }).returning();
    await logActivity({ boardId: board.id, cardId: card.id, userId: mind.id, type: "comment_added", data: { commentId: c.id, excerpt: c.body.slice(0, 140) } });
    await notify({ recipients: await watcherIds(card.id), actorId: mind.id, type: "commented", boardId: board.id, cardId: card.id, data: { excerpt: plainMentions(c.body).slice(0, 200), title: card.title } });
    ping();
    return NextResponse.json(c, { status: 201 });
  }

  if (action === "move") {
    const card = await findByRef(String(body.ref || ""));
    if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });
    const list = await ensureList(board.id, String(body.list || "Doing"));
    const pos = await db.select({ position: cards.position }).from(cards).where(eq(cards.listId, list.id));
    const completion = await completionOnMove(card, list.id);
    const [c] = await db.update(cards).set({ listId: list.id, position: afterLast(pos.map((p) => p.position)), updatedAt: new Date(), ...completion })
      .where(eq(cards.id, card.id)).returning();
    await recordCardChanges(mind.id, card, c);
    await notifyCardChanges(mind.id, card, c);
    ping();
    return NextResponse.json(c);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
