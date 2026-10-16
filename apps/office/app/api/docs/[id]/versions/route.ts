import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { q } from "@/lib/db";
import { identity } from "@/lib/identity";
import { docAccess, atLeast } from "@/lib/access";

export const dynamic = "force-dynamic";

type Row = { id: string; author_email: string; author_name: string; label: string | null; created_ms: string };

// List versions (metadata only — the HTML is fetched per-version on demand).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await docAccess(id, me))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const rows = await q<Row>(
    `SELECT id, author_email, author_name, label, created_ms FROM doc_versions
     WHERE doc_id = $1 AND org = $2 ORDER BY created_ms DESC LIMIT 100`,
    [id, me.org],
  );
  return NextResponse.json({ versions: rows });
}

// Save a snapshot. Skips a save if the HTML is identical to the newest version,
// so idle autosaves don't pile up duplicate history.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const a = await docAccess(id, me);
  if (!a || !atLeast(a.role, "editor")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { html?: string; label?: string; state?: unknown };
  const html = (body.html ?? "").toString();
  if (!html) return NextResponse.json({ error: "empty" }, { status: 400 });
  // the editor state (content, styles, sections, settings) as JSON text
  let state: string | null = null;
  if (typeof body.state === "string" && body.state.length < 20_000_000) {
    try {
      const s = JSON.parse(body.state);
      if (s && typeof s === "object" && s.doc && typeof s.doc === "object") state = body.state;
    } catch {
      state = null;
    }
  }

  const last = await q<{ html: string; state: string | null }>(
    `SELECT html, state FROM doc_versions WHERE doc_id = $1 AND org = $2 ORDER BY created_ms DESC LIMIT 1`,
    [id, me.org],
  );
  if (last[0]?.html === html && (last[0].state ?? null) === state) return NextResponse.json({ ok: true, skipped: true });

  const vid = randomBytes(9).toString("base64url");
  await q(
    `INSERT INTO doc_versions (id, doc_id, org, author_email, author_name, html, label, created_ms, state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [vid, id, me.org, me.email, me.name, html, (body.label ?? "").toString().slice(0, 80) || null, Date.now(), state],
  );
  return NextResponse.json({ id: vid }, { status: 201 });
}
