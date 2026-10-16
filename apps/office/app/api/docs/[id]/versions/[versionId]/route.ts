import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { identity } from "@/lib/identity";
import { docAccess, atLeast } from "@/lib/access";

export const dynamic = "force-dynamic";

// Fetch a single version's HTML (used to preview / restore it into the editor).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, versionId } = await ctx.params;
  if (!(await docAccess(id, me))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const rows = await q<{ id: string; html: string; created_ms: string; author_name: string; state: string | null }>(
    `SELECT id, html, created_ms, author_name, state FROM doc_versions WHERE id = $1 AND doc_id = $2 AND org = $3`,
    [versionId, id, me.org],
  );
  if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ version: rows[0] });
}

// Name (or rename) a version; an empty label clears it.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, versionId } = await ctx.params;
  const a = await docAccess(id, me);
  if (!a || !atLeast(a.role, "editor")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { label?: unknown };
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 80) : "";
  const rows = await q<{ id: string }>(`UPDATE doc_versions SET label = $1 WHERE id = $2 AND doc_id = $3 AND org = $4 RETURNING id`, [label || null, versionId, id, me.org]);
  if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
