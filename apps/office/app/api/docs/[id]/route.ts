import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { deleteDocMedia } from "@/lib/slides/media-store";
import { identity } from "@/lib/identity";
import { docAccess, ownedDoc, atLeast } from "@/lib/access";
import { enforceOnSnapshot } from "@/lib/protection-rules.mjs";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const a = await docAccess(id, me);
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    document: {
      id: a.doc.id,
      kind: a.doc.kind,
      title: a.doc.title,
      snippet: a.doc.snippet,
      owner_email: a.doc.owner_email,
      scope: a.doc.scope,
      company_role: a.doc.company_role,
      snapshot: a.doc.snapshot,
      role: a.role,
      is_owner: a.role === "owner",
    },
  });
}

// Content edits (title/snippet/snapshot) require editor+.
// Scope / company_role changes are ownership actions (handled in /share).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const a = await docAccess(id, me);
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!atLeast(a.role, "editor")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { title?: string; snippet?: string; snapshot?: unknown; starred?: boolean };
  const title = (body.title ?? "").toString().slice(0, 200);
  const snippet = (body.snippet ?? "").toString().slice(0, 300);
  const hasSnapshot = Object.prototype.hasOwnProperty.call(body, "snapshot");
  // Protected sheets and ranges: a save from anyone but the owner keeps the
  // stored protections and the protected cells they may not change.
  if (hasSnapshot && a.doc.kind === "sheet" && a.role !== "owner")
    body.snapshot = enforceOnSnapshot(a.doc.snapshot, body.snapshot, { email: me.email, role: a.role });
  const snapshot = hasSnapshot ? JSON.stringify(body.snapshot) : null;
  const hasStar = Object.prototype.hasOwnProperty.call(body, "starred");

  await q(
    `UPDATE documents
       SET title    = COALESCE(NULLIF($3,''), title),
           snippet  = $4,
           snapshot = CASE WHEN $5::boolean THEN $6::jsonb ELSE snapshot END,
           starred  = CASE WHEN $7::boolean THEN $8::boolean ELSE starred END,
           updated_at = now()
     WHERE id = $1 AND org = $2`,
    [id, me.org, title, snippet, hasSnapshot, snapshot, hasStar, !!body.starred],
  );
  return NextResponse.json({ ok: true });
}

// Only the owner may delete.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const owned = await ownedDoc(id, me);
  if (!owned) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await q(`DELETE FROM comments WHERE doc_id = $1 AND org = $2`, [id, me.org]);
  await q(`DELETE FROM comment_threads WHERE doc_id = $1 AND org = $2`, [id, me.org]);
  await q(`DELETE FROM doc_versions WHERE doc_id = $1 AND org = $2`, [id, me.org]);
  await q(`DELETE FROM doc_grants WHERE doc_id = $1 AND org = $2`, [id, me.org]);
  await deleteDocMedia(id, me.org); // presentations' audio and video
  await q(`DELETE FROM documents WHERE id = $1 AND org = $2`, [id, me.org]);
  return NextResponse.json({ ok: true });
}
