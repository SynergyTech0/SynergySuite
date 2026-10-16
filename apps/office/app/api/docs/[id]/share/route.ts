import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { identity } from "@/lib/identity";
import { docAccess, atLeast } from "@/lib/access";

export const dynamic = "force-dynamic";

const ROLES = new Set(["viewer", "commenter", "editor"]);

// Sharing management is open to editors+ (Google's default: editors can share).
// Deleting the doc stays owner-only (handled in /api/docs/[id]).
async function requireEditor(id: string, me: Awaited<ReturnType<typeof identity>>) {
  const a = await docAccess(id, me);
  if (!a || !atLeast(a.role, "editor")) return null;
  return a;
}

// Company access + the list of people grants (for the share dialog).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const a = await requireEditor(id, me);
  if (!a) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const grants = await q<{ email: string; role: string }>(
    `SELECT email, role FROM doc_grants WHERE doc_id = $1 AND org = $2 ORDER BY email`,
    [id, me.org],
  );
  return NextResponse.json({
    owner_email: a.doc.owner_email,
    scope: a.doc.scope,
    company_role: a.doc.company_role,
    grants,
    can_manage: true,
  });
}

// Set (or clear) company-wide access. body: { companyRole: 'viewer'|'commenter'|'editor'|'none' }
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const a = await requireEditor(id, me);
  if (!a) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { companyRole?: string };
  const cr = body.companyRole;
  if (cr && cr !== "none" && !ROLES.has(cr)) return NextResponse.json({ error: "bad role" }, { status: 400 });
  const scope = cr && cr !== "none" ? "company" : "private";
  const companyRole = cr && cr !== "none" ? cr : null;
  await q(`UPDATE documents SET scope = $3, company_role = $4, updated_at = now() WHERE id = $1 AND org = $2`, [
    id,
    me.org,
    scope,
    companyRole,
  ]);
  return NextResponse.json({ ok: true, scope, company_role: companyRole });
}

// Add / update / remove a per-person grant. body: { email, role: 'viewer'|'commenter'|'editor'|'none' }
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const a = await requireEditor(id, me);
  if (!a) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { email?: string; role?: string };
  const email = (body.email ?? "").toString().trim().toLowerCase();
  if (!email || !email.includes("@")) return NextResponse.json({ error: "bad email" }, { status: 400 });
  // The owner's access is intrinsic — never expressed as (or overridable by) a grant.
  if (email === a.doc.owner_email) return NextResponse.json({ error: "that person is the owner" }, { status: 400 });

  if (body.role === "none") {
    await q(`DELETE FROM doc_grants WHERE doc_id = $1 AND org = $2 AND email = $3`, [id, me.org, email]);
    return NextResponse.json({ ok: true, removed: email });
  }
  if (!ROLES.has(body.role ?? "")) return NextResponse.json({ error: "bad role" }, { status: 400 });
  await q(
    `INSERT INTO doc_grants (doc_id, org, email, role, granted_by, created_ms)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (doc_id, email) DO UPDATE SET role = EXCLUDED.role`,
    [id, me.org, email, body.role, me.email, Date.now()],
  );
  return NextResponse.json({ ok: true, email, role: body.role });
}
