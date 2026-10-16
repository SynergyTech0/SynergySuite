import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { q } from "@/lib/db";
import { identity } from "@/lib/identity";
import { newDocumentLabel } from "@/lib/policy";

export const dynamic = "force-dynamic";

type DocRow = {
  id: string;
  kind: string;
  title: string;
  snippet: string;
  owner_email: string;
  scope: string;
  updated_at: string;
  shared: boolean;
  label_id: string | null;
};

const KINDS = new Set(["doc", "sheet", "slide"]);
const DEFAULT_TITLE: Record<string, string> = {
  doc: "Untitled document",
  sheet: "Untitled spreadsheet",
  slide: "Untitled presentation",
};

// Everything the caller may see: their own docs, docs shared to the org, and
// docs shared with them personally (a per-person grant).
export async function GET() {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const rows = await q<DocRow>(
    `SELECT d.id, d.kind, d.title, d.snippet, d.owner_email, d.scope, d.updated_at, d.label_id,
            (g.email IS NOT NULL) AS shared
     FROM documents d
     LEFT JOIN doc_grants g ON g.doc_id = d.id AND g.email = $2
     WHERE d.org = $1 AND (d.owner_email = $2 OR d.scope = 'company' OR g.email IS NOT NULL)
     ORDER BY d.updated_at DESC LIMIT 300`,
    [me.org, me.email],
  );
  return NextResponse.json({ documents: rows, me: me.email });
}

export async function POST(req: NextRequest) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { kind?: string; scope?: string; title?: unknown };
  const kind = KINDS.has(body.kind ?? "") ? (body.kind as string) : "doc";
  const isCompany = body.scope === "company";
  const id = randomBytes(9).toString("base64url");
  const labelId = await newDocumentLabel();
  await q(
    `INSERT INTO documents (id, org, owner_email, kind, title, scope, company_role, label_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, me.org, me.email, kind, (typeof body.title === "string" && body.title.trim().slice(0, 200)) || DEFAULT_TITLE[kind], isCompany ? "company" : "private", isCompany ? "editor" : null, labelId],
  );
  return NextResponse.json({ id, kind, scope: isCompany ? "company" : "private", label_id: labelId }, { status: 201 });
}
