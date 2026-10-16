import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { q } from "@/lib/db";
import { identity } from "@/lib/identity";
import { docAccess, atLeast } from "@/lib/access";
import { cleanAnchor } from "@/lib/comment-anchor";
import { notifyMentions, publicOrigin } from "@/lib/mentions";
import { recordMentions } from "@/lib/notifications";

export const dynamic = "force-dynamic";

type Thread = { id: string; doc_id: string; quote: string; anchor: string; resolved: boolean; created_ms: string };

// Spreadsheet comments are created by the editor with its own ids, so the
// client may pass ids; they must look like ours and not be taken.
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

type Msg = { id: string; thread_id: string; author_email: string; author_name: string; body: string; created_ms: string };

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await docAccess(id, me))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const threads = await q<Thread>(
    `SELECT id, doc_id, quote, anchor, resolved, created_ms FROM comment_threads
     WHERE doc_id = $1 AND org = $2 ORDER BY resolved ASC, created_ms ASC`,
    [id, me.org],
  );
  const msgs = await q<Msg>(
    `SELECT id, thread_id, author_email, author_name, body, created_ms FROM comments
     WHERE doc_id = $1 AND org = $2 ORDER BY created_ms ASC`,
    [id, me.org],
  );
  const byThread: Record<string, Msg[]> = {};
  for (const m of msgs) (byThread[m.thread_id] ??= []).push(m);
  return NextResponse.json({ threads: threads.map((t) => ({ ...t, messages: byThread[t.id] ?? [] })) });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const a = await docAccess(id, me);
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!atLeast(a.role, "commenter")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { quote?: string; body?: string; threadId?: string; id?: string; anchor?: unknown };
  const text = (body.body ?? "").toString().trim();
  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });
  const quote = (body.quote ?? "").toString().slice(0, 300);
  const anchor = cleanAnchor(body.anchor);
  const threadId = typeof body.threadId === "string" && ID_RE.test(body.threadId) ? body.threadId : randomBytes(9).toString("base64url");
  const msgId = typeof body.id === "string" && ID_RE.test(body.id) ? body.id : randomBytes(9).toString("base64url");
  const now = Date.now();

  const created = await q(
    `INSERT INTO comment_threads (id, doc_id, org, quote, anchor, resolved, created_ms) VALUES ($1,$2,$3,$4,$5,false,$6)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [threadId, id, me.org, quote, anchor, now],
  );
  if (!created[0]) return NextResponse.json({ error: "id taken" }, { status: 409 });
  await q(
    `INSERT INTO comments (id, thread_id, doc_id, org, author_email, author_name, body, created_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
    [msgId, threadId, id, me.org, me.email, me.name, text.slice(0, 4000), now],
  );
  // in-app notifications, and an e-mail when the server can send one
  const [inApp, mailed] = await Promise.all([
    recordMentions({ docId: id, threadId, by: me, body: text }),
    notifyMentions({ doc: a.doc, by: me, body: text.slice(0, 4000), quote, origin: publicOrigin(req.url) }),
  ]);
  const notified = [...new Set([...inApp, ...mailed])];
  return NextResponse.json({ threadId, id: msgId, author_email: me.email, author_name: me.name, created_ms: now, notified }, { status: 201 });
}
