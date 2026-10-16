import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { boards, cards, comments, lists, users } from "@/db/schema";
import { bus } from "@/lib/bus";
import { closeDb, resetDb } from "../helpers/db";

/**
 * CHARACTERIZATION tests for the mind ingest (/api/mind).
 *
 * These pin behaviour that already works in production — 781 of the 783 live cards were filed
 * through this route — so they pass on the first run by design. Their job is to fail loudly if
 * later work (tenancy, membership checks, schema changes) breaks the contract the Synergy mind
 * depends on. The route authenticates with a shared X-Mind-Token and is deliberately exempt from
 * SSO at the proxy (OAUTH2_PROXY_SKIP_AUTH_ROUTES: ^/api/mind), so it has no session and no user.
 */
const TOKEN = process.env.MIND_TOKEN!;

async function postMind(body: unknown, token: string = TOKEN) {
  const { POST } = await import("@/app/api/mind/route");
  return POST(
    new Request("http://localhost/api/mind", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Mind-Token": token },
      body: JSON.stringify(body),
    }),
  );
}

/** Resolve once the board publishes an SSE event, or reject after `ms`. */
function nextEvent(boardId: string, ms = 2000) {
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      bus.off(boardId, onEvent);
      reject(new Error(`no event published on board ${boardId} within ${ms}ms`));
    }, ms);
    function onEvent(event: unknown) {
      clearTimeout(timer);
      bus.off(boardId, onEvent);
      resolve(event);
    }
    bus.on(boardId, onEvent);
  });
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeDb();
});

describe("mind ingest: authentication", () => {
  it("rejects a wrong token with 401 and writes nothing", async () => {
    const res = await postMind({ action: "file", ref: "r1", title: "should not exist" }, "wrong-token");

    expect(res.status).toBe(401);
    expect(await db.select().from(cards)).toHaveLength(0);
    expect(await db.select().from(boards)).toHaveLength(0);
  });
});

describe("mind ingest: file", () => {
  it("auto-provisions workspace, board, default lists and the mind user, then files the card", async () => {
    const res = await postMind({ action: "file", ref: "prop-1", title: "Ship the thing" });
    expect(res.status).toBe(201);

    const card = await res.json();
    expect(card.created).toBe(true);
    expect(card.origin).toBe("mind");
    expect(card.mindRef).toBe("prop-1");
    expect(card.issueKey).toBe("SYN-1");

    const [board] = await db.select().from(boards);
    expect(board.title).toBe("Mind Ops");
    expect(board.seq).toBe(1);

    const boardLists = await db.select().from(lists).where(eq(lists.boardId, board.id));
    expect(boardLists.map((l) => l.title).sort()).toEqual(
      ["Doing", "Done", "Goals", "Proposed", "Review"].sort(),
    );

    const [mind] = await db.select().from(users).where(eq(users.isMind, true));
    expect(card.createdBy).toBe(mind.id);

    // filed into "Proposed" by default
    const proposed = boardLists.find((l) => l.title === "Proposed")!;
    expect(card.listId).toBe(proposed.id);
  });

  it("is idempotent by ref: re-filing updates the same card instead of duplicating", async () => {
    const first = await (await postMind({ action: "file", ref: "prop-2", title: "First title" })).json();
    const second = await postMind({ action: "file", ref: "prop-2", title: "Second title" });

    expect(second.status).toBe(200);
    const updated = await second.json();
    expect(updated.created).toBe(false);
    expect(updated.id).toBe(first.id);
    expect(updated.title).toBe("Second title");

    expect(await db.select().from(cards)).toHaveLength(1);

    // the issue key is assigned once and the board sequence does not advance on an update
    expect(updated.issueKey).toBe(first.issueKey);
    const [board] = await db.select().from(boards);
    expect(board.seq).toBe(1);
  });

  it("assigns issue keys from the board sequence", async () => {
    const a = await (await postMind({ action: "file", ref: "a", title: "A" })).json();
    const b = await (await postMind({ action: "file", ref: "b", title: "B" })).json();

    expect([a.issueKey, b.issueKey]).toEqual(["SYN-1", "SYN-2"]);
  });

  it("carries issue type, priority and points through when given", async () => {
    const res = await postMind({
      action: "file",
      ref: "typed",
      title: "A bug",
      detail: "steps to reproduce",
      issueType: "bug",
      priority: "high",
      points: 3,
    });

    const card = await res.json();
    expect(card.issueType).toBe("bug");
    expect(card.priority).toBe("high");
    expect(card.points).toBe(3);
    expect(card.description).toBe("steps to reproduce");
  });

  it("requires both ref and title", async () => {
    expect((await postMind({ action: "file", title: "no ref" })).status).toBe(400);
    expect((await postMind({ action: "file", ref: "no-title" })).status).toBe(400);
    expect(await db.select().from(cards)).toHaveLength(0);
  });
});

describe("mind ingest: comment and move", () => {
  it("comments on a card found by ref, as the mind", async () => {
    await postMind({ action: "file", ref: "c-1", title: "Card with a comment" });
    const res = await postMind({ action: "comment", ref: "c-1", body: "the mind's note" });

    expect(res.status).toBe(201);
    const [row] = await db.select().from(comments);
    expect(row.origin).toBe("mind");
    expect(row.body).toBe("the mind's note");
  });

  it("moves a card to a named list, creating that list when missing", async () => {
    const filed = await (await postMind({ action: "file", ref: "m-1", title: "Movable" })).json();
    const res = await postMind({ action: "move", ref: "m-1", list: "Blocked" });

    expect(res.status).toBe(200);
    const moved = await res.json();
    const [board] = await db.select().from(boards);
    const [blocked] = await db
      .select()
      .from(lists)
      .where(and(eq(lists.boardId, board.id), eq(lists.title, "Blocked")));

    expect(blocked).toBeDefined();
    expect(moved.listId).toBe(blocked.id);
    expect(moved.id).toBe(filed.id);
  });

  it("returns 404 for comment or move against an unknown ref", async () => {
    expect((await postMind({ action: "comment", ref: "nope", body: "x" })).status).toBe(404);
    expect((await postMind({ action: "move", ref: "nope", list: "Doing" })).status).toBe(404);
  });

  it("rejects an unknown action with 400", async () => {
    expect((await postMind({ action: "destroy", ref: "x" })).status).toBe(400);
  });
});

describe("mind ingest: realtime", () => {
  it("publishes a change event on the board channel for file, comment and move", async () => {
    // provision the board first so its id is known before subscribing
    await postMind({ action: "file", ref: "seed", title: "Seed" });
    const [board] = await db.select().from(boards);

    const onFile = nextEvent(board.id);
    await postMind({ action: "file", ref: "rt-1", title: "Realtime" });
    expect(await onFile).toEqual({ type: "changed" });

    const onComment = nextEvent(board.id);
    await postMind({ action: "comment", ref: "rt-1", body: "note" });
    expect(await onComment).toEqual({ type: "changed" });

    const onMove = nextEvent(board.id);
    await postMind({ action: "move", ref: "rt-1", list: "Doing" });
    expect(await onMove).toEqual({ type: "changed" });
  });
});
