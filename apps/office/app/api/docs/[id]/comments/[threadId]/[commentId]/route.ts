import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { identity } from "@/lib/identity";
import { docAccess, atLeast } from "@/lib/access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; threadId: string; commentId: string }> };

async function load(ctx: Ctx) {
  const me = await identity();
  if (!me.email) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  const { id, threadId, commentId } = await ctx.params;
  const a = await docAccess(id, me);
  if (!a || !atLeast(a.role, "commenter")) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  const rows = await q<{ author_email: string }>(
    `SELECT author_email FROM comments WHERE id = $1 AND thread_id = $2 AND doc_id = $3 AND org = $4`,
    [commentId, threadId, id, me.org],
  );
  if (!rows[0]) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  return { me, id, threadId, commentId, role: a.role, author: rows[0].author_email };
}

// Edit your own message.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const r = await load(ctx);
  if ("error" in r) return r.error;
  if (r.author !== r.me.email) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { body?: string };
  const text = (body.body ?? "").toString().trim();
  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });
  await q(`UPDATE comments SET body = $5 WHERE id = $1 AND thread_id = $2 AND doc_id = $3 AND org = $4`, [
    r.commentId,
    r.threadId,
    r.id,
    r.me.org,
    text.slice(0, 4000),
  ]);
  return NextResponse.json({ ok: true });
}

// Delete one reply: its author, or an editor.
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const r = await load(ctx);
  if ("error" in r) return r.error;
  if (r.author !== r.me.email && !atLeast(r.role, "editor")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await q(`DELETE FROM comments WHERE id = $1 AND thread_id = $2 AND doc_id = $3 AND org = $4`, [r.commentId, r.threadId, r.id, r.me.org]);
  return NextResponse.json({ ok: true });
}
