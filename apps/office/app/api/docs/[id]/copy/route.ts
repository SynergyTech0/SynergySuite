import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { q } from "@/lib/db";
import { identity } from "@/lib/identity";
import { docAccess } from "@/lib/access";
import { copyDocMedia } from "@/lib/slides/media-store";
import { mediaIdsIn, mediaRewrite, rewriteYdoc } from "@/lib/doc-copy";

export const dynamic = "force-dynamic";

// File > Make a copy: anyone who can open a document can copy it into a new
// private document of their own, media files and sensitivity label included.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const a = await docAccess(id, me);
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { title?: unknown };
  const src = (await q<{ ydoc: Buffer | null; snapshot: unknown; kind: string; title: string; label_id: string | null }>(`SELECT ydoc, snapshot, kind, title, label_id FROM documents WHERE id = $1 AND org = $2`, [id, me.org]))[0];
  if (!src) return NextResponse.json({ error: "not found" }, { status: 404 });
  const newId = randomBytes(9).toString("base64url");
  const title = (typeof body.title === "string" && body.title.trim().slice(0, 200)) || `Copy of ${src.title}`.slice(0, 200);
  // the media the content points at, copied for the new document
  const snapText = src.snapshot ? JSON.stringify(src.snapshot) : "";
  let ystate: Uint8Array | null = src.ydoc ? new Uint8Array(src.ydoc) : null;
  const ids = new Set<string>(mediaIdsIn(snapText, id));
  if (ystate) rewriteYdoc(ystate, (s) => (mediaIdsIn(s, id).forEach((m) => ids.add(m)), s));
  const map = ids.size ? await copyDocMedia(id, newId, me.org, me.email, [...ids], () => randomBytes(12).toString("base64url")) : new Map<string, string>();
  const rewrite = mediaRewrite(id, newId, map);
  if (ystate && map.size) ystate = rewriteYdoc(ystate, rewrite);
  const snapshot = snapText ? JSON.parse(map.size ? rewrite(snapText) : snapText) : null;
  await q(
    `INSERT INTO documents (id, org, owner_email, kind, title, ydoc, snapshot, scope, company_role, label_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'private', NULL, $8)`,
    [newId, me.org, me.email, src.kind, title, ystate ? Buffer.from(ystate) : null, snapshot, src.label_id],
  );
  return NextResponse.json({ id: newId, kind: src.kind, title, media: map.size }, { status: 201 });
}
