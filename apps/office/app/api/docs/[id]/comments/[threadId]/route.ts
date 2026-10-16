import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { q } from "@/lib/db";
import { identity } from "@/lib/identity";
import { docAccess, atLeast } from "@/lib/access";
import { cleanAnchor } from "@/lib/comment-anchor";
import { notifyMentions, publicOrigin } from "@/lib/mentions";
import { recordMentions } from "@/lib/notifications";

export const dynamic = "force-dynamic";

// Reply to a thread (commenter+).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; threadId: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, threadId } = await ctx.params;
  const a = await docAccess(id, me);
  if (!a || !atLeast(a.role, "commenter")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const owns = await q(`SELECT id FROM comment_threads WHERE id = $1 AND doc_id = $2 AND org = $3`, [threadId, id, me.org]);
  if (!owns[0]) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { body?: string; id?: string };
  const text = (body.body ?? "").toString().trim();
  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });
  const msgId = typeof body.id === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(body.id) ? body.id : randomBytes(9).toString("base64url");
  const now = Date.now();
  const created = await q(
    `INSERT INTO comments (id, thread_id, doc_id, org, author_email, author_name, body, created_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [msgId, threadId, id, me.org, me.email, me.name, text.slice(0, 4000), now],
  );
  if (!created[0]) return NextResponse.json({ error: "id taken" }, { status: 409 });
  const before = (await q<{ body: string }>(`SELECT body FROM comments WHERE thread_id = $1 AND doc_id = $2 AND org = $3 AND id <> $4`, [threadId, id, me.org, msgId])).map((r) => r.body);
  const quote = (await q<{ quote: string }>(`SELECT quote FROM comment_threads WHERE id = $1`, [threadId]))[0]?.quote || "";
  // in-app notifications, and an e-mail when the server can send one
  const [inApp, mailed] = await Promise.all([
    recordMentions({ docId: id, threadId, by: me, body: text, before }),
    notifyMentions({ doc: a.doc, by: me, body: text.slice(0, 4000), quote, before, origin: publicOrigin(req.url) }),
  ]);
  const notified = [...new Set([...inApp, ...mailed])];
  return NextResponse.json({ id: msgId, author_email: me.email, author_name: me.name, created_ms: now, notified }, { status: 201 });
}

// Resolve / reopen a thread, or move it (a spreadsheet comment follows its cell).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; threadId: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, threadId } = await ctx.params;
  const a = await docAccess(id, me);
  if (!a || !atLeast(a.role, "commenter")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { resolved?: boolean; anchor?: unknown };
  if (typeof body.resolved === "boolean")
    await q(`UPDATE comment_threads SET resolved = $4 WHERE id = $1 AND doc_id = $2 AND org = $3`, [threadId, id, me.org, body.resolved]);
  const anchor = body.anchor !== undefined ? cleanAnchor(body.anchor) : "";
  if (anchor) await q(`UPDATE comment_threads SET anchor = $4 WHERE id = $1 AND doc_id = $2 AND org = $3`, [threadId, id, me.org, anchor]);
  return NextResponse.json({ ok: true });
}

// Delete a thread and its messages (editors, or whoever started the thread).
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; threadId: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, threadId } = await ctx.params;
  const a = await docAccess(id, me);
  if (!a || !atLeast(a.role, "commenter")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!atLeast(a.role, "editor")) {
    const first = await q<{ author_email: string }>(
      `SELECT author_email FROM comments WHERE thread_id = $1 AND doc_id = $2 AND org = $3 ORDER BY created_ms ASC LIMIT 1`,
      [threadId, id, me.org],
    );
    if (first[0]?.author_email !== me.email) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  await q(`DELETE FROM comments WHERE thread_id = $1 AND doc_id = $2 AND org = $3`, [threadId, id, me.org]);
  await q(`DELETE FROM comment_threads WHERE id = $1 AND doc_id = $2 AND org = $3`, [threadId, id, me.org]);
  return NextResponse.json({ ok: true });
}
